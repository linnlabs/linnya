/**
 * 一个 JavaScript 运行域在启动时冻结的路径事实。
 *
 * 这些值可以跨进程序列化；禁止把 Electron app、解析函数或整份环境变量混进来。
 */
export interface RuntimePathRoots {
  /** 开发源码与构建命令所处的仓库根；打包后只用于不参与持久化的资源定位。 */
  readonly developmentRoot: string;
  /** 不随 Workspace 迁移的应用私有数据根。 */
  readonly appDataRoot: string;
  /** 当前 Workspace 数据根，已经包含启动时的显式覆盖。 */
  readonly workspaceRoot: string;
  /** Workspace 根是否来自用户或环境显式覆盖。 */
  readonly workspaceRootIsCustom: boolean;
}
