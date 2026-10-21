import {
  SHELL_COMMAND_MAX_LENGTH,
  SHELL_INITIAL_WAIT_MAX_MS,
  SHELL_INITIAL_WAIT_MIN_MS,
  ShellToolArgumentsV1Schema,
} from '@app/schemas/commands';
import type { ZodError, ZodIssue } from 'zod';

function formatIssue(issue: ZodIssue): string[] {
  const field = issue.path.join('.') || 'shell';
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map(key => `${key}：不允许的字段`);
  }
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return [`${field}：缺少必需字段`];
  }
  return [`${field}：${issue.message}`];
}

/** 只投影正式 parser 的字段错误，不回显 command、cwd 或未知字段的值。 */
export function shellProtocolViolationMessage(error: ZodError): string {
  const example = ShellToolArgumentsV1Schema.parse({
    command: 'pwd',
    initial_wait_ms: 1_000,
  });
  const fields = new Set(error.issues.flatMap(issue =>
    issue.code === 'unrecognized_keys' ? issue.keys : [issue.path[0]],
  ));
  const guidance: string[] = [];
  if (fields.has('command')) {
    guidance.push(`command 最多 ${SHELL_COMMAND_MAX_LENGTH} 个 Unicode 字符；长资料请通过已有物理文件路径交给命令，不要粘贴全文。`);
  }
  if (fields.has('initial_wait_ms') || fields.has('wait_timeout_ms')) {
    guidance.push(`initial_wait_ms 是首次等待，范围 ${SHELL_INITIAL_WAIT_MIN_MS}–${SHELL_INITIAL_WAIT_MAX_MS} ms，不是命令总时长；长命令会返回 handle。wait_timeout_ms 属于 process.action：用 action.type="wait"、action.wait_timeout_ms，复制同一进程最新结果的 process_handle 和 next_cursor 作为 cursor 后继续等待。`);
  }
  return [
    `[shell_protocol_violation] shell 参数无效：${error.issues.flatMap(formatIssue).join('；')}。`,
    `最小结构示例：${JSON.stringify(example)}`,
    '示例只说明参数结构，不会自动执行。',
    ...guidance,
  ].join('\n');
}
