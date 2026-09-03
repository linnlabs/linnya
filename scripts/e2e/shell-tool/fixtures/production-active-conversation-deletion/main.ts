import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

function requireAbsoluteEnvironmentPath(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

const resultPath = requireAbsoluteEnvironmentPath('LINNYA_ACTIVE_DELETION_RESULT_PATH');
const runRoot = requireAbsoluteEnvironmentPath('LINNYA_ACTIVE_DELETION_RUN_ROOT');
const runnerRoot = requireAbsoluteEnvironmentPath('LINNYA_ACTIVE_DELETION_RUNNER_ROOT');
const handshakePath = requireAbsoluteEnvironmentPath('LINNYA_ACTIVE_DELETION_HANDSHAKE_PATH');
const controllerDonePath = requireAbsoluteEnvironmentPath(
  'LINNYA_ACTIVE_DELETION_CONTROLLER_DONE_PATH',
);
const command = process.env.LINNYA_ACTIVE_DELETION_COMMAND;
if (!command) throw new Error('LINNYA_ACTIVE_DELETION_COMMAND is required');

const userDataRoot = path.join(runRoot, 'electron-user-data');
const workspaceRoot = path.join(runRoot, 'workspace');
fs.mkdirSync(userDataRoot, { recursive: true });
fs.mkdirSync(workspaceRoot, { recursive: true });
app.setPath('userData', userDataRoot);
process.env.LINNYA_WORKSPACE_DIR = workspaceRoot;

function publishResult(value: unknown): void {
  const pendingPath = `${resultPath}.${process.pid}.pending`;
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(pendingPath, JSON.stringify(value), 'utf8');
  fs.renameSync(pendingPath, resultPath);
}

app.on('window-all-closed', () => undefined);
app.whenReady()
  .then(async () => {
    const { runProductionActiveConversationDeletionScenario } = await import('./scenario');
    publishResult(await runProductionActiveConversationDeletionScenario({
      runRoot,
      runnerRoot,
      command,
      handshakePath,
      controllerDonePath,
    }));
  })
  .then(() => app.quit())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    publishResult({ success: false, error: message });
    process.stderr.write(`LINNYA_ACTIVE_DELETION_E2E_ERROR=${message}\n`);
    app.exit(1);
  });
