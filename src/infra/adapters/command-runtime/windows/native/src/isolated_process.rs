use std::fs::File;
use std::os::windows::io::{AsRawHandle, OwnedHandle as SystemHandle};
use std::sync::Mutex;

use linnya_windows_command_isolation::{
    AccountLease, FilesystemLease, PreparedWorker, SuspendedWorker, WorkerDesktop,
    WorkerTerminalSize, close_terminal, resize_terminal,
};
use windows_sys::Win32::Foundation::{WAIT_FAILED, WAIT_OBJECT_0};
use windows_sys::Win32::System::JobObjects::TerminateJobObject;
use windows_sys::Win32::System::Threading::WaitForSingleObject;

use crate::error::{NativeError, NativeResult};
use crate::handle::OwnedHandle;
use crate::process_creation::CreatedWindowsProcessResources;
use crate::pty_creation::{CreatedWindowsPtyResources, OwnedPseudoConsole};

struct WorkerResources {
    lease: AccountLease,
    filesystem: FilesystemLease,
    worker_job: SystemHandle,
    command_job: SystemHandle,
    process: SystemHandle,
    thread: SystemHandle,
    desktop: WorkerDesktop,
}

/// 命令 Job/真实 root 继续由已有 owner 观察；本对象只负责外层 worker 与账户的收尾。
pub(crate) struct IsolatedWorkerLifetime {
    resources: Mutex<Option<WorkerResources>>,
}

impl IsolatedWorkerLifetime {
    pub(crate) fn release(&self) -> NativeResult<()> {
        let mut guard = self.resources.lock().map_err(|_| {
            NativeError::contract("isolated_worker_release", "worker lock was poisoned")
        })?;
        let Some(resources) = guard.as_ref() else {
            return Ok(());
        };
        // pipe worker 在 root 结束后退出；PTY worker 在显式关闭 ConPTY 后退出。不能把
        // worker 的退出当成 root_exit，但撤销文件授权/卸载账户之前必须证明它也已结束。
        // SAFETY: guard 保活 CPWLW 返回的 worker process handle，等待有上限。
        let wait = unsafe { WaitForSingleObject(resources.process.as_raw_handle(), 5_000) };
        if wait == WAIT_FAILED {
            return Err(NativeError::last_win32("isolated_worker_wait"));
        }
        if wait != WAIT_OBJECT_0 {
            return Err(NativeError::contract(
                "isolated_worker_wait",
                "worker did not exit",
            ));
        }
        let WorkerResources {
            lease,
            filesystem,
            worker_job,
            command_job,
            process,
            thread,
            desktop,
        } = guard
            .take()
            .expect("worker resource was checked under the same lock");
        drop(guard);
        // Secondary Logon 的 profile 卸载必须在进程/线程引用关闭之后等待；服务维护
        // ProfileUnloading 状态，尚未完成时不会把正常 release 报成成功。
        drop((process, thread, desktop, worker_job, command_job));
        // 撤权失败仍须删除执行身份；失败日志保留，后续准备继续清理该 SID。
        let permissions = filesystem.release();
        let account = lease.release();
        match (permissions, account) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error.into()),
            (Err(permissions), Err(account)) => Err(NativeError::contract(
                "isolated_worker_release",
                format!("permissions={permissions}; account={account}"),
            )),
        }
    }
}

impl Drop for IsolatedWorkerLifetime {
    fn drop(&mut self) {
        let resources = match self.resources.get_mut() {
            Ok(value) => value,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(resources) = resources.take() {
            // 服务也持有 Job，故不能把 Host handle 的 Drop 当成 KILL_ON_JOB_CLOSE。
            // 放弃 owner 时先显式停两个 Job，再关闭租约，服务负责观察整树和账户回收。
            // SAFETY: 两个 Job 都是本次租约拥有的有效引用；不会结束其他命令。
            unsafe {
                TerminateJobObject(resources.worker_job.as_raw_handle(), 1);
                TerminateJobObject(resources.command_job.as_raw_handle(), 1);
            }
            drop(resources);
        }
    }
}

struct TerminalConnection {
    control: File,
    status: File,
}

pub(crate) struct IsolatedPseudoConsole {
    connection: Mutex<Option<TerminalConnection>>,
}

impl IsolatedPseudoConsole {
    pub(crate) fn resize(&self, columns: u16, rows: u16) -> NativeResult<()> {
        let mut guard = self.connection.lock().map_err(|_| {
            NativeError::contract("isolated_terminal_resize", "terminal lock was poisoned")
        })?;
        let connection = guard.as_mut().ok_or_else(|| {
            NativeError::contract("isolated_terminal_resize", "terminal is closed")
        })?;
        resize_terminal(
            &mut connection.control,
            &mut connection.status,
            WorkerTerminalSize { columns, rows },
        )
        .map_err(Into::into)
    }

