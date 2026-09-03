use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{
    DUPLICATE_SAME_ACCESS, DuplicateHandle, ERROR_NOT_FOUND, GetLastError, HANDLE, WAIT_OBJECT_0,
    WAIT_TIMEOUT,
};
use windows_sys::Win32::Storage::FileSystem::WriteFile;
use windows_sys::Win32::System::IO::CancelSynchronousIo;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentThread, WaitForSingleObject,
};

use crate::error::{NativeError, NativeResult};
use crate::handle::{OwnedHandle, SharedHandle};

enum InputRequest {
    Write {
        data: Vec<u8>,
        completion: mpsc::SyncSender<NativeResult<u32>>,
    },
}

const WRITER_IDLE: u8 = 0;
const WRITER_IN_WRITE: u8 = 1;
const WRITER_STOPPED: u8 = 2;
const INPUT_CANCEL_DEADLINE: Duration = Duration::from_secs(5);
const INPUT_CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(2);

pub(super) struct PtyInputWriter {
    sender: Mutex<Option<mpsc::SyncSender<InputRequest>>>,
    thread_handle: SharedHandle,
    thread: Mutex<Option<JoinHandle<()>>>,
    cancelled: Arc<AtomicBool>,
    phase: Arc<AtomicU8>,
}

pub(super) enum PtyInputJoinOutcome {
    Stopped(NativeResult<()>),
    StillRunning(NativeError),
}

fn duplicate_current_thread() -> NativeResult<OwnedHandle> {
    // SAFETY: GetCurrentProcess 返回不需要关闭的当前进程伪句柄。
    let current_process = unsafe { GetCurrentProcess() };
    // SAFETY: GetCurrentThread 返回不需要关闭的当前线程伪句柄。
    let current_thread = unsafe { GetCurrentThread() };
    let mut duplicate: HANDLE = null_mut();
    // SAFETY: 输出地址有效，目标进程就是当前进程；成功句柄立即进入 RAII。
    if unsafe {
        DuplicateHandle(
            current_process,
            current_thread,
            current_process,
            &mut duplicate,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        )
    } == 0
    {
        return Err(NativeError::last_win32("pty_input_thread_handle"));
    }
    OwnedHandle::from_raw(duplicate, "pty_input_thread_handle")
}

fn write_all(handle: HANDLE, data: &[u8], cancelled: &AtomicBool) -> NativeResult<u32> {
    let mut offset = 0usize;
    while offset < data.len() {
        if cancelled.load(Ordering::Acquire) {
            return Err(NativeError::contract(
                "pty_input_cancelled",
                "input writer was cancelled",
            ));
        }
        let remaining = &data[offset..];
        let chunk_length = remaining.len().min(u32::MAX as usize) as u32;
        let mut bytes_written = 0u32;
        // SAFETY: writer thread 独占 input HANDLE；remaining 在同步 WriteFile 期间保活，
        // bytes_written 是有效输出地址。取消通过该线程的真实 handle 定向触发。
        if unsafe {
            WriteFile(
                handle,
                remaining.as_ptr(),
                chunk_length,
                &mut bytes_written,
                null_mut(),
            )
        } == 0
        {
            return Err(NativeError::last_win32(
                if cancelled.load(Ordering::Acquire) {
                    "pty_input_cancelled"
                } else {
                    "pty_input_write"
                },
            ));
        }
        if bytes_written == 0 {
            return Err(NativeError::contract(
                "pty_input_write",
                "WriteFile succeeded without progress",
            ));
        }
        offset += bytes_written as usize;
    }
    u32::try_from(offset).map_err(|_| {
        NativeError::contract(
            "pty_input_write",
            "PTY input exceeded the u32 result contract",
        )
    })
}

