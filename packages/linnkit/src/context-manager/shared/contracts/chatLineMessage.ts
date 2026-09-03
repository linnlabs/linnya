import type { AiMessage } from '../../../contracts';

export type MessageType = AiMessage['type'];
export type MessageRole = AiMessage['role'];

export interface ChatMessage {
  id?: string;
  timestamp?: number;
  role: MessageRole;
  content: string;
  type?: MessageType;
  name?: string;
  metadata?: Record<string, unknown>;
}
