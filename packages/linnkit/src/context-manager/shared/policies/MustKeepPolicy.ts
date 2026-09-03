import type { AiMessage } from '../../../contracts';

export interface MustKeepTruncationRule {
  messageType?: AiMessage['type'] | string;
  metadataFragmentType?: string;
  fenceKind?: string;
  maxBudgetFraction: number;
  strategyName: string;
}

export interface MustKeepPolicy {
  alwaysKeepTypes: Array<AiMessage['type'] | string>;
  alwaysKeepFenceKinds: string[];
  truncationRules: MustKeepTruncationRule[];
}

export const DEFAULT_MUST_KEEP_POLICY: MustKeepPolicy = {
  alwaysKeepTypes: ['system_prompt', 'user_input'],
  alwaysKeepFenceKinds: [],
  truncationRules: [],
};

export function findMatchingTruncationRule(
  message: AiMessage,
  policy: MustKeepPolicy,
): MustKeepTruncationRule | undefined {
  return policy.truncationRules.find((rule) => {
    if (rule.messageType !== undefined && rule.messageType !== message.type) {
      return false;
    }
    if (rule.metadataFragmentType !== undefined && message.metadata?.fragmentType !== rule.metadataFragmentType) {
      return false;
    }
    if (rule.fenceKind !== undefined && message.metadata?.fenceKind !== rule.fenceKind) {
      return false;
    }
    return true;
  });
}
