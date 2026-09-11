import type {
  ConversationControlCapability,
  ConversationControlConnectionDescriptor,
} from '@app/schemas';

export const CONVERSATION_CONTROL_MAX_REQUEST_BYTES = 1024 * 1024;
export const CONVERSATION_CONTROL_MAX_MESSAGE_CHARS = 200_000;
export const CONVERSATION_CONTROL_MAX_PAGE_SIZE = 200;
export const CONVERSATION_CONTROL_MIN_WATCH_INTERVAL_MS = 250;
export const CONVERSATION_CONTROL_MAX_WATCH_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** 握手只声明本 App 版本真正实现的能力。 */
export const LINNYA_CONVERSATION_CONTROL_CAPABILITIES = [
  'send',
  'models',
  'projects',
  'list',
  'messages',
  'status',
  'respond',
  'stop',
  'result',
  'audit',
  'workspace_tools',
] satisfies readonly ConversationControlCapability[];

export interface ConversationControlBridgeDiagnosticPort {
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface ConversationControlDescriptorOwner {
  publish(port: number): Promise<ConversationControlConnectionDescriptor>;
  revoke(): Promise<boolean>;
}
