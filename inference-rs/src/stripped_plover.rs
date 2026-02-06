use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;

/// A TCP client for the Stripped Plover JSON-line protocol.
struct SpConnection {
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
}

/// Manages the connection to Stripped Plover, with lazy connect and auto-reconnect.
pub struct StrippedPloverManager {
    host: String,
    port: u16,
    conn: Option<SpConnection>,
    id_counter: AtomicU64,
}

// -- Public request/response types --

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum OutputElement {
    #[serde(rename = "committed")]
    Committed { text: String },
    #[serde(rename = "keypress")]
    Keypress { combo: String },
    #[serde(rename = "preedit")]
    Preedit { text: String },
}

#[derive(Deserialize, Serialize, Debug)]
pub struct TranslateResult {
    pub output: Vec<OutputElement>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct DictionaryInfo {
    pub path: String,
    pub enabled: bool,
    pub readonly: bool,
    pub entries: u64,
}

impl StrippedPloverManager {
    pub fn new(host: String, port: u16) -> Self {
        Self {
            host,
            port,
            conn: None,
            id_counter: AtomicU64::new(0),
        }
    }

    fn next_id(&self) -> String {
        self.id_counter.fetch_add(1, Ordering::Relaxed).to_string()
    }

    async fn ensure_connected(&mut self) -> Result<(), String> {
        if self.conn.is_some() {
            return Ok(());
        }
        let addr = format!("{}:{}", self.host, self.port);
        let stream = TcpStream::connect(&addr)
            .await
            .map_err(|e| format!("Failed to connect to Stripped Plover at {}: {}", addr, e))?;
        let (read_half, write_half) = stream.into_split();
        let mut reader = BufReader::new(read_half);

        // Read the initial {"status": "ready"} line
        let mut ready_line = String::new();
        reader
            .read_line(&mut ready_line)
            .await
            .map_err(|e| format!("Failed to read ready message: {}", e))?;
        // Validate the ready message structure
        match serde_json::from_str::<serde_json::Value>(ready_line.trim()) {
            Ok(val) => {
                if val.get("status").and_then(|s| s.as_str()) != Some("ready") {
                    eprintln!(
                        "Warning: Expected {{\"status\": \"ready\"}} from Stripped Plover, got: {}",
                        ready_line.trim()
                    );
                }
            }
            Err(_) => {
                eprintln!(
                    "Warning: Could not parse ready message from Stripped Plover: {}",
                    ready_line.trim()
                );
            }
        }

        self.conn = Some(SpConnection {
            reader,
            writer: write_half,
        });
        eprintln!("Connected to Stripped Plover at {}", addr);
        Ok(())
    }

    /// Send a JSON-RPC request and return the parsed response.
    async fn request(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        self.ensure_connected().await?;
        let id = self.next_id();
        let conn = self.conn.as_mut().unwrap();
        let req = json!({
            "id": id,
            "method": method,
            "params": params,
        });
        let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        line.push('\n');

        if let Err(e) = conn.writer.write_all(line.as_bytes()).await {
            self.conn = None;
            return Err(format!("Write failed: {}", e));
        }

        // Read response lines, skipping async event lines
        loop {
            let mut response_line = String::new();
            match conn.reader.read_line(&mut response_line).await {
                Ok(0) => {
                    self.conn = None;
                    return Err("Connection closed by Stripped Plover".to_string());
                }
                Ok(_) => {}
                Err(e) => {
                    self.conn = None;
                    return Err(format!("Read failed: {}", e));
                }
            }

            let parsed: serde_json::Value =
                serde_json::from_str(response_line.trim()).map_err(|e| {
                    format!(
                        "Failed to parse response: {} (line: {})",
                        e,
                        response_line.trim()
                    )
                })?;

            // Skip asynchronous event lines (they have "event" field, not "id")
            if parsed.get("event").is_some() {
                continue;
            }

            // Check for error
            if let Some(error) = parsed.get("error") {
                let msg = error
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                return Err(format!("Stripped Plover error: {}", msg));
            }

            if let Some(result) = parsed.get("result") {
                return Ok(result.clone());
            }

            return Err(format!("Unexpected response: {}", response_line.trim()));
        }
    }

    // -- Public API methods --

    pub fn is_connected(&self) -> bool {
        self.conn.is_some()
    }

    pub async fn check_connection(&mut self) -> bool {
        self.ensure_connected().await.is_ok()
    }

    pub async fn translate(&mut self, stroke: &str) -> Result<TranslateResult, String> {
        let result = self.request("translate", json!({"stroke": stroke})).await?;
        serde_json::from_value(result).map_err(|e| format!("Parse translate result: {}", e))
    }

    pub async fn reset_state(&mut self) -> Result<(), String> {
        self.request("reset_state", json!({})).await?;
        Ok(())
    }

    pub async fn list_dictionaries(&mut self) -> Result<Vec<DictionaryInfo>, String> {
        let result = self.request("list_dictionaries", json!({})).await?;
        let dicts = result
            .get("dictionaries")
            .ok_or("Missing dictionaries field")?;
        serde_json::from_value(dicts.clone())
            .map_err(|e| format!("Parse dictionaries: {}", e))
    }

    pub async fn import_dictionary(
        &mut self,
        name: &str,
        dict_type: &str,
        data: Option<serde_json::Value>,
        python_code: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        let mut params = json!({"name": name, "type": dict_type});
        if let Some(d) = data {
            params["data"] = d;
        }
        if let Some(code) = python_code {
            params["pythonCode"] = json!(code);
        }
        self.request("import_dictionary", params).await
    }

    pub async fn export_dictionary(&mut self, name: &str) -> Result<serde_json::Value, String> {
        self.request("export_dictionary", json!({"name": name}))
            .await
    }

    pub async fn remove_dictionary(&mut self, name: &str) -> Result<(), String> {
        self.request("remove_dictionary", json!({"name": name}))
            .await?;
        Ok(())
    }

    pub async fn get_dictionary_entries(
        &mut self,
        name: &str,
    ) -> Result<serde_json::Value, String> {
        self.request("get_dictionary_entries", json!({"name": name}))
            .await
    }

    pub async fn add_entry(
        &mut self,
        stroke: &str,
        translation: &str,
        name: Option<&str>,
    ) -> Result<(), String> {
        let mut params = json!({"stroke": stroke, "translation": translation});
        if let Some(n) = name {
            params["name"] = json!(n);
        }
        self.request("add_entry", params).await?;
        Ok(())
    }

    pub async fn update_entry(
        &mut self,
        stroke: &str,
        translation: &str,
        name: Option<&str>,
    ) -> Result<(), String> {
        let mut params = json!({"stroke": stroke, "translation": translation});
        if let Some(n) = name {
            params["name"] = json!(n);
        }
        self.request("update_entry", params).await?;
        Ok(())
    }

    pub async fn remove_entry(&mut self, stroke: &str, name: Option<&str>) -> Result<(), String> {
        let mut params = json!({"stroke": stroke});
        if let Some(n) = name {
            params["name"] = json!(n);
        }
        self.request("remove_entry", params).await?;
        Ok(())
    }
}
