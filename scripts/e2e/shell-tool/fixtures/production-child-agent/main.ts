import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';
import { requireFixtureAbsolutePath, requireFixtureEnvironment } from '../../harness/requireFixtureEnvironment';

const resultPath = requireFixtureAbsolutePath('LINNYA_CHILD_AGENT_RESULT_PATH');
const runRoot = requireFixtureAbsolutePath('LINNYA_CHILD_AGENT_RUN_ROOT');
const rootCommand = requireFixtureEnvironment('LINNYA_CHILD_AGENT_ROOT_COMMAND');
const childCommand = requireFixtureEnvironment('LINNYA_CHILD_AGENT_CHILD_COMMAND');
const handshakePath = requireFixtureAbsolutePath('LINNYA_CHILD_AGENT_HANDSHAKE_PATH');
const overlapObservedPath = requireFixtureAbsolutePath('LINNYA_CHILD_AGENT_OVERLAP_OBSERVED_PATH');
const rootReadyPath = requireFixtureAbsolutePath('LINNYA_CHILD_AGENT_ROOT_READY_PATH');
const deleteReadyPath = requireFixtureAbsolutePath('LINNYA_CHILD_AGENT_DELETE_READY_PATH');
const controllerDonePath = requireFixtureAbsolutePath('LINNYA_CHILD_AGENT_CONTROLLER_DONE_PATH');

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
