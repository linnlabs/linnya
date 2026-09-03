import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { CommandCardSettlementsSchemaProvider } from './commandCardSettlementsSchemaProvider';

export function getCommandCardSettlementsSchemaProviders(): ISchemaProvider[] {
  return [new CommandCardSettlementsSchemaProvider()];
}