    pub(crate) fn close(&self) -> NativeResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| {
                NativeError::contract("isolated_terminal_close", "terminal lock was poisoned")
            })?
            .take();
        if let Some(mut connection) = connection {
            // 现有 owner 已取消并 join input writer，且 output observer 仍持续排空。
            // 发送结束请求后关闭控制管道；输出 EOF 和 worker 退出由各自 owner 观察。
            close_terminal(&mut connection.control)?;
        }
        Ok(())
    }
}

struct PreparedParts {
    isolation: IsolatedWorkerLifetime,
    job: OwnedHandle,
    process: OwnedHandle,
    thread: OwnedHandle,
    stdout: OwnedHandle,
    stderr: OwnedHandle,
    control: File,
    status: File,
    terminal_input: Option<File>,
}

fn split_prepared(
    prepared: PreparedWorker,
    filesystem: FilesystemLease,
) -> NativeResult<PreparedParts> {
    let PreparedWorker {
        worker,
        root_process,
        root_thread,
    } = prepared;
    let SuspendedWorker {
        lease,
        job,
        worker_job,
        handles: _,
        process,
        thread,
        stdin,
        stdout,
        stderr,
        status,
        terminal_input,
        desktop,
    } = worker;
    let command_job = job
        .try_clone()
        .map_err(|error| NativeError::contract("isolated_job_reference", error.to_string()))?;
    Ok(PreparedParts {
        isolation: IsolatedWorkerLifetime {
            resources: Mutex::new(Some(WorkerResources {
                lease,
                filesystem,
                worker_job,
                command_job,
                process,
                thread,
                desktop,
            })),
        },
        job: OwnedHandle::from_owned(job),
        process: OwnedHandle::from_owned(root_process),
        thread: OwnedHandle::from_owned(root_thread),
        stdout: OwnedHandle::from_owned(stdout),
        stderr: OwnedHandle::from_owned(stderr),
        control: stdin,
        status,
        terminal_input,
    })
}

pub(crate) fn pipe_resources(
    prepared: PreparedWorker,
    filesystem: FilesystemLease,
) -> NativeResult<CreatedWindowsProcessResources> {
    let parts = split_prepared(prepared, filesystem)?;
    if parts.terminal_input.is_some() {
        return Err(NativeError::contract(
            "isolated_pipe_create",
            "received terminal worker",
        ));
    }
    Ok(CreatedWindowsProcessResources {
        isolation: Some(parts.isolation),
        job: parts.job,
        process: parts.process,
        thread: parts.thread,
        // 隔离 worker 为真实命令打开 NUL stdin，不伪造一个无用途的 pipe handle。
        stdin_writer: None,
        stdout_reader: parts.stdout,
        stderr_reader: parts.stderr,
    })
}

pub(crate) fn pty_resources(
    prepared: PreparedWorker,
    filesystem: FilesystemLease,
) -> NativeResult<CreatedWindowsPtyResources> {
    let parts = split_prepared(prepared, filesystem)?;
    let input = parts
        .terminal_input
        .ok_or_else(|| NativeError::contract("isolated_pty_create", "received pipe worker"))?;
    Ok(CreatedWindowsPtyResources {
        isolation: Some(parts.isolation),
        job: parts.job,
        process: parts.process,
        thread: parts.thread,
        output_reader: parts.stdout,
        input_writer: OwnedHandle::from_owned(input),
        pseudoconsole: OwnedPseudoConsole::Isolated(IsolatedPseudoConsole {
            connection: Mutex::new(Some(TerminalConnection {
                control: parts.control,
                status: parts.status,
            })),
        }),
        // ConPTY 端点由 worker 拥有，Host 只能关闭自己的真实端点和控制连接。
        conpty_input_reader: None,
        conpty_output_writer: None,
    })
}
