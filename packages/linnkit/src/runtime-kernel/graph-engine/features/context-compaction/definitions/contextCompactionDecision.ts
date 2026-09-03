import type {
  ContextUsageSnapshot,
  ResolvedContextCompactionPolicy,
} from '../../../../../contracts';
import type { ExecutorLocalState } from '../../../types';

export interface EvaluateContextCompactionInput {
  policy: ResolvedContextCompactionPolicy;
  promptUsage: ContextUsageSnapshot;
  phase: ExecutorLocalState['phase'];
  attemptCount: number;
  lastCommittedFingerprint?: string;
  candidateFingerprint?: string;
}

export type ContextCompactionDecision =
  | {
      kind: 'run';
      forcedPhaseRecovery: boolean;
      usageRatio: number;
    }
  | {
      kind: 'skip';
      reason:
        | 'disabled'
        | 'below_trigger'
        | 'no_replaceable_range'
        | 'forced_final_answer'
        | 'forced_tools'
        | 'max_compactions_reached'
        | 'duplicate_plan_fingerprint';
      usageRatio: number;
    }
  | {
      kind: 'blocked';
      reason:
        | 'no_replaceable_range'
        | 'max_compactions_reached'
        | 'duplicate_plan_fingerprint';
      usageRatio: number;
    };
