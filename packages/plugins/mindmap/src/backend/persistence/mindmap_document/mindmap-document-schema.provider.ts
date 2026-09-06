import { ISchemaProvider } from '@plugin/backend/workspaceRuntime';
import { MINDMAP_DOCUMENT_SCHEMAS } from './schemas/core.schema';

export class MindMapDocumentSchemaProvider implements ISchemaProvider {
  readonly name = 'mindmap_document';

  getSchema(): string[] {
    return [...MINDMAP_DOCUMENT_SCHEMAS];
  }
}
