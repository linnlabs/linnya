import { execFileSync } from 'node:child_process';
import { z } from 'zod';

const consoleSchema = z.object({ IOConsoleLocked: z.boolean(), IOConsoleUsers: z.array(z.object({
  kCGSSessionOnConsoleKey: z.boolean(), kCGSessionLoginDoneKey: z.boolean(), CGSSessionScreenIsLocked: z.boolean().optional(),
})) });
/** powerMonitor在Mac锁屏后启动时可能仍返回idle；硬件验收必须读取当前console事实。 */
export function readNativeSessionState() {
  if (process.platform !== 'darwin') return null;
  const plist = execFileSync('/usr/sbin/ioreg', ['-n', 'Root', '-d1', '-a']);
  const json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, encoding: 'utf8' });
  // Schema只保留这些boolean，原始session中的用户身份/目录不会进入报告或日志。
  const root = consoleSchema.parse(JSON.parse(json));
  const active = root.IOConsoleUsers.find(session => session.kCGSSessionOnConsoleKey && session.kCGSessionLoginDoneKey);
  return { method: 'macos-ioreg-console', time: new Date().toISOString(), onConsole: active?.kCGSSessionOnConsoleKey ?? false,
    loggedIn: active?.kCGSessionLoginDoneKey ?? false, consoleLocked: root.IOConsoleLocked,
    sessionLocked: active?.CGSSessionScreenIsLocked ?? null,
    unlocked: active !== undefined && !root.IOConsoleLocked && active.CGSSessionScreenIsLocked !== true };
}
