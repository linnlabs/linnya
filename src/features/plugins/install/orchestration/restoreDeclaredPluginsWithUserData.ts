import type { PluginId } from '@app/schemas';

/**
 * 不随包分发、按需安装的官方插件：本机已有它的资料（例如旧版本内置功能留下的数据）但尚未安装时，
 * 启动后在后台从已验签 catalog 自动安装，逐个进行。没有资料的用户（含新用户）不下载。
 * 失败只记诊断，资料不动；下次启动再试。
 */
export async function restoreDeclaredPluginsWithUserData(input: {
  readonly declaredPluginIds: readonly PluginId[];
  /** 未安装、未被用户卸载、没有进行中的数据清理，且确有资料。 */
  readonly shouldRestore: (pluginId: PluginId) => boolean;
  readonly install: (pluginId: PluginId) => Promise<void>;
  readonly recordDiagnostic: (diagnostic: { readonly pluginId: PluginId; readonly level: 'info' | 'error'; readonly message: string }) => void;
}): Promise<readonly PluginId[]> {
  const restored: PluginId[] = [];
  for (const pluginId of input.declaredPluginIds) {
    let eligible = false;
    try {
      eligible = input.shouldRestore(pluginId);
    } catch (error) {
      input.recordDiagnostic({ pluginId, level: 'error', message: `判断是否需要自动安装失败: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (!eligible) continue;
    input.recordDiagnostic({ pluginId, level: 'info', message: '检测到已有资料，开始从插件服务自动安装' });
    try {
      await input.install(pluginId);
      restored.push(pluginId);
    } catch (error) {
      input.recordDiagnostic({ pluginId, level: 'error', message: `自动安装失败，资料保留，下次启动再试: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return restored;
}
