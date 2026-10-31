use std::collections::HashMap;
use std::fs::File;
use std::os::windows::io::AsRawHandle;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

const PROFILE_UNLOAD_DEADLINE: Duration = Duration::from_secs(30);
use windows::Win32::Foundation::HANDLE;

use crate::{
    IsolationError, IsolationResult, accounts,
    identity::OwnerIdentity,
    journal::{AccountJournal, AccountRecord},
    lease_job::{JobPurpose, LeaseJob, job_name},
    peer::CommandPeer,
    protocol::{AccountReply, AccountRequest, read_frame, write_frame},
    transport::AccountListener,
};

pub(crate) enum CoordinatorMessage {
    Acquire {
        peer: CommandPeer,
        reply: Sender<IsolationResult<AccountReply>>,
    },
    Release {
        lease_id: String,
        reply: Sender<IsolationResult<()>>,
    },
    Stop,
}

struct ActiveLease {
    peer: CommandPeer,
    command_job: LeaseJob,
    worker_job: LeaseJob,
    record: AccountRecord,
    releasing: bool,
    release_reply: Option<(Instant, Sender<IsolationResult<()>>)>,
}

struct Coordinator {
    owner: OwnerIdentity,
    journal: AccountJournal,
    active: HashMap<String, ActiveLease>,
}

impl Coordinator {
    fn acquire(&mut self, peer: CommandPeer) -> IsolationResult<AccountReply> {
        if peer.owner_has_exited() {
            return Err(IsolationError::new(
                "account_owner_exit",
                "command owner has exited",
            ));
        }
        let account = accounts::prepare_account(peer.pid, peer.created_at)?;
        let mut record = account.record.clone();
        self.journal.add(record.clone())?;
        let jobs = (|| {
            let command = LeaseJob::create(&self.owner, &record.lease_id, JobPurpose::Command)?;
            let worker = LeaseJob::create(&self.owner, &record.lease_id, JobPurpose::Worker)?;
            Ok((command, worker))
        })();
        let (command_job, worker_job) = match jobs {
            Ok(job) => job,
            Err(error) => {
                self.journal.remove(&record.lease_id)?;
                return Err(error);
            }
        };
        let created = match accounts::create_account(&self.owner, account) {
            Ok(created) => created,
            Err(error) => {
                // NetUserAdd 失败时没有取得账户所有权，不能按撞名记录清理别人的账户。
                self.journal.remove(&record.lease_id)?;
                return Err(error);
            }
        };
        // 从 NetUserAdd 成功开始，后续失败保留日志，协调循环将核验 comment/SID 后清理。
        let credentials = accounts::configure_account(&self.owner, created)?;
        self.journal
            .record_sid(&record.lease_id, credentials.sid.clone())?;
        record.account_sid = Some(credentials.sid.clone());
        let group_sid = srt_win::sid::lookup_account_sid(&self.owner.group_name())
            .map_err(|error| IsolationError::new("account_group_sid", error.to_string()))?;
        let reply = AccountReply::Acquired {
            protocol_version: 1,
            lease_id: record.lease_id.clone(),
            job_name: job_name(&self.owner, &record.lease_id, JobPurpose::Command),
            worker_job_name: job_name(&self.owner, &record.lease_id, JobPurpose::Worker),
            account_name: credentials.name,
            account_sid: credentials.sid,
            group_sid,
            password: credentials.password,
        };
        self.active.insert(
            record.lease_id.clone(),
            ActiveLease {
                peer,
                command_job,
                worker_job,
                record,
                releasing: false,
                release_reply: None,
            },
        );
        Ok(reply)
    }

    fn request_release(&mut self, lease_id: &str, reply: Option<Sender<IsolationResult<()>>>) {
        if let Some(lease) = self.active.get_mut(lease_id) {
            lease.releasing = true;
            if let Some(reply) = reply {
                lease.release_reply = Some((Instant::now(), reply));
            }
        } else if let Some(reply) = reply {
            let _ = reply.send(Ok(()));
        }
    }

