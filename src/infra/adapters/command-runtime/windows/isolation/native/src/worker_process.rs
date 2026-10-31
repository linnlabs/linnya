use crate::{
    IsolationError, IsolationResult,
    command_job::restrict_command_ui,
    protocol::write_frame,
    worker_protocol::{WorkerProgram, WorkerStatus},
};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{
    CREATE_BREAKAWAY_FROM_JOB, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessAsUserW,
    EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess, INFINITE, PROCESS_CREATION_FLAGS,
    PROCESS_INFORMATION, STARTUPINFOEXW, TerminateProcess, WaitForSingleObject,
};
use windows::core::{PCWSTR, PWSTR};

pub(crate) struct WorkerChild {
    process: OwnedHandle,
    thread: OwnedHandle,
}

impl WorkerChild {
    pub(crate) fn create(
        program: &mut WorkerProgram,
        token: HANDLE,
        job: HANDLE,
        startup: &STARTUPINFOEXW,
        inherit_handles: bool,
        flags: PROCESS_CREATION_FLAGS,
    ) -> IsolationResult<Self> {
        let mut process = PROCESS_INFORMATION::default();
        // SAFETY: UTF-16 块已校验，attribute list 由调用方保活；JOB_LIST 在创建时原子接纳真实命令，
        // breakaway 只离开允许脱离的控制 worker Job。真实命令仍暂停，尚不能运行用户代码。
        unsafe {
            CreateProcessAsUserW(
                Some(token),
                PCWSTR(program.executable_path.as_ptr()),
                Some(PWSTR(program.command_line.as_mut_ptr())),
                None,
                None,
                inherit_handles,
                CREATE_SUSPENDED
                    | CREATE_UNICODE_ENVIRONMENT
                    | CREATE_BREAKAWAY_FROM_JOB
                    | EXTENDED_STARTUPINFO_PRESENT
                    | flags,
                Some(program.environment.as_ptr().cast()),
                PCWSTR(program.cwd.as_ptr()),
                &startup.StartupInfo,
                &mut process,
            )
        }
        .map_err(|error| IsolationError::new("worker_child_create", error.to_string()))?;
        // SAFETY: 成功取得的两个句柄由不同 RAII owner 独占。
        let child = Self {
            // SAFETY: CreateProcessAsUserW 成功返回的真实根进程句柄。
            process: unsafe { OwnedHandle::from_raw_handle(process.hProcess.0) },
            // SAFETY: 主线程句柄由本对象保活，交给 Host 复制后由 Host 恢复。
            thread: unsafe { OwnedHandle::from_raw_handle(process.hThread.0) },
        };
        restrict_command_ui(job)?;
        srt_win::self_protect::protect_own_threads()
            .map_err(|error| IsolationError::new("worker_thread_protect", error.to_string()))?;
        Ok(child)
    }

    pub(crate) fn publish_ready(&self) -> IsolationResult<()> {
        write_frame(
            &mut std::io::stderr().lock(),
            &WorkerStatus::Ready {
                process: self.process.as_raw_handle() as usize as u64,
                thread: self.thread.as_raw_handle() as usize as u64,
            },
        )
    }

    pub(crate) fn handle(&self) -> HANDLE {
        HANDLE(self.process.as_raw_handle())
    }

    pub(crate) fn wait(&self) -> IsolationResult<u32> {
        // SAFETY: self 保活真实根命令，Host 的 command Job 取消也会使此等待收敛。
        if unsafe { WaitForSingleObject(self.handle(), INFINITE) } != WAIT_OBJECT_0 {
            return Err(IsolationError::new(
                "worker_child_wait",
                "child process wait failed",
            ));
        }
        let mut code = 0;
        // SAFETY: 已观察进程 signaled，输出 u32 有效。
        unsafe { GetExitCodeProcess(self.handle(), &mut code) }
            .map_err(|error| IsolationError::new("worker_child_exit", error.to_string()))?;
        Ok(code)
    }
}

impl Drop for WorkerChild {
    fn drop(&mut self) {
        // SAFETY: 创建或握手失败时不能遗留暂停进程；正常结束时对已退出进程无副作用。
        unsafe {
            let _ = TerminateProcess(self.handle(), 1);
        }
    }
}
