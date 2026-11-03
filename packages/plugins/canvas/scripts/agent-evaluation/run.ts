import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canvasAgentTaskIds } from './definitions/canvasAgentEvaluation';
import { createCanvasAgentFixture } from './functions/createCanvasAgentFixture';
import { evaluateCanvasAgentRun } from './functions/evaluateCanvasAgentRun';

const [command, input, output] = process.argv.slice(2);
if (command === 'fixtures' && input) {
  await mkdir(input, { recursive: true });
  for (const taskId of canvasAgentTaskIds) await writeFile(path.join(input, `${taskId}.json`), JSON.stringify(createCanvasAgentFixture(taskId), null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ fixtureVersion: 1, tasks: canvasAgentTaskIds, outputDirectory: path.resolve(input) }) + '\n');
} else if (command === 'assess' && input && output) {
  const raw: unknown = JSON.parse(await readFile(input, 'utf8'));
  const report = evaluateCanvasAgentRun(raw);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify(report) + '\n');
  if (report.status === 'failed') process.exitCode = 1;
  if (report.status === 'needs_review' || report.status === 'offline_baseline') process.exitCode = 2;
} else {
  process.stderr.write('Usage: tsx run.ts fixtures <new-output-directory> | assess <run.json> <new-report.json>\n');
  process.exitCode = 64;
}
