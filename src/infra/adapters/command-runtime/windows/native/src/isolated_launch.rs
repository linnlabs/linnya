use std::path::{Path, PathBuf};
use std::sync::Arc;

use linnya_windows_command_isolation::{
    AccountLease, FilesystemLease, FilesystemPolicy, PreparedWorker, WorkerProgram,
    WorkerTerminalSize, create_suspended_worker, prepare_worker,
};
use napi::{Env, Task, bindgen_prelude::AsyncTask};
use napi_derive::napi;

use crate::error::NativeResult;
use crate::fault_injection::NativeFaultInjection;
use crate::launch_spec::{NativeLaunchSpec, WindowsOwnedPipeLaunchInput};
use crate::owned_process::{WindowsOwnedProcessState, pty::WindowsOwnedPtyProcessState};
use crate::{WindowsOwnedPipeNativeProcess, WindowsOwnedPtyNativeProcess, isolated_process};

#[napi(object)]
pub struct WindowsCommandIsolationInput {
    pub helper_path: String,
    pub protected_roots: Vec<String>,
    pub readable_roots: Vec<String>,
    pub write_roots: Vec<String>,
}

impl WindowsCommandIsolationInput {
    fn prepare(
        self,
        spec: NativeLaunchSpec,
        terminal: Option<WorkerTerminalSize>,
    ) -> NativeResult<(PreparedWorker, FilesystemLease)> {
        let account = AccountLease::acquire()?;
        let filesystem = FilesystemLease::acquire(
            &account,
            FilesystemPolicy {
                protected_roots: self
                    .protected_roots
                    .into_iter()
                    .map(PathBuf::from)
                    .collect(),
                readable_roots: self.readable_roots.into_iter().map(PathBuf::from).collect(),
                write_roots: self.write_roots.into_iter().map(PathBuf::from).collect(),
            },
        )?;
        let program = WorkerProgram {
            executable_path: spec.executable_path,
            command_line: spec.command_line,
            cwd: spec.cwd,
            environment: spec.environment.into(),
            terminal,
        };
        let worker = create_suspended_worker(Path::new(&self.helper_path), &program, account)?;
        let worker = prepare_worker(worker, &program)?;
        Ok((worker, filesystem))
    }
}

pub struct CreateIsolatedPipeTask {
    input: Option<(NativeLaunchSpec, WindowsCommandIsolationInput)>,
}

impl Task for CreateIsolatedPipeTask {
    type Output = WindowsOwnedPipeNativeProcess;
    type JsValue = WindowsOwnedPipeNativeProcess;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let (spec, isolation) = self
            .input
            .take()
            .ok_or_else(|| napi::Error::from_reason("creation task already consumed"))?;
        let (worker, filesystem) = isolation.prepare(spec, None)?;
        let resources = isolated_process::pipe_resources(worker, filesystem)?;
        WindowsOwnedProcessState::from_resources(resources, NativeFaultInjection::disabled())
            .map(|state| WindowsOwnedPipeNativeProcess {
                state: Arc::new(state),
            })
            .map_err(Into::into)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct CreateIsolatedPtyTask {
    input: Option<(NativeLaunchSpec, WindowsCommandIsolationInput)>,
    terminal: WorkerTerminalSize,
}

impl Task for CreateIsolatedPtyTask {
    type Output = WindowsOwnedPtyNativeProcess;
    type JsValue = WindowsOwnedPtyNativeProcess;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let (spec, isolation) = self
            .input
            .take()
            .ok_or_else(|| napi::Error::from_reason("creation task already consumed"))?;
        let (worker, filesystem) = isolation.prepare(spec, Some(self.terminal))?;
        let resources = isolated_process::pty_resources(worker, filesystem)?;
        WindowsOwnedPtyProcessState::from_resources(resources, NativeFaultInjection::disabled())
            .map(|state| WindowsOwnedPtyNativeProcess {
                state: Arc::new(state),
            })
            .map_err(Into::into)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn create_windows_isolated_pipe_process(
    input: WindowsOwnedPipeLaunchInput,
    isolation: WindowsCommandIsolationInput,
) -> napi::Result<AsyncTask<CreateIsolatedPipeTask>> {
    let spec = input.into_native()?;
    // Secondary Logon、ACL 和 profile 初始化在 native worker 上完成，不阻塞 JS 事件循环。
    Ok(AsyncTask::new(CreateIsolatedPipeTask {
        input: Some((spec, isolation)),
    }))
}

#[napi]
pub fn create_windows_isolated_pty_process(
    input: WindowsOwnedPipeLaunchInput,
    isolation: WindowsCommandIsolationInput,
    columns: u16,
    rows: u16,
) -> napi::Result<AsyncTask<CreateIsolatedPtyTask>> {
    crate::pty_creation::validate_pty_size(columns, rows)?;
    let spec = input.into_native()?;
    Ok(AsyncTask::new(CreateIsolatedPtyTask {
        input: Some((spec, isolation)),
        terminal: WorkerTerminalSize { columns, rows },
    }))
}
