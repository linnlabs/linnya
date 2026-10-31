use std::sync::{OnceLock, mpsc};
use windows::Win32::Foundation::NO_ERROR;
use windows::Win32::System::Services::*;
use windows::core::{PCWSTR, PWSTR};

use crate::{
    IsolationError, IsolationResult,
    coordinator::{self, CoordinatorMessage},
    identity::OwnerIdentity,
};

static SERVICE_OWNER: OnceLock<String> = OnceLock::new();

pub fn dispatch(owner_sid: String) -> IsolationResult<()> {
    let owner = OwnerIdentity::parse(owner_sid)?;
    let mut name = srt_win::util::wstr(&owner.service_name());
    SERVICE_OWNER.set(owner.sid().to_owned()).map_err(|_| {
        IsolationError::new("account_service_dispatch", "service already dispatched")
    })?;
    let table = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: PWSTR(name.as_mut_ptr()),
            lpServiceProc: Some(service_main),
        },
        SERVICE_TABLE_ENTRYW::default(),
    ];
    // SAFETY: 表以空项结尾，名称在阻塞 dispatcher 返回前存活，回调遵循 SCM ABI。
    unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) }
        .map_err(|error| IsolationError::new("account_service_dispatch", error.to_string()))
}

unsafe extern "system" fn service_main(_count: u32, _arguments: *mut PWSTR) {
    if let Err(error) = run_service() {
        eprintln!("{error}");
    }
}

fn run_service() -> IsolationResult<()> {
    let owner = OwnerIdentity::parse(
        SERVICE_OWNER
            .get()
            .ok_or_else(|| {
                IsolationError::new("account_service_owner", "service owner is missing")
            })?
            .clone(),
    )?;
    let name = srt_win::util::wstr(&owner.service_name());
    let (sender, receiver) = mpsc::channel();
    let control_sender = Box::new(sender.clone());
    // SAFETY: handler 只访问这个稳定 Box，直到报告 STOPPED 后服务主函数才释放它。
    let status = unsafe {
        RegisterServiceCtrlHandlerExW(
            PCWSTR(name.as_ptr()),
            Some(control_handler),
            Some((&*control_sender as *const mpsc::Sender<CoordinatorMessage>).cast()),
        )
    }
    .map_err(|error| IsolationError::new("account_service_handler", error.to_string()))?;
    report(status, SERVICE_START_PENDING, 0)?;
    let result = coordinator::run(
        owner,
        sender,
        receiver,
        || report(status, SERVICE_RUNNING, 0),
        || report(status, SERVICE_STOP_PENDING, 0),
    );
    report(status, SERVICE_STOPPED, u32::from(result.is_err()))?;
    result
}

fn report(
    handle: SERVICE_STATUS_HANDLE,
    state: SERVICE_STATUS_CURRENT_STATE,
    exit_code: u32,
) -> IsolationResult<()> {
    let status = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: state,
        dwControlsAccepted: if state == SERVICE_RUNNING {
            SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN
        } else {
            Default::default()
        },
        dwWin32ExitCode: exit_code,
        dwWaitHint: if state == SERVICE_START_PENDING || state == SERVICE_STOP_PENDING {
            30_000
        } else {
            0
        },
        ..Default::default()
    };
    // SAFETY: SCM 注册返回的 handle 在此服务主函数期间有效，状态结构同步读取。
    unsafe { SetServiceStatus(handle, &status) }
        .map_err(|error| IsolationError::new("account_service_status", error.to_string()))
}

unsafe extern "system" fn control_handler(
    control: u32,
    _event_type: u32,
    _event_data: *mut std::ffi::c_void,
    context: *mut std::ffi::c_void,
) -> u32 {
    if control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN {
        // SAFETY: context 来自 run_service 保活的 Box，SCM 在 STOPPED 之前调用 handler。
        let sender = unsafe { &*context.cast::<mpsc::Sender<CoordinatorMessage>>() };
        let _ = sender.send(CoordinatorMessage::Stop);
    }
    NO_ERROR.0
}
