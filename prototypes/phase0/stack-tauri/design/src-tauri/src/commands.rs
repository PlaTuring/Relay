// UNCOMPILED DESIGN FIXTURE. Native dialog and command runtime are intentionally not claimed.

use serde::Serialize;

use crate::owned_child::{run_fixed_owned_child, OwnedChildResult};
use crate::path_policy::{inspect_windows_managed_root, ManagedRootInspection};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySummary {
    pub control_plane_only: bool,
    pub remote_navigation_allowed: bool,
    pub generic_invoke_exposed: bool,
    pub command_count: u8,
}

#[tauri::command]
pub fn security_get_summary() -> SecuritySummary {
    SecuritySummary {
        control_plane_only: true,
        remote_navigation_allowed: false,
        generic_invoke_exposed: false,
        command_count: 4,
    }
}

#[tauri::command]
pub fn choose_managed_root() -> Result<String, String> {
    Err("BLOCKED: native folder picker dependency is not resolved or linked on this host.".to_owned())
}

#[tauri::command]
pub fn inspect_managed_root(candidate: String, system_drive: String) -> ManagedRootInspection {
    inspect_windows_managed_root(&candidate, &system_drive)
}

#[tauri::command]
pub fn run_owned_child_probe(label: String) -> Result<OwnedChildResult, String> {
    run_fixed_owned_child(&label)
}
