import path from 'node:path';

import { SANDBOX_MAILBOX_PROTOCOL_VERSION } from './sandboxMailboxProtocol.js';
import { parseSandboxHeapLimitMb } from './sandboxRuntimeLimits.js';

/**
 * Evaluator argv 只包含 Node heap flag、固定入口、协议身份和资源上限。
 * 源码与 globals 仍只能经私有 mailbox 传递。
 */
export function buildSandboxEvaluatorInvocationArgv(input: {
  readonly entryPath: string;
  readonly runToken: string;
  readonly maximumHeapMb: number;
}): readonly string[] {
  if (!path.isAbsolute(input.entryPath)) {
    throw new Error('sandbox evaluator entry path must be absolute');
  }
  const maximumHeapMb = parseSandboxHeapLimitMb(input.maximumHeapMb);
  return Object.freeze([
    `--max-old-space-size=${maximumHeapMb}`,
    input.entryPath,
    String(SANDBOX_MAILBOX_PROTOCOL_VERSION),
    input.runToken,
    String(maximumHeapMb),
  ]);
}
