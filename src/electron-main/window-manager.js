/**
 * @file src/main/window-manager.js
 * @description 负责创建和管理浏览器窗口。
 */

/* global process, __dirname */

import { app, BrowserWindow, dialog, Menu, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'path';
import { createMainWindowCloseLifecycle } from './app-lifecycle/orchestration/createMainWindowCloseLifecycle.ts';
import { createWindowClosePreparationHost } from './app-lifecycle/orchestration/createWindowClosePreparationHost.ts';
import {
  WINDOW_CLOSE_PREPARATION_RESULT_CHANNEL,
  WINDOW_CLOSE_RENDERER_READY_CHANNEL,
  WINDOW_CLOSE_REQUEST_CHANNEL,
  WindowClosePreparationResultMessageSchema,
  WindowCloseRendererReadyMessageSchema,
  WindowCloseRequestIdSchema,
} from '../shared/app-lifecycle/definitions/windowCloseProtocol.ts';
import {
  WINDOW_FOCUS_STATE_CHANNEL,
  WindowFocusStateMessageSchema,
} from '../shared/app-lifecycle/definitions/windowFocusProtocol.ts';

// ====================== 模块内变量 ======================
// macOS 交通灯按钮视觉高度通常约为 12-14px，但为了视觉居中，通常 Y 值需要微调
// 对于 36px 的头部，Y=10px 通常比计算出的 12px 看起来更居中
const MAC_TRAFFIC_LIGHT_Y = 10;

// 预加载脚本路径 (__dirname 将由 CJS 环境提供)
// 使用编译后的新版本 TypeScript preload 脚本
const preloadPath = path.join(__dirname, '../..', 'dist/main/preload.js');
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

// 主窗口实例引用
let mainWindow = null;
let windowClosePermitted = false;
let readWindowClosePermission = () => windowClosePermitted;
let mainWindowCloseLifecycle = null;
let requestAppShutdown = null;
let canAcceptWindowRequest = () => true;
let windowClosePreparationHost = null;
let windowCloseProtocolInstalled = false;
let revealWhenCreated = false;
let mainWindowWasCreated = false;

function readLiveMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

async function requestExecutingCommandsCloseDecision(intent) {
  const targetWindow = readLiveMainWindow();
  if (!targetWindow) throw new Error('主窗口已不可用，无法确认运行中命令的关闭方式');

  const installingUpdate = intent === 'install_update';

  const result = await dialog.showMessageBox(targetWindow, {
    type: 'warning',
    title: installingUpdate ? '更新前需要停止任务' : '任务仍在运行',
    message: '仍有命令正在运行',
    detail: installingUpdate
      ? '安装更新将停止当前命令及其全部子进程。'
      : '关闭 Linnya 将停止当前命令及其全部子进程。',
    buttons: installingUpdate ? ['稍后更新', '停止任务并更新'] : ['返回继续', '停止全部并关闭'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1 ? 'stop_and_close' : 'return';
}

function prepareRendererForClose() {
  const targetWindow = readLiveMainWindow();
  if (!targetWindow || targetWindow.webContents.isDestroyed()) {
    // renderer 已经消失时没有可保存的页面状态；继续走 App owner 收口，不能留下无窗口命令。
    return Promise.resolve();
  }

  if (!windowClosePreparationHost) {
    return Promise.reject(new Error('主窗口关闭协议尚未初始化'));
  }
  return windowClosePreparationHost.prepare();
}

function isCurrentMainFrameEvent(event) {
  const targetWindow = readLiveMainWindow();
  if (!targetWindow || event.sender !== targetWindow.webContents) return false;
  return event.senderFrame === targetWindow.webContents.mainFrame;
}

function installWindowCloseProtocol() {
  if (windowCloseProtocolInstalled) return;
  windowCloseProtocolInstalled = true;

  ipcMain.on(WINDOW_CLOSE_RENDERER_READY_CHANNEL, (event, value) => {
    if (!isCurrentMainFrameEvent(event)) return;
    const parsed = WindowCloseRendererReadyMessageSchema.safeParse(value);
    if (!parsed.success) return;
    windowClosePreparationHost?.markRendererReady(parsed.data);
  });

  ipcMain.on(WINDOW_CLOSE_PREPARATION_RESULT_CHANNEL, (event, value) => {
    if (!isCurrentMainFrameEvent(event)) return;
    const parsed = WindowClosePreparationResultMessageSchema.safeParse(value);
    if (!parsed.success) return;
    windowClosePreparationHost?.resolvePreparation(parsed.data);
  });
}

function configureMainWindowCloseLifecycle({
  hasExecutingCommands,
  requestExecutingCommandsDecision = requestExecutingCommandsCloseDecision,
  requestShutdown = async () => {
    const result = await prepareMainWindowForAppShutdown('ordinary_exit');
    if (result === 'ready_to_quit') {
      permitMainWindowCloseForAppShutdown();
      app.quit();
    }
    return result;
  },
  isWindowClosePermitted = () => windowClosePermitted,
  canAcceptWindowRequests = () => true,
}) {
  installWindowCloseProtocol();
  requestAppShutdown = requestShutdown;
  canAcceptWindowRequest = canAcceptWindowRequests;
  readWindowClosePermission = isWindowClosePermitted;
  mainWindowCloseLifecycle = createMainWindowCloseLifecycle({
    hasExecutingCommands,
    // 生产默认使用上面的 native dialog；显式 port 只让真实 Electron E2E 确定性驱动同一关闭链。
    requestExecutingCommandsDecision,
    prepareRendererForClose,
  });
}

function prepareMainWindowForAppShutdown(intent = 'ordinary_exit') {
  if (!mainWindowCloseLifecycle) {
    if (!readLiveMainWindow()) return Promise.resolve('ready_to_quit');
    return Promise.reject(new Error('主窗口关闭生命周期尚未配置'));
  }
  return mainWindowCloseLifecycle.requestClose(intent);
}

/**
 * 关窗许可只能由 App shutdown owner 单向提交。独立窄 port 让窗口 adapter 不需要知道
 * 普通退出、启动失败或更新安装的具体收口流程，也确保迟到 renderer 消息无法撤销许可。
 */
function permitMainWindowCloseForAppShutdown() {
  windowClosePermitted = true;
}

function revealMainWindow() {
  if (!canAcceptWindowRequest()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    // App ready 不等于 Linnya backend ready。首次窗口必须继续由 app-lifecycle 在数据库、
    // IPC 和协议初始化完成后创建；只有已经完成过首次启动的窗口才允许在关闭后重建。
    if (app.isReady() && mainWindowWasCreated) {
      createWindow();
      return;
    }
    revealWhenCreated = true;
    return;
  }
  revealWhenCreated = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function isAllowedMainWindowNavigation(targetUrl) {
  if (process.env.NODE_ENV !== 'development') {
    return targetUrl.startsWith('file://');
  }

  try {
    return new URL(targetUrl).origin === new URL(DEV_SERVER_URL).origin;
  } catch {
    return false;
  }
}

// ====================== 窗口管理 ======================
/**
 * 创建主应用窗口
 */
function createWindow() {
  if (!canAcceptWindowRequest()) return null;
  // 第二次启动可能发生在 App ready 与正常窗口创建之间；窗口 owner 必须幂等，
  // 否则两条生命周期路径会各建一个窗口，并让后创建者覆盖唯一主窗口引用。
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  // 根据平台设置不同的窗口配置
  const isMac = process.platform === 'darwin';
  
  /*
   * 跨平台窗口框架配置：
   * - macOS: 使用原生标题栏 (frame: true + titleBarStyle: 'hiddenInset')
   *   系统会渲染原生的红黄绿按钮，AppHeader 作为覆盖层，左侧留出空间
   * - Windows/Linux: 使用完全自定义的无边框窗口 (frame: false)
   *   AppHeader 包含自定义的窗口控制按钮
   */
  const windowConfig = {
    width: 1400,
    height: 900,
    // 左栏达到 500px 时，仍要给文档主 pane 保留 480px；双 pane 放不下时由布局层临时收起右栏。
    minWidth: 980,
    minHeight: 300, // 设置最小高度，防止窗口过矮
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    }
  };

  if (isMac) {
    // macOS: 使用原生标题栏样式
    windowConfig.frame = true;
    // 改为 'hidden' 模式，这样 trafficLightPosition 的设置才会完全生效且不受系统默认 inset 干扰
    windowConfig.titleBarStyle = 'hidden'; 
    // 与 36px 头部高度对齐，使红黄绿按钮垂直居中
    windowConfig.trafficLightPosition = { x: 12, y: MAC_TRAFFIC_LIGHT_Y };
  } else {
    // Windows/Linux: 使用无边框窗口
    windowConfig.frame = false;
  }

  mainWindow = new BrowserWindow(windowConfig);
  const targetWindow = mainWindow;
  const targetContents = mainWindow.webContents;
  const publishWindowFocusState = (focused) => {
    if (targetContents.isDestroyed()) return;
    const message = WindowFocusStateMessageSchema.parse({
      schema_version: 1,
      kind: 'window_focus_state',
      focused,
    });
    targetContents.send(WINDOW_FOCUS_STATE_CHANNEL, message);
  };
  const closePreparationHost = createWindowClosePreparationHost(targetContents.id, {
    createRequest: identity => ({
      schema_version: 1,
      kind: 'window_close_request',
      renderer_session_id: identity.rendererSessionId,
      request_id: WindowCloseRequestIdSchema.parse(randomUUID()),
    }),
    sendRequest: request => {
      if (targetContents.isDestroyed()) {
        closePreparationHost.rendererUnavailable();
        return;
      }
      targetContents.send(WINDOW_CLOSE_REQUEST_CHANNEL, request);
    },
  });
  windowClosePreparationHost = closePreparationHost;
  targetContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) closePreparationHost.invalidateRenderer();
  });
  targetContents.once('render-process-gone', () => {
    closePreparationHost.rendererUnavailable();
  });
  mainWindowWasCreated = true;
  if (revealWhenCreated) revealMainWindow();
  // SEC-A4-01：主窗口不承载外部页面；外链必须走 open-external-url 的协议白名单。
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedMainWindowNavigation(targetUrl)) {
      event.preventDefault();
    }
  });

  // 根据开发环境加载URL
  if (process.env.NODE_ENV === 'development') {
    // 开发环境使用Vite服务
    // 清除缓存，确保加载最新的前端代码
    mainWindow.webContents.session.clearCache().then(() => {
      mainWindow.loadURL(DEV_SERVER_URL);
    }).catch(err => {
      console.error('[Main Process] Failed to clear cache:', err);
      // 即使清除缓存失败，也尝试加载URL
      mainWindow.loadURL(DEV_SERVER_URL);
    });
    // --- 移除: 不再自动打开 ---
    // mainWindow.webContents.openDevTools(); // 开发环境下自动打开开发工具
  } else {
    // 生产环境加载打包后的HTML
    // __dirname 是 dist/main, index.html 在 ../renderer/index.html
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // +++ 新增：监听窗口最大化/取消最大化事件，并通知渲染进程 +++
  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', false);
    }
  });

  // [macOS 全屏修复] 新增：监听进入/退出全屏事件，并通知渲染进程
  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', true);
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', false);
    }
  });

  // BrowserWindow 才是跨应用切换时的原生窗口焦点真源；macOS 上不能依赖 WebContents first responder。
  targetWindow.on('focus', () => publishWindowFocusState(true));
  targetWindow.on('blur', () => publishWindowFocusState(false));

  // +++ 新增：在窗口加载完成后发送初始的最大化状态 +++
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // [macOS 全屏修复] 同时检查全屏状态
      mainWindow.webContents.send('window-maximized-state', mainWindow.isMaximized() || mainWindow.isFullScreen());
    }
    publishWindowFocusState(targetWindow.isFocused());
  });

  // ++ 移除默认菜单栏 ++
  Menu.setApplicationMenu(null);

  // 最后窗口在 macOS 也代表本地命令 owner 结束。不能只 close BrowserWindow 后让 App 隐藏驻留，
  // 也不能用固定 timeout 越过 renderer 保存；确认后统一转入 App will-quit 收口链。
  mainWindow.on('close', (event) => {
    if (readWindowClosePermission()) return;
    event.preventDefault();
    if (!requestAppShutdown) {
      console.error('[Main Process] App 退出 owner 尚未配置，保持窗口打开');
      return;
    }
    void requestAppShutdown().catch((error) => {
      console.error('[Main Process] 主窗口关闭准备失败，保持窗口打开:', error);
    });
  });

  mainWindow.on('closed', () => {
    closePreparationHost.rendererUnavailable();
    if (windowClosePreparationHost === closePreparationHost) {
      windowClosePreparationHost = null;
    }
    mainWindow = null;
  });
  return mainWindow;
}


// ====================== 导出 ======================

const getMainWindow = () => mainWindow;

export {
  configureMainWindowCloseLifecycle,
  createWindow,
  getMainWindow,
  permitMainWindowCloseForAppShutdown,
  prepareMainWindowForAppShutdown,
  revealMainWindow,
}; 
