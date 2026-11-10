import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  CanvasEvaluationRunnerStateSchema,
  type CanvasEvaluationRunnerState,
} from '../definitions/evaluationRunner';
export async function writeEvidence(
  directory: string,
  filename: string,
  value: unknown
): Promise<void> {
  await writeFile(path.join(directory, filename), JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
}
export async function readEvidence(file: string): Promise<unknown> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  return value;
}
export async function readRunnerState(directory: string): Promise<CanvasEvaluationRunnerState> {
  return CanvasEvaluationRunnerStateSchema.parse(
    await readEvidence(path.join(directory, 'state.json'))
  );
}
export async function updateRunnerState(
  directory: string,
  value: CanvasEvaluationRunnerState
): Promise<void> {
  const temporary = path.join(directory, `.state-${randomUUID()}.json`);
  await writeFile(
    temporary,
    JSON.stringify(CanvasEvaluationRunnerStateSchema.parse(value), null, 2) + '\n',
    { flag: 'wx', mode: 0o600 }
  );
  await rename(temporary, path.join(directory, 'state.json'));
}
export async function createEvidenceStep(directory: string, name: string): Promise<string> {
  if (!/^[a-zA-Z0-9-]+$/.test(name))
    throw new Error('Evidence step must use letters, digits or hyphens');
  const target = path.join(directory, name);
  await mkdir(target, { mode: 0o700 });
  return target;
}
