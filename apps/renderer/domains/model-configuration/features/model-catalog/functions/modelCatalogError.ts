import type {
  ModelCatalogError,
  ModelCatalogOperation,
} from '../definitions/modelCatalog';

export function createModelCatalogError(
  operation: ModelCatalogOperation,
  error: unknown,
): ModelCatalogError {
  return {
    operation,
    detail: error instanceof Error && error.message.trim() ? error.message : null,
  };
}
