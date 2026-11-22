import * as z from 'zod';

import { isValidRendererUiCompatibilityRange } from './renderer-ui-compatibility';
import type { PluginOperationErrorCode } from './errors';

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

/** Host 可以授予的固定产品表面；插件只能申请已存在的槽位。 */
export const PluginApplicationSurfaceSlotSchema = z.literal('knowledge-base');
export type PluginApplicationSurfaceSlot = z.infer<typeof PluginApplicationSurfaceSlotSchema>;

/** 插件安装态。missing 表示系统知道这个插件，但当前未安装。 */
export type PluginInstallState = 'enabled' | 'disabled' | 'missing';

export type PluginDataLifecycleStatus =
  | 'installed'
  | 'empty'
  | 'retained'
  | 'legacy'
  | 'cleaning'
  | 'failed'
  | 'unavailable';

export type PluginCleanupFailureReason =
  | 'file-locked'
  | 'permission-denied'
  | 'interrupted'
  | 'disk-full'
  | 'unknown';

export interface PluginDataSummary {
  readonly status: PluginDataLifecycleStatus;
  readonly bytes: number;
  readonly directories: Readonly<Record<'source' | 'derived' | 'runtime', number>>;
  /** 表是结构化记录数量，不折算成磁盘字节。 */
  readonly tables: Readonly<Record<string, number>>;
  readonly error?: string;
  /** 清理失败的稳定分类；原始异常只进诊断日志，不直接展示给用户。 */
  readonly errorCode?: PluginCleanupFailureReason;
  /** 当前清理操作中已实际删除的文件和目录；不把预计占用当成进度。 */
  readonly removedEntries?: number;
  readonly canDelete: boolean;
}

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
  /** 安装事实仍保留，但当前后端未接纳该 artifact；不能发布运行能力。 */
  runtimeUnavailable?: true;
  /** disabled/missing 或操作失败时给设置页展示的人类可读原因；missing 时用于区分从未安装与用户主动卸载。 */
  reason?: string;
  data?: PluginDataSummary;
  /** 统计可以暂停，不能用该状态覆盖已经知道的清理残留或占用。 */
  dataMeasurement?: 'running' | 'paused';
}

export interface PluginStoreListItem extends PluginStateView {
  /** Host 根据当前发行组合解析出的随包 artifact 来源；Renderer 不扫描本地路径。 */
  bundledSourceAvailable?: boolean;
}

/** 商店展示由 Host 投影当前服务开放状态，Renderer 不自行推断发行权限。 */
export interface PluginStoreListData {
  items: PluginStoreListItem[];
  remoteServiceEnabled: boolean;
}

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
      errorCode?: PluginOperationErrorCode;
    };

export type PluginRemoteInstallResult =
  | {
      status: 'installed';
      pluginId: PluginId;
      version: string;
      previousVersion: string | null;
      restartRequired: boolean;
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
      errorCode?: PluginOperationErrorCode;
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

/**
 * 插件自有资料的物理存储声明。
 *
 * 中文说明：清理只允许触及 manifest 明确声明的相对目录和表；Host 不按
 * pluginId 猜路径，也不能把整个 workspace 数据目录交给插件自行删除。
 */
export const PluginManifestDataStorageSchema = z.object({
  /** 新版默认数据根为 Workspace/Plugins/<pluginId>；旧根只能由 manifest 显式接管。 */
  legacyRoots: z.array(PluginManifestAssetPathSchema).default([]),
  directories: z.object({
    source: z.array(PluginManifestAssetPathSchema).default([]),
    derived: z.array(PluginManifestAssetPathSchema).default([]),
    runtime: z.array(PluginManifestAssetPathSchema).default([]),
  }).default({ source: [], derived: [], runtime: [] }),
  userDataTables: z.array(z.string().min(1)).default([]),
  /** 自有资料表的 id 会在完整清理后保留为引用删除事实；不保留标题或原文。 */
  citationSourceTable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u).optional(),
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

/** 插件所需的原生运行时组件（Host 通用合同）；远程安装时先装好满足 range 的版本。 */
export const PluginRuntimeRequirementSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u),
  range: z.string().min(1).refine(isValidRendererUiCompatibilityRange, {
    message: 'runtime range must be a valid node-semver range',
  }),
}).strict();

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
    applicationSurfaceSlot: PluginApplicationSurfaceSlotSchema.optional(),
    ownedFileTypes: z.array(PluginOwnedFileTypeSchema).default([]),
    ownedTables: z.array(z.string().min(1)).default([]),
    dataStorage: PluginManifestDataStorageSchema.default({
      legacyRoots: [],
      directories: { source: [], derived: [], runtime: [] },
      userDataTables: [],
    }),
    migrations: z.array(PluginManifestMigrationSchema).default([]),
    requiresRuntimes: z.array(PluginRuntimeRequirementSchema).default([]),
    artifact: PluginManifestArtifactSchema.optional(),
  })
  .passthrough()
  .refine(manifest => new Set(manifest.requiresRuntimes.map(item => item.id)).size === manifest.requiresRuntimes.length, {
    message: 'requiresRuntimes must not repeat a runtime id',
    path: ['requiresRuntimes'],
  })
  .refine(manifest => hasStrictlyIncreasingMigrationVersions(manifest.migrations), {
    message: 'plugin manifest migrations must be strictly increasing by version',
    path: ['migrations'],
  })
  .refine(manifest => !manifest.entry.renderer || manifest.compat?.rendererUi !== undefined, {
    message: 'renderer plugins must declare compat.rendererUi',
    path: ['compat', 'rendererUi'],
  })
  .refine(manifest => {
    const table = manifest.dataStorage.citationSourceTable;
    return table === undefined || (manifest.applicationSurfaceSlot !== undefined && manifest.ownedTables.includes(table));
  }, {
    message: 'citationSourceTable must belong to the plugin and have an application surface slot',
    path: ['dataStorage', 'citationSourceTable'],
  });

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginManifestMigration = z.infer<typeof PluginManifestMigrationSchema>;
export type PluginManifestArtifact = z.infer<typeof PluginManifestArtifactSchema>;
export type PluginManifestSkill = z.infer<typeof PluginManifestSkillSchema>;
export type PluginManifestAgent = z.infer<typeof PluginManifestAgentSchema>;
export type PluginManifestReleaseNote = z.infer<typeof PluginManifestReleaseNoteSchema>;
export type PluginOwnedFileType = z.infer<typeof PluginOwnedFileTypeSchema>;
export type PluginManifestDataStorage = z.infer<typeof PluginManifestDataStorageSchema>;

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
