import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CanonicalInferencePort } from '@linnlabs/linnkit/ports';
import type { llm } from '@linnlabs/linnkit/runtime-kernel';
import type { ScriptedLlmCall } from '@linnlabs/linnkit/testkit';
import { modelCatalog } from 'src/domains/model-catalog';
import { providerAccountRegistry } from 'src/domains/provider-account';
import { providerConfigurationRegistry } from 'src/domains/provider-configuration';
import { resetWorkspaceRootToDefault, setWorkspaceRoot } from 'src/shared/utils/pathManager';
import { createProfileCredentialStorage } from '../../credential-storage/createProfileCredentialStorage';
import { createDefaultHostInferencePort, createLinnyaModelReasoningResolver } from '../../inference';
import { createDefaultLlmCaller } from '../../runtime-assembly/graphRuntimeFactory';

/** 打开真实模型核对的开关；不设置时相关测试跳过，CI 与日常测试不会调用上游。 */
export const REAL_MODEL_TEST_ENV = 'LINNYA_REAL_MODEL_TEST';

/** Flow 场景需要的推理对象：生产调用链，外加按调用记录模型实际收到的消息。 */
export interface RecordedRealModelInference {
  readonly modelId: string;
  readonly usesProductionCatalog: true;
  getLlmCaller(): llm.LlmCaller;
  getCalls(): ScriptedLlmCall[];
  /** 已发出的模型调用次数，与脚本模型同名方法口径一致。 */
  getConsumedTurnCount(): number;
  assertAllTurnsConsumed(): void;
}

/**
 * 用一个开发实例已经配置好的模型与凭据装配生产模型目录。
 *
 * - 模型与 Provider 配置（不含密钥）复制进临时 workspace，测试不会改动开发实例的配置；
 * - 凭据由 Linnya 凭据存储直接从开发 profile 读取，初始化只读，不复制、不输出。
 */
export async function installDevelopmentModelServices(input: {
  readonly instanceRoot: string;
  readonly workspaceRoot: string;
}): Promise<() => void> {
  const sourceModels = join(input.instanceRoot, '_dev_data', 'Models');
  const profileRoot = join(input.instanceRoot, '_dev_electron');
  if (!existsSync(join(sourceModels, 'user_models.json'))) {
    throw new Error(`[realModel] ${sourceModels} 没有模型配置；先在这个开发实例里配置模型`);
  }
  // 与源码 CLI Runtime / e2e 一致：默认模型目录用当前 checkout 的源码文件。
  process.env.MODEL_REGISTRY_DEFAULTS_PATH ??= join(
    input.instanceRoot, 'src/domains/model-catalog/features/default-catalog/assets/default_models.json',
  );
  setWorkspaceRoot(input.workspaceRoot);
  const models = join(input.workspaceRoot, 'Models');
  mkdirSync(models, { recursive: true });
  for (const file of ['user_models.json', 'provider_configurations.json']) {
    if (existsSync(join(sourceModels, file))) copyFileSync(join(sourceModels, file), join(models, file));
  }
  const storage = createProfileCredentialStorage({
    developmentRoot: input.instanceRoot,
    appDataRoot: input.workspaceRoot,
    profileRoot,
    workspaceRoot: input.workspaceRoot,
    workspaceRootIsCustom: true,
  });
  modelCatalog.installEndpointCredentialStorage(storage);
  providerAccountRegistry.installCredentialStorage(storage);
  modelCatalog.installModelReasoningResolver(createLinnyaModelReasoningResolver());
  await providerAccountRegistry.initialize();
  await modelCatalog.initialize();
  // 与生产启动接线一致：停用的用户模型也算存在，临时副本里的 Provider 归属不被对账删掉。
  await providerConfigurationRegistry.initialize({
    models: modelCatalog.getModelIdentitiesIncludingUnadmitted(),
  });
  return () => {
    resetWorkspaceRootToDefault();
  };
}

/** 按 Provider 侧模型名找到开发实例里的模型配置 ID，例如 `deepseek-v4.1-flash`。 */
export function findConfiguredModelId(providerModelId: string): string | undefined {
  for (const provider of providerConfigurationRegistry.list()) {
    const match = provider.models.find(model => model.provider_model_id === providerModelId);
    if (match) return match.model_config_id;
  }
  return undefined;
}

/** 生产 LlmCaller 与推理端口，只在外面包一层记录。 */
export function createRecordedRealModelInference(modelId: string): RecordedRealModelInference {
  const calls: ScriptedLlmCall[] = [];
  const production = createDefaultHostInferencePort();
  const inferencePort: CanonicalInferencePort = {
    stream(request) {
      calls.push({ request, modelId: request.model_id, messages: request.messages, options: {} });
      return production.stream(request);
    },
  };
  const llmCaller = createDefaultLlmCaller({ inferencePort });
  return {
    modelId,
    usesProductionCatalog: true,
    getLlmCaller: () => llmCaller,
    getCalls: () => [...calls],
    getConsumedTurnCount: () => calls.length,
    assertAllTurnsConsumed: () => undefined,
  };
}
