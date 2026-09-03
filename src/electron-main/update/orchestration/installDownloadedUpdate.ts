import type { AppShutdownRequestOutcome } from '../../app-lifecycle/definitions/appShutdownLifecycle';
import type {
  UpdateInstallingInfo,
  UpdateMessageChannel,
  UpdateMessagePayload,
} from '../../../shared/update/definitions/updateMessage';

export interface InstallDownloadedUpdateOptions {
  readonly source: string;
  readonly sendStatus: (channel: UpdateMessageChannel, payload?: UpdateMessagePayload) => void;
  readonly log: (message: string, ...args: unknown[]) => void;
  readonly logError: (message: string, ...args: unknown[]) => void;
}

export interface InstallDownloadedUpdateResult {
  readonly success: boolean;
  readonly alreadyRequested: boolean;
  readonly outcome?: AppShutdownRequestOutcome;
}

type RequestInstallUpdate = (
  onCommitted: () => void,
) => Promise<AppShutdownRequestOutcome>;

let requestInstallUpdate: RequestInstallUpdate | undefined;
let installRequested = false;

export function configureInstallDownloadedUpdateRequest(
  request: RequestInstallUpdate,
): () => void {
  requestInstallUpdate = request;
  return () => {
    if (requestInstallUpdate === request) requestInstallUpdate = undefined;
  };
}

function buildInstallingInfo(): UpdateInstallingInfo {
  return {
    requestedAt: new Date().toISOString(),
    platform: process.platform,
  };
}

export async function installDownloadedUpdate(
  options: InstallDownloadedUpdateOptions,
): Promise<InstallDownloadedUpdateResult> {
  if (installRequested) {
    options.log(`更新安装请求已在处理中，忽略重复请求。source=${options.source}`);
    return { success: true, alreadyRequested: true };
  }
  if (!requestInstallUpdate) {
    options.logError('App shutdown owner 尚未接管更新安装请求。');
    options.sendStatus('error', '更新安装尚未就绪');
    return { success: false, alreadyRequested: false };
  }

  installRequested = true;
  try {
    const outcome = await requestInstallUpdate(() => {
      options.log(`更新安装已提交，开始收口应用资源。source=${options.source}`);
      options.sendStatus('installing', buildInstallingInfo());
    });
    if (outcome === 'kept_open') {
      options.log('用户选择稍后更新，应用继续运行。');
      options.sendStatus('update-downloaded');
      return { success: true, alreadyRequested: false, outcome };
    }
    if (outcome === 'update_not_ready') {
      options.logError('更新尚未下载完成，拒绝安装请求。');
      options.sendStatus('error', '更新尚未下载完成');
      return { success: false, alreadyRequested: false, outcome };
    }
    if (outcome === 'intent_conflict') {
      options.log('应用正在处理另一项退出请求，本次更新安装未接管生命周期。');
      return { success: false, alreadyRequested: false, outcome };
    }
    return { success: true, alreadyRequested: false, outcome };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '更新安装失败';
    options.logError('更新安装请求失败:', error);
    options.sendStatus('error', message);
    return { success: false, alreadyRequested: false };
  } finally {
    installRequested = false;
  }
}
