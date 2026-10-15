import { resolveEffectiveEffort, type ModelReasoningConfig } from '@linnlabs/linnkit/contracts';
import type { ModelInferenceRoute } from '../../../definitions/modelCatalog';
import type { ModelReasoningResolver } from '../../../definitions/modelReasoningResolver';
import { inferReasoningConfigByModelName } from './inferReasoningConfigByModelName';
import { readReasoningConfig } from './readReasoningConfig';

/** SDK 能力限定可执行范围，显式声明只能缩窄；缺少 SDK 信息才使用既有目录知识。 */
export function resolveModelReasoningConfig(input: {
  readonly modelName: string;
  readonly route?: ModelInferenceRoute;
  readonly declared?: unknown;
  readonly resolver?: ModelReasoningResolver;
}): ModelReasoningConfig | undefined {
  const declared = readReasoningConfig(input.declared);
  const resolved = input.route
    ? input.resolver?.({
        capability_id: input.route.capability_id,
        endpoint_model_id: input.route.endpoint_model_id,
      })
    : undefined;
  if (resolved === undefined) {
    return declared ?? inferReasoningConfigByModelName(input.modelName);
  }
  const available = readReasoningConfig(resolved);
  const supported = declared
    ? (available?.supported_efforts ?? []).filter(effort =>
        declared.supported_efforts.includes(effort)
      )
    : (available?.supported_efforts ?? []);
  if (declared && supported.length === 0) {
    throw new Error(`模型 ${input.modelName} 的 reasoning 声明与当前推理能力没有共同档位`);
  }
  if (!available) return undefined;
  const defaultEffort =
    declared?.default_effort && supported.includes(declared.default_effort)
      ? declared.default_effort
      : available.default_effort && supported.includes(available.default_effort)
        ? available.default_effort
        : undefined;
  const config = { supported_efforts: supported, default_effort: defaultEffort };
  // 产品默认沿用 Linnkit 的 canonical 规则；SDK 只提供能力事实，不承担 UI 默认策略。
  return { ...config, default_effort: resolveEffectiveEffort(null, config) ?? undefined };
}
