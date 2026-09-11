import { z } from 'zod';

export const CONVERSATION_CONTROL_SCHEMA_VERSION = 1 as const;
export const CONVERSATION_CONTROL_PROTOCOL_VERSION = 1 as const;
export const CONVERSATION_CONTROL_BRIDGE_PATH = '/api/v1/conversation-control' as const;
export const CONVERSATION_CONTROL_TOKEN_HEADER = 'x-linnya-cli-token' as const;
export const CONVERSATION_CONTROL_CONNECTION_FILE_ENV = 'LINNYA_CLI_CONNECTION_FILE' as const;
export const CONVERSATION_CONTROL_CONNECTION_FILE_NAME = 'conversation-control-v1.json' as const;

export const ConversationControlCapabilitySchema = z.enum([
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
]);

export type ConversationControlCapability = z.infer<
  typeof ConversationControlCapabilitySchema
>;

/** 当前 App 实例写给同一系统用户的私有连接描述。 */
export const ConversationControlConnectionDescriptorSchema = z
  .object({
    protocol_version: z.literal(CONVERSATION_CONTROL_PROTOCOL_VERSION),
    app_instance_id: z.string().trim().min(1),
    pid: z.number().int().positive(),
    host: z.literal('127.0.0.1'),
    port: z.number().int().min(1).max(65_535),
    session_token: z.string().regex(/^[a-f0-9]{64}$/),
    created_at: z.number().finite().nonnegative(),
    updated_at: z.number().finite().nonnegative(),
  })
  .strict();

export type ConversationControlConnectionDescriptor = z.infer<
  typeof ConversationControlConnectionDescriptorSchema
>;

export const ConversationControlHandshakeRequestSchema = z
  .object({
    protocol_version: z.literal(CONVERSATION_CONTROL_PROTOCOL_VERSION),
    client_name: z.literal('linnya-cli'),
    client_version: z.string().trim().min(1),
  })
  .strict();

export type ConversationControlHandshakeRequest = z.infer<
  typeof ConversationControlHandshakeRequestSchema
>;

export const ConversationControlHandshakeResponseSchema = z
  .object({
    schema_version: z.literal(CONVERSATION_CONTROL_SCHEMA_VERSION),
    protocol_version: z.literal(CONVERSATION_CONTROL_PROTOCOL_VERSION),
    app_instance_id: z.string().trim().min(1),
    app_version: z.string().trim().min(1),
    capabilities: z.array(ConversationControlCapabilitySchema),
    limits: z
      .object({
        max_request_bytes: z.number().int().positive(),
        max_message_chars: z.number().int().positive(),
        max_page_size: z.number().int().positive(),
        min_watch_interval_ms: z.number().int().positive(),
        max_watch_timeout_ms: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type ConversationControlHandshakeResponse = z.infer<
  typeof ConversationControlHandshakeResponseSchema
>;
