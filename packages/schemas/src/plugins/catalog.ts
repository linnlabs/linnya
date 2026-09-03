import { z } from 'zod';

import {
  PluginOwnedFileTypeSchema,
  PluginPermissionSchema,
  type PluginMeta,
  type PluginMetaClassification,
} from './manifest';

/**
 * 官方插件 catalog 的可分发数据合同。
 *
 * catalog 只描述可发现的发布版本与 artifact，不授予“官方”身份，也不替代
 * plugin.json、artifact checksum 或未来的签名验证。
 */
export const PluginCatalogEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  developer: z.string().min(1),
  description: z.string().min(1),
  permissions: z.array(PluginPermissionSchema).optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  ownedFileTypes: z.array(PluginOwnedFileTypeSchema).optional(),
  minApp: z.string().min(1).optional(),
  rendererUi: z.string().min(1).optional(),
  artifactUrl: z.string().url(),
  sha512: z.string().regex(/^[a-f0-9]{128}$/u),
});

export const PluginCatalogSchema = z.object({
  plugins: z.array(PluginCatalogEntrySchema),
});

export type PluginCatalogEntry = z.infer<typeof PluginCatalogEntrySchema>;
export type PluginCatalog = z.infer<typeof PluginCatalogSchema>;

export function parsePluginCatalog(input: unknown): PluginCatalog {
  return PluginCatalogSchema.parse(input);
}

export function pluginMetaFromCatalogEntry(
  entry: PluginCatalogEntry,
  classification: PluginMetaClassification,
): PluginMeta {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description,
    developer: entry.developer,
    builtin: classification.builtin,
    ...(classification.required === undefined ? {} : { required: classification.required }),
    ...(entry.permissions === undefined ? {} : { permissions: entry.permissions }),
    ...(entry.dependsOn === undefined ? {} : { dependsOn: entry.dependsOn }),
    ...(entry.minApp === undefined ? {} : { compatMin: entry.minApp }),
    ...(entry.rendererUi === undefined ? {} : { rendererUiRange: entry.rendererUi }),
    ...(entry.ownedFileTypes === undefined ? {} : { ownedFileTypes: entry.ownedFileTypes }),
  };
}
