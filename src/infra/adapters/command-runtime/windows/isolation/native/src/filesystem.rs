use crate::{
    AccountLease, IsolationError, IsolationResult, accounts, filesystem_lock::FilesystemLock,
};
use serde::{Deserialize, Serialize};
use srt_win::acl::{DenyMask, GrantMask, SbAceSet, apply_sandbox_aces_over};
use srt_win::reg::Key;
use std::path::{Path, PathBuf};

const REGISTRY_PATH: &str = r"SOFTWARE\Linnlabs\CommandIsolation\Filesystem";
const JOURNAL_VALUE: &str = "LeasesV1";

/// Host 冻结的访问集合。保护根中的旧显式 ACE 不能靠父目录继承覆盖，故逐项处理；
/// 当前对话和已批准根由 readable_roots 开口，write_roots 只决定写入能力。
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FilesystemPolicy {
    pub protected_roots: Vec<PathBuf>,
    pub readable_roots: Vec<PathBuf>,
    pub write_roots: Vec<PathBuf>,
}

impl FilesystemPolicy {
    fn canonicalize(self) -> IsolationResult<Self> {
        fn paths(values: Vec<PathBuf>) -> IsolationResult<Vec<PathBuf>> {
            values
                .into_iter()
                .map(|path| {
                    if !path.is_absolute() {
                        return Err(IsolationError::new(
                            "filesystem_policy",
                            "absolute paths are required",
                        ));
                    }
                    std::fs::canonicalize(path).map_err(|error| {
                        IsolationError::new("filesystem_policy", error.to_string())
                    })
                })
                .collect()
        }
        let value = Self {
            protected_roots: paths(self.protected_roots)?,
            readable_roots: paths(self.readable_roots)?,
            write_roots: paths(self.write_roots)?,
        };
        if value.protected_roots.is_empty() {
            return Err(IsolationError::new(
                "filesystem_policy",
                "protected roots are required",
            ));
        }
        Ok(value)
    }

    fn permits(roots: &[PathBuf], path: &Path) -> bool {
        roots.iter().any(|root| path.starts_with(root))
    }

    fn apply(&self, sid: &str) -> IsolationResult<()> {
        for path in &self.readable_roots {
            change(
                path,
                sid,
                SbAceSet {
                    grant: Some(GrantMask::ReadOnly),
                    ..Default::default()
                },
            )?;
        }
        for path in &self.write_roots {
            change(
                path,
                sid,
                SbAceSet {
                    grant: Some(GrantMask::Modify),
                    ..Default::default()
                },
            )?;
        }
        for root in &self.protected_roots {
            visit(
                root,
                &|path| {
                    Self::permits(&self.readable_roots, path)
                        || Self::permits(&self.write_roots, path)
                },
                &mut |path| {
                    let set = if Self::permits(&self.write_roots, path) {
                        SbAceSet {
                            grant: Some(GrantMask::Modify),
                            ..Default::default()
                        }
                    } else if Self::permits(&self.readable_roots, path) {
                        SbAceSet {
                            grant: Some(GrantMask::ReadOnly),
                            ..Default::default()
                        }
                    } else {
                        SbAceSet {
                            deny: Some(DenyMask::ReadDeny),
                            ..Default::default()
                        }
                    };
                    change(path, sid, set)
                },
            )?;
        }
        Ok(())
    }

    fn revoke(&self, sid: &str) -> IsolationResult<()> {
        let owner = srt_win::sid::current_user_sid()
            .map_err(|error| IsolationError::new("artifact_owner_identity", error.to_string()))?;
        for root in &self.write_roots {
            if exists(root)? {
                visit(root, &|_| true, &mut |path| {
                    crate::artifact_ownership::reclaim(path, sid, &owner)
                })?;
            }
        }
        // 逐项移除本账户规则；不恢复旧 DACL 快照，以免抹掉并行执行的 SID。
        for root in &self.protected_roots {
            if exists(root)? {
                visit(root, &|_| true, &mut |path| {
                    change(path, sid, SbAceSet::default())
                })?;
            }
        }
        for path in self.readable_roots.iter().chain(&self.write_roots) {
            if exists(path)? {
                change(path, sid, SbAceSet::default())?;
            }
        }
        Ok(())
    }
}

fn exists(path: &Path) -> IsolationResult<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(IsolationError::new("filesystem_observe", error.to_string())),
    }
}

fn change(path: &Path, sid: &str, set: SbAceSet) -> IsolationResult<()> {
    let text = path
        .to_str()
        .ok_or_else(|| IsolationError::new("filesystem_path", "invalid UTF-16 path"))?;
    apply_sandbox_aces_over(text, sid, set, None)
        .map_err(|error| IsolationError::new("filesystem_acl", error.to_string()))
}

