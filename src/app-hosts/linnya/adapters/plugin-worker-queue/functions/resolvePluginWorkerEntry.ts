import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveInsidePluginDir } from 'src/electron-main/plugins/loader/pluginLayout';

/** 复用 artifact 路径规则；相对入口不能改指向另一个插件的文件。 */
export function resolvePluginWorkerEntry(pluginDirectory: string, entry: string): string {
  if (!entry || path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry)) {
    throw new Error('Plugin Worker 只接受 artifact 内相对入口');
  }
  const directory = realpathSync(pluginDirectory);
  const requested = resolveInsidePluginDir(directory, entry.replace(/\\/g, '/'), 'workerEntry');
  const actual = realpathSync(requested);
  resolveInsidePluginDir(directory, path.relative(directory, actual), 'workerEntry');
  if (!statSync(actual).isFile()) throw new Error('Plugin Worker 入口必须是普通文件');
  return actual;
}
