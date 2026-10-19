import type { ProviderConnectionLookup } from '../../../definitions/providerConfiguration';
import { createProviderConnectionLookup } from '../functions/createProviderConnectionLookup';
import { fileProviderConfigurationRepository } from './fileProviderConfigurationRepository';

/**
 * 独立 Worker 在启动时冻结已提交的归属；intent 恢复和配置写入始终由 App Server 拥有。
 * 返回窄 lookup，避免消费方自行解释快照或误调用 Registry 的写入流程。
 */
export async function readProviderConnectionLookup(): Promise<ProviderConnectionLookup> {
  const snapshot = await fileProviderConfigurationRepository.readSnapshot();
  return createProviderConnectionLookup(snapshot);
}
