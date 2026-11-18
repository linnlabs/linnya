import type { BaseMessage } from '../../../types';

/** 用户改了这个对话的命令档位；设置事实，不属于任何运行。 */
export type CommandPermissionChangeMessage = Extract<BaseMessage, { type: 'command_permission_change' }>;
