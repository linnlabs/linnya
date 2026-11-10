import { z } from 'zod';

/** 项目概览：跨文件夹列出项目里的全部文档，带系统自动记录的列。 */
export const PROJECT_OVERVIEW_CHANNEL = 'project-overview:list' as const;

/** 增量刷新一次最多补读的文档数；超过时调用方应整表重读。 */
export const PROJECT_OVERVIEW_MAX_DOCUMENT_IDS = 200;

export const ProjectOverviewRequestSchema = z.object({
  project_id: z.string().trim().min(1),
  /** 只读这些文档；省略时读整个项目。 */
  document_ids: z.array(z.string().trim().min(1)).min(1).max(PROJECT_OVERVIEW_MAX_DOCUMENT_IDS).optional(),
}).strict();

/**
 * 改动是谁做的。`linnya_ai` 是 Linnya 自己的 Agent 运行（含子运行）；`external` 是经外部控制入口（Linnya CLI）写入的改动，分不出调用方是人、脚本还是外部 Agent；
 * `plugin` 是插件的后台自动化。只有账本能说明的才给，说不清时为 null。
 */
export const ProjectOverviewActorSchema = z.enum(['linnya_ai', 'user', 'external', 'plugin']);

export const ProjectOverviewDocumentSchema = z.object({
  document_id: z.string().min(1),
  node_type: z.string().min(1),
  /** 与 VFS 展示名一致：去掉文档类型后缀。 */
  title: z.string().min(1),
  parent_id: z.string().min(1).nullable(),
  /** 从项目根到所在文件夹的文件夹名；在根目录时为空数组。 */
  location: z.array(z.string().min(1)),
  created_at: z.number().int().nonnegative(),
  /** 是谁新建的；账本没有记下新建时为 null。 */
  creator: z.object({
    actor: ProjectOverviewActorSchema,
    plugin_id: z.string().min(1).nullable(),
    /** 新建它的对话；不是在对话里新建的、或对话已不属于本项目时为 null。 */
    conversation_id: z.string().min(1).nullable(),
    conversation_title: z.string().nullable(),
  }).strict().nullable(),
  /** 最近一次改动的时间：账本与节点时间中较晚的一个（改名、移动也算）。 */
  last_modified_at: z.number().int().nonnegative(),
  /** 最近一次改动是谁做的；账本解释不了这次改动（例如插件文档里用户自己的编辑尚未入账）时为 null。 */
  last_modified_by: z.object({
    actor: ProjectOverviewActorSchema,
    plugin_id: z.string().min(1).nullable(),
  }).strict().nullable(),
  /** 只对有待审阅修订的文档类型（内建 Markdown）给出；其他类型为 null。 */
  pending_revision_count: z.number().int().nonnegative().nullable(),
  /** 当前标签，按打标签的先后；没有标签时为空数组。 */
  tags: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) }).strict()),
}).strict();

export const ProjectOverviewSchema = z.object({
  project_id: z.string().min(1),
  /** 请求了 `document_ids` 时只含其中仍在项目里的文档。 */
  documents: z.array(ProjectOverviewDocumentSchema),
  /** 整表读取时给出；按文档补读时为 null。 */
  folder_count: z.number().int().nonnegative().nullable(),
}).strict();

export type ProjectOverviewRequest = z.infer<typeof ProjectOverviewRequestSchema>;
export type ProjectOverviewActor = z.infer<typeof ProjectOverviewActorSchema>;
export type ProjectOverviewDocument = z.infer<typeof ProjectOverviewDocumentSchema>;
export type ProjectOverview = z.infer<typeof ProjectOverviewSchema>;
