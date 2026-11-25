import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { configureWindowsAppIdentity, LINNYA_TOAST_ACTIVATOR_CLSID } from './configureWindowsAppIdentity';

const root = process.cwd();

function createApp(isPackaged: boolean) {
  return { isPackaged, setAppUserModelId: vi.fn(), setToastActivatorCLSID: vi.fn() };
}

it('安装版的标识与安装程序一致', () => {
  const app = createApp(true);
  configureWindowsAppIdentity(app, 'win32');
  const { build } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { build: { appId: string } };
  expect(app.setAppUserModelId).toHaveBeenCalledExactlyOnceWith(build.appId);
  expect(app.setToastActivatorCLSID).toHaveBeenCalledExactlyOnceWith(LINNYA_TOAST_ACTIVATOR_CLSID);
  expect(readFileSync(path.join(root, 'build/installer.nsh'), 'utf8'))
    .toContain(`Software\\Classes\\CLSID\\${LINNYA_TOAST_ACTIVATOR_CLSID}`);
});

it('源码运行和其他系统不动', () => {
  for (const [app, platform] of [[createApp(false), 'win32'], [createApp(true), 'darwin']] as const) {
    configureWindowsAppIdentity(app, platform);
    expect(app.setAppUserModelId).not.toHaveBeenCalled();
    expect(app.setToastActivatorCLSID).not.toHaveBeenCalled();
  }
});
