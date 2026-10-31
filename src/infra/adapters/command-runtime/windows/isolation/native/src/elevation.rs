use crate::{
    IsolationError, IsolationResult,
    identity::OwnerIdentity,
    installation::{InstallationStatus, installation_status},
};
use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use windows::Win32::Foundation::{ERROR_CANCELLED, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Com::{
    COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize,
};
use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
use windows::Win32::UI::Shell::{
    SEE_MASK_NO_CONSOLE, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    ShellExecuteExW,
};
use windows::core::PCWSTR;

#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EnableResult {
    Ready,
    Cancelled,
}

struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: 本函数只在 helper 主线程初始化 COM，并在同线程配对释放。
        unsafe {
            CoUninitialize();
        }
    }
}

/// 无外部参数：提升前固定真实用户 SID，只允许安装当前已校验 helper 自己。
/// 管理员输入另一个账户时，产品仍为原始用户初始化，不误用提升后的身份。
pub fn enable_current_user() -> IsolationResult<EnableResult> {
    let owner = OwnerIdentity::current()?;
    if !run_elevated(&owner, ElevatedAction::Install)? {
        return Ok(EnableResult::Cancelled);
    }
    crate::ambient_read::configure_current_user()?;
    match installation_status()? {
        InstallationStatus::Ready => Ok(EnableResult::Ready),
        InstallationStatus::SetupRequired => Err(IsolationError::new(
            "account_enable_verify",
            "installation is not ready",
        )),
    }
}

/// 卸载器从原始用户调用；从未启用时不弹 UAC，取消时保留应用及恢复工具。
pub fn disable_current_user() -> IsolationResult<bool> {
    let owner = OwnerIdentity::current()?;
    if crate::installation::has_registration(&owner)?
        && !run_elevated(&owner, ElevatedAction::Uninstall)?
    {
        return Ok(false);
    }
    crate::filesystem::cleanup_current_user_filesystem()?;
    Ok(true)
}

enum ElevatedAction {
    Install,
    Uninstall,
}

fn run_elevated(owner: &OwnerIdentity, action: ElevatedAction) -> IsolationResult<bool> {
    let executable = std::env::current_exe()
        .map_err(|error| IsolationError::new("account_enable_path", error.to_string()))?;
    let executable = executable
        .to_str()
        .ok_or_else(|| IsolationError::new("account_enable_path", "invalid executable path"))?;
    let file = srt_win::util::wstr(executable);
    let verb = srt_win::util::wstr("runas");
    let mode = match action {
        ElevatedAction::Install => "install",
        ElevatedAction::Uninstall => "uninstall",
    };
    let parameters = srt_win::util::wstr(&format!("{mode} {}", owner.sid()));
    // SAFETY: helper 独立主线程尚未初始化 COM，没有 loader lock。
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) }
        .ok()
        .map_err(|error| IsolationError::new("account_enable_com", error.to_string()))?;
    let _apartment = Apartment;
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_NO_CONSOLE,
        lpFile: PCWSTR(file.as_ptr()),
        lpVerb: PCWSTR(verb.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        nShow: 0, // SW_HIDE；只有 Windows 的 UAC 显示给用户。
        ..Default::default()
    };
    // SAFETY: 所有 UTF-16 参数在同步 Shell 调用期间保活，启动对象固定为本程序。
    if let Err(error) = unsafe { ShellExecuteExW(&mut info) } {
        if error.code() == ERROR_CANCELLED.to_hresult() {
            return Ok(false);
        }
        return Err(IsolationError::new("account_enable_uac", error.to_string()));
    }
    if info.hProcess.is_invalid() {
        return Err(IsolationError::new(
            "account_enable_process",
            "installer process is missing",
        ));
    }
    // SAFETY: Shell 交付本次唯一 installer 句柄，立即移交 RAII。
    let process = unsafe { OwnedHandle::from_raw_handle(info.hProcess.0) };
    // SAFETY: 安装流程已有 SCM 有界等待，这里仅等待本次安装进程；不结束其他安装/命令。
    if unsafe { WaitForSingleObject(HANDLE(process.as_raw_handle()), 180_000) } != WAIT_OBJECT_0 {
        return Err(IsolationError::new(
            "account_enable_wait",
            "setup did not finish within three minutes",
        ));
    }
    let mut code = 1;
    // SAFETY: 已观察到本次进程退出，输出地址有效。
    unsafe { GetExitCodeProcess(HANDLE(process.as_raw_handle()), &mut code) }
        .map_err(|error| IsolationError::new("account_enable_exit", error.to_string()))?;
    if code != 0 {
        return Err(IsolationError::new(
            "account_enable_install",
            format!("installer exit={code}"),
        ));
    }
    Ok(true)
}
