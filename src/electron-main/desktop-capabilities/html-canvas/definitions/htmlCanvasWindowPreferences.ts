/**
 * 受管文档窗口共用的窄 Chromium 能力。不能按插件 ID 特判，也不能启用全部实验特性。
 * 旧 Electron 由此开放 DOM→Canvas；升级后光栅器仍须探测实际 API。
 */
export const HTML_CANVAS_BLINK_FEATURES = 'CanvasDrawElement';
