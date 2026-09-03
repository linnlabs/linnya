#![deny(clippy::undocumented_unsafe_blocks)]

mod error;
#[cfg(target_os = "windows")]
mod fault_injection;
mod launch_spec;

#[cfg(target_os = "windows")]
mod handle;
#[cfg(target_os = "windows")]
mod output_flow;
#[cfg(target_os = "windows")]
mod owned_process;
#[cfg(target_os = "windows")]
mod process_creation;
#[cfg(target_os = "windows")]
mod pty_creation;
#[cfg(all(target_os = "windows", feature = "test-fault-injection"))]
mod pty_test_support;
#[cfg(target_os = "windows")]
mod tasks;
#[cfg(all(target_os = "windows", feature = "test-fault-injection"))]
mod test_support;

pub use launch_spec::{WindowsEnvironmentEntry, WindowsOwnedPipeLaunchInput};

#[cfg(target_os = "windows")]
use std::sync::Arc;

#[cfg(target_os = "windows")]
use fault_injection::NativeFaultInjection;
#[cfg(target_os = "windows")]
use napi::bindgen_prelude::{AsyncTask, Buffer, Function};
#[cfg(target_os = "windows")]
use napi_derive::napi;
#[cfg(target_os = "windows")]
use owned_process::WindowsOwnedProcessState;
#[cfg(target_os = "windows")]
use owned_process::pty::WindowsOwnedPtyProcessState;
#[cfg(all(target_os = "windows", feature = "test-fault-injection"))]
pub use pty_test_support::{
    WindowsOwnedPtyNativeProcessForTest, create_windows_owned_pty_process_for_test,
    create_windows_owned_pty_process_with_fault_for_test,
};
#[cfg(target_os = "windows")]
use tasks::{
    ReleaseProcessResourcesTask, ReleasePtyResourcesTask, TerminatePtyTreeTask, TerminateTreeTask,
    WritePtyInputTask,
};
#[cfg(all(target_os = "windows", feature = "test-fault-injection"))]
pub use test_support::{
    WindowsHandleInheritanceSentinelForTest, WindowsOuterJobMembershipForTest,
    WindowsProcessIdentityForTest, attempt_breakaway_process_for_test,
    create_inheritable_handle_sentinel_for_test, join_current_process_to_outer_job_for_test,
    signal_handle_for_test,
};

#[cfg(target_os = "windows")]
type WindowsObserverEvent = (String, Option<Buffer>, Option<u32>, Option<String>);
#[cfg(target_os = "windows")]
type WindowsObserverFunction<'env> = Function<'env, WindowsObserverEvent, bool>;

#[cfg(target_os = "windows")]
#[napi]
pub struct WindowsOwnedPipeNativeProcess {
    state: Arc<WindowsOwnedProcessState>,
}

#[cfg(target_os = "windows")]
#[napi]
pub struct WindowsOwnedPtyNativeProcess {
    state: Arc<WindowsOwnedPtyProcessState>,
}

#[cfg(target_os = "windows")]
#[napi]
impl WindowsOwnedPipeNativeProcess {
    #[napi]
    pub fn start_observers(&self, callback: WindowsObserverFunction<'_>) -> napi::Result<()> {
        self.state
            .start_observers_from_js(callback)
            .map_err(Into::into)
    }

    #[napi]
    pub fn resume_after_observers_ready(&self) -> napi::Result<()> {
        self.state.resume().map_err(Into::into)
    }

    #[napi]
    pub fn terminate_and_wait_tree_empty(&self) -> AsyncTask<TerminateTreeTask> {
        AsyncTask::new(TerminateTreeTask {
            state: Arc::clone(&self.state),
        })
    }

    #[napi]
    pub fn resume_output(&self, channel: String) -> napi::Result<()> {
        self.state.resume_output(&channel).map_err(Into::into)
    }

    #[napi]
    pub fn cancel_output(&self, channel: String) -> napi::Result<()> {
        self.state.cancel_output(&channel).map_err(Into::into)
    }

