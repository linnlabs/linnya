use std::sync::Arc;

use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi_derive::napi;

use crate::owned_process::pty::WindowsOwnedPtyProcessState;

use crate::WindowsObserverFunction;
use crate::fault_injection::NativeFaultInjection;
use crate::launch_spec::WindowsOwnedPipeLaunchInput;
use crate::tasks::{ReleasePtyResourcesTask, TerminatePtyTreeTask, WritePtyInputTask};
use crate::test_support::WindowsProcessIdentityForTest;

#[napi]
pub struct WindowsOwnedPtyNativeProcessForTest {
    state: Arc<WindowsOwnedPtyProcessState>,
}

#[napi]
impl WindowsOwnedPtyNativeProcessForTest {
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
    pub fn input_write_in_progress_for_test(&self) -> bool {
        self.state.input_write_in_progress_for_test()
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

    #[napi]
    pub fn root_process_identity_for_test(&self) -> napi::Result<WindowsProcessIdentityForTest> {
        self.state
            .root_process_identity_for_test()
            .map_err(Into::into)
    }

    #[napi]
    pub fn active_process_count_for_test(&self) -> napi::Result<u32> {
        self.state
            .active_process_count_for_test()
            .map_err(Into::into)
    }
}

fn create_process(
    input: WindowsOwnedPipeLaunchInput,
    columns: u16,
    rows: u16,
    fault_injection: NativeFaultInjection,
) -> napi::Result<WindowsOwnedPtyNativeProcessForTest> {
    let spec = input.into_native().map_err(napi::Error::from)?;
    let state = WindowsOwnedPtyProcessState::create(spec, columns, rows, fault_injection)
        .map_err(napi::Error::from)?;
    Ok(WindowsOwnedPtyNativeProcessForTest {
        state: Arc::new(state),
    })
}

#[napi]
pub fn create_windows_owned_pty_process_for_test(
    input: WindowsOwnedPipeLaunchInput,
    columns: u16,
    rows: u16,
) -> napi::Result<WindowsOwnedPtyNativeProcessForTest> {
    create_process(input, columns, rows, NativeFaultInjection::disabled())
}

#[napi]
pub fn create_windows_owned_pty_process_with_fault_for_test(
    input: WindowsOwnedPipeLaunchInput,
    columns: u16,
    rows: u16,
    fault_stage: String,
) -> napi::Result<WindowsOwnedPtyNativeProcessForTest> {
    let fault_injection =
        NativeFaultInjection::for_pty_test(fault_stage).map_err(napi::Error::from)?;
    create_process(input, columns, rows, fault_injection)
}
