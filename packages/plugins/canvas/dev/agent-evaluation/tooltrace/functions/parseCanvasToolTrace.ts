import { CanvasTraceScopeSchema, CanvasToolTraceFactsSchema } from '../definitions/canvasToolTrace';
import { readToolTraceMessages } from './readToolTraceMessages';
import { readCanvasToolMessage } from './readCanvasToolMessage';

/** 只使用已配对的正式工具消息，不从模型的文字总结或runner截图推断行为。 */
export function parseCanvasToolTrace(input: {
  readonly scope: unknown;
  readonly audit: unknown;
  readonly pages: readonly { readonly sourceFile: string; readonly value: unknown }[];
}) {
  const facts = CanvasToolTraceFactsSchema.parse({
    scope: CanvasTraceScopeSchema.parse(input.scope),
    needsReview: false,
    diagnostics: [],
    attempts: [],
    commits: [],
    replays: [],
    dryRuns: [],
    checks: [],
    renders: [],
    imageReads: [],
  });
  const rows = readToolTraceMessages({ ...input, facts }),
    files = new Map<string, string>();
  for (const row of rows) {
    if (row.message.message_type !== 'tool_calls' || row.message.run_id === null) continue;
    readCanvasToolMessage({
      row,
      files,
      context: {
        facts,
        runId: row.message.run_id,
        toolCallId: row.message.payload.tool_call_id,
        sourceFile: row.sourceFile,
        order: row.message.sort_seq,
      },
    });
  }
  return CanvasToolTraceFactsSchema.parse(facts);
}
