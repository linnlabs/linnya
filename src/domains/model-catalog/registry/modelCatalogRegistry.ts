import type { CredentialStoragePort } from 'src/shared/credential-storage';
import fs from 'node:fs';

import type { CustomApiGroup, CustomApiGroupMigration } from '../definitions/customApiGroup';
import type { ModelReasoningResolver } from '../definitions/modelReasoningResolver';
import { projectUserModelForPersistence } from '../features/user-model-persistence/functions/projectUserModelForPersistence';
import { assertCustomApiGroupEndpoints } from '../features/custom-api-groups/functions/customApiGroupState';
import { prepareCustomApiGroupMutation } from '../features/custom-api-groups/orchestration/prepareCustomApiGroupMutation';
import type { CustomApiGroupMutation } from '../features/custom-api-groups/definitions/customApiGroupMutation';

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
  UserModelRegistration,
} from '../definitions/modelCatalog';
import { ModelCatalogConflictError } from '../definitions/modelCatalog';
import type {
  CredentialReference,
  InferenceEndpoint,
  InferenceEndpointSelection,
  InferenceEndpointView,
  EndpointCredentialStatus,
} from '../definitions/inferenceEndpoint';
import { processModelConfig } from '../features/catalog-admission/functions/processModelConfig';
import { fetchCloudModels } from '../features/cloud-catalog/orchestration/fetchCloudModels';
import { isLinnyaCloudClientEnabled } from '../features/cloud-catalog/functions/isLinnyaCloudClientEnabled';
import { resolveDefaultModelsPath } from '../features/default-catalog/functions/resolveDefaultModelsPath';
import { applyCommittedModelChanges } from '../features/user-model-persistence/functions/applyCommittedModelChanges';
import { modelPersister } from '../features/user-model-persistence/orchestration/modelPersister';
import { assertEndpointMatchesModel } from '../features/inference-endpoints/functions/assertEndpointMatchesModel';
import { findUnreferencedInferenceEndpoints } from '../features/inference-endpoints/functions/findUnreferencedInferenceEndpoints';
import { readInferenceEndpoint } from '../features/inference-endpoints/functions/readInferenceEndpoint';
import { prepareInferenceEndpointSelection } from '../features/inference-endpoints';
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
  private userRevision = 0;
  private userMutationTail: Promise<void> = Promise.resolve();
  private readonly accountModelIds = new Map<string, Set<string>>();
  private inferenceEndpoints = new Map<string, InferenceEndpoint>();
  private customApiGroups = new Map<string, CustomApiGroup>();
  private envVars: Record<string, string> = {};
  private initialized = false;
  private initializationStarted = false;
  private modelReasoningResolver: ModelReasoningResolver | undefined;
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
    this.initializationStarted = true;

    this.envVars = processEnvironment();
    await modelPersister.initialize();
    await endpointCredentialStore.initialize();
    const userState = await modelPersister.loadState();
    this.loadInferenceEndpoints(userState.inferenceEndpoints);
    for (const group of userState.customApiGroups) {
      assertCustomApiGroupEndpoints(group, this.inferenceEndpoints);
      this.customApiGroups.set(group.name, group);
    }
    this.loadDefaultModels();

    if (
      isLinnyaCloudClientEnabled(distributionIdentity ?? requireInstalledDistributionIdentity())
    ) {
      const cloudModelsLoaded = await this.loadCloudModels();
      if (!cloudModelsLoaded) this.scheduleCloudModelRetry('启动阶段首次拉取失败');
    } else {
      logger.info('[ModelCatalog] 当前 Desktop 发行身份已关闭 Linnya Cloud 目录');
    }

    this.loadUserModels(userState.models);
    // 旧文件完整通过准入后才覆盖；任何损坏都不能留下半迁移目录。
    if (userState.requiresMigration)
      await this.persistUserState(this.models, this.inferenceEndpoints);
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

  installModelReasoningResolver(resolver: ModelReasoningResolver): void {
    if (this.initializationStarted)
      throw new Error('ModelReasoningResolver 必须在 initialize 前安装');
    this.modelReasoningResolver = resolver;
  }

  installEndpointCredentialStorage(storage: CredentialStoragePort): void {
    endpointCredentialStore.installStorage(storage);
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

  getCredentialStatus(modelId: string): EndpointCredentialStatus | 'missing' {
    const model = this.models.get(modelId);
    if (!model) return 'missing';
    const reference = model.inference_endpoint_id
      ? this.inferenceEndpoints.get(model.inference_endpoint_id)?.credential_reference
      : model.credential_reference;
    if (!reference) return 'missing';
    switch (reference.kind) {
      case 'none':
      case 'provider_account':
      case 'host_managed':
        return 'available';
      case 'environment_variable':
        return this.envVars[reference.environment_variable]?.trim() ? 'available' : 'missing';
      case 'stored_secret':
        return endpointCredentialStore.getStatus(reference.credential_id);
    }
  }

  getInferenceEndpoints(): InferenceEndpointView[] {
    return Array.from(this.inferenceEndpoints.values()).map(endpoint => ({
      ...endpoint,
      credential_status: this.resolveEndpointCredentialStatus(endpoint),
    }));
  }

  getCustomApiGroups(): CustomApiGroup[] {
    return Array.from(this.customApiGroups.values(), group => ({
      name: group.name,
      inference_endpoint_ids: [...group.inference_endpoint_ids],
    }));
  }

  resolveInferenceEndpointCredential(inferenceEndpointId: string): string | undefined {
    return this.resolveCredentialReference(
      this.requireInferenceEndpoint(inferenceEndpointId).credential_reference
    );
  }

  registerCustomApiModels(
    name: string,
    registrations: readonly UserModelRegistration[],
    expectedRevision: number
  ): Promise<void> {
    return this.mutateCustomApiGroup({ kind: 'register', name, registrations }, expectedRevision);
  }

  applyCustomApiGroupModelDiff(
    name: string,
    diff: ModelDiff,
    expectedRevision: number
  ): Promise<void> {
    return this.mutateCustomApiGroup({ kind: 'diff', name, diff }, expectedRevision);
  }

  rebindCustomApiGroup(
    currentName: string,
    name: string,
    models: readonly ModelConfig[],
    endpoint: InferenceEndpointSelection,
    expectedRevision: number
  ): Promise<void> {
    return this.mutateCustomApiGroup(
      { kind: 'rebind', currentName, name, models, endpoint },
      expectedRevision
    );
  }

  removeCustomApiGroup(name: string, expectedRevision: number): Promise<void> {
    return this.mutateCustomApiGroup({ kind: 'remove', name }, expectedRevision);
  }

  migrateCustomApiGroups(
    groups: readonly CustomApiGroupMigration[],
    expectedRevision: number
  ): Promise<void> {
    return this.mutateCustomApiGroup({ kind: 'migrate', groups }, expectedRevision);
  }

  getUserRevision(): number {
    return this.userRevision;
  }

  registerUserModel(model: ModelConfig, selection: InferenceEndpointSelection): Promise<void> {
    return this.registerUserModels([{ model, endpoint: selection }]);
  }

  registerUserModels(
    registrations: readonly UserModelRegistration[],
    expectedRevision?: number
  ): Promise<void> {
    return this.runUserMutation(async () => {
      if (registrations.length === 0) throw new Error('批量注册至少需要一个用户模型');
      const ids = registrations.map(item => item.model.id);
      if (new Set(ids).size !== ids.length || ids.some(id => this.models.has(id))) {
        throw new Error('注册模型 ID 重复或已存在');
      }
      const nextEndpoints = new Map(this.inferenceEndpoints);
      const previousModels = new Map(this.models);
      const nextModels = new Map(previousModels);
      const rollbacks: Array<() => Promise<void>> = [];
      try {
        for (const { model, endpoint } of registrations) {
          const prepared = await prepareInferenceEndpointSelection(endpoint, nextEndpoints);
          rollbacks.push(prepared.rollback);
          const processed = this.bindUserModelToEndpoint(model, prepared.endpoint);
          nextModels.set(processed.id, processed);
        }
        await this.persistUserState(nextModels, nextEndpoints);
      } catch (error: unknown) {
        // 与准备顺序相反撤销，保证共享凭据被多次替换时也恢复到原始版本。
        for (const rollback of rollbacks.reverse()) await rollback();
        throw error;
      }
      this.models = applyCommittedModelChanges(this.models, previousModels, nextModels);
      this.inferenceEndpoints = nextEndpoints;
    }, expectedRevision);
  }

  async rebindUserModels(
    models: readonly ModelConfig[],
    selection: InferenceEndpointSelection,
    expectedRevision?: number
  ): Promise<void> {
    return this.runUserMutation(async () => {
      if (models.length === 0) throw new Error('改绑 InferenceEndpoint 至少需要一个用户模型');
      if (new Set(models.map(model => model.id)).size !== models.length) {
        throw new Error('改绑 InferenceEndpoint 的模型 ID 不能重复');
      }
      for (const model of models) {
        if (this.models.get(model.id)?.catalog_source !== 'user') {
          throw new Error(`用户模型不存在: ${model.id}`);
        }
      }
      const nextEndpoints = new Map(this.inferenceEndpoints);
      const prepared = await prepareInferenceEndpointSelection(selection, nextEndpoints);
      try {
        const nextModels = new Map(this.models);
        for (const model of models) {
          const processedModel = this.bindUserModelToEndpoint(model, prepared.endpoint);
          nextModels.set(processedModel.id, processedModel);
        }
        await this.commitModelsAndPruneEndpoints(nextModels, nextEndpoints);
      } catch (error: unknown) {
        await prepared.rollback();
        throw error;
      }
    }, expectedRevision);
  }

  async replaceInferenceEndpointCredential(
    inferenceEndpointId: string,
    credentialSecret: string
  ): Promise<void> {
    return this.runUserMutation(async () => {
      const endpoint = this.requireInferenceEndpoint(inferenceEndpointId);
      if (endpoint.credential_reference.kind !== 'stored_secret') {
        throw new Error(`InferenceEndpoint ${endpoint.id} 不接受本地凭据替换`);
      }
      const secret = credentialSecret.trim();
      if (!secret) throw new Error('替换的 credential secret 不能为空');
      // 凭据文件自身原子写入；共享同一 credential 的 endpoint 一并生效，目录文件无需变化。
      await endpointCredentialStore.put(endpoint.credential_reference.credential_id, secret);
    });
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
      const model = processModelConfig({
        modelData,
        envVars: this.envVars,
        reasoningResolver: this.modelReasoningResolver,
      });
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
    return this.runUserMutation(async () => {
      const nextModels = new Map(this.models);
      const processedModel = processModelConfig({
        modelData: model,
        envVars: this.envVars,
        reasoningResolver: this.modelReasoningResolver,
      });
      this.assertModelEndpoint(processedModel);
      nextModels.set(processedModel.id, processedModel);
      await this.commitModelsAndPruneEndpoints(nextModels);
    });
  }

  async updateModel(model: ModelConfig): Promise<void> {
    return this.runUserMutation(async () => {
      if (!this.models.has(model.id)) throw new Error(`模型不存在: ${model.id}`);
      const nextModels = new Map(this.models);
      const processedModel = processModelConfig({
        modelData: model,
        previousModel: this.models.get(model.id),
        envVars: this.envVars,
        reasoningResolver: this.modelReasoningResolver,
      });
      this.assertModelEndpoint(processedModel);
      nextModels.set(processedModel.id, processedModel);
      await this.commitModelsAndPruneEndpoints(nextModels);
    });
  }

  async removeModel(id: string): Promise<void> {
    return this.runUserMutation(async () => {
      if (!this.models.has(id)) throw new Error(`模型不存在: ${id}`);
      const nextModels = new Map(this.models);
      nextModels.delete(id);
      await this.commitModelsAndPruneEndpoints(nextModels);
    });
  }

  async applyDiff(diff: ModelDiff, expectedRevision?: number): Promise<void> {
    return this.runUserMutation(async () => {
      const nextModels = new Map(this.models);
      for (const model of diff.added) {
        const processed = processModelConfig({
          modelData: model,
          envVars: this.envVars,
          reasoningResolver: this.modelReasoningResolver,
        });
        this.assertModelEndpoint(processed);
        nextModels.set(processed.id, processed);
      }
      for (const model of diff.updated) {
        if (!nextModels.has(model.id)) throw new Error(`模型不存在: ${model.id}`);
        const processed = processModelConfig({
          modelData: model,
          previousModel: nextModels.get(model.id),
          envVars: this.envVars,
          reasoningResolver: this.modelReasoningResolver,
        });
        this.assertModelEndpoint(processed);
        nextModels.set(processed.id, processed);
      }
      for (const id of diff.removed) {
        if (!nextModels.delete(id)) throw new Error(`模型不存在: ${id}`);
      }
      await this.commitModelsAndPruneEndpoints(nextModels);
    }, expectedRevision);
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
      const model = processModelConfig({
        modelData,
        envVars: this.envVars,
        reasoningResolver: this.modelReasoningResolver,
      });
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
      const model = processModelConfig({
        modelData,
        envVars: this.envVars,
        reasoningResolver: this.modelReasoningResolver,
      });
      this.assertModelEndpoint(model);
      this.models.set(model.id, model);
    }
  }

  /** 从读取当前目录到凭据/文件提交都串行，失败后下一条事务仍可继续。 */
  private runUserMutation(
    operation: () => Promise<void | boolean>,
    expectedRevision?: number
  ): Promise<void> {
    const result = this.userMutationTail.then(async () => {
      // 在目录事务内部校验，检查与提交之间不能插入另一个编辑或删除。
      if (expectedRevision !== undefined && expectedRevision !== this.userRevision) {
        throw new ModelCatalogConflictError();
      }
      const changed = await operation();
      if (changed !== false) this.userRevision += 1;
    });
    this.userMutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private mutateCustomApiGroup(
    mutation: CustomApiGroupMutation,
    expectedRevision: number
  ): Promise<void> {
    return this.runUserMutation(async () => {
      // 凭据准备可能让出执行权；发布时必须与准备前快照比较，保留期间更新的账号/Cloud 投影。
      const previousModels = new Map(this.models);
      const prepared = await prepareCustomApiGroupMutation(
        mutation,
        {
          models: previousModels,
          endpoints: this.inferenceEndpoints,
          groups: this.customApiGroups,
        },
        (model, endpoint) => this.bindUserModelToEndpoint(model, endpoint)
      );
      if (!prepared.changed) return false;
      try {
        await this.commitModelsAndPruneEndpoints(
          prepared.models,
          prepared.endpoints,
          prepared.groups,
          previousModels
        );
      } catch (error: unknown) {
        await prepared.rollback();
        throw error;
      }
      return true;
    }, expectedRevision);
  }

  private async commitModelsAndPruneEndpoints(
    nextModels: Map<string, ModelConfig>,
    baseEndpoints: ReadonlyMap<string, InferenceEndpoint> = this.inferenceEndpoints,
    nextGroups: ReadonlyMap<string, CustomApiGroup> = this.customApiGroups,
    previousModels: ReadonlyMap<string, ModelConfig> = new Map(this.models)
  ): Promise<void> {
    const orphanedEndpoints = findUnreferencedInferenceEndpoints(
      nextModels.values(),
      baseEndpoints.values(),
      nextGroups.values()
    );
    const nextEndpoints = new Map(baseEndpoints);
    const credentialRollbacks: Array<() => Promise<void>> = [];

    try {
      for (const endpoint of orphanedEndpoints) {
        nextEndpoints.delete(endpoint.id);
        if (endpoint.credential_reference.kind !== 'stored_secret') continue;
        const credentialId = endpoint.credential_reference.credential_id;
        const credentialStillReferenced = Array.from(nextEndpoints.values()).some(
          candidate =>
            candidate.credential_reference.kind === 'stored_secret' &&
            candidate.credential_reference.credential_id === credentialId
        );
        if (credentialStillReferenced) continue;
        const rollback = endpointCredentialStore.captureRollback(credentialId);
        await endpointCredentialStore.remove(credentialId);
        credentialRollbacks.push(rollback);
      }
      await this.persistUserState(nextModels, nextEndpoints, nextGroups);
    } catch (error: unknown) {
      for (const rollback of credentialRollbacks.reverse()) await rollback();
      throw error;
    }

    this.models = applyCommittedModelChanges(this.models, previousModels, nextModels);
    this.inferenceEndpoints = nextEndpoints;
    this.customApiGroups = new Map(nextGroups);
  }

  /** 用户模型只能引用一个 endpoint；route 身份必须与该 endpoint 完全一致。 */
  private bindUserModelToEndpoint(model: ModelConfig, endpoint: InferenceEndpoint): ModelConfig {
    const processedModel = processModelConfig({
      previousModel: this.models.get(model.id),
      modelData: {
        ...model,
        credential_reference: undefined,
        inference_endpoint_id: endpoint.id,
      },
      envVars: this.envVars,
      reasoningResolver: this.modelReasoningResolver,
    });
    if (processedModel.catalog_source !== 'user') {
      throw new Error(`模型 ${processedModel.id} 必须声明 catalog_source=user`);
    }
    assertEndpointMatchesModel(endpoint, processedModel);
    return processedModel;
  }

  private async persistUserState(
    models: Map<string, ModelConfig>,
    inferenceEndpoints: Map<string, InferenceEndpoint>,
    groups: ReadonlyMap<string, CustomApiGroup> = this.customApiGroups
  ): Promise<void> {
    const userModels = Array.from(models.values())
      .filter(model => model.catalog_source === 'user')
      .map(model => projectUserModelForPersistence(model, this.modelReasoningResolver));
    await modelPersister.saveState(
      userModels,
      Array.from(inferenceEndpoints.values()),
      Array.from(groups.values())
    );
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

  private resolveEndpointCredentialStatus(
    endpoint: InferenceEndpoint
  ): InferenceEndpointView['credential_status'] {
    if (endpoint.credential_reference.kind === 'none') return 'not_required';
    if (endpoint.credential_reference.kind !== 'stored_secret') return 'configured';
    const status = endpointCredentialStore.getStatus(endpoint.credential_reference.credential_id);
    if (status === 'available') return 'configured';
    return 'missing';
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
        processModelConfig({
          modelData,
          envVars: this.envVars,
          reasoningResolver: this.modelReasoningResolver,
        })
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
