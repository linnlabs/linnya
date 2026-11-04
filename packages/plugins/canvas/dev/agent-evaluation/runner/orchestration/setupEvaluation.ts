import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { ConversationControlProjectsResponseSchema } from '@app/schemas';
import { createCanvasAgentFixture } from '../../../../scripts/agent-evaluation';
import {
  CanvasEvaluationRunnerConfigSchema,
  type EvaluationRunnerPorts,
} from '../definitions/evaluationRunner';
import { createEvidenceStep, writeEvidence, updateRunnerState } from '../adapters/evidenceFiles';
const createdDocument = z.object({
  ok: z.literal(true),
  tool: z.object({
    payload: z.object({
      status: z.literal('success'),
      data: z.object({ documentId: z.string().min(1) }),
    }),
  }),
});

export async function setupCanvasEvaluation(input: {
  readonly config: unknown;
  readonly outputDirectory: string;
  readonly ports: EvaluationRunnerPorts;
}) {
  const parsed = CanvasEvaluationRunnerConfigSchema.parse(input.config);
  const config = { ...parsed, repositoryRoot: path.resolve(parsed.repositoryRoot) };
  if (config.taskId === 'T8' && config.evidenceMode === 'not-applicable')
    throw new Error('T8 requires explicit offline or network evidence mode');
  const directory = path.resolve(input.outputDirectory),
    relative = path.relative(config.repositoryRoot, directory);
  if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    throw new Error('Evaluation evidence must be outside the source checkout');
  await input.ports.verifyRevision(config.repositoryRoot, config.sourceRevision);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  await writeEvidence(directory, 'config.json', config);
  const fixture = createCanvasAgentFixture(config.taskId);
  await writeEvidence(directory, 'fixture.json', fixture);
  const setup = await createEvidenceStep(directory, 'setup');
  const cli = async (label: string, args: readonly string[]) => {
    const result = await input.ports.cli({
      repositoryRoot: config.repositoryRoot,
      directory: setup,
      label,
      args,
    });
    if (result.exitCode !== 0) throw new Error(`CLI ${label} failed; raw evidence retained`);
    return result.value;
  };
  await cli('doctor', ['doctor']);
  await cli('models', ['models']);
  const project = ConversationControlProjectsResponseSchema.parse(
    await cli('project', [
      'projects',
      'create',
      `Canvas-${config.batchId}-${config.model.model}-${config.taskId}-r${config.repetition}`,
    ])
  );
  if (project.action !== 'create') throw new Error('CLI did not create the evaluation project');
  const projectId = project.project.project_id;
  await writeEvidence(directory, 'project.json', { projectId });
  const documentIds: Record<string, string> = {};
  const documents = [
    ...fixture.documents,
    { key: 'canvas', filename: `${config.taskId}.canvas`, text: '' },
  ];
  for (const [index, document] of documents.entries()) {
    const label = `document-${index + 1}`,
      argsFile = path.join(setup, `${label}.args.json`);
    await writeEvidence(setup, `${label}.args.json`, {
      locator: `workspace:/${document.filename}`,
      content: document.text,
    });
    const result = createdDocument.parse(
      await cli(label, [
        'tools',
        'call',
        'write_file',
        '--project',
        projectId,
        '--args-file',
        argsFile,
      ])
    );
    documentIds[document.key] = result.tool.payload.data.documentId;
    await writeEvidence(setup, `${label}.identity.json`, {
      key: document.key,
      documentId: documentIds[document.key],
    });
  }
  // 目标画布已有独立身份；资料集合只保存题目输入，不能把画布当第九份来源。
  const { canvas: documentId, ...sourceDocumentIds } = documentIds;
  if (!documentId) throw new Error('Canvas document identity is missing');
  const goal =
    config.taskId === 'T8' && config.evidenceMode === 'offline'
      ? fixture.offlinePrompt
      : fixture.task.prompt;
  if (!goal) throw new Error('Fixture does not define the selected prompt');
  const vision =
    config.imageCapability === 'vision'
      ? '完成后按 check → render → read_file（真实读取render返回的图片locator）检查画布；发现问题请修正后复查。'
      : '本轮不使用看图能力，仅通过check检查画布，不调用render或读取截图。';
  await writeFile(
    path.join(directory, 'prompt.txt'),
    `目标画布：workspace:/${config.taskId}.canvas。\n给定资料：\n${fixture.documents.map(document => `workspace:/${document.filename}`).join('\n')}\n\n${goal}\n\n${vision}\n请直接在目标画布完成任务，遵守正式Skill和CLI。\n`,
    { flag: 'wx', mode: 0o600 }
  );
  await updateRunnerState(directory, {
    config,
    projectId,
    documentId,
    documentIds: sourceDocumentIds,
    phase: 'setup',
  });
  return {
    directory,
    projectId,
    documentId,
    next: 'Start the trusted bridge for this project, then attach this directory.',
  };
}
