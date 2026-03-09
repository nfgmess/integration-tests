use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::{sleep, Duration};

use crate::fixtures::API_BASE;

const AUTH_RATE_LIMIT_RETRIES: usize = 10;
const AUTH_RATE_LIMIT_DELAY: Duration = Duration::from_millis(1_100);
const AUTH_RATE_LIMIT_BUFFER: Duration = Duration::from_secs(1);
const AUTH_RATE_LIMIT_MAX_DELAY: Duration = Duration::from_secs(95);

#[derive(Debug, Clone)]
pub struct HttpTestClient {
    client: Client,
    pub token: Option<String>,
    pub user_id: Option<String>,
    pub base_url: String,
}

#[derive(Debug, Serialize)]
struct RegisterRequest {
    email: String,
    password: String,
    display_name: String,
}

#[derive(Debug, Serialize)]
struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub refresh_token: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub device_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterResponse {
    pub user_id: String,
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct WorkspaceResponse {
    #[serde(alias = "id")]
    pub workspace_id: String,
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Deserialize)]
pub struct ChannelResponse {
    pub channel_id: String,
    pub name: String,
    pub channel_type: String,
}

impl HttpTestClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            token: None,
            user_id: None,
            base_url: API_BASE.to_string(),
        }
    }

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.token.as_deref().unwrap_or(""))
    }

    async fn send_with_rate_limit_retry<F>(
        &self,
        mut build: F,
    ) -> Result<reqwest::Response, reqwest::Error>
    where
        F: FnMut() -> reqwest::RequestBuilder,
    {
        for attempt in 0..AUTH_RATE_LIMIT_RETRIES {
            let resp = build().send().await?;
            if resp.status().as_u16() != 429 {
                return resp.error_for_status();
            }

            if attempt + 1 == AUTH_RATE_LIMIT_RETRIES {
                return resp.error_for_status();
            }

            let header_value = resp
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let body = resp.text().await.unwrap_or_default();
            sleep(resolve_rate_limit_delay(
                header_value.as_deref(),
                &body,
                attempt,
            ))
            .await;
        }

        unreachable!("auth retry loop must return before exhausting")
    }

    pub async fn register(
        &mut self,
        email: &str,
        password: &str,
        display_name: &str,
    ) -> Result<RegisterResponse, reqwest::Error> {
        let resp = self
            .send_with_rate_limit_retry(|| {
                self.client
                    .post(format!("{}/auth/register", self.base_url))
                    .json(&RegisterRequest {
                        email: email.to_string(),
                        password: password.to_string(),
                        display_name: display_name.to_string(),
                    })
            })
            .await?
            .json::<RegisterResponse>()
            .await?;
        Ok(resp)
    }

    pub async fn register_and_login(
        &mut self,
        email: &str,
        password: &str,
        display_name: &str,
    ) -> Result<AuthResponse, reqwest::Error> {
        self.register(email, password, display_name).await?;
        self.login(email, password).await
    }

    pub async fn login(
        &mut self,
        email: &str,
        password: &str,
    ) -> Result<AuthResponse, reqwest::Error> {
        let resp = self
            .send_with_rate_limit_retry(|| {
                self.client
                    .post(format!("{}/auth/login", self.base_url))
                    .json(&LoginRequest {
                        email: email.to_string(),
                        password: password.to_string(),
                    })
            })
            .await?
            .json::<AuthResponse>()
            .await?;
        self.token = Some(resp.token.clone());
        self.user_id = Some(resp.user_id.clone());
        Ok(resp)
    }

    pub async fn refresh_token(
        &mut self,
        refresh_token: &str,
    ) -> Result<AuthResponse, reqwest::Error> {
        let resp = self
            .send_with_rate_limit_retry(|| {
                self.client
                    .post(format!("{}/auth/refresh", self.base_url))
                    .json(&serde_json::json!({ "refresh_token": refresh_token }))
            })
            .await?
            .json::<AuthResponse>()
            .await?;
        self.token = Some(resp.token.clone());
        Ok(resp)
    }

    pub async fn create_workspace(&self, name: &str) -> Result<WorkspaceResponse, reqwest::Error> {
        self.client
            .post(format!("{}/workspaces", self.base_url))
            .header("Authorization", self.auth_header())
            .json(&serde_json::json!({ "name": name }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn list_workspaces(&self) -> Result<Vec<WorkspaceResponse>, reqwest::Error> {
        self.client
            .get(format!("{}/workspaces", self.base_url))
            .header("Authorization", self.auth_header())
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn create_channel(
        &self,
        workspace_id: &str,
        name: &str,
        channel_type: &str,
    ) -> Result<ChannelResponse, reqwest::Error> {
        self.client
            .post(format!(
                "{}/workspaces/{}/channels",
                self.base_url, workspace_id
            ))
            .header("Authorization", self.auth_header())
            .json(&serde_json::json!({
                "name": name,
                "channel_type": channel_type,
                "description": ""
            }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn list_channels(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<ChannelResponse>, reqwest::Error> {
        self.client
            .get(format!(
                "{}/workspaces/{}/channels",
                self.base_url, workspace_id
            ))
            .header("Authorization", self.auth_header())
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn join_channel(&self, channel_id: &str) -> Result<(), reqwest::Error> {
        self.client
            .post(format!("{}/channels/{}/join", self.base_url, channel_id))
            .header("Authorization", self.auth_header())
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn leave_channel(&self, channel_id: &str) -> Result<(), reqwest::Error> {
        self.client
            .post(format!("{}/channels/{}/leave", self.base_url, channel_id))
            .header("Authorization", self.auth_header())
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn create_dm(
        &self,
        workspace_id: &str,
        user_ids: &[&str],
    ) -> Result<ChannelResponse, reqwest::Error> {
        self.client
            .post(format!("{}/workspaces/{}/dm", self.base_url, workspace_id))
            .header("Authorization", self.auth_header())
            .json(&serde_json::json!({ "user_ids": user_ids }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn create_invite(&self, workspace_id: &str) -> Result<Value, reqwest::Error> {
        self.client
            .post(format!(
                "{}/workspaces/{}/invite",
                self.base_url, workspace_id
            ))
            .header("Authorization", self.auth_header())
            .json(&serde_json::json!({}))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn accept_invite(
        &self,
        workspace_id: &str,
        invite_code: &str,
    ) -> Result<Value, reqwest::Error> {
        self.client
            .post(format!(
                "{}/workspaces/{}/join",
                self.base_url, workspace_id
            ))
            .header("Authorization", self.auth_header())
            .json(&serde_json::json!({ "code": invite_code }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn get_raw(&self, path: &str) -> Result<reqwest::Response, reqwest::Error> {
        self.client
            .get(format!("{}{}", self.base_url, path))
            .header("Authorization", self.auth_header())
            .send()
            .await
    }

    pub async fn post_raw(
        &self,
        path: &str,
        body: &Value,
    ) -> Result<reqwest::Response, reqwest::Error> {
        self.client
            .post(format!("{}{}", self.base_url, path))
            .header("Authorization", self.auth_header())
            .json(body)
            .send()
            .await
    }
}

fn parse_retry_after_header(value: &str) -> Option<Duration> {
    value.parse::<u64>().ok().map(Duration::from_secs)
}

fn parse_retry_after_body(body: &str) -> Option<Duration> {
    let body = body.to_ascii_lowercase();
    let wait_idx = body.find("wait for ")?;
    let suffix = &body[wait_idx + "wait for ".len()..];

    let digits_end = suffix.find(|c: char| !c.is_ascii_digit()).unwrap_or(suffix.len());
    if digits_end == 0 {
        return None;
    }

    let amount = suffix[..digits_end].parse::<u64>().ok()?;
    let unit = suffix[digits_end..].trim_start();

    if unit.starts_with("ms") || unit.starts_with("millisecond") {
        return Some(Duration::from_millis(amount));
    }

    Some(Duration::from_secs(amount))
}

fn resolve_rate_limit_delay(header: Option<&str>, body: &str, attempt: usize) -> Duration {
    let header_delay = header
        .and_then(parse_retry_after_header)
        .unwrap_or(Duration::ZERO);
    let body_delay = parse_retry_after_body(body).unwrap_or(Duration::ZERO);
    let fallback_delay = AUTH_RATE_LIMIT_DELAY.saturating_mul((attempt as u32) + 1);

    std::cmp::min(
        AUTH_RATE_LIMIT_MAX_DELAY,
        std::cmp::max(header_delay, std::cmp::max(body_delay, fallback_delay))
            + AUTH_RATE_LIMIT_BUFFER,
    )
}
