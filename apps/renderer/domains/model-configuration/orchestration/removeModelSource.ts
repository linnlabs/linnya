import { deleteConfiguredModel } from './deleteConfiguredModel';

/**
 * 删除一个模型来源（正式 Provider 或自定义模型分组）的全部已激活模型。
 *
 * endpoint 与 credential 生命周期由最后一个引用模型的删除统一收口，
 * 因而这里不直接触碰凭据存储，只编排已有的模型删除用例。
 */
export async function removeModelSource(modelConfigIds: readonly string[]): Promise<void> {
  for (const modelConfigId of modelConfigIds) {
    await deleteConfiguredModel(modelConfigId);
  }
}
