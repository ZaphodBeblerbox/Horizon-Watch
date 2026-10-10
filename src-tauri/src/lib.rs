// THE fn KEY, READ FROM macOS (owner, 2026-10-10: the X glows the moment fn
// is pressed). The dictation app takes fn before the page sees a keypress,
// but the system's modifier state still says whether fn is held; reading it
// needs no permission. A thread polls it and tells the page on each change
// (src/voice/VoiceBar.jsx listens for "plx:fn").
#[cfg(target_os = "macos")]
mod fnkey {
  #[link(name = "CoreGraphics", kind = "framework")]
  extern "C" {
    fn CGEventSourceFlagsState(state_id: i32) -> u64;
  }
  // kCGEventSourceStateCombinedSessionState, kCGEventSourceStateHIDSystemState,
  // kCGEventFlagMaskSecondaryFn
  const COMBINED_SESSION_STATE: i32 = 0;
  const HID_SYSTEM_STATE: i32 = 1;
  const FLAG_SECONDARY_FN: u64 = 0x0080_0000;

  // BOTH STATES (2026-10-10: the X did not light in 1.1.13). With fn set to
  // start dictation, macOS takes the key before the session sees it, so
  // the session's state never says fn is held; the hardware's state does.
  pub fn held() -> bool {
    unsafe {
      (CGEventSourceFlagsState(HID_SYSTEM_STATE) | CGEventSourceFlagsState(COMBINED_SESSION_STATE)) & FLAG_SECONDARY_FN != 0
    }
  }
}

// A NATIVE NOTIFICATION, ASKED FOR DIRECTLY (2026-10-10: Parallax never
// appeared in System Settings › Notifications). The plugin's JavaScript
// route builds a browser-style Notification whose call to the native side
// swallows any error, so a failure looked like success. This command calls
// the same native code and returns its error to the page.
#[tauri::command]
fn plx_notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
    use tauri_plugin_notification::NotificationExt;
    app.notification().builder().title(title).body(body).sound("Ping").show().map_err(|e| e.to_string())
  }
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    let _ = (app, title, body);
    Ok(())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![plx_notify])
    .setup(|app| {
      // Desktop only — see the target-gated dependency in Cargo.toml.
      // tauri_plugin_process is what lets the app relaunch itself once an
      // update has been written; without it an update installs and then
      // sits there until the user quits and reopens by hand.
      #[cfg(not(any(target_os = "android", target_os = "ios")))]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
        // Native notifications while the window is hidden: the webview has
        // no service worker, so web push cannot reach the app.
        app.handle().plugin(tauri_plugin_notification::init())?;
        // A self-test from outside the page: launched with PLX_NOTIFY_TEST=1,
        // the app sends one notification from the native side on start.
        if std::env::var("PLX_NOTIFY_TEST").is_ok() {
          use tauri_plugin_notification::NotificationExt;
          let r = app.notification().builder().title("Parallax").body("Native notification test").show();
          eprintln!("[plx] native notification test: {:?}", r.map_err(|e| e.to_string()));
        }
      }

      #[cfg(target_os = "macos")]
      {
        use tauri::Manager;
        let handle = app.handle().clone();
        std::thread::spawn(move || {
          let mut was = false;
          loop {
            std::thread::sleep(std::time::Duration::from_millis(25));
            let now = fnkey::held();
            if now != was {
              was = now;
              if let Some(w) = handle.get_webview_window("main") {
                let js = if now {
                  "window.dispatchEvent(new CustomEvent('plx:fn', { detail: true }))"
                } else {
                  "window.dispatchEvent(new CustomEvent('plx:fn', { detail: false }))"
                };
                let _ = w.eval(js);
              }
            }
          }
        });
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    // CLOSING HIDES, IT DOES NOT QUIT (macOS). Notifications with the
    // window closed need something still running to raise them, so the red
    // button hides the window and Parallax stays in the dock, as Mail and
    // Slack do; ⌘Q quits.
    .on_window_event(|window, event| {
      #[cfg(target_os = "macos")]
      {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          let _ = window.hide();
          api.prevent_close();
        }
      }
      #[cfg(not(target_os = "macos"))]
      {
        let _ = (window, event);
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|_app_handle, _event| {
    // Clicking the dock icon brings the hidden window back.
    #[cfg(target_os = "macos")]
    {
      if let tauri::RunEvent::Reopen { .. } = _event {
        use tauri::Manager;
        if let Some(w) = _app_handle.get_webview_window("main") {
          let _ = w.show();
          let _ = w.set_focus();
        }
      }
    }
  });
}
