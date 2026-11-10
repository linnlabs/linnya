'use strict';

// 只给本次启动的主进程注入。Electron 子进程会继承 -r。
if (process.type === 'browser') {
  const Module = require('node:module');
  const electron = require('electron');
  const { app, BrowserWindow } = electron;
  const mode = process.env.LINNYA_PROBE_WINDOW;
  const hidden = mode !== 'visible';
  const width = Number(process.env.LINNYA_PROBE_WIDTH);
  const height = Number(process.env.LINNYA_PROBE_HEIGHT);

  if (hidden) {
    app.setActivationPolicy('accessory');
    app.focus = () => {};
    BrowserWindow.prototype.show = function show() {
      if (mode === 'inactive') this.showInactive();
    };
    BrowserWindow.prototype.focus = () => {};
    BrowserWindow.prototype.moveTop = () => {};
  }

  // 必须拦截构造时的 show。保留原构造器身份，让 getAllWindows() 仍能发现窗口。
  const ProbeWindow = new Proxy(BrowserWindow, {
    construct(target, [options = {}, ...rest], newTarget) {
      const wantsShow = options.show !== false;
      const size = wantsShow ? { width, height, useContentSize: true } : {};
      // JS 定时器持续运行并不保证隐藏窗口继续交换合成帧。只让探针主窗口保持绘制，
      // 避免空闲后首次抓图等待重新提交画面。插件 Worker 保留自己的设置。
      const background = hidden && wantsShow
        ? { webPreferences: { ...options.webPreferences, backgroundThrottling: false } }
        : {};
      const win = Reflect.construct(target, [
        { ...options, ...size, ...background, ...(hidden ? { show: false } : {}) },
        ...rest,
      ], newTarget === ProbeWindow ? target : newTarget);
      if (hidden && wantsShow) {
        // Tooltip 从主进程订阅窗口焦点。只模拟通知，保持系统前台窗口不变。
        win.isFocused = () => !win.isDestroyed();
        win.webContents.on('did-finish-load', () => win.emit('focus'));
      }
      if (wantsShow && mode === 'inactive') win.showInactive();
      console.log(`[probe-bootstrap] window intercepted mode=${mode} wantsShow=${wantsShow}`);
      return win;
    },
  });
  const patched = new Proxy(electron, {
    get(target, key, receiver) {
      return key === 'BrowserWindow' ? ProbeWindow : Reflect.get(target, key, receiver);
    },
  });
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    return request === 'electron' ? patched : originalLoad.call(this, request, parent, isMain);
  };
  // 探针用 SIGINT 结束 Desktop。Electron 默认直接退出，Chromium 来不及把 localStorage 等写盘，
  // 重启后界面偏好与视口记忆就会丢失。改为先写盘再走 app.quit()，与用户正常退出同一条路径。
  process.once('SIGINT', () => {
    const sessions = new Set(electron.webContents.getAllWebContents().map(contents => contents.session));
    if (electron.session.defaultSession) sessions.add(electron.session.defaultSession);
    for (const session of sessions) session.flushStorageData();
    app.quit();
  });
  console.log(`[probe-bootstrap] ok mode=${mode}`);
}
