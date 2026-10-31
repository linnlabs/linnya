use std::fs::File;
use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::time::{Duration, Instant};

use srt_win::util::OwnedSd;
use windows::Win32::Foundation::{ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED, HANDLE};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SDDL_REVISION_1,
    SE_KERNEL_OBJECT,
};
use windows::Win32::Security::{
    OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES,
};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_GENERIC_READ, FILE_SHARE_MODE,
    FILE_WRITE_DATA, OPEN_EXISTING, PIPE_ACCESS_DUPLEX, SECURITY_IDENTIFICATION,
    SECURITY_SQOS_PRESENT,
};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT, WaitNamedPipeW,
};
use windows::core::PCWSTR;

use crate::{IsolationError, IsolationResult, identity::OwnerIdentity};

pub(crate) struct AccountListener {
    owner: OwnerIdentity,
    pending: OwnedHandle,
}

impl AccountListener {
    pub(crate) fn bind(owner: OwnerIdentity) -> IsolationResult<Self> {
        let pending = create_server_pipe(&owner, true)?;
        Ok(Self { owner, pending })
    }

    pub(crate) fn accept(&mut self) -> IsolationResult<File> {
        // SAFETY: pending 保活服务器端句柄；同步 byte pipe 不传 OVERLAPPED。
        let result = unsafe { ConnectNamedPipe(HANDLE(self.pending.as_raw_handle()), None) };
        if let Err(error) = result
            && error.code() != ERROR_PIPE_CONNECTED.to_hresult()
        {
            return Err(IsolationError::new(
                "account_pipe_accept",
                error.to_string(),
            ));
        }
        // 交出已连接实例之前先建立下一个，整个服务生命周期始终占有管道名。
        let next = create_server_pipe(&self.owner, false)?;
        Ok(File::from(std::mem::replace(&mut self.pending, next)))
    }
}

fn create_server_pipe(owner: &OwnerIdentity, first: bool) -> IsolationResult<OwnedHandle> {
    // FILE_GENERIC_WRITE 会包含 FILE_CREATE_PIPE_INSTANCE。只授予字节写入，不能让客户端加开假服务器。
    let client_access = FILE_GENERIC_READ.0 | FILE_WRITE_DATA.0;
    let sddl = srt_win::util::wstr(&format!(
        "O:SYG:SYD:P(A;;GA;;;SY)(A;;0x{client_access:x};;;{})",
        owner.sid()
    ));
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // SAFETY: SDDL 由已解析的 SID 和固定权限构造；输出描述符由系统分配。
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl.as_ptr()),
            SDDL_REVISION_1,
            &mut descriptor,
            None,
        )
    }
    .map_err(|error| IsolationError::new("account_pipe_security", error.to_string()))?;
    let _descriptor_owner = OwnedSd::from_raw(descriptor);
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: false.into(),
    };
    let name = srt_win::util::wstr(&owner.pipe_name());
    let mut mode = PIPE_ACCESS_DUPLEX;
    if first {
        mode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
    }
    // SAFETY: 名称和 SECURITY_ATTRIBUTES 存活至调用返回；客户端不能继承服务句柄，远程连接被内核拒绝。
    let handle = unsafe {
        CreateNamedPipeW(
            PCWSTR(name.as_ptr()),
            mode,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_UNLIMITED_INSTANCES,
            16 * 1024,
            16 * 1024,
            3000,
            Some(&security),
        )
    };
    if handle.is_invalid() {
        return Err(IsolationError::new(
            "account_pipe_bind",
            windows::core::Error::from_thread().to_string(),
        ));
    }
    // SAFETY: CreateNamedPipeW 返回有效独占句柄，立即移交标准库关闭。
    Ok(unsafe { OwnedHandle::from_raw_handle(handle.0) })
}

pub(crate) fn connect(owner: &OwnerIdentity) -> IsolationResult<File> {
    let name = srt_win::util::wstr(&owner.pipe_name());
    let deadline = Instant::now() + Duration::from_secs(3);
    let handle = loop {
        // SAFETY: 名称固定为本机管道；只给服务器识别身份，不允许它 impersonate 用户修改文件。
        let result = unsafe {
            CreateFileW(
                PCWSTR(name.as_ptr()),
                FILE_GENERIC_READ.0 | FILE_WRITE_DATA.0,
                FILE_SHARE_MODE(0),
                None,
                OPEN_EXISTING,
                SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                None,
            )
        };
        match result {
            Ok(handle) => break handle,
            Err(error)
                if error.code() == ERROR_PIPE_BUSY.to_hresult() && Instant::now() < deadline =>
            {
                let remaining = deadline
                    .saturating_duration_since(Instant::now())
                    .as_millis()
                    .max(1) as u32;
                // SAFETY: 有界等待下一个 server instance；并行连接可能抢先取得实例，所以重新 open。
                if !unsafe { WaitNamedPipeW(PCWSTR(name.as_ptr()), remaining) }.as_bool() {
                    return Err(IsolationError::new(
                        "account_pipe_wait",
                        windows::core::Error::from_thread().to_string(),
                    ));
                }
            }
            Err(error) => {
                return Err(IsolationError::new(
                    "account_pipe_connect",
                    error.to_string(),
                ));
            }
        }
    };
    // SAFETY: CreateFileW 成功，独占管道句柄交给 File；后续核验失败也会关闭。
    let file = unsafe { File::from_raw_handle(handle.0) };
    verify_system_owner(handle)?;
    Ok(file)
}

fn verify_system_owner(pipe: HANDLE) -> IsolationResult<()> {
    let mut owner = PSID::default();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // SAFETY: pipe 由调用者保活，输出 owner 指向同时返回的描述符。
    let status = unsafe {
        GetSecurityInfo(
            pipe,
            SE_KERNEL_OBJECT,
            OWNER_SECURITY_INFORMATION,
            Some(&mut owner),
            None,
            None,
            None,
            Some(&mut descriptor),
        )
    };
    if status.is_err() {
        return Err(IsolationError::new(
            "account_pipe_owner",
            format!("win32_error={}", status.0),
        ));
    }
    let _descriptor_owner = OwnedSd::from_raw(descriptor);
    let sid = srt_win::sid::psid_to_string(owner)
        .map_err(|error| IsolationError::new("account_pipe_owner", error.to_string()))?;
    if sid != "S-1-5-18" {
        return Err(IsolationError::new(
            "account_pipe_owner",
            "account server is not owned by LocalSystem",
        ));
    }
    Ok(())
}
