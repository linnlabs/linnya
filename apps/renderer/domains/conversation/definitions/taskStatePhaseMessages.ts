import type { TaskStatePhase } from '@app/schemas';
import type { ConversationMessageKey } from './conversationMessages';

/**
 * TaskState 阶段的用户说法。合同里的 plan/execute/verify/recover 是给模型的内部取值，
 * 界面上一律换成这里的文案；工具卡和输入框上方的任务进度共用同一份。
 */
export const TASK_STATE_PHASE_LABEL_KEYS: Readonly<Record<TaskStatePhase, ConversationMessageKey>> = {
  plan: 'conversation.taskState.phase.plan',
  execute: 'conversation.taskState.phase.execute',
  verify: 'conversation.taskState.phase.verify',
  recover: 'conversation.taskState.phase.recover',
};

/** 工具卡标题需要延迟本地化，阶段只能作为整句文案键选择，不能把已翻译的阶段名塞进参数。 */
export const TASK_STATE_UPDATE_TITLE_KEYS: Readonly<Record<TaskStatePhase, ConversationMessageKey>> = {
  plan: 'conversation.tool.taskState.updatePhase.plan',
  execute: 'conversation.tool.taskState.updatePhase.execute',
  verify: 'conversation.tool.taskState.updatePhase.verify',
  recover: 'conversation.tool.taskState.updatePhase.recover',
};
