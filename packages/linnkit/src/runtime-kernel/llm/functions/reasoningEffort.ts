/**
 * @file reasoningEffort.ts
 *
 * @description
 * runtime-kernel 对 contracts/reasoning 的 re-export 门面。
 * 真源已迁至 `packages/linnkit/src/contracts/reasoning.ts`，供浏览器与 Node 共用。
 * 走 contracts barrel（../contracts），避免跨子模块 deep import 触发 agent-boundary guard。
 */
export type { ReasoningEffort, ModelReasoningConfig } from '../../../contracts';
export {
  REASONING_EFFORTS,
  isValidReasoningEffort,
  resolveEffectiveEffort,
} from '../../../contracts';
