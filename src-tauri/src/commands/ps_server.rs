use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Arc;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use warp::Filter;

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static SERVER_PORT: AtomicU16 = AtomicU16::new(0);

lazy_static::lazy_static! {
    static ref SERVER_HANDLE: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>> = Arc::new(Mutex::new(None));
    static ref SHUTDOWN_TX: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>> = Arc::new(Mutex::new(None));
    static ref PENDING_IMAGE: Arc<Mutex<Option<PendingImage>>> = Arc::new(Mutex::new(None));
    static ref PENDING_COMMANDS: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
    static ref PENDING_RESPONSES: Arc<Mutex<HashMap<String, serde_json::Value>>> = Arc::new(Mutex::new(HashMap::new()));
    static ref PS_CONNECTED: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
}

const DEFAULT_PORT: u16 = 9527;
const MAX_PORT: u16 = 9537;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImagePayload {
    pub base64: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageReceivedEvent {
    pub id: String,
    pub base64: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingImage {
    pub id: String,
    pub base64: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    pub created_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub ps_connected: bool,
}

fn guess_mime_type(image_data: &[u8]) -> Result<String, String> {
    let format = image::guess_format(image_data)
        .map_err(|e| format!("Failed to detect image format: {}", e))?;

    let mime_type = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::Gif => "image/gif",
        image::ImageFormat::Bmp => "image/bmp",
        image::ImageFormat::Tiff => "image/tiff",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Pnm => "image/x-portable-anymap",
        image::ImageFormat::Tga => "image/x-tga",
        image::ImageFormat::Dds => "image/vnd-ms.dds",
        image::ImageFormat::Farbfeld => "image/farbfeld",
        image::ImageFormat::OpenExr => "image/x-exr",
        image::ImageFormat::Ico => "image/x-icon",
        image::ImageFormat::Hdr => "image/vnd.radiance",
        image::ImageFormat::Avif => "image/avif",
        _ => "image/png",
    };

    Ok(mime_type.to_string())
}

#[derive(Debug, Serialize)]
struct ApiResponse<T: Serialize> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    fn error(msg: &str) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.to_string()),
        }
    }
}

async fn find_available_port(start_port: u16, max_port: u16) -> Option<u16> {
    for port in start_port..=max_port {
        let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().ok()?;
        if tokio::net::TcpListener::bind(addr).await.is_ok() {
            return Some(port);
        }
    }
    None
}

async fn send_command_to_ps(message: serde_json::Value) -> Result<serde_json::Value, String> {
    let connected = *PS_CONNECTED.lock().await;
    if !connected {
        warn!("send_command_to_ps: No Photoshop client connected");
        return Err("No Photoshop client connected".to_string());
    }

    let request_id = uuid::Uuid::new_v4().to_string();
    let mut message_with_id = message.clone();
    if let Some(obj) = message_with_id.as_object_mut() {
        obj.insert("requestId".to_string(), serde_json::json!(request_id));
    }

    info!(
        "send_command_to_ps: Adding command with requestId={}, type={:?}",
        request_id,
        message.get("type")
    );

    {
        let mut commands = PENDING_COMMANDS.lock().await;
        commands.push(message_with_id);
        info!(
            "send_command_to_ps: Command queue length: {}",
            commands.len()
        );
    }

    info!("send_command_to_ps: Waiting for response (timeout 90s)...");

    for i in 0..180 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let responses = PENDING_RESPONSES.lock().await;
        if let Some(response) = responses.get(&request_id) {
            info!(
                "send_command_to_ps: Got response for requestId={}",
                request_id
            );
            return Ok(response.clone());
        }

        if i % 10 == 9 {
            info!("send_command_to_ps: Still waiting... ({}/180)", i + 1);
        }
    }

    warn!(
        "send_command_to_ps: Timeout waiting for response to requestId={}",
        request_id
    );
    Err("Request timeout".to_string())
}

