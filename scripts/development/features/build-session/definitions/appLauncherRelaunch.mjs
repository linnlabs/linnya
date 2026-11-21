/**
 * 与 src/shared/app-server-health/definitions/appServerHealthMessage.ts 的同名常量一致：
 * 启动器设置该环境变量后，Desktop 以该退出码请求由启动器重新拉起 Electron。
 * 开发脚本是纯 .mjs，不直接导入 TS 源码；一致性由 appLauncherRelaunch.test.ts 检查。
 */
export const APP_LAUNCHER_HANDLES_RELAUNCH_ENV = 'LINNYA_LAUNCHER_HANDLES_RELAUNCH';
export const APP_LAUNCHER_RELAUNCH_EXIT_CODE = 75;
