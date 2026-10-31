use crate::{
    IsolationError, IsolationResult,
    identity::OwnerIdentity,
    protocol::{AccountReply, AccountRequest, read_frame, write_frame},
    transport,
};
use std::fs::File;
use zeroize::Zeroizing;

pub(crate) fn inspect(owner: &OwnerIdentity) -> IsolationResult<()> {
    let mut connection = transport::connect(owner)?;
    write_frame(
        &mut connection,
        &AccountRequest::Inspect {
            protocol_version: 1,
        },
    )?;
    match read_frame(&mut connection)? {
        AccountReply::Ready {
            protocol_version: 1,
        } => Ok(()),
        _ => Err(IsolationError::new(
            "account_inspect",
            "unexpected service readiness response",
        )),
    }
}

/// 不实现 Debug。密码只交给原生 Secondary Logon 调用，不能投影到 JS、argv 或环境变量。
pub struct AccountLease {
    connection: File,
    lease_id: String,
    pub job_name: String,
    pub worker_job_name: String,
    pub account_name: String,
    pub account_sid: String,
    pub group_sid: String,
    pub password: Zeroizing<String>,
}

impl AccountLease {
    pub fn acquire() -> IsolationResult<Self> {
        let mut connection = transport::connect(&OwnerIdentity::current()?)?;
        write_frame(
            &mut connection,
            &AccountRequest::Acquire {
                protocol_version: 1,
            },
        )?;
        match read_frame(&mut connection)? {
            AccountReply::Acquired {
                protocol_version: 1,
                lease_id,
                job_name,
                worker_job_name,
                account_name,
                account_sid,
                group_sid,
                password,
            } => Ok(Self {
                connection,
                lease_id,
                job_name,
                worker_job_name,
                account_name,
                account_sid,
                group_sid,
                password,
            }),
            AccountReply::Failed { message, .. } => {
                Err(IsolationError::new("account_acquire", message))
            }
            _ => Err(IsolationError::new(
                "account_protocol",
                "invalid acquire response",
            )),
        }
    }

    /// 正常退出须等待整树/账户回收确认；异常 drop 关闭连接，服务独立回收该租约。
    pub fn release(mut self) -> IsolationResult<()> {
        write_frame(
            &mut self.connection,
            &AccountRequest::Release {
                lease_id: self.lease_id.clone(),
            },
        )?;
        match read_frame(&mut self.connection)? {
            AccountReply::Released { lease_id } if lease_id == self.lease_id => Ok(()),
            AccountReply::Failed { message, .. } => {
                Err(IsolationError::new("account_release", message))
            }
            _ => Err(IsolationError::new(
                "account_protocol",
                "invalid release response",
            )),
        }
    }
}
