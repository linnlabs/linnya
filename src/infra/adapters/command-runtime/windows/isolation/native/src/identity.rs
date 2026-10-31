use srt_win::sid::LocalPsid;

use crate::{IsolationError, IsolationResult};

/// 每个真实 Windows 用户有独立的账户组与服务实例，不能把不同用户的文件读取授权合并。
#[derive(Clone)]
pub(crate) struct OwnerIdentity {
    sid: String,
}

impl OwnerIdentity {
    pub(crate) fn parse(sid: String) -> IsolationResult<Self> {
        // SID 同时用于 SCM、管道及注册表名字。先按 Win32 SID 合同解析，不能接纳路径片段。
        let parsed = LocalPsid::from_string(&sid)
            .map_err(|_| IsolationError::new("owner_identity", "invalid Windows user SID"))?;
        let canonical = srt_win::sid::psid_to_string(parsed.as_psid())
            .map_err(|error| IsolationError::new("owner_identity", error.to_string()))?;
        Ok(Self { sid: canonical })
    }

    pub(crate) fn current() -> IsolationResult<Self> {
        Self::parse(
            srt_win::sid::current_user_sid()
                .map_err(|error| IsolationError::new("owner_identity", error.to_string()))?,
        )
    }

    pub(crate) fn sid(&self) -> &str {
        &self.sid
    }

    pub(crate) fn service_name(&self) -> String {
        format!("LinnyaCommandIsolation-{}", self.sid)
    }

    pub(crate) fn pipe_name(&self) -> String {
        format!(r"\\.\pipe\Linnya.CommandIsolation.{}", self.sid)
    }

    pub(crate) fn group_name(&self) -> String {
        format!("LinnyaCommandSandbox-{}", self.sid)
    }

    pub(crate) fn registry_path(&self) -> String {
        format!(r"SOFTWARE\Linnlabs\CommandIsolation\{}", self.sid)
    }
}
