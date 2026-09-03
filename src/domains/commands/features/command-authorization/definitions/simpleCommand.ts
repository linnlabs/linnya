import type {
  CommandConversationApprovalCandidate,
} from '@app/schemas/commands';

import type { ConversationCommandApproval } from '../../../definitions/commandApproval';

/**
 * 这个 revision 同时冻结 token 化、可记忆范围、前缀匹配和 D77 固定风险语义。
 * 任一规则变宽或变窄时都必须升级 revision，让旧批准自然失效而不是被新语义重解释。
 */
export const COMMAND_AUTHORIZATION_MATCHER_REVISION = 'command-authorization-v2';

export const SUPPORTED_SIMPLE_COMMAND_SHELLS = {
  macos: ['zsh'],
  windows: ['powershell-5.1', 'powershell-7'],
} as const;

export type SimpleCommandOneTimeReason =
  | 'complex_or_dynamic'
  | 'malformed_command'
  | 'candidate_too_large'
  | 'unsafe_prefix';

export type StaticCommandScanResult =
  | {
      readonly status: 'static';
      readonly tokens: readonly string[];
    }
  | {
      readonly status: 'one_time_only';
      readonly reason: Extract<
        SimpleCommandOneTimeReason,
        'complex_or_dynamic' | 'malformed_command'
      >;
    };

export type SimpleCommandCandidateDerivation =
  | {
      readonly status: 'derived';
      readonly candidate: CommandConversationApprovalCandidate;
    }
  | {
      readonly status: 'one_time_only';
      readonly reason: SimpleCommandOneTimeReason;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'unsupported_shell_semantics';
    };

export type ConversationCommandApprovalMatch =
  | {
      readonly status: 'matched';
      readonly approval: ConversationCommandApproval;
    }
  | {
      readonly status: 'not_matched';
    }
  | {
      readonly status: 'unavailable';
      readonly reason:
        | 'invalid_current_candidate'
        | 'invalid_stored_approval'
        | 'unsupported_matcher_context';
    };
