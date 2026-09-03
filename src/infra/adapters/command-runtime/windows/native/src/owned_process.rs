mod observation;
pub(crate) mod pty;
mod pty_input;
mod pty_observation;

use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{HANDLE, WAIT_FAILED, WAIT_OBJECT_0};
use windows_sys::Win32::System::JobObjects::{
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JobObjectBasicAccountingInformation,
    QueryInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, INFINITE, ResumeThread, WaitForSingleObject,
};

use crate::error::{NativeError, NativeResult};
use crate::fault_injection::NativeFaultInjection;
use crate::handle::SharedHandle;
use crate::launch_spec::NativeLaunchSpec;
use crate::output_flow::OutputFlowGate;
use crate::process_creation::create_windows_process_resources;
#[cfg(feature = "test-fault-injection")]
use crate::test_support::{WindowsProcessIdentityForTest, read_process_identity_for_test};
use observation::{ObserverCallback, ObserverChannel};

const TREE_EMPTY_DEADLINE: Duration = Duration::from_secs(5);
const TREE_EMPTY_POLL_INTERVAL: Duration = Duration::from_millis(20);
const OWNER_TERMINATION_EXIT_CODE: u32 = 1;
const OBSERVER_READY_DEADLINE: Duration = Duration::from_secs(5);
pub(crate) fn active_process_count(job: HANDLE) -> NativeResult<u32> {
    let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
    // SAFETY: job 由调用方持有的 OwnedHandle 保活；accounting 是可写输出结构且长度精确。
    if unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformation,
            (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast::<c_void>(),
            size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
            null_mut(),
        )
    } == 0
    {
        return Err(NativeError::last_win32("job_accounting"));
    }
    Ok(accounting.ActiveProcesses)
}

pub(crate) fn wait_for_tree_empty(job: HANDLE) -> NativeResult<()> {
    let deadline = Instant::now() + TREE_EMPTY_DEADLINE;
    loop {
        if active_process_count(job)? == 0 {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(NativeError::contract(
                "tree_empty",
                "Job active process count did not reach zero before deadline",
            ));
        }
        thread::sleep(TREE_EMPTY_POLL_INTERVAL);
    }
}

pub(crate) struct WindowsOwnedProcessState {
    // Job 必须最先 drop：utility 非正常退出时，KILL_ON_JOB_CLOSE 先终止整棵树。
    job: SharedHandle,
    process: SharedHandle,
    thread: SharedHandle,
    stdin_writer: SharedHandle,
    stdout_reader: SharedHandle,
    stderr_reader: SharedHandle,
    stdout_flow: OutputFlowGate,
    stderr_flow: OutputFlowGate,
    observers_started: AtomicBool,
    observers_ready: AtomicBool,
    observer_threads: Mutex<Vec<JoinHandle<()>>>,
    resume_claimed: AtomicBool,
    released: AtomicBool,
    fault_injection: NativeFaultInjection,
}

impl WindowsOwnedProcessState {
    pub(crate) fn create(
        spec: NativeLaunchSpec,
        fault_injection: NativeFaultInjection,
    ) -> NativeResult<Self> {
        let resources = create_windows_process_resources(spec, &fault_injection)?;

        Ok(Self {
            job: SharedHandle::new(resources.job),
            process: SharedHandle::new(resources.process),
            thread: SharedHandle::new(resources.thread),
            stdin_writer: SharedHandle::new(resources.stdin_writer),
            stdout_reader: SharedHandle::new(resources.stdout_reader),
            stderr_reader: SharedHandle::new(resources.stderr_reader),
            stdout_flow: OutputFlowGate::default(),
            stderr_flow: OutputFlowGate::default(),
            observers_started: AtomicBool::new(false),
            observers_ready: AtomicBool::new(false),
            observer_threads: Mutex::new(Vec::new()),
            resume_claimed: AtomicBool::new(false),
            released: AtomicBool::new(false),
            fault_injection,
        })
    }

