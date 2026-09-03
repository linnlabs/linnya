import type {
  ModelCatalogItem,
  ModelCatalogSnapshot,
  UpdateModelCommand,
} from './modelCatalog';

export interface ModelCatalogGateway {
  load(): Promise<ModelCatalogSnapshot>;
  update(modelId: string, command: UpdateModelCommand): Promise<ModelCatalogItem>;
  delete(modelId: string): Promise<void>;
}