fn create_routes(
    app_handle: AppHandle,
) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
    let status_route = warp::path!("api" / "ps" / "status")
        .and(warp::get())
        .and_then(|| async {
            let running = SERVER_RUNNING.load(Ordering::SeqCst);
            let port = if running {
                Some(SERVER_PORT.load(Ordering::SeqCst))
            } else {
                None
            };
            let ps_connected = *PS_CONNECTED.lock().await;
            Ok::<_, warp::Rejection>(warp::reply::json(&ApiResponse::success(ServerStatus {
                running,
                port,
                ps_connected,
            })))
        });

    let app_handle_clone = app_handle.clone();
    let image_route = warp::path!("api" / "ps" / "image")
        .and(warp::post())
        .and(warp::body::json::<ImagePayload>())
        .and_then(move |payload: ImagePayload| {
            let app_handle = app_handle_clone.clone();
            async move {
                let id = uuid::Uuid::new_v4().to_string();

                let width = payload.width.unwrap_or(0);
                let height = payload.height.unwrap_or(0);

                let event = ImageReceivedEvent {
                    id: id.clone(),
                    base64: payload.base64,
                    width,
                    height,
                };

                if let Err(e) = app_handle.emit("ps:image-received", &event) {
                    error!("Failed to emit ps:image-received event: {}", e);
                    return Ok::<_, warp::Rejection>(warp::reply::json(
                        &ApiResponse::<String>::error("Failed to process image"),
                    ));
                }

                info!("Image received from Photoshop, id: {}", id);
                Ok(warp::reply::json(&ApiResponse::success(
                    serde_json::json!({ "id": id }),
                )))
            }
        });

    let pending_image_route = warp::path!("api" / "ps" / "pending-image")
        .and(warp::get())
        .and_then(|| async {
            let mut pending = PENDING_IMAGE.lock().await;
            if let Some(image) = pending.take() {
                info!(
                    "Pending image retrieved by Photoshop plugin, id: {}",
                    image.id
                );
                Ok::<_, warp::Rejection>(warp::reply::json(&ApiResponse::success(image)))
            } else {
                Ok(warp::reply::json(&ApiResponse::<PendingImage>::error(
                    "No pending image",
                )))
            }
        });

    let poll_route = warp::path!("api" / "ps" / "poll")
        .and(warp::get())
        .and_then(|| async {
            let mut commands = PENDING_COMMANDS.lock().await;
            if let Some(command) = commands.pop() {
                info!(
                    "Poll: Sending command to PS: {:?}, queue remaining: {}",
                    command.get("type"),
                    commands.len()
                );
                Ok::<_, warp::Rejection>(warp::reply::json(&ApiResponse::success(
                    serde_json::json!({ "command": command }),
                )))
            } else {
                Ok(warp::reply::json(&ApiResponse::<serde_json::Value>::error(
                    "No pending commands",
                )))
            }
        });

    let response_route = warp::path!("api" / "ps" / "response")
        .and(warp::post())
        .and(warp::body::json::<serde_json::Value>())
        .and_then(|response: serde_json::Value| async {
            info!("Response route received: {:?}", response.get("requestId"));
            if let Some(request_id) = response.get("requestId").and_then(|r| r.as_str()) {
                info!(
                    "Received response from PS for request: {}, success: {:?}",
                    request_id,
                    response.get("success")
                );
                let mut responses = PENDING_RESPONSES.lock().await;
                responses.insert(request_id.to_string(), response);
                info!("Response stored, total responses: {}", responses.len());
            } else {
                warn!("Response missing requestId: {:?}", response);
            }
            Ok::<_, warp::Rejection>(warp::reply::json(&ApiResponse::success(
                serde_json::json!({ "received": true }),
            )))
        });

    let register_route = warp::path!("api" / "ps" / "register")
        .and(warp::post())
        .and_then(|| async {
            let mut connected = PS_CONNECTED.lock().await;
            *connected = true;
            info!("Photoshop client registered");
            Ok::<_, warp::Rejection>(warp::reply::json(&ApiResponse::success(
                serde_json::json!({ "registered": true }),
            )))
        });

    let get_selection_route = warp::path!("api" / "ps" / "get-selection")
        .and(warp::get())
        .and_then(|| async {
            match send_command_to_ps(serde_json::json!({ "type": "getSelection" })).await {
                Ok(response) => {
                    Ok::<_, warp::Rejection>(warp::reply::json(&ApiResponse::success(response)))
                }
                Err(e) => Ok(warp::reply::json(&ApiResponse::<serde_json::Value>::error(
                    &e,
                ))),
            }
        });

    let get_selection_image_route = warp::path!("api" / "ps" / "get-selection-image")
        .and(warp::get())
        .and_then(|| async {
            match send_command_to_ps(serde_json::json!({ "type": "getSelectionImage" })).await {
                Ok(response) => {
                    Ok::<_, warp::Rejection>(warp::reply::json(&ApiResponse::success(response)))
                }
                Err(e) => Ok(warp::reply::json(&ApiResponse::<serde_json::Value>::error(
                    &e,
                ))),
            }
        });

    let send_image_route = warp::path!("api" / "ps" / "send-image")
        .and(warp::post())
        .and(warp::body::json::<ImagePayload>())
        .and_then(|payload: ImagePayload| async move {
            match send_command_to_ps(serde_json::json!({
                "type": "sendImage",
                "data": {
                    "base64": payload.base64,
                    "width": payload.width,
                    "height": payload.height,
                    "mimeType": payload.mime_type
                }
            }))
            .await
            {
                Ok(response) => {
                    Ok::<_, warp::Rejection>(warp::reply::json(&ApiResponse::success(response)))
                }
                Err(e) => Ok(warp::reply::json(&ApiResponse::<serde_json::Value>::error(
                    &e,
                ))),
            }
        });

    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET", "POST", "OPTIONS"])
        .allow_headers(vec!["Content-Type"]);

    status_route
        .or(image_route)
        .or(pending_image_route)
        .or(poll_route)
        .or(response_route)
        .or(register_route)
        .or(get_selection_route)
        .or(get_selection_image_route)
        .or(send_image_route)
        .with(cors)
        .with(warp::log("ps_server"))
}

