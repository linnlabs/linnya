use std::fmt::{Display, Formatter};

use napi::{Error, Status};

#[derive(Debug)]
pub(crate) struct NativeError {
    stage: &'static str,
    win32_code: Option<u32>,
    detail: Option<String>,
}

impl NativeError {
    #[cfg(target_os = "windows")]
    pub(crate) fn last_win32(stage: &'static str) -> Self {
        // SAFETY: GetLastError 没有指针或句柄前置条件；调用方必须在失败的 Win32 调用后立即进入这里。
        Self::win32(stage, unsafe {
            windows_sys::Win32::Foundation::GetLastError()
        })
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn win32(stage: &'static str, code: u32) -> Self {
        Self {
            stage,
            win32_code: Some(code),
            detail: None,
        }
    }

    pub(crate) fn contract(stage: &'static str, detail: impl Into<String>) -> Self {
        Self {
            stage,
            win32_code: None,
            detail: Some(detail.into()),
        }
    }
}

impl Display for NativeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "windows_process_owner stage={}", self.stage)?;
        if let Some(code) = self.win32_code {
            write!(formatter, " win32_error={code}")?;
        }
        if let Some(detail) = &self.detail {
            write!(formatter, " detail={detail}")?;
        }
        Ok(())
    }
}

impl std::error::Error for NativeError {}

impl From<NativeError> for Error {
    fn from(error: NativeError) -> Self {
        Error::new(Status::GenericFailure, error.to_string())
    }
}

pub(crate) type NativeResult<T> = Result<T, NativeError>;
