use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::panic::Location;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize)]
struct PerfSample<'a> {
    suite: &'static str,
    operation: &'a str,
    duration_ms: f64,
    timestamp: String,
    caller: String,
    status: &'a str,
    meta: Value,
}

fn perf_file() -> &'static Mutex<std::fs::File> {
    static PERF_FILE: OnceLock<Mutex<std::fs::File>> = OnceLock::new();

    PERF_FILE.get_or_init(|| {
        let perf_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("artifacts")
            .join("performance");
        create_dir_all(&perf_dir).expect("perf directory must be creatable");
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(perf_dir.join("rust-samples.jsonl"))
            .expect("perf file must be writable");
        Mutex::new(file)
    })
}

pub fn record_perf_sample(
    operation: &str,
    duration: Duration,
    caller: &'static Location<'static>,
    status: &str,
    meta: Value,
) {
    let sample = PerfSample {
        suite: "rust",
        operation,
        duration_ms: duration.as_secs_f64() * 1000.0,
        timestamp: chrono_like_timestamp(),
        caller: format!("{}:{}", caller.file(), caller.line()),
        status,
        meta,
    };

    let serialized = serde_json::to_string(&sample).expect("perf sample must serialize");
    let mut file = perf_file().lock().expect("perf file mutex poisoned");
    writeln!(file, "{serialized}").expect("perf sample must flush");
}

pub async fn measure_async_result<T, E, F>(
    operation: &str,
    meta: Value,
    future: F,
) -> Result<T, E>
where
    F: std::future::Future<Output = Result<T, E>>,
{
    let caller = Location::caller();
    let start = Instant::now();
    let result = future.await;
    let status = if result.is_ok() { "ok" } else { "error" };
    record_perf_sample(operation, start.elapsed(), caller, status, meta);
    result
}

pub fn perf_meta(pairs: &[(&str, Value)]) -> Value {
    let mut object = serde_json::Map::with_capacity(pairs.len());
    for (key, value) in pairs {
        object.insert((*key).to_string(), value.clone());
    }
    Value::Object(object)
}

fn chrono_like_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time must be after epoch");
    json!({
        "seconds": now.as_secs(),
        "nanos": now.subsec_nanos(),
    })
    .to_string()
}
