import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

const resultPath = process.env.LINNYA_AGENT_COMMAND_RESULT_PATH;
const runRoot = process.env.LINNYA_AGENT_COMMAND_RUN_ROOT;

if (!resultPath || !path.isAbsolute(resultPath)) {
  throw new Error('LINNYA_AGENT_COMMAND_RESULT_PATH must be an absolute path');
}
if (!runRoot || !path.isAbsolute(runRoot)) {
  throw new Error('LINNYA_AGENT_COMMAND_RUN_ROOT must be an absolute path');
}

// pathManager 会在模块首次加载时缓存路径，因此隔离必须发生在动态导入生产模块之前。
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
    const { runProductionAgentCommandScenario } = await import('./scenario');
    publishResult(await runProductionAgentCommandScenario({ runRoot }));
  })
  .then(() => app.quit())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    publishResult({ success: false, error: message });
    process.stderr.write(`LINNYA_AGENT_COMMAND_E2E_ERROR=${message}\n`);
    app.exit(1);
  });
