import { app, BrowserWindow, dialog } from 'electron';
import type { DesktopCommandIsolationSetupPort } from '../../../app-hosts/linnya/desktop-capabilities';
import type { WindowsNativeRuntimeModuleLoaderOptions } from '../../../infra/adapters/local-process-runtime/windows/functions/loadVerifiedWindowsNativeRuntimeModule';
import { verifyWindowsCommandIsolationHelper } from '../../../infra/adapters/command-runtime/windows/isolation/functions/verifyWindowsCommandIsolationHelper';
import { createWindowsCommandIsolationSetupProcess } from '../../../infra/adapters/command-runtime/windows/isolation/functions/runWindowsCommandIsolationSetup';

/** 并发首次执行共享一个确认/UAC；初始化完成后，命令仍各自独立并行运行。 */
export function createElectronCommandIsolationSetupPort(input: {
  readonly runtime: WindowsNativeRuntimeModuleLoaderOptions;
  readonly environment: Readonly<Record<string, string>>;
}): DesktopCommandIsolationSetupPort {
  let pending: Promise<'ready' | 'cancelled'> | undefined;
  async function ensureReady(): Promise<'ready' | 'cancelled'> {
    const helperPath = await verifyWindowsCommandIsolationHelper(input.runtime);
    const setup = createWindowsCommandIsolationSetupProcess({ helperPath, environment: input.environment });
    if (await setup.status() === 'ready') return 'ready';
    const chinese = app.getLocale().toLowerCase().startsWith('zh');
    const options: Electron.MessageBoxOptions = {
      type: 'info',
      title: chinese ? '启用安全命令执行' : 'Enable safe command execution',
      message: chinese ? '首次运行受限命令，需要完成一次 Windows 设置。' : 'Restricted commands need a one-time Windows setup.',
      detail: chinese
        ? '点击启用后，在 Windows 提示中确认管理员权限。Linnya 会自动完成设置，以保护应用内部数据。'
        : 'Choose Enable, then confirm the Windows administrator prompt. Linnya will configure protection for its internal data automatically.',
      buttons: chinese ? ['启用', '取消'] : ['Enable', 'Cancel'],
      defaultId: 0, cancelId: 1,
      noLink: true,
    };
    const window = BrowserWindow.getFocusedWindow();
    const reply = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
    if (reply.response !== 0) return 'cancelled';
    return setup.enable();
  }
  return {
    ensureReady() {
      pending ??= ensureReady().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
