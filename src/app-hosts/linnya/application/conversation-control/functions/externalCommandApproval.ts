import type { ConversationControlExternalApproval } from '@app/schemas';
import type { CommandApprovalChoice, CommandExternalApproval } from '@app/schemas/commands';
import type { ExternalCommandApprovalPolicy } from '../definitions/externalCommandApproval';

/**
 * 两个来源任一放开即可代批：用户在设置里打开的开关，或宿主启动时的显式放行
 * （源码版 `linnya runtime start --allow-external-approval`，供评测与自动化使用）。
 * 设置读不出来时按最严处理；那种状态下命令本身也拿不到权限快照。
 */
export function resolveExternalCommandApprovalPolicy(input: {
  readonly hostKind: 'desktop' | 'cli_runtime';
  readonly hostAllows: boolean;
  readonly setting: CommandExternalApproval | undefined;
}): ExternalCommandApprovalPolicy {
  return input.hostAllows || input.setting === 'allowed'
    ? { permitted: true }
    : { permitted: false, host: input.hostKind };
}

const DENY_HINT = 'You can still deny it with `--choice deny --reason "<why>"`; the reason is passed to the agent that proposed the command.';

/**
 * 写给外部 Agent 的说明：为什么不能代批、该请用户做什么。它会被原样转述给用户，
 * 所以写清楚是用户没有放开，而不是命令或连接出了错。
 */
export function describeExternalCommandApproval(
  policy: ExternalCommandApprovalPolicy,
): ConversationControlExternalApproval {
  if (policy.permitted) return { permitted: true };
  return {
    permitted: false,
    message: policy.host === 'desktop'
      ? 'Only the user can approve commands: the user has not turned on "Allow the command line to approve commands" in Linnya Settings > Command permissions (it is off by default). '
        + 'Ask the user to approve this command in the Linnya desktop app, or to turn that setting on. '
        + DENY_HINT
      : 'Only the person at the runtime terminal can approve commands: this runtime was started without --allow-external-approval. '
        + 'Ask them to answer the prompt in the terminal running `linnya runtime start`, or to restart it with --allow-external-approval. '
        + DENY_HINT,
  };
}

/**
 * 外部调用方这次回复不被接受时返回要告诉它的说明，可以接受时返回 undefined。
 * 拒绝永远可以提交；只有“允许一次”“本对话内允许”需要用户本人。
 */
export function refuseExternalApprovalReply(
  choice: CommandApprovalChoice,
  policy: ExternalCommandApprovalPolicy,
): string | undefined {
  if (choice === 'deny') return undefined;
  const described = describeExternalCommandApproval(policy);
  return described.permitted ? undefined : described.message;
}
