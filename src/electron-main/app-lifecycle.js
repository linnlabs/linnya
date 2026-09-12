/**
 * @file src/main/app-lifecycle.js
 * @description 管理 Electron 应用的生命周期事件，作为应用的启动协调器。
 */

import { app, BrowserWindow, globalShortcut, session, systemPreferences } from 'electron';
import {
  configureMainWindowCloseLifecycle,
  createWindow,
  getMainWindow,
  permitMainWindowCloseForAppShutdown,
  prepareMainWindowForAppShutdown,
} from './window-manager.js';
import { registerIpcHandlers } from './ipc/index.js';
import { registerPluginProtocolHandler } from './plugins/loader/pluginProtocol.ts';
import { registerMediaProtocolHandler } from './protocols/mediaProtocol.ts';
import {
  RequiredBundledPluginSeedError,
} from './plugins/loader/pluginRuntimeBootstrap.ts';
import {
  prepareElectronPluginRuntimeEnvironment,
} from './plugins/loader/prepareElectronPluginRuntimeEnvironment.ts';
import { initializeUpdateManager } from './update-manager.js';
import path from 'path';
import { Logger, enableFileLogging, shutdownDiagnosticLogging } from '../shared/logger.js';
import { getLogDirectory } from '../shared/utils/pathManager.js';
import {
  getBackendLogFilePath,
  prepareActiveLogFileForStartupSync,
  STARTUP_ACTIVE_LOG_MAX_BYTES
} from './services/startup/log-maintenance.js';
import { shouldAllowRendererPermission } from './security/rendererPermissionPolicy.ts';
import { runAppShutdownStages } from './app-lifecycle/runAppShutdownStages.ts';
import { createAppShutdownLifecycle } from './app-lifecycle/orchestration/createAppShutdownLifecycle.ts';
import { createElectronUpdaterHandoff } from './update/orchestration/electronUpdaterHandoff.ts';
import { configureInstallDownloadedUpdateRequest } from './update/orchestration/installDownloadedUpdate.ts';
import { resolveAppDefaultModelsPath } from './app-lifecycle/functions/resolveAppDefaultModelsPath.ts';
import { createHostProcessEnvironment } from '../infra/adapters/command-runtime/environment/index.ts';
import { createNodeEventLoopResponsivenessMonitor } from '../infra/observability/event-loop/index.ts';
import { createBackendBootstrapFacts } from '../app-hosts/linnya/backend-runtime/index.ts';
import { installRuntimePathRoots } from '../shared/runtime-paths/index.ts';
import { installDistributionIdentity } from '../shared/distribution-identity/index.ts';
import { resolveElectronDistributionIdentity } from './distribution/index.ts';
import { resolveBackendRuntimePathRoots } from './app-lifecycle/functions/resolveBackendRuntimePathRoots.ts';
import { resolveAppServerBundleDirectory } from './app-lifecycle/functions/resolveAppServerBundleDirectory.ts';
import { resolveAppVersion } from './app-lifecycle/functions/resolveAppVersion.ts';
import {
  createElectronAppServerRuntime,
  registerBackendRendererRequestIpcHandlers,
} from './app-server-runtime/index.ts';
import { readDirectPluginDirsFromEnv } from './plugins/loader/pluginLayout.ts';
import { registerCommandPermissionSettingsHandlers } from './ipc/handlers/commands/command-permission-settings-ipc.ts';
import { registerCommandApprovalHandlers } from './ipc/handlers/commands/command-approval-ipc.ts';
import { registerCommandCardControlHandlers } from './ipc/handlers/commands/command-card-control-ipc.ts';
import { registerCommandProtectedInputHandler } from './ipc/handlers/commands/command-protected-input-ipc.ts';

