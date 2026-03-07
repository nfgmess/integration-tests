use integration_tests::fixtures::{random_email, random_name};
use integration_tests::http_client::HttpTestClient;

#[tokio::test]
async fn register_creates_user_and_returns_tokens() {
    let mut client = HttpTestClient::new();
    let email = random_email();
    let name = random_name();

    let resp = client
        .register(&email, "Str0ngP@ss!", &name)
        .await
        .expect("register should succeed");

    assert!(!resp.access_token.is_empty(), "access_token must be non-empty");
    assert!(!resp.refresh_token.is_empty(), "refresh_token must be non-empty");
    assert!(!resp.user_id.is_empty(), "user_id must be non-empty");
}

#[tokio::test]
async fn register_duplicate_email_fails() {
    let mut client = HttpTestClient::new();
    let email = random_email();
    let name = random_name();

    client
        .register(&email, "Str0ngP@ss!", &name)
        .await
        .expect("first register should succeed");

    let mut client2 = HttpTestClient::new();
    let result = client2.register(&email, "Str0ngP@ss!", &name).await;

    assert!(result.is_err(), "duplicate email registration must fail");
}

#[tokio::test]
async fn login_with_valid_credentials_returns_tokens() {
    let mut client = HttpTestClient::new();
    let email = random_email();
    let name = random_name();
    let password = "Str0ngP@ss!";

    client
        .register(&email, password, &name)
        .await
        .expect("register should succeed");

    let mut login_client = HttpTestClient::new();
    let resp = login_client
        .login(&email, password)
        .await
        .expect("login should succeed");

    assert!(!resp.access_token.is_empty());
    assert!(!resp.refresh_token.is_empty());
    assert!(!resp.user_id.is_empty());
}

#[tokio::test]
async fn login_with_wrong_password_fails() {
    let mut client = HttpTestClient::new();
    let email = random_email();
    let name = random_name();

    client
        .register(&email, "Str0ngP@ss!", &name)
        .await
        .expect("register should succeed");

    let mut login_client = HttpTestClient::new();
    let result = login_client.login(&email, "WrongPassword!").await;

    assert!(result.is_err(), "login with wrong password must fail");
}

#[tokio::test]
async fn refresh_token_returns_new_access_token() {
    let mut client = HttpTestClient::new();
    let email = random_email();
    let name = random_name();

    let register_resp = client
        .register(&email, "Str0ngP@ss!", &name)
        .await
        .expect("register should succeed");

    let old_access_token = register_resp.access_token.clone();
    let refresh = register_resp.refresh_token.clone();

    let refresh_resp = client
        .refresh_token(&refresh)
        .await
        .expect("refresh should succeed");

    assert_ne!(
        refresh_resp.access_token, old_access_token,
        "refreshed access_token must differ from the original"
    );
}

#[tokio::test]
async fn protected_endpoint_without_token_returns_401() {
    let client = HttpTestClient::new(); // no token set

    let resp = client
        .get_raw("/workspaces")
        .await
        .expect("request should complete");

    assert_eq!(
        resp.status().as_u16(),
        401,
        "unauthenticated request must return 401"
    );
}
