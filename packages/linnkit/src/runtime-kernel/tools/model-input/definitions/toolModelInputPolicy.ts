import type { ModelInputRequirement } from '../../../llm/input-capabilities';

/**
 * 工具结果模型输入的交付语义。
 *
 * `required` 表示附件是工具业务结果的一部分，当前模型不兼容时必须拒绝工具；
 * `when_supported` 表示附件只是成功结果的增强反馈，不兼容时工具仍可返回文本结果。
 */
export type ToolModelInputDelivery = 'required' | 'when_supported';

/** ToolNode 在真实 active model 上完成的本次调用准入事实。 */
export interface ToolModelInputAdmission {
  readonly requirement: ModelInputRequirement;
  readonly delivery: ToolModelInputDelivery;
  readonly admitted: boolean;
}
