// UNCOMPILED DESIGN FIXTURE. No Cargo manifest exists, so this is not build or runtime evidence.

mod commands;
mod owned_child;
mod path_policy;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::security_get_summary,
            commands::choose_managed_root,
            commands::inspect_managed_root,
            commands::run_owned_child_probe,
        ])
        .run(tauri::generate_context!())
        .expect("bounded Tauri control-plane fixture failed");
}
