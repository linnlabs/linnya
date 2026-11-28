import { z } from 'zod';

import { ConversationExternalSenderSchema } from './conversation/external-sender';

/**
 * Main 把 `ConversationAttentionNotification` 转给 Renderer，第二个参数 `open`：
 * false 是窗口在前台时的应用内提示；true 是用户点了系统通知，要打开对应的对话。
 */
export const CONVERSATION_ATTENTION_NOTIFY_CHANNEL = 'conversation-attention:notify' as const;

/**
 * 外部入口发起的运行停下来等用户：等批准命令，或等回答提问、确认计划。
 * 用户自己在界面里发起的运行不发：人就在对话前，侧栏和对话里已有标记。
 */
export const ConversationAttentionNotificationSchema = z.object({
  kind: z.enum(['awaiting_approval', 'awaiting_answer']),
  conversation_id: z.string().min(1),
  project_id: z.string().min(1).nullable(),
  conversation_title: z.string().nullable(),
  /** 谁发起的这次运行；名称是调用方自报的，只用于显示。 */
  sender: ConversationExternalSenderSchema,
}).strict();
export type ConversationAttentionNotification = z.infer<typeof ConversationAttentionNotificationSchema>;
