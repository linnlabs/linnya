import { mkdir, readFile, rename, writeFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  ResearchManifestSchema,
  WorkflowStateSchema,
  type WorkflowState,
} from '../definitions/researchWorkflow';
import { hashText } from '../functions/workflowFacts';

export async function loadManifest(file: string) {
  const manifest = ResearchManifestSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  const stages = await Promise.all(
    manifest.stages.map(async stage => ({
      ...stage,
      promptFile: path.resolve(path.dirname(file), stage.promptFile),
      prompt: await readFile(path.resolve(path.dirname(file), stage.promptFile), 'utf8'),
    }))
  );
  return {
    manifest,
    stages,
    hash: hashText(JSON.stringify({ manifest, prompts: stages.map(stage => stage.prompt) })),
  };
}
export async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const pending = `${file}.pending`;
  await writeFile(pending, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(pending, file);
}
export async function loadWorkflowState(output: string): Promise<WorkflowState | undefined> {
  try {
    return WorkflowStateSchema.parse(
      JSON.parse(await readFile(path.join(output, 'state.json'), 'utf8'))
    );
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
export async function lockWorkflow(output: string) {
  await mkdir(output, { recursive: true });
  const file = path.join(output, 'runner.lock');
  // 不按时间自动抢锁：旧进程可能仍在 send 的未知接纳窗口。
  const handle = await open(file, 'wx', 0o600);
  await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
  return async () => {
    await handle.close();
    await unlink(file);
  };
}
