/**
 * @file src/tools/knowledgebase/reader/KnowledgeReadTool.ts
 * @description Knowledge 文档分块阅读的 canonical Tool facade。
 */

import { KnowledgeReadArgsSchema, KnowledgeReadResultSchema } from '@app/schemas';
import {
  BaseTool,
  CommonParameterTypes,
  type ToolContext,
  type ToolParameterSchema,
} from '../../types';
import { readKnowledgeDocumentForTool } from './readKnowledgeDocumentAdapter';
import { captureKnowledgeReadEvidence } from './knowledgeReadEvidenceAdapter';

export class KnowledgeReadTool extends BaseTool {
  readonly name = 'knowledge_read';

  get description() {
    return `Reads a known Knowledge document by its 1-based chunk range.
Each chunk is a stable logical content block from the document Source of Truth.

# Important
- \`doc_id\` is the full document ID returned by a Knowledge search; a citation \`[@ref]\` is not a document ID.
- Chunk numbering starts at 1. Continue from the returned \`next_start_chunk\` when \`has_more=true\`.
- Use \`glance\` to scan many chunks as short previews, then use \`full\` for the ranges that matter.
- Only cite canonical \`[@XXXXXX]\` references shown in this result. Never cite a document ID, block ID, chunk number, or an invented reference.

# When to Use
- When a Knowledge search identified a relevant document and you need its original context.
- When continuing through a long Knowledge document from a known chunk position.`;
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      doc_id: {
        ...CommonParameterTypes.docId,
        description: 'The full ID of the Knowledge document to read.',
      },
      mode: {
        type: 'string',
        enum: ['full', 'glance'],
        default: 'full',
        description:
          'full returns original chunk text (max 30 chunks); glance returns first-sentence previews (max 200 chunks).',
      },
      start_chunk: {
        type: 'integer',
        description: 'The 1-based chunk number to start reading from, inclusive.',
        default: 1,
      },
      end_chunk: {
        type: 'integer',
        description: 'The 1-based chunk number to stop at, inclusive. Defaults to start_chunk.',
      },
    },
    required: ['doc_id'],
  };

  getExecutionSummary(output: string): string {
    try {
      const { data } = KnowledgeReadResultSchema.parse(JSON.parse(output));
      const next =
        data.has_more && data.next_start_chunk !== null
          ? `next_start_chunk=${data.next_start_chunk}`
          : 'no_more';
      return `分块阅读：${data.filename}（chunks ${data.start_chunk}-${data.end_chunk}/${data.total_chunks}, mode=${data.mode}, ${next}）`;
    } catch {
      return '分块阅读：解析失败。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const validation = this.validateArguments(args);
    if (!validation.success) {
      throw new Error(validation.error);
    }
    const parsedArgs = KnowledgeReadArgsSchema.parse(args);
    const result = await readKnowledgeDocumentForTool(parsedArgs, context);
    KnowledgeReadResultSchema.parse(result);
    await captureKnowledgeReadEvidence({
      documentId: parsedArgs.doc_id,
      result,
      context,
    });
    return JSON.stringify(result);
  }
}
