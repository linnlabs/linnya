export interface QdrantProcessRuntime {
  /** 安装包内的 Qdrant（旧版本随包分发）；运行时组件不存在时的回退位置，可能不存在。 */
  readonly binaryPath: string;
  /**
   * 启动时才解析实际可执行文件：先用已安装且复核通过的运行时组件，再回退到安装包内的 binaryPath，
   * 都没有时抛出 QdrantRuntimeMissingError。未提供时直接使用 binaryPath（测试夹具）。
   */
  readonly resolveExecutable?: () => Promise<string>;
  readonly platform: Extract<NodeJS.Platform, 'darwin' | 'win32'>;
  /** 已移除代理变量并关闭遥测的完整 child 环境快照。 */
  readonly environment: Readonly<Record<string, string>>;
}

/** 本机既没有已安装的 Qdrant 运行时组件，也没有安装包内的 Qdrant。 */
export class QdrantRuntimeMissingError extends Error {
  constructor(message = 'Qdrant 运行时未安装：请在插件商店重新安装知识库以补齐所需运行时') {
    super(message);
    this.name = 'QdrantRuntimeMissingError';
  }
}
