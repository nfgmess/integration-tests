use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::fixtures::API_BASE;

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
    pub user_id: String,
    pub device_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterResponse {
    pub user_id: String,
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct WorkspaceResponse {
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

    pub async fn register(
        &mut self,
        email: &str,
        password: &str,
        display_name: &str,
    ) -> Result<RegisterResponse, reqwest::Error> {
        let resp = self
            .client
            .post(format!("{}/auth/register", self.base_url))
            .json(&RegisterRequest {
                email: email.to_string(),
                password: password.to_string(),
                display_name: display_name.to_string(),
            })
            .send()
            .await?
            .error_for_status()?
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
            .client
            .post(format!("{}/auth/login", self.base_url))
            .json(&LoginRequest {
                email: email.to_string(),
                password: password.to_string(),
            })
            .send()
            .await?
            .error_for_status()?
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
            .client
            .post(format!("{}/auth/refresh", self.base_url))
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await?
            .error_for_status()?
            .json::<AuthResponse>()
            .await?;
        self.token = Some(resp.token.clone());
        Ok(resp)
    }

    pub async fn create_workspace(
        &self,
        name: &str,
    ) -> Result<WorkspaceResponse, reqwest::Error> {
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

    pub async fn create_invite(
        &self,
        workspace_id: &str,
    ) -> Result<Value, reqwest::Error> {
        self.client
            .post(format!(
                "{}/workspaces/{}/invites",
                self.base_url, workspace_id
            ))
            .header("Authorization", self.auth_header())
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn accept_invite(&self, invite_code: &str) -> Result<Value, reqwest::Error> {
        self.client
            .post(format!(
                "{}/invites/{}/accept",
                self.base_url, invite_code
            ))
            .header("Authorization", self.auth_header())
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