#[tauri::command]
pub async fn start_ps_server(app: AppHandle, port: Option<u16>) -> Result<u16, String> {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        let current_port = SERVER_PORT.load(Ordering::SeqCst);
        info!("PS server already running on port {}", current_port);
        return Ok(current_port);
    }

    let requested_port = port.unwrap_or(DEFAULT_PORT);
    let available_port = find_available_port(requested_port, MAX_PORT)
        .await
        .ok_or_else(|| {
            format!(
                "No available port found between {} and {}",
                requested_port, MAX_PORT
            )
        })?;

    let addr: SocketAddr = format!("127.0.0.1:{}", available_port)
        .parse()
        .map_err(|e| format!("Invalid address: {}", e))?;

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let routes = create_routes(app.clone());

    let (_, server) = warp::serve(routes).bind_with_graceful_shutdown(addr, async {
        shutdown_rx.await.ok();
        info!("PS server shutdown signal received");
    });

    SERVER_RUNNING.store(true, Ordering::SeqCst);
    SERVER_PORT.store(available_port, Ordering::SeqCst);

    let server_handle = tokio::spawn(server);

    {
        let mut handle_guard = SERVER_HANDLE.lock().await;
        *handle_guard = Some(server_handle);
    }

    {
        let mut tx_guard = SHUTDOWN_TX.lock().await;
        *tx_guard = Some(shutdown_tx);
    }

    info!("PS server started on port {}", available_port);
    Ok(available_port)
}

#[tauri::command]
pub async fn stop_ps_server() -> Result<(), String> {
    if !SERVER_RUNNING.load(Ordering::SeqCst) {
        info!("PS server is not running");
        return Ok(());
    }

    {
        let mut tx_guard = SHUTDOWN_TX.lock().await;
        if let Some(tx) = tx_guard.take() {
            if tx.send(()).is_err() {
                warn!("Failed to send shutdown signal to PS server");
            }
        }
    }

    {
        let mut handle_guard = SERVER_HANDLE.lock().await;
        if let Some(handle) = handle_guard.take() {
            match handle.await {
                Ok(_) => info!("PS server stopped successfully"),
                Err(e) => error!("PS server task error: {}", e),
            }
        }
    }

    {
        let mut connected = PS_CONNECTED.lock().await;
        *connected = false;
    }

    {
        let mut commands = PENDING_COMMANDS.lock().await;
        commands.clear();
    }

    {
        let mut responses = PENDING_RESPONSES.lock().await;
        responses.clear();
    }

    SERVER_RUNNING.store(false, Ordering::SeqCst);
    SERVER_PORT.store(0, Ordering::SeqCst);

    info!("PS server stopped");
    Ok(())
}

#[tauri::command]
pub async fn get_ps_server_status() -> ServerStatus {
    let running = SERVER_RUNNING.load(Ordering::SeqCst);
    let port = if running {
        Some(SERVER_PORT.load(Ordering::SeqCst))
    } else {
        None
    };
    let ps_connected = *PS_CONNECTED.lock().await;
    ServerStatus {
        running,
        port,
        ps_connected,
    }
}