    fn advance_release(&mut self, lease_id: &str) -> IsolationResult<()> {
        let Some(lease) = self.active.get(lease_id) else {
            return Ok(());
        };
        lease.worker_job.terminate_and_observe()?;
        lease.command_job.terminate_and_observe()?;
        match accounts::remove_account(&self.owner, &lease.record)? {
            accounts::AccountCleanupProgress::ProfileUnloading => {
                if let Some(lease) = self.active.get_mut(lease_id)
                    && lease
                        .release_reply
                        .as_ref()
                        .is_some_and(|(started, _)| started.elapsed() >= PROFILE_UNLOAD_DEADLINE)
                    && let Some((_, reply)) = lease.release_reply.take()
                {
                    let _ = reply.send(Err(IsolationError::new(
                        "account_profile_unload",
                        "Windows has not finished unloading the profile; recovery record retained",
                    )));
                }
                // 留在协调循环，继续接收其他账户请求，不能为 profile 卸载全局阻塞命令。
                return Ok(());
            }
            accounts::AccountCleanupProgress::Removed => {}
        }
        self.journal.remove(lease_id)?;
        if let Some(lease) = self.active.remove(lease_id)
            && let Some((_, reply)) = lease.release_reply
        {
            let _ = reply.send(Ok(()));
        }
        Ok(())
    }

    fn recover_inactive(&mut self) -> IsolationResult<()> {
        let records = self.journal.records().to_vec();
        for record in records {
            if self.active.contains_key(&record.lease_id) {
                continue;
            }
            // 服务重启不能继续使用旧口令。先结束旧 Job 整树，再删除账户；Host 会收到管道断开。
            for purpose in [JobPurpose::Worker, JobPurpose::Command] {
                if let Some(job) = LeaseJob::open_existing(&self.owner, &record.lease_id, purpose)?
                {
                    job.terminate_and_observe()?;
                }
            }
            if matches!(
                accounts::remove_account(&self.owner, &record)?,
                accounts::AccountCleanupProgress::Removed
            ) {
                self.journal.remove(&record.lease_id)?;
            }
        }
        Ok(())
    }

    fn reap(&mut self) -> IsolationResult<()> {
        let ended: Vec<String> = self
            .active
            .iter()
            .filter(|(_, lease)| lease.releasing || lease.peer.owner_has_exited())
            .map(|(id, _)| id.clone())
            .collect();
        let mut failures = Vec::new();
        for lease_id in ended {
            if let Err(error) = self.advance_release(&lease_id) {
                if let Some(lease) = self.active.get_mut(&lease_id)
                    && let Some((_, reply)) = lease.release_reply.take()
                {
                    let _ = reply.send(Err(error.clone()));
                }
                // 一个 profile 的真实删除错误不能阻止其他已结束命令释放自己的身份。
                failures.push(error.to_string());
            }
        }
        if let Err(error) = self.recover_inactive() {
            failures.push(error.to_string());
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(IsolationError::new("account_reap", failures.join("; ")))
        }
    }
}

