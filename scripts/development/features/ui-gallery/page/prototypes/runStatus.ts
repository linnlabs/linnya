/** 侧栏对话行的 Agent 运行状态（W-0352 原型）；与 Host 的 conversation activity 五态对应。 */
export type RunStatus = 'running' | 'awaiting-answer' | 'awaiting-approval' | 'interrupted' | 'idle';

/** 指示器悬停与读屏文字。 */
export const RUN_STATUS_LABELS: Readonly<Record<Exclude<RunStatus, 'idle'>, string>> = {
  running: '正在运行',
  'awaiting-answer': '等你回答',
  'awaiting-approval': '等你审批',
  interrupted: '运行已中断，打开后消失',
};

/** 推荐方案行尾代替时间的文字：只有需要用户处理的两种状态才写。 */
export const RUN_STATUS_TRAILING: Readonly<Partial<Record<RunStatus, string>>> = {
  'awaiting-answer': '待回答',
  'awaiting-approval': '待审批',
};

/** 收起的项目只显示里面最需要处理的一种状态。 */
export const RUN_STATUS_PRIORITY: readonly RunStatus[] = ['awaiting-approval', 'awaiting-answer', 'interrupted', 'running'];
