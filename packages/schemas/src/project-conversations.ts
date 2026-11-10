import { z } from 'zod';

/**
 * 项目概览的对话页：列出项目里的对话、每个对话改过的文档与占用的存储。
 * 对话不进项目树；这里只读对话持久化、行动账本与对话工作目录。
 * 走本地 HTTP（与存储空间相同），因为占用测量要读对话工作目录；清理过程文件复用存储空间的接口。
 */
export const PROJECT_CONVERSATIONS_API_BASE = '/api/v1/project-conversations' as const;

/** 一次搜索最多返回的对话数；超出时 `truncated` 为 true。 */
export const PROJECT_CONVERSATIONS_SEARCH_LIMIT = 200;
/** 详情里“第一个问题”“最后的答复”的最大字符数，超出截断。 */
export const PROJECT_CONVERSATIONS_EXCERPT_MAX_CHARS = 600;

const Id = z.string().trim().min(1);
const NonNegativeInt = z.number().int().nonnegative();

export const ProjectConversationsRequestSchema = z.object({ project_id: Id }).strict();
export const ProjectConversationDetailRequestSchema = z.object({ project_id: Id, conversation_id: Id }).strict();
export const ProjectConversationsSearchRequestSchema = z.object({
  project_id: Id,
  query: z.string().trim().min(1).max(200),
}).strict();
export const ProjectConversationsMeasureRequestSchema = z.object({
  project_id: Id,
  /** 只测这些对话；省略时测本项目里测量结果过期或没有测过的对话。 */
  conversation_ids: z.array(Id).min(1).max(500).optional(),
}).strict();

/**
 * 一个对话占用的存储。对话记录是数据库里这个对话的全部记录（含执行过程），
 * 附件是它引用的资产（被多个对话共用时每个对话都计入），过程文件是对话工作目录。
 */
export const ProjectConversationStorageSchema = z.object({
  record_bytes: NonNegativeInt,
  attachment_bytes: NonNegativeInt,
  /** 共用附件：同一资产也被别的对话引用。 */
  has_shared_attachments: z.boolean(),
  /** 工作目录不可读时为 null，不伪装成 0。 */
  work_file_bytes: NonNegativeInt.nullable(),
  work_files_state: z.enum(['not_created', 'previous_files_unavailable', 'available', 'unavailable']),
  measured_at: NonNegativeInt,
}).strict();

export const ProjectConversationRowSchema = z.object({
  conversation_id: Id,
  title: z.string(),
  /** 对话选定的 Agent 注册表 ID；null 是默认 Agent。显示名由 Renderer 从注册表取。 */
  agent_id: z.string().min(1).nullable(),
  /** 用户发了几条消息。 */
  turn_count: NonNegativeInt,
  /** 账本里这个对话在本项目改过的文档数（去重）。 */
  changed_document_count: NonNegativeInt,
  created_at: NonNegativeInt,
  last_event_at: NonNegativeInt,
  is_pinned: z.boolean(),
  /** 最近一次测量的结果；没有测过，或测量后对话又有新活动时为 null，需要重新测量。 */
  storage: ProjectConversationStorageSchema.nullable(),
}).strict();

export const ProjectConversationsSchema = z.object({
  project_id: Id,
  conversations: z.array(ProjectConversationRowSchema),
}).strict();

export const ProjectConversationChangedDocumentSchema = z.object({
  document_id: Id,
  node_type: z.string().min(1),
  title: z.string(),
  parent_id: z.string().min(1).nullable(),
  /** 文档已删除（含在回收站）时为 true，界面不可打开。 */
  deleted: z.boolean(),
  last_changed_at: NonNegativeInt,
  /** 只对内建 Markdown 给出当前待审阅修订数；其他类型为 null。 */
  pending_revision_count: NonNegativeInt.nullable(),
}).strict();

export const ProjectConversationDetailSchema = z.object({
  conversation_id: Id,
  first_question: z.string().nullable(),
  last_answer: z.string().nullable(),
  changed_documents: z.array(ProjectConversationChangedDocumentSchema),
  storage: ProjectConversationStorageSchema.nullable(),
}).strict();

export const ProjectConversationSearchMatchSchema = z.object({
  conversation_id: Id,
  /** 标题命中时为 null；内容命中时为命中处前后的一小段原文。 */
  excerpt: z.string().nullable(),
}).strict();

export const ProjectConversationsSearchSchema = z.object({
  matches: z.array(ProjectConversationSearchMatchSchema),
  truncated: z.boolean(),
}).strict();

export const ProjectConversationsMeasureSchema = z.object({
  measurements: z.array(z.object({
    conversation_id: Id,
    storage: ProjectConversationStorageSchema,
  }).strict()),
}).strict();

export type ProjectConversationsRequest = z.infer<typeof ProjectConversationsRequestSchema>;
export type ProjectConversationDetailRequest = z.infer<typeof ProjectConversationDetailRequestSchema>;
export type ProjectConversationsSearchRequest = z.infer<typeof ProjectConversationsSearchRequestSchema>;
export type ProjectConversationsMeasureRequest = z.infer<typeof ProjectConversationsMeasureRequestSchema>;
export type ProjectConversationStorage = z.infer<typeof ProjectConversationStorageSchema>;
export type ProjectConversationRow = z.infer<typeof ProjectConversationRowSchema>;
export type ProjectConversations = z.infer<typeof ProjectConversationsSchema>;
export type ProjectConversationChangedDocument = z.infer<typeof ProjectConversationChangedDocumentSchema>;
export type ProjectConversationDetail = z.infer<typeof ProjectConversationDetailSchema>;
export type ProjectConversationSearchMatch = z.infer<typeof ProjectConversationSearchMatchSchema>;
export type ProjectConversationsSearch = z.infer<typeof ProjectConversationsSearchSchema>;
export type ProjectConversationsMeasure = z.infer<typeof ProjectConversationsMeasureSchema>;
