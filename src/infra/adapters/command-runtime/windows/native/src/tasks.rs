use std::sync::Arc;

use napi::{Env, Task};

use crate::owned_process::WindowsOwnedProcessState;
use crate::owned_process::pty::WindowsOwnedPtyProcessState;

pub struct TerminateTreeTask {
    pub(crate) state: Arc<WindowsOwnedProcessState>,
}

pub struct ReleaseProcessResourcesTask {
    pub(crate) state: Arc<WindowsOwnedProcessState>,
}

pub struct WritePtyInputTask {
    pub(crate) state: Arc<WindowsOwnedPtyProcessState>,
    pub(crate) data: Vec<u8>,
}

pub struct TerminatePtyTreeTask {
    pub(crate) state: Arc<WindowsOwnedPtyProcessState>,
}

pub struct ReleasePtyResourcesTask {
    pub(crate) state: Arc<WindowsOwnedPtyProcessState>,
}

impl Task for TerminateTreeTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        self.state
            .terminate_and_wait_tree_empty()
            .map_err(Into::into)
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

impl Task for ReleaseProcessResourcesTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        // release 会 join observer；必须在 worker 执行，避免 JS 主线程与等待 JS callback
        // 返回的 native observer 互相等待。
        self.state.release().map_err(Into::into)
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

impl Task for WritePtyInputTask {
    type Output = u32;
    type JsValue = u32;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        // 同步 WriteFile 只能在 Node worker 执行。writer thread 句柄已在进入 WriteFile
        // 前发布，cancel 可以用 CancelSynchronousIo 精准解除阻塞，不占 JS 主线程。
        self.state
            .write_input(std::mem::take(&mut self.data))
            .map_err(Into::into)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

impl Task for TerminatePtyTreeTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        self.state
            .terminate_and_wait_tree_empty()
            .map_err(Into::into)
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}

impl Task for ReleasePtyResourcesTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<Self::Output> {
        // ClosePseudoConsole 与 observer/input join 都在 worker；output observer 在另一条
        // Rust 线程持续 drain，避免 Win10/旧 Win11 的同步关闭互等。
        self.state.release().map_err(Into::into)
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(())
    }
}
