import {
  SHELL_COMMAND_MAX_LENGTH,
  countShellCommandCharacters,
  type CommandConversationApprovalCandidate,
  type CommandConversationMatcherContext,
} from '@app/schemas/commands';

import {
  COMMAND_AUTHORIZATION_MATCHER_REVISION,
  type SimpleCommandCandidateDerivation,
} from '../definitions/simpleCommand';
import { isSupportedSimpleCommandContext } from './isSupportedSimpleCommandContext';
import { scanPowerShellSimpleCommand } from './scanPowerShellSimpleCommand';
import { scanZshSimpleCommand } from './scanZshSimpleCommand';
import { validateRememberableSimpleCommandPrefix } from './validateRememberableSimpleCommandPrefix';

/**
 * candidate 由 host 从原命令生成，Agent 和 renderer 都不能选择一个更宽前缀。
 * v1 使用本次完整静态 token 向量；后续只允许追加 token，不允许改变已展示部分。
 */
export function deriveSimpleCommandCandidate(params: {
  readonly command: string;
  readonly platform: CommandConversationMatcherContext['platform'];
  readonly shellSemanticsId: string;
}): SimpleCommandCandidateDerivation {
  const matchingContext: CommandConversationMatcherContext = {
    platform: params.platform,
    shell_semantics_id: params.shellSemanticsId,
    matcher_revision: COMMAND_AUTHORIZATION_MATCHER_REVISION,
  };
  if (!isSupportedSimpleCommandContext(matchingContext)) {
    return { status: 'unavailable', reason: 'unsupported_shell_semantics' };
  }
  if (countShellCommandCharacters(params.command) > SHELL_COMMAND_MAX_LENGTH) {
    return { status: 'one_time_only', reason: 'candidate_too_large' };
  }

  const scan = params.platform === 'macos'
    ? scanZshSimpleCommand(params.command)
    : scanPowerShellSimpleCommand(params.command);
  if (scan.status === 'one_time_only') return scan;

  const prefixValidation = validateRememberableSimpleCommandPrefix(scan.tokens);
  if (prefixValidation.status === 'one_time_only') return prefixValidation;

  const candidate: CommandConversationApprovalCandidate = {
    token_prefix: [...scan.tokens],
    matching_context: matchingContext,
  };
  return { status: 'derived', candidate };
}
