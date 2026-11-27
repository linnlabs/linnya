import type { CredentialStoragePort } from 'src/shared/credential-storage';
import fs from 'node:fs';

import type { CustomApiGroup, CustomApiGroupMigration } from '../definitions/customApiGroup';
import type { ModelReasoningResolver } from '../definitions/modelReasoningResolver';
import { projectUserModelForPersistence } from '../features/user-model-persistence/functions/projectUserModelForPersistence';
import { partitionStoredUserModels } from '../features/user-model-persistence/functions/partitionStoredUserModels';
import { projectUnadmittedUserModels } from '../features/user-model-persistence/functions/projectUnadmittedUserModels';
import type { UnadmittedUserModelEntry } from '../features/user-model-persistence/definitions/userModelsFile';
import { assertCustomApiGroupEndpoints } from '../features/custom-api-groups/functions/customApiGroupState';
import { prepareCustomApiGroupMutation } from '../features/custom-api-groups/orchestration/prepareCustomApiGroupMutation';
import type { CustomApiGroupMutation } from '../features/custom-api-groups/definitions/customApiGroupMutation';

import {
  LANGUAGE_INFERENCE_ROUTE_PROFILES,
  findLanguageInferenceRouteProfileForRoute,
  type LanguageInferenceRouteProfileId,
} from '@app/schemas/model-inference';

import { Logger } from 'src/shared/logger';

import type {
  ModelCatalog,
  ModelConfig,
  ModelDiff,
  UnadmittedUserModel,
  UserModelRegistration,
} from '../definitions/modelCatalog';
import { ModelCatalogConflictError } from '../definitions/modelCatalog';
import { ModelAdmissionError } from '../definitions/modelAdmissionError';
import type {
  CredentialReference,
  InferenceEndpoint,
  InferenceEndpointSelection,
  InferenceEndpointView,
  EndpointCredentialStatus,
} from '../definitions/inferenceEndpoint';
import { processModelConfig } from '../features/catalog-admission/functions/processModelConfig';
import { resolveDefaultModelsPath } from '../features/default-catalog/functions/resolveDefaultModelsPath';
import { applyCommittedModelChanges } from '../features/user-model-persistence/functions/applyCommittedModelChanges';
import { modelPersister } from '../features/user-model-persistence/orchestration/modelPersister';
import { assertEndpointMatchesModel } from '../features/inference-endpoints/functions/assertEndpointMatchesModel';
import { findUnreferencedInferenceEndpoints } from '../features/inference-endpoints/functions/findUnreferencedInferenceEndpoints';
import { readInferenceEndpoint } from '../features/inference-endpoints/functions/readInferenceEndpoint';
import { prepareInferenceEndpointSelection } from '../features/inference-endpoints';
import { endpointCredentialStore } from '../features/inference-endpoints/orchestration/endpointCredentialStore';

const logger = new Logger('ModelCatalog');

/** 用户目录事务已经写盘并更新内存后才发出；只是失效信号，读方重新读取目录。 */
export interface UserModelCatalogChangedEvent {
  readonly revision: number;
}