    #[napi]
    pub fn release(&self) -> AsyncTask<ReleaseProcessResourcesTask> {
        AsyncTask::new(ReleaseProcessResourcesTask {
            state: Arc::clone(&self.state),
        })
    }
}

#[cfg(target_os = "windows")]
#[napi]
impl WindowsOwnedPtyNativeProcess {
    #[napi]
    pub fn start_observers(&self, callback: WindowsObserverFunction<'_>) -> napi::Result<()> {
        self.state
            .start_observers_from_js(callback)
            .map_err(Into::into)
    }

    #[napi]
    pub fn resume_after_observers_ready(&self) -> napi::Result<()> {
        self.state.resume().map_err(Into::into)
    }

    #[napi]
    pub fn write_input(&self, data: Buffer) -> AsyncTask<WritePtyInputTask> {
        AsyncTask::new(WritePtyInputTask {
            state: Arc::clone(&self.state),
            data: data.to_vec(),
        })
    }

    #[napi]
    pub fn resize(&self, columns: u16, rows: u16) -> napi::Result<()> {
        self.state.resize(columns, rows).map_err(Into::into)
    }

    #[napi]
    pub fn resume_output(&self) -> napi::Result<()> {
        self.state.resume_output().map_err(Into::into)
    }

    #[napi]
    pub fn cancel_output(&self) {
        self.state.cancel_output();
    }

    #[napi]
    pub fn terminate_and_wait_tree_empty(&self) -> AsyncTask<TerminatePtyTreeTask> {
        AsyncTask::new(TerminatePtyTreeTask {
            state: Arc::clone(&self.state),
        })
    }

    #[napi]
    pub fn release(&self) -> AsyncTask<ReleasePtyResourcesTask> {
        AsyncTask::new(ReleasePtyResourcesTask {
            state: Arc::clone(&self.state),
        })
    }
}

#[cfg(all(target_os = "windows", feature = "test-fault-injection"))]
#[napi]
impl WindowsOwnedPipeNativeProcess {
    #[napi]
    pub fn root_process_identity_for_test(&self) -> napi::Result<WindowsProcessIdentityForTest> {
        self.state
            .root_process_identity_for_test()
            .map_err(Into::into)
    }
}

#[cfg(target_os = "windows")]
#[napi]
pub fn create_windows_owned_pipe_process(
    input: WindowsOwnedPipeLaunchInput,
) -> napi::Result<WindowsOwnedPipeNativeProcess> {
    let spec = input.into_native().map_err(napi::Error::from)?;
    let state = WindowsOwnedProcessState::create(spec, NativeFaultInjection::disabled())
        .map_err(napi::Error::from)?;
    Ok(WindowsOwnedPipeNativeProcess {
        state: Arc::new(state),
    })
}

#[cfg(target_os = "windows")]
#[napi]
pub fn create_windows_owned_pty_process(
    input: WindowsOwnedPipeLaunchInput,
    columns: u16,
    rows: u16,
) -> napi::Result<WindowsOwnedPtyNativeProcess> {
    let spec = input.into_native().map_err(napi::Error::from)?;
    let state =
        WindowsOwnedPtyProcessState::create(spec, columns, rows, NativeFaultInjection::disabled())
            .map_err(napi::Error::from)?;
    Ok(WindowsOwnedPtyNativeProcess {
        state: Arc::new(state),
    })
}

#[cfg(all(target_os = "windows", feature = "test-fault-injection"))]
#[napi]
pub fn create_windows_owned_pipe_process_for_test(
    input: WindowsOwnedPipeLaunchInput,
    fault_stage: String,
) -> napi::Result<WindowsOwnedPipeNativeProcess> {
    let spec = input.into_native().map_err(napi::Error::from)?;
    let fault_injection =
        NativeFaultInjection::for_pipe_test(fault_stage).map_err(napi::Error::from)?;
    let state =
        WindowsOwnedProcessState::create(spec, fault_injection).map_err(napi::Error::from)?;
    Ok(WindowsOwnedPipeNativeProcess {
        state: Arc::new(state),
    })
}
