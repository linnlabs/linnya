use crate::{
    IsolationError, IsolationResult,
    protocol::{read_frame, write_frame},
    startup_attributes::StartupAttributes,
    worker_process::WorkerChild,
    worker_protocol::{TerminalControl, WorkerProgram, WorkerStatus, WorkerTerminalSize},
};
use std::mem::{size_of, size_of_val};
use std::os::windows::io::{AsRawHandle, OwnedHandle};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
use windows::Win32::System::Console::{
    COORD, ClosePseudoConsole, CreatePseudoConsole, GetStdHandle, HPCON, ResizePseudoConsole,
    STD_OUTPUT_HANDLE,
};
use windows::Win32::System::JobObjects::{
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JobObjectBasicAccountingInformation,
    QueryInformationJobObject, TerminateJobObject,
};
use windows::Win32::System::Threading::{
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_CREATION_FLAGS, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    STARTUPINFOW,
};

struct WorkerConsole {
    console: Option<HPCON>,
    job: OwnedHandle,
}

impl WorkerConsole {
    fn terminate_tree(&self) -> IsolationResult<()> {
        // SAFETY: 只终止本次命令 Job；控制 worker 位于另一 Job，仍能排空和关闭终端。
        unsafe { TerminateJobObject(HANDLE(self.job.as_raw_handle()), 1) }
            .map_err(|error| IsolationError::new("worker_terminal_tree_stop", error.to_string()))?;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            // SAFETY: Job 由 self 保活，结构和长度匹配 accounting 信息类。
            unsafe {
                QueryInformationJobObject(
                    Some(HANDLE(self.job.as_raw_handle())),
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    size_of_val(&accounting) as u32,
                    None,
                )
            }
            .map_err(|error| {
                IsolationError::new("worker_terminal_tree_observe", error.to_string())
            })?;
            if accounting.ActiveProcesses == 0 {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(IsolationError::new(
                    "worker_terminal_tree_stop",
                    "command tree remains active",
                ));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn close(&mut self) -> IsolationResult<()> {
        self.terminate_tree()?;
        if let Some(console) = self.console.take() {
            // SAFETY: 已证明命令 Job 为空；Host 的输出 observer 持续 drain，满足 Win10 ClosePseudoConsole 合同。
            unsafe {
                ClosePseudoConsole(console);
            }
        }
        Ok(())
    }
}

impl Drop for WorkerConsole {
    fn drop(&mut self) {
        // 正式关闭负责报告错误；异常路径仍必须先终止真实命令再关闭 ConPTY。
        let _ = self.close();
    }
}

pub(crate) fn run(
    mut program: WorkerProgram,
    primary: srt_win::util::OwnedHandle,
    job: OwnedHandle,
    terminal_input: OwnedHandle,
    size: WorkerTerminalSize,
) -> IsolationResult<u32> {
    size.validate()?;
    // SAFETY: stdout 是 Host 传入的 client 写端，ConPTY 直接向现有 output observer 发送真实终端输出。
    let output = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) }
        .map_err(|error| IsolationError::new("worker_terminal_output", error.to_string()))?;
    // SAFETY: 两个 stdio 都是同步 pipe 的 client 端。Host 独立持有输入 writer，阻塞输入可沿用原生定向取消，
    // 不会占用 resize/close 的控制管道，也不会把可 impersonate Host 的 server handle 交给隔离进程。
    let console = unsafe {
        CreatePseudoConsole(
            COORD {
                X: size.columns as i16,
                Y: size.rows as i16,
            },
            HANDLE(terminal_input.as_raw_handle()),
            output,
            0,
        )
    }
    .map_err(|error| IsolationError::new("worker_terminal_create", error.to_string()))?;
    let mut owner = WorkerConsole {
        console: Some(console),
        job,
    };
    let jobs = [HANDLE(owner.job.as_raw_handle())];
    let mut attributes = StartupAttributes::new(2)?;
    attributes.handles(PROC_THREAD_ATTRIBUTE_JOB_LIST as usize, &jobs)?;
    attributes.pseudoconsole(console)?;
    let startup = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: size_of::<STARTUPINFOEXW>() as u32,
            dwFlags: STARTF_USESTDHANDLES,
            hStdInput: INVALID_HANDLE_VALUE,
            hStdOutput: INVALID_HANDLE_VALUE,
            hStdError: INVALID_HANDLE_VALUE,
            ..Default::default()
        },
        lpAttributeList: attributes.pointer(),
    };
    let child = WorkerChild::create(
        &mut program,
        primary.raw(),
        HANDLE(owner.job.as_raw_handle()),
        &startup,
        false,
        PROCESS_CREATION_FLAGS(0),
    )?;
    child.publish_ready()?;
    drop(program);
    let mut control = std::io::stdin().lock();
    while let TerminalControl::Resize { columns, rows } = read_frame(&mut control)? {
        WorkerTerminalSize { columns, rows }.validate()?;
        // SAFETY: owner 保活 HPCON；尺寸在转换成 COORD 前已验证。
        unsafe {
            ResizePseudoConsole(
                console,
                COORD {
                    X: columns as i16,
                    Y: rows as i16,
                },
            )
        }
        .map_err(|error| IsolationError::new("worker_terminal_resize", error.to_string()))?;
        write_frame(
            &mut std::io::stderr().lock(),
            &WorkerStatus::Resized { columns, rows },
        )?;
    }
    owner.close()?;
    child.wait()
}
