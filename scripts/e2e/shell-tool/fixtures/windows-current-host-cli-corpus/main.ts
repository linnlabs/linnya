import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';
import { createHostProcessEnvironment } from '../../../../../src/infra/adapters/command-runtime/environment';

const resultPath = process.env.LINNYA_WINDOWS_HOST_CLI_RESULT_PATH;
const runRoot = process.env.LINNYA_WINDOWS_HOST_CLI_RUN_ROOT;

if (!resultPath || !path.isAbsolute(resultPath)) {
  throw new Error('LINNYA_WINDOWS_HOST_CLI_RESULT_PATH must be absolute');
}
if (!runRoot || !path.isAbsolute(runRoot)) {
  throw new Error('LINNYA_WINDOWS_HOST_CLI_RUN_ROOT must be absolute');
}

app.setPath('userData', path.join(runRoot, 'electron-user-data'));
process.env.PC54_USER_CLI_SESSION = 'visible-before-app-owner-capture';
const commandHostProcessEnvironment = createHostProcessEnvironment(process.env);
process.env.LINNYA_PC54_LATE_INTERNAL = 'must-not-reach-agent-shell';
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
    const { runWindowsCurrentHostCliCorpusScenario } = await import('./scenario');
    publishResult(await runWindowsCurrentHostCliCorpusScenario({
      runRoot,
      commandHostProcessEnvironment,
    }));
  })
  .then(() => app.quit())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    publishResult({ success: false, error: message });
    process.stderr.write(`LINNYA_WINDOWS_HOST_CLI_ERROR=${message}\n`);
    app.exit(1);
  });
