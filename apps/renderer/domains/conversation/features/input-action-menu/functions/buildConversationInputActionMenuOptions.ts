import {
  CONVERSATION_IMAGE_ATTACHMENT_MENU_VALUE,
  createConversationAgentMenuValue,
  type BuildConversationInputActionMenuOptionsInput,
  type ConversationInputActionMenuOption,
} from '../definitions/conversationInputActionMenu';

/**
 * “+”菜单是输入能力的统一入口。分组和尾部开发工具的顺序在纯函数中确定，
 * 避免附件、Agent 与基准测试分别在模板里插队。
 */
export function buildConversationInputActionMenuOptions(
  input: BuildConversationInputActionMenuOptionsInput,
): ConversationInputActionMenuOption[] {
  return [
    { isGroup: true, label: input.attachmentGroupLabel },
    {
      value: CONVERSATION_IMAGE_ATTACHMENT_MENU_VALUE,
      text: input.imageLabel,
      disabled: input.imageDisabled,
      iconComponent: input.imageIconComponent,
    },
    { isSeparator: true },
    { isGroup: true, label: input.agentGroupLabel },
    ...input.agents.map((agent) => ({
      value: createConversationAgentMenuValue(agent.id),
      text: agent.label,
      disabled: agent.disabled,
      iconComponent: agent.iconComponent,
    })),
  ];
}
