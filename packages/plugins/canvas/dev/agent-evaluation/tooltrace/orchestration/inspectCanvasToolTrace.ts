import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CanvasTraceInspectionSchema } from '../definitions/traceInspection';
import { parseCanvasToolTrace } from '../functions/parseCanvasToolTrace';
import { readTraceJson, writeTraceJson } from '../adapters/traceFiles';

/** 原始证据保持不动，新目录只产出可追溯事实，不能覆盖首败或合成评分。 */
export async function inspectCanvasToolTrace(input: {
  readonly inspection: unknown;
  readonly outputDirectory: string;
}) {
  const inspection = CanvasTraceInspectionSchema.parse(input.inspection);
  const audit = await readTraceJson(inspection.auditFile);
  const pages = await Promise.all(
    inspection.messageFiles.map(async sourceFile => ({
      sourceFile,
      value: await readTraceJson(sourceFile),
    }))
  );
  const facts = parseCanvasToolTrace({ scope: inspection.scope, audit, pages });
  await mkdir(input.outputDirectory, { mode: 0o700 });
  await writeTraceJson(path.join(input.outputDirectory, 'inspection.json'), inspection);
  await writeTraceJson(path.join(input.outputDirectory, 'trace.json'), facts);
  return {
    outputDirectory: input.outputDirectory,
    needsReview: facts.needsReview,
    writes: facts.attempts.length,
    dryRuns: facts.dryRuns.length,
    commits: facts.commits.length,
    renders: facts.renders.length,
    imageReads: facts.imageReads.length,
    diagnostics: facts.diagnostics,
  };
}
