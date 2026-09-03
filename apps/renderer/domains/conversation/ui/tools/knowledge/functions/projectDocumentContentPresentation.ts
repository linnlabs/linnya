import {
  KnowledgeReadArgsSchema,
  KnowledgeReadResultSchema,
  HistoricalKnowledgeBaseResourceReadArgsSchema,
  KnowledgeBaseResourceReadAdmissionResultSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { DocumentContentPresentationData } from '../definitions/documentContentPresentation';

function createTitle(): ToolPresentationProjection['title'] {
  return createConversationToolTitleDescriptor(
    'conversation.tool.knowledgeSearch.configReadDocument'
  );
}

export function projectDocumentContentPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<DocumentContentPresentationData> {
  if (input.uiKey !== 'knowledge_read' && input.uiKey !== 'browse_document_by_chunk') {
    throw new Error(`Unsupported document content UI key: ${input.uiKey}`);
  }

  const directArgsResult =
    input.sourceToolName === 'knowledge_read' || input.sourceToolName === 'browse_document_by_chunk'
      ? KnowledgeReadArgsSchema.safeParse(input.args)
      : null;
  const resourceArgsResult =
    input.sourceToolName === 'resource_read'
      ? HistoricalKnowledgeBaseResourceReadArgsSchema.safeParse(input.args)
      : null;
  if (directArgsResult === null && resourceArgsResult === null) {
    throw new Error(`Unsupported document content source tool: ${input.sourceToolName}`);
  }

  if (input.status !== 'success') {
    const documentIdentity = directArgsResult?.success
      ? directArgsResult.data.doc_id
      : resourceArgsResult?.success
        ? resourceArgsResult.data.uri
        : undefined;
    return {
      data: { kind: 'lifecycle', ...(documentIdentity ? { documentIdentity } : {}) },
      title: createTitle(),
    };
  }

  const directArgs = directArgsResult?.success ? directArgsResult.data : null;
  const resourceArgs = resourceArgsResult?.success ? resourceArgsResult.data : null;
  if (directArgs === null && resourceArgs === null) {
    throw new Error('Document content success requires admitted tool arguments.');
  }

  const documentIdentity = directArgs?.doc_id ?? resourceArgs?.uri;
  if (!documentIdentity) {
    throw new Error('Document content presentation requires a document identity.');
  }
  const title = createTitle();
  if (directArgs) {
    const result = KnowledgeReadResultSchema.parse(input.result);
    return {
      data: {
        kind: 'content',
        filename: result.data.filename,
        rangeStart: result.data.start_chunk,
        rangeEnd: result.data.end_chunk,
        chunks: result.data.chunks,
      },
      title,
    };
  }

  const resourceResult = KnowledgeBaseResourceReadAdmissionResultSchema.parse(input.result);
  if ('uri' in resourceResult.data) {
    if (resourceResult.data.uri !== resourceArgs?.uri) {
      throw new Error('Knowledge-base resource result URI does not match its tool arguments.');
    }
    return {
      data: {
        kind: 'content',
        filename: resourceResult.data.filename,
        rangeStart: resourceResult.data.offset + 1,
        rangeEnd: resourceResult.data.offset + resourceResult.data.limit,
        chunks: resourceResult.data.chunks,
      },
      title,
    };
  }

  // 旧版 wrapper 已落盘但没有 uri/offset/limit；只接受登记过的精确历史结构。
  const firstChunk = resourceResult.data.chunks[0];
  const lastChunk = resourceResult.data.chunks[resourceResult.data.chunks.length - 1];
  if (!firstChunk || !lastChunk) {
    throw new Error('Historical knowledge-base resource result has no content chunks.');
  }
  return {
    data: {
      kind: 'content',
      filename: resourceResult.data.filename,
      rangeStart: firstChunk.index,
      rangeEnd: lastChunk.index,
      chunks: resourceResult.data.chunks,
    },
    title,
  };
}
