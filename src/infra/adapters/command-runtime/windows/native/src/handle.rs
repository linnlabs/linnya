use std::sync::{Mutex, MutexGuard};

use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{CloseHandle, DUPLICATE_SAME_ACCESS, DuplicateHandle, HANDLE};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

use crate::error::{NativeError, NativeResult};

#[derive(Debug)]
pub(crate) struct OwnedHandle {
    raw: usize,
}

impl OwnedHandle {
    pub(crate) fn from_raw(raw: HANDLE, stage: &'static str) -> NativeResult<Self> {
        if raw.is_null() {
            return Err(NativeError::last_win32(stage));
        }
        Ok(Self { raw: raw as usize })
    }

    pub(crate) fn as_raw(&self) -> HANDLE {
        self.raw as HANDLE
    }

    pub(crate) fn duplicate(&self, stage: &'static str) -> NativeResult<Self> {
        // SAFETY: GetCurrentProcess 返回当前进程的永久伪句柄，不需要也不能由本模块关闭。
        let current_process = unsafe { GetCurrentProcess() };
        let mut duplicate = null_mut();
        // SAFETY: self 在锁或独占所有权下持有有效句柄，输出地址指向本地 HANDLE；
        // 成功后 duplicate 立即转入 OwnedHandle，失败时系统不会移交所有权。
        if unsafe {
            DuplicateHandle(
                current_process,
                self.as_raw(),
                current_process,
                &mut duplicate,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            )
        } == 0
        {
            return Err(NativeError::last_win32(stage));
        }
        Self::from_raw(duplicate, stage)
    }

    pub(crate) fn close(mut self, stage: &'static str) -> NativeResult<()> {
        let raw = self.raw;
        self.raw = 0;
        // SAFETY: raw 来自本 OwnedHandle 的唯一所有权，并在调用前置零，Drop 不会重复关闭。
        if unsafe { CloseHandle(raw as HANDLE) } == 0 {
            return Err(NativeError::last_win32(stage));
        }
        Ok(())
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if self.raw != 0 {
            // SAFETY: 非零 raw 仍由本 OwnedHandle 唯一拥有；Drop 只执行一次且随后置零。
            unsafe {
                CloseHandle(self.raw as HANDLE);
            }
            self.raw = 0;
        }
    }
}

#[derive(Debug)]
pub(crate) struct SharedHandle {
    value: Mutex<Option<OwnedHandle>>,
}

impl SharedHandle {
    pub(crate) fn new(handle: OwnedHandle) -> Self {
        Self {
            value: Mutex::new(Some(handle)),
        }
    }

    pub(crate) fn lock(
        &self,
        stage: &'static str,
    ) -> NativeResult<MutexGuard<'_, Option<OwnedHandle>>> {
        self.value
            .lock()
            .map_err(|_| NativeError::contract(stage, "native handle lock was poisoned"))
    }

    pub(crate) fn close(&self, stage: &'static str) -> NativeResult<()> {
        let handle = self.lock(stage)?.take();
        match handle {
            Some(value) => value.close(stage),
            None => Ok(()),
        }
    }

    pub(crate) fn is_closed(&self, stage: &'static str) -> NativeResult<bool> {
        Ok(self.lock(stage)?.is_none())
    }
}
