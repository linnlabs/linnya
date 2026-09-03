import fs from 'node:fs';

import {
  findLanguageInferenceRouteProfileForRoute,
  type LanguageInferenceRouteProfileId,
} from '@app/schemas/model-inference';

import { Logger } from 'src/shared/logger';

import type {
  FunctionalModelDefaults,
  ModelCatalog,
  ModelConfig,
  ModelDiff,
} from '../definitions/modelCatalog';
import type {
  CredentialReference,
  InferenceEndpoint,
  InferenceEndpointSelection,
  InferenceEndpointView,
  EndpointCredentialCodec,
} from '../definitions/inferenceEndpoint';
import { processModelConfig } from '../features/catalog-admission/functions/processModelConfig';
import { fetchCloudModels } from '../features/cloud-catalog/orchestration/fetchCloudModels';
import { isLinnyaCloudClientEnabled } from '../features/cloud-catalog/functions/isLinnyaCloudClientEnabled';
import { resolveDefaultModelsPath } from '../features/default-catalog/functions/resolveDefaultModelsPath';
import { modelPersister } from '../features/user-model-persistence/orchestration/modelPersister';
import { assertEndpointMatchesModel } from '../features/inference-endpoints/functions/assertEndpointMatchesModel';
import { findUnreferencedInferenceEndpoints } from '../features/inference-endpoints/functions/findUnreferencedInferenceEndpoints';
import { readInferenceEndpoint } from '../features/inference-endpoints/functions/readInferenceEndpoint';
import { endpointCredentialStore } from '../features/inference-endpoints/orchestration/endpointCredentialStore';
import {
  requireInstalledDistributionIdentity,
  type DistributionIdentity,
} from '../../../shared/distribution-identity';

const logger = new Logger('ModelCatalog');
const CLOUD_MODEL_RETRY_INTERVAL_MS = 30_000;

export interface CloudModelsLoadedEvent {
  readonly count: number;
  readonly models: ModelConfig[];
}

export type CloudModelsLoadedListener = (event: CloudModelsLoadedEvent) => void;

function processEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === 'string') environment[name] = value;
  }
  return environment;
}

function readModelsEnvelope(value: unknown): unknown[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('default_models.json 必须是对象');
  }
  const models = Reflect.get(value, 'models');
  if (!Array.isArray(models)) throw new Error('default_models.json.models 必须是数组');
  return models;
}

/**
 * 产品模型目录的进程内索引。
 *
 * 它只合并 default、Cloud、account 与 user 四个来源并提供查询/变更事件；具体 Provider 调用、
 * 业务模型选择和 Renderer 状态由各自 owner 负责。
 */
export class ModelCatalogRegistry implements ModelCatalog {
  private static instance: ModelCatalogRegistry | null = null;

  private models = new Map<string, ModelConfig>();
  private readonly accountModelIds = new Map<string, Set<string>>();
  private inferenceEndpoints = new Map<string, InferenceEndpoint>();
  private envVars: Record<string, string> = {};
  private initialized = false;
  private cloudModelRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private cloudModelRetryAttemptCount = 0;
  private cloudModelsLoadedSuccessfully = false;
  private cloudModelLoadInFlight: Promise<boolean> | null = null;
  private readonly cloudModelsLoadedListeners = new Set<CloudModelsLoadedListener>();
  private functionalModelDefaults: FunctionalModelDefaults = {};

  private constructor() {}

  static getInstance(): ModelCatalogRegistry {
    if (!ModelCatalogRegistry.instance) {
      ModelCatalogRegistry.instance = new ModelCatalogRegistry();
    }
    return ModelCatalogRegistry.instance;
  }

