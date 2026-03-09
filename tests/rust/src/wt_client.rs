use std::collections::HashMap;
use std::sync::Arc;

use bytes::{BufMut, Bytes, BytesMut};
use serde::Deserialize;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{timeout, Duration};
use url::Url;
use web_transport_quinn::{Client, RecvStream, SendStream, Session};
use wire_protocol::codec::{Frame, WS_STREAM_CONTROL, WS_STREAM_SYNC};
use wire_protocol::decode_payload;
use wire_protocol::frames;

use crate::fixtures::{GATEWAY_WEBTRANSPORT, GATEWAY_WEBTRANSPORT_INFO};

const STREAM_LENGTH_PREFIX_SIZE: usize = 4;
const HANDSHAKE_CONTROL: u8 = 0x00;
const HANDSHAKE_SYNC: u8 = 0x01;
const HANDSHAKE_CONVERSATION: u8 = 0x02;

#[derive(Debug)]
struct ReceivedFrame {
    stream_id: u16,
    frame: Frame,
}

type SharedSendStream = Arc<Mutex<SendStream>>;

pub struct WtTestClient {
    session: Session,
    senders: Arc<Mutex<HashMap<u16, SharedSendStream>>>,
    frame_tx: mpsc::UnboundedSender<ReceivedFrame>,
    frame_rx: mpsc::UnboundedReceiver<ReceivedFrame>,
    opened_stream_rx: mpsc::UnboundedReceiver<u16>,
}

#[derive(Debug, Deserialize)]
struct WebTransportInfoResponse {
    enabled: bool,
    #[serde(default)]
    server_certificate_hashes: Vec<CertificateHashInfo>,
}

#[derive(Debug, Deserialize)]
struct CertificateHashInfo {
    algorithm: String,
    value: String,
}

impl WtTestClient {
    pub async fn connect() -> Result<Self, Box<dyn std::error::Error>> {
        let _ =
            web_transport_quinn::quinn::rustls::crypto::aws_lc_rs::default_provider()
                .install_default();
        let certificate_hashes = load_server_certificate_hashes().await?;
        let client = Client::new().server_certificate_hashes(certificate_hashes);
        let session = client.connect(&Url::parse(GATEWAY_WEBTRANSPORT)?).await?;

        let senders = Arc::new(Mutex::new(HashMap::new()));
        let (frame_tx, frame_rx) = mpsc::unbounded_channel();
        let (opened_stream_tx, opened_stream_rx) = mpsc::unbounded_channel();

        open_stream(
            session.clone(),
            senders.clone(),
            frame_tx.clone(),
            WS_STREAM_CONTROL,
        )
        .await?;
        open_stream(session.clone(), senders.clone(), frame_tx.clone(), WS_STREAM_SYNC).await?;

        spawn_incoming_stream_acceptor(
            session.clone(),
            senders.clone(),
            frame_tx.clone(),
            opened_stream_tx,
        );
        spawn_datagram_reader(session.clone(), frame_tx.clone());

        Ok(Self {
            session,
            senders,
            frame_tx,
            frame_rx,
            opened_stream_rx,
        })
    }

    pub async fn authenticate(&mut self, token: &str) -> Result<(), Box<dyn std::error::Error>> {
        let payload = rmp_serde::to_vec_named(&serde_json::json!({
            "token": token,
            "device_id": uuid::Uuid::new_v4().to_string(),
            "device_name": "integration-tests"
        }))?;
        let frame = Frame::new(frames::AUTH_REQUEST, 0, Bytes::from(payload));
        self.send_frame(WS_STREAM_CONTROL, &frame).await
    }

    pub async fn subscribe(
        &mut self,
        conversation_ids: &[&str],
        tenant_id: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let payload = rmp_serde::to_vec_named(&serde_json::json!({
            "conversation_ids": conversation_ids,
            "tenant_id": tenant_id
        }))?;
        let frame = Frame::new(frames::SUBSCRIBE, 0, Bytes::from(payload));
        self.send_frame(WS_STREAM_CONTROL, &frame).await
    }

