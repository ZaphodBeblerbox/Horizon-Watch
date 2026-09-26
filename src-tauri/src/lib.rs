#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      // Desktop only — see the target-gated dependency in Cargo.toml.
      // tauri_plugin_process is what lets the app relaunch itself once an
      // update has been written; without it an update installs and then
      // sits there until the user quits and reopens by hand.
      #[cfg(not(any(target_os = "android", target_os = "ios")))]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