const logger = new Logger('app-lifecycle');
// 版本只在 App owner 启动时解析一次，发行身份与 Backend/CLI 共享同一产品事实。
const applicationVersion = resolveAppVersion({
  packaged: app.isPackaged,
  electronApplicationVersion: app.getVersion(),
  developmentApplicationVersion: process.env.APP_VERSION,
});
const distributionResolution = resolveElectronDistributionIdentity({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  applicationVersion,
});
const distributionIdentity = installDistributionIdentity(distributionResolution.identity);
if (distributionResolution.diagnostic) {
  logger.warn(
    `[Distribution] ${distributionResolution.evidence}: ${distributionResolution.diagnostic}`
  );
} else {
  logger.info(
    `[Distribution] kind=${distributionIdentity.kind} evidence=${distributionResolution.evidence}`
  );
}
// 必须早于 plugin/model runtime 向 process.env 写入 Linnya 内部路径。后续命令环境
// 只能沿 app-owner 依赖链使用这份事实，不能在 routes 初始化时重新读取 process.env。
const commandHostProcessEnvironment = createHostProcessEnvironment(process.env);
const runtimePathRoots = installRuntimePathRoots(resolveBackendRuntimePathRoots({
  developmentRoot: app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : process.cwd(),
  userDataDirectory: app.getPath('userData'),
  documentsDirectory: app.getPath('documents'),
  developmentMode: process.env.LINNYA_DEV_MODE === 'true',
  workspaceRootOverride: process.env.LINNYA_WORKSPACE_DIR,
}));
function resolveBackendApiPort() {
  const configuredPort = process.env.LINNYA_API_PORT;
  if (configuredPort === undefined) return 3000;

  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`LINNYA_API_PORT 必须是 1-65535 的整数，实际值: ${configuredPort}`);
  }
  return port;
}

// 设置日志文件路径
const logDirectory = getLogDirectory();
const logFilePath = getBackendLogFilePath(logDirectory);
const preparedLogFile = prepareActiveLogFileForStartupSync({
  logFilePath,
  maxBytes: STARTUP_ACTIVE_LOG_MAX_BYTES
});
if (preparedLogFile.truncated) {
  console.info(
    `[Logger] Active backend log truncated on startup: path=${logFilePath}, ` +
      `originalBytes=${preparedLogFile.originalBytes}, keptBytes=${preparedLogFile.keptBytes}`
  );
}
enableFileLogging(true, logFilePath);


// 确认已导入 electron 和 app 对象
logger.info('Electron app 对象可用: ' + !!app);
logger.info('📁 日志文件路径: ' + logFilePath);

