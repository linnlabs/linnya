use std::mem::{size_of, size_of_val};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{
    ERROR_ALREADY_EXISTS, ERROR_FILE_NOT_FOUND, GetLastError, HANDLE,
};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
use windows::Win32::System::JobObjects::{
    CreateJobObjectW, JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation, OpenJobObjectW,
    QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
};
use windows::Win32::System::SystemServices::{JOB_OBJECT_QUERY, JOB_OBJECT_TERMINATE};
use windows::core::PCWSTR;

use crate::{IsolationError, IsolationResult, identity::OwnerIdentity};

/// 服务与 native owner 保活两个独立 Job；只有 worker 可以 breakaway 进入固定的命令 Job。
pub(crate) struct LeaseJob(OwnedHandle);

#[derive(Clone, Copy)]
pub(crate) enum JobPurpose {
    Command,
    Worker,
}

pub(crate) fn job_name(owner: &OwnerIdentity, lease_id: &str, purpose: JobPurpose) -> String {
    format!(
        r"Global\Linnya.CommandIsolation.{}.{}.{}",
        owner.sid(),
        lease_id,
        match purpose {
            JobPurpose::Command => "command",
            JobPurpose::Worker => "worker",
        }
    )
}

impl LeaseJob {
    pub(crate) fn create(
        owner: &OwnerIdentity,
        lease_id: &str,
        purpose: JobPurpose,
    ) -> IsolationResult<Self> {
        let sddl = srt_win::util::wstr(&format!(
            "O:SYG:SYD:P(A;;GA;;;SY)(A;;GA;;;{})S:(ML;;NW;;;ME)",
            owner.sid()
        ));
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        // SAFETY: SID 已规范化，SDDL 为固定授权模板；系统分配的描述符交给 RAII owner。
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(sddl.as_ptr()),
                SDDL_REVISION_1,
                &mut descriptor,
                None,
            )
        }
        .map_err(|error| IsolationError::new("account_job_security", error.to_string()))?;
        let _descriptor = srt_win::util::OwnedSd::from_raw(descriptor);
        let security = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: false.into(),
        };
        let name = srt_win::util::wstr(&job_name(owner, lease_id, purpose));
        // SAFETY: 名字与描述符存活到调用结束；句柄不继承给隔离命令。
        let handle = unsafe { CreateJobObjectW(Some(&security), PCWSTR(name.as_ptr())) }
            .map_err(|error| IsolationError::new("account_job_create", error.to_string()))?;
        // SAFETY: 必须在其他 Win32 调用前取得本次 create 的状态；句柄随后立即交给 RAII。
        let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        // SAFETY: create 成功，新返回的 handle 由标准库独占关闭。
        let job = Self(unsafe { OwnedHandle::from_raw_handle(handle.0) });
        if existed {
            return Err(IsolationError::new(
                "account_job_create",
                "lease Job already exists",
            ));
        }
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if matches!(purpose, JobPurpose::Worker) {
            limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        }
        // SAFETY: 结构和长度对应 JobObjectExtendedLimitInformation；命令 Job 不允许 breakaway，控制 worker 只用于原子派生进入命令 Job。
        unsafe {
            SetInformationJobObject(
                job.handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of_val(&limits) as u32,
            )
        }
        .map_err(|error| IsolationError::new("account_job_limits", error.to_string()))?;
        Ok(job)
    }

    pub(crate) fn open_existing(
        owner: &OwnerIdentity,
        lease_id: &str,
        purpose: JobPurpose,
    ) -> IsolationResult<Option<Self>> {
        let name = srt_win::util::wstr(&job_name(owner, lease_id, purpose));
        // SAFETY: 只打开服务日志中属于此 owner 的租约 Job；不接受客户端传来的任意对象名。
        match unsafe {
            OpenJobObjectW(
                JOB_OBJECT_QUERY | JOB_OBJECT_TERMINATE,
                false,
                PCWSTR(name.as_ptr()),
            )
        } {
            Ok(handle) => {
                // SAFETY: 成功取得独占引用，交给标准库关闭。
                Ok(Some(Self(unsafe {
                    OwnedHandle::from_raw_handle(handle.0)
                })))
            }
            Err(error) if error.code() == ERROR_FILE_NOT_FOUND.to_hresult() => Ok(None),
            Err(error) => Err(IsolationError::new(
                "account_job_recover",
                error.to_string(),
            )),
        }
    }

    fn handle(&self) -> HANDLE {
        HANDLE(self.0.as_raw_handle())
    }

    pub(crate) fn is_tree_empty(&self) -> IsolationResult<bool> {
        let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        // SAFETY: self 保活 Job，输出结构与对应信息类的长度一致。
        unsafe {
            QueryInformationJobObject(
                Some(self.handle()),
                JobObjectBasicAccountingInformation,
                (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of_val(&accounting) as u32,
                None,
            )
        }
        .map_err(|error| IsolationError::new("account_job_observe", error.to_string()))?;
        Ok(accounting.ActiveProcesses == 0)
    }

    pub(crate) fn terminate_and_observe(&self) -> IsolationResult<()> {
        // SAFETY: 只终止这个租约 Job；不会根据客户端提交的 PID 终止外部进程。
        unsafe { TerminateJobObject(self.handle(), 1) }
            .map_err(|error| IsolationError::new("account_job_terminate", error.to_string()))?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while !self.is_tree_empty()? {
            if Instant::now() >= deadline {
                return Err(IsolationError::new(
                    "account_job_cleanup",
                    "command tree is still active",
                ));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }
}