    fn observe_root(
        self: Arc<Self>,
        callback: Arc<ObserverCallback>,
        ready: mpsc::Sender<NativeResult<()>>,
    ) {
        let process = match self.process.lock("root_observer_lock") {
            Ok(process) => process,
            Err(error) => {
                let description = error.to_string();
                let _ = ready.send(Err(error));
                Self::publish_observer_event(
                    &callback,
                    ("observer_error".to_owned(), None, None, Some(description)),
                );
                return;
            }
        };
        let handle = match process.as_ref() {
            Some(handle) => handle,
            None => {
                let error = NativeError::contract("root_observer_lock", "process handle is closed");
                let description = error.to_string();
                let _ = ready.send(Err(error));
                Self::publish_observer_event(
                    &callback,
                    ("observer_error".to_owned(), None, None, Some(description)),
                );
                return;
            }
        };
        if ready.send(Ok(())).is_err() {
            return;
        }
        // SAFETY: root observer 持有 process SharedHandle 锁，等待期间进程句柄不会被 release 关闭。
        let wait = unsafe { WaitForSingleObject(handle.as_raw(), INFINITE) };
        let result = if wait == WAIT_FAILED {
            Err(NativeError::last_win32("root_wait"))
        } else if wait != WAIT_OBJECT_0 {
            Err(NativeError::contract(
                "root_wait",
                format!("unexpected wait result: {wait}"),
            ))
        } else {
            let mut exit_code = 0u32;
            // SAFETY: 同一锁仍保活已进入 signaled 状态的进程句柄，exit_code 是有效输出地址。
            if unsafe { GetExitCodeProcess(handle.as_raw(), &mut exit_code) } == 0 {
                Err(NativeError::last_win32("root_exit_code"))
            } else {
                Ok(exit_code)
            }
        };
        match result {
            Ok(exit_code) => {
                Self::publish_observer_event(
                    &callback,
                    ("root_exit".to_owned(), None, Some(exit_code), None),
                );
            }
            Err(error) => {
                Self::publish_observer_event(
                    &callback,
                    (
                        "observer_error".to_owned(),
                        None,
                        None,
                        Some(error.to_string()),
                    ),
                );
            }
        }
    }

    pub(crate) fn start_observers(
        self: &Arc<Self>,
        callback: ObserverCallback,
    ) -> NativeResult<()> {
        if self
            .observers_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(NativeError::contract(
                "observer_start",
                "native observers were already started",
            ));
        }

        let callback = Arc::new(callback);
        let (ready_sender, ready_receiver) = mpsc::channel::<NativeResult<()>>();
        let thread_specs = [
            ("linnya-command-stdout", Some(ObserverChannel::Stdout)),
            ("linnya-command-stderr", Some(ObserverChannel::Stderr)),
            ("linnya-command-root", None),
        ];
        let observer_count = thread_specs.len();
        let mut observer_threads = match self.observer_threads.lock() {
            Ok(threads) => threads,
            Err(_) => {
                let startup_error = NativeError::contract(
                    "observer_thread_store",
                    "observer thread lock was poisoned",
                );
                let rollback = self.terminate_and_wait_tree_empty();
                return Err(Self::combine_start_and_cleanup_error(
                    startup_error,
                    rollback,
                ));
            }
        };
        for (name, channel) in thread_specs {
            let state = Arc::clone(self);
            let callback = Arc::clone(&callback);
            let ready = ready_sender.clone();
            let observer = thread::Builder::new()
                .name(name.to_owned())
                .spawn(move || match channel {
                    Some(channel) => state.observe_pipe(channel, callback, ready),
                    None => state.observe_root(callback, ready),
                })
                .map_err(|error| NativeError::contract("observer_thread_spawn", error.to_string()));
            match observer {
                Ok(observer) => observer_threads.push(observer),
                Err(error) => {
                    drop(observer_threads);
                    let rollback = self.terminate_and_wait_tree_empty();
                    return Err(Self::combine_start_and_cleanup_error(error, rollback));
                }
            }
        }
        drop(ready_sender);
        drop(observer_threads);

