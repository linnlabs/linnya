export interface PluginVectorRuntime {
  /** 调用方取消只停止自己的等待，不中断其他调用者共享的启动。 */
  ensureReady(signal?: AbortSignal): Promise<string>;
  /** 失败仍保留 owner，可由同一退出流程重试。 */
  stop(): Promise<void>;
}

/** 只创建产品已装配的本地向量服务，不接受可执行文件、端口、环境或外部地址。 */
export declare function createPluginVectorRuntime(pluginId: string): PluginVectorRuntime;
