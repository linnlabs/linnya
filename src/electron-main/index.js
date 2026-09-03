/**
 * @file src/main/index.js
 * @description 应用主进程入口文件。
 * @version 2.0.0
 * @author [Your Name]
 * 
 * @description
 * 该文件是重构后的主进程入口，职责非常单一：
 * 1. 启用字节码缓存并加载 Electron App。
 * 2. 接管受控插件命令或启动桌面 App 生命周期。
 */
import process from 'node:process';

void startNormalAppMode().catch(handleNormalAppBootstrapFailure);

async function startNormalAppMode() {
  require('v8-compile-cache');
  const { app } = require('electron');
  const { bootstrapDevEnv } = require('./bootstrap-env.ts');
  bootstrapDevEnv({
    isPackaged: app.isPackaged,
    developmentRoot: process.cwd(),
  });
  const {
    registerAppProtocolSchemesAsPrivileged,
  } = require('./protocols/registerAppProtocolSchemes.ts');
  registerAppProtocolSchemesAsPrivileged();
  const { claimPrimaryAppInstance } = require('./app-instance');
  const { tryStartPluginCliMode } = require('./command-mode.js');
  if (tryStartPluginCliMode()) return;

  const ownership = claimPrimaryAppInstance({
    app,
    revealPrimaryWindow() {
      void Promise.resolve()
        .then(() => require('./window-manager.js').revealMainWindow())
        .catch(handleMainWindowRevealFailure);
    },
  });
  if (ownership.status === 'primary') {
    if (!app.isPackaged && process.env.LINNYA_DEV_MODE === 'true') {
      const {
        createNodeDevelopmentDataFilesystem,
      } = require('../app-hosts/linnya/adapters/development-data-filesystem/createNodeDevelopmentDataFilesystem.ts');
      const {
        createDevelopmentDataLifecycle,
      } = require('../app-hosts/linnya/application/development-data-lifecycle');
      const developmentDataLifecycle = createDevelopmentDataLifecycle({
        filesystem: createNodeDevelopmentDataFilesystem(),
      });
      await developmentDataLifecycle.ensureReady({
        developmentRoot: process.cwd(),
        appVersion: process.env.APP_VERSION || 'development',
      });
    }

    // 单实例锁已经取得，但启动尚未完成。模块求值和同步初始化必须继续属于同一个
    // bootstrap Promise；否则顶层依赖失败会变成无人接管的 rejection，并留下桌面 owner。
    const { initialize } = require('./app-lifecycle.js');
    await initialize();
  }
}

function writeMainProcessFailure(marker, error) {
  const reason = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${marker}\n${reason}\n`);
}

function handleMainWindowRevealFailure(error) {
  // 第二实例唤醒发生在 App 正常运行期，不应误走启动失败并关闭当前任务；稳定标记让
  // 宿主日志仍能观察失败，同时明确消费异步 import 的 rejection。
  writeMainProcessFailure('linnya.main.reveal_failed', error);
}

async function handleNormalAppBootstrapFailure(error) {
  writeMainProcessFailure('linnya.main.bootstrap_failed', error);
  try {
    const { app } = require('electron');
    app.exit(1);
  } catch {
    // Electron 本身不可加载时没有桌面生命周期可收口，只能让 Node 按失败码退出。
    process.exitCode = 1;
  }
}
