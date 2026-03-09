use integration_tests::fixtures::{
    random_channel_name, random_email, random_name, random_workspace_name,
};
use integration_tests::http_client::HttpTestClient;
use integration_tests::wt_client::WtTestClient;
use wire_protocol::codec::{WS_STREAM_CONTROL, WS_STREAM_SYNC};
use wire_protocol::frames;
use wire_protocol::schema::sync::HistoryResponse;
use wire_protocol::decode_payload;

#[tokio::test]
async fn auth_then_subscribe_produces_auth_ack_and_subscribe_ack() {
    // Register and create a workspace + channel to subscribe to
    let mut http = HttpTestClient::new();
    let email = random_email();
    let name = random_name();
    http.register_and_login(&email, "Str0ngP@ss!", &name)
        .await
        .expect("register_and_login should succeed");

    let ws = http
        .create_workspace(&random_workspace_name())
        .await
        .expect("create workspace should succeed");

    let channel = http
        .create_channel(&ws.workspace_id, &random_channel_name(), "public")
        .await
        .expect("create channel should succeed");

    let token = http.token.as_deref().expect("must have token");

    // Connect via WebTransport, authenticate, subscribe
    let mut wt_client = WtTestClient::connect()
        .await
        .expect("WebTransport connect should succeed");

    wt_client
        .authenticate(token)
        .await
        .expect("authenticate should succeed");

    let (auth_stream_id, auth_ack) = wt_client
        .recv_frame_of_type(frames::AUTH_RESPONSE, 5000)
        .await
        .expect("should receive AUTH_RESPONSE frame");
    assert_eq!(auth_stream_id, WS_STREAM_CONTROL);
    assert_eq!(auth_ack.frame_type(), frames::AUTH_RESPONSE);

    wt_client
        .subscribe(&[&channel.channel_id], Some(&ws.workspace_id))
        .await
        .expect("subscribe should succeed");

    let (sub_ack_stream_id, sub_ack) = wt_client
        .recv_frame_of_type(frames::SUBSCRIBE_ACK, 5000)
        .await
        .expect("should receive SUBSCRIBE_ACK frame");
    assert_eq!(sub_ack_stream_id, WS_STREAM_CONTROL);
    assert_eq!(sub_ack.frame_type(), frames::SUBSCRIBE_ACK);

    let opened_stream_id = wt_client
        .recv_opened_stream(5000)
        .await
        .expect("server should open a dedicated conversation stream");
    assert_ne!(opened_stream_id, WS_STREAM_CONTROL);
    assert_ne!(opened_stream_id, WS_STREAM_SYNC);

    wt_client.close().await.expect("close should succeed");
}

#[tokio::test]
async fn unauthenticated_subscribe_returns_error() {
    let mut wt_client = WtTestClient::connect()
        .await
        .expect("WebTransport connect should succeed");

    // Send subscribe without authenticating first
    wt_client
        .subscribe(&["nonexistent-channel"], None)
        .await
        .expect("subscribe send should succeed");

    let (error_stream_id, error_frame) = wt_client
        .recv_frame_of_type(frames::ERROR, 5000)
        .await
        .expect("should receive ERROR frame");
    assert_eq!(error_stream_id, WS_STREAM_CONTROL);
    assert_eq!(error_frame.frame_type(), frames::ERROR);

    wt_client.close().await.expect("close should succeed");
}

#[tokio::test]
async fn history_request_uses_sync_stream() {
    let mut http = HttpTestClient::new();
    let email = random_email();
    let name = random_name();
    http.register_and_login(&email, "Str0ngP@ss!", &name)
        .await
        .expect("register_and_login should succeed");

    let ws = http
        .create_workspace(&random_workspace_name())
        .await
        .expect("create workspace should succeed");

    let channel = http
        .create_channel(&ws.workspace_id, &random_channel_name(), "public")
        .await
        .expect("create channel should succeed");

    let token = http.token.as_deref().expect("must have token");

    let mut wt_client = WtTestClient::connect()
        .await
        .expect("WebTransport connect should succeed");
    wt_client.authenticate(token).await.expect("authenticate should succeed");
    wt_client
        .recv_frame_of_type(frames::AUTH_RESPONSE, 5000)
        .await
        .expect("should receive AUTH_RESPONSE");

    wt_client
        .request_history(&channel.channel_id, 0, 10)
        .await
        .expect("history request should succeed");

    let (stream_id, history_response) = wt_client
        .recv_frame_of_type(frames::HISTORY_RESPONSE, 5000)
        .await
        .expect("should receive HISTORY_RESPONSE");
    assert_eq!(stream_id, WS_STREAM_SYNC);

    let payload: HistoryResponse =
        decode_payload(&history_response).expect("history response payload should decode");
    assert_eq!(payload.conversation_id, channel.channel_id);

    wt_client.close().await.expect("close should succeed");
}
