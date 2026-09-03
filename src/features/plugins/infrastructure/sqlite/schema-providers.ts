import type { ISchemaProvider } from '../../../../shared/database/schema-provider';
import { PluginStateSchemaProvider } from './plugin-state.schema-provider';

export function getPluginStateSchemaProviders(): ISchemaProvider[] {
  return [new PluginStateSchemaProvider()];
}
