use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

use windows::Win32::Foundation::{FILETIME, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
use windows::Win32::System::Pipes::GetNamedPipeClientProcessId;
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE, WaitForSingleObject,
};

use crate::{IsolationError, IsolationResult, identity::OwnerIdentity};

pub(crate) struct CommandPeer {
    process: OwnedHandle,
    pub(crate) pid: u32,
    pub(crate) created_at: u64,
}

impl CommandPeer {
    pub(crate) fn authenticate(pipe: HANDLE, owner: &OwnerIdentity) -> IsolationResult<Self> {
        let mut pid = 0;
        // SAFETY: pipe 是已连接的本机 server handle，pid 是有效输出；不使用请求提供的 PID。
        unsafe { GetNamedPipeClientProcessId(pipe, &mut pid) }
            .map_err(|error| IsolationError::new("account_client_pid", error.to_string()))?;
        // SAFETY: 只查询已连接客户端的身份与生命周期；内核在 OpenProcess 中校验请求权限。
        let process = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                false,
                pid,
            )
        }
        .map_err(|error| IsolationError::new("account_client_process", error.to_string()))?;
        // SAFETY: OpenProcess 成功返回独占有效句柄，立即交给标准库 RAII owner。
        let process = unsafe { OwnedHandle::from_raw_handle(process.0) };
        if process_user_sid(HANDLE(process.as_raw_handle()))? != owner.sid() {
            return Err(IsolationError::new(
                "account_client_identity",
                "client is not the registered Windows user",
            ));
        }
        let created_at = process_creation_time(HANDLE(process.as_raw_handle()))?;
        Ok(Self {
            process,
            pid,
            created_at,
        })
    }

    pub(crate) fn owner_has_exited(&self) -> bool {
        // SAFETY: process 由 self 保活；零超时只检查状态，不阻塞账户协调线程。
        unsafe { WaitForSingleObject(HANDLE(self.process.as_raw_handle()), 0) == WAIT_OBJECT_0 }
    }
}

pub(crate) fn process_creation_time(process: HANDLE) -> IsolationResult<u64> {
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: 调用者保活 process，四个输出均为独立有效的 FILETIME。
    unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) }
        .map_err(|error| IsolationError::new("account_owner_creation", error.to_string()))?;
    Ok((u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
}

fn process_user_sid(process: HANDLE) -> IsolationResult<String> {
    let mut token = HANDLE::default();
    // SAFETY: process 由调用者保活；只读取用户身份，不取得 impersonation/adjust 权限。
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }
        .map_err(|error| IsolationError::new("account_client_token", error.to_string()))?;
    // SAFETY: OpenProcessToken 成功，独占句柄交给标准库关闭。
    let token = unsafe { OwnedHandle::from_raw_handle(token.0) };
    let mut bytes = 0;
    // SAFETY: 空 buffer 是 Win32 规定的容量查询；只使用写回的容量，不把预期失败当成功读取。
    unsafe {
        let _ = GetTokenInformation(
            HANDLE(token.as_raw_handle()),
            TokenUser,
            None,
            0,
            &mut bytes,
        );
    }
    if bytes < size_of::<TOKEN_USER>() as u32 {
        return Err(IsolationError::new(
            "account_client_token",
            "invalid token user size",
        ));
    }
    let mut storage = vec![0usize; (bytes as usize).div_ceil(size_of::<usize>())];
    // SAFETY: usize buffer 提供 TOKEN_USER/SID 对齐，容量不少于系统要求，读取期间保持存活。
    unsafe {
        GetTokenInformation(
            HANDLE(token.as_raw_handle()),
            TokenUser,
            Some(storage.as_mut_ptr().cast()),
            bytes,
            &mut bytes,
        )
    }
    .map_err(|error| IsolationError::new("account_client_token", error.to_string()))?;
    // SAFETY: 上一次调用成功完整写入 TokenUser，SID 字节仍位于保活的 storage 中。
    let user = unsafe { &*storage.as_ptr().cast::<TOKEN_USER>() };
    srt_win::sid::psid_to_string(user.User.Sid)
        .map_err(|error| IsolationError::new("account_client_sid", error.to_string()))
}
