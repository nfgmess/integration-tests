use bytes::{Bytes, BytesMut};
use futures_util::{SinkExt, StreamExt};
use tokio::time::{timeout, Duration};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use wire_protocol::codec::Frame;
use wire_protocol::decode_payload;
use wire_protocol::frames;

use crate::fixtures::GATEWAY_WS;

pub struct WsTestClient {
    write: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    read: futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
}

impl WsTestClient {
    pub async fn connect() -> Result<Self, Box<dyn std::error::Error>> {
        let (ws_stream, _) = connect_async(GATEWAY_WS).await?;
        let (write, read) = ws_stream.split();
        Ok(Self { write, read })
    }

    pub async fn authenticate(&mut self, token: &str) -> Result<(), Box<dyn std::error::Error>> {
        let payload = rmp_serde::to_vec_named(&serde_json::json!({
            "token": token,
            "device_id": uuid::Uuid::new_v4().to_string(),
            "device_name": "integration-tests"
        }))?;
        let frame = Frame::new(frames::AUTH_REQUEST, 0, Bytes::from(payload));
        self.send_frame(0, &frame).await
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
        self.send_frame(0, &frame).await
    }

    pub async fn send_message(
        &mut self,
        conversation_id: &str,
        content: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let content_bytes = content.as_bytes().to_vec();
        let payload = rmp_serde::to_vec_named(&serde_json::json!({
            "channel_id": conversation_id,
            "content_encrypted": content_bytes,
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
        let content_bytes = content.as_bytes().to_vec();
        let payload = rmp_serde::to_vec_named(&serde_json::json!({
            "channel_id": conversation_id,
            "thread_id": thread_id,
            "content_encrypted": content_bytes,
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
        self.send_frame(0, &frame).await
    }

    async fn send_frame(
        &mut self,
        stream_id: u16,
        frame: &Frame,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let encoded = frame.encode();
        let mut ws_frame = Vec::with_capacity(2 + encoded.len());
        ws_frame.extend_from_slice(&stream_id.to_be_bytes());
        ws_frame.extend_from_slice(&encoded);
        self.write.send(Message::Binary(ws_frame.into())).await?;
        Ok(())
    }

    pub async fn recv_frame(
        &mut self,
        timeout_ms: u64,
    ) -> Result<(u16, Frame), Box<dyn std::error::Error>> {
        let msg = timeout(Duration::from_millis(timeout_ms), self.read.next())
            .await?
            .ok_or("WebSocket closed")??;

        match msg {
            Message::Binary(data) => {
                if data.len() < 2 {
                    return Err("Frame too short".into());
                }
                let stream_id = u16::from_be_bytes([data[0], data[1]]);
                let mut buf = BytesMut::from(&data[2..]);
                let frame = Frame::decode(&mut buf)?;
                Ok((stream_id, frame))
            }
            other => Err(format!("Unexpected message type: {:?}", other).into()),
        }
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
                return Err(format!("Timeout waiting for frame type 0x{:02x}", frame_type).into());
            }
            let (stream_id, frame) = self.recv_frame(remaining.as_millis() as u64).await?;
            if frame.frame_type() == frames::ERROR && frame_type != frames::ERROR {
                let err = decode_payload::<wire_protocol::schema::system::ErrorFrame>(&frame)
                    .map(|payload| format!("{} (code {})", payload.message, payload.code))
                    .unwrap_or_else(|_| "unable to decode error payload".to_string());
                return Err(format!(
                    "Received ERROR frame while waiting for type 0x{:02x}: {}",
                    frame_type, err
                )
                .into());
            }
            if frame.frame_type() == frame_type {
                return Ok((stream_id, frame));
            }
        }
    }

    pub async fn close(mut self) -> Result<(), Box<dyn std::error::Error>> {
        self.write.close().await?;
        Ok(())
    }
}

pub fn conversation_stream_id(conversation_id: &str) -> u16 {
    let uuid = uuid::Uuid::parse_str(conversation_id).unwrap_or_default();
    let bytes = uuid.as_bytes();
    u16::from_be_bytes([bytes[0], bytes[1]])
}
