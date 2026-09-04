// UNCOMPILED DESIGN FIXTURE. This file is not production Rust evidence.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRootInspection {
    pub accepted: bool,
    pub display_path: Option<String>,
    pub drive: Option<String>,
    pub is_system_drive: Option<bool>,
    pub contains_spaces: Option<bool>,
    pub contains_unicode: Option<bool>,
    pub warning: Option<String>,
    pub error: Option<String>,
}

fn rejected(message: &str) -> ManagedRootInspection {
    ManagedRootInspection {
        accepted: false,
        display_path: None,
        drive: None,
        is_system_drive: None,
        contains_spaces: None,
        contains_unicode: None,
        warning: None,
        error: Some(message.to_owned()),
    }
}

pub fn inspect_windows_managed_root(candidate: &str, system_drive: &str) -> ManagedRootInspection {
    if candidate.is_empty() || candidate.len() > 32_767 || candidate.contains('\0') {
        return rejected("Path is empty, too long, or contains NUL.");
    }

    if candidate.starts_with("\\\\") {
        return rejected("UNC and Windows device namespace paths are outside this bounded spike.");
    }

    let bytes = candidate.as_bytes();
    if bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || (bytes[2] != b'\\' && bytes[2] != b'/')
    {
        return rejected("An absolute Windows drive path is required.");
    }

    let drive = candidate[0..2].to_ascii_uppercase();
    let normalized_system_drive = system_drive.trim().to_ascii_uppercase();
    let is_system_drive = drive == normalized_system_drive;
    ManagedRootInspection {
        accepted: true,
        display_path: Some(candidate.to_owned()),
        drive: Some(drive),
        is_system_drive: Some(is_system_drive),
        contains_spaces: Some(candidate.chars().any(char::is_whitespace)),
        contains_unicode: Some(!candidate.is_ascii()),
        warning: is_system_drive.then(|| {
            "The user explicitly selected the system drive; show the large-file C-drive warning.".to_owned()
        }),
        error: None,
    }
}

pub fn suggest_managed_root(supported_drives: &[String]) -> Option<String> {
    supported_drives
        .iter()
        .any(|drive| drive.eq_ignore_ascii_case("D:"))
        .then(|| "D:\\MiniMaxH3".to_owned())
}
