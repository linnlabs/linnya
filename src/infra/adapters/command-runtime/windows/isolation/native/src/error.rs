use std::fmt::{Display, Formatter};

#[derive(Debug, Clone)]
pub struct IsolationError {
    stage: &'static str,
    detail: String,
}

impl IsolationError {
    pub(crate) fn new(stage: &'static str, detail: impl Into<String>) -> Self {
        Self {
            stage,
            detail: detail.into(),
        }
    }
}

impl Display for IsolationError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "windows_command_isolation stage={} detail={}",
            self.stage, self.detail
        )
    }
}

impl std::error::Error for IsolationError {}

pub type IsolationResult<T> = Result<T, IsolationError>;
