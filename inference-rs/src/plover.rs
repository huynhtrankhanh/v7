use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::timeout;

const PLOVER_READ_TIMEOUT: Duration = Duration::from_secs(5);

struct PloverConnection {
    reader: BufReader<tokio::net::tcp::OwnedReadHalf>,
    writer: tokio::net::tcp::OwnedWriteHalf,
}

pub struct PloverClient {
    host: String,
    port: u16,
    connection: Mutex<Option<PloverConnection>>,
    next_id: AtomicU64,
}

impl PloverClient {
    pub fn new(host: String, port: u16) -> Self {
        Self {
            host,
            port,
            connection: Mutex::new(None),
            next_id: AtomicU64::new(1),
        }
    }

    pub async fn check(&self) -> Result<()> {
        let _ = self
            .send_request("get_starting_stroke_state", serde_json::json!({}))
            .await?;
        Ok(())
    }

    pub async fn send_request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });

        let mut guard = self.connection.lock().await;
        if guard.is_none() {
            *guard = Some(self.connect().await?);
        }

        let connection = guard.as_mut().context("Plover connection missing")?;
        let payload = format!("{}\n", request.to_string());
        connection
            .writer
            .write_all(payload.as_bytes())
            .await
            .context("Failed to write to Stripped Plover")?;
        connection
            .writer
            .flush()
            .await
            .context("Failed to flush Stripped Plover request")?;

        loop {
            let mut line = String::new();
            let read_result = timeout(PLOVER_READ_TIMEOUT, connection.reader.read_line(&mut line))
                .await
                .context("Timed out waiting for Stripped Plover response")?;
            let bytes = read_result.context("Failed to read from Stripped Plover")?;
            if bytes == 0 {
                *guard = None;
                return Err(anyhow::anyhow!("Stripped Plover connection closed"));
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let value: Value = match serde_json::from_str(trimmed) {
                Ok(parsed) => parsed,
                Err(_) => continue,
            };

            if value.get("event").is_some() {
                continue;
            }
            if value.get("status") == Some(&Value::String("ready".to_string())) {
                continue;
            }

            let has_result = value.get("result").is_some();
            let has_error = value.get("error").is_some();
            if !has_result && !has_error {
                continue;
            }
            if matches_id(&value, id) {
                if let Some(error) = value.get("error") {
                    return Err(anyhow::anyhow!(
                        "Stripped Plover error: {}",
                        error.to_string()
                    ));
                }
                return Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null));
            }
        }
    }

    async fn connect(&self) -> Result<PloverConnection> {
        let addr = format!("{}:{}", self.host, self.port);
        let stream = timeout(Duration::from_secs(1), TcpStream::connect(&addr))
            .await
            .context("Timed out connecting to Stripped Plover")?
            .context("Failed to connect to Stripped Plover")?;
        let (read_half, write_half) = stream.into_split();
        Ok(PloverConnection {
            reader: BufReader::new(read_half),
            writer: write_half,
        })
    }
}

fn matches_id(value: &Value, id: u64) -> bool {
    match value.get("id") {
        Some(Value::Number(num)) => num.as_u64() == Some(id),
        Some(Value::String(text)) => text == &id.to_string(),
        _ => false,
    }
}