export type UserModelCatalogChangedListener = (event: UserModelCatalogChangedEvent) => void;

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
 * 它只合并 default、account 与 user 三个来源并提供查询/变更事件；具体 Provider 调用、
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
  private unadmittedUserModels: readonly UnadmittedUserModelEntry[] = [];
  private envVars: Record<string, string> = {};
  private initialized = false;
  private initializationStarted = false;
  /** 进行中的初始化；结束（成功或失败）后清空，失败后的下一次调用重新载入。 */
  private initialization: Promise<void> | null = null;
  /**
   * 旧版文件在连接与分组全部通过准入后，初始化会回写一次迁移结果（停用的模型条目原样带入）；
   * 除此之外，未初始化成功时禁止写用户配置。
   */
  private persistingInitialState = false;
  private modelReasoningResolver: ModelReasoningResolver | undefined;
  private readonly userModelCatalogChangedListeners = new Set<UserModelCatalogChangedListener>();

  private constructor() {}

  static getInstance(): ModelCatalogRegistry {
    if (!ModelCatalogRegistry.instance) {
      ModelCatalogRegistry.instance = new ModelCatalogRegistry();
    }
    return ModelCatalogRegistry.instance;
  }

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    // 并发调用共用同一次初始化：各自载入会互相撞“重复连接”，失败那次的回滚还会清掉成功那次的结果。
    this.initialization ??= this.runInitialization().finally(() => {
      this.initialization = null;
    });
    return this.initialization;
  }

  private async runInitialization(): Promise<void> {
    this.initializationStarted = true;
    // 失败要回到初始化前：半截载入的连接、分组或模型会让再次初始化报“重复”，掩盖真正的原因。
    const restoreBeforeInitialization = this.captureInitializationRollback();
    try {
      await this.loadInitialSources();
    } catch (error: unknown) {
      restoreBeforeInitialization();
      throw error;
    }
    this.initialized = true;
    logger.info(
      `[ModelCatalog] 初始化完成，共 ${this.models.size} 个模型` +
        (this.unadmittedUserModels.length > 0
          ? `，${this.unadmittedUserModels.length} 个用户模型未通过准入已停用`
          : '')
    );
  }

  private async loadInitialSources(): Promise<void> {
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
    this.loadUserModels(userState.models);
    // 连接与分组全部通过准入后才覆盖旧文件；未通过准入的模型条目原样带入新文件，不会因迁移丢失。
    if (userState.requiresMigration) {
      this.persistingInitialState = true;
      try {
        await this.persistUserState(this.models, this.inferenceEndpoints);
      } finally {
        this.persistingInitialState = false;
      }
    }
  }

  private captureInitializationRollback(): () => void {
    const models = new Map(this.models);
    const inferenceEndpoints = new Map(this.inferenceEndpoints);
    const customApiGroups = new Map(this.customApiGroups);
    const unadmittedUserModels = this.unadmittedUserModels;
    return () => {
      this.models = models;
      this.inferenceEndpoints = inferenceEndpoints;
      this.customApiGroups = customApiGroups;
      this.unadmittedUserModels = unadmittedUserModels;
    };
  }

  /**
   * 启动时未通过准入而停用的用户模型；只给身份、归属、显示名与原因，不给原始配置。
   * Provider 接入用例据此区分“停用成员”与“归属悬空”（配置损坏），模型设置据此列出可删除、可修复的条目。
   */
  getUnadmittedUserModels(): UnadmittedUserModel[] {
    return projectUnadmittedUserModels(this.unadmittedUserModels, this.customApiGroups.values());
  }

  /**
   * 运行目录里的模型身份，加上停用但仍保留在用户文件里的条目。
   * Provider 归属、选择器偏好等启动对账以它判断“模型是否已被删除”；只用运行目录会把停用模型的归属一并删掉。
   */
  getModelIdentitiesIncludingUnadmitted(): Array<{
    id: string;
    inference_endpoint_id: string | undefined;
  }> {
    return [
      ...this.getModels().map(model => ({
        id: model.id,
        inference_endpoint_id: model.inference_endpoint_id,
      })),
      ...this.unadmittedUserModels.flatMap(entry =>
        entry.id ? [{ id: entry.id, inference_endpoint_id: entry.inferenceEndpointId }] : []
      ),
    ];
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
      const profileId = this.inferenceEndpoints.get(model.inference_endpoint_id)?.route_profile_id;
      return LANGUAGE_INFERENCE_ROUTE_PROFILES.find(profile => profile.id === profileId)?.id;
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
        await this.commitModelsAndPruneEndpoints({ models: nextModels, endpoints: nextEndpoints });
      } catch (error: unknown) {
        await prepared.rollback();
        throw error;
      }
    }, expectedRevision);
  }

  /**
   * 用一条已准入的模型替换同 ID 的停用条目（正式 Provider 按当前定义修复）。
   *
   * 同一事务里移除原始条目、准备连接并写盘：原条目引用的连接若因此无人引用，连同独占凭据一起回收；
   * 写盘失败时撤销本次凭据变更，内存仍是修复前的状态。只接受停用条目的 ID，不能借此覆盖已准入模型。
   */
  replaceUnadmittedUserModel(
    model: ModelConfig,
    selection: InferenceEndpointSelection
  ): Promise<void> {
    return this.runUserMutation(async () => {
      const unadmitted = this.unadmittedUserModels.filter(entry => entry.id !== model.id);
      if (this.models.has(model.id) || unadmitted.length === this.unadmittedUserModels.length) {
        throw new Error(`停用的用户模型不存在: ${model.id}`);
      }
      const nextEndpoints = new Map(this.inferenceEndpoints);
      const prepared = await prepareInferenceEndpointSelection(selection, nextEndpoints);
      try {
        const nextModels = new Map(this.models);
        const processedModel = this.bindUserModelToEndpoint(model, prepared.endpoint);
        nextModels.set(processedModel.id, processedModel);
        await this.commitModelsAndPruneEndpoints({
          models: nextModels,
          endpoints: nextEndpoints,
          unadmitted,
        });
      } catch (error: unknown) {
        await prepared.rollback();
        throw error;
      }
    });
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
      await this.commitModelsAndPruneEndpoints({ models: nextModels });
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
      await this.commitModelsAndPruneEndpoints({ models: nextModels });
    });
  }

  /**
   * 删除一个模型 ID：运行目录里的模型，以及文件里同 ID 的停用条目（启动时未通过准入）。
   * 停用条目不能选择，但仍是用户数据，删除入口与已准入模型相同；它的连接与独占凭据在无人引用时同一事务回收。
   */
  async removeModel(id: string): Promise<void> {
    return this.runUserMutation(async () => {
      const unadmitted = this.unadmittedUserModels.filter(entry => entry.id !== id);
      if (!this.models.has(id) && unadmitted.length === this.unadmittedUserModels.length) {
        throw new Error(`模型不存在: ${id}`);
      }
      const nextModels = new Map(this.models);
      nextModels.delete(id);
      await this.commitModelsAndPruneEndpoints({ models: nextModels, unadmitted });
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
      await this.commitModelsAndPruneEndpoints({ models: nextModels });
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

  getModelsByUIVisibility(visibility: string): ModelConfig[] {
    return this.getModels().filter(model => model.ui_visibility.includes(visibility));
  }

  getModelsByTag(tag: string): ModelConfig[] {
    return this.getModels().filter(model => model.tags?.includes(tag) === true);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** 任何入口（设置页、CLI、外部 HTTP）提交的用户目录变更都经过这里，供 Host 推送目录失效。 */
  onUserModelCatalogChanged(listener: UserModelCatalogChangedListener): () => void {
    this.userModelCatalogChangedListeners.add(listener);
    return () => this.userModelCatalogChangedListeners.delete(listener);
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

  /** 单个用户模型准入失败只停用它：其余模型照常可用，原条目留在文件里，它的连接与凭据不回收。 */
  private loadUserModels(userModels: readonly unknown[]): void {
    const { admitted, unadmitted } = partitionStoredUserModels(userModels, modelData => {
      const model = processModelConfig({
        modelData,
        envVars: this.envVars,
        reasoningResolver: this.modelReasoningResolver,
      });
      this.assertModelEndpoint(model);
      return model;
    });
    for (const model of admitted) this.models.set(model.id, model);
    for (const { entry, error } of unadmitted) {
      // 带上错误对象：准入失败与代码本身出错的文案可能相似，调用栈才分得清。
      logger.warn(
        `[ModelCatalog] 用户模型 ${entry.id ?? '(缺少 ID)'} 没有通过准入，已停用；原配置保留在 user_models.json: ${entry.reason}`,
        error
      );
    }
    this.unadmittedUserModels = unadmitted.map(({ entry }) => entry);
  }

  /** 从读取当前目录到凭据/文件提交都串行，失败后下一条事务仍可继续。 */
  private runUserMutation(
    operation: () => Promise<void | boolean>,
    expectedRevision?: number
  ): Promise<void> {
    const result = this.userMutationTail.then(async () => {
      // 初始化没有成功时连凭据也不准备：写入会以不完整的内存状态覆盖用户原有配置。
      this.assertUserConfigurationWritable();
      // 在目录事务内部校验，检查与提交之间不能插入另一个编辑或删除。
      if (expectedRevision !== undefined && expectedRevision !== this.userRevision) {
        throw new ModelCatalogConflictError();
      }
      const changed = await operation();
      if (changed === false) return;
      this.userRevision += 1;
      // 事务体在写盘成功后才替换内存目录；此处通知时读方已能读到提交后的状态。
      this.emitUserModelCatalogChanged({ revision: this.userRevision });
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
      // 凭据准备可能让出执行权；发布时必须与准备前快照比较，保留期间更新的账号投影。
      const previousModels = new Map(this.models);
      const prepared = await prepareCustomApiGroupMutation(
        mutation,
        {
          models: previousModels,
          endpoints: this.inferenceEndpoints,
          groups: this.customApiGroups,
          unadmitted: this.unadmittedUserModels,
        },
        (model, endpoint) => this.bindUserModelToEndpoint(model, endpoint)
      );
      if (!prepared.changed) return false;
      try {
        await this.commitModelsAndPruneEndpoints({
          models: prepared.models,
          endpoints: prepared.endpoints,
          groups: prepared.groups,
          previousModels,
          unadmitted: prepared.unadmitted,
        });
      } catch (error: unknown) {
        await prepared.rollback();
        throw error;
      }
      return true;
    }, expectedRevision);
  }

  /**
   * 提交一次用户目录变更：按下一版本的模型、分组与停用条目计算无人引用的连接，回收它们与独占凭据，再一次写盘。
   * 写盘成功后才替换内存；失败时撤销凭据删除，内存（含停用条目）保持事务前的状态。
   */
  private async commitModelsAndPruneEndpoints(next: {
    readonly models: Map<string, ModelConfig>;
    readonly endpoints?: ReadonlyMap<string, InferenceEndpoint>;
    readonly groups?: ReadonlyMap<string, CustomApiGroup>;
    readonly previousModels?: ReadonlyMap<string, ModelConfig>;
    /** 只有删除或修复停用条目的事务才传入；其余事务原样保留当前停用条目。 */
    readonly unadmitted?: readonly UnadmittedUserModelEntry[];
  }): Promise<void> {
    const nextModels = next.models;
    const baseEndpoints = next.endpoints ?? this.inferenceEndpoints;
    const nextGroups = next.groups ?? this.customApiGroups;
    const previousModels = next.previousModels ?? new Map(this.models);
    const nextUnadmitted = next.unadmitted ?? this.unadmittedUserModels;
    const orphanedEndpoints = findUnreferencedInferenceEndpoints(
      nextModels.values(),
      baseEndpoints.values(),
      nextGroups.values(),
      nextUnadmitted.flatMap(entry => entry.inferenceEndpointId ?? [])
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
      await this.persistUserState(nextModels, nextEndpoints, nextGroups, nextUnadmitted);
    } catch (error: unknown) {
      for (const rollback of credentialRollbacks.reverse()) await rollback();
      throw error;
    }

    this.models = applyCommittedModelChanges(this.models, previousModels, nextModels);
    this.inferenceEndpoints = nextEndpoints;
    this.customApiGroups = new Map(nextGroups);
    this.unadmittedUserModels = nextUnadmitted;
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

  private assertUserConfigurationWritable(): void {
    if (this.initialized) return;
    // 启动时目录没有初始化成功（例如用户配置文件损坏）：内存里只有不完整的状态，
    // 写回会覆盖用户原有的模型配置。保持原文件不动，等问题解决后重新启动。
    throw new Error('模型目录在启动时没有初始化成功，暂时不能保存模型配置；原配置文件保持不变');
  }

  private async persistUserState(
    models: Map<string, ModelConfig>,
    inferenceEndpoints: Map<string, InferenceEndpoint>,
    groups: ReadonlyMap<string, CustomApiGroup> = this.customApiGroups,
    unadmitted: readonly UnadmittedUserModelEntry[] = this.unadmittedUserModels
  ): Promise<void> {
    if (!this.persistingInitialState) this.assertUserConfigurationWritable();
    const userModels = Array.from(models.values())
      .filter(model => model.catalog_source === 'user')
      .map(model => projectUserModelForPersistence(model, this.modelReasoningResolver));
    await modelPersister.saveState(
      userModels,
      Array.from(inferenceEndpoints.values()),
      Array.from(groups.values()),
      unadmitted.map(entry => entry.raw)
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
        throw new ModelAdmissionError(
          'invalid_structure',
          `非用户模型 ${model.id} 不得引用用户 InferenceEndpoint`
        );
      }
      return;
    }
    if (!model.inference_endpoint_id) {
      throw new ModelAdmissionError(
        'endpoint_missing',
        `用户模型 ${model.id} 必须引用 InferenceEndpoint`
      );
    }
    const endpoint = this.inferenceEndpoints.get(model.inference_endpoint_id);
    if (!endpoint) {
      throw new ModelAdmissionError(
        'endpoint_missing',
        `InferenceEndpoint 不存在: ${model.inference_endpoint_id}`
      );
    }
    assertEndpointMatchesModel(endpoint, model);
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

  private emitUserModelCatalogChanged(event: UserModelCatalogChangedEvent): void {
    for (const listener of this.userModelCatalogChangedListeners) {
      try {
        listener(event);
      } catch (error) {
        // 通知失败不能把已经提交的目录事务报告成失败。
        logger.warn('[ModelCatalog] userModelCatalogChanged listener 执行失败:', error);
      }
    }
  }
}

export const modelCatalog = ModelCatalogRegistry.getInstance();
