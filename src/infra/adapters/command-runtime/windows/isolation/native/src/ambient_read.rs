use crate::{IsolationError, IsolationResult, identity::OwnerIdentity};
use srt_win::acl::{GrantMask, Mask, OICI, SbAceSet, apply_sandbox_aces, read_aces};
use srt_win::reg::Key;
use std::path::PathBuf;
use windows::Win32::NetworkManagement::NetManagement::{
    NERR_GroupNotFound, NetApiBufferFree, NetLocalGroupGetInfo,
};
use windows::core::PCWSTR;

fn profile(owner: &OwnerIdentity) -> IsolationResult<PathBuf> {
    // 用户目录来自 Windows 的管理员拥有的 profile 登记，不接受提升请求中的任意路径。
    let key = Key::open(
        &format!(
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\{}",
            owner.sid()
        ),
        false,
    )
    .map_err(|error| IsolationError::new("ambient_profile", error.to_string()))?
    .ok_or_else(|| {
        IsolationError::new("ambient_profile", "Windows profile registration is missing")
    })?;
    let path = key
        .get_sz("ProfileImagePath")
        .map_err(|error| IsolationError::new("ambient_profile", error.to_string()))?
        .ok_or_else(|| IsolationError::new("ambient_profile", "Windows profile path is missing"))?;
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(IsolationError::new(
            "ambient_profile",
            "absolute Windows profile path required",
        ));
    }
    std::fs::canonicalize(path)
        .map_err(|error| IsolationError::new("ambient_profile", error.to_string()))
}

fn group(owner: &OwnerIdentity) -> IsolationResult<String> {
    srt_win::sid::lookup_account_sid(&owner.group_name())
        .map_err(|error| IsolationError::new("ambient_group", error.to_string()))
}

pub(crate) fn existing_group(owner: &OwnerIdentity) -> IsolationResult<Option<String>> {
    let name = srt_win::util::wstr(&owner.group_name());
    let mut buffer = std::ptr::null_mut();
    // SAFETY: level 0 返回组名称，本次只检查存在性；成功分配的 buffer 立即释放。
    let status =
        unsafe { NetLocalGroupGetInfo(PCWSTR::null(), PCWSTR(name.as_ptr()), 0, &mut buffer) };
    if status == NERR_GroupNotFound {
        return Ok(None);
    }
    if status != 0 {
        return Err(IsolationError::new(
            "ambient_group",
            format!("win32_error={status}"),
        ));
    }
    // SAFETY: buffer 来自上述成功的 NetAPI 调用，本函数独占其释放责任。
    unsafe {
        let _ = NetApiBufferFree(Some(buffer.cast()));
    }
    group(owner).map(Some)
}

fn path_text(path: &std::path::Path) -> IsolationResult<&str> {
    path.to_str()
        .ok_or_else(|| IsolationError::new("ambient_profile", "invalid Windows profile path"))
}

pub(crate) fn is_ready(owner: &OwnerIdentity) -> IsolationResult<bool> {
    let sid = group(owner)?;
    let root = profile(owner)?;
    let entries = read_aces(path_text(&root)?)
        .map_err(|error| IsolationError::new("ambient_read_status", error.to_string()))?;
    Ok(entries.iter().any(|entry| {
        entry.sid == sid
            && !entry.deny
            && !entry.inherited
            && entry.mask == Mask::FILE_READ_EXEC.bits()
            && entry.flags == OICI.0 as u8
    }))
}

/// 每个真实用户只初始化一次普通文件的基础读取权限；它不是内部目录的例外批准。
/// 命令仍在逐项建立自身 SID 的内部拒绝后才能启动，获批命令的 SID 不会被其他调用复用。
pub fn configure_current_user() -> IsolationResult<()> {
    let owner = OwnerIdentity::current()?;
    crate::client::inspect(&owner)?;
    let root = profile(&owner)?;
    apply_sandbox_aces(
        path_text(&root)?,
        &group(&owner)?,
        SbAceSet {
            grant: Some(GrantMask::ReadOnly),
            ..Default::default()
        },
    )
    .map_err(|error| IsolationError::new("ambient_read_configure", error.to_string()))
}

pub(crate) fn require_current_user() -> IsolationResult<()> {
    if is_ready(&OwnerIdentity::current()?)? {
        Ok(())
    } else {
        Err(IsolationError::new(
            "ambient_read_setup",
            "Windows safe command setup is required",
        ))
    }
}

/// 卸载已先回收全部账户，再按系统登记的唯一用户目录撤销本组，不读取客户端提供的路径。
pub(crate) fn remove(owner: &OwnerIdentity, sid: &str) -> IsolationResult<()> {
    let root = profile(owner)?;
    apply_sandbox_aces(path_text(&root)?, sid, SbAceSet::default())
        .map_err(|error| IsolationError::new("ambient_read_remove", error.to_string()))
}
