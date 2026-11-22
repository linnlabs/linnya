import * as z from 'zod';

import { PluginOperationErrorCodeSchema } from './errors';
import { PluginPermissionSchema } from './manifest';

/** 插件所需运行时在本机的情况；已安装且复核通过的不再下载。 */
export const PluginRemoteCatalogRuntimeSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  downloadBytes: z.number().int().nonnegative(),
  unpackedBytes: z.number().int().nonnegative(),
  installed: z.boolean(),
});

export const PluginRemoteCatalogAvailabilitySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('installable'),
    /** 本次实际要下载的字节数：插件包加未安装的运行时。 */
    downloadBytes: z.number().int().nonnegative(),
    /** 本次新增的磁盘占用：插件解压后加未安装运行时解压后。 */
    unpackedBytes: z.number().int().nonnegative(),
    runtimes: z.array(PluginRemoteCatalogRuntimeSchema),
  }),
  /** 最高版本要求更新的 Linnya。 */
  z.object({ status: z.literal('requires-app-update'), minApp: z.string().min(1) }),
  /** 其他兼容性原因（例如界面组件版本范围不匹配）。 */
  z.object({ status: z.literal('incompatible') }),
  /** catalog 没有本平台所需的运行时。 */
  z.object({ status: z.literal('unsupported-platform') }),
]);

/** 商店展示用的远程插件条目；展示字段来自已验签 catalog，安装后的登记仍以下载内容中的 plugin.json 为准。 */
export const PluginRemoteCatalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  developer: z.string().min(1),
  version: z.string().min(1),
  permissions: z.array(PluginPermissionSchema).optional(),
  availability: PluginRemoteCatalogAvailabilitySchema,
});

export const PluginRemoteCatalogResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), items: z.array(PluginRemoteCatalogItemSchema) }),
  /** 当前构建不提供远程服务（源码运行、社区打包或服务未开放），不发出任何网络请求。 */
  z.object({ status: z.literal('disabled') }),
  /** 拉取或验签失败；已安装插件不受影响。 */
  z.object({ status: z.literal('unavailable'), code: PluginOperationErrorCodeSchema }),
]);

export type PluginRemoteCatalogRuntime = z.infer<typeof PluginRemoteCatalogRuntimeSchema>;
export type PluginRemoteCatalogAvailability = z.infer<typeof PluginRemoteCatalogAvailabilitySchema>;
export type PluginRemoteCatalogItem = z.infer<typeof PluginRemoteCatalogItemSchema>;
export type PluginRemoteCatalogResult = z.infer<typeof PluginRemoteCatalogResultSchema>;
