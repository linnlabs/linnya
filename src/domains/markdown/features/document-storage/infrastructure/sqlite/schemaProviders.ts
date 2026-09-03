import type { ISchemaProvider } from '../../../../../../shared/database/schema-provider';

import { MarkdownSchemaProvider } from './markdownSchemaProvider';

export function getMarkdownSchemaProviders(): ISchemaProvider[] {
  return [new MarkdownSchemaProvider()];
}
