use integration_tests::fixtures::{
    random_channel_name, random_email, random_name, random_workspace_name,
};
use integration_tests::http_client::HttpTestClient;
use integration_tests::wt_client::WtTestClient;
use messenger_core::events::payloads::MessageSentPayload;
use tokio::time::{sleep, Duration};
use wire_protocol::codec::{WS_STREAM_CONTROL, WS_STREAM_SYNC};
use wire_protocol::frames;
use wire_protocol::schema::conversation::EventBatch;
use wire_protocol::schema::sync::HistoryResponse;
use wire_protocol::decode_payload;

async fn register_user() -> HttpTestClient {
    let mut http = HttpTestClient::new();
    http.register_and_login(&random_email(), "Str0ngP@ss!", &random_name())
        .await
        .expect("register_and_login should succeed");
    http
}

#[tokio::test]
async fn send_thread_reply_subscriber_receives_event_batch() {
    // User A: create workspace + channel
    let user_a = register_user().await;
    let ws = user_a
        .create_workspace(&random_workspace_name())
        .await
        .expect("create workspace should succeed");

    let channel = user_a
        .create_channel(&ws.workspace_id, &random_channel_name(), "public")
        .await
        .expect("create channel should succeed");

    // User B: register and join workspace + channel
    let user_b = register_user().await;
    let invite = user_a
        .create_invite(&ws.workspace_id)
        .await
        .expect("create invite should succeed");
    let invite_code = invite["code"]
        .as_str()
        .expect("invite must have a code field");
    user_b
        .accept_invite(&ws.workspace_id, invite_code)
        .await
        .expect("accept invite should succeed");
    user_b
        .join_channel(&channel.channel_id)
        .await
        .expect("join channel should succeed");

    let token_a = user_a.token.as_deref().expect("user_a must have token");
    let token_b = user_b.token.as_deref().expect("user_b must have token");

    // Both connect via WebTransport, authenticate, subscribe
    let mut ws_a = WtTestClient::connect()
        .await
        .expect("WebTransport connect A should succeed");
    ws_a.authenticate(token_a).await.expect("auth A");
    ws_a.recv_frame_of_type(frames::AUTH_RESPONSE, 5000)
        .await
        .expect("A AUTH_RESPONSE");
    ws_a.subscribe(&[&channel.channel_id], Some(&ws.workspace_id))
        .await
        .expect("subscribe A");
    ws_a.recv_frame_of_type(frames::SUBSCRIBE_ACK, 5000)
        .await
        .expect("A SUBSCRIBE_ACK");

    let mut ws_b = WtTestClient::connect()
        .await
        .expect("WebTransport connect B should succeed");
    ws_b.authenticate(token_b).await.expect("auth B");
    ws_b.recv_frame_of_type(frames::AUTH_RESPONSE, 5000)
        .await
        .expect("B AUTH_RESPONSE");
    ws_b.subscribe(&[&channel.channel_id], Some(&ws.workspace_id))
        .await
        .expect("subscribe B");
    ws_b.recv_frame_of_type(frames::SUBSCRIBE_ACK, 5000)
        .await
        .expect("B SUBSCRIBE_ACK");

    // Seed a real parent message first; thread replies require a valid ULID thread root.
    ws_a.send_message(&channel.channel_id, "Parent message for thread")
        .await
        .expect("seed message should succeed");

    let (seed_stream_id, seed_batch) = ws_b
        .recv_frame_of_type(frames::EVENT_BATCH, 5000)
        .await
        .expect("B should receive EVENT_BATCH for seeded message");
    assert_ne!(seed_stream_id, WS_STREAM_CONTROL);
    assert_ne!(seed_stream_id, WS_STREAM_SYNC);

    let seed_batch: EventBatch =
        decode_payload(&seed_batch).expect("seed EVENT_BATCH payload should decode");
    let seed_event = seed_batch
        .events
        .first()
        .expect("seed EVENT_BATCH should contain one message event");
    let seed_message: MessageSentPayload =
        rmp_serde::from_slice(&seed_event.payload).expect("seed message payload should decode");

    ws_a.send_thread_reply(
        &channel.channel_id,
        &seed_message.message_id.to_string(),
        "Thread reply from A",
    )
        .await
        .expect("send thread reply should succeed");

    // User B should receive an EVENT_BATCH with the thread reply event
    let (stream_id, event_batch) = ws_b
        .recv_frame_of_type(frames::EVENT_BATCH, 5000)
        .await
        .expect("B should receive EVENT_BATCH for thread reply");
    assert_ne!(stream_id, WS_STREAM_CONTROL);
    assert_ne!(stream_id, WS_STREAM_SYNC);
    assert_eq!(event_batch.frame_type(), frames::EVENT_BATCH);

    ws_a.close().await.expect("close A");
    ws_b.close().await.expect("close B");
}

