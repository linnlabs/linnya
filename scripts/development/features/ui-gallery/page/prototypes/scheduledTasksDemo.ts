import type { PermissionTier } from './permissionTier.ts';

/**
 * 定时任务预览的演示数据与文案。只服务画廊，不是数据合同；
 * 字段按需求文档（定时任务首版方案）取，便于对照界面上该显示什么。
 */

export type SchedulePreset = 'once' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';

export type TaskStatus =
  | 'enabled'
  | 'running'
  | 'queued'
  | 'paused'
  | 'awaiting-approval'
  | 'auto-paused-failures'
  | 'auto-paused-unread'
  | 'finished';

export interface DemoTask {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly prompt: string;
  readonly schedule: string;
  readonly preset: SchedulePreset;
  readonly nextRun: string | null;
  readonly model: string;
  readonly agent: string;
  readonly tier: PermissionTier;
  readonly status: TaskStatus;
  readonly unread: number;
  readonly skipMissed: boolean;
  readonly createdBy: string;
  readonly runCount: number;
  readonly storage: string;
}

export interface DemoProject {
  readonly id: string;
  readonly name: string;
}

export const DEMO_PROJECTS: readonly DemoProject[] = [
  { id: 'market', name: '市场研究' },
  { id: 'ops', name: '团队运营' },
  { id: 'personal', name: '个人事务' },
];

export const CURRENT_PROJECT_ID = 'market';

export const DEMO_TASKS: readonly DemoTask[] = [
  {
    id: 'news',
    projectId: 'market',
    name: '每日行业新闻',
    prompt: '搜集过去 24 小时国内办公软件和 AI 写作工具的新闻，挑 5 条最重要的，每条两三句话说明发生了什么、对我们有什么影响，写进“行业动态”文档。',
    schedule: '每个工作日 9:00',
    preset: 'weekdays',
    nextRun: '明天 9:00',
    model: 'DeepSeek V4',
    agent: '默认',
    tier: 'standard',
    status: 'enabled',
    unread: 3,
    skipMissed: false,
    createdBy: '在对话“竞品跟踪”里由 Agent 创建',
    runCount: 42,
    storage: '4.1 MB',
  },
  {
    id: 'competitor',
    projectId: 'market',
    name: '竞品价格巡检',
    prompt: '打开竞品定价页，记录各档价格和权益变化，有变化时在“定价方案草稿”末尾追加一段说明。',
    schedule: '每周一 10:00',
    preset: 'weekly',
    nextRun: '11月24日 周一 10:00',
    model: 'GLM 5 Flash',
    agent: '研究',
    tier: 'read_only',
    status: 'awaiting-approval',
    unread: 1,
    skipMissed: false,
    createdBy: '你创建',
    runCount: 9,
    storage: '1.3 MB',
  },
  {
    id: 'weekly-report',
    projectId: 'market',
    name: '周报初稿',
    prompt: '根据本周项目里改过的文档和对话，写一份周报初稿，放进“周报”文件夹。',
    schedule: '每周五 17:00',
    preset: 'weekly',
    nextRun: null,
    model: 'DeepSeek V4',
    agent: '默认',
    tier: 'standard',
    status: 'auto-paused-unread',
    unread: 2,
    skipMissed: true,
    createdBy: '你创建',
    runCount: 6,
    storage: '0.7 MB',
  },
  {
    id: 'cleanup',
    projectId: 'ops',
    name: '整理下载文件夹',
    prompt: '把下载文件夹里超过 30 天的安装包移到废纸篓，发票按月份归档。',
    schedule: '每天 22:00',
    preset: 'daily',
    nextRun: '今天 22:00',
    model: 'DeepSeek V4',
    agent: '默认',
    tier: 'full_access',
    status: 'enabled',
    unread: 0,
    skipMissed: true,
    createdBy: '在对话“电脑清理”里由 Agent 创建',
    runCount: 18,
    storage: '1.9 MB',
  },
  {
    id: 'standup',
    projectId: 'ops',
    name: '站会要点汇总',
    prompt: '汇总昨天各对话里提到的阻塞问题，列成清单。',
    schedule: '每小时',
    preset: 'hourly',
    nextRun: '15:00',
    model: 'DeepSeek V4 Flash',
    agent: '默认',
    tier: 'standard',
    status: 'running',
    unread: 0,
    skipMissed: true,
    createdBy: '你创建',
    runCount: 210,
    storage: '19.8 MB',
  },
  {
    id: 'visa',
    projectId: 'personal',
    name: '签证材料提醒',
    prompt: '检查签证材料清单还缺什么，列出来。',
    schedule: '一次：11月20日 9:00',
    preset: 'once',
    nextRun: null,
    model: 'DeepSeek V4',
    agent: '默认',
    tier: 'read_only',
    status: 'finished',
    unread: 0,
    skipMissed: false,
    createdBy: '你创建',
    runCount: 1,
    storage: '0.1 MB',
  },
  {
    id: 'rss',
    projectId: 'personal',
    name: '订阅文章摘要',
    prompt: '读取订阅源的新文章，写摘要。',
    schedule: '每天 8:00',
    preset: 'daily',
    nextRun: null,
    model: 'Qwen 3.5 Plus',
    agent: '默认',
    tier: 'standard',
    status: 'auto-paused-failures',
    unread: 0,
    skipMissed: false,
    createdBy: '你创建',
    runCount: 31,
    storage: '2.6 MB',
  },
];

