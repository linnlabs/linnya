#![deny(clippy::undocumented_unsafe_blocks)]

#[cfg(windows)]
mod accounts;
#[cfg(windows)]
mod ambient_read;
#[cfg(windows)]
mod artifact_ownership;
#[cfg(windows)]
mod client;
#[cfg(windows)]
mod command_job;
#[cfg(windows)]
mod coordinator;
#[cfg(windows)]
mod elevation;
mod error;
#[cfg(windows)]
mod filesystem;
#[cfg(windows)]
mod filesystem_lock;
#[cfg(windows)]
mod identity;
#[cfg(windows)]
mod installation;
#[cfg(windows)]
mod journal;
#[cfg(windows)]
mod lease_job;
#[cfg(windows)]
mod peer;
mod protocol;
#[cfg(windows)]
mod service;
#[cfg(windows)]
mod startup_attributes;
#[cfg(windows)]
mod transport;
#[cfg(windows)]
mod worker;
#[cfg(windows)]
mod worker_launch;
#[cfg(windows)]
mod worker_process;
#[cfg(windows)]
mod worker_protocol;
#[cfg(windows)]
mod worker_pty;

#[cfg(windows)]
pub use ambient_read::configure_current_user;
#[cfg(windows)]
pub use client::AccountLease;
#[cfg(windows)]
pub use elevation::{disable_current_user, enable_current_user};
#[cfg(windows)]
pub use filesystem::{FilesystemLease, FilesystemPolicy, cleanup_current_user_filesystem};
#[cfg(windows)]
pub use installation::{install, installation_status, uninstall};
#[cfg(windows)]
pub use service::dispatch;
#[cfg(windows)]
pub use worker::{report_worker_error, run_worker};
#[cfg(windows)]
pub use worker_launch::{
    PreparedWorker, SuspendedWorker, WorkerDesktop, create_suspended_worker, prepare_worker,
};
#[cfg(windows)]
pub use worker_protocol::{
    WorkerHandles, WorkerProgram, WorkerTerminalSize, close_terminal, resize_terminal,
    write_program,
};

pub use error::{IsolationError, IsolationResult};
