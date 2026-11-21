import { describe, expect, it } from 'vitest';
import * as shared from '../../../../../src/shared/app-server-health/definitions/appServerHealthMessage';
import * as launcher from './appLauncherRelaunch.mjs';

describe('启动器重开约定', () => {
  it('开发脚本与 Desktop 使用同一环境变量与退出码', () => {
    expect(launcher.APP_LAUNCHER_HANDLES_RELAUNCH_ENV).toBe(shared.APP_LAUNCHER_HANDLES_RELAUNCH_ENV);
    expect(launcher.APP_LAUNCHER_RELAUNCH_EXIT_CODE).toBe(shared.APP_LAUNCHER_RELAUNCH_EXIT_CODE);
  });
});
