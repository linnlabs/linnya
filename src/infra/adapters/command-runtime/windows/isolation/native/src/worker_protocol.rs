use crate::{
    IsolationError, IsolationResult,
    protocol::{read_frame_bounded, write_frame_bounded},
};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use zeroize::Zeroizing;

const MAX_WORKER_START_BYTES: usize = 4 * 1024 * 1024;

/// 命令/环境只从 native Host 交给非特权 worker，账户服务完全不接触此协议。
/// UTF-16 块沿用 native owner 已校验的 Windows 启动合同，不再用 Shell 二次拼接命令。
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerProgram {
    pub executable_path: Vec<u16>,
    pub command_line: Vec<u16>,
    pub cwd: Vec<u16>,
    pub environment: Zeroizing<Vec<u16>>,
    pub terminal: Option<WorkerTerminalSize>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerTerminalSize {
    pub columns: u16,
    pub rows: u16,
}

impl WorkerTerminalSize {
    pub(crate) fn validate(self) -> IsolationResult<()> {
        if self.columns == 0
            || self.rows == 0
            || self.columns > i16::MAX as u16
            || self.rows > i16::MAX as u16
        {
            return Err(IsolationError::new(
                "worker_terminal_size",
                "invalid terminal size",
            ));
        }
        Ok(())
    }
}

impl WorkerProgram {
    fn validate(&self) -> IsolationResult<()> {
        if let Some(size) = self.terminal {
            size.validate()?;
        }
        for value in [&self.executable_path, &self.command_line, &self.cwd] {
            if value.len() < 2 || value.last() != Some(&0) || value[..value.len() - 1].contains(&0)
            {
                return Err(IsolationError::new(
                    "worker_program",
                    "invalid Windows startup string",
                ));
            }
        }
        if self.command_line.len() > 32767 || !self.environment.ends_with(&[0, 0]) {
            return Err(IsolationError::new(
                "worker_program",
                "invalid Windows command or environment block",
            ));
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WorkerStart {
    pub(crate) handles: WorkerHandles,
    pub(crate) program: WorkerProgram,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerHandles {
    pub(crate) command_job: u64,
    pub(crate) stderr: u64,
    pub(crate) terminal_input: Option<u64>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum WorkerStatus {
    Ready { process: u64, thread: u64 },
    Resized { columns: u16, rows: u16 },
    Failed { message: String },
}

pub fn write_program(
    output: &mut impl Write,
    program: &WorkerProgram,
    handles: &WorkerHandles,
) -> IsolationResult<()> {
    program.validate()?;
    #[derive(Serialize)]
    struct StartRef<'a> {
        handles: &'a WorkerHandles,
        program: &'a WorkerProgram,
    }
    write_frame_bounded(
        output,
        &StartRef { handles, program },
        MAX_WORKER_START_BYTES,
    )
}

pub(crate) fn read_program(input: &mut impl Read) -> IsolationResult<WorkerStart> {
    let start: WorkerStart = read_frame_bounded(input, MAX_WORKER_START_BYTES)?;
    start.program.validate()?;
    Ok(start)
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum TerminalControl {
    Resize { columns: u16, rows: u16 },
    Close,
}

pub fn resize_terminal(
    output: &mut impl Write,
    status: &mut impl Read,
    size: WorkerTerminalSize,
) -> IsolationResult<()> {
    size.validate()?;
    crate::protocol::write_frame(
        output,
        &TerminalControl::Resize {
            columns: size.columns,
            rows: size.rows,
        },
    )?;
    match crate::protocol::read_frame(status)? {
        WorkerStatus::Resized { columns, rows } if columns == size.columns && rows == size.rows => {
            Ok(())
        }
        WorkerStatus::Failed { message } => {
            Err(IsolationError::new("worker_terminal_resize", message))
        }
        _ => Err(IsolationError::new(
            "worker_terminal_resize",
            "unexpected resize response",
        )),
    }
}

pub fn close_terminal(output: &mut impl Write) -> IsolationResult<()> {
    crate::protocol::write_frame(output, &TerminalControl::Close)
}
