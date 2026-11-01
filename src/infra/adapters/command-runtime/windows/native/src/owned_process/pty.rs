use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows_sys::Win32::Foundation::{WAIT_FAILED, WAIT_OBJECT_0};
use windows_sys::Win32::System::JobObjects::TerminateJobObject;
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, INFINITE, ResumeThread, WaitForSingleObject,
};

use super::pty_input::{PtyInputJoinOutcome, PtyInputWriter};
use super::pty_observation::PtyObserverCallback;
use crate::error::{NativeError, NativeResult};
use crate::fault_injection::NativeFaultInjection;
use crate::handle::SharedHandle;
use crate::launch_spec::NativeLaunchSpec;
use crate::output_flow::OutputFlowGate;
use crate::owned_process::{active_process_count, wait_for_tree_empty};
use crate::pty_creation::{SharedPseudoConsole, create_windows_pty_resources, validate_pty_size};
#[cfg(feature = "test-fault-injection")]
use crate::test_support::{WindowsProcessIdentityForTest, read_process_identity_for_test};

const OWNER_TERMINATION_EXIT_CODE: u32 = 1;
const OBSERVER_READY_DEADLINE: Duration = Duration::from_secs(5);
const ROOT_EXIT_DEADLINE: Duration = Duration::from_secs(5);

pub(crate) struct WindowsOwnedPtyProcessState {
    // Job 必须最先 drop。utility 被强杀或测试 owner 非正常退出时，业务树先结束，
    // 随后的 HPCON close 才不会在 Windows 10/旧版 Windows 11 等待活 client。
    pub(super) job: SharedHandle,
    pub(super) process: SharedHandle,
    pub(super) thread: SharedHandle,
    // output_reader 与 input 必须排在 HPCON 前 drop：未走结构化 release 时先关闭
    // parent pipe 并请求取消 writer，避免旧系统在 ClosePseudoConsole 内互等。
    pub(super) output_reader: SharedHandle,
    pub(super) input: PtyInputWriter,
    pub(super) pseudoconsole: SharedPseudoConsole,
    pub(super) conpty_input_reader: SharedHandle,
    pub(super) conpty_output_writer: SharedHandle,
    pub(super) output_flow: OutputFlowGate,
    pub(super) observers_started: AtomicBool,
    pub(super) output_observer_started: AtomicBool,
    pub(super) observers_ready: AtomicBool,
    pub(super) observer_threads: Mutex<Vec<JoinHandle<()>>>,
    pub(super) resume_claimed: AtomicBool,
    pub(super) released: AtomicBool,
    pub(super) fault_injection: NativeFaultInjection,
}

impl WindowsOwnedPtyProcessState {
    pub(crate) fn create(
        spec: NativeLaunchSpec,
        columns: u16,
        rows: u16,
        fault_injection: NativeFaultInjection,
    ) -> NativeResult<Self> {
        let resources = create_windows_pty_resources(spec, columns, rows, &fault_injection)?;
        let input = PtyInputWriter::start(resources.input_writer)?;
        fault_injection.check("input_writer_ready")?;
        Ok(Self {
            job: SharedHandle::new(resources.job),
            process: SharedHandle::new(resources.process),
            thread: SharedHandle::new(resources.thread),
            output_reader: SharedHandle::new(resources.output_reader),
            input,
            pseudoconsole: resources.pseudoconsole,
            conpty_input_reader: SharedHandle::new(resources.conpty_input_reader),
            conpty_output_writer: SharedHandle::new(resources.conpty_output_writer),
            output_flow: OutputFlowGate::default(),
            observers_started: AtomicBool::new(false),
            output_observer_started: AtomicBool::new(false),
            observers_ready: AtomicBool::new(false),
            observer_threads: Mutex::new(Vec::new()),
            resume_claimed: AtomicBool::new(false),
            released: AtomicBool::new(false),
            fault_injection,
        })
    }

