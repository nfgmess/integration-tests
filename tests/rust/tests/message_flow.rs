use integration_tests::fixtures::{
    random_channel_name, random_email, random_name, random_workspace_name,
};
use integration_tests::http_client::HttpTestClient;
use integration_tests::wt_client::WtTestClient;
use wire_protocol::codec::{WS_STREAM_CONTROL, WS_STREAM_SYNC};
use wire_protocol::frames;

/// Helper: register user, create or join workspace, return (http_client, token)
async fn register_user() -> HttpTestClient {
    let mut http = HttpTestClient::new();
    http.register_and_login(&random_email(), "Str0ngP@ss!", &random_name())
        .await
        .expect("register_and_login should succeed");
    http
}

#[tokio::test]
async fn sender_sends_message_receiver_gets_event_batch() {
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

    // User B: register and join the workspace via invite
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

    // Connect both users via WebTransport
    let mut ws_a = WtTestClient::connect()
        .await
        .expect("WebTransport connect A should succeed");
    ws_a.authenticate(token_a)
        .await
        .expect("auth A should succeed");
    ws_a.recv_frame_of_type(frames::AUTH_RESPONSE, 5000)
        .await
        .expect("A should receive AUTH_RESPONSE");
    ws_a.subscribe(&[&channel.channel_id], Some(&ws.workspace_id))
        .await
        .expect("subscribe A should succeed");
    ws_a.recv_frame_of_type(frames::SUBSCRIBE_ACK, 5000)
        .await
        .expect("A should receive SUBSCRIBE_ACK");

    let mut ws_b = WtTestClient::connect()
        .await
        .expect("WebTransport connect B should succeed");
    ws_b.authenticate(token_b)
        .await
        .expect("auth B should succeed");
    ws_b.recv_frame_of_type(frames::AUTH_RESPONSE, 5000)
        .await
        .expect("B should receive AUTH_RESPONSE");
    ws_b.subscribe(&[&channel.channel_id], Some(&ws.workspace_id))
        .await
        .expect("subscribe B should succeed");
    ws_b.recv_frame_of_type(frames::SUBSCRIBE_ACK, 5000)
        .await
        .expect("B should receive SUBSCRIBE_ACK");

    // User A sends a message
    ws_a.send_message(&channel.channel_id, "Hello from A!")
        .await
        .expect("send message should succeed");

    // User B should receive an EVENT_BATCH
    let (stream_id, event_batch) = ws_b
        .recv_frame_of_type(frames::EVENT_BATCH, 5000)
        .await
        .expect("B should receive EVENT_BATCH with the message");
    assert_ne!(stream_id, WS_STREAM_CONTROL);
    assert_ne!(stream_id, WS_STREAM_SYNC);
    assert_eq!(event_batch.frame_type(), frames::EVENT_BATCH);

    ws_a.close().await.expect("close A should succeed");
    ws_b.close().await.expect("close B should succeed");
}
