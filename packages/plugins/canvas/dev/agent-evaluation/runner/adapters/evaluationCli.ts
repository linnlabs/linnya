import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationCliInvocation } from '../definitions/evaluationRunner';
import { writeEvidence } from './evidenceFiles';

/** 仅传argv，不经shell；原始stdout/stderr和退出码先落证据，非零结果不伪造成成功JSON。 */
export async function executeEvaluationCli(input: EvaluationCliInvocation) {
  const args = ['--silent', 'linnya:cli', ...input.args];
  await writeEvidence(input.directory, input.label + '.request.json', {
    executable: 'pnpm',
    args,
    startedAt: Date.now(),
  });
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    resolve => {
      execFile(
        'pnpm',
        args,
        {
          cwd: input.repositoryRoot,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          timeout: 120_000,
        },
        (error, stdout, stderr) => {
          resolve({
            exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout,
            stderr,
          });
        }
      );
    }
  );
  await writeFile(path.join(input.directory, input.label + '.stdout.txt'), result.stdout, {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(path.join(input.directory, input.label + '.stderr.txt'), result.stderr, {
    flag: 'wx',
    mode: 0o600,
  });
  await writeEvidence(input.directory, input.label + '.completion.json', {
    exitCode: result.exitCode,
    finishedAt: Date.now(),
  });
  const value: unknown = result.exitCode === 0 ? JSON.parse(result.stdout) : null;
  if (result.exitCode === 0)
    await writeEvidence(input.directory, input.label + '.response.json', value);
  return { exitCode: result.exitCode, value };
}