        for _ in 0..observer_count {
            match ready_receiver.recv_timeout(OBSERVER_READY_DEADLINE) {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    return Err(self.cleanup_after_start_failure(error));
                }
                Err(error) => {
                    let startup_error = NativeError::contract(
                        "observer_ready",
                        format!("observer readiness failed: {error}"),
                    );
                    return Err(self.cleanup_after_start_failure(startup_error));
                }
            }
        }
        if let Err(error) = self.fault_injection.check("observer_ready") {
            return Err(self.cleanup_after_start_failure(error));
        }
        self.observers_ready.store(true, Ordering::Release);
        Ok(())
    }

    fn combine_start_and_cleanup_error(
        startup: NativeError,
        rollback: NativeResult<()>,
    ) -> NativeError {
        let mut cleanup_failures = Vec::<String>::new();
        if let Err(error) = rollback {
            cleanup_failures.push(format!("rollback={error}"));
        }
        if cleanup_failures.is_empty() {
            startup
        } else {
            NativeError::contract(
                "startup_cleanup",
                format!("startup={startup}; {}", cleanup_failures.join("; ")),
            )
        }
    }

    fn cleanup_after_start_failure(&self, startup: NativeError) -> NativeError {
        // 同步 N-API 入口不能在这里 join observer：observer 的终态 TSFN 需要 JS 主线程
        // 消费，而主线程仍在等待本函数返回。先终止并唤醒流量门，异步 release 再 join。
        self.stdout_flow.close();
        self.stderr_flow.close();
        let rollback = self.terminate_and_wait_tree_empty();
        Self::combine_start_and_cleanup_error(startup, rollback)
    }

    fn rollback_resume(&self, startup: NativeError) -> NativeError {
        self.cleanup_after_start_failure(startup)
    }

    pub(crate) fn resume(&self) -> NativeResult<()> {
        if !self.observers_ready.load(Ordering::Acquire) {
            return Err(NativeError::contract(
                "resume",
                "native observers are not ready",
            ));
        }
        if self
            .resume_claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(NativeError::contract(
                "resume",
                "suspended root resume was already claimed",
            ));
        }
        if let Err(error) = self.fault_injection.check("resume") {
            return Err(self.rollback_resume(error));
        }
        // 普通 pipe 从启动起就是 EOF stdin，避免继承 Electron 或外层 Agent 的输入。
        if let Err(error) = self.stdin_writer.close("stdin_parent_close") {
            return Err(self.rollback_resume(error));
        }
        let mut initial_thread = match self.thread.lock("thread_resume") {
            Ok(thread) => thread,
            Err(error) => return Err(self.rollback_resume(error)),
        };
        let handle = match initial_thread.as_ref() {
            Some(handle) => handle,
            None => {
                return Err(self.rollback_resume(NativeError::contract(
                    "thread_resume",
                    "thread handle is closed",
                )));
            }
        };
        // SAFETY: initial_thread 锁保活 CreateProcessW 返回的主线程句柄；该句柄只在这里恢复一次。
        let previous_suspend_count = unsafe { ResumeThread(handle.as_raw()) };
        if previous_suspend_count == u32::MAX {
            let error = NativeError::last_win32("thread_resume");
            drop(initial_thread);
            return Err(self.rollback_resume(error));
        }
        if previous_suspend_count != 1 {
            drop(initial_thread);
            return Err(self.rollback_resume(NativeError::contract(
                "thread_resume",
                format!("unexpected previous suspend count: {previous_suspend_count}"),
            )));
        }
        let resumed_thread = initial_thread
            .take()
            .expect("thread handle was checked above");
        drop(initial_thread);
        if let Err(error) = resumed_thread.close("thread_close_after_resume") {
            return Err(self.rollback_resume(error));
        }
        Ok(())
    }

    pub(crate) fn terminate_and_wait_tree_empty(&self) -> NativeResult<()> {
        let job = self.job.lock("tree_terminate")?;
        let handle = job
            .as_ref()
            .ok_or_else(|| NativeError::contract("tree_terminate", "Job handle is closed"))?;
        // stop 任务持有自己的 Job handle，避免有限收尾轮询占住共享资源锁；
        // native 不提供无限 tree wait，防止长期后代耗尽 Node 默认工作线程池。
        let termination_handle = handle.duplicate("tree_terminate_handle")?;
        drop(job);
        if active_process_count(termination_handle.as_raw())? > 0
            // SAFETY: duplicate 独立拥有有效 Job handle，整个终止与后续轮询期间不会被上层 release 关闭。
            && unsafe {
                TerminateJobObject(termination_handle.as_raw(), OWNER_TERMINATION_EXIT_CODE)
            } == 0
        {
            return Err(NativeError::last_win32("tree_terminate"));
        }
        wait_for_tree_empty(termination_handle.as_raw())
    }

    fn join_observer_threads(observers: Vec<JoinHandle<()>>) -> NativeResult<()> {
        let mut panicked = Vec::<String>::new();
        for observer in observers {
            let name = observer
                .thread()
                .name()
                .unwrap_or("unnamed-observer")
                .to_owned();
            if observer.join().is_err() {
                panicked.push(name);
            }
        }
        if panicked.is_empty() {
            Ok(())
        } else {
            Err(NativeError::contract(
                "observer_join",
                format!("observer threads panicked: {}", panicked.join(",")),
            ))
        }
    }

    fn join_observers(&self) -> NativeResult<()> {
        let observers = self
            .observer_threads
            .lock()
            .map_err(|_| {
                NativeError::contract("observer_join", "observer thread lock was poisoned")
            })?
            .drain(..)
            .collect::<Vec<_>>();
        Self::join_observer_threads(observers)
    }

    pub(crate) fn release(&self) -> NativeResult<()> {
        if self.released.load(Ordering::Acquire) {
            return Ok(());
        }
        // release 不能先 join observer：若上游终止 Job 失败，observer 仍可能合理地
        // 等待活进程或 pipe EOF，先 join 会把清理错误变成永久等待。只有 Job 已空时，
        // observer 才具备可收敛前提，随后 join 才能证明 native 观察线程真正结束。
        {
            let job = self.job.lock("resource_release")?;
            let handle = job
                .as_ref()
                .ok_or_else(|| NativeError::contract("resource_release", "Job handle is closed"))?;
            if active_process_count(handle.as_raw())? != 0 {
                return Err(NativeError::contract(
                    "resource_release",
                    "Job still owns active processes",
                ));
            }
        }
        self.join_observers()?;
        {
            let process = self.process.lock("resource_release")?;
            let handle = process.as_ref().ok_or_else(|| {
                NativeError::contract("resource_release", "process handle is closed")
            })?;
            // SAFETY: process 锁在零超时观察期间保活句柄；调用不转移所有权。
            if unsafe { WaitForSingleObject(handle.as_raw(), 0) } != WAIT_OBJECT_0 {
                return Err(NativeError::contract(
                    "resource_release",
                    "root exit has not been observed",
                ));
            }
        }
        if !self.stdout_reader.is_closed("resource_release")?
            || !self.stderr_reader.is_closed("resource_release")?
        {
            return Err(NativeError::contract(
                "resource_release",
                "stdout or stderr has not reached EOF",
            ));
        }

        let mut failures = Vec::<String>::new();
        for result in [
            self.stdin_writer.close("stdin_release"),
            self.thread.close("thread_release"),
            self.process.close("process_release"),
            self.job.close("job_release"),
        ] {
            if let Err(error) = result {
                failures.push(error.to_string());
            }
        }
        if !failures.is_empty() {
            return Err(NativeError::contract(
                "resource_release",
                failures.join("; "),
            ));
        }
        self.released.store(true, Ordering::Release);
        Ok(())
    }

    #[cfg(feature = "test-fault-injection")]
    pub(crate) fn root_process_identity_for_test(
        &self,
    ) -> NativeResult<WindowsProcessIdentityForTest> {
        let process = self.process.lock("test_process_identity")?;
        let handle = process.as_ref().ok_or_else(|| {
            NativeError::contract("test_process_identity", "process handle is closed")
        })?;
        read_process_identity_for_test(handle.as_raw())
    }
}
