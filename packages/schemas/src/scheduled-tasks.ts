import { z } from 'zod';
import { CommandPermissionLevelSchema } from './commands/commandPermission';

/**
 * 定时任务：用户或 Agent 让 Linnya 在指定时间或按周期自动做一件事，结果留在项目里。
 *
 * 任务、运行记录、定时器和 `linnya schedules` CLI 都由 App Server 持有；Renderer 只经下面的
 * channel 读写，不自己计算下次运行时间或判断名额。时间表按电脑当前时区的钟点解释（换时区后
 * “每天 9 点”跟着当地 9 点），时刻字段一律是 epoch 毫秒。
 */

// ---- Renderer → App Server（backend renderer request registry） ----
export const SCHEDULED_TASKS_LIST_CHANNEL = 'scheduled-tasks:list' as const;
export const SCHEDULED_TASKS_RUNS_CHANNEL = 'scheduled-tasks:runs' as const;
export const SCHEDULED_TASKS_CREATE_CHANNEL = 'scheduled-tasks:create' as const;
export const SCHEDULED_TASKS_UPDATE_CHANNEL = 'scheduled-tasks:update' as const;
export const SCHEDULED_TASKS_SET_ENABLED_CHANNEL = 'scheduled-tasks:set-enabled' as const;
export const SCHEDULED_TASKS_RUN_NOW_CHANNEL = 'scheduled-tasks:run-now' as const;
export const SCHEDULED_TASKS_DELETE_CHANNEL = 'scheduled-tasks:delete' as const;
export const SCHEDULED_TASKS_MARK_VIEWED_CHANNEL = 'scheduled-tasks:mark-viewed' as const;
export const SCHEDULED_TASKS_PREVIEW_SCHEDULE_CHANNEL = 'scheduled-tasks:preview-schedule' as const;
export const SCHEDULED_TASKS_SETTINGS_GET_CHANNEL = 'scheduled-tasks:settings-get' as const;
export const SCHEDULED_TASKS_SETTINGS_SET_CHANNEL = 'scheduled-tasks:settings-set' as const;
/** 回答末尾卡片：这一轮的根运行建了或改了哪些任务。 */
export const CONVERSATION_RUN_SCHEDULED_TASKS_CHANNEL = 'conversation-run-scheduled-tasks:list' as const;

// ---- App Server → Renderer 推送 ----
/** 任务或运行记录变了（含状态、未读、名额）；Renderer 收到后重新读取，推送本身不带数据。 */
export const SCHEDULED_TASKS_NOTIFY_CHANNEL = 'scheduled-tasks:notify' as const;
export const SCHEDULED_TASKS_CHANGED_CHANNEL = 'scheduled-tasks:changed' as const;

// ---- 产品限制 ----
/** 任意相邻两次运行的最短间隔；界面、CLI 与自定义 cron 共用。 */
export const SCHEDULED_TASK_MIN_INTERVAL_MS = 60 * 60 * 1000;
/** 错过的运行只补最近一次，且计划时刻在这个窗口内。 */
export const SCHEDULED_TASK_CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 定时器检查延迟在此范围内不算错过。 */
export const SCHEDULED_TASK_MISSED_TOLERANCE_MS = 2 * 60 * 1000;
/** 连续失败这么多次自动暂停。 */
export const SCHEDULED_TASK_FAILURE_PAUSE_COUNT = 3;
/** 这么久没打开过该任务的结果，自动暂停。 */
export const SCHEDULED_TASK_UNVIEWED_PAUSE_MS = 14 * 24 * 60 * 60 * 1000;
export const SCHEDULED_TASK_CONCURRENCY_MIN = 1;
export const SCHEDULED_TASK_CONCURRENCY_MAX = 5;
export const SCHEDULED_TASK_CONCURRENCY_DEFAULT = 5;
export const SCHEDULED_TASK_NAME_MAX_CHARS = 80;
export const SCHEDULED_TASK_PROMPT_MAX_CHARS = 20_000;
/** 每小时预设允许的间隔小时数。 */
export const SCHEDULED_TASK_HOURLY_INTERVALS = [1, 2, 3, 4, 6, 8, 12] as const;

const Id = z.string().trim().min(1);
const EpochMs = z.number().int().nonnegative();
const NonNegativeInt = z.number().int().nonnegative();
/** 本地钟点，24 小时制。 */
const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
/** 本地日期。 */
const LocalDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u);
/** ISO 星期：1 是周一，7 是周日。 */
const IsoWeekdaySchema = z.number().int().min(1).max(7);

