use std::ptr::null_mut;
use std::sync::atomic::Ordering;
use std::sync::{Arc, mpsc};

use napi::Status;
use napi::bindgen_prelude::Buffer;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use windows_sys::Win32::Foundation::{ERROR_BROKEN_PIPE, ERROR_HANDLE_EOF};
use windows_sys::Win32::Storage::FileSystem::ReadFile;

use super::WindowsOwnedProcessState;
use crate::error::{NativeError, NativeResult};
use crate::{WindowsObserverEvent, WindowsObserverFunction};

const PIPE_READ_SIZE: u32 = 65_536;

pub(super) type ObserverCallback =
    ThreadsafeFunction<WindowsObserverEvent, bool, WindowsObserverEvent, Status, false, false, 4>;

#[derive(Clone, Copy)]
pub(super) enum ObserverChannel {
    Stdout,
    Stderr,
}

impl ObserverChannel {
    fn data_event(&self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
        }
    }

    fn eof_event(&self) -> &'static str {
        match self {
            Self::Stdout => "stdout_eof",
            Self::Stderr => "stderr_eof",
        }
    }

    fn name(&self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
        }
    }
}

impl WindowsOwnedProcessState {
    pub(super) fn publish_observer_event(
        callback: &ObserverCallback,
        event: WindowsObserverEvent,
    ) -> bool {
        callback.call(event, ThreadsafeFunctionCallMode::Blocking) == Status::Ok
    }

    fn output_flow(&self, channel: ObserverChannel) -> &crate::output_flow::OutputFlowGate {
        match channel {
            ObserverChannel::Stdout => &self.stdout_flow,
            ObserverChannel::Stderr => &self.stderr_flow,
        }
    }

    fn publish_output_event(
        &self,
        channel: ObserverChannel,
        callback: &ObserverCallback,
        buffer: Buffer,
    ) -> NativeResult<bool> {
        let flow = self.output_flow(channel);
        if !flow.begin_delivery()? {
            return Ok(false);
        }
        let (result_sender, result_receiver) = mpsc::sync_channel::<Result<bool, String>>(1);
        let status = callback.call_with_return_value(
            (channel.data_event().to_owned(), Some(buffer), None, None),
            ThreadsafeFunctionCallMode::NonBlocking,
            move |result, _environment| {
                let _ = result_sender.send(result.map_err(|error| error.to_string()));
                Ok(())
            },
        );
        if status != Status::Ok {
            flow.cancel_delivery();
            return Err(NativeError::contract(
                "output_callback",
                format!("{} callback enqueue failed: {status:?}", channel.name()),
            ));
        }
        let accepted = result_receiver
            .recv()
            .map_err(|error| {
                NativeError::contract(
                    "output_callback",
                    format!("{} callback result channel closed: {error}", channel.name()),
                )
            })?
            .map_err(|error| {
                NativeError::contract(
                    "output_callback",
                    format!("{} callback failed: {error}", channel.name()),
                )
            })?;
        flow.finish_delivery(accepted)
    }

    fn fail_observation(&self, callback: &ObserverCallback, observation: NativeError) {
        // callback 已失败时不能再继续读取并排队。先关闭两条流量门并终止 Job，
        // 让另一个 pipe observer 和 root observer 都能到达有限终态，再尽力报告原错误。
        self.stdout_flow.close();
        self.stderr_flow.close();
        let cleanup = self.terminate_and_wait_tree_empty();
        let message = match cleanup {
            Ok(()) => observation.to_string(),
            Err(error) => format!("observation={observation}; cleanup={error}"),
        };
        Self::publish_observer_event(
            callback,
            ("observer_error".to_owned(), None, None, Some(message)),
        );
    }

