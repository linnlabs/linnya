use crate::{IsolationError, IsolationResult, worker_protocol::read_program};
use crate::{protocol::write_frame, worker_protocol::WorkerStatus};
use crate::{startup_attributes::StartupAttributes, worker_process::WorkerChild};
use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use windows::Win32::Foundation::{
    HANDLE, HANDLE_FLAG_INHERIT, HANDLE_FLAGS, INVALID_HANDLE_VALUE, SetHandleInformation,
};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_GENERIC_READ, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING,
};
use windows::Win32::System::Console::{GetStdHandle, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
use windows::Win32::System::JobObjects::IsProcessInJob;
use windows::Win32::System::Threading::{
    CREATE_NO_WINDOW, GetCurrentProcess, STARTF_USESTDHANDLES, STARTUPINFOW,
};
use windows::Win32::System::Threading::{
    PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, STARTUPINFOEXW,
};
use windows::core::{BOOL, PCWSTR};

/// 只在独立普通账户中运行。先自保护，再读取输入和创建受限子进程，失败不启动普通 token 子进程。
pub fn run_worker() -> IsolationResult<u32> {
    srt_win::self_protect::install_broker_dacl(None)
        .map_err(|error| IsolationError::new("worker_self_protect", error.to_string()))?;
    if srt_win::winsta::current_desktop_name()
        .ok_or_else(|| IsolationError::new("worker_desktop", "cannot observe current desktop"))?
        == "Default"
    {
        return Err(IsolationError::new(
            "worker_desktop",
            "isolated desktop is required",
        ));
    }
    let mut in_job = BOOL::default();
    // SAFETY: 当前进程伪句柄不需要关闭，输出 BOOL 有效；worker 必须先加入 Host 的 Job 才恢复。
    unsafe { IsProcessInJob(GetCurrentProcess(), None, &mut in_job) }
        .map_err(|error| IsolationError::new("worker_job", error.to_string()))?;
    if !in_job.as_bool() {
        return Err(IsolationError::new(
            "worker_job",
            "worker has no command Job",
        ));
    }
    let start = read_program(&mut std::io::stdin().lock())?;
    let remote_job = usize::try_from(start.handles.command_job)
        .map_err(|_| IsolationError::new("worker_command_job", "invalid transferred Job handle"))?;
    if remote_job == 0 || remote_job == usize::MAX {
        return Err(IsolationError::new(
            "worker_command_job",
            "invalid transferred Job handle",
        ));
    }
    let stderr_value = usize::try_from(start.handles.stderr)
        .map_err(|_| IsolationError::new("worker_stderr", "invalid transferred stderr handle"))?;
    if stderr_value == 0 || stderr_value == usize::MAX {
        return Err(IsolationError::new(
            "worker_stderr",
            "invalid transferred stderr handle",
        ));
    }
    // SAFETY: stderr 为 Host 在恢复前 DuplicateHandle 交给 worker 的独占 client 写端。
    let command_stderr = unsafe { OwnedHandle::from_raw_handle(stderr_value as *mut _) };
    // SAFETY: 这是 Host 在恢复前 DuplicateHandle 到本 worker 的非继承句柄，控制管道只由 Host 持有写端。
    let command_job = unsafe { OwnedHandle::from_raw_handle(remote_job as *mut _) };
    let mut program = start.program;
    let base = srt_win::util::OwnedHandle(
        srt_win::token::open_self_token()
            .map_err(|error| IsolationError::new("worker_token", error.to_string()))?,
    );
    let restricted = srt_win::util::OwnedHandle(
        srt_win::token::make_sandbox_token(base.raw(), true, &[])
            .map_err(|error| IsolationError::new("worker_token", error.to_string()))?,
    );
    let primary = srt_win::util::OwnedHandle(
        srt_win::token::to_primary(restricted.raw())
            .map_err(|error| IsolationError::new("worker_token", error.to_string()))?,
    );
    if let Some(size) = program.terminal {
        drop(command_stderr); // PTY 把真实 stdout/stderr 都交给 ConPTY；Host 独立 stderr 端正常 EOF。
        let input_value = start
            .handles
            .terminal_input
            .and_then(|value| usize::try_from(value).ok())
            .filter(|value| *value != 0 && *value != usize::MAX)
            .ok_or_else(|| {
                IsolationError::new("worker_terminal_input", "missing terminal input handle")
            })?;
        // SAFETY: Host 在恢复前复制到本 worker 的非继承 client 读端，只交给 ConPTY，不交给用户命令。
        let terminal_input = unsafe { OwnedHandle::from_raw_handle(input_value as *mut _) };
        return crate::worker_pty::run(program, primary, command_job, terminal_input, size);
    }
    // Host 控制输入不能被真实命令继承；普通 pipe 命令从启动起就是 EOF stdin。
    // SAFETY: 系统提供的 std handle 在本 worker 生命周期中保活，只改继承标记。
    unsafe {
        SetHandleInformation(
            GetStdHandle(STD_INPUT_HANDLE)
                .map_err(|error| IsolationError::new("worker_stdin", error.to_string()))?,
            HANDLE_FLAG_INHERIT.0,
            HANDLE_FLAGS(0),
        )
    }
    .map_err(|error| IsolationError::new("worker_control_inheritance", error.to_string()))?;
    let nul_name = srt_win::util::wstr("NUL");
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: true.into(),
    };
    // SAFETY: 固定 NUL 设备，只用于 EOF 输入；没有文件路径由模型控制。
    let null_input = unsafe {
        CreateFileW(
            PCWSTR(nul_name.as_ptr()),
            FILE_GENERIC_READ.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            Some(&security),
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
    }
    .map_err(|error| IsolationError::new("worker_stdin", error.to_string()))?;
    // SAFETY: CreateFileW 成功，返回句柄由标准库独占关闭。
    let null_input = unsafe { OwnedHandle::from_raw_handle(null_input.0) };
    let mut startup = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        dwFlags: STARTF_USESTDHANDLES,
        hStdInput: HANDLE(null_input.as_raw_handle()),
        ..Default::default()
    };
    // SAFETY: 只读取 CPWLW 传入的两个 client 写端；不会把 Host 控制管道的 server 端交给命令。
    unsafe {
        startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE)
            .map_err(|error| IsolationError::new("worker_stdout", error.to_string()))?;
        startup.hStdError = HANDLE(command_stderr.as_raw_handle());
    }
    for handle in [startup.hStdOutput, startup.hStdError] {
        if handle.is_invalid() || handle == INVALID_HANDLE_VALUE {
            return Err(IsolationError::new(
                "worker_output",
                "worker output handle is missing",
            ));
        }
        // SAFETY: 只有 stdout、stderr 与刚创建的 NUL 可继承；worker 尚未启动其他线程。
        unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT.0, HANDLE_FLAG_INHERIT) }
            .map_err(|error| IsolationError::new("worker_output_inheritance", error.to_string()))?;
    }
    let jobs = [HANDLE(command_job.as_raw_handle())];
    let handles = [startup.hStdInput, startup.hStdOutput, startup.hStdError];
    let mut attributes = StartupAttributes::new(2)?;
    attributes.handles(PROC_THREAD_ATTRIBUTE_JOB_LIST as usize, &jobs)?;
    attributes.handles(PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize, &handles)?;
    startup.cb = size_of::<STARTUPINFOEXW>() as u32;
    let startup = STARTUPINFOEXW {
        StartupInfo: startup,
        lpAttributeList: attributes.pointer(),
    };
    let child = WorkerChild::create(
        &mut program,
        primary.raw(),
        HANDLE(command_job.as_raw_handle()),
        &startup,
        true,
        CREATE_NO_WINDOW,
    )?;
    child.publish_ready()?;
    // 只交付句柄，绝不在 worker 自行 resume；native owner 在 observer-ready 后恢复真实根命令。
    drop(program);
    child.wait()
}

pub fn report_worker_error(error: &IsolationError) -> IsolationResult<()> {
    write_frame(
        &mut std::io::stderr().lock(),
        &WorkerStatus::Failed {
            message: error.to_string(),
        },
    )
}
