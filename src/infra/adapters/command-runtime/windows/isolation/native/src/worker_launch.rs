use crate::{AccountLease, IsolationError, IsolationResult};
use crate::{
    protocol::read_frame,
    worker_protocol::{WorkerHandles, WorkerProgram, WorkerStatus, write_program},
};
use std::fs::File;
use std::mem::size_of;
use std::os::windows::{
    ffi::OsStrExt,
    io::{AsRawHandle, FromRawHandle, OwnedHandle},
};
use std::path::Path;
use windows::Win32::Foundation::{DUPLICATE_SAME_ACCESS, DuplicateHandle};
use windows::Win32::Foundation::{
    GENERIC_READ, HANDLE, HANDLE_FLAG_INHERIT, HANDLE_FLAGS, SetHandleInformation,
};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_SHARE_MODE, FILE_WRITE_ATTRIBUTES,
    OPEN_EXISTING, PIPE_ACCESS_OUTBOUND, SECURITY_ANONYMOUS, SECURITY_SQOS_PRESENT,
};
use windows::Win32::System::JobObjects::{AssignProcessToJobObject, OpenJobObjectW};
use windows::Win32::System::Pipes::{
    CreateNamedPipeW, CreatePipe, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
    PIPE_WAIT,
};
use windows::Win32::System::SystemServices::JOB_OBJECT_SET_ATTRIBUTES;
use windows::Win32::System::SystemServices::{
    JOB_OBJECT_ASSIGN_PROCESS, JOB_OBJECT_QUERY, JOB_OBJECT_TERMINATE,
};
use windows::Win32::System::Threading::GetCurrentProcess;
use windows::Win32::System::Threading::ResumeThread;
use windows::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessWithLogonW,
    LOGON_WITH_PROFILE, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW, TerminateProcess,
};
use windows::core::{PCWSTR, PWSTR};
use zeroize::Zeroizing;

/// 隔离账户的 desktop 必须至少保活到 worker 已退出，不能在 CreateProcess 返回时关闭。
pub struct SuspendedWorker {
    pub lease: AccountLease,
    pub job: OwnedHandle,
    pub worker_job: OwnedHandle,
    pub handles: WorkerHandles,
    pub process: OwnedHandle,
    pub thread: OwnedHandle,
    pub stdin: File,
    pub stdout: File,
    pub stderr: File,
    pub status: File,
    pub terminal_input: Option<File>,
    pub desktop: WorkerDesktop,
}

/// Host 从不将自己的线程附着到这个 desktop；它只用于 worker 的 STARTUPINFO。
/// 私有字段禁止调用者在创建后拿到指针并改变这条约束。
pub struct WorkerDesktop {
    _desktop: srt_win::winsta::IsolatedDesk,
}

// SAFETY: desktop 是进程级 USER 对象；Host 从不调用 SetThreadDesktop，因而可以在
// 另一个 native worker 线程执行 CloseDesktop。移动不共享其可变名称缓冲区。
unsafe impl Send for WorkerDesktop {}

struct PipeEnds {
    host: File,
    worker: OwnedHandle,
}

fn output_pipe() -> IsolationResult<PipeEnds> {
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        bInheritHandle: true.into(),
        ..Default::default()
    };
    let mut read = HANDLE::default();
    let mut write = HANDLE::default();
    // SAFETY: 输出句柄地址有效，管道成功后立即转移到 RAII。
    unsafe { CreatePipe(&mut read, &mut write, Some(&security), 0) }
        .map_err(|error| IsolationError::new("worker_output_pipe", error.to_string()))?;
    // SAFETY: CreatePipe 的两个句柄互不相同，分别由 File/OwnedHandle 独占。
    let host = unsafe { File::from_raw_handle(read.0) };
    // SAFETY: 同上，worker 只得到写入的 client 端，不能 impersonate Host。
    let worker = unsafe { OwnedHandle::from_raw_handle(write.0) };
    // SAFETY: read 仍由 host 保活，只清除继承位。
    unsafe { SetHandleInformation(read, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) }
        .map_err(|error| IsolationError::new("worker_pipe_inheritance", error.to_string()))?;
    Ok(PipeEnds { host, worker })
}

