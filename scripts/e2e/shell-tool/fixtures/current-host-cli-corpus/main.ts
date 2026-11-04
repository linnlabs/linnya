import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';
import { requireFixtureAbsolutePath } from '../../harness/requireFixtureEnvironment';

const resultPath = requireFixtureAbsolutePath('LINNYA_HOST_CLI_CORPUS_RESULT_PATH');
const runRoot = requireFixtureAbsolutePath('LINNYA_HOST_CLI_CORPUS_RUN_ROOT');

app.setPath('userData', path.join(runRoot, 'electron-user-data'));
process.env.LINNYA_WORKSPACE_DIR = path.join(runRoot, 'workspace');

function publishResult(value: unknown): void {
  const pendingPath = `${resultPath}.${process.pid}.pending`;
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(pendingPath, JSON.stringify(value), 'utf8');
  fs.renameSync(pendingPath, resultPath);
}

app.on('window-all-closed', () => undefined);
app.whenReady()
  .then(async () => {
    const { runCurrentHostCliCorpusScenario } = await import('./scenario');
    publishResult(await runCurrentHostCliCorpusScenario({ runRoot }));
  })
  .then(() => app.quit())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    publishResult({ success: false, error: message });
    process.stderr.write(`LINNYA_HOST_CLI_CORPUS_ERROR=${message}\n`);
    app.exit(1);
  });
