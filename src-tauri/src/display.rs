use monero_by_astera_core::view::{Dimensions, Mode, Preferences, Store};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{LogicalSize, PhysicalPosition, WebviewWindow};
pub type DisplayState = Mutex<Store>;

pub fn fit_window(window: &WebviewWindow, prefs: &Preferences) -> tauri::Result<()> {
    let monitor = window.current_monitor()?.or(window.primary_monitor()?);
    let mut available = Dimensions {
        width: 7680.0,
        height: 4320.0,
    };
    let frame = window
        .outer_size()?
        .height
        .saturating_sub(window.inner_size()?.height);
    if let Some(monitor) = &monitor {
        let area = monitor.work_area();
        available = Dimensions {
            width: (area.size.width as f64 - 16.0) / monitor.scale_factor(),
            height: (area.size.height.saturating_sub(frame) as f64 - 16.0) / monitor.scale_factor(),
        };
    }
    let minimum = prefs.mode.minimum().fit(
        Dimensions {
            width: 1.0,
            height: 1.0,
        },
        available,
    );
    let size = prefs.size().fit(minimum, available);
    window.set_min_size(Some(LogicalSize::new(minimum.width, minimum.height)))?;
    window.set_size(LogicalSize::new(size.width, size.height))?;
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let current = window.outer_position()?;
        let outer = window.outer_size()?;
        let left = area.position.x;
        let top = area.position.y;
        let right = left.saturating_add(area.size.width.saturating_sub(outer.width) as i32);
        let bottom = top.saturating_add(area.size.height.saturating_sub(outer.height) as i32);
        window.set_position(PhysicalPosition::new(
            current.x.clamp(left, right.max(left)),
            current.y.clamp(top, bottom.max(top)),
        ))?;
    }
    Ok(())
}
#[tauri::command]
pub async fn view_preferences(
    window: WebviewWindow,
    display: tauri::State<'_, DisplayState>,
    mode: Option<Mode>,
) -> Result<Value, String> {
    let mut store = display
        .lock()
        .map_err(|_| "Display preferences are unavailable")?;
    let mut notice = None;
    if let Some(mode) = mode {
        let normal = !window.is_fullscreen().map_err(|e| e.to_string())?
            && !window.is_maximized().map_err(|e| e.to_string())?;
        let mut next = store.prefs.clone();
        if normal && !store.pending_resize {
            let size = window
                .inner_size()
                .map_err(|e| e.to_string())?
                .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
            next.remember(Dimensions {
                width: size.width,
                height: size.height,
            });
        }
        next.mode = mode;
        store.save(next)?;
        if normal {
            if fit_window(&window, &store.prefs).is_err() {
                notice=Some("View saved. The window could not resize automatically; you can resize it manually.");
            }
            store.pending_resize = false;
        } else {
            store.pending_resize = true;
            notice=Some("View saved. Leave full screen or restore the maximized window to use this view’s window size.");
        }
    }
    Ok(json!({"mode":store.prefs.mode,"notice":notice}))
}
