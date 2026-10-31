use crate::{IsolationError, IsolationResult, identity::OwnerIdentity};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use windows::Win32::Foundation::{HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject};
use windows::core::PCWSTR;

/// 只保护 ACL 的 read-modify-write 和恢复记录提交，绝不跨越命令执行。
/// 同一用户的多个一次性 runner 必须使用同一个 mutex，否则 A/B 会相互覆盖 DACL。
pub(crate) struct FilesystemLock(OwnedHandle);

impl FilesystemLock {
    pub(crate) fn acquire() -> IsolationResult<Self> {
        let owner = OwnerIdentity::current()?;
        let name =
            srt_win::util::wstr(&format!("Global\\Linnya.CommandFilesystem.{}", owner.sid()));
        let security = srt_win::acl::build_allow_dacl(&[
            srt_win::acl::Allow(
                owner.sid(),
                srt_win::acl::Mask::GENERIC_ALL,
                srt_win::acl::NO_INHERIT,
            ),
            srt_win::acl::Allow(
                "S-1-5-18",
                srt_win::acl::Mask::GENERIC_ALL,
                srt_win::acl::NO_INHERIT,
            ),
        ])
        .and_then(|acl| acl.into_security_attributes())
        .map_err(|error| IsolationError::new("filesystem_lock_security", error.to_string()))?;
        // SAFETY: 固定规范化 owner 名称；只有本人和 SYSTEM 能持有该 mutex。
        let raw = unsafe { CreateMutexW(Some(security.as_ptr()), false, PCWSTR(name.as_ptr())) }
            .map_err(|error| IsolationError::new("filesystem_lock_open", error.to_string()))?;
        // SAFETY: 成功创建/打开的独占引用交给标准库。
        let handle = unsafe { OwnedHandle::from_raw_handle(raw.0) };
        // SAFETY: handle 保活 mutex；准备阶段有上限，避免阻塞 JS 或无限占用 native worker。
        let wait = unsafe { WaitForSingleObject(raw, 30_000) };
        // abandoned 表示前一 Host 已退出；后续操作仍读取并恢复持久记录，不把它当空。
        if wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED {
            return Err(IsolationError::new(
                "filesystem_lock_wait",
                format!("wait={}", wait.0),
            ));
        }
        Ok(Self(handle))
    }
}

impl Drop for FilesystemLock {
    fn drop(&mut self) {
        // SAFETY: 仅成功取得所有权的实例能构造；guard 不跨线程移动。
        unsafe {
            let _ = ReleaseMutex(HANDLE(self.0.as_raw_handle()));
        }
    }
}
