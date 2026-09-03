import type { Component } from 'vue';

export const CONVERSATION_IMAGE_ATTACHMENT_MENU_VALUE = 'attachment:image';
const CONVERSATION_AGENT_MENU_VALUE_PREFIX = 'agent:';

export interface ConversationInputActionMenuOption {
  readonly value?: string;
  readonly text?: string;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly iconComponent?: Component;
  readonly children?: ConversationInputActionMenuOption[];
  readonly isGroup?: boolean;
  readonly isSeparator?: boolean;
}

export interface ConversationInputActionMenuAgent {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly iconComponent?: Component;
}

export interface BuildConversationInputActionMenuOptionsInput {
  readonly attachmentGroupLabel: string;
  readonly agentGroupLabel: string;
  readonly imageLabel: string;
  readonly imageIconComponent: Component;
  readonly imageDisabled: boolean;
  readonly agents: readonly ConversationInputActionMenuAgent[];
}

export function createConversationAgentMenuValue(agentId: string): string {
  return `${CONVERSATION_AGENT_MENU_VALUE_PREFIX}${agentId}`;
}

export function readConversationAgentMenuValue(value: string): string | null {
  if (!value.startsWith(CONVERSATION_AGENT_MENU_VALUE_PREFIX)) return null;
  return value.slice(CONVERSATION_AGENT_MENU_VALUE_PREFIX.length);
}
