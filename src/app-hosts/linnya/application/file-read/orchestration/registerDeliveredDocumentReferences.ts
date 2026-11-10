import { z } from 'zod';
import { DocumentReferenceMarkdownBindingSchema } from '@app/schemas';
import type { ToolContext } from 'src/tools/types';
import { getMarkdownDocumentReferenceRuntime, selectDeliveredReferenceBindings } from '../../markdown-document-references';
const metadataSchema = z.object({ sourceKey: z.string(), bindings: z.array(DocumentReferenceMarkdownBindingSchema), unprojectableReferenceIds: z.array(z.string()) }).strict();

/** 消费provider与本次源窗口绑定的事实，绝不在异步投递后重新解析已改名的当前路径。 */
export function registerDeliveredDocumentReferences(input: { readonly context: ToolContext; readonly documentId: string; readonly metadata: unknown; readonly text: string }): void {
  if (input.metadata === undefined || !input.context.conversationId || !input.context.runId) return;
  const database = input.context.databaseService;
  if (!database) throw new Error('Document reference delivery requires the current database');
  const metadata = metadataSchema.parse(input.metadata);
  getMarkdownDocumentReferenceRuntime(database.getDb()).registerBindings({ readerId: JSON.stringify([input.context.conversationId, input.context.runId]),
    sourceDocumentId: input.documentId, ...metadata, bindings: selectDeliveredReferenceBindings(input.text, metadata.bindings) });
}

/** 来源绑定仅供Host准入，不是Agent可提交的身份参数。 */
export function stripDocumentReferenceReadMetadata(data: import('@app/schemas').WorkspaceDocumentReadData): import('@app/schemas').WorkspaceDocumentReadData {
  return data.details ? { ...data, details: Object.fromEntries(Object.entries(data.details).filter(([key]) => key !== 'documentReferences')) } : data;
}
