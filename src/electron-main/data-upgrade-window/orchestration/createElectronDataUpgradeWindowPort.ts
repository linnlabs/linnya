import { BrowserWindow, nativeTheme } from 'electron';

import type { DataUpgradeWindowPort } from '../definitions/dataUpgradeWindow';
import {
  DATA_UPGRADE_WINDOW_BACKGROUND,
  formatDataUpgradeProgressStyle,
  renderDataUpgradePage,
  selectDataUpgradeCopy,
} from '../functions/renderDataUpgradePage';

const WINDOW_WIDTH = 360;
const WINDOW_HEIGHT = 240;

/**
 * 无边框、无脚本的小窗口。进度用 insertCSS 更新，页面不能执行脚本、导航或打开新窗口。
 * 用户在升级期间关窗会被拦下：中途退出只会让当前升级步骤回滚、下次启动重来；
 * App 已提交退出（如启动失败）后放行。
 */
export function createElectronDataUpgradeWindowPort(input: {
  readonly locale: string;
  readonly isClosePermitted: () => boolean;
  readonly onFailure: (error: unknown) => void;
}): DataUpgradeWindowPort {
  const copy = selectDataUpgradeCopy(input.locale);
  let window: BrowserWindow | null = null;
  let loaded = false;
  let fraction = 0;
  let appliedStyleKey: string | null = null;
  let styleTail: Promise<void> = Promise.resolve();

  const applyProgress = (): void => {
    styleTail = styleTail.then(async () => {
      const target = window;
      if (!target || !loaded || target.isDestroyed()) return;
      const previous = appliedStyleKey;
      appliedStyleKey = await target.webContents.insertCSS(formatDataUpgradeProgressStyle(fraction));
      if (previous) await target.webContents.removeInsertedCSS(previous);
    }).catch(input.onFailure);
  };

  return Object.freeze({
    open(initialFraction: number) {
      if (window) return;
      fraction = initialFraction;
      const opened = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        useContentSize: true,
        center: true,
        show: false,
        frame: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        title: 'Linnya',
        backgroundColor: nativeTheme.shouldUseDarkColors
          ? DATA_UPGRADE_WINDOW_BACKGROUND.dark
          : DATA_UPGRADE_WINDOW_BACKGROUND.light,
        webPreferences: {
          contextIsolation: true,
          javascript: false,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          spellcheck: false,
        },
      });
      window = opened;
      opened.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      opened.webContents.on('will-navigate', event => event.preventDefault());
      opened.on('close', (event) => {
        if (!input.isClosePermitted()) event.preventDefault();
      });
      opened.once('ready-to-show', () => {
        if (!opened.isDestroyed()) opened.show();
      });
      opened.webContents.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(renderDataUpgradePage({ copy, fraction }))}`,
      ).then(() => {
        loaded = true;
        applyProgress();
      }, input.onFailure);
    },
    setProgress(nextFraction: number) {
      fraction = nextFraction;
      applyProgress();
    },
    hide() {
      if (window && !window.isDestroyed()) window.hide();
    },
    close() {
      const closing = window;
      window = null;
      // destroy 不触发 close 事件，也就不受“升级期间拦截关窗”约束。
      if (closing && !closing.isDestroyed()) closing.destroy();
    },
  });
}
