/** Worker isolate 必须内联的窄 SDK 实现；Backend 模块表不向 Worker 共享。 */
export function pluginWorkerSdkAliases(repositoryRoot: string): Record<string, string>;
