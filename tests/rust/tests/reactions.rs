use integration_tests::fixtures::{
    random_channel_name, random_email, random_name, random_workspace_name,
};
use integration_tests::http_client::HttpTestClient;
use integration_tests::wt_client::WtTestClient;
use messenger_core::events::payloads::MessageSentPayload;
use wire_protocol::codec::{WS_STREAM_CONTROL, WS_STREAM_SYNC};
use wire_protocol::frames;
use wire_protocol::schema::conversation::EventBatch;
use wire_protocol::decode_payload;

async fn register_user() -> HttpTestClient {
    let mut http = HttpTestClient::new();
    http.register_and_login(&random_email(), "Str0ngP@ss!", &random_name())
        .await
        .expect("register_and_login should succeed");
    http
}

#[tokio::test]
async fn send_reaction_subscriber_receives_event_batch() {
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

    // Seed a real message first; reactions require a valid ULID-backed message_id.
    ws_a.send_message(&channel.channel_id, "Seed message for reactions")
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

    ws_a.send_reaction(
        &channel.channel_id,
        &seed_message.message_id.to_string(),
        "fire",
        "add",
    )
    .await
    .expect("send reaction should succeed");

    // User B should receive an EVENT_BATCH with the reaction event
    let (stream_id, event_batch) = ws_b
        .recv_frame_of_type(frames::EVENT_BATCH, 5000)
        .await
        .expect("B should receive EVENT_BATCH for reaction");
    assert_ne!(stream_id, WS_STREAM_CONTROL);
    assert_ne!(stream_id, WS_STREAM_SYNC);
    assert_eq!(event_batch.frame_type(), frames::EVENT_BATCH);

    ws_a.close().await.expect("close A");
    ws_b.close().await.expect("close B");
}
