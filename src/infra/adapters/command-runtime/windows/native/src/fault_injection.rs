use crate::error::{NativeError, NativeResult};

#[cfg(feature = "test-fault-injection")]
const PIPE_TEST_FAULT_STAGES: [&str; 7] = [
    "job_after_create",
    "pipe_after_create",
    "attribute_after_initialize",
    "process_after_create",
    "observer_callback_build",
    "observer_ready",
    "resume",
];

#[cfg(feature = "test-fault-injection")]
const PTY_TEST_FAULT_STAGES: [&str; 11] = [
    "job_after_create",
    "pipe_after_create",
    "pseudoconsole_after_create",
    "attribute_after_initialize",
    "process_after_create",
    "input_writer_ready",
    "observer_callback_build",
    "output_observer_spawn",
    "root_observer_spawn",
    "observer_ready",
    "resume",
];

#[derive(Default)]
pub(crate) struct NativeFaultInjection {
    stage: Option<String>,
}

impl NativeFaultInjection {
    pub(crate) fn disabled() -> Self {
        Self::default()
    }

    #[cfg(feature = "test-fault-injection")]
    fn for_test(stage: String, allowed_stages: &[&str]) -> NativeResult<Self> {
        if !allowed_stages.contains(&stage.as_str()) {
            return Err(NativeError::contract(
                "fault_injection",
                format!("unknown test fault stage: {stage}"),
            ));
        }
        Ok(Self { stage: Some(stage) })
    }

    #[cfg(feature = "test-fault-injection")]
    pub(crate) fn for_pipe_test(stage: String) -> NativeResult<Self> {
        Self::for_test(stage, &PIPE_TEST_FAULT_STAGES)
    }

    #[cfg(feature = "test-fault-injection")]
    pub(crate) fn for_pty_test(stage: String) -> NativeResult<Self> {
        Self::for_test(stage, &PTY_TEST_FAULT_STAGES)
    }

    pub(crate) fn check(&self, stage: &'static str) -> NativeResult<()> {
        if self.stage.as_deref() == Some(stage) {
            Err(NativeError::contract(
                "fault_injection",
                format!("injected stage={stage}"),
            ))
        } else {
            Ok(())
        }
    }
}
