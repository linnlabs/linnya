interface SidebarConversationActivityInput {
  selectionEnabled: boolean;
  conversationId: string;
  activeConversationId: string | null;
}

export function isSidebarConversationActive(input: SidebarConversationActivityInput): boolean {
  return input.selectionEnabled && input.conversationId === input.activeConversationId;
}
