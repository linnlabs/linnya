import { resolveEffectiveEffort, type ModelReasoningConfig } from '@linnlabs/linnkit/contracts';
import type { ModelInferenceRoute } from '../../../definitions/modelCatalog';
import type { ModelReasoningResolver } from '../../../definitions/modelReasoningResolver';
import { inferReasoningConfigByModelName } from './inferReasoningConfigByModelName';
import { readReasoningConfig } from './readReasoningConfig';
import { Logger } from 'src/shared/logger';

const logger = new Logger('ModelCatalog');

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
  const availableEfforts = available?.supported_efforts ?? [];
  const narrowed = declared
    ? availableEfforts.filter(effort => declared.supported_efforts.includes(effort))
    : availableEfforts;
  // 显式声明只能在模型能力范围内缩窄。缩窄到模型做不到的档位时这条声明无法执行：
  // 用户 2026-11-26 定不再因此停用整个模型（界面也没有改档位的入口，用户修不了），
  // 改为整条忽略这条声明（包括它的默认档位），按 SDK 报告的档位启用，并留下日志便于排查。
  const ignoredDeclaration = declared && narrowed.length === 0 ? declared : undefined;
  const effectiveDeclared = ignoredDeclaration ? undefined : declared;
  const supported = ignoredDeclaration ? availableEfforts : narrowed;
  const result = available
    ? applyDefaultEffort(supported, effectiveDeclared?.default_effort, available.default_effort)
    : undefined;
  if (ignoredDeclaration) {
    logger.warn(
      `[ModelCatalog] 模型 ${input.modelName} 的 reasoning 声明与当前推理能力没有共同档位，已忽略这条声明，按推理能力启用`,
      {
        ignored_reasoning: ignoredDeclaration,
        applied_reasoning: result ?? null,
      }
    );
  }
  return result;
}

function applyDefaultEffort(
  supported: ModelReasoningConfig['supported_efforts'],
  declaredDefault: ModelReasoningConfig['default_effort'],
  availableDefault: ModelReasoningConfig['default_effort']
): ModelReasoningConfig {
  const defaultEffort =
    declaredDefault && supported.includes(declaredDefault)
      ? declaredDefault
      : availableDefault && supported.includes(availableDefault)
        ? availableDefault
        : undefined;
  const config = { supported_efforts: supported, default_effort: defaultEffort };
  // 产品默认沿用 Linnkit 的 canonical 规则；SDK 只提供能力事实，不承担 UI 默认策略。
  return { ...config, default_effort: resolveEffectiveEffort(null, config) ?? undefined };
}
