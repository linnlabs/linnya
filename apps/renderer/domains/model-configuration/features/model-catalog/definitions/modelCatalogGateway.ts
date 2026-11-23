import type {
  ModelCatalogItem,
  ModelCatalogSnapshot,
  UpdateModelCommand,
} from './modelCatalog';

export interface ModelCatalogGateway {
  load(): Promise<ModelCatalogSnapshot>;
  update(modelId: string, command: UpdateModelCommand): Promise<ModelCatalogItem>;
  delete(modelId: string): Promise<void>;
  /** 删除前读影响：有几个定时任务指定了这个模型。 */
  readRemovalImpact?(modelId: string): Promise<{ readonly scheduledTaskCount: number }>;
}
