import { z } from 'zod';

import { isValidRendererUiCompatibilityRange } from './renderer-ui-compatibility';

/**
 * 插件 manifest 契约。
 *
 * 中文说明：manifest 是插件身份、展示信息、运行入口和数据归属的真源；
 * artifact 字段只描述发布产物，不替代 runtime entry。
 */

/** 插件唯一 ID，例如 'platform'、'canvas-tools'。 */
export type PluginId = string;

/** 插件权限。当前只占位，未来第三方插件市场再真正执行权限校验。 */
export type PluginPermission = 'workspaceWrite' | 'knowledgeBase' | 'network' | 'filesystem';

/** 插件贡献点类型，用于诊断和设置页展示。 */
export type PluginCapabilityKind =
  | 'tool'
  | 'agent'
  | 'subagentType'
  | 'documentType'
  | 'toolCard'
  | 'createAction'
  | 'nodeAction'
  | 'entityReference'
  | 'documentTypeHook'
  | 'ipc'
  | 'route'
  | 'migration'
  | 'schemaProvider'
  | 'sandboxProfile'
  | 'hiddenWorker'
  | 'runtimeEffect'
  | 'pluginCli';

export type PluginSource = 'builtin' | 'local' | 'remote';

/** 插件安装态。missing 表示系统知道这个插件，但当前未安装。 */
export type PluginInstallState = 'enabled' | 'disabled' | 'missing';

export interface PluginMeta {
  id: PluginId;
  name: string;
  version: string;
  description: string;
  developer: string;
  /** builtin 表示插件代码随应用发布；是否允许禁用/卸载由 required 决定。 */
  builtin: boolean;
  /** required=true 表示平台核心能力，不能禁用或卸载。 */
  required?: boolean;
  permissions?: PluginPermission[];
  /** 依赖的其它插件。启用/安装前必须确保依赖已安装并启用。 */
  dependsOn?: PluginId[];
  /** 当前主应用需要满足的最低版本，来自插件 manifest 的 compat.minApp。 */
  compatMin?: string;
  /** Renderer entry 允许使用的 @linnya/renderer-ui SemVer range。 */
  rendererUiRange?: string;
  /** 插件拥有的文件/节点类型归属声明；用于插件缺失时给出安装引导，不代表运行时能力已可用。 */
  ownedFileTypes?: PluginOwnedFileType[];
}

export interface PluginStateView {
  meta: PluginMeta;
  state: PluginInstallState;
  /** disabled/missing 或操作失败时给设置页展示的人类可读原因；missing 时用于区分从未安装与用户主动卸载。 */
  reason?: string;
}

export interface PluginStoreListItem extends PluginStateView {}

export interface PluginStoreDetail extends PluginStoreListItem {
  /** 插件包在当前来源中的本地体积，用于插件详情页展示。 */
  sizeBytes?: number;
  homepage?: string;
  details?: string[];
  releaseNotes?: PluginManifestReleaseNote[];
  skills?: PluginManifestSkill[];
  agents?: PluginManifestAgent[];
}

export type PluginRemoteInstallSkippedReason = 'current' | 'incompatible';

export type PluginRemoteUpdateCheckResult =
  | {
      status: 'available';
      pluginId: PluginId;
      currentVersion: string | null;
      latestVersion: string;
      minApp?: string;
      rendererUi?: string;
    }
  | {
      status: 'current';
      pluginId: PluginId;
      currentVersion: string;
      latestVersion: string;
    }
  | {
      status: 'incompatible';
      pluginId: PluginId;
      currentVersion: string | null;
      latestVersion: string;
      detail: string;
    }
  | {
      status: 'failed';
      pluginId: PluginId;
      currentVersion: string | null;
      latestVersion: string | null;
      error: string;
    };

export type PluginRemoteInstallResult =
  | {
      status: 'installed';
      pluginId: PluginId;
      version: string;
      previousVersion: string | null;
      restartRequired: true;
    }
  | {
      status: 'skipped';
      pluginId: PluginId;
      version: string;
      reason: PluginRemoteInstallSkippedReason;
      detail?: string;
    }
  | {
      status: 'failed';
      pluginId: PluginId;
      version: string | null;
      error: string;
    };

export type PluginDiagnosticLevel = 'error' | 'warn' | 'info';

export interface PluginDiagnosticView {
  level: PluginDiagnosticLevel;
  pluginId: PluginId | null;
  capability: PluginCapabilityKind | null;
  message: string;
  at: number;
}

export const PluginPermissionSchema = z.enum([
  'workspaceWrite',
  'knowledgeBase',
  'network',
  'filesystem',
]);

export const PluginSourceSchema = z.enum(['builtin', 'local', 'remote']);

export const PluginManifestEntrySchema = z
  .object({
    backend: z.string().min(1).optional(),
    renderer: z.string().min(1).optional(),
  })
  .catchall(z.string().min(1))
  .refine(entry => Object.keys(entry).length > 0, {
    message: 'plugin manifest entry must declare at least one entrypoint',
  });

export const PluginManifestCompatSchema = z
  .object({
    minApp: z.string().min(1).optional(),
    rendererUi: z.string().min(1).refine(isValidRendererUiCompatibilityRange, {
      message: 'compat.rendererUi must be a valid node-semver range',
    }).optional(),
  })
  .passthrough();

export const PluginManifestMigrationSchema = z.object({
  version: z.number().int().positive(),
  description: z.string().min(1),
});

