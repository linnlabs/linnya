import path from 'node:path';
import {
  CanvasEvaluationMessagesIndexSchema,
  type CanvasEvaluationRunnerState,
  readEvaluationRunReceipts,
  readEvaluationContinuationEvidence,
} from '../../runner';
import { parseCanvasToolTrace } from '../functions/parseCanvasToolTrace';
import { readTraceJson } from './traceFiles';

/** 从正式分页/audit原件重建请求身份；操作者手填编号不能成为run归属证据。 */
export async function readCollectedCanvasToolTrace(input: {
  readonly directory: string;
  readonly state: CanvasEvaluationRunnerState;
}) {
  if (!input.state.receipt) throw new Error('Evaluation has no confirmed model receipt');
  const indexFile = path.join(input.directory, 'messages-index.json');
  const index = CanvasEvaluationMessagesIndexSchema.parse(await readTraceJson(indexFile));
  const files = index.files.map(file => path.join(input.directory, file));
  const receipts = readEvaluationRunReceipts(input.state);
  const auditFiles = receipts.map((_receipt, index) =>
    path.join(
      input.directory,
      index === 0 ? 'audit.response.json' : `continuation-${index}-audit.response.json`
    )
  );
  const [audits, pages, continuationEvidence] = await Promise.all([
    Promise.all(auditFiles.map(file => readTraceJson(file))),
    Promise.all(
      files.map(async sourceFile => ({ sourceFile, value: await readTraceJson(sourceFile) }))
    ),
    readEvaluationContinuationEvidence(input.state),
  ]);
  const facts = parseCanvasToolTrace({
    scope: {
      conversationId: input.state.receipt.conversation_id,
      rootRunId: input.state.receipt.run_id,
      ...(receipts.length > 1
        ? { continuationRunIds: receipts.slice(1).map(receipt => receipt.run_id) }
        : {}),
      documentId: input.state.documentId,
      locators: [`workspace:/${input.state.config.taskId}.canvas`],
    },
    audit: audits[0],
    continuationAudits: audits.slice(1),
    pages,
  });
  return {
    facts,
    audit: audits[0], continuationAudits: audits.slice(1),
    evidenceFiles: [indexFile, ...auditFiles, ...files, ...continuationEvidence],
  };
}
