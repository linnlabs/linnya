import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

function requiredAbsolutePath(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}
const resultPath = requiredAbsolutePath('LINNYA_COMMAND_APPROVAL_DOM_RESULT_PATH');
const runRoot = requiredAbsolutePath('LINNYA_COMMAND_APPROVAL_DOM_RUN_ROOT');
const preloadPath = requiredAbsolutePath('LINNYA_COMMAND_APPROVAL_DOM_PRELOAD_PATH');
const runnerPath = requiredAbsolutePath('LINNYA_COMMAND_APPROVAL_DOM_RUNNER_PATH');
const rendererUrl = process.env.LINNYA_COMMAND_APPROVAL_DOM_RENDERER_URL;
if (!rendererUrl) throw new Error('LINNYA_COMMAND_APPROVAL_DOM_RENDERER_URL is required');

app.setPath('userData', path.join(runRoot, 'electron-user-data'));

function publishResult(value: unknown): void {
  const pendingPath = `${resultPath}.${process.pid}.pending`;
  fs.writeFileSync(pendingPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(pendingPath, resultPath);
}

app.on('window-all-closed', () => undefined);
app.whenReady()
  .then(async () => {
    const { runProductionCommandApprovalDomScenario } = await import('./scenario');
    publishResult(await runProductionCommandApprovalDomScenario({
      runRoot,
      rendererUrl,
      preloadPath,
      runnerPath,
    }));
  })
  .then(() => app.quit())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    publishResult({ success: false, error: message });
    process.stderr.write(`LINNYA_COMMAND_APPROVAL_DOM_E2E_ERROR=${message}\n`);
    app.exit(1);
  });
