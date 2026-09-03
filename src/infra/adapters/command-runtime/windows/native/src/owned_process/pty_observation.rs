use std::ptr::null_mut;
use std::sync::{Arc, mpsc};

use napi::Status;
use napi::bindgen_prelude::Buffer;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use windows_sys::Win32::Foundation::{ERROR_BROKEN_PIPE, ERROR_HANDLE_EOF};
use windows_sys::Win32::Storage::FileSystem::ReadFile;

use super::pty::WindowsOwnedPtyProcessState;
use crate::error::{NativeError, NativeResult};
use crate::{WindowsObserverEvent, WindowsObserverFunction};

const PIPE_READ_SIZE: u32 = 65_536;

pub(super) type PtyObserverCallback =
    ThreadsafeFunction<WindowsObserverEvent, bool, WindowsObserverEvent, Status, false, false, 4>;

impl WindowsOwnedPtyProcessState {
    pub(super) fn publish_observer_event(
        callback: &PtyObserverCallback,
        event: WindowsObserverEvent,
    ) -> bool {
        callback.call(event, ThreadsafeFunctionCallMode::Blocking) == Status::Ok
    }

    fn publish_output_event(
        &self,
        callback: &PtyObserverCallback,
        buffer: Buffer,
    ) -> NativeResult<bool> {
        if !self.output_flow.begin_delivery()? {
            return Ok(false);
        }
        let (result_sender, result_receiver) = mpsc::sync_channel::<Result<bool, String>>(1);
        let status = callback.call_with_return_value(
            ("terminal_data".to_owned(), Some(buffer), None, None),
            ThreadsafeFunctionCallMode::NonBlocking,
            move |result, _environment| {
                let _ = result_sender.send(result.map_err(|error| error.to_string()));
                Ok(())
            },
        );
        if status != Status::Ok {
            self.output_flow.cancel_delivery();
            return Err(NativeError::contract(
                "pty_output_callback",
                format!("callback enqueue failed: {status:?}"),
            ));
        }
        let accepted = result_receiver
            .recv()
            .map_err(|error| {
                NativeError::contract(
                    "pty_output_callback",
                    format!("callback result channel closed: {error}"),
                )
            })?
            .map_err(|error| {
                NativeError::contract("pty_output_callback", format!("callback failed: {error}"))
            })?;
        self.output_flow.finish_delivery(accepted)
    }

    fn fail_observation(&self, callback: &PtyObserverCallback, observation: NativeError) {
        self.output_flow.close();
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

    pub(super) fn observe_output(
        self: Arc<Self>,
        callback: Arc<PtyObserverCallback>,
        ready: mpsc::Sender<NativeResult<()>>,
    ) {
        let mut output = match self.output_reader.lock("pty_output_observer_lock") {
            Ok(output) => output,
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
        if output.is_none() {
            let error = NativeError::contract("pty_output_observer_lock", "output is closed");
            let description = error.to_string();
            let _ = ready.send(Err(error));
            Self::publish_observer_event(
                &callback,
                ("observer_error".to_owned(), None, None, Some(description)),
            );
            return;
        }
        // 只有专用 reader 已独占 output handle 后才允许 root resume。PTY 可能在用户代码
        // 启动后立即输出，不能用“线程已 spawn”或“第一条 output 到达”冒充 ready。
        if ready.send(Ok(())).is_err() {
            output.take();
            return;
        }

        loop {
            let Some(handle) = output.as_ref() else {
                return;
            };
            let mut buffer = vec![0u8; PIPE_READ_SIZE as usize];
            let mut bytes_read = 0u32;
            // SAFETY: observer 在同步 ReadFile 期间独占并保活 output handle；buffer 与
            // bytes_read 的容量和地址均与 Win32 参数一致。
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
                // SAFETY: 紧接失败的 ReadFile 读取线程本地错误。
                let code = unsafe { windows_sys::Win32::Foundation::GetLastError() };
                output.take();
                self.output_flow.close();
                if code == ERROR_BROKEN_PIPE || code == ERROR_HANDLE_EOF {
                    Self::publish_observer_event(
                        &callback,
                        ("terminal_eof".to_owned(), None, None, None),
                    );
                } else {
                    Self::publish_observer_event(
                        &callback,
                        (
                            "observer_error".to_owned(),
                            None,
                            None,
                            Some(NativeError::win32("pty_output_read", code).to_string()),
                        ),
                    );
                }
                return;
            }
            if bytes_read == 0 {
                output.take();
                self.output_flow.close();
                Self::publish_observer_event(
                    &callback,
                    ("terminal_eof".to_owned(), None, None, None),
                );
                return;
            }
            buffer.truncate(bytes_read as usize);
            match self.publish_output_event(&callback, Buffer::from(buffer)) {
                Ok(true) => {}
                Ok(false) => {
                    output.take();
                    return;
                }
                Err(error) => {
                    output.take();
                    self.fail_observation(&callback, error);
                    return;
                }
            }
        }
    }

    pub(crate) fn start_observers_from_js(
        self: &Arc<Self>,
        callback: WindowsObserverFunction<'_>,
    ) -> NativeResult<()> {
        if let Err(error) = self.fault_injection.check("observer_callback_build") {
            return Err(self.cleanup_after_start_failure(error));
        }
        let callback = callback
            .build_threadsafe_function::<WindowsObserverEvent>()
            .callee_handled::<false>()
            .max_queue_size::<4>()
            .build()
            .map_err(|error| {
                self.cleanup_after_start_failure(NativeError::contract(
                    "pty_observer_callback_build",
                    error.to_string(),
                ))
            })?;
        self.start_observers(callback)
    }
}
