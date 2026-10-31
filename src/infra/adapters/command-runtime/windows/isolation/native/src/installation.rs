use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{
    ERROR_SERVICE_DOES_NOT_EXIST, ERROR_SERVICE_NOT_ACTIVE, HANDLE, WAIT_OBJECT_0,
};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Services::*;
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject};
use windows::Win32::UI::Shell::{FOLDERID_ProgramFiles, KF_FLAG_DEFAULT, SHGetKnownFolderPath};
use windows::core::PCWSTR;

use crate::{
    IsolationError, IsolationResult, coordinator, identity::OwnerIdentity, journal::AccountJournal,
};

struct ServiceHandle(SC_HANDLE);
impl Drop for ServiceHandle {
    fn drop(&mut self) {
        // SAFETY: SC_HANDLE 由本 wrapper 独占，SCM 对象必须用专用 close 而非 CloseHandle。
        unsafe {
            let _ = CloseServiceHandle(self.0);
        }
    }
}

fn manager(access: u32) -> IsolationResult<ServiceHandle> {
    // SAFETY: 只打开本机 SCM；安装入口由 UAC/管理员身份执行。
    unsafe { OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), access) }
        .map(ServiceHandle)
        .map_err(|error| IsolationError::new("account_install_scm", error.to_string()))
}

fn open(
    manager: &ServiceHandle,
    owner: &OwnerIdentity,
    access: u32,
) -> IsolationResult<Option<ServiceHandle>> {
    let name = srt_win::util::wstr(&owner.service_name());
    // SAFETY: name 是规范化 owner SID 组成的本产品服务名，SCM handle 由调用方保活。
    match unsafe { OpenServiceW(manager.0, PCWSTR(name.as_ptr()), access) } {
        Ok(handle) => Ok(Some(ServiceHandle(handle))),
        Err(error) if error.code() == ERROR_SERVICE_DOES_NOT_EXIST.to_hresult() => Ok(None),
        Err(error) => Err(IsolationError::new(
            "account_install_open",
            error.to_string(),
        )),
    }
}

fn stop(service: &ServiceHandle) -> IsolationResult<()> {
    let mut process_status = SERVICE_STATUS_PROCESS::default();
    let mut needed = 0;
    // SAFETY: 将已初始化的 repr(C) 状态结构作为 Win32 输出 buffer，长度精确匹配。
    let buffer = unsafe {
        std::slice::from_raw_parts_mut(
            (&mut process_status as *mut SERVICE_STATUS_PROCESS).cast::<u8>(),
            size_of::<SERVICE_STATUS_PROCESS>(),
        )
    };
    // SAFETY: 查询句柄有效，buffer 与 needed 都在调用期间保活。
    unsafe { QueryServiceStatusEx(service.0, SC_STATUS_PROCESS_INFO, Some(buffer), &mut needed) }
        .map_err(|error| IsolationError::new("account_install_process", error.to_string()))?;
    let process = if process_status.dwProcessId == 0 {
        None
    } else {
        // SAFETY: 在发送停止之前取得稳定句柄，不靠稍后可能复用的 PID 判断退出。
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, process_status.dwProcessId) }
            .map_err(|error| IsolationError::new("account_install_process", error.to_string()))?;
        // SAFETY: OpenProcess 成功，唯一新句柄移交 RAII。
        Some(unsafe { OwnedHandle::from_raw_handle(handle.0) })
    };
    let mut status = SERVICE_STATUS::default();
    // SAFETY: service 有 SERVICE_STOP 权限，输出结构有效。
    if let Err(error) = unsafe { ControlService(service.0, SERVICE_CONTROL_STOP, &mut status) }
        && error.code() != ERROR_SERVICE_NOT_ACTIVE.to_hresult()
    {
        return Err(IsolationError::new(
            "account_install_stop",
            error.to_string(),
        ));
    }
    wait_for(service, SERVICE_STOPPED)?;
    // SCM 的 STOPPED 早于进程真正退出；仅等待状态会在更新 exe 时触发 sharing violation。
    if let Some(process) = process {
        // SAFETY: process 仍保活服务进程的同步句柄，等待有明确上限。
        if unsafe { WaitForSingleObject(HANDLE(process.as_raw_handle()), 30_000) } != WAIT_OBJECT_0
        {
            return Err(IsolationError::new(
                "account_install_process",
                "service process did not exit",
            ));
        }
    }
    Ok(())
}

