import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { installRuntimePathRoots } from '../../../../../shared/runtime-paths';
import {
  createSourceDistributionIdentity,
  installDistributionIdentity,
} from '../../../../../shared/distribution-identity';
import { initializeWorkerModelServices } from '../../workerModelServices';
import { modelCatalog } from '../../../../../domains/model-catalog';
import { providerAccountRequestCredentialResolver } from '../../../../../domains/provider-account';

const roots = installRuntimePathRoots(
  z
    .object({
      developmentRoot: z.string(),
      appDataRoot: z.string(),
      profileRoot: z.string(),
      workspaceRoot: z.string(),
      workspaceRootIsCustom: z.boolean(),
    })
    .parse(workerData)
);
const identity = installDistributionIdentity(createSourceDistributionIdentity());
void (async () => {
  await initializeWorkerModelServices({ runtimePathRoots: roots, distributionIdentity: identity });
  const oauth = await providerAccountRequestCredentialResolver.resolve('chatgpt-subscription');
  // 测试消息也只返回匹配结果，不让凭据进入队列结果或诊断日志。
  parentPort?.postMessage({
    keyMatches: modelCatalog.resolveCredential('worker-model') === 'worker-key',
    environmentMatches: modelCatalog.resolveCredential('worker-env-model') === 'worker-env-secret',
    oauthMatches: oauth.access_token === 'worker-token',
  });
})();
