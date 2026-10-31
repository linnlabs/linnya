import { execFile } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);

/** Windows 的 mode=600 不改变 DACL，必须在临时文件尚为空时设置真实权限。 */
export async function restrictCredentialFileAccess(filePath: string): Promise<void> {
  if (process.platform !== 'win32') {
    await chmod(filePath, 0o600);
    return;
  }
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.isAbsolute(systemRoot))
    throw new Error('Windows SystemRoot unavailable');
  const systemDirectory = path.join(systemRoot, 'System32');
  const identity = await executeFile(
    path.join(systemDirectory, 'whoami.exe'),
    ['/user', '/fo', 'csv', '/nh'],
    {
      windowsHide: true,
    }
  );
  // 本地/域账号和 Entra 账号的 SID authority 不同；不按本机测试账号的前缀限定用户身份。
  const sid = identity.stdout.match(/"(S-1-\d+(?:-\d+)+)"/u)?.[1];
  if (!sid) throw new Error('Windows current user SID unavailable');
  await executeFile(
    path.join(systemDirectory, 'icacls.exe'),
    [filePath, '/inheritance:r', '/grant:r', `*${sid}:(F)`, '*S-1-5-18:(F)'],
    { windowsHide: true }
  );
}
