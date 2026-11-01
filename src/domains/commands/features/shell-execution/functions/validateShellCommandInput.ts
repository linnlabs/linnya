import {
  SHELL_INITIAL_WAIT_DEFAULT_MS,
  ShellToolArgumentsV1Schema,
} from '@app/schemas/commands';

import type {
  ShellCommandInputRejectionCode,
  ShellCommandInputValidation,
} from '../definitions/shellCommandInput';

function classifyInputRejection(
  issues: readonly { readonly path: readonly PropertyKey[] }[],
): ShellCommandInputRejectionCode {
  if (issues.some(issue => issue.path[0] === 'command')) return 'invalid_command';
  if (issues.some(issue => issue.path[0] === 'cwd')) return 'invalid_cwd';
  if (issues.some(issue => issue.path[0] === 'initial_wait_ms')) {
    return 'invalid_initial_wait';
  }
  if (issues.some(issue => issue.path[0] === 'hard_timeout_seconds')) {
    return 'invalid_hard_timeout';
  }
  return 'invalid_arguments';
}

/**
 * Agent 输入错误只投影稳定业务 code。Zod 的路径和英文消息属于 schema 诊断，
 * 不能直接泄漏成 Agent 长期依赖的错误协议。
 */
export function validateShellCommandInput(value: unknown): ShellCommandInputValidation {
  const parsed = ShellToolArgumentsV1Schema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({
      status: 'rejected',
      code: classifyInputRejection(parsed.error.issues),
    });
  }

  const input = Object.freeze({
    command: parsed.data.command,
    ...(parsed.data.cwd === undefined ? {} : { requestedCwd: parsed.data.cwd }),
    interactive: parsed.data.interactive ?? false,
    requiresWriteAccess: parsed.data.requires_write_access ?? false,
    initialWaitMs: parsed.data.initial_wait_ms ?? SHELL_INITIAL_WAIT_DEFAULT_MS,
    ...(parsed.data.hard_timeout_seconds === undefined
      ? {}
      : { requestedHardTimeoutMs: parsed.data.hard_timeout_seconds * 1_000 }),
  });
  return Object.freeze({ status: 'accepted', input });
}
