import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { SourceCheckoutIdentity } from '../definitions/sourceCheckoutIdentity';

/** 真实目录用于配对；分支只是诊断信息，不作为实例身份。 */
export function readSourceCheckoutIdentity(directory: string): SourceCheckoutIdentity {
  // 原生解析会展开 Windows 8.3 短名；不能把同一 checkout 的短名和长名当成不同实例。
  const root = realpathSync.native(directory);
  const git = spawnSync('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
    encoding: 'utf8',
    timeout: 2000,
    windowsHide: true,
  });
  return { root, branch: git.status === 0 ? git.stdout.trim() || null : null };
}
