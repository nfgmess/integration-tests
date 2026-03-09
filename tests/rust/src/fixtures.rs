use rand::Rng;

pub const API_BASE: &str = "http://localhost:8081/api/v1";
pub const GATEWAY_WEBTRANSPORT: &str = "https://localhost:8444/webtransport";
pub const GATEWAY_WEBTRANSPORT_INFO: &str = "http://localhost:8443/webtransport-info";

pub fn random_email() -> String {
    let suffix: u64 = rand::thread_rng().gen();
    format!("test_{}@example.com", suffix)
}

pub fn random_name() -> String {
    let suffix: u64 = rand::thread_rng().gen();
    format!("TestUser_{}", suffix)
}

pub fn random_workspace_name() -> String {
    let suffix: u64 = rand::thread_rng().gen();
    format!("workspace_{}", suffix)
}

pub fn random_channel_name() -> String {
    let suffix: u64 = rand::thread_rng().gen();
    format!("channel-{}", suffix)
}
