import type {
  AppInstanceOwnership,
  AppInstanceOwnershipPort,
} from '../definitions/appInstanceOwnership';

/**
 * 桌面 App 必须在加载会写配置、数据库或日志的生命周期模块之前取得实例锁。
 * registered-command 模式由入口在调用本函数前分流，因此外部 CLI 不会被桌面锁阻断。
 */
export function claimPrimaryAppInstance(input: {
  readonly app: AppInstanceOwnershipPort;
  readonly revealPrimaryWindow: () => void;
}): AppInstanceOwnership {
  if (!input.app.requestSingleInstanceLock()) {
    input.app.quit();
    return Object.freeze({ status: 'secondary' });
  }

  input.app.on('second-instance', input.revealPrimaryWindow);
  return Object.freeze({ status: 'primary' });
}
