use integration_tests::fixtures::{
    random_channel_name, random_email, random_name, random_workspace_name,
};
use integration_tests::http_client::HttpTestClient;
use integration_tests::ws_client::WsTestClient;
use wire_protocol::frames;

#[tokio::test]
async fn auth_then_subscribe_produces_auth_ack_and_subscribe_ack() {
    // Register and create a workspace + channel to subscribe to
    let mut http = HttpTestClient::new();
    let email = random_email();
    let name = random_name();
    http.register(&email, "Str0ngP@ss!", &name)
        .await
        .expect("register should succeed");

    let ws = http
        .create_workspace(&random_workspace_name())
        .await
        .expect("create workspace should succeed");

    let channel = http
        .create_channel(&ws.workspace_id, &random_channel_name(), "public")
        .await
        .expect("create channel should succeed");

    let token = http.token.as_deref().expect("must have token");

    // Connect via WebSocket, authenticate, subscribe
    let mut ws_client = WsTestClient::connect()
        .await
        .expect("WS connect should succeed");

    ws_client
        .authenticate(token)
        .await
        .expect("authenticate should succeed");

    let (_stream_id, auth_ack) = ws_client
        .recv_frame_of_type(frames::AUTH_RESPONSE, 5000)
        .await
        .expect("should receive AUTH_RESPONSE frame");
    assert_eq!(auth_ack.frame_type(), frames::AUTH_RESPONSE);

    ws_client
        .subscribe(&[&channel.channel_id], Some(&ws.workspace_id))
        .await
        .expect("subscribe should succeed");

    let (_stream_id, sub_ack) = ws_client
        .recv_frame_of_type(frames::SUBSCRIBE_ACK, 5000)
        .await
        .expect("should receive SUBSCRIBE_ACK frame");
    assert_eq!(sub_ack.frame_type(), frames::SUBSCRIBE_ACK);

    ws_client.close().await.expect("close should succeed");
}

#[tokio::test]
async fn unauthenticated_subscribe_returns_error() {
    let mut ws_client = WsTestClient::connect()
        .await
        .expect("WS connect should succeed");

    // Send subscribe without authenticating first
    ws_client
        .subscribe(&["nonexistent-channel"], None)
        .await
        .expect("subscribe send should succeed");

    let (_stream_id, error_frame) = ws_client
        .recv_frame_of_type(frames::ERROR, 5000)
        .await
        .expect("should receive ERROR frame");
    assert_eq!(error_frame.frame_type(), frames::ERROR);

    ws_client.close().await.expect("close should succeed");
}
