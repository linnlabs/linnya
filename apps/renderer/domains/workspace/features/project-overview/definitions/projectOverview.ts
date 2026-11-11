import type { Component } from 'vue';
import type { ProjectFieldCondition, ProjectOverviewActor } from '@app/schemas';

/** 名称列固定在最前、占满剩余宽度，不进列配置。 */
export const PROJECT_OVERVIEW_COLUMN_IDS = [
  'tags',
  'location',
  'source',
  'conversation',
  'modified',
  'pending',
  'type',
  'created',
] as const;

export type ProjectOverviewColumnId = (typeof PROJECT_OVERVIEW_COLUMN_IDS)[number];

/**
 * 列配置：带版本号，只记列的显示、顺序和宽度，所有项目共用本机偏好；不进保存的筛选。
 */
export const PROJECT_OVERVIEW_LAYOUT_VERSION = 1;

export interface ProjectOverviewColumnLayout {
  readonly id: ProjectOverviewColumnId;
  readonly visible: boolean;
  readonly width: number;
}

export interface ProjectOverviewLayout {
  readonly version: typeof PROJECT_OVERVIEW_LAYOUT_VERSION;
  /** 名称列固定在最前，只记宽度。 */
  readonly nameWidth: number;
  readonly columns: readonly ProjectOverviewColumnLayout[];
}

export type ProjectOverviewSortKey = 'name' | ProjectOverviewColumnId;

export interface ProjectOverviewSort {
  readonly key: ProjectOverviewSortKey;
  readonly direction: 'asc' | 'desc';
}

export type ProjectOverviewModifiedRange = 'any' | 'today' | 'week' | 'month';

export interface ProjectOverviewFilters {
  /** 节点类型；null 为全部类型。 */
  readonly nodeType: string | null;
  readonly modified: ProjectOverviewModifiedRange;
  /** 所在文件夹路径（含子文件夹）；null 为全部位置，空数组为根目录本身。 */
  readonly location: readonly string[] | null;
  /** 同时带有这些标签（ID）；空数组为不按标签筛选。 */
  readonly tags: readonly string[];
  /** 字段条件（字段 ID），全部同时成立；由 Backend 用查询编译器求值。 */
  readonly where: readonly ProjectFieldCondition[];
  /** 搜索是一次性的，不进保存的筛选。 */
  readonly query: string;
}

export const EMPTY_PROJECT_OVERVIEW_FILTERS: ProjectOverviewFilters = Object.freeze({
  nodeType: null,
  modified: 'any',
  location: null,
  tags: [],
  where: [],
  query: '',
});

/** 文件页的布局：表格或按单选字段分列的看板。 */
export type ProjectOverviewViewKind = 'table' | 'board';

export interface ProjectOverviewView {
  readonly kind: ProjectOverviewViewKind;
  /** 看板按哪个单选字段分列（字段 ID）。 */
  readonly groupBy: string | null;
}

export const DEFAULT_PROJECT_OVERVIEW_SORT: ProjectOverviewSort = Object.freeze({ key: 'modified', direction: 'desc' });
export const DEFAULT_PROJECT_OVERVIEW_VIEW: ProjectOverviewView = Object.freeze({ kind: 'table', groupBy: null });

/** 界面用的一行：只保留展示、筛选和排序需要的事实。 */
export interface ProjectOverviewRow {
  readonly documentId: string;
  readonly nodeType: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly location: readonly string[];
  readonly createdAt: number;
  readonly creatorActor: ProjectOverviewActor | null;
  readonly creatorPluginId: string | null;
  readonly conversationId: string | null;
  readonly conversationTitle: string | null;
  readonly lastModifiedAt: number;
  readonly lastModifiedActor: ProjectOverviewActor | null;
  readonly lastModifiedPluginId: string | null;
  readonly pendingRevisionCount: number | null;
  /** 当前标签，按打标签的先后。 */
  readonly tags: readonly { readonly id: string; readonly name: string }[];
  /** 标签带来的字段：版本、当前可用字段与已填的值（键是字段 ID）。 */
  readonly fieldRevision: number;
  readonly fieldIds: readonly string[];
  readonly fieldValues: Readonly<Record<string, unknown>>;
}

/** 打开一份文档需要的身份；文件页的行和对话详情里改过的文档都给出这些。 */
export type ProjectOverviewDocumentTarget = Pick<ProjectOverviewRow, 'documentId' | 'nodeType' | 'title' | 'parentId'>;

/** 文档类型的显示方式由页面从插件注册表查好传进来，领域视图不直接依赖注册表。 */
export interface ProjectOverviewDocumentTypePresentation {
  readonly label: string;
  readonly iconComponent: Component;
  readonly iconClass: string;
}

export interface ProjectOverviewPresentation {
  readonly documentType: (nodeType: string) => ProjectOverviewDocumentTypePresentation;
  /** 插件显示名；插件已卸载等查不到时为 null。 */
  readonly pluginName: (pluginId: string) => string | null;
  /** Agent 显示名；null 是默认 Agent。查不到时由调用方显示 ID。 */
  readonly agentName: (agentId: string | null) => string | null;
}

/** 工作区变更触发的读取范围。 */
export type ProjectOverviewRefreshPlan = { readonly kind: 'none' } | { readonly kind: 'documents'; readonly id: string } | { readonly kind: 'all' };
