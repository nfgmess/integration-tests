use integration_tests::fixtures::{
    random_channel_name, random_email, random_name, random_workspace_name,
};
use integration_tests::http_client::HttpTestClient;

async fn setup_workspace() -> (HttpTestClient, String) {
    let mut client = HttpTestClient::new();
    let email = random_email();
    let name = random_name();
    client
        .register_and_login(&email, "Str0ngP@ss!", &name)
        .await
        .expect("register_and_login should succeed");

    let ws_name = random_workspace_name();
    let ws = client
        .create_workspace(&ws_name)
        .await
        .expect("create workspace should succeed");

    (client, ws.workspace_id)
}

#[tokio::test]
async fn create_public_channel_returns_channel_id_with_type_public() {
    let (client, workspace_id) = setup_workspace().await;
    let ch_name = random_channel_name();

    let resp = client
        .create_channel(&workspace_id, &ch_name, "public")
        .await
        .expect("create public channel should succeed");

    assert!(!resp.channel_id.is_empty(), "channel_id must be non-empty");
    assert_eq!(resp.channel_type, "public");
}

#[tokio::test]
async fn create_private_channel_returns_type_private() {
    let (client, workspace_id) = setup_workspace().await;
    let ch_name = random_channel_name();

    let resp = client
        .create_channel(&workspace_id, &ch_name, "private")
        .await
        .expect("create private channel should succeed");

    assert_eq!(resp.channel_type, "private");
}

#[tokio::test]
async fn list_channels_includes_created_channel() {
    let (client, workspace_id) = setup_workspace().await;
    let ch_name = random_channel_name();

    let created = client
        .create_channel(&workspace_id, &ch_name, "public")
        .await
        .expect("create channel should succeed");

    let channels = client
        .list_channels(&workspace_id)
        .await
        .expect("list channels should succeed");

    let found = channels.iter().any(|c| c.channel_id == created.channel_id);
    assert!(found, "created channel must appear in the list");
}

#[tokio::test]
async fn join_and_leave_channel() {
    let (owner, workspace_id) = setup_workspace().await;
    let ch_name = random_channel_name();

    let channel = owner
        .create_channel(&workspace_id, &ch_name, "public")
        .await
        .expect("create channel should succeed");

    // Create invite for the workspace
    let invite = owner
        .create_invite(&workspace_id)
        .await
        .expect("create invite should succeed");
    let invite_code = invite["code"]
        .as_str()
        .expect("invite must have a code field");

    // Register a second user and accept the invite
    let mut user2 = HttpTestClient::new();
    user2
        .register_and_login(&random_email(), "Str0ngP@ss!", &random_name())
        .await
        .expect("register_and_login second user should succeed");

    user2
        .accept_invite(invite_code)
        .await
        .expect("accept invite should succeed");

    // Second user joins and leaves the channel
    user2
        .join_channel(&channel.channel_id)
        .await
        .expect("join channel should succeed");

    user2
        .leave_channel(&channel.channel_id)
        .await
        .expect("leave channel should succeed");
}

#[tokio::test]
async fn create_dm_between_two_workspace_members() {
    let (owner, workspace_id) = setup_workspace().await;

    // Create invite
    let invite = owner
        .create_invite(&workspace_id)
        .await
        .expect("create invite should succeed");
    let invite_code = invite["code"]
        .as_str()
        .expect("invite must have a code field");

    // Register second user and accept invite
    let mut user2 = HttpTestClient::new();
    user2
        .register_and_login(&random_email(), "Str0ngP@ss!", &random_name())
        .await
        .expect("register_and_login second user should succeed");

    user2
        .accept_invite(invite_code)
        .await
        .expect("accept invite should succeed");

    let user2_id = user2.user_id.as_deref().expect("user2 must have user_id");

    let dm = owner
        .create_dm(&workspace_id, &[user2_id])
        .await
        .expect("create DM should succeed");

    assert!(!dm.channel_id.is_empty(), "DM channel_id must be non-empty");
}