export function initialize() {
  logger.info('初始化应用');

  const mainEventLoopResponsiveness = createNodeEventLoopResponsivenessMonitor({
    component: 'electron-main',
    sampleIntervalMs: 5_000,
    histogramResolutionMs: 20,
    thresholds: {
      p99DelayMs: 25,
      maximumDelayMs: 100,
    },
    onSample(sample) {
      if (sample.thresholdExceeded) {
        logger.warn('[Responsiveness] Electron Main 事件循环超过前端响应性门禁', sample);
        return;
      }
      if (process.env.LINNYA_RESPONSIVENESS_DIAGNOSTICS === 'true') {
        logger.info('[Responsiveness] Electron Main 事件循环采样', sample);
      }
    },
  });
  mainEventLoopResponsiveness.start();
  
  let appServerRuntime;
  const appShutdownLifecycle = createAppShutdownLifecycle({
    prepareAppShutdown: prepareMainWindowForAppShutdown,
    commitWindowClosePermission: permitMainWindowCloseForAppShutdown,
    requestElectronQuit() {
      app.quit();
    },
    async runShutdownStages() {
      logger.info('[Main Process] 开始收口 App 生命周期参与者。');
      try {
        await runAppShutdownStages([
          async () => {
            if (appServerRuntime) {
              logger.info('[Main Process] 正在关停 App Server 及其全部后端子进程...');
              await appServerRuntime.shutdown();
              logger.info('[Main Process] App Server 已关停。');
            }
          },
          async () => {
            mainEventLoopResponsiveness.stop();
          },
        ]);
      } catch (error) {
        logger.error('[Main Process] App 生命周期参与者未完整收口:', error);
        throw error;
      }
    },
    async drainDiagnosticLog() {
      const logShutdown = await shutdownDiagnosticLogging();
      if (logShutdown && !logShutdown.complete) {
        console.warn('[Logger] 退出预算到期，未写入记录将由本次生命周期丢弃。');
      }
    },
    exitElectron(exitCode) {
      app.exit(exitCode);
    },
    updateHandoff: createElectronUpdaterHandoff(),
  });
  configureInstallDownloadedUpdateRequest(onCommitted => (
    appShutdownLifecycle.requestInstallUpdate(onCommitted)
  ));

  // 关闭确认使用动态后端引用，因此生命周期可以在启动初期就接管菜单退出和重开窗口闸门。
  configureMainWindowCloseLifecycle({
    hasExecutingCommands: async () => (
      appServerRuntime
        ? (await appServerRuntime.activity.read()).hasExecutingCommands
        : false
    ),
    requestShutdown: () => appShutdownLifecycle.requestOrdinaryExit(),
    isWindowClosePermitted: () => appShutdownLifecycle.isWindowClosePermitted(),
    canAcceptWindowRequests: () => appShutdownLifecycle.canAcceptWindowRequest(),
  });
  
  try {
    logger.info('调用 initializeUpdateManager...');
    initializeUpdateManager(distributionIdentity);
    logger.info('initializeUpdateManager 调用成功');
  } catch (err) {
    logger.error('初始化更新管理器失败:', err);
  }
  
  // 当Electron完成初始化并准备创建窗口时
  app.whenReady().then(async () => {
    logger.info('🚀 [APP-LIFECYCLE] START | app.whenReady() has resolved.'); // +++ 日志
    let pluginRuntime;
    try {
      pluginRuntime = prepareElectronPluginRuntimeEnvironment();
      logger.info(
        '[PluginRuntime] prepared: ' +
          JSON.stringify({
            userPluginRoot: pluginRuntime.userPluginRoot,
            bundledPluginRoot: pluginRuntime.bundledPluginRoot,
            backendLoadingMode: pluginRuntime.backendLoadingMode,
            seedResults: pluginRuntime.seedResults.map((result) => ({
              pluginId: result.pluginId,
              version: result.version,
              status: result.status,
              reason: result.reason,
            })),
          }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RequiredBundledPluginSeedError) {
        logger.error('[PluginRuntime] required 预置插件准备失败，阻断启动: ' + message);
        throw error;
      }
      logger.warn('[PluginRuntime] 可选预置插件准备失败，应用继续以缺失态启动: ' + message);
      pluginRuntime = Object.freeze({
        userPluginRoot: process.env.LINNYA_PLUGIN_ROOT
          || path.join(app.getPath('userData'), 'plugins'),
        bundledPluginRoot: process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT || null,
        seedResults: [],
        backendLoadingMode: process.env.LINNYA_PLUGIN_BACKEND_LOADING,
      });
    }
    registerPluginProtocolHandler();
    registerMediaProtocolHandler();
    // macOS: 主动请求麦克风权限，并设置权限请求处理器
    if (process.platform === 'darwin') {
      try {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        logger.info(`[Main Process] 当前麦克风权限: ${status}`);
        if (status !== 'granted') {
          const granted = await systemPreferences.askForMediaAccess('microphone');
          logger.info(`[Main Process] askForMediaAccess 返回: ${granted}`);
        }
      } catch (e) {
        logger.warn('[Main Process] 请求麦克风权限时出错: ' + (e && e.message));
      }

      try {
        session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
          if (shouldAllowRendererPermission(permission)) {
            logger.info(`[Permission] 允许 ${permission} 权限: ` + JSON.stringify(details));
            callback(true);
            return;
          }
          // 其他权限默认拒绝；桌面端当前只需要音频采集与剪贴板写入。
          callback(false);
        });
        session.defaultSession.setPermissionCheckHandler((wc, permission) => {
          return shouldAllowRendererPermission(permission);
        });
      } catch (e) {
        logger.warn('[Main Process] 设置 renderer permission handler 出错: ' + (e && e.message));
      }
    }
    // 在后端服务启动前冻结路径；缺少发布资产是构建错误，不能启动一个空目录运行时。
    const defaultModelsResolution = resolveAppDefaultModelsPath({
      configuredPath: process.env.MODEL_REGISTRY_DEFAULTS_PATH,
      applicationPath: runtimePathRoots.developmentRoot,
      developmentRoot: process.cwd(),
      isPackaged: app.isPackaged,
    });
    process.env.MODEL_REGISTRY_DEFAULTS_PATH = defaultModelsResolution.path;
    logger.info(
      '[Main Process] MODEL_REGISTRY_DEFAULTS_PATH=' + defaultModelsResolution.path
        + ' source=' + defaultModelsResolution.source,
    );
    // 为需要联网的用户 Provider 配置 Electron session 代理。
    // 为 session 配置代理，以确保网络请求正常。
    if (process.env.NODE_ENV === 'development') {
        // 中文说明：
        // - 开发环境常见会开系统代理/抓包工具，可能导致用户配置的第三方 Provider 请求异常。
        // - 这里显式使用 direct 模式，确保“所有请求直连”，减少环境噪音。
        logger.info('[Main Process] 开发模式：强制直连（不使用系统代理），确保网络请求稳定。');
        try {
            await session.defaultSession.setProxy({
                mode: 'direct',
            });
            logger.info('[Main Process] ✅ 开发模式代理设置成功：mode=direct');
        } catch (error) {
            logger.error('[Main Process] ❌ 设置开发模式直连代理失败:', error);
        }
    } else { // This is for 'production'
        // 中文说明（重要）：
        // - 生产环境不能把代理“硬编码”到某个本地端口（例如 127.0.0.1:8000）。
        //   否则用户机器上没有对应代理服务时，所有外网请求都会失败（包括更新检查等）。
        // - 我们真正的诉求通常是：当系统设置了公司代理时，访问本地地址（localhost/127.0.0.1/::1）
        //   需要绕过代理（否则会导致对本机后端/API 的请求异常）。
        // - 按 Electron 官方定义：`proxyBypassRules` 需要使用 `<<local>>`（双尖括号）。
        logger.info('[Main Process] 生产模式：使用系统代理配置，并绕过本地地址（<<local>>）。');
        try {
            await session.defaultSession.setProxy({
                mode: 'system',
                // 关键：绕过本地地址，包括 127.0.0.1 / ::1 / localhost
                proxyBypassRules: '<<local>>',
            });
            logger.info('[Main Process] ✅ 生产模式代理设置成功：mode=system, bypass=<<local>>');
        } catch (error) {
            logger.error('[Main Process] ❌ 设置生产模式代理规则失败:', error);
        }
    }
    
    // 步骤 1: 在固定 Node 中启动唯一 App Server Backend owner。
    let appServerIdentity;
    try {
      logger.info('🚀 [APP-LIFECYCLE] STEP 1 (START) | Starting App Server...');
      const mainBundleDirectory = resolveAppServerBundleDirectory({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        developmentMainBundleDirectory: __dirname,
      });
      const backendBootstrap = createBackendBootstrapFacts({
        applicationVersion,
        applicationExecutablePath: process.execPath,
        platform: process.platform,
        architecture: process.arch,
        packaged: app.isPackaged,
        distributionIdentity,
        resourcesPath: process.resourcesPath,
        mainBundleDirectory,
        runtimePathRoots,
        exposeProviderOutboundDebugRoutes: process.env.NODE_ENV !== 'production',
      });
      const backendConfiguration = {
        qdrant: { host: '127.0.0.1', port: 6333 },
        server: { port: resolveBackendApiPort() }
      };
      appServerRuntime = await createElectronAppServerRuntime({
        backendConfiguration,
        backendFacts: backendBootstrap,
        commandHostEnvironment: commandHostProcessEnvironment,
        processEnvironment: process.env,
        runtimePathRoots,
        packaged: app.isPackaged,
        pluginRuntime,
        directPluginDirectories: readDirectPluginDirsFromEnv(),
        backendStderrSink: process.stderr,
        onAsyncFailure: error => logger.error('[App Server] 异步 Desktop RPC 失败', error),
      });
      appServerIdentity = await appServerRuntime.start();
      logger.info('✅ [APP-LIFECYCLE] STEP 1 (END) | App Server ready.', {
        pid: appServerIdentity.pid,
        apiPort: appServerIdentity.apiPort,
      });
    } catch (error) {
      logger.error('❌ [APP-LIFECYCLE] STEP 1 (FAILED) | App Server startup failed:', error);
      throw error;
    }

    // 步骤 2: 保留全部现有 Renderer channel；Main 只做 sender admission 与窄 gateway 转发。
    try {
      logger.info('🚀 [APP-LIFECYCLE] STEP 2 (START) | Registering IPC gateways...');
      await registerBackendRendererRequestIpcHandlers({
        gateway: appServerRuntime.rendererRequests,
      });
      registerCommandPermissionSettingsHandlers({
        gateway: appServerRuntime.commands.permissionSettings,
      });
      registerCommandApprovalHandlers({ host: appServerRuntime.commands.approval });
      registerCommandCardControlHandlers({ host: appServerRuntime.commands.card });
      registerCommandProtectedInputHandler({ host: appServerRuntime.commands.card });
      registerIpcHandlers({
        getPort: () => appServerIdentity.apiPort,
        getToken: () => appServerIdentity.rendererSessionToken,
      });
      logger.info('✅ [APP-LIFECYCLE] STEP 2 (END) | IPC gateways registered.');
    } catch(err) {
      logger.error('❌ [APP-LIFECYCLE] STEP 2 (FAILED) | IPC gateway registration failed:', err);
      throw err;
    }


    // 步骤 3: 创建主窗口。必须先注入 App owner 的窄活动查询；否则窗口关闭无法区分
    // “返回继续”和“停止全部并关闭”，macOS 还会留下没有窗口的活动命令。
    logger.info('🚀 [APP-LIFECYCLE] STEP 3 (START) | Creating main browser window...');
    const mainWindow = createWindow();
    logger.info('✅ [APP-LIFECYCLE] STEP 3 (END) | Main window created.');
    
    // 步骤 4: 将 API 端口号发送给前端
    logger.info('🚀 [APP-LIFECYCLE] STEP 4 (START) | Preparing to send API port to renderer...');
    const port = appServerIdentity.apiPort;
    if (mainWindow && port) {
      const sendPort = () => {
        if (!mainWindow.isDestroyed()) {
          logger.info(`📤 发送 API 端口号: ${port}`);
          mainWindow.webContents.send('set-api-port', port);
        }
      };
      if (mainWindow.webContents.getURL() && !mainWindow.webContents.isLoading()) {
        sendPort();
      } else {
        mainWindow.webContents.once('did-finish-load', sendPort);
      }
    } else {
      logger.error('❌ [APP-LIFECYCLE] STEP 4 (FAILED) | Could not send API port (window or port missing).');
    }
    
    // macOS应用激活时重建窗口
    app.on('activate', () => {
      if (appShutdownLifecycle.canAcceptWindowRequest() && BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    // 注册全局快捷键以切换开发者工具（仅开发环境）
    // 生产环境禁止用户通过快捷键打开 DevTools，防止源码泄露和误操作
    if (process.env.NODE_ENV === 'development') {
      globalShortcut.register('CommandOrControl+Shift+I', () => {
        const mainWindow = getMainWindow();
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.toggleDevTools();
        }
      });
    }
  }).catch((error) => {
    logger.error('[APP-LIFECYCLE] 启动失败，开始收口已创建资源:', error);
    appShutdownLifecycle.requestStartupFailure();
  });

  // 窗口全部关闭时退出应用
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      void appShutdownLifecycle.requestOrdinaryExit().catch((error) => {
        logger.error('[APP-LIFECYCLE] 窗口关闭后的 App 退出准备失败:', error);
      });
    }
  });

  // 菜单退出和 Cmd+Q 先走与最后窗口相同的确认、保存屏障。此时不能销毁任何参与者，
  // 因为用户仍可选择返回继续；owner 提交后第二次 quit 才放行 Electron 原生退出。
  app.on('before-quit', (event) => {
    if (appShutdownLifecycle.isWindowClosePermitted()) return;
    event.preventDefault();
    void appShutdownLifecycle.requestOrdinaryExit().catch((error) => {
      logger.error('[APP-LIFECYCLE] App 退出准备失败，保持应用运行:', error);
    });
  });

  app.on('will-quit', async (event) => {
    // updater handoff 发生前所有 App owner 已收口；此后的 quit 属于 quitAndInstall，host 不能再拦截。
    if (appShutdownLifecycle.isUpdateHandoffInProgress()) return;
    event.preventDefault();
    await appShutdownLifecycle.completeCommittedShutdown();
  });
}
