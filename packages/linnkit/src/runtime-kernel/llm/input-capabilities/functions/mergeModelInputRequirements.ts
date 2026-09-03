import {
  EMPTY_MODEL_INPUT_REQUIREMENT,
  MODEL_INPUT_PLACEMENTS,
  type ModelInputRequirement,
} from '../definitions/modelInputCapability';

/**
 * 合并多个独立来源的模型输入要求，并按框架固定顺序去重 placement。
 *
 * 中文备注：消息附件和工具 schema 是两个事实来源；统一在这里合并，
 * 避免 prepare、caller 和 fallback 各自拼装后产生顺序或语义漂移。
 */
export function mergeModelInputRequirements(
  ...requirements: readonly (ModelInputRequirement | undefined)[]
): ModelInputRequirement {
  const placements = MODEL_INPUT_PLACEMENTS.filter(placement =>
    requirements.some(requirement => requirement?.placements.includes(placement) === true));

  if (placements.length === 0) {
    return EMPTY_MODEL_INPUT_REQUIREMENT;
  }

  return Object.freeze({
    requires_image_input: true,
    placements: Object.freeze(placements),
  });
}
