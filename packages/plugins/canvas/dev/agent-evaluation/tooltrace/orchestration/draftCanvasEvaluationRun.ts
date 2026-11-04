import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  CanvasEvaluationRunnerStateSchema,
  CanvasEvaluationCollectionSchema,
  readEvaluationRunReceipts,
} from '../../runner';
import { CanvasTraceDraftRequestSchema } from '../definitions/traceDraft';
import { buildCanvasRunDraft } from '../functions/buildCanvasRunDraft';
import { readCollectedCanvasToolTrace } from '../adapters/readCollectedCanvasToolTrace';
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
  const receipts = readEvaluationRunReceipts(state);
  const controlsFile = request.controlsFile ?? state.continuations?.[0]?.witnessFile;
  const resultFiles = receipts.map((_receipt, index) =>
    path.join(
      collectionDirectory,
      index === 0 ? 'result.response.json' : `continuation-${index}-result.response.json`
    )
  );
  const beforeFile = path.join(root, 'before.json'),
    afterFile = path.join(collectionDirectory, 'after.json'),
    resultFile = path.join(
      collectionDirectory,
      receipts.length === 1
        ? 'result.response.json'
        : `continuation-${receipts.length - 1}-result.response.json`
    );
  const [trace, before, after, result, controls, metrics, receiptWitness] = await Promise.all([
    readCollectedCanvasToolTrace({ directory: collectionDirectory, state }),
    readTraceJson(beforeFile),
    readTraceJson(afterFile),
    readTraceJson(resultFile),
    controlsFile ? readTraceJson(controlsFile) : undefined,
    request.metricsFile ? readTraceJson(request.metricsFile) : undefined,
    request.receiptWitnessFile ? readTraceJson(request.receiptWitnessFile) : undefined,
  ]);
  const facts = trace.facts;
  const evidenceFiles = [
    stateFile,
    collectionFile,
    beforeFile,
    afterFile,
    resultFile,
    ...trace.evidenceFiles,
    ...resultFiles,
    ...(controlsFile ? [controlsFile] : []),
    ...(request.metricsFile ? [request.metricsFile] : []),
    ...(request.receiptWitnessFile ? [request.receiptWitnessFile] : []),
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
    receiptWitness,
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
