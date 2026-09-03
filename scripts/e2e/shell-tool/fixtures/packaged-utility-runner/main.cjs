/* global process, require */

const { app, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const resultPath = process.env.LINNYA_UTILITY_RUNNER_RESULT_PATH;
const runMode = process.env.LINNYA_UTILITY_RUNNER_MODE ?? 'suite';

if (!resultPath || !path.isAbsolute(resultPath)) {
  throw new Error('LINNYA_UTILITY_RUNNER_RESULT_PATH must be an absolute path');
}
if (runMode !== 'suite' && runMode !== 'owner-crash') {
  throw new Error(`unknown utility runner mode: ${runMode}`);
}

function publishResult(value) {
  const pendingPath = `${resultPath}.${process.pid}.pending`;
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(pendingPath, JSON.stringify(value));
  fs.renameSync(pendingPath, resultPath);
}

// Electron ready 监听必须在短入口中建立；较长实现只在 ready 后加载，避免打包态启动空转。
app.on('window-all-closed', () => undefined);
app.whenReady()
  .then(async () => {
    const { runPackagedUtilityRunnerValidation } = require('./validation-suite.cjs');
    await runPackagedUtilityRunnerValidation({
      app,
      utilityProcess,
      resultPath,
      runMode,
      publishResult,
    });
  })
  .then(() => app.quit())
  .catch((error) => {
    const failure = {
      success: false,
      status: 'failed',
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      error: error instanceof Error ? error.stack : String(error),
    };
    publishResult(failure);
    process.stderr.write(`LINNYA_UTILITY_RUNNER_ERROR=${failure.error}\n`);
    app.exit(1);
  });
