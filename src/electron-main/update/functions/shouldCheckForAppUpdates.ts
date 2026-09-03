export interface AppUpdateCheckEnvironment {
  readonly LINNYA_DEV_MODE?: string;
  readonly LINNYA_DISABLE_UPDATE_CHECKS?: string;
}

/** 源码开发不自动连接正式发行服务；发布态仍可按现有更新流程检查。 */
export function shouldCheckForAppUpdates(environment: AppUpdateCheckEnvironment): boolean {
  if (environment.LINNYA_DEV_MODE === 'true') return false;
  return environment.LINNYA_DISABLE_UPDATE_CHECKS !== '1';
}
