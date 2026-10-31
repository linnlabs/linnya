use serde::{Deserialize, Serialize};
use srt_win::{reg::Key, sid::LocalPsid};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SHARING_VIOLATION};
use windows::Win32::NetworkManagement::NetManagement::{
    NERR_UserNotFound, NetApiBufferFree, NetUserAdd, NetUserDel, NetUserGetInfo,
    UF_DONT_EXPIRE_PASSWD, UF_SCRIPT, USER_INFO_1, USER_INFO_23, USER_PRIV_USER,
};
use windows::Win32::Security::Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom};
use windows::Win32::UI::Shell::DeleteProfileW;
use windows::core::{PCWSTR, PWSTR};
use zeroize::Zeroizing;

use crate::{IsolationError, IsolationResult, identity::OwnerIdentity, journal::AccountRecord};

const LOGON_USER_LIST: &str =
    r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList";

// 不派生 Debug；序列化只用于送往已认证的本机 Host，不能进入日志。
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AccountCredentials {
    pub(crate) name: String,
    pub(crate) sid: String,
    pub(crate) password: Zeroizing<String>,
}

pub(crate) struct NewAccount {
    pub(crate) record: AccountRecord,
    password: Zeroizing<String>,
}

pub(crate) struct CreatedAccount(NewAccount);

fn account_comment(owner: &OwnerIdentity, lease_id: &str) -> String {
    format!("Linnya command lease {lease_id} for {}", owner.sid())
}

