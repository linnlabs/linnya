import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  CanvasEvaluationRunnerStateSchema,
  CanvasEvaluationCollectionSchema,
  CanvasEvaluationMessagesIndexSchema,
} from '../../runner';
import { CanvasTraceDraftRequestSchema } from '../definitions/traceDraft';
import { buildCanvasRunDraft } from '../functions/buildCanvasRunDraft';
import { parseCanvasToolTrace } from '../functions/parseCanvasToolTrace';
import { readTraceJson, writeTraceJson } from '../adapters/traceFiles';

export async function draftCanvasEvaluationRun(input: {
  readonly request: unknown;
  readonly outputDirectory: string;
}) {
  const request = CanvasTraceDraftRequestSchema.parse(input.request),
    root = path.resolve(request.runDirectory);
  const collectionDirectory = path.join(root, request.collectionLabel);
  const stateFile = path.join(root, 'state.json'),
    collectionFile = path.join(collectionDirectory, 'collection.json');
  const state = CanvasEvaluationRunnerStateSchema.parse(await readTraceJson(stateFile));
  const collection = CanvasEvaluationCollectionSchema.parse(await readTraceJson(collectionFile));
  if (!state.receipt) throw new Error('Evaluation has no confirmed model receipt');
  const indexFile = path.join(collectionDirectory, 'messages-index.json');
  const index = CanvasEvaluationMessagesIndexSchema.parse(await readTraceJson(indexFile));
  const messageFiles = index.files.map(file => path.join(collectionDirectory, file));
  const auditFile = path.join(collectionDirectory, 'audit.response.json');
  const beforeFile = path.join(root, 'before.json'),
    afterFile = path.join(collectionDirectory, 'after.json'),
    resultFile = path.join(collectionDirectory, 'result.response.json');
  const [audit, pages, before, after, result, controls, metrics] = await Promise.all([
    readTraceJson(auditFile),
    Promise.all(
      messageFiles.map(async sourceFile => ({ sourceFile, value: await readTraceJson(sourceFile) }))
    ),
    readTraceJson(beforeFile),
    readTraceJson(afterFile),
    readTraceJson(resultFile),
    request.controlsFile ? readTraceJson(request.controlsFile) : undefined,
    request.metricsFile ? readTraceJson(request.metricsFile) : undefined,
  ]);
  const facts = parseCanvasToolTrace({
    scope: {
      conversationId: state.receipt.conversation_id,
      rootRunId: state.receipt.run_id,
      documentId: state.documentId,
      locators: [`workspace:/${state.config.taskId}.canvas`],
    },
    audit,
    pages,
  });
  const evidenceFiles = [
    stateFile,
    collectionFile,
    indexFile,
    auditFile,
    beforeFile,
    afterFile,
    resultFile,
    ...messageFiles,
    ...(request.controlsFile ? [request.controlsFile] : []),
    ...(request.metricsFile ? [request.metricsFile] : []),
  ];
  const draft = buildCanvasRunDraft({
    state,
    collection,
    before,
    after,
    result,
    facts,
    evidenceFiles,
    controls,
    metrics,
  });
  const artifact = draft.kind === 'ready-for-review' ? draft.run : draft.partial;
  await Promise.all(artifact.evidenceFiles.map(file => access(file)));
  await mkdir(input.outputDirectory, { mode: 0o700 });
  await writeTraceJson(path.join(input.outputDirectory, 'draft-request.json'), request);
  await writeTraceJson(path.join(input.outputDirectory, 'trace.json'), facts);
  await writeTraceJson(path.join(input.outputDirectory, 'diagnostics.json'), {
    kind: draft.kind,
    diagnostics: draft.diagnostics,
  });
  await writeTraceJson(
    path.join(
      input.outputDirectory,
      draft.kind === 'ready-for-review' ? 'run.json' : 'run.partial.json'
    ),
    artifact
  );
  return {
    outputDirectory: input.outputDirectory,
    kind: draft.kind,
    diagnostics: draft.diagnostics,
  };
}
