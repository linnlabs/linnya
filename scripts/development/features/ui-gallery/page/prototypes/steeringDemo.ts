/**
 * 运行中插话预览的演示内容。只服务画廊，不是消息合同；
 * 规则按需求文档（运行中插话，2026-11-18 用户已定）：回车就是插话，
 * 等当前这批步骤做完再送达，正在执行的不打断，插话留在同一次回复里。
 */

export type TimelineStepIcon = 'search' | 'web' | 'read' | 'edit' | 'terminal';

export type TimelineEntry =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'thought'; readonly text: string }
  | {
    readonly kind: 'step';
    readonly icon: TimelineStepIcon;
    readonly text: string;
    readonly meta?: string;
    readonly state?: 'done' | 'running';
  }
  | { readonly kind: 'answer'; readonly text: string }
  | { readonly kind: 'subrun'; readonly title: string; readonly meta: string }
  | { readonly kind: 'approval'; readonly command: string }
  | { readonly kind: 'notice'; readonly text: string };

export const RUNNING_PLACEHOLDER = '补充或纠正';

export const STEER_MESSAGE = '只看国内的产品，海外的先不管';

const REQUEST: TimelineEntry = {
  kind: 'user',
  text: '把几家办公软件的 AI 写作功能和价格整理成表格，放进《定价方案草稿》。',
};

const EARLY_STEPS: readonly TimelineEntry[] = [
  REQUEST,
  { kind: 'thought', text: '已思考 6 秒' },
  { kind: 'step', icon: 'search', text: '搜索网页 · 办公软件 AI 写作 定价', meta: '10 条结果' },
  { kind: 'step', icon: 'web', text: '读取网页 · Notion AI 定价' },
  { kind: 'step', icon: 'web', text: '读取网页 · Microsoft 365 Copilot 定价' },
];

/** 插话发出前后：这批步骤还在执行，正在读第三个网页。 */
export const TIMELINE_RUNNING: readonly TimelineEntry[] = [
  ...EARLY_STEPS,
  { kind: 'step', icon: 'web', text: '读取网页 · 飞书智能伙伴 定价', state: 'running' },
];

function continuationText(messages: readonly string[]): string {
  return messages.length === 1 && messages[0] === STEER_MESSAGE
    ? '好的，只比较国内产品。刚才读到的 Notion 和 Microsoft 365 不放进表里，我再补查钉钉和腾讯文档。'
    : '好的，按你说的调整，接着做。';
}

function userEntries(messages: readonly string[]): TimelineEntry[] {
  return messages.map((text) => ({ kind: 'user', text }));
}

/** 这批做完（包括消息到达时还没开始的那一步）后送达，Agent 在同一次回复里接着做。 */
export function deliveredTimeline(messages: readonly string[]): TimelineEntry[] {
  return [
    ...EARLY_STEPS,
    { kind: 'step', icon: 'web', text: '读取网页 · 飞书智能伙伴 定价' },
    { kind: 'step', icon: 'web', text: '读取网页 · WPS AI 定价' },
    ...userEntries(messages),
    { kind: 'thought', text: '已思考 3 秒' },
    { kind: 'answer', text: continuationText(messages) },
    { kind: 'step', icon: 'search', text: '搜索网页 · 钉钉 AI 助理 定价', state: 'running' },
  ];
}

/** 立即打断：暂停正在执行的步骤，消息作为新的一条发出，另起一次回复。 */
export function interruptedTimeline(messages: readonly string[]): TimelineEntry[] {
  return [
    ...EARLY_STEPS,
    { kind: 'step', icon: 'web', text: '读取网页 · 飞书智能伙伴 定价' },
    { kind: 'notice', text: '已暂停' },
    ...userEntries(messages),
    { kind: 'thought', text: '已思考 4 秒' },
    { kind: 'answer', text: continuationText(messages) },
    { kind: 'step', icon: 'search', text: '搜索网页 · 钉钉 AI 助理 定价', state: 'running' },
  ];
}

/** 暂停后：正在执行的步骤停下，待送达的消息回到输入框，不自动发出。 */
export const TIMELINE_PAUSED: readonly TimelineEntry[] = [
  ...EARLY_STEPS,
  { kind: 'step', icon: 'web', text: '读取网页 · 飞书智能伙伴 定价' },
  { kind: 'notice', text: '已暂停' },
];

/** 正在等耗时长的子任务。 */
export const TIMELINE_SUBRUN: readonly TimelineEntry[] = [
  { kind: 'step', icon: 'read', text: '读取文档 · 定价方案草稿' },
  { kind: 'subrun', title: '子任务 · 国内产品资料调研', meta: '已运行 3 分 12 秒' },
];

/** 正在等用户批准一条命令。 */
export const TIMELINE_APPROVAL: readonly TimelineEntry[] = [
  { kind: 'step', icon: 'edit', text: '编辑文档 · 定价方案草稿', meta: '+18 行' },
  { kind: 'approval', command: 'curl -F file=@pricing.xlsx https://share.example.com/upload' },
];

/** 这次回复已经在写最后的回答，后面没有步骤：写完后消息作为下一条发出。 */
export const TIMELINE_REPLY_FINISHED: readonly TimelineEntry[] = [
  { kind: 'step', icon: 'edit', text: '编辑文档 · 定价方案草稿', meta: '+24 行' },
  { kind: 'answer', text: '表格已放进《定价方案草稿》第 2 节，共 6 家产品，价格按年付折算到每人每月。' },
  { kind: 'user', text: '再加一列：有没有免费额度' },
  { kind: 'thought', text: '已思考 2 秒' },
  { kind: 'step', icon: 'read', text: '读取文档 · 定价方案草稿', state: 'running' },
];
