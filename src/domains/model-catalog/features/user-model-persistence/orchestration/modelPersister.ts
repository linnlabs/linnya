import fs from 'node:fs/promises';
import path from 'node:path';

import { Logger } from 'src/shared/logger';
import { pathManager } from 'src/shared/utils/pathManager';

import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import {
  readStoredUserModelState,
  USER_MODELS_FILE_VERSION,
  type StoredUserModelState,
  type UserModelsFile,
} from '../definitions/userModelsFile';

const logger = new Logger('ModelPersister');

/** 用户模型文件是 catalog 的持久化来源；格式损坏必须显式失败，不能伪装成空目录。 */
export class ModelPersister {
  private static instance: ModelPersister | null = null;
  private userModelsPath: string | null = null;

  private constructor() {}

  static getInstance(): ModelPersister {
    if (!ModelPersister.instance) ModelPersister.instance = new ModelPersister();
    return ModelPersister.instance;
  }

  async initialize(): Promise<void> {
    if (this.userModelsPath) return;
    this.userModelsPath = await pathManager.getUserModelsConfigPath();
    await fs.mkdir(path.dirname(this.userModelsPath), { recursive: true });
    try {
      await fs.access(this.userModelsPath);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT') throw error;
      await this.writeUserModelsFile([], []);
      logger.info(`[ModelPersister] Created empty user models file at ${this.userModelsPath}`);
    }
  }

  async loadState(): Promise<StoredUserModelState> {
    const userModelsPath = await this.requireUserModelsPath();
    const fileContent = await fs.readFile(userModelsPath, 'utf8');
    const parsed: unknown = JSON.parse(fileContent);
    return readStoredUserModelState(parsed);
  }

  async saveState(
    models: readonly ModelConfig[],
    inferenceEndpoints: readonly InferenceEndpoint[]
  ): Promise<void> {
    const userModels = models.filter(model => model.catalog_source === 'user');
    await this.writeUserModelsFile(userModels, inferenceEndpoints);
    logger.info(
      `[ModelPersister] Saved ${userModels.length} user models and ${inferenceEndpoints.length} inference endpoints`
    );
  }

  getUserModelsPath(): string | null {
    return this.userModelsPath;
  }

  isInitialized(): boolean {
    return this.userModelsPath !== null;
  }

  private async requireUserModelsPath(): Promise<string> {
    await this.initialize();
    if (!this.userModelsPath) throw new Error('User models path not initialized');
    return this.userModelsPath;
  }

  private async writeUserModelsFile(
    models: readonly ModelConfig[],
    inferenceEndpoints: readonly InferenceEndpoint[]
  ): Promise<void> {
    const userModelsPath = await this.requireUserModelsPathForWrite();
    const data: UserModelsFile = {
      version: USER_MODELS_FILE_VERSION,
      last_updated: new Date().toISOString(),
      inference_endpoints: inferenceEndpoints,
      models,
    };
    const temporaryPath = `${userModelsPath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, userModelsPath);
  }

  private async requireUserModelsPathForWrite(): Promise<string> {
    if (!this.userModelsPath) {
      this.userModelsPath = await pathManager.getUserModelsConfigPath();
      await fs.mkdir(path.dirname(this.userModelsPath), { recursive: true });
    }
    return this.userModelsPath;
  }
}

export const modelPersister = ModelPersister.getInstance();
