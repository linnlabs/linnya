import { promises as fsp } from 'node:fs';

import { app } from 'electron';

import { createElectronSandboxUtilityProcessFork } from '../../../../../src/electron-main/sandbox-runtime/production-runtime/functions/createElectronSandboxUtilityProcessFork';
import { createElectronCommandRunnerProcessPort } from '../../../../../src/electron-main/commands/runner-runtime/createElectronCommandRunnerProcessPort';

const resultPath = process.env['LINNYA_INTERNAL_STDIN_RESULT_PATH'];
const utilityPath = process.env['LINNYA_INTERNAL_STDIN_UTILITY_PATH'];

if (!resultPath || !utilityPath) {
  throw new Error('internal child stdin isolation fixture paths are required');
}

async function publishResult(result: Readonly<Record<string, unknown>>): Promise<void> {
  const pendingPath = `${resultPath}.${process.pid}.pending`;
  await fsp.writeFile(pendingPath, JSON.stringify(result), 'utf8');
  await fsp.rename(pendingPath, resultPath);
}

async function run(): Promise<void> {
  await app.whenReady();
  const sandboxObservation = await new Promise<unknown>((resolve, reject) => {
    const child = createElectronSandboxUtilityProcessFork().fork({
      utilityPath,
      argv: ['sandbox'],
      environment: {},
    });
    child.onMessage(resolve);
    child.onceError((type, location) => {
      reject(new Error(`sandbox utility fatal error: ${type} at ${location}`));
    });
    child.onceExit((exitCode) => {
      if (exitCode !== 0) reject(new Error(`sandbox utility exited with ${exitCode}`));
    });
  });

  const commandObservation = await new Promise<string>((resolve, reject) => {
    let diagnostics = '';
    const port = createElectronCommandRunnerProcessPort({
      runnerPath: utilityPath,
      helperEnvironment: {},
      platformRuntime: { schema_version: 1, platform: 'darwin' },
    });
    port.fork({
      onMessage() {},
      onDiagnostic(bytes) {
        diagnostics += Buffer.from(bytes).toString('utf8');
      },
      onDisconnect() {},
      onError(error) { reject(error); },
      onClose() { resolve(diagnostics.trim()); },
    });
  });

  await publishResult({
    success: true,
    sandboxObservation,
    commandObservation: JSON.parse(commandObservation),
  });
  app.exit(0);
}

void run().catch(async (error: unknown) => {
  await publishResult({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });
  app.exit(1);
});
