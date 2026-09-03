import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

const resultPath = process.env.LINNYA_CHILD_AGENT_RESULT_PATH;
const runRoot = process.env.LINNYA_CHILD_AGENT_RUN_ROOT;
const rootCommand = process.env.LINNYA_CHILD_AGENT_ROOT_COMMAND;
const childCommand = process.env.LINNYA_CHILD_AGENT_CHILD_COMMAND;
const handshakePath = process.env.LINNYA_CHILD_AGENT_HANDSHAKE_PATH;
const overlapObservedPath = process.env.LINNYA_CHILD_AGENT_OVERLAP_OBSERVED_PATH;
const rootReadyPath = process.env.LINNYA_CHILD_AGENT_ROOT_READY_PATH;
const deleteReadyPath = process.env.LINNYA_CHILD_AGENT_DELETE_READY_PATH;
const controllerDonePath = process.env.LINNYA_CHILD_AGENT_CONTROLLER_DONE_PATH;

if (!resultPath || !path.isAbsolute(resultPath)) {
  throw new Error('LINNYA_CHILD_AGENT_RESULT_PATH must be an absolute path');
}
if (!runRoot || !path.isAbsolute(runRoot)) {
  throw new Error('LINNYA_CHILD_AGENT_RUN_ROOT must be an absolute path');
}
if (
  !rootCommand
  || !childCommand
  || !handshakePath
  || !path.isAbsolute(handshakePath)
  || !overlapObservedPath
  || !path.isAbsolute(overlapObservedPath)
  || !rootReadyPath
  || !path.isAbsolute(rootReadyPath)
  || !deleteReadyPath
  || !path.isAbsolute(deleteReadyPath)
  || !controllerDonePath
  || !path.isAbsolute(controllerDonePath)
) {
  throw new Error('production child Agent E2E commands and handshake paths are required');
}

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
    process.stderr.write('LINNYA_CHILD_AGENT_E2E_BOOTSTRAP_READY\n');
    const { runProductionChildAgentScenario } = await import('./scenario');
    publishResult(await runProductionChildAgentScenario({
      runRoot,
      rootCommand,
      childCommand,
      handshakePath,
      overlapObservedPath,
      rootReadyPath,
      deleteReadyPath,
      controllerDonePath,
      runnerRoot: process.env.LINNYA_CHILD_AGENT_RUNNER_ROOT ?? path.join(__dirname, 'commands'),
    }));
  })
  .then(() => app.quit())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    publishResult({ success: false, error: message });
    process.stderr.write(`LINNYA_CHILD_AGENT_E2E_ERROR=${message}\n`);
    app.exit(1);
  });