export interface StatusPresentation {
  readonly text: string;
  readonly tone: 'neutral' | 'accent' | 'warning' | 'error' | 'muted';
}

export function taskStatusPresentation(task: DemoTask): StatusPresentation {
  switch (task.status) {
    case 'enabled':
      return { text: task.nextRun ? `下次 ${task.nextRun}` : '已启用', tone: 'neutral' };
    case 'running':
      return { text: '正在运行', tone: 'accent' };
    case 'queued':
      return { text: '排队中', tone: 'neutral' };
    case 'paused':
      return { text: '已暂停', tone: 'muted' };
    case 'awaiting-approval':
      return { text: '等待你审批', tone: 'warning' };
    case 'auto-paused-failures':
      return { text: '连续 3 次失败，已暂停', tone: 'error' };
    case 'auto-paused-unread':
      return { text: '14 天没看结果，已暂停', tone: 'warning' };
    case 'finished':
      return { text: '已运行，不再重复', tone: 'muted' };
  }
}

export function isTaskActive(task: DemoTask): boolean {
  return task.status === 'enabled' || task.status === 'running' || task.status === 'queued' || task.status === 'awaiting-approval';
}

export type RunStatus =
  | 'completed'
  | 'running'
  | 'queued'
  | 'awaiting-approval'
  | 'failed'
  | 'skipped'
  | 'interrupted'
  | 'superseded';

export interface DemoRun {
  readonly id: string;
  readonly scheduled: string;
  readonly started: string | null;
  readonly status: RunStatus;
  readonly detail: string;
  readonly tier: PermissionTier;
  readonly tokens: string | null;
  readonly unread: boolean;
  readonly hasConversation: boolean;
}

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, StatusPresentation>> = {
  completed: { text: '完成', tone: 'neutral' },
  running: { text: '正在运行', tone: 'accent' },
  queued: { text: '排队中', tone: 'neutral' },
  'awaiting-approval': { text: '等待审批', tone: 'warning' },
  failed: { text: '失败', tone: 'error' },
  skipped: { text: '跳过', tone: 'muted' },
  interrupted: { text: '被中断', tone: 'muted' },
  superseded: { text: '被下一次取代', tone: 'muted' },
};

/** 一个任务的运行记录样例，把首版会出现的状态各放一条。 */
export const DEMO_RUNS: readonly DemoRun[] = [
  { id: 'r42', scheduled: '今天 9:00', started: '9:02', status: 'completed', detail: '用时 3 分钟', tier: 'standard', tokens: '1.2 万', unread: true, hasConversation: true },
  { id: 'r41', scheduled: '昨天 9:00', started: '9:00', status: 'completed', detail: '用时 2 分钟', tier: 'standard', tokens: '0.9 万', unread: true, hasConversation: true },
  { id: 'r40', scheduled: '11月14日 9:00', started: '9:00', status: 'awaiting-approval', detail: '要运行 curl 上传文件，等你批准', tier: 'standard', tokens: '0.4 万', unread: true, hasConversation: true },
  { id: 'r39', scheduled: '11月13日 9:00', started: null, status: 'skipped', detail: 'App 没有打开；之后只补跑了最近一次', tier: 'standard', tokens: null, unread: false, hasConversation: false },
  { id: 'r38', scheduled: '11月12日 9:00', started: '9:00', status: 'failed', detail: '模型不可用：指定的模型已被删除', tier: 'standard', tokens: null, unread: false, hasConversation: true },
  { id: 'r37', scheduled: '11月11日 9:00', started: '9:00', status: 'interrupted', detail: '退出 App 时还在运行', tier: 'standard', tokens: '0.6 万', unread: false, hasConversation: true },
  { id: 'r36', scheduled: '11月10日 9:00', started: '9:07', status: 'completed', detail: '同时运行的任务已满，排队 7 分钟', tier: 'read_only', tokens: '1.1 万', unread: false, hasConversation: true },
];

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;
