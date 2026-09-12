import { ProcessToolArgumentsV1Schema } from '@app/schemas/commands';
import type { ZodError, ZodIssue } from 'zod';

function selectActionExample(action: unknown): object {
  const type = typeof action === 'object' && action !== null && 'type' in action
    ? action.type
    : action;
  // 示例只说明合同，不会提交执行；无法识别动作时用只读 poll 展示结构。
  switch (type) {
    case 'wait': return { type, cursor: 0, wait_timeout_ms: 1_000 };
    case 'cancel':
    case 'eof': return { type };
    case 'write': return { type, input: '<要写入的文本>' };
    case 'submit': return { type, input: '' };
    case 'resize': return { type, columns: 80, rows: 24 };
    default: return { type: 'poll', cursor: 0 };
  }
}

function relevantIssues(issues: readonly ZodIssue[]): readonly ZodIssue[] {
  return issues.flatMap(issue => {
    if (issue.code !== 'invalid_union') return [issue];
    const branches = issue.unionErrors.map(error => relevantIssues(error.issues));
    // 正式合同有观察/控制与 PTY 两组判别联合。已匹配 type 的分支才解释字段错误，
    // 否则另一组的“不支持此 type”会把正确动作反而说成无效动作。
    const matched = branches.filter(branch =>
      !branch.some(candidate => candidate.code === 'invalid_union_discriminator'),
    );
    return (matched.length > 0 ? matched : branches).flat();
  });
}

function formatIssue(issue: ZodIssue): string[] {
  const field = issue.path.join('.') || 'process';
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map(key => `${field === 'process' ? '' : `${field}.`}${key}：不允许的字段`);
  }
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return [`${field}：缺少必需字段`];
  }
  if (issue.code === 'invalid_type' && issue.expected === 'object') {
    return [`${field}：必须是对象，不能用字符串代替`];
  }
  return [`${field}：${issue.message}`];
}

/** 错误定位来自唯一正式 parser，不另写一份字段/数值准入规则。 */
export function processProtocolViolationMessage(
  args: Record<string, unknown>,
  error: ZodError,
): string {
  const issues = [...new Set(relevantIssues(error.issues).flatMap(formatIssue))];
  const example = ProcessToolArgumentsV1Schema.parse({
    process_handle: 'command_process_00000000-0000-4000-8000-000000000000',
    action: selectActionExample(args.action),
  });
  return [
    `[process_protocol_violation] process 参数无效：${issues.join('；')}。`,
    '顶层只能提供 process_handle 和 action；action 是对象，动作名写在 action.type。',
    `最小结构示例：${JSON.stringify(example)}`,
    '示例 handle 是虚构占位，不能执行；process_handle 必须复制上次 shell/process 的结果。若有 cursor，0 只演示数值类型，实际请复制同一进程最新结果的 next_cursor，不要猜测。',
  ].join('\n');
}
