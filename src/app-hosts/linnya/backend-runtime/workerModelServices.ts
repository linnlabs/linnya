import { modelCatalog } from '../../../domains/model-catalog';
import { providerAccountRegistry } from '../../../domains/provider-account';
import type { DistributionIdentity } from '../../../shared/distribution-identity';
import type { RuntimePathRoots } from '../../../shared/runtime-paths';
import { createProfileCredentialStorage } from '../adapters/credential-storage/createProfileCredentialStorage';
import { createLinnyaModelReasoningResolver } from '../adapters/inference';

/** Worker 是独立 JS 运行域，不能依赖 App Server 已安装的进程内端口。 */
export async function initializeWorkerModelServices(input: {
  readonly runtimePathRoots: RuntimePathRoots;
  readonly distributionIdentity: DistributionIdentity;
}): Promise<void> {
  const storage = createProfileCredentialStorage(input.runtimePathRoots);
  modelCatalog.installEndpointCredentialStorage(storage);
  providerAccountRegistry.installCredentialStorage(storage);
  modelCatalog.installModelReasoningResolver(createLinnyaModelReasoningResolver());
  await providerAccountRegistry.initialize();
  await modelCatalog.initialize(input.distributionIdentity);
}
