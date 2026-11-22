import validRange from 'semver/ranges/valid.js';
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

const SEMVER_RANGE_MESSAGE = 'must be a valid node-semver range';
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const DOTTED_VERSION = /^\d+(?:\.\d+){1,3}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SHA512_HEX = /^[a-f0-9]{128}$/u;
const ISO_INSTANT = (value: string) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

/** 通用 node-semver range 校验；不启用 loose 或 includePrerelease。 */
export function isValidSemverRange(range: string): boolean {
  const candidate = range.trim();
  return candidate.length > 0 && validRange(candidate) !== null;
}

export const PLUGIN_CATALOG_CHANNELS = ['stable', 'beta'] as const;
export const PLUGIN_RUNTIME_PLATFORMS = ['darwin', 'win32'] as const;
export const PLUGIN_RUNTIME_ARCHITECTURES = ['arm64', 'x64'] as const;
export const SIGNED_PLUGIN_CATALOG_SCHEMA_VERSION = 1 as const;

export const PluginRuntimeRequirementSchema = z.object({
  id: z.string().regex(IDENTIFIER),
  range: z.string().refine(isValidSemverRange, SEMVER_RANGE_MESSAGE),
}).strict();

/** 已签名 catalog 中的插件条目：沿用可发现条目，并锁定 artifact 大小与所需原生运行时。 */
export const SignedPluginCatalogEntrySchema = PluginCatalogEntrySchema.extend({
  id: z.string().regex(IDENTIFIER),
  version: z.string().regex(DOTTED_VERSION),
  minApp: z.string().regex(DOTTED_VERSION).optional(),
  rendererUi: z.string().refine(isValidSemverRange, SEMVER_RANGE_MESSAGE).optional(),
  size: z.number().int().positive(),
  requiresRuntimes: z.array(PluginRuntimeRequirementSchema).default([]),
}).strict();

export const PluginRuntimeTargetSchema = z.object({
  platform: z.enum(PLUGIN_RUNTIME_PLATFORMS),
  architecture: z.enum(PLUGIN_RUNTIME_ARCHITECTURES),
  artifactUrl: z.string().url(),
  sha512: z.string().regex(SHA512_HEX),
  size: z.number().int().positive(),
  /** 解压后可执行文件的相对路径；执行前必须再按 executableSha256 核对。 */
  executable: z.string().min(1).refine(value => {
    const normalized = value.replace(/\\/gu, '/');
    return !normalized.startsWith('/') && !/^[A-Za-z]:/u.test(normalized) &&
      !normalized.split('/').some((segment: string) => segment === '..' || segment === '' || segment === '.');
  }, 'must be a safe relative path'),
  executableSha256: z.string().regex(SHA256_HEX),
}).strict();

export const PluginRuntimeEntrySchema = z.object({
  id: z.string().regex(IDENTIFIER),
  version: z.string().regex(DOTTED_VERSION),
  targets: z.array(PluginRuntimeTargetSchema).min(1),
}).strict();

export const PluginCatalogRevocationSchema = z.object({
  kind: z.enum(['plugin', 'runtime']),
  id: z.string().regex(IDENTIFIER),
  version: z.string().regex(DOTTED_VERSION),
}).strict();

/**
 * 发布方签名的 catalog payload。签名、有效期与回放检查由 Host 完成；
 * 本 schema 只定义可分发数据形状，不授予官方身份。
 */
export const SignedPluginCatalogPayloadSchema = z.object({
  schemaVersion: z.literal(SIGNED_PLUGIN_CATALOG_SCHEMA_VERSION),
  channel: z.enum(PLUGIN_CATALOG_CHANNELS),
  sequence: z.number().int().positive(),
  issuedAt: z.string().refine(ISO_INSTANT, 'must be a UTC ISO instant'),
  expiresAt: z.string().refine(ISO_INSTANT, 'must be a UTC ISO instant'),
  plugins: z.array(SignedPluginCatalogEntrySchema),
  runtimes: z.array(PluginRuntimeEntrySchema).default([]),
  revoked: z.array(PluginCatalogRevocationSchema).default([]),
}).strict();

export type PluginCatalogChannel = (typeof PLUGIN_CATALOG_CHANNELS)[number];
export type PluginRuntimePlatform = (typeof PLUGIN_RUNTIME_PLATFORMS)[number];
export type PluginRuntimeArchitecture = (typeof PLUGIN_RUNTIME_ARCHITECTURES)[number];
export type PluginRuntimeRequirement = z.infer<typeof PluginRuntimeRequirementSchema>;
export type SignedPluginCatalogEntry = z.infer<typeof SignedPluginCatalogEntrySchema>;
export type PluginRuntimeTarget = z.infer<typeof PluginRuntimeTargetSchema>;
export type PluginRuntimeEntry = z.infer<typeof PluginRuntimeEntrySchema>;
export type PluginCatalogRevocation = z.infer<typeof PluginCatalogRevocationSchema>;
export type SignedPluginCatalogPayload = z.infer<typeof SignedPluginCatalogPayloadSchema>;