  async initialize(distributionIdentity?: DistributionIdentity): Promise<void> {
    if (this.initialized) return;

    this.envVars = processEnvironment();
    await modelPersister.initialize();
    await endpointCredentialStore.initialize();
    const userState = await modelPersister.loadState();
    this.loadInferenceEndpoints(userState.inferenceEndpoints);
    this.loadDefaultModels();

    if (isLinnyaCloudClientEnabled(
      distributionIdentity ?? requireInstalledDistributionIdentity()
    )) {
      const cloudModelsLoaded = await this.loadCloudModels();
      if (!cloudModelsLoaded) this.scheduleCloudModelRetry('启动阶段首次拉取失败');
    } else {
      logger.info('[ModelCatalog] 当前 Desktop 发行身份已关闭 Linnya Cloud 目录');
    }

    this.loadUserModels(userState.models);
    this.initialized = true;
    logger.info(`[ModelCatalog] 初始化完成，共 ${this.models.size} 个模型`);
  }

  getModels(): ModelConfig[] {
    return Array.from(this.models.values());
  }

  getModel(id: string): ModelConfig | undefined {
    return this.models.get(id);
  }

  getInferenceRouteProfileId(modelId: string): LanguageInferenceRouteProfileId | undefined {
    const model = this.models.get(modelId);
    if (!model?.inference_route) return undefined;
    if (model.inference_endpoint_id) {
      return this.inferenceEndpoints.get(model.inference_endpoint_id)?.route_profile_id;
    }
    return findLanguageInferenceRouteProfileForRoute(model.inference_route).id;
  }

  installEndpointCredentialCodec(codec: EndpointCredentialCodec): void {
    endpointCredentialStore.installCodec(codec);
  }

