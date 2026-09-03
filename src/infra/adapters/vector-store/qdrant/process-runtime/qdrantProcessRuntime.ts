export interface QdrantProcessRuntime {
  readonly binaryPath: string;
  readonly platform: Extract<NodeJS.Platform, 'darwin' | 'win32'>;
  /** 已移除代理变量并关闭遥测的完整 child 环境快照。 */
  readonly environment: Readonly<Record<string, string>>;
}