fn control_pipe(lease: &AccountLease, purpose: &str) -> IsolationResult<PipeEnds> {
    // lease 的 128 位随机 ID 已体现在唯一 Job 名字；这里不采用可猜 PID 作为唯一名称。
    let name = srt_win::util::wstr(&format!(
        r"\\.\pipe\Linnya.Worker.{}.{}",
        purpose,
        lease.job_name.replace('\\', ".")
    ));
    let sid = srt_win::sid::current_user_sid()
        .map_err(|error| IsolationError::new("worker_pipe_identity", error.to_string()))?;
    let security = srt_win::acl::build_allow_dacl(&[srt_win::acl::Allow(
        &sid,
        srt_win::acl::Mask::FILE_ALL,
        srt_win::acl::NO_INHERIT,
    )])
    .and_then(|descriptor| descriptor.into_security_attributes())
    .map_err(|error| IsolationError::new("worker_pipe_security", error.to_string()))?;
    // SAFETY: Host 持有 outbound server，worker 只拿 client 读端；远端和第二实例均拒绝。
    let server = unsafe {
        CreateNamedPipeW(
            PCWSTR(name.as_ptr()),
            PIPE_ACCESS_OUTBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            64 * 1024,
            0,
            0,
            Some(security.as_ptr()),
        )
    };
    if server.is_invalid() {
        return Err(IsolationError::new(
            "worker_control_pipe",
            windows::core::Error::from_thread().to_string(),
        ));
    }
    // SAFETY: 有效的独占 server handle 交给 File。
    let host = unsafe { File::from_raw_handle(server.0) };
    // SAFETY: 本人刚创建的唯一管道；匿名 SQOS 禁止从 client impersonate 真实用户。
    let client = unsafe {
        CreateFileW(
            PCWSTR(name.as_ptr()),
            GENERIC_READ.0 | FILE_WRITE_ATTRIBUTES.0,
            FILE_SHARE_MODE(0),
            None,
            OPEN_EXISTING,
            SECURITY_SQOS_PRESENT | SECURITY_ANONYMOUS,
            None,
        )
    }
    .map_err(|error| IsolationError::new("worker_control_client", error.to_string()))?;
    // SAFETY: client 成功打开，立即交给标准库关闭。
    let worker = unsafe { OwnedHandle::from_raw_handle(client.0) };
    // SAFETY: 只有 client 端可交给 CPWLW，Host server 端始终不继承。
    unsafe { SetHandleInformation(client, HANDLE_FLAG_INHERIT.0, HANDLE_FLAG_INHERIT) }
        .map_err(|error| IsolationError::new("worker_control_inheritance", error.to_string()))?;
    Ok(PipeEnds { host, worker })
}

