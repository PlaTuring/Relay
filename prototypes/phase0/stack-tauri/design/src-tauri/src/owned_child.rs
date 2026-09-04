// UNCOMPILED DESIGN FIXTURE. Direct-child behavior and Windows Job Objects are not proven here.

use serde::Serialize;
use std::io;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedChildResult {
    pub ready: bool,
    pub terminated: bool,
    pub direct_child_only: bool,
    pub process_tree_contained: bool,
}

fn owner_token() -> String {
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}-{epoch}", std::process::id())
}

pub fn run_fixed_owned_child(label: &str) -> Result<OwnedChildResult, String> {
    if label.is_empty() || label.len() > 256 || label.contains('\0') {
        return Err("Probe label is invalid.".to_owned());
    }

    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let token = owner_token();
    let args = [
        "--owned-child-probe",
        "--owner-token",
        token.as_str(),
        "--label",
        label,
    ];
    let mut child = Command::new(&executable)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(_status) => {
                return Ok(OwnedChildResult {
                    ready: false,
                    terminated: true,
                    direct_child_only: true,
                    process_tree_contained: false,
                });
            }
            None => thread::sleep(Duration::from_millis(20)),
        }
    }

    let killed = match child.kill() {
        Ok(()) => true,
        Err(error) if error.kind() == io::ErrorKind::InvalidInput => true,
        Err(error) => return Err(error.to_string()),
    };
    child.wait().map_err(|error| error.to_string())?;
    Ok(OwnedChildResult {
        ready: false,
        terminated: killed,
        direct_child_only: true,
        process_tree_contained: false,
    })
}
