use serde::{Deserialize, Serialize};
use srt_win::reg::Key;

use crate::{IsolationError, IsolationResult, identity::OwnerIdentity};

const JOURNAL_VALUE: &str = "AccountLeasesV1";
const MAX_JOURNAL_BYTES: usize = 128 * 1024;
pub(crate) const MAX_ACCOUNT_LEASES: usize = 32;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AccountRecord {
    pub(crate) lease_id: String,
    pub(crate) account_name: String,
    pub(crate) account_sid: Option<String>,
    pub(crate) owner_pid: u32,
    pub(crate) owner_created_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JournalDocument {
    version: u8,
    accounts: Vec<AccountRecord>,
}

/// HKLM 只记录可回收账户的身份，不保存密码。一个注册表值使每次租约变更只有一个提交点。
pub(crate) struct AccountJournal {
    key: Key,
    document: JournalDocument,
}

impl AccountJournal {
    pub(crate) fn initialize(owner: &OwnerIdentity) -> IsolationResult<()> {
        let (key, _) = Key::create(&owner.registry_path(), None).map_err(|error| {
            IsolationError::new("account_journal_initialize", error.to_string())
        })?;
        match key
            .get_binary(JOURNAL_VALUE)
            .map_err(|error| IsolationError::new("account_journal_read", error.to_string()))?
        {
            Some(bytes) => {
                Self::decode(&bytes)?;
            }
            None => {
                let journal = Self {
                    key,
                    document: JournalDocument {
                        version: 1,
                        accounts: Vec::new(),
                    },
                };
                journal.persist(&journal.document)?;
            }
        }
        Ok(())
    }

    pub(crate) fn open(owner: &OwnerIdentity) -> IsolationResult<Self> {
        let key = Key::open(&owner.registry_path(), true)
            .map_err(|error| IsolationError::new("account_journal_open", error.to_string()))?
            .ok_or_else(|| {
                IsolationError::new("account_journal_open", "isolation is not initialized")
            })?;
        let bytes = key
            .get_binary(JOURNAL_VALUE)
            .map_err(|error| IsolationError::new("account_journal_read", error.to_string()))?
            .ok_or_else(|| {
                IsolationError::new("account_journal_read", "account journal is missing")
            })?;
        Ok(Self {
            key,
            document: Self::decode(&bytes)?,
        })
    }

    fn decode(bytes: &[u8]) -> IsolationResult<JournalDocument> {
        if bytes.len() > MAX_JOURNAL_BYTES {
            return Err(IsolationError::new(
                "account_journal_decode",
                "account journal is too large",
            ));
        }
        let document: JournalDocument = serde_json::from_slice(bytes).map_err(|_| {
            IsolationError::new("account_journal_decode", "account journal is damaged")
        })?;
        if document.version != 1 || document.accounts.len() > MAX_ACCOUNT_LEASES {
            return Err(IsolationError::new(
                "account_journal_decode",
                "unsupported account journal",
            ));
        }
        Ok(document)
    }

    fn persist(&self, document: &JournalDocument) -> IsolationResult<()> {
        let bytes = serde_json::to_vec(document).map_err(|_| {
            IsolationError::new("account_journal_encode", "cannot encode account journal")
        })?;
        self.key
            .set_binary(JOURNAL_VALUE, &bytes)
            .map_err(|error| IsolationError::new("account_journal_write", error.to_string()))
    }

    pub(crate) fn records(&self) -> &[AccountRecord] {
        &self.document.accounts
    }

    pub(crate) fn add(&mut self, record: AccountRecord) -> IsolationResult<()> {
        if self.document.accounts.len() == MAX_ACCOUNT_LEASES {
            return Err(IsolationError::new(
                "account_capacity",
                "all isolated command slots are in use",
            ));
        }
        if self.document.accounts.iter().any(|existing| {
            existing.lease_id == record.lease_id || existing.account_name == record.account_name
        }) {
            return Err(IsolationError::new(
                "account_journal_add",
                "account lease already exists",
            ));
        }
        let mut accounts = self.document.accounts.clone();
        accounts.push(record);
        self.commit(accounts)
    }

    pub(crate) fn record_sid(&mut self, lease_id: &str, sid: String) -> IsolationResult<()> {
        let mut accounts = self.document.accounts.clone();
        let record = accounts
            .iter_mut()
            .find(|record| record.lease_id == lease_id)
            .ok_or_else(|| {
                IsolationError::new("account_journal_update", "account lease is missing")
            })?;
        record.account_sid = Some(sid);
        self.commit(accounts)
    }

    pub(crate) fn remove(&mut self, lease_id: &str) -> IsolationResult<()> {
        let accounts = self
            .document
            .accounts
            .iter()
            .filter(|record| record.lease_id != lease_id)
            .cloned()
            .collect();
        self.commit(accounts)
    }

    fn commit(&mut self, accounts: Vec<AccountRecord>) -> IsolationResult<()> {
        let next = JournalDocument {
            version: 1,
            accounts,
        };
        // 持久化失败不能让内存看起来已成功；下一次操作仍以旧记录为准并保留恢复依据。
        self.persist(&next)?;
        self.document = next;
        Ok(())
    }
}