pub fn create_suspended_worker(
    helper: &Path,
    program: &WorkerProgram,
    lease: AccountLease,
) -> IsolationResult<SuspendedWorker> {
    let cwd = &program.cwd;
    if cwd.len() < 2 || cwd.last() != Some(&0) || cwd[..cwd.len() - 1].contains(&0) {
        return Err(IsolationError::new(
            "worker_cwd",
            "invalid Windows startup directory",
        ));
    }
    let name = srt_win::util::wstr(&lease.job_name);
    // SAFETY: Job 名来自经过 SYSTEM owner 核验的租约连接；只请求执行/观察/取消所需权限。
    let job = unsafe {
        OpenJobObjectW(
            JOB_OBJECT_ASSIGN_PROCESS
                | JOB_OBJECT_QUERY
                | JOB_OBJECT_TERMINATE
                | JOB_OBJECT_SET_ATTRIBUTES,
            false,
            PCWSTR(name.as_ptr()),
        )
    }
    .map_err(|error| IsolationError::new("worker_job_open", error.to_string()))?;
    // SAFETY: OpenJob 成功，标准库独占本进程引用。
    let job = unsafe { OwnedHandle::from_raw_handle(job.0) };
    let worker_name = srt_win::util::wstr(&lease.worker_job_name);
    // SAFETY: 第二个 Job 也来自同一已认证租约，只容纳可信 worker，不设置嵌套不支持的 UI 限制。
    let worker_job = unsafe {
        OpenJobObjectW(
            JOB_OBJECT_ASSIGN_PROCESS | JOB_OBJECT_QUERY | JOB_OBJECT_TERMINATE,
            false,
            PCWSTR(worker_name.as_ptr()),
        )
    }
    .map_err(|error| IsolationError::new("worker_job_open", error.to_string()))?;
    // SAFETY: 成功取得独占引用，标准库负责关闭。
    let worker_job = unsafe { OwnedHandle::from_raw_handle(worker_job.0) };
    let mut desktop = srt_win::winsta::IsolatedDesk::new(&lease.account_sid)
        .map_err(|error| IsolationError::new("worker_desktop_create", error.to_string()))?;
    // 只给稳定的本用户隔离组做会话对象授权，避免每个临时账户都留下一条 WinSta/BNO ACE。
    srt_win::winsta::grant_sandbox_on_winsta(&lease.group_sid).map_err(|error| {
        IsolationError::new("worker_window_station_access", format!("{error:#}"))
    })?;
    srt_win::winsta::grant_sandbox_on_session_bno(&lease.group_sid).map_err(|error| {
        IsolationError::new("worker_session_objects_access", format!("{error:#}"))
    })?;
    let input = control_pipe(&lease, "control")?;
    let terminal_input = if program.terminal.is_some() {
        Some(control_pipe(&lease, "terminal-input")?)
    } else {
        None
    };
    let output = output_pipe()?;
    let error = output_pipe()?;
    let status = output_pipe()?;
    let helper_text = helper
        .to_str()
        .ok_or_else(|| IsolationError::new("worker_helper", "invalid helper path"))?;
    let mut helper_wide: Vec<u16> = helper.as_os_str().encode_wide().collect();
    if helper_wide.contains(&0) {
        return Err(IsolationError::new(
            "worker_helper",
            "helper path contains NUL",
        ));
    }
    helper_wide.push(0);
    let mut command = srt_win::util::wstr(&format!(
        "{} worker",
        srt_win::launch::quote_arg(helper_text)
    ));
    let user = srt_win::util::wstr(&lease.account_name);
    let domain = srt_win::util::wstr(".");
    let password = Zeroizing::new(srt_win::util::wstr(&lease.password));
    let startup = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        dwFlags: STARTF_USESTDHANDLES,
        hStdInput: HANDLE(input.worker.as_raw_handle()),
        hStdOutput: HANDLE(output.worker.as_raw_handle()),
        hStdError: HANDLE(status.worker.as_raw_handle()),
        lpDesktop: PWSTR(desktop.desktop_name_ptr()),
        ..Default::default()
    };
    let mut process = PROCESS_INFORMATION::default();
    // SAFETY: 口令、UTF-16 路径及 stdio 均保活；CPWLW 只复制 stdio，不继承服务/Job/其他 Host 句柄。
    unsafe {
        CreateProcessWithLogonW(
            PCWSTR(user.as_ptr()),
            PCWSTR(domain.as_ptr()),
            PCWSTR(password.as_ptr()),
            LOGON_WITH_PROFILE,
            PCWSTR(helper_wide.as_ptr()),
            Some(PWSTR(command.as_mut_ptr())),
            CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
            None,
            PCWSTR(cwd.as_ptr()),
            &startup,
            &mut process,
        )
    }
    .map_err(|error| IsolationError::new("worker_logon", error.to_string()))?;
    // SAFETY: 成功返回的两个进程对象分别由标准库独占。
    let process_handle = unsafe { OwnedHandle::from_raw_handle(process.hProcess.0) };
    // SAFETY: 同上，主线程仍暂停，尚无用户代码执行。
    let thread = unsafe { OwnedHandle::from_raw_handle(process.hThread.0) };
    if let Err(error) =
        // SAFETY: 主线程尚未恢复；失败时显式终止，不接受“进不了 Job 就裸跑”的分支。
        unsafe {
            AssignProcessToJobObject(HANDLE(worker_job.as_raw_handle()), process.hProcess)
        }
    {
        // SAFETY: 只结束刚创建并保活的 worker；它还没有创建后代。
        unsafe {
            let _ = TerminateProcess(process.hProcess, 1);
        }
        return Err(IsolationError::new("worker_job_assign", error.to_string()));
    }
    let transferred = (|| {
        Ok(WorkerHandles {
            command_job: duplicate_to_worker(process.hProcess, HANDLE(job.as_raw_handle()))?,
            stderr: duplicate_to_worker(process.hProcess, HANDLE(error.worker.as_raw_handle()))?,
            terminal_input: terminal_input
                .as_ref()
                .map(|pipe| {
                    duplicate_to_worker(process.hProcess, HANDLE(pipe.worker.as_raw_handle()))
                })
                .transpose()?,
        })
    })();
    let handles = match transferred {
        Ok(handles) => handles,
        Err(error) => {
            // SAFETY: 只终止本次暂停 worker；它尚未运行或派生子进程。
            unsafe {
                let _ = TerminateProcess(process.hProcess, 1);
            }
            return Err(error);
        }
    };
    Ok(SuspendedWorker {
        lease,
        job,
        worker_job,
        handles,
        process: process_handle,
        thread,
        stdin: input.host,
        stdout: output.host,
        stderr: error.host,
        status: status.host,
        terminal_input: terminal_input.map(|pipe| pipe.host),
        desktop: WorkerDesktop { _desktop: desktop },
    })
}