    pub async fn send_message(
        &mut self,
        conversation_id: &str,
        content: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let payload = rmp_serde::to_vec_named(&serde_json::json!({
            "channel_id": conversation_id,
            "content_encrypted": content.as_bytes(),
            "mls_group_id": [],
            "mls_epoch": 0,
            "mls_sender_leaf": 0
        }))?;
        let frame = Frame::new(frames::MESSAGE_SEND, 0, Bytes::from(payload));
        let stream_id = conversation_stream_id(conversation_id);
        self.send_frame(stream_id, &frame).await
    }

    pub async fn send_reaction(
        &mut self,
        conversation_id: &str,
        message_id: &str,
        emoji: &str,
        action: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let payload = rmp_serde::to_vec_named(&serde_json::json!({
            "channel_id": conversation_id,
            "message_id": message_id,
            "emoji": emoji,
            "action": action
        }))?;
        let frame = Frame::new(frames::MESSAGE_REACTION, 0, Bytes::from(payload));
        let stream_id = conversation_stream_id(conversation_id);
        self.send_frame(stream_id, &frame).await
    }

    pub async fn send_thread_reply(
        &mut self,
        conversation_id: &str,
        thread_id: &str,
        content: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let payload = rmp_serde::to_vec_named(&serde_json::json!({
            "channel_id": conversation_id,
            "thread_id": thread_id,
            "content_encrypted": content.as_bytes(),
            "mls_epoch": 0,
            "mls_sender_leaf": 0
        }))?;
        let frame = Frame::new(frames::THREAD_REPLY, 0, Bytes::from(payload));
        let stream_id = conversation_stream_id(conversation_id);
        self.send_frame(stream_id, &frame).await
    }

    pub async fn request_history(
        &mut self,
        conversation_id: &str,
        before_seq: u64,
        limit: u32,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let payload = rmp_serde::to_vec_named(&serde_json::json!({
            "conversation_id": conversation_id,
            "before_seq": before_seq,
            "limit": limit
        }))?;
        let frame = Frame::new(frames::HISTORY_REQUEST, 0, Bytes::from(payload));
        self.send_frame(WS_STREAM_SYNC, &frame).await
    }

    async fn send_frame(
        &mut self,
        stream_id: u16,
        frame: &Frame,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if frame.is_ephemeral()
            || matches!(
                wire_protocol::frames::stream_type(frame.frame_type()),
                wire_protocol::frames::StreamType::Datagram
            )
        {
            self.session.send_datagram(frame.encode())?;
            return Ok(());
        }

        let send = self.ensure_stream(stream_id).await?;
        let mut send = send.lock().await;
        write_length_prefixed_frame(&mut send, frame).await?;
        Ok(())
    }

    async fn ensure_stream(
        &mut self,
        stream_id: u16,
    ) -> Result<SharedSendStream, Box<dyn std::error::Error>> {
        if let Some(existing) = self.senders.lock().await.get(&stream_id).cloned() {
            return Ok(existing);
        }

        open_stream(
            self.session.clone(),
            self.senders.clone(),
            self.frame_tx.clone(),
            stream_id,
        )
        .await?;

        self.senders
            .lock()
            .await
            .get(&stream_id)
            .cloned()
            .ok_or_else(|| format!("failed to open stream {stream_id}").into())
    }

    pub async fn recv_frame(
        &mut self,
        timeout_ms: u64,
    ) -> Result<(u16, Frame), Box<dyn std::error::Error>> {
        let received = timeout(Duration::from_millis(timeout_ms), self.frame_rx.recv())
            .await?
            .ok_or("WebTransport session closed")?;
        Ok((received.stream_id, received.frame))
    }

    pub async fn recv_opened_stream(
        &mut self,
        timeout_ms: u64,
    ) -> Result<u16, Box<dyn std::error::Error>> {
        let stream_id = timeout(Duration::from_millis(timeout_ms), self.opened_stream_rx.recv())
            .await?
            .ok_or("WebTransport session closed before stream opened")?;
        Ok(stream_id)
    }

