import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { CommandApprovalsSchemaProvider } from './commandApprovalsSchemaProvider';

export function getCommandApprovalsSchemaProviders(): ISchemaProvider[] {
  return [new CommandApprovalsSchemaProvider()];
}
