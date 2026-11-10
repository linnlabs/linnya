import type { ISchemaProvider } from '../../../../shared/database/schema-provider';

import { SEMANTIC_LAYER_SCHEMAS } from './semanticLayer.schema';

export function getSemanticLayerSchemaProviders(): ISchemaProvider[] {
  return [{ name: 'semantic-layer', getSchema: () => [...SEMANTIC_LAYER_SCHEMAS] }];
}
