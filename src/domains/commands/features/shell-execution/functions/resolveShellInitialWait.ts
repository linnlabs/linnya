import { WINDOWS_SHELL_INITIAL_WAIT_FLOOR_MS } from '@app/schemas/commands';

/** Windows 的已验证 transport 下限只影响首次返回，不进入 runner deadline。 */
export function resolveShellInitialWait(params: {
  readonly platform: 'macos' | 'windows';
  readonly requestedMs: number;
}): number {
  return params.platform === 'windows'
    ? Math.max(params.requestedMs, WINDOWS_SHELL_INITIAL_WAIT_FLOOR_MS)
    : params.requestedMs;
}
