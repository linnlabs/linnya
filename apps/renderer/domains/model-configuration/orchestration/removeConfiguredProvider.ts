import { deleteConfiguredModel } from './deleteConfiguredModel';

/**
 * 删除一个正式 Provider 的全部已激活模型。
 *
 * 直连 Provider 的 endpoint 与 credential 生命周期由最后一个模型的删除统一收口，
 * 因而这里不直接触碰凭据存储，只编排已有的模型删除用例。
 */
export async function removeConfiguredProvider(
  modelConfigIds: readonly string[],
): Promise<void> {
  for (const modelConfigId of modelConfigIds) {
    await deleteConfiguredModel(modelConfigId);
  }
}
