use std::io::{Read, Write};

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use zeroize::Zeroizing;

use crate::{IsolationError, IsolationResult};

// 此协议只租用账户，不传命令和环境。容量上限在分配前检查，避免损坏帧占用服务内存。
const MAX_ACCOUNT_FRAME_BYTES: usize = 16 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum AccountRequest {
    Inspect { protocol_version: u8 },
    Acquire { protocol_version: u8 },
    Release { lease_id: String },
}

// 故意不实现 Debug；账户密码不得通过错误上下文或诊断输出泄漏。
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum AccountReply {
    Ready {
        protocol_version: u8,
    },
    Acquired {
        protocol_version: u8,
        lease_id: String,
        job_name: String,
        worker_job_name: String,
        account_name: String,
        account_sid: String,
        group_sid: String,
        password: Zeroizing<String>,
    },
    Released {
        lease_id: String,
    },
    Failed {
        stage: String,
        message: String,
    },
}

pub(crate) fn read_frame<T: DeserializeOwned>(input: &mut impl Read) -> IsolationResult<T> {
    read_frame_bounded(input, MAX_ACCOUNT_FRAME_BYTES)
}

pub(crate) fn read_frame_bounded<T: DeserializeOwned>(
    input: &mut impl Read,
    limit: usize,
) -> IsolationResult<T> {
    let mut header = [0u8; 4];
    input
        .read_exact(&mut header)
        .map_err(|error| IsolationError::new("account_frame_header", error.to_string()))?;
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > limit {
        return Err(IsolationError::new(
            "account_frame_size",
            "invalid account frame length",
        ));
    }
    // 回复包含临时口令；帧和解析后的口令都负责清零，不能留下第二份普通 Vec/String。
    let mut bytes = Zeroizing::new(vec![0u8; length]);
    input
        .read_exact(&mut bytes)
        .map_err(|error| IsolationError::new("account_frame_body", error.to_string()))?;
    serde_json::from_slice(&bytes).map_err(|_| {
        IsolationError::new("account_frame_decode", "invalid account protocol message")
    })
}

pub(crate) fn write_frame<T: Serialize>(output: &mut impl Write, value: &T) -> IsolationResult<()> {
    write_frame_bounded(output, value, MAX_ACCOUNT_FRAME_BYTES)
}

pub(crate) fn write_frame_bounded<T: Serialize>(
    output: &mut impl Write,
    value: &T,
    limit: usize,
) -> IsolationResult<()> {
    let bytes = Zeroizing::new(serde_json::to_vec(value).map_err(|_| {
        IsolationError::new("account_frame_encode", "account message encoding failed")
    })?);
    if bytes.is_empty() || bytes.len() > limit {
        return Err(IsolationError::new(
            "account_frame_size",
            "invalid account frame length",
        ));
    }
    output
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|()| output.write_all(&bytes))
        .and_then(|()| output.flush())
        .map_err(|error| IsolationError::new("account_frame_write", error.to_string()))
}
