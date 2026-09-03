import type { AgentSpecContextPolicyInput } from 'linnkit/contracts';

const LINNYA_INJECTION_MAX_BUDGET_FRACTION = 0.25;

/**
 * linnya 的 host 级上下文策略默认值。
 *
 * 中文备注：
 * - 这里保留 linnya 自己的业务 fence 名称；
 * - linnkit framework 只认识通用 mustKeep 协议，不认识 `additional-context`。
 */
export const LINNYA_CONTEXT_POLICY_FALLBACK: AgentSpecContextPolicyInput = {
  tokenEstimation: {
    calibration: {
      // 中文备注：校准默认打开但必须有足够同 route actual 样本才会生效；
      // 无样本时仍保持本地估算，避免上线初期让上下文裁剪行为漂移。
      enabled: true,
      minSamples: 3,
      minCoefficient: 1,
      maxCoefficient: 4,
    },
  },
  mustKeep: {
    alwaysKeepFenceKinds: ['additional-context'],
    truncationRules: [
      {
        fenceKind: 'additional-context',
        maxBudgetFraction: LINNYA_INJECTION_MAX_BUDGET_FRACTION,
        strategyName: 'additional_context_truncation',
      },
    ],
  },
};