#[tokio::test]
async fn thread_history_is_separate_from_channel_history() {
    let user = register_user().await;
    let ws = user
        .create_workspace(&random_workspace_name())
        .await
        .expect("create workspace should succeed");

    let channel = user
        .create_channel(&ws.workspace_id, &random_channel_name(), "public")
        .await
        .expect("create channel should succeed");

    let token = user.token.as_deref().expect("user must have token");

    let mut wt = WtTestClient::connect()
        .await
        .expect("WebTransport connect should succeed");
    wt.authenticate(token).await.expect("auth should succeed");
    wt.recv_frame_of_type(frames::AUTH_RESPONSE, 5000)
        .await
        .expect("AUTH_RESPONSE");
    wt.subscribe(&[&channel.channel_id], Some(&ws.workspace_id))
        .await
        .expect("subscribe should succeed");
    wt.recv_frame_of_type(frames::SUBSCRIBE_ACK, 5000)
        .await
        .expect("SUBSCRIBE_ACK");

    wt.send_message(&channel.channel_id, "Parent for persisted thread")
        .await
        .expect("send parent message should succeed");
    let (_, parent_batch) = wt
        .recv_frame_of_type(frames::EVENT_BATCH, 5000)
        .await
        .expect("should receive parent EVENT_BATCH");
    let parent_batch: EventBatch =
        decode_payload(&parent_batch).expect("parent EVENT_BATCH should decode");
    let parent_event = parent_batch.events.first().expect("parent event should exist");
    let parent_message: MessageSentPayload =
        rmp_serde::from_slice(&parent_event.payload).expect("parent payload should decode");

    wt.send_thread_reply(
        &channel.channel_id,
        &parent_message.message_id.to_string(),
        "Persisted thread reply",
    )
    .await
    .expect("send thread reply should succeed");
    let (_, reply_batch) = wt
        .recv_frame_of_type(frames::EVENT_BATCH, 5000)
        .await
        .expect("should receive thread reply EVENT_BATCH");
    let reply_batch: EventBatch =
        decode_payload(&reply_batch).expect("reply EVENT_BATCH should decode");
    let reply_event = reply_batch.events.first().expect("reply event should exist");
    let reply_message: MessageSentPayload =
        rmp_serde::from_slice(&reply_event.payload).expect("reply payload should decode");
    let parent_thread_id = parent_message.message_id.to_string();

    let mut channel_history_ok = false;
    let mut thread_history_ok = false;

    for _ in 0..10 {
        wt.request_history(&channel.channel_id, 0, 20)
            .await
            .expect("channel history request should succeed");
        let (channel_history_stream, channel_history_frame) = wt
            .recv_frame_of_type(frames::HISTORY_RESPONSE, 5000)
            .await
            .expect("should receive channel HISTORY_RESPONSE");
        assert_eq!(channel_history_stream, WS_STREAM_SYNC);
        let channel_history: HistoryResponse =
            decode_payload(&channel_history_frame).expect("channel history should decode");

        let channel_messages: Vec<MessageSentPayload> = channel_history
            .events
            .iter()
            .map(|event| rmp_serde::from_slice(&event.payload).expect("channel history payload should decode"))
            .collect();

        channel_history_ok = channel_history.thread_id.is_none()
            && channel_messages
                .iter()
                .any(|message| {
                    message.message_id == parent_message.message_id
                        && message.reply_count == Some(1)
                })
            && channel_messages
                .iter()
                .all(|message| message.thread_id.is_none());

        wt.request_thread_history(&channel.channel_id, &parent_thread_id, 0, 20)
            .await
            .expect("thread history request should succeed");
        let (thread_history_stream, thread_history_frame) = wt
            .recv_frame_of_type(frames::HISTORY_RESPONSE, 5000)
            .await
            .expect("should receive thread HISTORY_RESPONSE");
        assert_eq!(thread_history_stream, WS_STREAM_SYNC);
        let thread_history: HistoryResponse =
            decode_payload(&thread_history_frame).expect("thread history should decode");

        let thread_messages: Vec<MessageSentPayload> = thread_history
            .events
            .iter()
            .map(|event| rmp_serde::from_slice(&event.payload).expect("thread history payload should decode"))
            .collect();

        thread_history_ok = thread_history.thread_id.as_deref()
            == Some(parent_thread_id.as_str())
            && thread_messages
                .iter()
                .any(|message| message.message_id == reply_message.message_id)
            && thread_messages
                .iter()
                .all(|message| message.thread_id == Some(parent_message.message_id));

        if channel_history_ok && thread_history_ok {
            break;
        }

        sleep(Duration::from_millis(250)).await;
    }

    assert!(channel_history_ok, "channel history should include only root messages");
    assert!(thread_history_ok, "thread history should include persisted thread replies");

    wt.close().await.expect("close should succeed");
}