/**
 * 时间表。预设与界面的七个选项一一对应；除 `once` 外都由 App Server 编译成 5 段 cron 计算。
 * 结构合法不代表可保存：最短间隔等规则由 App Server 统一判断（见 preview-schedule）。
 */
export const ScheduledTaskScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), date: LocalDateSchema, time: LocalTimeSchema }).strict(),
  z.object({
    kind: z.literal('hourly'),
    every_hours: z.union([
      z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12),
    ]),
    minute: z.number().int().min(0).max(59),
  }).strict(),
  z.object({ kind: z.literal('daily'), time: LocalTimeSchema }).strict(),
  z.object({ kind: z.literal('weekdays'), time: LocalTimeSchema }).strict(),
  z.object({
    kind: z.literal('weekly'),
    /** 升序、不重复，至少一天。 */
    weekdays: z.array(IsoWeekdaySchema).min(1).max(7),
    time: LocalTimeSchema,
  }).strict(),
  z.object({
    kind: z.literal('monthly'),
    /** 只给 1–28 号和最后一天，避免“31 号”在小月不跑。 */
    day: z.union([z.number().int().min(1).max(28), z.literal('last')]),
    time: LocalTimeSchema,
  }).strict(),
  z.object({ kind: z.literal('cron'), expression: z.string().trim().min(1).max(120) }).strict(),
]);

/** 定时运行可选的 Agent；App Server 分别映射到对应的无人值守变体。 */
export const ScheduledTaskAgentSchema = z.enum(['default', 'research']);
/** 错过的运行：补最近一次（7 天内），或直接跳过。 */
export const ScheduledTaskMissedPolicySchema = z.enum(['run_latest', 'skip']);

/** 任务当前状态，由 App Server 从任务记录、运行注册表和执行状态合成。 */
export const ScheduledTaskStateSchema = z.enum([
  /** 已启用，等下次到点。 */
  'scheduled',
  'running',
  /** 到点了，名额满，排队中。 */
  'queued',
  /** 有一次运行在等命令审批；后续到点会跳过。 */
  'awaiting_approval',
  /** 用户暂停。 */
  'paused',
  /** 连续失败自动暂停。 */
  'paused_after_failures',
  /** 长期没看结果自动暂停。 */
  'paused_unviewed',
  /** 一次性任务已经跑过，自动停用。 */
  'finished',
]);

export const ScheduledTaskSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z.object({
    kind: z.literal('agent'),
    conversation_id: Id,
    /** 来源对话已删除时为 null。 */
    conversation_title: z.string().nullable(),
    run_id: Id,
  }).strict(),
]);

export const ScheduledTaskRunStatusSchema = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'skipped',
  /** 退出 App、用户停止等外部原因中断；不计入连续失败。 */
  'interrupted',
  /** 排队中被同一任务的下一次取代。 */
  'superseded',
]);

/** 跳过、失败或中断的原因；界面按原因给文案。 */
export const ScheduledTaskRunReasonSchema = z.enum([
  /** App 没开或电脑睡眠时到点。 */
  'app_not_running',
  'previous_still_running',
  'previous_awaiting_approval',
  /** 任务设为“错过就跳过”。 */
  'missed_policy_skip',
  /** 超出 7 天补跑窗口，或不是最近一次。 */
  'outside_catch_up_window',
  'model_unavailable',
  /** Agent 运行以失败结束。 */
  'run_failed',
  'app_quit',
  'stopped_by_user',
  'task_deleted',
  'project_deleted',
]);

export const ScheduledTaskRunTriggerSchema = z.enum(['schedule', 'catch_up', 'manual']);

export const ScheduledTaskRunSchema = z.object({
  id: Id,
  task_id: Id,
  /** 计划时刻；手动运行为点击时刻。 */
  planned_at: EpochMs,
  trigger: ScheduledTaskRunTriggerSchema,
  status: ScheduledTaskRunStatusSchema,
  reason: ScheduledTaskRunReasonSchema.nullable(),
  /** 多次错过合并成一行时的次数；普通记录为 1。 */
  skipped_count: z.number().int().min(1),
  started_at: EpochMs.nullable(),
  ended_at: EpochMs.nullable(),
  /** 对话已删除或这次没有开跑时为 null。 */
  conversation_id: Id.nullable(),
  run_id: Id.nullable(),
  /** 这次实际使用的档位与模型（运行历史要标明）。 */
  permission_level: CommandPermissionLevelSchema,
  model_config_id: Id.nullable(),
  /** 这次运行（含子运行）用掉的 token；没开跑或账本没有记录时为 null。 */
  total_tokens: NonNegativeInt.nullable(),
  /** 完成后还没打开过这次的对话。 */
  unread: z.boolean(),
}).strict();

