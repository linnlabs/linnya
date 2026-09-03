declare module 'node-pty' {
  interface NodePtyDisposable {
    dispose(): void;
  }

  interface NodePtyExitEvent {
    readonly exitCode: number;
    readonly signal?: number;
  }

  interface IPty {
    readonly pid: number;
    onData(listener: (data: unknown) => void): NodePtyDisposable;
    onExit(listener: (event: NodePtyExitEvent) => void): NodePtyDisposable;
    on(event: 'error', listener: (error: Error) => void): void;
    removeListener(event: 'error', listener: (error: Error) => void): void;
    pause(): void;
    resume(): void;
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(signal?: string): void;
  }

  /**
   * 生产包会主动删除 node-pty 的源码与 typings，只保留固定版本的运行文件和目标
   * 架构制品；因此这里声明 Linnya 真正使用的窄边界，避免构建类型依赖被裁剪内容。
   */
  function spawn(
    executablePath: string,
    argv: readonly string[],
    options: {
      readonly cols: number;
      readonly rows: number;
      readonly cwd: string;
      readonly env: Readonly<Record<string, string>>;
      readonly encoding: null;
    },
  ): IPty;
}
