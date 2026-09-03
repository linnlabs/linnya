import type {
  HostProcessEnvironment,
  InternalHelperEnvironment,
} from '../definitions';

const MACOS_INTERNAL_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const COPIED_NAMES = [
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
] as const;

/**
 * 登录探针需要用户身份与 locale，但不能继承会注入 Node/Python/Bash 代码的宽环境。
 * PATH 固定为系统目录，因为探针只调用 Linnya 选定的绝对系统程序。
 */
export function createMacOsLoginProbeHelperEnvironment(
  host: HostProcessEnvironment,
): InternalHelperEnvironment {
  const entries: Record<string, string> = {
    PATH: MACOS_INTERNAL_PATH,
    SHELL: host.entries.SHELL ?? '/bin/zsh',
    TERM: 'dumb',
  };
  for (const name of COPIED_NAMES) {
    const value = host.entries[name];
    if (value !== undefined) entries[name] = value;
  }
  return Object.freeze({
    kind: 'internal_helper_environment',
    entries: Object.freeze(entries),
  });
}