pub(crate) fn prepare_account(
    owner_pid: u32,
    owner_created_at: u64,
) -> IsolationResult<NewAccount> {
    let mut random = Zeroizing::new([0u8; 48]);
    // SAFETY: Windows 只写入有效的本地数组；使用系统 CSPRNG，无算法 provider 的句柄生命周期。
    let status = unsafe { BCryptGenRandom(None, &mut *random, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status.0 < 0 {
        return Err(IsolationError::new(
            "account_random",
            format!("NTSTATUS={}", status.0),
        ));
    }
    let lease_id: String = random[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let account_name = format!("LyCmd_{}", &lease_id[..12]);
    // 固定前缀满足 Windows 的字符类别要求；随机部分独立于公开的 lease ID。
    let mut password = Zeroizing::new(String::from("Aa1!"));
    for byte in &random[16..] {
        use std::fmt::Write;
        write!(&mut *password, "{byte:02x}")
            .map_err(|_| IsolationError::new("account_password", "password generation failed"))?;
    }
    Ok(NewAccount {
        record: AccountRecord {
            lease_id,
            account_name,
            account_sid: None,
            owner_pid,
            owner_created_at,
        },
        password,
    })
}

/// 调用前先持久化 record；中途失败后仍可凭 SID/comment 核验并回收，不能直接抹掉恢复记录。
pub(crate) fn create_account(
    owner: &OwnerIdentity,
    account: NewAccount,
) -> IsolationResult<CreatedAccount> {
    let mut name = srt_win::util::wstr(&account.record.account_name);
    let mut password = Zeroizing::new(srt_win::util::wstr(&account.password));
    let mut comment = srt_win::util::wstr(&account_comment(owner, &account.record.lease_id));
    let info = USER_INFO_1 {
        usri1_name: PWSTR(name.as_mut_ptr()),
        usri1_password: PWSTR(password.as_mut_ptr()),
        usri1_priv: USER_PRIV_USER,
        usri1_comment: PWSTR(comment.as_mut_ptr()),
        usri1_flags: UF_SCRIPT | UF_DONT_EXPIRE_PASSWD,
        ..Default::default()
    };
    // SAFETY: level=1 与 USER_INFO_1 对应，UTF-16 buffers 在同步调用完成前均存活。
    let status = unsafe {
        NetUserAdd(
            PCWSTR::null(),
            1,
            (&info as *const USER_INFO_1).cast(),
            None,
        )
    };
    if status != 0 {
        // 已存在也拒绝，绝不接管同名账户或修改其口令。
        return Err(IsolationError::new(
            "account_create",
            format!("win32_error={status}"),
        ));
    }
    Ok(CreatedAccount(account))
}

pub(crate) fn configure_account(
    owner: &OwnerIdentity,
    account: CreatedAccount,
) -> IsolationResult<AccountCredentials> {
    let account = account.0;
    let sid = srt_win::sid::lookup_account_sid(&account.record.account_name)
        .map_err(|error| IsolationError::new("account_sid", error.to_string()))?;
    let parsed_sid = LocalPsid::from_string(&sid)
        .map_err(|error| IsolationError::new("account_sid", error.to_string()))?;
    let users_group = srt_win::sid::lookup_account_name("S-1-5-32-545")
        .map_err(|error| IsolationError::new("account_users_group", error.to_string()))?;
    for group in [users_group, owner.group_name()] {
        srt_win::sam::add_member(&group, &parsed_sid)
            .map_err(|error| IsolationError::new("account_membership", error.to_string()))?;
    }
    let (logon_users, _) = Key::create(LOGON_USER_LIST, None)
        .map_err(|error| IsolationError::new("account_logon_visibility", error.to_string()))?;
    logon_users
        .set_dword(&account.record.account_name, 0)
        .map_err(|error| IsolationError::new("account_logon_visibility", error.to_string()))?;
    Ok(AccountCredentials {
        name: account.record.account_name,
        sid,
        password: account.password,
    })
}

pub(crate) fn observe_account(name: &str) -> IsolationResult<Option<(String, String)>> {
    let name = srt_win::util::wstr(name);
    let mut raw = std::ptr::null_mut();
    // SAFETY: level=23 返回 USER_INFO_23；raw 是有效输出地址，成功后用 NetApiBufferFree 释放。
    let status = unsafe { NetUserGetInfo(PCWSTR::null(), PCWSTR(name.as_ptr()), 23, &mut raw) };
    if status == NERR_UserNotFound {
        return Ok(None);
    }
    if status != 0 {
        return Err(IsolationError::new(
            "account_observe",
            format!("win32_error={status}"),
        ));
    }
    // SAFETY: NetUserGetInfo 成功，raw 指向系统分配并对齐的 USER_INFO_23；复制完成前不释放。
    let info = unsafe { &*raw.cast::<USER_INFO_23>() };
    let sid = srt_win::sid::psid_to_string(info.usri23_user_sid)
        .map_err(|error| IsolationError::new("account_observe_sid", error.to_string()));
    let comment = if info.usri23_comment.is_null() {
        Ok(String::new())
    } else {
        // SAFETY: usri23_comment 是同一 NetAPI buffer 内由系统返回的 NUL 结尾字符串。
        unsafe { info.usri23_comment.to_string() }
            .map_err(|_| IsolationError::new("account_observe_comment", "invalid account comment"))
    };
    // SAFETY: raw 由本次 NetUserGetInfo 分配，所有所需内容已经复制或转换为独立错误。
    unsafe {
        let _ = NetApiBufferFree(Some(raw.cast()));
    }
    Ok(Some((sid?, comment?)))
}

pub(crate) enum AccountCleanupProgress {
    Removed,
    ProfileUnloading,
}

pub(crate) fn remove_account(
    owner: &OwnerIdentity,
    record: &AccountRecord,
) -> IsolationResult<AccountCleanupProgress> {
    let Some((sid, comment)) = observe_account(&record.account_name)? else {
        return Ok(AccountCleanupProgress::Removed);
    };
    if comment != account_comment(owner, &record.lease_id)
        || record
            .account_sid
            .as_ref()
            .is_some_and(|expected| expected != &sid)
    {
        return Err(IsolationError::new(
            "account_cleanup_identity",
            "account ownership does not match lease",
        ));
    }
    let sid_wide = srt_win::util::wstr(&sid);
    // SAFETY: SID 来自核验过的账户；路径为空让 Windows 通过该 SID 定位 profile，不接受外来路径。
    let profile_result =
        unsafe { DeleteProfileW(PCWSTR(sid_wide.as_ptr()), PCWSTR::null(), PCWSTR::null()) };
    // Secondary Logon 的 profile 卸载晚于进程 signaled/Job 清空。只把真实观测到的
    // sharing violation 作为待完成阶段，不能删除账户后遗留仍加载的 profile。
    if profile_result
        .as_ref()
        .is_err_and(|error| error.code() == ERROR_SHARING_VIOLATION.to_hresult())
    {
        return Ok(AccountCleanupProgress::ProfileUnloading);
    }
    if let Err(error) = profile_result
        && error.code() != ERROR_FILE_NOT_FOUND.to_hresult()
    {
        return Err(IsolationError::new(
            "account_profile_cleanup",
            error.to_string(),
        ));
    }
    // 隐藏标记先删，账户后删；中途退出仍能用现存账户核验并继续，不留下无主注册表项。
    if let Some(key) = Key::open(LOGON_USER_LIST, true)
        .map_err(|error| IsolationError::new("account_visibility_cleanup", error.to_string()))?
    {
        srt_win::reg::delete_value(&key, &record.account_name).map_err(|error| {
            IsolationError::new("account_visibility_cleanup", error.to_string())
        })?;
    }
    let name = srt_win::util::wstr(&record.account_name);
    // SAFETY: 账户已按 SID/comment 核验，name 在同步调用期间保持存活。
    let status = unsafe { NetUserDel(PCWSTR::null(), PCWSTR(name.as_ptr())) };
    if status != 0 && status != NERR_UserNotFound {
        return Err(IsolationError::new(
            "account_delete",
            format!("win32_error={status}"),
        ));
    }
    Ok(AccountCleanupProgress::Removed)
}