fn duplicate_to_worker(worker: HANDLE, source: HANDLE) -> IsolationResult<u64> {
    let mut remote = HANDLE::default();
    // SAFETY: 复制到 CPWLW 返回且仍暂停的可信 worker，副本不可继承，仅经 Host 控制通道传递数值。
    unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            source,
            worker,
            &mut remote,
            0,
            false,
            DUPLICATE_SAME_ACCESS,
        )
    }
    .map_err(|error| IsolationError::new("worker_handle_transfer", error.to_string()))?;
    Ok(remote.0 as usize as u64)
}

pub struct PreparedWorker {
    pub worker: SuspendedWorker,
    pub root_process: OwnedHandle,
    pub root_thread: OwnedHandle,
}

/// 在异步 native 创建任务中执行。只恢复可信 worker，真实命令保持暂停直至现有 owner 完成 observer 接入。
pub fn prepare_worker(
    mut worker: SuspendedWorker,
    program: &WorkerProgram,
) -> IsolationResult<PreparedWorker> {
    // SAFETY: worker 的唯一初始线程仍暂停，真实命令尚未创建。
    if unsafe { ResumeThread(HANDLE(worker.thread.as_raw_handle())) } != 1 {
        return Err(IsolationError::new(
            "worker_resume",
            "unexpected worker suspended state",
        ));
    }
    write_program(&mut worker.stdin, program, &worker.handles)?;
    let (process, thread) = match read_frame(&mut worker.status)? {
        WorkerStatus::Ready { process, thread } => (process, thread),
        WorkerStatus::Failed { message } => {
            return Err(IsolationError::new("worker_start", message));
        }
        WorkerStatus::Resized { .. } => {
            return Err(IsolationError::new(
                "worker_start",
                "unexpected terminal response before readiness",
            ));
        }
    };
    let root_process = duplicate_from_worker(HANDLE(worker.process.as_raw_handle()), process)?;
    let root_thread = duplicate_from_worker(HANDLE(worker.process.as_raw_handle()), thread)?;
    Ok(PreparedWorker {
        worker,
        root_process,
        root_thread,
    })
}

fn duplicate_from_worker(worker: HANDLE, value: u64) -> IsolationResult<OwnedHandle> {
    let value = usize::try_from(value)
        .map_err(|_| IsolationError::new("worker_ready_handle", "invalid handle size"))?;
    let mut copied = HANDLE::default();
    // SAFETY: source handle table 来自已保活的可信 worker，Win32 校验具体源句柄；真实命令还未运行。
    unsafe {
        DuplicateHandle(
            worker,
            HANDLE(value as *mut _),
            GetCurrentProcess(),
            &mut copied,
            0,
            false,
            DUPLICATE_SAME_ACCESS,
        )
    }
    .map_err(|error| IsolationError::new("worker_ready_handle", error.to_string()))?;
    // SAFETY: DuplicateHandle 成功，独占的新句柄由标准库负责关闭。
    Ok(unsafe { OwnedHandle::from_raw_handle(copied.0) })
}