impl PtyInputWriter {
    pub(super) fn start(input_writer: OwnedHandle) -> NativeResult<Self> {
        let (sender, receiver) = mpsc::sync_channel::<InputRequest>(1);
        let (ready_sender, ready_receiver) = mpsc::sync_channel::<NativeResult<OwnedHandle>>(1);
        let cancelled = Arc::new(AtomicBool::new(false));
        let thread_cancelled = Arc::clone(&cancelled);
        let phase = Arc::new(AtomicU8::new(WRITER_IDLE));
        let thread_phase = Arc::clone(&phase);
        let thread = thread::Builder::new()
            .name("linnya-command-pty-input".to_owned())
            .spawn(move || {
                let thread_handle = match duplicate_current_thread() {
                    Ok(thread_handle) => thread_handle,
                    Err(error) => {
                        let _ = ready_sender.send(Err(error));
                        return;
                    }
                };
                if ready_sender.send(Ok(thread_handle)).is_err() {
                    return;
                }

                while let Ok(request) = receiver.recv() {
                    match request {
                        InputRequest::Write { data, completion } => {
                            // 先发布 phase，再检查 cancel。这样 cancel 不会落在“已检查但尚未
                            // 进入 WriteFile”的空窗；只要 phase 仍为 IN_WRITE，就持续定向取消。
                            thread_phase.store(WRITER_IN_WRITE, Ordering::Release);
                            let result = if thread_cancelled.load(Ordering::Acquire) {
                                Err(NativeError::contract(
                                    "pty_input_cancelled",
                                    "input writer was cancelled",
                                ))
                            } else {
                                write_all(input_writer.as_raw(), &data, &thread_cancelled)
                            };
                            thread_phase.store(WRITER_IDLE, Ordering::Release);
                            let _ = completion.send(result);
                        }
                    }
                }
                thread_phase.store(WRITER_STOPPED, Ordering::Release);
            })
            .map_err(|error| NativeError::contract("pty_input_thread_spawn", error.to_string()))?;

        let thread_handle = match ready_receiver.recv() {
            Ok(Ok(thread_handle)) => thread_handle,
            Ok(Err(error)) => {
                let _ = thread.join();
                return Err(error);
            }
            Err(error) => {
                let _ = thread.join();
                return Err(NativeError::contract(
                    "pty_input_thread_ready",
                    error.to_string(),
                ));
            }
        };
        Ok(Self {
            sender: Mutex::new(Some(sender)),
            thread_handle: SharedHandle::new(thread_handle),
            thread: Mutex::new(Some(thread)),
            cancelled,
            phase,
        })
    }

