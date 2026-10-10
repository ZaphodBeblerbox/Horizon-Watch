#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
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