export const ScheduledTaskSchema = z.object({
  id: Id,
  project_id: Id,
  name: z.string().min(1).max(SCHEDULED_TASK_NAME_MAX_CHARS),
  prompt: z.string().min(1).max(SCHEDULED_TASK_PROMPT_MAX_CHARS),
  agent: ScheduledTaskAgentSchema,
  /** null：每次运行时取设置里的默认模型。 */
  model_config_id: Id.nullable(),
  /** 指定的模型已被删除或不可用；运行会记失败，不悄悄换模型。 */
  model_unavailable: z.boolean(),
  schedule: ScheduledTaskScheduleSchema,
  missed_policy: ScheduledTaskMissedPolicySchema,
  permission_level: CommandPermissionLevelSchema,
  state: ScheduledTaskStateSchema,
  /** 暂停、已结束时为 null。 */
  next_run_at: EpochMs.nullable(),
  last_run: ScheduledTaskRunSchema.nullable(),
  consecutive_failures: NonNegativeInt,
  /** 完成后还没打开过的运行次数。 */
  unread_count: NonNegativeInt,
  run_count: NonNegativeInt,
  /** 这个任务的定时对话占用的存储；没测过为 null。 */
  storage_bytes: NonNegativeInt.nullable(),
  source: ScheduledTaskSourceSchema,
  created_at: EpochMs,
  updated_at: EpochMs,
  /** 乐观并发：修改时带上读到的值。 */
  revision: NonNegativeInt,
}).strict();

export const ScheduledTaskSettingsSchema = z.object({
  max_concurrent_runs: z.number().int().min(SCHEDULED_TASK_CONCURRENCY_MIN).max(SCHEDULED_TASK_CONCURRENCY_MAX),
  /** Renderer 同步设置里的主模型，让无界面 App Server 也可使用。 */
  default_model_config_id: Id.nullable().optional(),
}).strict();

// ---- 请求与结果 ----

export const ScheduledTasksListRequestSchema = z.object({
  /** 省略时列出全部项目；给出时只列这个项目（项目视图下面的“其他项目”另取全部再分组）。 */
  project_id: Id.optional(),
}).strict();
export const ScheduledTasksListResultSchema = z.object({
  /** 按项目、再按下次运行时间排序；暂停与已结束的排在各项目末尾。 */
  tasks: z.array(ScheduledTaskSchema),
  settings: ScheduledTaskSettingsSchema,
  /** 正在运行的定时运行数（不含等审批的），与 `settings.max_concurrent_runs` 对比显示名额。 */
  running_count: NonNegativeInt,
  /** 开发环境默认关闭定时器；关闭时界面说明到点不会运行。 */
  scheduler_enabled: z.boolean(),
}).strict();

