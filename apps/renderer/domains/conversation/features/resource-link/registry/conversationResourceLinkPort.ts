import type { ConversationResourceLinkPort } from '../definitions/conversationResourceLinkPort';

let registeredPort: ConversationResourceLinkPort | null = null;

export function registerConversationResourceLinkPort(port: ConversationResourceLinkPort): void {
  registeredPort = port;
}

export function getConversationResourceLinkPort(): ConversationResourceLinkPort {
  if (!registeredPort) {
    throw new Error('[conversationResourceLinkPort] port has not been registered');
  }
  return registeredPort;
}
