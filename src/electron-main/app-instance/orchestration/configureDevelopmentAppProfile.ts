import { mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { resolveDevelopmentInstancePaths } from '../../../shared/runtime-paths';
import type { DevelopmentAppProfilePort } from '../definitions/appInstanceOwnership';

/** 在锁与 Chromium session 初始化前隔离 profile；不触碰业务数据 epoch。 */
export function configureDevelopmentAppProfile(input: {
  readonly app: DevelopmentAppProfilePort;
  readonly developmentMode: boolean;
  readonly developmentRoot: string;
  readonly developmentInstanceRootOverride?: string;
}): string | null {
  if (input.app.isPackaged || !input.developmentMode) return null;
  const root = realpathSync(input.developmentRoot);
  const profile = input.app.commandLine.hasSwitch('user-data-dir')
    ? input.app.getPath('userData')
    : resolveDevelopmentInstancePaths(root, input.developmentInstanceRootOverride).profileRoot;
  const session = path.join(profile, 'session');
  mkdirSync(session, { recursive: true });
  input.app.setPath('userData', profile);
  input.app.setPath('sessionData', session);
  console.info(`[AppInstance] development=${root} profile=${profile}`);
  return profile;
}
