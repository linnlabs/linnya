import { z } from 'zod';

import {
  APP_SERVER_CONTROL_MAX_FRAME_BYTES,
  APP_SERVER_CONTROL_PROTOCOL_VERSION,
  APP_SERVER_CONTROL_SCHEMA_VERSION,
  type AppServerChildControlFrame,
  type AppServerParentControlFrame,
} from '../definitions/appServerControlProtocol';

const NonEmptyIdentifierSchema = z.string().min(1).max(128);

const ParentFrameSchema = z.object({
  schema_version: z.literal(APP_SERVER_CONTROL_SCHEMA_VERSION),
  kind: z.literal('request'),
  request_id: NonEmptyIdentifierSchema,
  operation: z.enum(['ping', 'shutdown']),
}).strict();

const ChildFrameSchema = z.discriminatedUnion('kind', [
  z.object({
    schema_version: z.literal(APP_SERVER_CONTROL_SCHEMA_VERSION),
    kind: z.literal('ready'),
    protocol_version: z.literal(APP_SERVER_CONTROL_PROTOCOL_VERSION),
    daemon_epoch: NonEmptyIdentifierSchema,
    pid: z.number().int().positive(),
    application_version: z.string().min(1).max(128),
    api_port: z.number().int().min(1).max(65_535),
    renderer_session_token: z.string().min(32).max(256),
    database_ready: z.literal(true),
  }).strict(),
  z.object({
    schema_version: z.literal(APP_SERVER_CONTROL_SCHEMA_VERSION),
    kind: z.literal('response'),
    request_id: NonEmptyIdentifierSchema,
    operation: z.enum(['ping', 'shutdown']),
    daemon_epoch: NonEmptyIdentifierSchema,
  }).strict(),
  z.object({
    schema_version: z.literal(APP_SERVER_CONTROL_SCHEMA_VERSION),
    kind: z.literal('fatal'),
    code: z.enum(['startup_failed', 'protocol_failed', 'shutdown_failed']),
    message: z.string().min(1).max(2_048),
  }).strict(),
]);

export function parseAppServerParentControlFrame(
  value: unknown,
): AppServerParentControlFrame {
  return ParentFrameSchema.parse(value);
}

export function parseAppServerChildControlFrame(
  value: unknown,
): AppServerChildControlFrame {
  return ChildFrameSchema.parse(value);
}

export function encodeAppServerControlFrame(
  frame: AppServerParentControlFrame | AppServerChildControlFrame,
): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(frame)}\n`, 'utf8');
  if (bytes.byteLength > APP_SERVER_CONTROL_MAX_FRAME_BYTES) {
    throw new Error(
      `App Server control frame 超过 ${APP_SERVER_CONTROL_MAX_FRAME_BYTES} bytes`,
    );
  }
  return bytes;
}
