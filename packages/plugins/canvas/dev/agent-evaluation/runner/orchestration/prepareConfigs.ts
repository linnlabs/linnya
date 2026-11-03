import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { canvasAgentTaskIds } from '../../../../scripts/agent-evaluation';
import { CanvasEvaluationRunnerConfigSchema } from '../definitions/evaluationRunner';
import { writeEvidence } from '../adapters/evidenceFiles';
const modelSchema = CanvasEvaluationRunnerConfigSchema.pick({
  model: true,
  modelConfigId: true,
  imageCapability: true,
});
const matrixSchema = z
  .object({
    base: CanvasEvaluationRunnerConfigSchema.omit({
      taskId: true,
      model: true,
      modelConfigId: true,
      imageCapability: true,
      evidenceMode: true,
    }),
    models: z.array(modelSchema).min(1),
    t8EvidenceMode: z.enum(['offline', 'network']),
  })
  .strict();
/** 预先固定平衡任务矩阵；配置文件不是模型成功记录，也不创建项目或调用模型。 */
export async function prepareCanvasEvaluationConfigs(input: {
  readonly matrix: unknown;
  readonly outputDirectory: string;
}) {
  const matrix = matrixSchema.parse(input.matrix),
    directory = path.resolve(input.outputDirectory);
  if (new Set(matrix.models.map(model => model.modelConfigId)).size !== matrix.models.length)
    throw new Error('Duplicate model config in evaluation matrix');
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  const files: string[] = [];
  for (const [index, model] of matrix.models.entries())
    for (const taskId of canvasAgentTaskIds) {
      const config = CanvasEvaluationRunnerConfigSchema.parse({
        ...matrix.base,
        ...model,
        taskId,
        evidenceMode: taskId === 'T8' ? matrix.t8EvidenceMode : 'not-applicable',
      });
      const filename = `model-${index + 1}-${taskId}.json`;
      await writeEvidence(directory, filename, config);
      files.push(filename);
    }
  await writeEvidence(directory, 'manifest.json', {
    sourceRevision: matrix.base.sourceRevision,
    batchId: matrix.base.batchId,
    files,
  });
  return { directory, count: files.length, files };
}
