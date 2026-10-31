#[cfg(windows)]
fn main() {
    use linnya_windows_command_isolation::{
        dispatch, enable_current_user, install, installation_status, report_worker_error,
        run_worker, uninstall,
    };
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let result = match arguments.as_slice() {
        [mode] if mode == "disable" => linnya_windows_command_isolation::disable_current_user()
            .map(|removed| {
                if !removed {
                    std::process::exit(3);
                }
            }),
        [mode] if mode == "cleanup-user" => {
            linnya_windows_command_isolation::cleanup_current_user_filesystem()
        }
        [mode] if mode == "configure-user" => {
            linnya_windows_command_isolation::configure_current_user()
        }
        [mode] if mode == "status" => installation_status().map(|status| {
            println!(
                "{}",
                serde_json::to_string(&status).expect("status enum serializes")
            );
        }),
        [mode] if mode == "enable" => enable_current_user().map(|status| {
            println!(
                "{}",
                serde_json::to_string(&status).expect("enable result enum serializes")
            );
        }),
        [mode] if mode == "worker" => match run_worker() {
            Ok(code) => std::process::exit(code as i32),
            Err(error) => {
                let _ = report_worker_error(&error);
                std::process::exit(1);
            }
        },
        [mode, owner] if mode == "install" => install(owner.clone()),
        [mode, owner] if mode == "uninstall" => uninstall(owner.clone()),
        [mode, owner] if mode == "service" => dispatch(owner.clone()),
        _ => {
            eprintln!("expected status|enable or install|uninstall|service <Windows user SID>");
            std::process::exit(2);
        }
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Windows command isolation is only available on Windows");
    std::process::exit(2);
}
