use crate::{IsolationError, IsolationResult};
use std::path::Path;
use windows::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SE_FILE_OBJECT, SetSecurityInfo,
};
use windows::Win32::Security::{OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID};
use windows::core::PCWSTR;

/// 临时身份创建的产物要归还真实用户，否则 CREATOR OWNER 会不断重建已删除 SID 的 ACE。
/// 只处理本租约拥有的文件，不能接管已有用户文件或仍在运行的另一租约的产物。
pub(crate) fn reclaim(path: &Path, account_sid: &str, owner_sid: &str) -> IsolationResult<()> {
    let text = path
        .to_str()
        .ok_or_else(|| IsolationError::new("artifact_owner", "invalid path"))?;
    let wide = srt_win::util::wstr(text);
    let mut owner = PSID::default();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // SAFETY: 输出 SID 指向系统分配的 descriptor，转换完成前由 RAII 保活；只查询所有者。
    unsafe {
        GetNamedSecurityInfoW(
            PCWSTR(wide.as_ptr()),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            Some(&mut owner),
            None,
            None,
            None,
            &mut descriptor,
        )
    }
    .ok()
    .map_err(|error| IsolationError::new("artifact_owner_read", error.to_string()))?;
    let _descriptor = srt_win::util::OwnedSd::from_raw(descriptor);
    let current = srt_win::sid::psid_to_string(owner)
        .map_err(|error| IsolationError::new("artifact_owner_read", error.to_string()))?;
    if current != account_sid {
        return Ok(());
    }
    let file = srt_win::acl::open_for_security_no_follow(text)
        .map_err(|error| IsolationError::new("artifact_owner_open", error.to_string()))?;
    let real_user = srt_win::sid::LocalPsid::from_string(owner_sid)
        .map_err(|error| IsolationError::new("artifact_owner_identity", error.to_string()))?;
    // SAFETY: no-follow handle 保活本次文件对象；真实用户使用自己的 WRITE_OWNER 权限收回产物，
    // 不经 SYSTEM 服务、不开启特权，也不接受任意目标所有者。
    unsafe {
        SetSecurityInfo(
            file.raw(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            Some(real_user.as_psid()),
            None,
            None,
            None,
        )
    }
    .ok()
    .map_err(|error| IsolationError::new("artifact_owner_write", error.to_string()))?;
    // owner 修改不自动重算继承的 CREATOR OWNER。这里强制刷新该对象的继承，仍保留其他 SID。
    srt_win::acl::apply_sandbox_aces(text, account_sid, srt_win::acl::SbAceSet::default())
        .map_err(|error| IsolationError::new("artifact_owner_inheritance", error.to_string()))
}