    pub(super) fn observe_root(
        self: Arc<Self>,
        callback: Arc<PtyObserverCallback>,
        ready: mpsc::Sender<NativeResult<()>>,
    ) {
        let process = match self.process.lock("pty_root_observer_lock") {
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
        let Some(handle) = process.as_ref() else {
            let error = NativeError::contract("pty_root_observer_lock", "process is closed");
            let description = error.to_string();
            let _ = ready.send(Err(error));
            Self::publish_observer_event(
                &callback,
                ("observer_error".to_owned(), None, None, Some(description)),
            );
            return;
        };
        if ready.send(Ok(())).is_err() {
            return;
        }
        // SAFETY: root observer 持有 process SharedHandle 锁，等待期间句柄不会被关闭。
        let wait = unsafe { WaitForSingleObject(handle.as_raw(), INFINITE) };
        let result = if wait == WAIT_FAILED {
            Err(NativeError::last_win32("pty_root_wait"))
        } else if wait != WAIT_OBJECT_0 {
            Err(NativeError::contract(
                "pty_root_wait",
                format!("unexpected wait result: {wait}"),
            ))
        } else {
            let mut exit_code = 0u32;
            // SAFETY: 同一锁仍保活已经 signaled 的 process handle。
            if unsafe { GetExitCodeProcess(handle.as_raw(), &mut exit_code) } == 0 {
                Err(NativeError::last_win32("pty_root_exit_code"))
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

    pub(super) fn start_observers(
        self: &Arc<Self>,
        callback: PtyObserverCallback,
    ) -> NativeResult<()> {
        if self
            .observers_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(NativeError::contract(
                "pty_observer_start",
                "native observers were already started",
            ));
        }
        let callback = Arc::new(callback);
        let (ready_sender, ready_receiver) = mpsc::channel::<NativeResult<()>>();
        let mut observers = self.observer_threads.lock().map_err(|_| {
            NativeError::contract("pty_observer_thread_store", "thread lock was poisoned")
        })?;
        for (name, output, fault_stage) in [
            ("linnya-command-pty-output", true, "output_observer_spawn"),
            ("linnya-command-pty-root", false, "root_observer_spawn"),
        ] {
            if let Err(error) = self.fault_injection.check(fault_stage) {
                drop(observers);
                return Err(self.cleanup_after_start_failure(error));
            }
            let state = Arc::clone(self);
            let callback = Arc::clone(&callback);
            let ready = ready_sender.clone();
            let observer = thread::Builder::new()
                .name(name.to_owned())
                .spawn(move || {
                    if output {
                        state.observe_output(callback, ready);
                    } else {
                        state.observe_root(callback, ready);
                    }
                })
                .map_err(|error| {
                    NativeError::contract("pty_observer_thread_spawn", error.to_string())
                });
            match observer {
                Ok(observer) => {
                    observers.push(observer);
                    if output {
                        self.output_observer_started.store(true, Ordering::Release);
                    }
                }
                Err(error) => {
                    drop(observers);
                    return Err(self.cleanup_after_start_failure(error));
                }
            }
        }
        drop(ready_sender);
        drop(observers);

        for _ in 0..2 {
            match ready_receiver.recv_timeout(OBSERVER_READY_DEADLINE) {
                Ok(Ok(())) => {}
                Ok(Err(error)) => return Err(self.cleanup_after_start_failure(error)),
                Err(error) => {
                    return Err(self.cleanup_after_start_failure(NativeError::contract(
                        "pty_observer_ready",
                        error.to_string(),
                    )));
                }
            }
        }
        if let Err(error) = self.fault_injection.check("observer_ready") {
            return Err(self.cleanup_after_start_failure(error));
        }
        self.observers_ready.store(true, Ordering::Release);
        Ok(())
    }

    pub(crate) fn resume(&self) -> NativeResult<()> {
        if !self.observers_ready.load(Ordering::Acquire) {
            return Err(NativeError::contract(
                "pty_resume",
                "native observers are not ready",
            ));
        }
        if self
            .resume_claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(NativeError::contract(
                "pty_resume",
                "suspended root resume was already claimed",
            ));
        }
        if let Err(error) = self.fault_injection.check("resume") {
            return Err(self.cleanup_after_start_failure(error));
        }
        let mut initial_thread = self.thread.lock("pty_thread_resume")?;
        let handle = initial_thread
            .as_ref()
            .ok_or_else(|| NativeError::contract("pty_thread_resume", "thread is closed"))?;
        // SAFETY: initial_thread 锁保活 CreateProcessW 返回的 suspended 主线程句柄。
        let previous_suspend_count = unsafe { ResumeThread(handle.as_raw()) };
        if previous_suspend_count == u32::MAX {
            let error = NativeError::last_win32("pty_thread_resume");
            drop(initial_thread);
            return Err(self.cleanup_after_start_failure(error));
        }
        if previous_suspend_count != 1 {
            drop(initial_thread);
            return Err(self.cleanup_after_start_failure(NativeError::contract(
                "pty_thread_resume",
                format!("unexpected previous suspend count: {previous_suspend_count}"),
            )));
        }
        let resumed_thread = initial_thread
            .take()
            .expect("thread handle was checked above");
        drop(initial_thread);
        resumed_thread.close("pty_thread_close_after_resume")
    }

    pub(crate) fn write_input(&self, data: Vec<u8>) -> NativeResult<u32> {
        self.input.write(data)
    }

    #[cfg(feature = "test-fault-injection")]
    pub(crate) fn input_write_in_progress_for_test(&self) -> bool {
        self.input.is_write_in_progress()
    }

    pub(crate) fn resize(&self, columns: u16, rows: u16) -> NativeResult<()> {
        validate_pty_size(columns, rows)?;
        self.pseudoconsole.resize(columns, rows)
    }

    pub(crate) fn resume_output(&self) -> NativeResult<()> {
        self.output_flow.resume()
    }

    pub(crate) fn cancel_output(&self) {
        self.output_flow.close();
    }

    #[cfg(feature = "test-fault-injection")]
    pub(crate) fn active_process_count_for_test(&self) -> NativeResult<u32> {
        let job = self.job.lock("pty_job_accounting")?;
        let handle = job
            .as_ref()
            .ok_or_else(|| NativeError::contract("pty_job_accounting", "Job is closed"))?;
        active_process_count(handle.as_raw())
    }

    pub(crate) fn terminate_and_wait_tree_empty(&self) -> NativeResult<()> {
        let tree_result = (|| {
            let job = self.job.lock("pty_tree_terminate")?;
            let handle = job
                .as_ref()
                .ok_or_else(|| NativeError::contract("pty_tree_terminate", "Job is closed"))?;
            let termination_handle = handle.duplicate("pty_tree_terminate_handle")?;
            drop(job);

            if active_process_count(termination_handle.as_raw())? > 0
                // SAFETY: duplicate 在本轮终止与有限 accounting 等待期间独占保活 Job。
                && unsafe {
                    TerminateJobObject(termination_handle.as_raw(), OWNER_TERMINATION_EXIT_CODE)
                } == 0
            {
                Err(NativeError::last_win32("pty_tree_terminate"))
            } else {
                wait_for_tree_empty(termination_handle.as_raw())
            }
        })();
        // tree 查询/终止失败也必须独立取消 writer；否则一个真实 Job 错误会继续留下
        // 阻塞的同步 WriteFile，并把清理失败放大为 owner 无法释放。
        let input_result = self.input.cancel();
        match (tree_result, input_result) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(tree), Ok(())) => Err(tree),
            (Ok(()), Err(input)) => Err(input),
            (Err(tree), Err(input)) => Err(NativeError::contract(
                "pty_tree_cleanup",
                format!("tree={tree}; input={input}"),
            )),
        }
    }