    pub(super) fn write(&self, data: Vec<u8>) -> NativeResult<u32> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(NativeError::contract(
                "pty_input_cancelled",
                "input writer was cancelled",
            ));
        }
        let sender = self
            .sender
            .lock()
            .map_err(|_| NativeError::contract("pty_input_queue", "queue lock was poisoned"))?
            .as_ref()
            .cloned()
            .ok_or_else(|| NativeError::contract("pty_input_cancelled", "input is closed"))?;
        let (completion_sender, completion_receiver) = mpsc::sync_channel(1);
        sender
            .send(InputRequest::Write {
                data,
                completion: completion_sender,
            })
            .map_err(|_| {
                NativeError::contract("pty_input_queue", "input writer thread is closed")
            })?;
        completion_receiver.recv().map_err(|_| {
            NativeError::contract(
                "pty_input_completion",
                "input writer exited without reporting a result",
            )
        })?
    }

    fn close_queue(&self) -> NativeResult<()> {
        self.cancelled.store(true, Ordering::Release);
        self.sender
            .lock()
            .map_err(|_| NativeError::contract("pty_input_cancel", "queue lock was poisoned"))?
            .take();
        Ok(())
    }

    fn cancel_current_write(&self) -> NativeResult<()> {
        if self.phase.load(Ordering::Acquire) != WRITER_IN_WRITE {
            return Ok(());
        }
        let thread_handle = self.thread_handle.lock("pty_input_cancel")?;
        let Some(thread_handle) = thread_handle.as_ref() else {
            return Ok(());
        };
        // CancelSynchronousIo 只取消目标 writer thread 当前的同步 WriteFile，不会波及
        // output/root observer，也不依赖 PID 或进程枚举。
        // SAFETY: SharedHandle 锁在调用期间保活真实 thread handle。
        if unsafe { CancelSynchronousIo(thread_handle.as_raw()) } == 0 {
            // ERROR_NOT_FOUND 表示目标线程此刻尚未进入可取消的同步调用；调用方仍需
            // 观察 phase，不能把这一瞬间当成 writer 已经结束。
            // SAFETY: 紧接失败调用读取线程本地 Win32 错误。
            let code = unsafe { GetLastError() };
            if code != ERROR_NOT_FOUND {
                return Err(NativeError::win32("pty_input_cancel", code));
            }
        }
        Ok(())
    }

    fn request_cancel(&self) -> NativeResult<()> {
        // 这是给 owner 控制面使用的快速请求：只改变内存状态并执行一次定向取消，
        // 不轮询也不 join，因此不会反过来依赖已被阻塞写入占满的 libuv worker pool。
        self.close_queue()?;
        self.cancel_current_write()
    }

    #[cfg(feature = "test-fault-injection")]
    pub(super) fn is_write_in_progress(&self) -> bool {
        self.phase.load(Ordering::Acquire) == WRITER_IN_WRITE
    }

    pub(super) fn cancel(&self) -> NativeResult<()> {
        self.request_cancel()?;

        let deadline = Instant::now() + INPUT_CANCEL_DEADLINE;
        loop {
            let phase = self.phase.load(Ordering::Acquire);
            if phase != WRITER_IN_WRITE {
                return Ok(());
            }
            self.cancel_current_write()?;
            if Instant::now() >= deadline {
                return Err(NativeError::contract(
                    "pty_input_cancel",
                    "writer did not leave synchronous WriteFile before deadline",
                ));
            }
            thread::sleep(INPUT_CANCEL_POLL_INTERVAL);
        }
    }

    pub(super) fn join_for_release(&self) -> PtyInputJoinOutcome {
        let cancel_result = self.cancel();
        let wait_result = {
            let thread_handle = match self.thread_handle.lock("pty_input_join_wait") {
                Ok(handle) => handle,
                Err(error) => return PtyInputJoinOutcome::StillRunning(error),
            };
            match thread_handle.as_ref() {
                Some(thread_handle) => {
                    // SAFETY: 锁在有限等待期间保活 thread handle。
                    unsafe {
                        WaitForSingleObject(
                            thread_handle.as_raw(),
                            INPUT_CANCEL_DEADLINE.as_millis() as u32,
                        )
                    }
                }
                None => WAIT_OBJECT_0,
            }
        };
        if wait_result == WAIT_TIMEOUT {
            return PtyInputJoinOutcome::StillRunning(NativeError::contract(
                "pty_input_join",
                "input writer thread did not exit before deadline",
            ));
        }
        if wait_result != WAIT_OBJECT_0 {
            return PtyInputJoinOutcome::StillRunning(NativeError::last_win32(
                "pty_input_join_wait",
            ));
        }
        let thread = match self.thread.lock() {
            Ok(mut thread) => thread.take(),
            Err(_) => {
                return PtyInputJoinOutcome::Stopped(Err(NativeError::contract(
                    "pty_input_join",
                    "thread lock was poisoned",
                )));
            }
        };
        let join_result = match thread {
            Some(thread) => thread.join().map_err(|_| {
                NativeError::contract("pty_input_join", "input writer thread panicked")
            }),
            None => Ok(()),
        };
        let handle_result = self.thread_handle.close("pty_input_thread_close");
        let failures = [cancel_result, join_result, handle_result]
            .into_iter()
            .filter_map(Result::err)
            .map(|error| error.to_string())
            .collect::<Vec<_>>();
        if failures.is_empty() {
            PtyInputJoinOutcome::Stopped(Ok(()))
        } else {
            PtyInputJoinOutcome::Stopped(Err(NativeError::contract(
                "pty_input_join",
                failures.join("; "),
            )))
        }
    }
}

impl Drop for PtyInputWriter {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        if let Ok(sender) = self.sender.get_mut() {
            sender.take();
        }
        if let Ok(thread_handle) = self.thread_handle.lock("pty_input_drop")
            && let Some(thread_handle) = thread_handle.as_ref()
        {
            // SAFETY: Drop 仍持有真实 thread handle；错误只能尽力处理，正式释放由 join 验真。
            unsafe { CancelSynchronousIo(thread_handle.as_raw()) };
        }
        let thread_signaled = self
            .thread_handle
            .lock("pty_input_drop_wait")
            .ok()
            .is_some_and(|handle| {
                handle.as_ref().is_some_and(|handle| {
                    // SAFETY: SharedHandle 锁在零超时检查期间保活 thread handle。
                    (unsafe { WaitForSingleObject(handle.as_raw(), 0) }) == WAIT_OBJECT_0
                })
            });
        if thread_signaled
            && let Ok(thread) = self.thread.get_mut()
            && let Some(thread) = thread.take()
        {
            let _ = thread.join();
        }
    }
}