export const ScheduledTaskRunsRequestSchema = z.object({
  task_id: Id,
  /** 取计划时刻早于它的记录，用于向前翻页。 */
  before_planned_at: EpochMs.optional(),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();
export const ScheduledTaskRunsResultSchema = z.object({
  /** 计划时刻倒序。 */
  runs: z.array(ScheduledTaskRunSchema),
  has_more: z.boolean(),
}).strict();

const ScheduledTaskEditableFields = {
  name: z.string().trim().min(1).max(SCHEDULED_TASK_NAME_MAX_CHARS),
  prompt: z.string().trim().min(1).max(SCHEDULED_TASK_PROMPT_MAX_CHARS),
  agent: ScheduledTaskAgentSchema,
  model_config_id: Id.nullable(),
  schedule: ScheduledTaskScheduleSchema,
  missed_policy: ScheduledTaskMissedPolicySchema,
  permission_level: CommandPermissionLevelSchema,
};

export const ScheduledTaskCreateRequestSchema = z.object({
  project_id: Id,
  ...ScheduledTaskEditableFields,
}).strict();

/** 修改从下一次运行生效；正在运行的这次按原设置跑完。 */
export const ScheduledTaskUpdateRequestSchema = z.object({
  task_id: Id,
  expected_revision: NonNegativeInt,
  name: ScheduledTaskEditableFields.name.optional(),
  prompt: ScheduledTaskEditableFields.prompt.optional(),
  agent: ScheduledTaskEditableFields.agent.optional(),
  model_config_id: ScheduledTaskEditableFields.model_config_id.optional(),
  schedule: ScheduledTaskEditableFields.schedule.optional(),
  missed_policy: ScheduledTaskEditableFields.missed_policy.optional(),
  permission_level: ScheduledTaskEditableFields.permission_level.optional(),
}).strict();

/** 启用或暂停；恢复时清掉连续失败计数，从下一次计划时刻算起，暂停期间错过的不补。 */
export const ScheduledTaskSetEnabledRequestSchema = z.object({
  task_id: Id,
  enabled: z.boolean(),
}).strict();

/** 立即运行一次：占名额，名额满时排到队首。 */
export const ScheduledTaskRunNowRequestSchema = z.object({ task_id: Id }).strict();

/** 删除只能由用户在界面上做；对话保留。 */
export const ScheduledTaskDeleteRequestSchema = z.object({
  task_id: Id,
  /** 同时停止正在运行的那次。 */
  stop_running: z.boolean(),
}).strict();

/** 打开定时对话时上报，清该次未读并刷新“最近查看”（驱动 14 天自动暂停）。 */
export const ScheduledTaskMarkViewedRequestSchema = z.object({ conversation_id: Id }).strict();

export const ScheduledTaskScheduleErrorCodeSchema = z.enum([
  'invalid_expression',
  'too_frequent',
  /** 一次性时间已过去。 */
  'in_the_past',
  /** cron 在可预见的时间内不会触发（如 2 月 30 日）。 */
  'never_runs',
]);

export const ScheduledTaskPreviewScheduleRequestSchema = z.object({
  schedule: ScheduledTaskScheduleSchema,
}).strict();
export const ScheduledTaskPreviewScheduleResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    /** 接下来最多 3 次。 */
    next_runs: z.array(EpochMs).max(3),
  }).strict(),
  z.object({
    ok: z.literal(false),
    code: ScheduledTaskScheduleErrorCodeSchema,
    /** 给用户看的一句话。 */
    message: z.string().min(1),
  }).strict(),
]);

export const ScheduledTaskMutationErrorCodeSchema = z.enum([
  'task_not_found',
  'project_not_found',
  'revision_conflict',
  'invalid_schedule',
  'model_unavailable',
]);

export const ScheduledTaskMutationResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), task: ScheduledTaskSchema }).strict(),
  z.object({
    ok: z.literal(false),
    code: ScheduledTaskMutationErrorCodeSchema,
    message: z.string().min(1),
  }).strict(),
]);

export const ScheduledTaskDeleteResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), stopped_runs: NonNegativeInt }).strict(),
  z.object({ ok: z.literal(false), code: z.literal('task_not_found'), message: z.string().min(1) }).strict(),
]);

export const ScheduledTaskSettingsSetRequestSchema = ScheduledTaskSettingsSchema.partial().refine(
  request => request.max_concurrent_runs !== undefined || request.default_model_config_id !== undefined,
  'Provide a setting to change.',
);
export type ScheduledTaskSettingsSetRequest = z.infer<typeof ScheduledTaskSettingsSetRequestSchema>;

// ---- 回答末尾卡片 ----

export const ConversationRunScheduledTasksRequestSchema = z.object({
  conversation_id: Id,
  root_run_ids: z.array(Id).min(1).max(20),
}).strict();
export const ConversationRunScheduledTaskSchema = z.object({
  /** 已被用户删除时为 null，卡片只显示名称。 */
  task: ScheduledTaskSchema.nullable(),
  task_id: Id,
  task_name: z.string().min(1),
  /** 同一轮先建后改记为 created。 */
  action: z.enum(['created', 'updated']),
  /** 档位高于这一轮对话的档位（卡片显著警告）。 */
  above_conversation_permission: z.boolean(),
}).strict();
export const ConversationRunScheduledTasksSchema = z.object({
  tasks: z.array(ConversationRunScheduledTaskSchema),
}).strict();

// ---- 对话列表折叠 ----

export { ScheduledConversationFoldSchema, type ScheduledConversationFold } from './conversation/scheduled-fold';