#[tauri::command]
pub async fn send_image_to_photoshop(image_path: String) -> Result<(), String> {
    let server_running = SERVER_RUNNING.load(Ordering::SeqCst);
    if !server_running {
        return Err("PS server is not running. Please start the server first.".to_string());
    }

    let connected = *PS_CONNECTED.lock().await;
    if !connected {
        return Err(
            "No Photoshop client connected. Please open the plugin in Photoshop.".to_string(),
        );
    }

    let (image_data, width, height, mime_type) = if image_path.starts_with("data:image") {
        let base64_start = image_path.find(',').ok_or("Invalid data URL format")?;
        let mime_type = image_path
            .strip_prefix("data:")
            .and_then(|value| value.split(';').next())
            .filter(|value| !value.is_empty())
            .unwrap_or("image/png")
            .to_string();
        let base64_str = &image_path[base64_start + 1..];
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(base64_str)
            .map_err(|e| format!("Failed to decode base64: {}", e))?;

        let img = image::ImageReader::new(Cursor::new(&decoded))
            .with_guessed_format()
            .map_err(|e| format!("Failed to guess image format: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode image: {}", e))?;

        (decoded, img.width(), img.height(), mime_type)
    } else if image_path.starts_with("file://") {
        let decoded_url =
            urlencoding::decode(&image_path).map_err(|e| format!("Failed to decode URL: {}", e))?;
        let local_path = decoded_url
            .strip_prefix("file://")
            .or_else(|| decoded_url.strip_prefix("file:///"))
            .ok_or("Invalid file URL")?;

        let normalized_path = if cfg!(windows) {
            local_path.trim_start_matches('/')
        } else {
            local_path
        };

        info!("Reading image from file URL: {}", normalized_path);
        let data =
            fs::read(normalized_path).map_err(|e| format!("Failed to read image file: {}", e))?;

        let img = image::ImageReader::new(Cursor::new(&data))
            .with_guessed_format()
            .map_err(|e| format!("Failed to guess image format: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode image: {}", e))?;

        let mime_type = guess_mime_type(&data)?;

        (data, img.width(), img.height(), mime_type)
    } else {
        info!("Reading image from path: {}", image_path);
        let data =
            fs::read(&image_path).map_err(|e| format!("Failed to read image file: {}", e))?;

        let img = image::ImageReader::new(Cursor::new(&data))
            .with_guessed_format()
            .map_err(|e| format!("Failed to guess image format: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode image: {}", e))?;

        let mime_type = guess_mime_type(&data)?;

        (data, img.width(), img.height(), mime_type)
    };

    let base64_data = base64::engine::general_purpose::STANDARD.encode(&image_data);

    info!(
        "Sending image to PS: {}x{}, base64 length: {}",
        width,
        height,
        base64_data.len()
    );

    let result = send_command_to_ps(serde_json::json!({
        "type": "sendImage",
        "data": {
            "base64": base64_data,
            "width": width,
            "height": height,
            "mimeType": mime_type
        }
    }))
    .await;

    match result {
        Ok(response) => {
            info!("PS response: {:?}", response);
            if response
                .get("success")
                .and_then(|s| s.as_bool())
                .unwrap_or(false)
            {
                info!("Image sent to Photoshop successfully");
                Ok(())
            } else {
                let error = response
                    .get("error")
                    .and_then(|e| e.as_str())
                    .unwrap_or("Unknown error");
                Err(error.to_string())
            }
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn get_ps_selection() -> Result<serde_json::Value, String> {
    let server_running = SERVER_RUNNING.load(Ordering::SeqCst);
    if !server_running {
        return Err("PS server is not running".to_string());
    }

    let connected = *PS_CONNECTED.lock().await;
    if !connected {
        return Err("No Photoshop client connected".to_string());
    }

    send_command_to_ps(serde_json::json!({ "type": "getSelection" })).await
}

#[tauri::command]
pub async fn get_ps_selection_image() -> Result<serde_json::Value, String> {
    let server_running = SERVER_RUNNING.load(Ordering::SeqCst);
    if !server_running {
        return Err("PS server is not running".to_string());
    }

    let connected = *PS_CONNECTED.lock().await;
    if !connected {
        return Err("No Photoshop client connected".to_string());
    }

    send_command_to_ps(serde_json::json!({ "type": "getSelectionImage" })).await
}