  resolveCredential(modelId: string): string | undefined {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`模型不存在: ${modelId}`);
    const reference = model.inference_endpoint_id
      ? this.requireInferenceEndpoint(model.inference_endpoint_id).credential_reference
      : model.credential_reference;
    return reference ? this.resolveCredentialReference(reference) : undefined;
  }

  getCredentialReference(modelId: string): CredentialReference | undefined {
    const model = this.models.get(modelId);
    if (!model) return undefined;
    return model.inference_endpoint_id
      ? this.inferenceEndpoints.get(model.inference_endpoint_id)?.credential_reference
      : model.credential_reference;
  }

  hasCredential(modelId: string): boolean {
    const model = this.models.get(modelId);
    if (!model) return false;
    const reference = model.inference_endpoint_id
      ? this.inferenceEndpoints.get(model.inference_endpoint_id)?.credential_reference
      : model.credential_reference;
    if (!reference || reference.kind === 'none') return false;
    if (reference.kind === 'environment_variable') {
      return Boolean(this.envVars[reference.environment_variable]?.trim());
    }
    if (reference.kind === 'stored_secret')
      return endpointCredentialStore.has(reference.credential_id);
    return true;
  }

  getInferenceEndpoints(): InferenceEndpointView[] {
    return Array.from(this.inferenceEndpoints.values()).map(endpoint => ({
      ...endpoint,
      credential_status:
        endpoint.credential_reference.kind === 'none'
          ? 'not_required'
          : endpoint.credential_reference.kind === 'stored_secret'
            ? endpointCredentialStore.has(endpoint.credential_reference.credential_id)
              ? 'configured'
              : 'missing'
            : 'configured',
    }));
  }

  async registerUserModel(
    model: ModelConfig,
    selection: InferenceEndpointSelection
  ): Promise<void> {
    if (this.models.has(model.id)) throw new Error(`模型已存在: ${model.id}`);
    const nextEndpoints = new Map(this.inferenceEndpoints);
    let endpoint: InferenceEndpoint;
    let createdCredentialId: string | undefined;
    let replacedCredential:
      | { readonly id: string; readonly previousPlaintext?: string }
      | undefined;

    if (selection.kind === 'existing') {
      endpoint = this.requireInferenceEndpoint(selection.inference_endpoint_id);
      const replacementSecret = selection.credential_secret?.trim();
      if (replacementSecret) {
        if (endpoint.credential_reference.kind !== 'stored_secret') {
          throw new Error(`InferenceEndpoint ${endpoint.id} 不接受本地凭据替换`);
        }
        const credentialId = endpoint.credential_reference.credential_id;
        replacedCredential = {
          id: credentialId,
          previousPlaintext: endpointCredentialStore.has(credentialId)
            ? endpointCredentialStore.resolve(credentialId)
            : undefined,
        };
        await endpointCredentialStore.put(credentialId, replacementSecret);
      } else if (
        endpoint.credential_reference.kind === 'stored_secret' &&
        !endpointCredentialStore.has(endpoint.credential_reference.credential_id)
      ) {
        throw new Error(`InferenceEndpoint ${endpoint.id} 的凭据不可用`);
      }
    } else {
      const input = selection.endpoint;
      if (nextEndpoints.has(input.id)) throw new Error(`InferenceEndpoint 已存在: ${input.id}`);
      const credentialReference: CredentialReference =
        input.credential_reference ??
        (input.auth_profile === 'none'
          ? { kind: 'none' }
          : { kind: 'stored_secret', credential_id: `inference-endpoint:${input.id}` });
      endpoint = readInferenceEndpoint({
        ...input,
        credential_reference: credentialReference,
      });
      if (credentialReference.kind === 'stored_secret') {
        const credentialId = credentialReference.credential_id;
        const credentialSecret = input.credential_secret?.trim();
        const credentialExists = endpointCredentialStore.has(credentialId);
        if (!credentialSecret && !credentialExists) {
          throw new Error('需要认证的 InferenceEndpoint 缺少 credential secret');
        }
        if (credentialSecret) {
          if (credentialExists) {
            replacedCredential = {
              id: credentialId,
              previousPlaintext: endpointCredentialStore.resolve(credentialId),
            };
          } else {
            createdCredentialId = credentialId;
          }
          await endpointCredentialStore.put(credentialId, credentialSecret);
        }
      }
      nextEndpoints.set(endpoint.id, endpoint);
    }

    const processedModel = processModelConfig({
      modelData: {
        ...model,
        credential_reference: undefined,
        inference_endpoint_id: endpoint.id,
      },
      envVars: this.envVars,
    });
    assertEndpointMatchesModel(endpoint, processedModel);
    const nextModels = new Map(this.models);
    nextModels.set(processedModel.id, processedModel);
    try {
      await this.persistUserState(nextModels, nextEndpoints);
    } catch (error: unknown) {
      if (createdCredentialId) await endpointCredentialStore.remove(createdCredentialId);
      if (replacedCredential) {
        if (replacedCredential.previousPlaintext === undefined) {
          await endpointCredentialStore.remove(replacedCredential.id);
        } else {
          await endpointCredentialStore.put(
            replacedCredential.id,
            replacedCredential.previousPlaintext
          );
        }
      }
      throw error;
    }
    this.models = nextModels;
    this.inferenceEndpoints = nextEndpoints;
  }

  replaceAccountModels(accountId: string, models: readonly ModelConfig[]): void {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) throw new Error('Provider account ID 不能为空');

    const nextModels = new Map(this.models);
    for (const modelId of this.accountModelIds.get(normalizedAccountId) ?? []) {
      nextModels.delete(modelId);
    }

    const nextAccountModelIds = new Set<string>();
    for (const modelData of models) {
      const model = processModelConfig({ modelData, envVars: this.envVars });
      if (model.catalog_source !== 'account') {
        throw new Error(`Provider account 模型 ${model.id} 必须声明 catalog_source=account`);
      }
      if (
        model.credential_reference?.kind !== 'provider_account' ||
        model.credential_reference.account_id !== normalizedAccountId
      ) {
        throw new Error(`Provider account 模型 ${model.id} 的 credential reference 不匹配`);
      }
      if (model.inference_endpoint_id) {
        throw new Error(`Provider account 模型 ${model.id} 不得引用用户 InferenceEndpoint`);
      }
      if (nextModels.has(model.id) || nextAccountModelIds.has(model.id)) {
        throw new Error(`Provider account 模型 ID 与现有目录冲突: ${model.id}`);
      }
      nextModels.set(model.id, model);
      nextAccountModelIds.add(model.id);
    }

    this.models = nextModels;
    if (nextAccountModelIds.size > 0) {
      this.accountModelIds.set(normalizedAccountId, nextAccountModelIds);
    } else {
      this.accountModelIds.delete(normalizedAccountId);
    }
  }

  removeAccountModels(accountId: string): void {
    const normalizedAccountId = accountId.trim();
    const modelIds = this.accountModelIds.get(normalizedAccountId);
    if (!modelIds) return;
    for (const modelId of modelIds) this.models.delete(modelId);
    this.accountModelIds.delete(normalizedAccountId);
  }

  async addModel(model: ModelConfig): Promise<void> {
    const nextModels = new Map(this.models);
    const processedModel = processModelConfig({ modelData: model, envVars: this.envVars });
    this.assertModelEndpoint(processedModel);
    nextModels.set(processedModel.id, processedModel);
    await this.commitModelsAndPruneEndpoints(nextModels);
  }

  async updateModel(model: ModelConfig): Promise<void> {
    if (!this.models.has(model.id)) throw new Error(`模型不存在: ${model.id}`);
    const nextModels = new Map(this.models);
    const processedModel = processModelConfig({ modelData: model, envVars: this.envVars });
    this.assertModelEndpoint(processedModel);
    nextModels.set(processedModel.id, processedModel);
    await this.commitModelsAndPruneEndpoints(nextModels);
  }

  async removeModel(id: string): Promise<void> {
    if (!this.models.has(id)) throw new Error(`模型不存在: ${id}`);
    const nextModels = new Map(this.models);
    nextModels.delete(id);
    await this.commitModelsAndPruneEndpoints(nextModels);
  }

  async applyDiff(diff: ModelDiff): Promise<void> {
    const nextModels = new Map(this.models);
    for (const model of diff.added) {
      const processed = processModelConfig({ modelData: model, envVars: this.envVars });
      this.assertModelEndpoint(processed);
      nextModels.set(processed.id, processed);
    }
    for (const model of diff.updated) {
      if (!nextModels.has(model.id)) throw new Error(`模型不存在: ${model.id}`);
      const processed = processModelConfig({ modelData: model, envVars: this.envVars });
      this.assertModelEndpoint(processed);
      nextModels.set(processed.id, processed);
    }
    for (const id of diff.removed) {
      if (!nextModels.delete(id)) throw new Error(`模型不存在: ${id}`);
    }
    await this.commitModelsAndPruneEndpoints(nextModels);
  }

  getModelsByCapability(capability: string): ModelConfig[] {
    return this.getModels().filter(model => model.capabilities.includes(capability));
  }

  getDefaultModelIdByCapability(capability: string): string | undefined {
    const normalizedCapability = capability.trim();
    if (!normalizedCapability) return undefined;
    return this.getModelsByCapability(normalizedCapability)[0]?.id;
  }

  getFunctionalModelDefaults(): FunctionalModelDefaults {
    return { ...this.functionalModelDefaults };
  }

  getFunctionalDefaultModelId(purposeKey: string): string | undefined {
    const normalizedPurposeKey = purposeKey.trim();
    if (!normalizedPurposeKey) return undefined;
    const modelId = this.functionalModelDefaults[normalizedPurposeKey];
    if (!modelId) return undefined;
    return this.getModel(modelId)?.id;
  }

  getModelsByUIVisibility(visibility: string): ModelConfig[] {
    return this.getModels().filter(model => model.ui_visibility.includes(visibility));
  }

  getModelsByTag(tag: string): ModelConfig[] {
    return this.getModels().filter(model => model.tags?.includes(tag) === true);
  }

  areCloudModelsReady(): boolean {
    return this.cloudModelsLoadedSuccessfully;
  }

  hasLoadedCloudModels(): boolean {
    return this.cloudModelsLoadedSuccessfully;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  onCloudModelsLoaded(listener: CloudModelsLoadedListener): () => void {
    this.cloudModelsLoadedListeners.add(listener);
    return () => this.cloudModelsLoadedListeners.delete(listener);
  }

  private loadDefaultModels(): void {
    const modelsPath = resolveDefaultModelsPath();
    const parsed: unknown = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
    const models = readModelsEnvelope(parsed);
    for (const modelData of models) {
      const model = processModelConfig({ modelData, envVars: this.envVars });
      this.models.set(model.id, model);
    }
  }

  private loadInferenceEndpoints(values: readonly unknown[]): void {
    for (const value of values) {
      const endpoint = readInferenceEndpoint(value);
      if (this.inferenceEndpoints.has(endpoint.id)) {
        throw new Error(`重复的 InferenceEndpoint: ${endpoint.id}`);
      }
      this.inferenceEndpoints.set(endpoint.id, endpoint);
    }
  }

  private loadUserModels(userModels: readonly unknown[]): void {
    for (const modelData of userModels) {
      const model = processModelConfig({ modelData, envVars: this.envVars });
      this.assertModelEndpoint(model);
      this.models.set(model.id, model);
    }
  }

  private async commitModelsAndPruneEndpoints(nextModels: Map<string, ModelConfig>): Promise<void> {
    const orphanedEndpoints = findUnreferencedInferenceEndpoints(
      nextModels.values(),
      this.inferenceEndpoints.values()
    );
    const nextEndpoints = new Map(this.inferenceEndpoints);
    const removedCredentials: Array<{ readonly id: string; readonly plaintext: string }> = [];

    try {
      for (const endpoint of orphanedEndpoints) {
        nextEndpoints.delete(endpoint.id);
        if (
          endpoint.credential_reference.kind !== 'stored_secret' ||
          !endpointCredentialStore.has(endpoint.credential_reference.credential_id)
        )
          continue;
        const credentialId = endpoint.credential_reference.credential_id;
        const credentialStillReferenced = Array.from(nextEndpoints.values()).some(
          candidate =>
            candidate.credential_reference.kind === 'stored_secret' &&
            candidate.credential_reference.credential_id === credentialId
        );
        if (credentialStillReferenced) continue;
        const plaintext = endpointCredentialStore.resolve(credentialId);
        await endpointCredentialStore.remove(credentialId);
        removedCredentials.push({ id: credentialId, plaintext });
      }
      await this.persistUserState(nextModels, nextEndpoints);
    } catch (error: unknown) {
      for (const credential of removedCredentials) {
        await endpointCredentialStore.put(credential.id, credential.plaintext);
      }
      throw error;
    }

    this.models = nextModels;
    this.inferenceEndpoints = nextEndpoints;
  }

  private async persistUserState(
    models: Map<string, ModelConfig>,
    inferenceEndpoints: Map<string, InferenceEndpoint>
  ): Promise<void> {
    const userModels = Array.from(models.values()).filter(model => model.catalog_source === 'user');
    await modelPersister.saveState(userModels, Array.from(inferenceEndpoints.values()));
  }

  private requireInferenceEndpoint(endpointId: string): InferenceEndpoint {
    const endpoint = this.inferenceEndpoints.get(endpointId);
    if (!endpoint) throw new Error(`InferenceEndpoint 不存在: ${endpointId}`);
    return endpoint;
  }

  private assertModelEndpoint(model: ModelConfig): void {
    if (model.catalog_source !== 'user') {
      if (model.inference_endpoint_id) {
        throw new Error(`非用户模型 ${model.id} 不得引用用户 InferenceEndpoint`);
      }
      return;
    }
    if (!model.inference_endpoint_id) {
      throw new Error(`用户模型 ${model.id} 必须引用 InferenceEndpoint`);
    }
    assertEndpointMatchesModel(this.requireInferenceEndpoint(model.inference_endpoint_id), model);
  }

  private resolveCredentialReference(reference: CredentialReference): string | undefined {
    switch (reference.kind) {
      case 'none':
        return undefined;
      case 'environment_variable': {
        const secret = this.envVars[reference.environment_variable]?.trim();
        if (!secret) throw new Error(`缺少模型凭据环境变量: ${reference.environment_variable}`);
        return secret;
      }
      case 'stored_secret':
        return endpointCredentialStore.resolve(reference.credential_id);
      case 'provider_account':
        throw new Error(
          `Provider account credential 必须由 Host auth boundary 解析: ${reference.account_id}`
        );
      case 'host_managed':
        return reference.credential_id;
    }
  }

  private async loadCloudModels(): Promise<boolean> {
    if (this.cloudModelLoadInFlight) return this.cloudModelLoadInFlight;
    this.cloudModelLoadInFlight = this.loadCloudModelsInternal();
    try {
      return await this.cloudModelLoadInFlight;
    } finally {
      this.cloudModelLoadInFlight = null;
    }
  }

  private async loadCloudModelsInternal(): Promise<boolean> {
    const result = await fetchCloudModels();
    if (!result.success) {
      logger.warn(`[ModelCatalog] 云端目录加载失败: ${result.failureReason ?? 'unknown'}`);
      return false;
    }

    let cloudModels: ModelConfig[];
    try {
      cloudModels = result.models.map(modelData =>
        processModelConfig({ modelData, envVars: this.envVars })
      );
    } catch (error) {
      logger.error('[ModelCatalog] 云端目录准入失败:', error);
      return false;
    }

    const nextCloudIds = new Set(cloudModels.map(model => model.id));
    for (const [modelId, model] of this.models) {
      if (model.billing_mode === 'cloud' && !nextCloudIds.has(modelId)) this.models.delete(modelId);
    }
    for (const model of cloudModels) this.models.set(model.id, model);

    this.functionalModelDefaults = result.purposeDefaults;
    this.cloudModelsLoadedSuccessfully = true;
    this.cloudModelRetryAttemptCount = 0;
    this.clearCloudModelRetryTimer();
    this.emitCloudModelsLoaded(cloudModels);
    logger.info(`[ModelCatalog] 云端目录加载完成，共 ${cloudModels.length} 个模型`);
    return true;
  }

  private scheduleCloudModelRetry(reason: string): void {
    if (this.cloudModelsLoadedSuccessfully || this.cloudModelRetryTimer) return;
    logger.info(`[ModelCatalog] 云端目录将在 30 秒后重试: ${reason}`);
    this.cloudModelRetryTimer = setTimeout(() => {
      this.cloudModelRetryTimer = null;
      void this.retryLoadCloudModels();
    }, CLOUD_MODEL_RETRY_INTERVAL_MS);
    this.cloudModelRetryTimer.unref?.();
  }

  private async retryLoadCloudModels(): Promise<void> {
    if (this.cloudModelsLoadedSuccessfully) return;
    this.cloudModelRetryAttemptCount += 1;
    const loaded = await this.loadCloudModels();
    if (!loaded) this.scheduleCloudModelRetry(`第 ${this.cloudModelRetryAttemptCount} 次失败`);
  }

  private clearCloudModelRetryTimer(): void {
    if (!this.cloudModelRetryTimer) return;
    clearTimeout(this.cloudModelRetryTimer);
    this.cloudModelRetryTimer = null;
  }

  private emitCloudModelsLoaded(models: ModelConfig[]): void {
    const event: CloudModelsLoadedEvent = { count: models.length, models: [...models] };
    for (const listener of this.cloudModelsLoadedListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.warn('[ModelCatalog] cloudModelsLoaded listener 执行失败:', error);
      }
    }
  }
}

export const modelCatalog = ModelCatalogRegistry.getInstance();
