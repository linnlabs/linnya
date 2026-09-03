import { randomUUID } from 'node:crypto';
import { link, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import type {
  SandboxRunnerRequest,
} from '../../../definitions/sandboxRunner.js';
import type { SandboxRunnerEvaluationResult } from '../../../runner-evaluation/definitions/sandboxRunnerEvaluation.js';
import {
  parseSandboxRequestMailboxEnvelope,
  parseSandboxResultMailboxEnvelope,
  parseSandboxRunToken,
  SANDBOX_MAILBOX_PROTOCOL_VERSION,
  SANDBOX_MAILBOX_REQUEST_FILE_NAME,
  SANDBOX_MAILBOX_REQUEST_MAX_BYTES,
  SANDBOX_MAILBOX_RESULT_FILE_NAME,
  SANDBOX_MAILBOX_RESULT_MAX_BYTES,
  SandboxMailboxProtocolError,
  type SandboxRequestMailboxEnvelope,
  type SandboxResultMailboxEnvelope,
} from '../definitions/sandboxMailboxProtocol.js';

export function resolveSandboxRequestMailboxPath(runDirectory: string): string {
  return path.join(runDirectory, SANDBOX_MAILBOX_REQUEST_FILE_NAME);
}

export function resolveSandboxResultMailboxPath(runDirectory: string): string {
  return path.join(runDirectory, SANDBOX_MAILBOX_RESULT_FILE_NAME);
}

export async function publishSandboxRequestMailbox(input: {
  readonly runDirectory: string;
  readonly runToken: string;
  readonly request: SandboxRunnerRequest;
}): Promise<void> {
  const envelope: SandboxRequestMailboxEnvelope = {
    protocol_version: SANDBOX_MAILBOX_PROTOCOL_VERSION,
    kind: 'sandbox_request',
    run_token: parseSandboxRunToken(input.runToken),
    request: input.request,
  };
  const parsed = parseSandboxRequestMailboxEnvelope(envelope);
  await publishEnvelope({
    destinationPath: resolveSandboxRequestMailboxPath(input.runDirectory),
    envelope: parsed,
    maxBytes: SANDBOX_MAILBOX_REQUEST_MAX_BYTES,
  });
}

export async function publishSandboxResultMailbox(input: {
  readonly runDirectory: string;
  readonly runToken: string;
  readonly result: SandboxRunnerEvaluationResult;
}): Promise<void> {
  const envelope: SandboxResultMailboxEnvelope = {
    protocol_version: SANDBOX_MAILBOX_PROTOCOL_VERSION,
    kind: 'sandbox_result',
    run_token: parseSandboxRunToken(input.runToken),
    result: input.result,
  };
  const parsed = parseSandboxResultMailboxEnvelope(envelope);
  await publishEnvelope({
    destinationPath: resolveSandboxResultMailboxPath(input.runDirectory),
    envelope: parsed,
    maxBytes: SANDBOX_MAILBOX_RESULT_MAX_BYTES,
  });
}

export async function readSandboxRequestMailbox(input: {
  readonly runDirectory: string;
  readonly runToken: string;
}): Promise<SandboxRunnerRequest> {
  const expectedToken = parseSandboxRunToken(input.runToken);
  const value = await readEnvelope(
    resolveSandboxRequestMailboxPath(input.runDirectory),
    SANDBOX_MAILBOX_REQUEST_MAX_BYTES,
  );
  const envelope = parseSandboxRequestMailboxEnvelope(value);
  if (envelope.run_token !== expectedToken) {
    throw new SandboxMailboxProtocolError('mailbox_token_mismatch');
  }
  return envelope.request;
}

export async function readSandboxResultMailbox(input: {
  readonly runDirectory: string;
  readonly runToken: string;
}): Promise<SandboxRunnerEvaluationResult> {
  const expectedToken = parseSandboxRunToken(input.runToken);
  const value = await readEnvelope(
    resolveSandboxResultMailboxPath(input.runDirectory),
    SANDBOX_MAILBOX_RESULT_MAX_BYTES,
  );
  const envelope = parseSandboxResultMailboxEnvelope(value);
  if (envelope.run_token !== expectedToken) {
    throw new SandboxMailboxProtocolError('mailbox_token_mismatch');
  }
  return envelope.result;
}

async function publishEnvelope(input: {
  readonly destinationPath: string;
  readonly envelope: SandboxRequestMailboxEnvelope | SandboxResultMailboxEnvelope;
  readonly maxBytes: number;
}): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(input.envelope), 'utf8');
  if (bytes.byteLength > input.maxBytes) {
    throw new SandboxMailboxProtocolError('mailbox_envelope_too_large', bytes.byteLength);
  }

  const pendingPath = `${input.destinationPath}.${randomUUID()}.tmp`;
  let pendingExists = false;
  try {
    const handle = await open(pendingPath, 'wx', 0o600);
    pendingExists = true;
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    // rename 在 POSIX 会覆盖已有文件，在 Windows 通常会失败。硬链接在同目录内原子创建
    // final 且永不覆盖，因此两平台都遵守“第一个完整发布者胜出”的同一合同。
    await link(pendingPath, input.destinationPath);
  } catch (error) {
    if (error instanceof SandboxMailboxProtocolError) throw error;
    throw new SandboxMailboxProtocolError('mailbox_publish_failed', bytes.byteLength);
  } finally {
    // 硬链接成功就是唯一提交点。final 已经可见后，临时文件清理失败不能让调用方
    // 误判为未提交并重试；残留文件最终随整个 run 目录一起清理。
    if (pendingExists) await rm(pendingPath, { force: true }).catch(() => undefined);
  }
}

async function readEnvelope(filePath: string, maxBytes: number): Promise<unknown> {
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch {
    throw new SandboxMailboxProtocolError('mailbox_file_unavailable');
  }

  let parsed: unknown;
  let closeFailed = false;
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      throw new SandboxMailboxProtocolError('mailbox_file_not_regular');
    }

    // 上限加一字节读取能在 JSON.parse 前证明容量，不依赖可能在读取期间变化的 stat.size。
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const result = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > maxBytes) {
      throw new SandboxMailboxProtocolError('mailbox_envelope_too_large', offset);
    }

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new SandboxMailboxProtocolError('mailbox_file_invalid_utf8', offset);
    }
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SandboxMailboxProtocolError('mailbox_file_malformed_json', offset);
    }
  } catch (error) {
    if (error instanceof SandboxMailboxProtocolError) throw error;
    throw new SandboxMailboxProtocolError('mailbox_file_unavailable');
  } finally {
    try {
      await handle.close();
    } catch {
      closeFailed = true;
    }
  }
  if (closeFailed) throw new SandboxMailboxProtocolError('mailbox_file_unavailable');
  return parsed;
}
