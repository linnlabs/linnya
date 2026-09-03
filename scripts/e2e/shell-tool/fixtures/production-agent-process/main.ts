import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

const resultPath = process.env.LINNYA_AGENT_PROCESS_RESULT_PATH;
const runRoot = process.env.LINNYA_AGENT_PROCESS_RUN_ROOT;
const command = process.env.LINNYA_AGENT_PROCESS_COMMAND;
const expectedStart = process.env.LINNYA_AGENT_PROCESS_EXPECTED_START;
const expectedTick = process.env.LINNYA_AGENT_PROCESS_EXPECTED_TICK;
const expectedInteractionPrompt = process.env.LINNYA_AGENT_PROCESS_EXPECTED_INTERACTION_PROMPT;
const expectedInteractionStdin = process.env.LINNYA_AGENT_PROCESS_EXPECTED_INTERACTION_STDIN;
const observationReadyPath = process.env.LINNYA_AGENT_PROCESS_OBSERVATION_READY_PATH;
const workDirectoryHandshakePath = process.env.LINNYA_AGENT_PROCESS_WORK_DIRECTORY_HANDSHAKE_PATH;
const replayTerminalHandle = process.env.LINNYA_AGENT_PROCESS_REPLAY_TERMINAL_HANDLE === '1';

if (!resultPath || !path.isAbsolute(resultPath)) {
  throw new Error('LINNYA_AGENT_PROCESS_RESULT_PATH must be an absolute path');
}
if (!runRoot || !path.isAbsolute(runRoot)) {
  throw new Error('LINNYA_AGENT_PROCESS_RUN_ROOT must be an absolute path');
}
if (
  !command
  || !expectedStart
  || !expectedTick
  || !expectedInteractionPrompt
  || !expectedInteractionStdin
  || !observationReadyPath
  || !path.isAbsolute(observationReadyPath)
  || !workDirectoryHandshakePath
  || !path.isAbsolute(workDirectoryHandshakePath)
) {
  throw new Error('production Agent process command markers are required');
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

async function main(): Promise<void> {
  await app.whenReady();
  const effectiveUserDataRoot = path.resolve(app.getPath('userData'));
  if (effectiveUserDataRoot !== path.resolve(userDataRoot)) {
    throw new Error(
      `Electron userData escaped the isolated run root: ${effectiveUserDataRoot}`,
    );
  }
  const { runProductionAgentProcessScenario } = await import('./scenario');
  publishResult(await runProductionAgentProcessScenario({
    runRoot,
    command,
    expectedStart,
    expectedTick,
    expectedInteractionPrompt,
    expectedInteractionStdin,
    observationReadyPath,
    workDirectoryHandshakePath,
    replayTerminalHandle,
    userDataRoot: effectiveUserDataRoot,
    runnerRoot: process.env.LINNYA_AGENT_PROCESS_RUNNER_ROOT ?? path.join(__dirname, 'commands'),
  }));
  app.quit();
}

app.on('window-all-closed', () => undefined);
void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  publishResult({ success: false, error: message });
  process.stderr.write(`LINNYA_AGENT_PROCESS_E2E_ERROR=${message}\n`);
  app.exit(1);
});
