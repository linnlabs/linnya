import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CanvasAgentReceiptQueryResultSchema } from '@plugin/canvas/shared';
import { CanvasEvaluationCollectionSchema, CanvasEvaluationRunnerStateSchema } from '../../runner';
import {
  CanvasReceiptWitnessRequestSchema,
  CanvasReceiptWitnessSchema,
  type CanvasReceiptReader,
  type CanvasReceiptWitness,
} from '../definitions/canvasReceiptWitness';
import { createStandaloneReceiptReader } from '../adapters/createStandaloneReceiptReader';
import { readTraceJson, writeTraceJson } from '../adapters/traceFiles';
import { readCollectedCanvasToolTrace } from '../adapters/readCollectedCanvasToolTrace';

export async function collectCanvasReceiptWitness(input: {
  readonly request: unknown;
  readonly outputDirectory: string;
  readonly reader?: CanvasReceiptReader;
}) {
  const request = CanvasReceiptWitnessRequestSchema.parse(input.request),
    root = path.resolve(request.runDirectory);
  const stateFile = path.join(root, 'state.json'),
    collectionFile = path.join(root, request.collectionLabel, 'collection.json');
  const state = CanvasEvaluationRunnerStateSchema.parse(await readTraceJson(stateFile)),
    collection = CanvasEvaluationCollectionSchema.parse(await readTraceJson(collectionFile));
  if (
    !state.receipt ||
    collection.conversationId !== state.receipt.conversation_id ||
    collection.runId !== state.receipt.run_id ||
    collection.sourceRevision !== state.config.sourceRevision ||
    collection.batchId !== state.config.batchId ||
    collection.taskId !== state.config.taskId
  )
    throw new Error('Receipt witness scope does not match collected run');
  const trace = await readCollectedCanvasToolTrace({
    directory: path.dirname(collectionFile),
    state,
  });
  for (const requestId of request.requestIds)
    if (!trace.facts.requests.some(request => request.requestId === requestId))
      throw new Error('Receipt request has no literal identity in this model run: ' + requestId);
  const cliEntry = path.join(path.resolve(request.artifactRoot), 'dist/cli/canvas-cli.cjs'),
    sha256 = createHash('sha256')
      .update(await readFile(cliEntry))
      .digest('hex');
  await mkdir(input.outputDirectory, { mode: 0o700 });
  const reader =
    input.reader ??
    (await createStandaloneReceiptReader({
      directory: input.outputDirectory,
      hostAppRoot: state.config.repositoryRoot,
    }));
  const scope = {
    sourceRevision: state.config.sourceRevision,
    batchId: state.config.batchId,
    documentId: state.documentId,
    conversationId: state.receipt.conversation_id,
    runId: state.receipt.run_id,
  };
  const witness: CanvasReceiptWitness = {
    scope,
    projectId: state.projectId,
    documentPath: `workspace:/${state.config.taskId}.canvas`,
    reader: { cliEntry, sha256, hostAppRoot: state.config.repositoryRoot },
    complete: true,
    queries: [],
    evidenceFiles: [stateFile, collectionFile, ...trace.evidenceFiles],
  };
  for (const [index, requestId] of [...new Set(request.requestIds)].entries()) {
    const result = await reader.read({
      directory: input.outputDirectory,
      label: `receipt-${index + 1}`,
      request: {
        hostAppRoot: state.config.repositoryRoot,
        artifactRoot: path.resolve(request.artifactRoot),
        databasePath: path.resolve(request.databasePath),
        profileDirectory: path.join(input.outputDirectory, `profile-${index + 1}`),
        projectId: state.projectId,
        conversationId: state.receipt.conversation_id,
        documentPath: witness.documentPath,
        requestId,
      },
    });
    const parsed = CanvasAgentReceiptQueryResultSchema.safeParse(result.value),
      response = result.exitCode === 0 && parsed.success ? parsed.data : null;
    const failure =
      result.exitCode !== 0 ? 'process_failed' : !parsed.success ? 'invalid_response' : null;
    witness.queries.push({
      requestId,
      exitCode: result.exitCode,
      responseFile: result.responseFile,
      response,
      failure,
    });
    witness.evidenceFiles.push(...result.evidenceFiles);
    if (failure) witness.complete = false;
  }
  await writeTraceJson(path.join(input.outputDirectory, 'receipt-request.json'), request);
  const traceFile = path.join(input.outputDirectory, 'request-trace.json');
  await writeTraceJson(traceFile, trace.facts);
  witness.evidenceFiles.push(traceFile);
  const file = path.join(input.outputDirectory, 'receipt-witness.json');
  witness.evidenceFiles.push(file);
  witness.evidenceFiles = [...new Set(witness.evidenceFiles)];
  await writeTraceJson(file, CanvasReceiptWitnessSchema.parse(witness));
  return { file, queries: witness.queries.length, complete: witness.complete };
}
