import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CanvasEvaluationRunnerStateSchema } from '../../runner';
import { CanvasT13MetricsRequestSchema } from '../definitions/canvasT13Metrics';
import { readTraceJson, writeTraceJson } from '../adapters/traceFiles';
import { readCollectedCanvasToolTrace } from '../adapters/readCollectedCanvasToolTrace';
import { readCanvasT13Observations } from '../adapters/readCanvasT13Observations';
import { buildCanvasT13Metrics } from '../functions/buildCanvasT13Metrics';

/** 只读既有run与observer原件；每次输出新目录，不调用模型/桥/数据库或填入人工结论。 */
export async function collectCanvasT13Metrics(input: { readonly request: unknown; readonly outputDirectory: string }) {
  const request = CanvasT13MetricsRequestSchema.parse(input.request), root = path.resolve(request.runDirectory);
  const collectionDirectory = path.join(root, request.collectionLabel);
  const stateFile = path.join(root, 'state.json'), collectionFile = path.join(collectionDirectory, 'collection.json');
  const beforeFile = path.join(root, 'before.json'), afterFile = path.join(collectionDirectory, 'after.json');
  const resultFile = path.join(collectionDirectory, 'result.response.json');
  const state = CanvasEvaluationRunnerStateSchema.parse(await readTraceJson(stateFile));
  const [trace, observations, collection, before, after, result] = await Promise.all([
    readCollectedCanvasToolTrace({ directory: collectionDirectory, state }),
    readCanvasT13Observations(path.resolve(request.observationDirectory)),
    readTraceJson(collectionFile), readTraceJson(beforeFile), readTraceJson(afterFile), readTraceJson(resultFile),
  ]);
  const evidenceFiles = [stateFile, collectionFile, beforeFile, afterFile, resultFile,
    ...trace.evidenceFiles, ...observations.evidenceFiles];
  const metrics = buildCanvasT13Metrics({ state, collection, before, after, result,
    facts: trace.facts, ...observations, evidenceFiles });
  await mkdir(input.outputDirectory, { mode: 0o700 });
  await writeTraceJson(path.join(input.outputDirectory, 'metrics-request.json'), request);
  await writeTraceJson(path.join(input.outputDirectory, 'trace.json'), trace.facts);
  await writeTraceJson(path.join(input.outputDirectory, 'metrics-facts.json'), metrics.facts);
  await writeTraceJson(path.join(input.outputDirectory, 'diagnostics.json'), { kind: metrics.kind, diagnostics: metrics.diagnostics });
  const file = path.join(input.outputDirectory, metrics.kind === 'complete' ? 'metrics.json' : 'metrics.partial.json');
  // partial不使用正式witness形状，避免误把文件名换掉就交给draft参与评分。
  await writeTraceJson(file, metrics.kind === 'complete' ? metrics.witness : {
    scope: metrics.witness.scope, partialMetrics: metrics.witness.metrics,
    evidenceFiles: metrics.witness.evidenceFiles, diagnostics: metrics.diagnostics,
  });
  return { outputDirectory: input.outputDirectory, kind: metrics.kind, metricsFile: file, diagnostics: metrics.diagnostics };
}
