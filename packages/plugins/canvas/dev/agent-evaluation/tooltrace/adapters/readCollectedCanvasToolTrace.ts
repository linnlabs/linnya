import path from 'node:path';
import {
  CanvasEvaluationMessagesIndexSchema,
  type CanvasEvaluationRunnerState,
} from '../../runner';
import { parseCanvasToolTrace } from '../functions/parseCanvasToolTrace';
import { readTraceJson } from './traceFiles';

/** 从正式分页/audit原件重建请求身份；操作者手填编号不能成为run归属证据。 */
export async function readCollectedCanvasToolTrace(input: {
  readonly directory: string;
  readonly state: CanvasEvaluationRunnerState;
}) {
  if (!input.state.receipt) throw new Error('Evaluation has no confirmed model receipt');
  const indexFile = path.join(input.directory, 'messages-index.json'),
    auditFile = path.join(input.directory, 'audit.response.json');
  const index = CanvasEvaluationMessagesIndexSchema.parse(await readTraceJson(indexFile));
  const files = index.files.map(file => path.join(input.directory, file));
  const [audit, pages] = await Promise.all([
    readTraceJson(auditFile),
    Promise.all(
      files.map(async sourceFile => ({ sourceFile, value: await readTraceJson(sourceFile) }))
    ),
  ]);
  const facts = parseCanvasToolTrace({
    scope: {
      conversationId: input.state.receipt.conversation_id,
      rootRunId: input.state.receipt.run_id,
      documentId: input.state.documentId,
      locators: [`workspace:/${input.state.config.taskId}.canvas`],
    },
    audit,
    pages,
  });
  return { facts, evidenceFiles: [indexFile, auditFile, ...files] };
}