fn finish_cleanup(coordinator: &mut Coordinator) -> IsolationResult<()> {
    for lease in coordinator.active.values_mut() {
        lease.releasing = true;
    }
    let deadline = Instant::now() + PROFILE_UNLOAD_DEADLINE;
    while !coordinator.journal.records().is_empty() {
        coordinator.reap()?;
        if !coordinator.journal.records().is_empty() {
            if Instant::now() >= deadline {
                return Err(IsolationError::new(
                    "account_cleanup_pending",
                    "profile cleanup pending; recovery records retained",
                ));
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    Ok(())
}

pub(crate) fn recover(owner: &OwnerIdentity) -> IsolationResult<()> {
    finish_cleanup(&mut Coordinator {
        journal: AccountJournal::open(owner)?,
        owner: owner.clone(),
        active: HashMap::new(),
    })
}

pub(crate) fn run(
    owner: OwnerIdentity,
    sender: Sender<CoordinatorMessage>,
    receiver: Receiver<CoordinatorMessage>,
    ready: impl FnOnce() -> IsolationResult<()>,
    stopping: impl FnOnce() -> IsolationResult<()>,
) -> IsolationResult<()> {
    let mut coordinator = Coordinator {
        journal: AccountJournal::open(&owner)?,
        owner: owner.clone(),
        active: HashMap::new(),
    };
    coordinator.recover_inactive()?;
    let mut listener = AccountListener::bind(owner.clone())?;
    std::thread::spawn(move || {
        loop {
            match listener.accept() {
                Ok(pipe) => {
                    let owner = owner.clone();
                    let sender = sender.clone();
                    std::thread::spawn(move || {
                        if let Err(error) = serve_connection(pipe, &owner, &sender) {
                            eprintln!("{error}");
                        }
                    });
                }
                Err(error) => {
                    eprintln!("{error}");
                    let _ = sender.send(CoordinatorMessage::Stop);
                    break;
                }
            }
        }
    });
    ready()?;
    let mut last_cleanup_error = None;
    loop {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(CoordinatorMessage::Acquire { peer, reply }) => {
                let acquired = coordinator.acquire(peer);
                // 请求线程已断开时不能留下一个仍在等待启动的账户。
                if let Err(mpsc::SendError(Ok(AccountReply::Acquired { lease_id, .. }))) =
                    reply.send(acquired)
                {
                    coordinator.request_release(&lease_id, None);
                }
            }
            Ok(CoordinatorMessage::Release { lease_id, reply }) => {
                coordinator.request_release(&lease_id, Some(reply));
            }
            Ok(CoordinatorMessage::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        let error = coordinator.reap().err().map(|error| error.to_string());
        if error != last_cleanup_error {
            if let Some(error) = &error {
                eprintln!("{error}");
            }
            last_cleanup_error = error;
        }
    }
    let status = stopping();
    let cleanup = finish_cleanup(&mut coordinator);
    status.and(cleanup)
}

fn serve_connection(
    mut pipe: File,
    owner: &OwnerIdentity,
    sender: &Sender<CoordinatorMessage>,
) -> IsolationResult<()> {
    let peer = CommandPeer::authenticate(HANDLE(pipe.as_raw_handle()), owner)?;
    match read_frame(&mut pipe)? {
        AccountRequest::Inspect {
            protocol_version: 1,
        } => {
            return write_frame(
                &mut pipe,
                &AccountReply::Ready {
                    protocol_version: 1,
                },
            );
        }
        AccountRequest::Acquire {
            protocol_version: 1,
        } => {}
        _ => {
            return Err(IsolationError::new(
                "account_protocol",
                "expected supported account acquire request",
            ));
        }
    }
    let (reply, response) = mpsc::channel();
    sender
        .send(CoordinatorMessage::Acquire { peer, reply })
        .map_err(|_| IsolationError::new("account_coordinator", "account service has stopped"))?;
    let acquired = response
        .recv()
        .map_err(|_| IsolationError::new("account_coordinator", "account service has stopped"))?;
    let acquired = match acquired {
        Ok(acquired) => acquired,
        Err(error) => return write_frame(&mut pipe, &failure_reply(&error)),
    };
    let AccountReply::Acquired { lease_id, .. } = &acquired else {
        return Err(IsolationError::new(
            "account_protocol",
            "invalid acquire response",
        ));
    };
    let lease_id = lease_id.clone();
    let sent = write_frame(&mut pipe, &acquired);
    drop(acquired); // 发出后立即清零服务这份口令，恢复日志没有口令副本。
    let released = sent.is_ok()
        && matches!(read_frame(&mut pipe),
        Ok(AccountRequest::Release { lease_id: requested }) if requested == lease_id);
    // 无论显式释放、EOF 还是错误帧，这条连接只可结束自己租到的账户。
    let (reply, response) = mpsc::channel();
    sender
        .send(CoordinatorMessage::Release {
            lease_id: lease_id.clone(),
            reply,
        })
        .map_err(|_| IsolationError::new("account_coordinator", "account service has stopped"))?;
    let cleanup = response
        .recv()
        .map_err(|_| IsolationError::new("account_coordinator", "account service has stopped"))?;
    if released {
        match cleanup {
            Ok(()) => write_frame(&mut pipe, &AccountReply::Released { lease_id })?,
            Err(error) => write_frame(&mut pipe, &failure_reply(&error))?,
        }
    }
    Ok(())
}

fn failure_reply(error: &IsolationError) -> AccountReply {
    AccountReply::Failed {
        stage: "account_service".into(),
        message: error.to_string(),
    }
}