    pub(super) fn observe_pipe(
        self: Arc<Self>,
        channel: ObserverChannel,
        callback: Arc<ObserverCallback>,
        ready: mpsc::Sender<NativeResult<()>>,
    ) {
        let pipe = match channel {
            ObserverChannel::Stdout => &self.stdout_reader,
            ObserverChannel::Stderr => &self.stderr_reader,
        };
        let flow = self.output_flow(channel);
        let mut locked = match pipe.lock("observer_pipe_lock") {
            Ok(locked) => locked,
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
        if locked.is_none() {
            let error = NativeError::contract("observer_pipe_lock", "pipe handle is closed");
            let description = error.to_string();
            let _ = ready.send(Err(error));
            Self::publish_observer_event(
                &callback,
                ("observer_error".to_owned(), None, None, Some(description)),
            );
            return;
        }
        // 此 checkpoint 只在专用线程已经独占 reader handle 后发布；主线程随后才能
        // ResumeThread。即使调度恰好发生在下一条 ReadFile 前，pipe 已建立且不会丢 byte。
        if ready.send(Ok(())).is_err() {
            locked.take();
            return;
        }

        loop {
            let handle = match locked.as_ref() {
                Some(handle) => handle,
                None => return,
            };
            let mut buffer = vec![0u8; PIPE_READ_SIZE as usize];
            let mut bytes_read = 0u32;
            // SAFETY: observer 持有 SharedHandle 锁，reader 在整个同步 ReadFile 期间不会被关闭；
            // buffer 长度等于 PIPE_READ_SIZE，bytes_read 是有效输出地址。
            let succeeded = unsafe {
                ReadFile(
                    handle.as_raw(),
                    buffer.as_mut_ptr(),
                    PIPE_READ_SIZE,
                    &mut bytes_read,
                    null_mut(),
                )
            };
            if succeeded == 0 {
                // SAFETY: 紧接失败的 ReadFile 读取线程本地 Win32 错误，没有其他 Win32 调用插入。
                let code = unsafe { windows_sys::Win32::Foundation::GetLastError() };
                locked.take();
                flow.close();
                if code == ERROR_BROKEN_PIPE || code == ERROR_HANDLE_EOF {
                    Self::publish_observer_event(
                        &callback,
                        (channel.eof_event().to_owned(), None, None, None),
                    );
                } else {
                    Self::publish_observer_event(
                        &callback,
                        (
                            "observer_error".to_owned(),
                            None,
                            None,
                            Some(NativeError::win32("pipe_read", code).to_string()),
                        ),
                    );
                }
                return;
            }
            if bytes_read == 0 {
                locked.take();
                flow.close();
                Self::publish_observer_event(
                    &callback,
                    (channel.eof_event().to_owned(), None, None, None),
                );
                return;
            }
            buffer.truncate(bytes_read as usize);
            match self.publish_output_event(channel, &callback, Buffer::from(buffer)) {
                Ok(true) => {}
                Ok(false) => {
                    locked.take();
                    return;
                }
                Err(error) => {
                    locked.take();
                    self.fail_observation(&callback, error);
                    return;
                }
            }
        }
    }

    pub(crate) fn resume_output(&self, channel: &str) -> NativeResult<()> {
        match channel {
            "stdout" => self.stdout_flow.resume(),
            "stderr" => self.stderr_flow.resume(),
            _ => Err(NativeError::contract(
                "output_flow",
                format!("unknown output channel: {channel}"),
            )),
        }
    }

    pub(crate) fn cancel_output(&self, channel: &str) -> NativeResult<()> {
        match channel {
            "stdout" => {
                self.stdout_flow.close();
                Ok(())
            }
            "stderr" => {
                self.stderr_flow.close();
                Ok(())
            }
            _ => Err(NativeError::contract(
                "output_flow",
                format!("unknown output channel: {channel}"),
            )),
        }
    }

    pub(crate) fn start_observers_from_js(
        self: &Arc<Self>,
        callback: WindowsObserverFunction<'_>,
    ) -> NativeResult<()> {
        if let Err(error) = self.fault_injection.check("observer_callback_build") {
            return Err(self.rollback_before_observers(error));
        }
        let callback = match callback
            .build_threadsafe_function::<WindowsObserverEvent>()
            .callee_handled::<false>()
            .max_queue_size::<4>()
            .build()
        {
            Ok(callback) => callback,
            Err(error) => {
                return Err(self.rollback_before_observers(NativeError::contract(
                    "observer_callback_build",
                    error.to_string(),
                )));
            }
        };
        self.start_observers(callback)
    }

    fn rollback_before_observers(&self, startup: NativeError) -> NativeError {
        let rollback = self.terminate_and_wait_tree_empty();
        self.stdout_flow.close();
        self.stderr_flow.close();
        let mut cleanup_failures = Vec::<String>::new();
        if let Err(error) = rollback {
            cleanup_failures.push(format!("rollback={error}"));
        }
        for (stage, result) in [
            ("stdin", self.stdin_writer.close("stdin_startup_rollback")),
            (
                "stdout",
                self.stdout_reader.close("stdout_startup_rollback"),
            ),
            (
                "stderr",
                self.stderr_reader.close("stderr_startup_rollback"),
            ),
            ("thread", self.thread.close("thread_startup_rollback")),
            ("job", self.job.close("job_startup_rollback")),
            ("process", self.process.close("process_startup_rollback")),
        ] {
            if let Err(error) = result {
                cleanup_failures.push(format!("{stage}={error}"));
            }
        }
        if cleanup_failures.is_empty() {
            self.released.store(true, Ordering::Release);
            startup
        } else {
            NativeError::contract(
                "startup_cleanup",
                format!("startup={startup}; {}", cleanup_failures.join("; ")),
            )
        }
    }
}