export const PluginManifestArtifactSchema = z
  .object({
    /** 发布产物入口；完整性与真实性由发布元数据负责，不能在插件自述 manifest 中声明。 */
    entry: PluginManifestEntrySchema.optional(),
  })
  .strict();

export const PluginManifestAssetPathSchema = z
  .string()
  .min(1)
  .refine(
    value => {
      const normalized = value.replace(/\\/g, '/');
      return !normalized.startsWith('/') && !normalized.split('/').includes('..');
    },
    {
      message: 'plugin manifest asset path must stay inside the plugin package',
    }
  );

export const PluginManifestCapabilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const PluginManifestSkillSchema = PluginManifestCapabilitySchema;
export const PluginManifestAgentSchema = PluginManifestCapabilitySchema;

export const PluginManifestReleaseNoteSchema = z.object({
  version: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

export const PluginOwnedFileTypeSchema = z.object({
  nodeType: z.string().min(1),
  extension: z.string().min(2).startsWith('.'),
  label: z.string().min(1),
});

function hasStrictlyIncreasingMigrationVersions(
  migrations: readonly z.infer<typeof PluginManifestMigrationSchema>[]
): boolean {
  for (let index = 1; index < migrations.length; index += 1) {
    const previous = migrations[index - 1];
    const current = migrations[index];
    if (!previous || !current || current.version <= previous.version) {
      return false;
    }
  }
  return true;
}

export const PluginManifestSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    developer: z.string().min(1),
    details: z.array(z.string().min(1)).min(1),
    releaseNotes: z.array(PluginManifestReleaseNoteSchema).optional(),
    screenshots: z.array(PluginManifestAssetPathSchema).optional(),
    homepage: z.string().url().optional(),
    skills: z.array(PluginManifestSkillSchema).optional(),
    agents: z.array(PluginManifestAgentSchema).optional(),
    entry: PluginManifestEntrySchema,
    dependsOn: z.array(z.string().min(1)).optional(),
    permissions: z.array(PluginPermissionSchema).optional(),
    compat: PluginManifestCompatSchema.optional(),
    ownedFileTypes: z.array(PluginOwnedFileTypeSchema).default([]),
    ownedTables: z.array(z.string().min(1)).default([]),
    migrations: z.array(PluginManifestMigrationSchema).default([]),
    artifact: PluginManifestArtifactSchema.optional(),
  })
  .passthrough()
  .refine(manifest => hasStrictlyIncreasingMigrationVersions(manifest.migrations), {
    message: 'plugin manifest migrations must be strictly increasing by version',
    path: ['migrations'],
  })
  .refine(manifest => !manifest.entry.renderer || manifest.compat?.rendererUi !== undefined, {
    message: 'renderer plugins must declare compat.rendererUi',
    path: ['compat', 'rendererUi'],
  });

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginManifestMigration = z.infer<typeof PluginManifestMigrationSchema>;
export type PluginManifestArtifact = z.infer<typeof PluginManifestArtifactSchema>;
export type PluginManifestSkill = z.infer<typeof PluginManifestSkillSchema>;
export type PluginManifestAgent = z.infer<typeof PluginManifestAgentSchema>;
export type PluginManifestReleaseNote = z.infer<typeof PluginManifestReleaseNoteSchema>;
export type PluginOwnedFileType = z.infer<typeof PluginOwnedFileTypeSchema>;

export interface PluginMetaClassification {
  readonly builtin: boolean;
  readonly required?: boolean;
}

export function parsePluginManifest(input: unknown): PluginManifest {
  return PluginManifestSchema.parse(input);
}

export function pluginMetaFromManifest(
  manifest: PluginManifest,
  classification: PluginMetaClassification,
): PluginMeta {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    developer: manifest.developer,
    builtin: classification.builtin,
    ...(classification.required === undefined ? {} : { required: classification.required }),
    ...(manifest.permissions === undefined ? {} : { permissions: manifest.permissions }),
    ...(manifest.dependsOn === undefined ? {} : { dependsOn: manifest.dependsOn }),
    ...(manifest.compat?.minApp === undefined ? {} : { compatMin: manifest.compat.minApp }),
    ...(manifest.compat?.rendererUi === undefined
      ? {}
      : { rendererUiRange: manifest.compat.rendererUi }),
    ...(manifest.ownedFileTypes.length === 0 ? {} : { ownedFileTypes: manifest.ownedFileTypes }),
  };
}

export function readSingleOwnedFileType(manifest: PluginManifest): PluginOwnedFileType;
export function readSingleOwnedFileType<
  TNodeType extends string,
  TExtension extends string,
>(
  manifest: PluginManifest,
  expected: {
    readonly nodeType: TNodeType;
    readonly extension: TExtension;
  },
): PluginOwnedFileType & {
  readonly nodeType: TNodeType;
  readonly extension: TExtension;
};
export function readSingleOwnedFileType(
  manifest: PluginManifest,
  expected?: {
    readonly nodeType: string;
    readonly extension: string;
  },
): PluginOwnedFileType {
  if (manifest.ownedFileTypes.length !== 1) {
    throw new Error(`Plugin ${manifest.id} must declare exactly one owned file type.`);
  }
  const ownedFileType = manifest.ownedFileTypes[0];
  if (!ownedFileType) {
    throw new Error(`Plugin ${manifest.id} owned file type is missing.`);
  }
  if (
    expected &&
    (ownedFileType.nodeType !== expected.nodeType || ownedFileType.extension !== expected.extension)
  ) {
    throw new Error(
      `Plugin ${manifest.id} owned file type must be ${expected.nodeType} (${expected.extension}).`
    );
  }
  return ownedFileType;
}