    pub async fn recv_frame_of_type(
        &mut self,
        frame_type: u8,
        timeout_ms: u64,
    ) -> Result<(u16, Frame), Box<dyn std::error::Error>> {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err(format!("Timeout waiting for frame type 0x{frame_type:02x}").into());
            }

            let (stream_id, frame) = self.recv_frame(remaining.as_millis() as u64).await?;
            if frame.frame_type() == frames::ERROR && frame_type != frames::ERROR {
                let err = decode_payload::<wire_protocol::schema::system::ErrorFrame>(&frame)
                    .map(|payload| format!("{} (code {})", payload.message, payload.code))
                    .unwrap_or_else(|_| "unable to decode error payload".to_string());
                return Err(format!(
                    "Received ERROR frame while waiting for type 0x{frame_type:02x}: {err}"
                )
                .into());
            }
            if frame.frame_type() == frame_type {
                return Ok((stream_id, frame));
            }
        }
    }

    pub async fn close(self) -> Result<(), Box<dyn std::error::Error>> {
        self.session.close(0, b"goodbye");
        Ok(())
    }
}

async fn load_server_certificate_hashes() -> Result<Vec<Vec<u8>>, Box<dyn std::error::Error>> {
    let response = reqwest::get(GATEWAY_WEBTRANSPORT_INFO)
        .await?
        .error_for_status()?
        .json::<WebTransportInfoResponse>()
        .await?;

    if !response.enabled {
        return Err("gateway reports WebTransport disabled".into());
    }

    let hashes = response
        .server_certificate_hashes
        .into_iter()
        .filter(|hash| hash.algorithm.eq_ignore_ascii_case("sha-256"))
        .map(|hash| decode_hex(&hash.value))
        .collect::<Result<Vec<_>, _>>()?;

    if hashes.is_empty() {
        return Err("gateway did not publish any sha-256 certificate hashes".into());
    }

    Ok(hashes)
}

fn decode_hex(hex: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let normalized = hex.trim();
    if normalized.len() % 2 != 0 {
        return Err("invalid hex string length".into());
    }

    let mut bytes = Vec::with_capacity(normalized.len() / 2);
    let mut index = 0;
    while index < normalized.len() {
        let value = u8::from_str_radix(&normalized[index..index + 2], 16)?;
        bytes.push(value);
        index += 2;
    }
    Ok(bytes)
}

async fn open_stream(
    session: Session,
    senders: Arc<Mutex<HashMap<u16, SharedSendStream>>>,
    frame_tx: mpsc::UnboundedSender<ReceivedFrame>,
    stream_id: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let (mut send, recv) = session.open_bi().await?;
    send.write_all(&build_handshake(stream_id)).await?;

    let send = Arc::new(Mutex::new(send));
    senders.lock().await.insert(stream_id, send);
    spawn_stream_reader(stream_id, recv, frame_tx);
    Ok(())
}

fn build_handshake(stream_id: u16) -> Vec<u8> {
    match stream_id {
        WS_STREAM_CONTROL => vec![HANDSHAKE_CONTROL],
        WS_STREAM_SYNC => vec![HANDSHAKE_SYNC],
        conversation_stream_id => {
            let conv_idx = u64::from(conversation_stream_id.saturating_sub(1));
            let mut handshake = vec![HANDSHAKE_CONVERSATION];
            handshake.extend_from_slice(&conv_idx.to_be_bytes());
            handshake
        }
    }
}

