/**
 * @file pluginRuntime.ts
 * @description 插件后端「插件运行态门禁」平台门面。
 *
 * 中文说明：
 * - 通用的按 pluginId 查询/断言插件启用状态的能力，任何插件包都可消费；
 * - 不要在通用 SDK 上为单个插件挂专属函数（如 isXxxPluginRuntimeEnabled）；
 *   插件应传入自己 meta 里的 id 调用通用接口；
 * - 运行态真值由 host plugin registry 维护，插件只读。
 */

export {
  isPluginRuntimeEnabled,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
export {
  assertPluginRuntimeEnabled,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeAccess';
