import type {
  AiMessage,
  ResolvedContextCompactionPolicy,
} from '../../../../contracts';
import type { MustKeepPolicy } from '../../../shared/policies';

export interface SelectContextCompactionCandidateInput {
  /** 已 materialize、真正进入主 Prompt 的消息；候选与释放量只能按这份视图计算。 */
  readonly messages: readonly AiMessage[];
  /**
   * 预处理后的来源消息，仅用于展开 replacement closure 与递增 summary seq。
   * 它不能参与候选排序或 token 释放量计算，否则会采样主 Prompt 根本没有携带的历史。
   */
  readonly replacementSourceMessages?: readonly AiMessage[];
  /** Context Manager 可分配给消息的预算（已扣除工具定义）。 */
  readonly totalBudget: number;
  /** Graph 最终 Prompt 的完整输入预算；用于把工具定义成本纳入目标水位计划。 */
  readonly inputBudgetTokens: number;
  readonly policy: ResolvedContextCompactionPolicy;
  readonly mustKeepPolicy: MustKeepPolicy;
  readonly estimateTokens: (message: AiMessage) => number;
}
