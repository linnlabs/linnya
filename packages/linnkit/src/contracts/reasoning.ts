/**
 * @file packages/linnkit/src/contracts/reasoning.ts
 *
 * @description
 * 思考努力程度（Reasoning Effort）的统一用户语义、模型能力契约与降级纯函数。
 *
 * 为什么放在 contracts 而非 runtime-kernel：
 * - `ReasoningEffort` 是基础枚举，需要被 `ports/llm-call.ts` 的 `LlmCallOptions`
 *   和 `runtime-kernel` 的 `ModelReasoningConfig` / `resolveEffectiveEffort` 共同使用；
 * - ports 不能 import runtime-kernel（会形成 ports ⇄ runtime-kernel 循环依赖），
 *   而 contracts 是 ports 与 runtime-kernel 都依赖的最底层共享类型层；
 * - 浏览器 consumer 应只 import `linnkit/contracts`，不能拖入 runtime-kernel 整包
 *   （会间接拉到 `node:async_hooks` 等 Node-only 模块）。
 *
 * 语义从弱到强：off < minimal < low < medium < high < xhigh。
 * - `off`：关闭思考，由 adapter 决定如何表达（不发字段 / 发原生 disable）。
 * - 不含 `adaptive`：本合同只表达离散的努力强度；provider 的动态思考策略由 adapter 解释。
 *
 * 设计要点：
 * - 一处真源，供 host 模型注册表、runtime-kernel、provider adapter 和 UI consumer 共用。
 * - 降级规则单点维护：前端展示与后端 adapter 翻译都调用 `resolveEffectiveEffort`，避免规则漂移。
 */

/**
 * 统一用户语义：思考努力程度档位。
 *
 * 语义从弱到强：off < minimal < low < medium < high < xhigh。
 */
export type ReasoningEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * 运行时枚举真源：所有合法的 ReasoningEffort 值，按从弱到强排序。
 *
 * 用途：`processModelConfig` 等校验方用它判断「用户配置的档位字符串是否合法」，
 * 避免各处手写 6 个字面量集合导致枚举漂移。
 */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

const VALID_REASONING_EFFORTS: ReadonlySet<string> = new Set(REASONING_EFFORTS);

/**
 * 判断字符串是否为合法的 ReasoningEffort 枚举值。
 *
 * 供 host 配置校验方解析原始输入时使用，避免非法档位进入模型注册表。
 */
export function isValidReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && VALID_REASONING_EFFORTS.has(value);
}

/**
 * 模型能力契约：该模型支持哪些思考档位。
 *
 * 可放入 host 的模型配置并透出给需要展示模型能力的 consumer。
 *
 * 字段说明：
 * - `supported_efforts`：该模型支持的档位列表（含是否支持 `off`）。**约定从弱到强排序**，
 *   降级兜底会取首项（最弱档），排序保证兜底行为可预测。
 * - `default_effort`：用户没选时用哪个；不填则取 `medium`（若在 supported 中）或列表首项。
 *
 * 模型是否「支持 reasoning」由 `supported_efforts.length > 0` 推导，不单独加布尔。
 * Provider 的 summary、token budget 和 wire 字段不属于 Linnkit 通用能力契约。
 */
export interface ModelReasoningConfig {
  /** 该模型支持哪些档位（含是否支持 off）。约定从弱到强排序。 */
  supported_efforts: ReasoningEffort[];
  /** 用户没选时用哪个；不填则取 medium（若在 supported 中）或列表首项。 */
  default_effort?: ReasoningEffort;
}

/**
 * 降级链：某档位不在 supported 时，按顺序尝试这些候选档位。
 *
 * 仅对两端的 `xhigh`（向下就近）与 `minimal`（向上就近）显式声明；
 * 中间档位（low/medium/high/off）不在 supported 时，统一走 `['medium']` 兜底（见 downgradeEffort）。
 */
const EFFORT_DOWNGRADE_CHAIN: Partial<Record<ReasoningEffort, ReasoningEffort[]>> = {
  xhigh: ['high', 'medium'],
  minimal: ['low', 'medium'],
};

/**
 * 把用户请求的档位降级到模型实际支持的档位。
 *
 * 规则：
 * 1. 模型无 `reasoning` 契约（或 supported 为空）→ 返回 null，调用方不发任何字段。
 * 2. `requested` 为空 → 取 `default_effort` ??（`medium` 若在 supported 中，否则 supported 首项）。
 * 3. `requested` 在 `supported_efforts` 中 → 原样返回。
 * 4. 不在 → 按 `xhigh→high→medium→首项`、`minimal→low→medium→首项` 降级；其他档位走 `medium→首项`。
 *
 * @param requested 用户请求的档位（null/undefined 表示用户没选）
 * @param config 模型的 reasoning 能力契约（undefined 表示模型无该契约）
 * @returns 已降级的最终档位；null 表示该模型不支持 reasoning，调用方不发任何字段
 */
export function resolveEffectiveEffort(
  requested: ReasoningEffort | null | undefined,
  config: ModelReasoningConfig | undefined,
): ReasoningEffort | null {
  if (!config || config.supported_efforts.length === 0) {
    return null;
  }

  const supported = config.supported_efforts;

  if (requested === null || requested === undefined) {
    if (config.default_effort && supported.includes(config.default_effort)) {
      return config.default_effort;
    }
    if (supported.includes('medium')) {
      return 'medium';
    }
    return supported[0];
  }

  if (supported.includes(requested)) {
    return requested;
  }

  const chain = EFFORT_DOWNGRADE_CHAIN[requested] ?? ['medium'];
  for (const candidate of chain) {
    if (supported.includes(candidate)) {
      return candidate;
    }
  }
  return supported[0];
}
