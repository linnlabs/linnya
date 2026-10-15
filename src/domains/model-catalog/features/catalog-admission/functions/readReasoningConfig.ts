import type { ModelReasoningConfig } from '@linnlabs/linnkit/contracts';
import { isValidReasoningEffort, REASONING_EFFORTS } from '@linnlabs/linnkit/contracts';

/**
 * 解析并校验 `reasoning` 能力契约。
 *
 * 校验规则：
 * - `supported_efforts`：过滤非法枚举值、去重，并按 `REASONING_EFFORTS` 顺序（从弱到强）归一化排序，
 *   保证降级兜底取首项（最弱档）的行为可预测；空数组视为不支持，返回 undefined（不保留字段）。
 * - `default_effort`：必须为合法枚举且在 supported 中，否则忽略。
 */
export function readReasoningConfig(value: unknown): ModelReasoningConfig | undefined {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : undefined;
  if (!raw) return undefined;

  const rawEfforts = Array.isArray(raw.supported_efforts) ? raw.supported_efforts : [];
  const deduped = Array.from(new Set(rawEfforts.filter(isValidReasoningEffort)));
  if (deduped.length === 0) return undefined;
  // 按 REASONING_EFFORTS 顺序（从弱到强）归一化排序
  const supportedEfforts = deduped.sort(
    (a, b) => REASONING_EFFORTS.indexOf(a) - REASONING_EFFORTS.indexOf(b)
  );

  const rawDefaultEffort = raw.default_effort;
  const defaultEffort =
    isValidReasoningEffort(rawDefaultEffort) && supportedEfforts.includes(rawDefaultEffort)
      ? rawDefaultEffort
      : undefined;

  return {
    supported_efforts: supportedEfforts,
    default_effort: defaultEffort,
  };
}