fn spawn_incoming_stream_acceptor(
    session: Session,
    senders: Arc<Mutex<HashMap<u16, SharedSendStream>>>,
    frame_tx: mpsc::UnboundedSender<ReceivedFrame>,
    opened_stream_tx: mpsc::UnboundedSender<u16>,
) {
    tokio::spawn(async move {
        loop {
            let (send, mut recv) = match session.accept_bi().await {
                Ok(pair) => pair,
                Err(_) => break,
            };

            let stream_id = match read_incoming_stream_id(&mut recv).await {
                Ok(stream_id) => stream_id,
                Err(_) => continue,
            };

            senders
                .lock()
                .await
                .entry(stream_id)
                .or_insert_with(|| Arc::new(Mutex::new(send)));

            let _ = opened_stream_tx.send(stream_id);
            spawn_stream_reader(stream_id, recv, frame_tx.clone());
        }
    });
}

async fn read_incoming_stream_id(
    recv: &mut RecvStream,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let mut stream_type = [0u8; 1];
    recv.read_exact(&mut stream_type).await?;

    let stream_id = match stream_type[0] {
        HANDSHAKE_SYNC => WS_STREAM_SYNC,
        HANDSHAKE_CONVERSATION => {
            let mut idx = [0u8; 8];
            recv.read_exact(&mut idx).await?;
            conversation_stream_id_from_index(u64::from_be_bytes(idx))
        }
        other => {
            return Err(format!("unexpected server stream handshake byte 0x{other:02x}").into());
        }
    };

    Ok(stream_id)
}

fn spawn_datagram_reader(session: Session, frame_tx: mpsc::UnboundedSender<ReceivedFrame>) {
    tokio::spawn(async move {
        loop {
            let data = match session.read_datagram().await {
                Ok(data) => data,
                Err(_) => break,
            };

            let mut buf = BytesMut::from(&data[..]);
            if let Ok(frame) = Frame::decode(&mut buf) {
                if frame_tx
                    .send(ReceivedFrame {
                        stream_id: WS_STREAM_CONTROL,
                        frame,
                    })
                    .is_err()
                {
                    break;
                }
            }
        }
    });
}

fn spawn_stream_reader(
    stream_id: u16,
    mut recv: RecvStream,
    frame_tx: mpsc::UnboundedSender<ReceivedFrame>,
) {
    tokio::spawn(async move {
        loop {
            let frame = match read_length_prefixed_frame(&mut recv).await {
                Ok(frame) => frame,
                Err(_) => break,
            };

            if frame_tx.send(ReceivedFrame { stream_id, frame }).is_err() {
                break;
            }
        }
    });
}

async fn read_length_prefixed_frame(
    recv: &mut RecvStream,
) -> Result<Frame, Box<dyn std::error::Error + Send + Sync>> {
    let mut len_buf = [0u8; STREAM_LENGTH_PREFIX_SIZE];
    recv.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;

    if len > 16 * 1024 * 1024 {
        return Err("frame too large".into());
    }

    let mut data = vec![0u8; len];
    recv.read_exact(&mut data).await?;
    let mut buf = BytesMut::from(&data[..]);
    Ok(Frame::decode(&mut buf)?)
}

async fn write_length_prefixed_frame(
    send: &mut SendStream,
    frame: &Frame,
) -> Result<(), Box<dyn std::error::Error>> {
    let encoded = frame.encode();
    let mut packet = BytesMut::with_capacity(STREAM_LENGTH_PREFIX_SIZE + encoded.len());
    packet.put_u32(encoded.len() as u32);
    packet.extend_from_slice(&encoded);
    send.write_all(&packet).await?;
    Ok(())
}

fn conversation_stream_id_from_index(conv_idx: u64) -> u16 {
    conv_idx
        .saturating_add(1)
        .min(u64::from(WS_STREAM_SYNC - 1)) as u16
}

pub fn conversation_stream_id(conversation_id: &str) -> u16 {
    let uuid = uuid::Uuid::parse_str(conversation_id).unwrap_or_default();
    let bytes = uuid.as_bytes();
    let candidate = u16::from_be_bytes([bytes[0], bytes[1]]);

    match candidate {
        WS_STREAM_CONTROL => 1,
        WS_STREAM_SYNC => WS_STREAM_SYNC - 1,
        valid => valid,
    }
}