fn wait_for(service: &ServiceHandle, state: SERVICE_STATUS_CURRENT_STATE) -> IsolationResult<()> {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let mut status = SERVICE_STATUS::default();
        // SAFETY: 有效 SCM service handle，输出缓冲区类型与 API 一致。
        unsafe { QueryServiceStatus(service.0, &mut status) }
            .map_err(|error| IsolationError::new("account_install_observe", error.to_string()))?;
        if status.dwCurrentState == state {
            return Ok(());
        }
        if (state == SERVICE_RUNNING && status.dwCurrentState == SERVICE_STOPPED)
            || Instant::now() >= deadline
        {
            return Err(IsolationError::new(
                "account_install_observe",
                format!(
                    "service state={} exit={}",
                    status.dwCurrentState.0, status.dwWin32ExitCode
                ),
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn installation_directory(owner: &OwnerIdentity) -> IsolationResult<PathBuf> {
    // SAFETY: 固定系统 known folder，不信任调用方环境中的 ProgramFiles 或任意安装路径。
    let raw = unsafe { SHGetKnownFolderPath(&FOLDERID_ProgramFiles, KF_FLAG_DEFAULT, None) }
        .map_err(|error| IsolationError::new("account_install_directory", error.to_string()))?;
    // SAFETY: Shell 返回 NUL 结尾的有效 UTF-16；转换后无论成功失败都释放原始 buffer。
    let path = unsafe { raw.to_string() };
    // SAFETY: raw 由 Shell 使用 COM task allocator 分配。
    unsafe {
        CoTaskMemFree(Some(raw.0.cast()));
    }
    let path = path.map_err(|_| {
        IsolationError::new(
            "account_install_directory",
            "invalid system program directory",
        )
    })?;
    Ok(PathBuf::from(path)
        .join("Linnya")
        .join("CommandIsolation")
        .join(owner.sid()))
}

/// Desktop 只需一次 UAC 调用本入口；账户组、服务及恢复日志都由产品初始化。
pub fn install(owner_sid: String) -> IsolationResult<()> {
    let owner = OwnerIdentity::parse(owner_sid)?;
    AccountJournal::initialize(&owner)?;
    srt_win::sam::ensure_local_group(&owner.group_name(), "Linnya isolated command identities")
        .map_err(|error| IsolationError::new("account_install_group", error.to_string()))?;
    let group_sid = srt_win::sid::lookup_account_sid(&owner.group_name())
        .map_err(|error| IsolationError::new("account_install_group", error.to_string()))?;
    srt_win::user::apply_logon_denials(&group_sid)
        .map_err(|error| IsolationError::new("account_install_logon", error.to_string()))?;
    let manager = manager(SC_MANAGER_CREATE_SERVICE | SC_MANAGER_CONNECT)?;
    let existing = open(&manager, &owner, SERVICE_ALL_ACCESS)?;
    if let Some(service) = &existing {
        stop(service)?;
    }
    let directory = installation_directory(&owner)?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| IsolationError::new("account_install_directory", error.to_string()))?;
    let executable = directory.join("linnya-command-isolation.exe");
    let source = std::env::current_exe()
        .map_err(|error| IsolationError::new("account_install_source", error.to_string()))?;
    if source != executable {
        std::fs::copy(&source, &executable)
            .map_err(|error| IsolationError::new("account_install_copy", error.to_string()))?;
    }
    let command = srt_win::util::wstr(&format!(
        "\"{}\" service {}",
        executable.display(),
        owner.sid()
    ));
    let name = srt_win::util::wstr(&owner.service_name());
    let service = if let Some(service) = existing {
        // SAFETY: 安装固定当前用户的产品服务；二进制只来自已提升的本程序副本，账户固定 LocalSystem。
        unsafe {
            ChangeServiceConfigW(
                service.0,
                SERVICE_WIN32_OWN_PROCESS,
                SERVICE_AUTO_START,
                SERVICE_ERROR_NORMAL,
                PCWSTR(command.as_ptr()),
                PCWSTR::null(),
                None,
                PCWSTR::null(),
                PCWSTR::null(),
                PCWSTR::null(),
                PCWSTR(name.as_ptr()),
            )
        }
        .map_err(|error| IsolationError::new("account_install_update", error.to_string()))?;
        service
    } else {
        // SAFETY: 固定 quoted image path；无用户命令/工作目录参数，默认 LocalSystem 只执行租约服务。
        ServiceHandle(
            unsafe {
                CreateServiceW(
                    manager.0,
                    PCWSTR(name.as_ptr()),
                    PCWSTR(name.as_ptr()),
                    SERVICE_ALL_ACCESS,
                    SERVICE_WIN32_OWN_PROCESS,
                    SERVICE_AUTO_START,
                    SERVICE_ERROR_NORMAL,
                    PCWSTR(command.as_ptr()),
                    PCWSTR::null(),
                    None,
                    PCWSTR::null(),
                    PCWSTR::null(),
                    PCWSTR::null(),
                )
            }
            .map_err(|error| IsolationError::new("account_install_create", error.to_string()))?,
        )
    };
    // SAFETY: 服务初始化参数已经固定在 ImagePath，启动不接收外部参数。
    unsafe { StartServiceW(service.0, None) }
        .map_err(|error| IsolationError::new("account_install_start", error.to_string()))?;
    wait_for(&service, SERVICE_RUNNING)
}

pub(crate) fn has_registration(owner: &OwnerIdentity) -> IsolationResult<bool> {
    srt_win::reg::Key::open(&owner.registry_path(), false)
        .map(|key| key.is_some())
        .map_err(|error| IsolationError::new("account_install_registration", error.to_string()))
}

pub fn uninstall(owner_sid: String) -> IsolationResult<()> {
    let owner = OwnerIdentity::parse(owner_sid)?;
    let manager = manager(SC_MANAGER_CONNECT)?;
    let service = open(&manager, &owner, SERVICE_ALL_ACCESS)?;
    if let Some(service) = &service {
        stop(service)?;
    }
    // SCM 项也可能已被删除；只要账户日志仍在，就必须先回收，不能连恢复依据一起删掉。
    if has_registration(&owner)? {
        coordinator::recover(&owner)?;
    }
    // 初始化或卸载可能在任一步被中断；只按真实存在的产品资源继续，不能把读取错误当作缺失。
    if let Some(sid) = crate::ambient_read::existing_group(&owner)? {
        crate::ambient_read::remove(&owner, &sid)?;
        srt_win::user::remove_logon_denials(&sid)
            .and_then(|()| srt_win::sam::delete_local_group(&owner.group_name()))
            .map_err(|error| IsolationError::new("account_uninstall_group", error.to_string()))?;
    }
    if let Some(service) = service {
        // SAFETY: 服务已停止且本用户租约已清理，删除仅标记此产品服务。
        unsafe { DeleteService(service.0) }
            .map_err(|error| IsolationError::new("account_uninstall_service", error.to_string()))?;
    }
    srt_win::reg::delete_subtree(&owner.registry_path())
        .map_err(|error| IsolationError::new("account_uninstall_journal", error.to_string()))?;
    match std::fs::remove_dir_all(installation_directory(&owner)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(IsolationError::new(
            "account_uninstall_files",
            error.to_string(),
        )),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallationStatus {
    Ready,
    SetupRequired,
}

/// 状态查询不申请账户、不更改系统配置，也不把权限/读盘失败误报成未安装。
pub fn installation_status() -> IsolationResult<InstallationStatus> {
    let owner = OwnerIdentity::current()?;
    let manager = manager(SC_MANAGER_CONNECT)?;
    let Some(service) = open(&manager, &owner, SERVICE_QUERY_STATUS)? else {
        return Ok(InstallationStatus::SetupRequired);
    };
    let mut status = SERVICE_STATUS::default();
    // SAFETY: 查询句柄与输出结构有效，不要求管理员权限。
    unsafe { QueryServiceStatus(service.0, &mut status) }
        .map_err(|error| IsolationError::new("account_setup_status", error.to_string()))?;
    if status.dwCurrentState != SERVICE_RUNNING {
        return Ok(InstallationStatus::SetupRequired);
    }
    let source = std::env::current_exe()
        .and_then(std::fs::read)
        .map_err(|error| IsolationError::new("account_setup_source", error.to_string()))?;
    let installed =
        std::fs::read(installation_directory(&owner)?.join("linnya-command-isolation.exe"))
            .map_err(|error| IsolationError::new("account_setup_installed", error.to_string()))?;
    if source != installed {
        return Ok(InstallationStatus::SetupRequired);
    }
    crate::client::inspect(&owner)?;
    Ok(if crate::ambient_read::is_ready(&owner)? {
        InstallationStatus::Ready
    } else {
        InstallationStatus::SetupRequired
    })
}
