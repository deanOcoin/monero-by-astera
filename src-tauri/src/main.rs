mod display;
use monero_by_astera_core::{clipboard::ClipboardLease, Connection, Control, Engine};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
type Shared = Arc<Mutex<Engine>>;
type SharedClipboard = Arc<Mutex<ClipboardLease>>;
fn clear_clipboard(lease: &SharedClipboard, expired_only: bool) {
    if let Ok(mut lease) = lease.lock() {
        if lease.tracked() && (!expired_only || lease.due(Instant::now())) {
            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                let _ = lease.clear(&mut clipboard);
            }
        }
    }
}
fn text<'a>(p: &'a Value, key: &str) -> Result<&'a str, String> {
    p[key].as_str().ok_or(format!("Missing {key}"))
}
#[tauri::command]
async fn wallet_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
    control: tauri::State<'_, Arc<Control>>,
    clipboard: tauri::State<'_, SharedClipboard>,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    if ["lock", "show-exchange"].contains(&action.as_str()) {
        clear_clipboard(clipboard.inner(), false);
        control.cancel();
    }
    // Input reports must not queue behind a long sync or signing request.
    if action == "operation-status" {
        return Ok(control.progress());
    }
    if action == "touch" {
        return Ok(json!({"active": control.touch()}));
    }
    if control.expire_if_idle() {
        clear_clipboard(clipboard.inner(), false);
        let _ = app.emit("wallet-locked", ());
    }
    let epoch = control.epoch();
    let state = state.inner().clone();
    let clipboard = clipboard.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut e = state.lock().map_err(|_| "Wallet state is unavailable")?;
        if e.wallet.is_some() && !e.control.session_active() {
            let _ = e.lock();
        }
        e.begin_operation(epoch)?;
        if action != "snapshot" { e.control.phase("Working…"); }
        let result = match action.as_str() {
            "snapshot" => e.snapshot(),
            "check-tor-proxies" => monero_by_astera_core::tor::diagnose(text(&payload, "proxy")?),
            "discover-nodes" => {
                let c: Connection = serde_json::from_value(payload["connection"].clone()).map_err(|_|"Invalid connection settings")?;
                monero_by_astera_core::node::discover(&c,payload["directConfirmed"]==true,payload["vpnConfirmed"]==true,&e.control,epoch)
            }
            "check-node" => {
                let c: Connection = serde_json::from_value(payload["connection"].clone())
                    .map_err(|_| "Invalid connection settings")?;
                monero_by_astera_core::node::check(
                    &c,
                    payload["directConfirmed"] == true,
                    payload["vpnConfirmed"] == true,
                )
            }
            "configure" => {
                let c: Connection =
                    serde_json::from_value(payload).map_err(|_| "Invalid connection settings")?;
                e.configure(c)?;
                e.snapshot()
            }
            "open" | "create" | "restore" => {
                if e.connection.mode == "vpn" {
                    e.confirm_vpn(payload["vpnConfirmed"] == true)?;
                }
                if e.connection.mode == "remote" {
                    e.confirm_direct(payload["directConfirmed"] == true)?;
                }
                let seed = if action == "restore" {
                    Some(text(&payload, "seed")?.to_string())
                } else {
                    None
                };
                e.open(
                    text(&payload, "name")?,
                    text(&payload, "password")?.into(),
                    seed,
                    payload["height"].as_u64().unwrap_or(0),
                    action != "open",
                )
            }
            "lock" => {
                e.lock()?;
                e.snapshot()
            }
            "refresh" => e.refresh(),
            "exchange-files" => e.exchange_files(),
            "exchange" => e.exchange_operation(
                text(&payload, "operation")?,
                serde_json::from_value(payload["files"].clone())
                    .map_err(|_| "Choose exchange files")?,
                text(&payload, "password")?.into(),
            ),
            "review-exchange" => {
                e.review_exchange(text(&payload, "operation")?, text(&payload, "file")?)
            }
            "confirm-exchange" => e.confirm_exchange(
                text(&payload, "id")?,
                text(&payload, "password")?.into(),
                payload["fingerprint"].as_str().unwrap_or(""),
            ),
            "multisig-step" => e.multisig_step(
                serde_json::from_value(payload["files"].clone())
                    .map_err(|_| "Choose peer files")?,
                text(&payload, "password")?.into(),
            ),
            "export-kex" => e.export_kex(text(&payload, "password")?.into()),
            "create-multisig" => {
                if e.connection.mode == "vpn" {
                    e.confirm_vpn(payload["vpnConfirmed"] == true)?;
                }
                if e.connection.mode == "remote" {
                    e.confirm_direct(payload["directConfirmed"] == true)?;
                }
                e.create_multisig(
                    text(&payload, "name")?,
                    text(&payload, "password")?.into(),
                    payload["threshold"]
                        .as_u64()
                        .unwrap_or(0)
                        .try_into()
                        .map_err(|_| "Invalid threshold")?,
                    payload["total"]
                        .as_u64()
                        .unwrap_or(0)
                        .try_into()
                        .map_err(|_| "Invalid participant count")?,
                )
            }
            "backup-files" => e.backup_files(text(&payload, "password")?.into()),
            "create-watch" | "restore-backup" | "hardware" | "polyseed" => {
                if e.connection.mode == "vpn" {
                    e.confirm_vpn(payload["vpnConfirmed"] == true)?;
                }
                if e.connection.mode == "remote" {
                    e.confirm_direct(payload["directConfirmed"] == true)?;
                }
                let name = text(&payload, "name")?;
                let password = text(&payload, "password")?.into();
                match action.as_str() {
                    "create-watch" => e.create_watch(name, password, text(&payload, "file")?),
                    "restore-backup" => e.restore_backup(name, password, text(&payload, "file")?),
                    "hardware" => e.create_hardware(
                        name,
                        password,
                        text(&payload, "device")?,
                        payload["height"].as_u64().unwrap_or(0),
                        payload["backedUp"] == true,
                    ),
                    _ => e.restore_polyseed(
                        name,
                        password,
                        text(&payload, "seed")?.into(),
                        payload["passphrase"].as_str().unwrap_or("").into(),
                        payload["height"].as_u64().unwrap_or(0),
                    ),
                }
            }
            "show-exchange" => {
                e.lock()?;
                let dir = e.exchange_dir()?;
                std::process::Command::new("/usr/bin/open")
                    .arg(dir)
                    .spawn()
                    .map_err(|_| "Cannot open Finder")?;
                e.snapshot()
            }
            "account" => e.account(
                payload["index"]
                    .as_u64()
                    .map(|v| u32::try_from(v).map_err(|_| "Invalid account"))
                    .transpose()?,
                payload["label"].as_str(),
            ),
            "address" => e.address(
                text(&payload, "label")?,
                payload["index"]
                    .as_u64()
                    .map(|v| u32::try_from(v).map_err(|_| "Invalid address index"))
                    .transpose()?,
            ),
            "seed" => e.reveal(text(&payload, "password")?.into()),
            "backup" => {
                let words: Vec<String> = serde_json::from_value(payload["words"].clone())
                    .map_err(|_| "Enter the requested words")?;
                e.backup_confirm(text(&payload, "password")?.into(), words)?;
                e.snapshot()
            }
            "prepare" => {
                let priority = u32::try_from(payload["priority"].as_u64().unwrap_or(0)).map_err(|_|"Invalid priority")?;
                if payload.get("sources").is_some() {
                    if !payload["source"].is_null() { return Err("Choose one source selection method".into()); }
                    let plan = serde_json::from_value(json!({"indices":payload["sources"],"allocation":payload.get("allocation").cloned().unwrap_or(json!("auto")),"shares":payload.get("shares").cloned().unwrap_or(json!([]))})).map_err(|_|"Invalid source allocation")?;
                    e.prepare_with_sources(text(&payload,"address")?,text(&payload,"amount")?,priority,plan)
                } else {
                    let source = if payload["source"].is_null() {None} else {Some(u32::try_from(payload["source"].as_u64().ok_or("Invalid source")?).map_err(|_|"Invalid source")?)};
                    e.prepare(text(&payload,"address")?,text(&payload,"amount")?,priority,source)
                }
            }
            "send" => e.send(text(&payload, "id")?, text(&payload, "password")?.into()),
            "cancel" => {
                e.cancel();
                Ok(json!({}))
            }
            "password" => {
                e.change_password(text(&payload, "old")?.into(), text(&payload, "new")?.into())?;
                Ok(json!({}))
            }
            "copy" => {
                let s = text(&payload, "text")?;
                if s.len() > 256 {
                    return Err("Clipboard content is too long".into());
                }
                if e.wallet.is_none() {
                    return Err("Unlock the wallet before copying".into());
                }
                clipboard
                    .lock()
                    .map_err(|_| "Clipboard state unavailable")?
                    .copy(
                        &mut arboard::Clipboard::new().map_err(|_| "Clipboard unavailable")?,
                        s,
                        Instant::now(),
                    )?;
                Ok(json!({}))
            }
            _ => Err("Unsupported wallet command".into()),
        };
        if (result.is_err()
            && [
                "open",
                "create",
                "restore",
                "polyseed",
                "hardware",
                "create-watch",
                "create-multisig",
                "restore-backup",
            ]
            .contains(&action.as_str()))
            || e.control.epoch() != epoch
        {
            let _ = e.lock();
        }
        if e.control.epoch() != epoch {
            return Err("Operation canceled by wallet lock".into());
        }
        result
    })
    .await
    .map_err(|_| "Wallet operation could not finish")?
}
fn main() {
    unsafe {
        libc::umask(0o077);
    }
    // This tiny supervisor runs without a webview. The inherited stdin pipe is
    // held only by the UI process; EOF also occurs if that process is killed.
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() == Some(std::ffi::OsStr::new("--guard-wallet-engine")) {
        use std::io::Read;
        let Some(binary) = args.next() else {
            std::process::exit(2);
        };
        let mut child = match std::process::Command::new(binary)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => std::process::exit(2),
        };
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut byte = [0u8; 1];
            loop {
                match std::io::stdin().read(&mut byte) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
            let _ = tx.send(());
        });
        loop {
            if let Ok(Some(status)) = child.try_wait() {
                std::process::exit(status.code().unwrap_or(1));
            }
            if rx.recv_timeout(Duration::from_millis(50)).is_ok() {
                break;
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        return;
    }

    let app = tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            let binary = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("resources/monero-wallet-rpc")
            } else {
                app.path()
                    .resource_dir()?
                    .join("resources/monero-wallet-rpc")
            };
            let display =
                monero_by_astera_core::view::Store::load(root.join("ui-preferences.json"));
            let display_preferences = display.prefs.clone();
            app.manage(Mutex::new(display));
            let mut engine = Engine::new(root, binary).map_err(std::io::Error::other)?;
            engine.guardian = Some(std::env::current_exe()?);
            let control = engine.control.clone();
            app.manage(control.clone());
            let clipboard: SharedClipboard = Arc::new(Mutex::new(ClipboardLease::default()));
            app.manage(clipboard.clone());
            let shared = Arc::new(Mutex::new(engine));
            app.manage(shared.clone());
            let window =
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                    .inner_size(
                        display_preferences.size().width,
                        display_preferences.size().height,
                    )
                    .min_inner_size(
                        display_preferences.mode.minimum().width,
                        display_preferences.mode.minimum().height,
                    )
                    .visible(false)
                    .on_navigation(|url| {
                        (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                            || (cfg!(debug_assertions)
                                && url.scheme() == "http"
                                && url.host_str() == Some("localhost")
                                && url.port() == Some(1420))
                    })
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .build()?;
            let _ = display::fit_window(&window, &display_preferences);
            window.show()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                clear_clipboard(&clipboard, true);
                if control.expire_if_idle() {
                    clear_clipboard(&clipboard, false);
                    let _ = handle.emit("wallet-locked", ());
                    if let Ok(mut e) = shared.lock() {
                        // An explicit new unlock may have won the engine mutex.
                        if !control.session_active() {
                            let _ = e.lock();
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            wallet_command,
            display::view_preferences
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Resized(_)) {
                let display = window.app_handle().state::<display::DisplayState>();
                if let Ok(mut store) = display.try_lock() {
                    if store.pending_resize
                        && !window.is_fullscreen().unwrap_or(true)
                        && !window.is_maximized().unwrap_or(true)
                    {
                        store.pending_resize = false;
                        if let Some(webview) = window.app_handle().get_webview_window("main") {
                            let _ = display::fit_window(&webview, &store.prefs);
                        }
                    }
                };
            }
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                window.app_handle().state::<Arc<Control>>().touch();
            }
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let handle = window.app_handle().clone();
                clear_clipboard(handle.state::<SharedClipboard>().inner(), false);
                handle.state::<Arc<Control>>().cancel();
                let shared = handle.state::<Shared>().inner().clone();
                std::thread::spawn(move || {
                    if let Ok(mut e) = shared.lock() {
                        let _ = e.lock();
                        let _ = handle.emit("wallet-locked", ());
                    }
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("Could not start Monero by Astera");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            clear_clipboard(handle.state::<SharedClipboard>().inner(), false);
            if let Ok(mut e) = handle.state::<Shared>().lock() {
                let _ = e.lock();
            }
        }
    });
}
