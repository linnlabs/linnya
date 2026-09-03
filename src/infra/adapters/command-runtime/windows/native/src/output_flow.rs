use std::sync::{Condvar, Mutex};

use crate::error::{NativeError, NativeResult};

#[derive(Debug, Default)]
struct OutputFlowState {
    delivery_pending: bool,
    resume_requested: bool,
    closed: bool,
}

#[derive(Debug, Default)]
pub(crate) struct OutputFlowGate {
    state: Mutex<OutputFlowState>,
    resumed: Condvar,
}

impl OutputFlowGate {
    pub(crate) fn begin_delivery(&self) -> NativeResult<bool> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| NativeError::contract("output_flow", "output flow lock was poisoned"))?;
        if state.closed {
            // ReadFile 与下游 destroy/cancel 可以真实交错；关闭后的已读 byte 应安静丢弃，
            // 这表示消费者主动结束，不是 native 合同损坏。
            return Ok(false);
        }
        if state.delivery_pending {
            return Err(NativeError::contract(
                "output_flow",
                "output flow already has an in-flight delivery",
            ));
        }
        state.delivery_pending = true;
        state.resume_requested = false;
        Ok(true)
    }

    pub(crate) fn finish_delivery(&self, accepted: bool) -> NativeResult<bool> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| NativeError::contract("output_flow", "output flow lock was poisoned"))?;
        if !state.delivery_pending {
            return Err(NativeError::contract(
                "output_flow",
                "output delivery finished without an in-flight event",
            ));
        }
        if accepted {
            state.delivery_pending = false;
            state.resume_requested = false;
            return Ok(!state.closed);
        }
        while !state.resume_requested && !state.closed {
            state = self.resumed.wait(state).map_err(|_| {
                NativeError::contract("output_flow", "output flow lock was poisoned")
            })?;
        }
        state.delivery_pending = false;
        state.resume_requested = false;
        Ok(!state.closed)
    }

    pub(crate) fn resume(&self) -> NativeResult<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| NativeError::contract("output_flow", "output flow lock was poisoned"))?;
        // _read 可能与 callback 返回或 EOF 交错；idle/closed 时只忽略本次请求，
        // 绝不保存“预充值”许可给下一块数据。
        if state.closed || !state.delivery_pending || state.resume_requested {
            return Ok(());
        }
        state.resume_requested = true;
        self.resumed.notify_one();
        Ok(())
    }

    pub(crate) fn cancel_delivery(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.delivery_pending = false;
            state.resume_requested = false;
            self.resumed.notify_all();
        }
    }

    pub(crate) fn close(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.closed = true;
            state.resume_requested = true;
            self.resumed.notify_all();
        }
    }
}
