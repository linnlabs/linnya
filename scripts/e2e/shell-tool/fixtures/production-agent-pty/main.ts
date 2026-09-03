import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

function requireAbsoluteEnvironmentPath(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

const resultPath = requireAbsoluteEnvironmentPath('LINNYA_AGENT_PTY_RESULT_PATH');
const runRoot = requireAbsoluteEnvironmentPath('LINNYA_AGENT_PTY_RUN_ROOT');
const runnerRoot = requireAbsoluteEnvironmentPath('LINNYA_AGENT_PTY_RUNNER_ROOT');
const interactiveCliSourcePath = requireAbsoluteEnvironmentPath('LINNYA_AGENT_PTY_CLI_SOURCE_PATH');
const nodeExecutable = requireAbsoluteEnvironmentPath('LINNYA_AGENT_PTY_NODE_EXECUTABLE');
const observationReadyPath = requireAbsoluteEnvironmentPath(
  'LINNYA_AGENT_PTY_OBSERVATION_READY_PATH',
);
const workDirectoryHandshakePath = requireAbsoluteEnvironmentPath(
  'LINNYA_AGENT_PTY_WORK_DIRECTORY_HANDSHAKE_PATH',
);
const runToken = process.env.LINNYA_AGENT_PTY_RUN_TOKEN;
if (!runToken) throw new Error('LINNYA_AGENT_PTY_RUN_TOKEN is required');

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
    const { runProductionAgentPtyScenario } = await import('./scenario');
    publishResult(await runProductionAgentPtyScenario({
      runRoot,
      runnerRoot,
      interactiveCliSourcePath,
      nodeExecutable,
      runToken,
      observationReadyPath,
      workDirectoryHandshakePath,
    }));
  })
  .then(() => app.quit())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    publishResult({ success: false, error: message });
    process.stderr.write(`LINNYA_AGENT_PTY_E2E_ERROR=${message}\n`);
    app.exit(1);
  });
