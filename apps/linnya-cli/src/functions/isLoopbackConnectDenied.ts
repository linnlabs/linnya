import { isObjectLike } from '@linnya/foundation';

/**
 * 判断连本机端口失败是不是被系统拒绝，而不是对端没在监听。
 *
 * Codex 与 Claude Code 的沙箱（macOS Seatbelt）拦截 loopback 连接时，Node 的 fetch 报
 * `connect EPERM`；App 没在运行或连接描述过期时报 `ECONNREFUSED`。两者修法完全不同：
 * 前者要让命令在沙箱外运行，后者要启动 App。合并成一句“请确认 App 在运行”会让外部 Agent
 * 反复重启或放弃。
 */
export function isLoopbackConnectDenied(error: unknown): boolean {
  if (!isObjectLike(error)) return false;
  const cause = error.cause;
  if (!isObjectLike(cause)) return false;
  return cause.syscall === 'connect' && (cause.code === 'EPERM' || cause.code === 'EACCES');
}