fn visit(
    root: &Path,
    allow_link: &impl Fn(&Path) -> bool,
    apply: &mut impl FnMut(&Path) -> IsolationResult<()>,
) -> IsolationResult<()> {
    let metadata = std::fs::symlink_metadata(root)
        .map_err(|error| IsolationError::new("filesystem_tree", error.to_string()))?;
    // 对话中的 npm 链接/junction 不属于待修改的实际存储树，不能沿它给外部路径授权。
    // 链接指向受保护文件时，目标自身的账户 deny 继续生效。原始存储里的未声明别名
    // 则拒绝准备；Host 须先把它解析为明确保护根，不能漏掉实际存储位置。
    if metadata.file_type().is_symlink() {
        if allow_link(root) {
            return Ok(());
        }
        return Err(IsolationError::new(
            "filesystem_tree",
            "nested storage reparse point is not supported",
        ));
    }
    apply(root)?;
    if metadata.is_dir() {
        let children = std::fs::read_dir(root)
            .map_err(|error| IsolationError::new("filesystem_tree", error.to_string()))?;
        for entry in children {
            let entry =
                entry.map_err(|error| IsolationError::new("filesystem_tree", error.to_string()))?;
            visit(&entry.path(), allow_link, apply)?;
        }
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    account_name: String,
    account_sid: String,
    policy: FilesystemPolicy,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u8,
    records: Vec<Record>,
}

struct Journal {
    key: Key,
    document: Document,
}

impl Journal {
    fn open() -> IsolationResult<Self> {
        let key = Key::create_hkcu(REGISTRY_PATH)
            .map_err(|error| IsolationError::new("filesystem_journal_open", error.to_string()))?;
        let bytes = key
            .get_binary(JOURNAL_VALUE)
            .map_err(|error| IsolationError::new("filesystem_journal_read", error.to_string()))?;
        let document = match bytes {
            Some(bytes) => {
                if bytes.len() > 1024 * 1024 {
                    return Err(IsolationError::new(
                        "filesystem_journal_decode",
                        "journal is too large",
                    ));
                }
                let document: Document = serde_json::from_slice(&bytes).map_err(|_| {
                    IsolationError::new("filesystem_journal_decode", "journal is damaged")
                })?;
                if document.version != 1 {
                    return Err(IsolationError::new(
                        "filesystem_journal_decode",
                        "unsupported journal",
                    ));
                }
                document
            }
            None => Document {
                version: 1,
                records: Vec::new(),
            },
        };
        Ok(Self { key, document })
    }

    fn commit(&mut self, records: Vec<Record>) -> IsolationResult<()> {
        let next = Document {
            version: 1,
            records,
        };
        let bytes = serde_json::to_vec(&next)
            .map_err(|error| IsolationError::new("filesystem_journal_encode", error.to_string()))?;
        self.key
            .set_binary(JOURNAL_VALUE, &bytes)
            .map_err(|error| IsolationError::new("filesystem_journal_write", error.to_string()))?;
        self.document = next;
        Ok(())
    }

    fn remove(&mut self, sid: &str) -> IsolationResult<()> {
        self.commit(
            self.document
                .records
                .iter()
                .filter(|record| record.account_sid != sid)
                .cloned()
                .collect(),
        )
    }

    fn recover(&mut self) -> IsolationResult<()> {
        for record in self.document.records.clone() {
            let current = accounts::observe_account(&record.account_name)?;
            if current.is_some_and(|(sid, _)| sid == record.account_sid) {
                // 服务仍拥有的身份可能正在并行执行；只能清理已删除身份的残余 ACE。
                continue;
            }
            record.policy.revoke(&record.account_sid)?;
            self.remove(&record.account_sid)?;
        }
        Ok(())
    }
}

/// Drop 不擅自撤销仍可能被命令使用的权限。正常 owner 在整树/worker 结束后显式 release；
/// 崩溃由账户服务先删除执行身份，下一次准备再清除日志中该 SID 的残余 ACE。
pub struct FilesystemLease {
    record: Record,
}

/// 提升后的卸载只回收系统账户；用户路径与 HKCU 日志必须由原用户恢复，不能让
/// SYSTEM 根据用户可写的日志修改任意文件权限。仍有活动身份时保留记录并明确失败。
pub fn cleanup_current_user_filesystem() -> IsolationResult<()> {
    let _lock = FilesystemLock::acquire()?;
    let mut journal = Journal::open()?;
    journal.recover()?;
    if !journal.document.records.is_empty() {
        return Err(IsolationError::new(
            "filesystem_uninstall",
            "isolated commands are still active",
        ));
    }
    srt_win::reg::delete_value(&journal.key, JOURNAL_VALUE)
        .map_err(|error| IsolationError::new("filesystem_uninstall", error.to_string()))
}

impl FilesystemLease {
    pub fn acquire(account: &AccountLease, policy: FilesystemPolicy) -> IsolationResult<Self> {
        crate::ambient_read::require_current_user()?;
        let policy = policy.canonicalize()?;
        let _lock = FilesystemLock::acquire()?;
        let mut journal = Journal::open()?;
        journal.recover()?;
        let record = Record {
            account_name: account.account_name.clone(),
            account_sid: account.account_sid.clone(),
            policy,
        };
        let mut records = journal.document.records.clone();
        records.push(record.clone());
        // 先记录修改意图，再改 ACL；任何半途失败都保留明确的 SID/路径恢复依据。
        journal.commit(records)?;
        record.policy.apply(&record.account_sid)?;
        Ok(Self { record })
    }

    pub fn release(self) -> IsolationResult<()> {
        let _lock = FilesystemLock::acquire()?;
        let mut journal = Journal::open()?;
        self.record.policy.revoke(&self.record.account_sid)?;
        journal.remove(&self.record.account_sid)
    }
}
