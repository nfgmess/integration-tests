use integration_tests::fixtures::{random_email, random_name, random_workspace_name};
use integration_tests::http_client::HttpTestClient;

async fn authenticated_client() -> HttpTestClient {
    let mut client = HttpTestClient::new();
    let email = random_email();
    let name = random_name();
    client
        .register(&email, "Str0ngP@ss!", &name)
        .await
        .expect("register should succeed");
    client
}

#[tokio::test]
async fn create_workspace_returns_workspace_id_and_name() {
    let client = authenticated_client().await;
    let ws_name = random_workspace_name();

    let resp = client
        .create_workspace(&ws_name)
        .await
        .expect("create workspace should succeed");

    assert!(!resp.workspace_id.is_empty(), "workspace_id must be non-empty");
    assert_eq!(resp.name, ws_name);
}

#[tokio::test]
async fn list_workspaces_includes_created_workspace() {
    let client = authenticated_client().await;
    let ws_name = random_workspace_name();

    let created = client
        .create_workspace(&ws_name)
        .await
        .expect("create workspace should succeed");

    let workspaces = client
        .list_workspaces()
        .await
        .expect("list workspaces should succeed");

    let found = workspaces
        .iter()
        .any(|w| w.workspace_id == created.workspace_id);

    assert!(found, "created workspace must appear in the list");
}

#[tokio::test]
async fn create_workspace_auto_creates_general_channel() {
    let client = authenticated_client().await;
    let ws_name = random_workspace_name();

    let ws = client
        .create_workspace(&ws_name)
        .await
        .expect("create workspace should succeed");

    let channels = client
        .list_channels(&ws.workspace_id)
        .await
        .expect("list channels should succeed");

    let general = channels.iter().find(|c| c.name == "general");
    assert!(
        general.is_some(),
        "workspace must have an auto-created #general channel"
    );
}