// ---- 通知（App Server → Electron Main） ----

/**
 * Main 决定呈现：窗口在前台用应用内提示，否则发系统通知；点击打开对应对话或任务视图。
 * 启动时补跑多个任务合并成一条 `catch_up`。
 */
export const ScheduledTaskNotificationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('completed'), task_id: Id, task_name: z.string().min(1), conversation_id: Id }).strict(),
  z.object({ kind: z.literal('awaiting_approval'), task_id: Id, task_name: z.string().min(1), conversation_id: Id }).strict(),
  z.object({
    kind: z.literal('failed'),
    task_id: Id,
    task_name: z.string().min(1),
    conversation_id: Id.nullable(),
    reason: ScheduledTaskRunReasonSchema,
  }).strict(),
  z.object({
    kind: z.literal('auto_paused'),
    task_id: Id,
    task_name: z.string().min(1),
    cause: z.enum(['failures', 'unviewed']),
  }).strict(),
  z.object({ kind: z.literal('catch_up'), task_count: z.number().int().min(2) }).strict(),
]);

export type ScheduledTaskSchedule = z.infer<typeof ScheduledTaskScheduleSchema>;
export type ScheduledTaskAgent = z.infer<typeof ScheduledTaskAgentSchema>;
export type ScheduledTaskMissedPolicy = z.infer<typeof ScheduledTaskMissedPolicySchema>;
export type ScheduledTaskState = z.infer<typeof ScheduledTaskStateSchema>;
export type ScheduledTaskSource = z.infer<typeof ScheduledTaskSourceSchema>;
export type ScheduledTaskRunStatus = z.infer<typeof ScheduledTaskRunStatusSchema>;
export type ScheduledTaskRunReason = z.infer<typeof ScheduledTaskRunReasonSchema>;
export type ScheduledTaskRunTrigger = z.infer<typeof ScheduledTaskRunTriggerSchema>;
export type ScheduledTaskRun = z.infer<typeof ScheduledTaskRunSchema>;
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;
export type ScheduledTaskSettings = z.infer<typeof ScheduledTaskSettingsSchema>;
export type ScheduledTasksListRequest = z.infer<typeof ScheduledTasksListRequestSchema>;
export type ScheduledTasksListResult = z.infer<typeof ScheduledTasksListResultSchema>;
export type ScheduledTaskRunsRequest = z.input<typeof ScheduledTaskRunsRequestSchema>;
export type ScheduledTaskRunsResult = z.infer<typeof ScheduledTaskRunsResultSchema>;
export type ScheduledTaskCreateRequest = z.infer<typeof ScheduledTaskCreateRequestSchema>;
export type ScheduledTaskUpdateRequest = z.infer<typeof ScheduledTaskUpdateRequestSchema>;
export type ScheduledTaskSetEnabledRequest = z.infer<typeof ScheduledTaskSetEnabledRequestSchema>;
export type ScheduledTaskRunNowRequest = z.infer<typeof ScheduledTaskRunNowRequestSchema>;
export type ScheduledTaskDeleteRequest = z.infer<typeof ScheduledTaskDeleteRequestSchema>;
export type ScheduledTaskDeleteResult = z.infer<typeof ScheduledTaskDeleteResultSchema>;
export type ScheduledTaskMarkViewedRequest = z.infer<typeof ScheduledTaskMarkViewedRequestSchema>;
export type ScheduledTaskScheduleErrorCode = z.infer<typeof ScheduledTaskScheduleErrorCodeSchema>;
export type ScheduledTaskPreviewScheduleRequest = z.infer<typeof ScheduledTaskPreviewScheduleRequestSchema>;
export type ScheduledTaskPreviewScheduleResult = z.infer<typeof ScheduledTaskPreviewScheduleResultSchema>;
export type ScheduledTaskMutationErrorCode = z.infer<typeof ScheduledTaskMutationErrorCodeSchema>;
export type ScheduledTaskMutationResult = z.infer<typeof ScheduledTaskMutationResultSchema>;
export type ConversationRunScheduledTasksRequest = z.infer<typeof ConversationRunScheduledTasksRequestSchema>;
export type ConversationRunScheduledTask = z.infer<typeof ConversationRunScheduledTaskSchema>;
export type ConversationRunScheduledTasks = z.infer<typeof ConversationRunScheduledTasksSchema>;
export type ScheduledTaskNotification = z.infer<typeof ScheduledTaskNotificationSchema>;
