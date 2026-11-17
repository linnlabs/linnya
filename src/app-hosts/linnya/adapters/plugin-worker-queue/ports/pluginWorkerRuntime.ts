/** App composition 注入一次正式 Host 入口；公开插件 SDK 不允许选择启动器。 */
let bootstrapScriptPath: string | undefined;

export function installPluginWorkerRuntime(path: string): () => void {
  bootstrapScriptPath = path;
  return () => { if (bootstrapScriptPath === path) bootstrapScriptPath = undefined; };
}

export function getPluginWorkerBootstrapScriptPath(): string {
  if (!bootstrapScriptPath) throw new Error('Host 插件 Worker runtime 尚未安装');
  return bootstrapScriptPath;
}
