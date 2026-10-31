/** 安装固定的系统隔离支持；不接收命令、路径、账户或 ACL 参数。 */
export interface DesktopCommandIsolationSetupPort {
  ensureReady(): Promise<'ready' | 'cancelled'>;
}
