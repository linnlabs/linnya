import type { UnadmittedModelReasonKind } from '@app/schemas/model-picker';

/** 准入失败的原因类别；与界面共用同一份 wire 枚举，界面据此显示白话说明。 */
export type ModelAdmissionFailureKind = Exclude<UnadmittedModelReasonKind, 'unexpected'>;

/**
 * 模型配置没有通过准入。
 *
 * 类别在抛错处给出：启动时停用的用户模型要向用户解释原因，从错误原文反推类别会随文案改动悄悄失效。
 * 文案仍是给开发者和反馈用的原文，不改变已有调用方对 message 的依赖。
 */
export class ModelAdmissionError extends Error {
  constructor(
    readonly kind: ModelAdmissionFailureKind,
    message: string
  ) {
    super(message);
    this.name = 'ModelAdmissionError';
  }
}
