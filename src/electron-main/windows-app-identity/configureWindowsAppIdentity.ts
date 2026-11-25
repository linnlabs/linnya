import { LINNYA_DESKTOP_APPLICATION_ID } from '../distribution/definitions/desktopDistributionManifest';

/** 系统通知的 COM 激活标识。固定下来，卸载程序才能删掉对应的注册表项（build/installer.nsh 用同一个值）。 */
export const LINNYA_TOAST_ACTIVATOR_CLSID = '{9923EFDD-533C-42B0-9991-1E6D45AA4BAD}' as const;

export interface WindowsIdentityApp {
  readonly isPackaged: boolean;
  setAppUserModelId(id: string): void;
  setToastActivatorCLSID(id: string): void;
}

/**
 * 让运行中的应用与安装程序写进快捷方式的标识一致。不一致时 Electron 会用自己的默认标识改写快捷方式，
 * 系统来不及认出它，第一条通知就不弹横幅，任务栏上固定的图标也会和窗口分开。要在 app ready 之前调用。
 */
export function configureWindowsAppIdentity(app: WindowsIdentityApp, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32' || !app.isPackaged) return;
  app.setAppUserModelId(LINNYA_DESKTOP_APPLICATION_ID);
  app.setToastActivatorCLSID(LINNYA_TOAST_ACTIVATOR_CLSID);
}