    fn join_observers(&self) -> NativeResult<()> {
        let observers = self
            .observer_threads
            .lock()
            .map_err(|_| NativeError::contract("pty_observer_join", "thread lock was poisoned"))?
            .drain(..)
            .collect::<Vec<_>>();
        let mut panicked = Vec::new();
        for observer in observers {
            let name = observer
                .thread()
                .name()
                .unwrap_or("unnamed-pty-observer")
                .to_owned();
            if observer.join().is_err() {
                panicked.push(name);
            }
        }
        if panicked.is_empty() {
            Ok(())
        } else {
            Err(NativeError::contract(
                "pty_observer_join",
                format!("observer threads panicked: {}", panicked.join(",")),
            ))
        }
    }

    pub(crate) fn release(&self) -> NativeResult<()> {
        if self.released.load(Ordering::Acquire) {
            return Ok(());
        }
        {
            let job = self.job.lock("pty_resource_release")?;
            let handle = job
                .as_ref()
                .ok_or_else(|| NativeError::contract("pty_resource_release", "Job is closed"))?;
            if active_process_count(handle.as_raw())? != 0 {
                return Err(NativeError::contract(
                    "pty_resource_release",
                    "Job still owns active processes",
                ));
            }
        }
        {
            let process = self.process.lock("pty_resource_release")?;
            let handle = process.as_ref().ok_or_else(|| {
                NativeError::contract("pty_resource_release", "process is closed")
            })?;
            // Job accounting 到 0 与 process handle 进入 signaled 存在短暂系统竞态。
            // release 已在 Node worker，因而在不可逆关闭 HPCON 前有限等待真实 root
            // handle；不能把这一竞态推给 JavaScript 用 sleep/retry 猜测。
            // SAFETY: process 锁在有限等待期间保活句柄。
            let wait = unsafe {
                WaitForSingleObject(handle.as_raw(), ROOT_EXIT_DEADLINE.as_millis() as u32)
            };
            if wait == WAIT_FAILED {
                return Err(NativeError::last_win32("pty_resource_release_root_wait"));
            }
            if wait != WAIT_OBJECT_0 {
                return Err(NativeError::contract(
                    "pty_resource_release",
                    format!("root process did not signal before deadline; wait={wait}"),
                ));
            }
        }

        // 先让 input writer 确实结束，再关闭 HPCON。output observer 此时仍在独立线程
        // 持续 drain；这是 Win10/旧 Win11 避免 ClosePseudoConsole 死锁的必要顺序。
        let mut failures = Vec::<String>::new();
        match self.input.join_for_release() {
            PtyInputJoinOutcome::Stopped(Ok(())) => {}
            PtyInputJoinOutcome::Stopped(Err(error)) => failures.push(format!("input={error}")),
            PtyInputJoinOutcome::StillRunning(error) => {
                // writer 仍可能持有 ConPTY input pipe 时不能关闭 HPCON。这里尚未越过
                // 不可逆资源边界，因此保留 owner，让调用方稍后重试同一个 release。
                return Err(NativeError::contract(
                    "pty_resource_release_retryable",
                    error.to_string(),
                ));
            }
        }
        if !self.output_observer_started.load(Ordering::Acquire)
            && let Err(error) = self
                .output_reader
                .close("pty_output_release_without_observer")
        {
            failures.push(format!("output={error}"));
        }
        // HPCON close 是不可逆边界。越过后每个相互独立的关闭与 join 都必须尝试，
        // 不能让第一项错误跳过后续清理并留下 reader、process 或 Job handle。
        for (stage, result) in [
            ("pseudoconsole", self.pseudoconsole.close()),
            (
                "conpty_input",
                self.conpty_input_reader.close("pty_conpty_input_release"),
            ),
            (
                "conpty_output",
                self.conpty_output_writer.close("pty_conpty_output_release"),
            ),
            ("observers", self.join_observers()),
        ] {
            if let Err(error) = result {
                failures.push(format!("{stage}={error}"));
            }
        }
        match self.output_reader.is_closed("pty_resource_release") {
            Ok(true) => {}
            Ok(false) => failures.push("output=terminal output has not reached EOF".to_owned()),
            Err(error) => failures.push(format!("output={error}")),
        }
        for (stage, result) in [
            ("thread", self.thread.close("pty_thread_release")),
            ("process", self.process.close("pty_process_release")),
            ("job", self.job.close("pty_job_release")),
        ] {
            if let Err(error) = result {
                failures.push(format!("{stage}={error}"));
            }
        }
        if !failures.is_empty() {
            return Err(NativeError::contract(
                "pty_resource_release",
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
        let process = self.process.lock("pty_test_process_identity")?;
        let handle = process.as_ref().ok_or_else(|| {
            NativeError::contract("pty_test_process_identity", "process is closed")
        })?;
        read_process_identity_for_test(handle.as_raw())
    }

    pub(super) fn cleanup_after_start_failure(&self, startup: NativeError) -> NativeError {
        self.output_flow.close();
        let cleanup = self.terminate_and_wait_tree_empty();
        match cleanup {
            Ok(()) => startup,
            Err(cleanup) => NativeError::contract(
                "pty_startup_cleanup",
                format!("startup={startup}; cleanup={cleanup}"),
            ),
        }
    }
}
