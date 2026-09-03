import { JsonValueSchema } from '@app/schemas';
import { z } from 'zod';

import {
  APP_SERVER_RPC_MAX_FRAME_BYTES,
  APP_SERVER_RPC_SCHEMA_VERSION,
  type AppServerRpcFrame,
} from '../definitions/appServerRpcProtocol';

const IdentifierSchema = z.string().min(1).max(128);
const MethodSchema = z.string().min(1).max(128).regex(/^[a-z][a-z0-9_.:-]*$/u);

const AppServerRpcFrameSchema = z.union([
  z.object({
    schema_version: z.literal(APP_SERVER_RPC_SCHEMA_VERSION),
    kind: z.literal('request'),
    request_id: IdentifierSchema,
    method: MethodSchema,
    payload: JsonValueSchema,
  }).strict(),
  z.object({
    schema_version: z.literal(APP_SERVER_RPC_SCHEMA_VERSION),
    kind: z.literal('response'),
    request_id: IdentifierSchema,
    ok: z.literal(true),
    result: JsonValueSchema,
  }).strict(),
  z.object({
    schema_version: z.literal(APP_SERVER_RPC_SCHEMA_VERSION),
    kind: z.literal('response'),
    request_id: IdentifierSchema,
    ok: z.literal(false),
    error: z.object({
      code: z.enum([
        'method_not_registered',
        'handler_capacity_exceeded',
        'handler_failed',
        'cancelled',
      ]),
      message: z.string().min(1).max(2_048),
    }).strict(),
  }).strict(),
  z.object({
    schema_version: z.literal(APP_SERVER_RPC_SCHEMA_VERSION),
    kind: z.literal('cancel'),
    request_id: IdentifierSchema,
  }).strict(),
]);

export function parseAppServerRpcFrame(value: unknown): AppServerRpcFrame {
  return AppServerRpcFrameSchema.parse(value);
}

export function encodeAppServerRpcFrame(frame: AppServerRpcFrame): Buffer {
  const parsed = parseAppServerRpcFrame(frame);
  const bytes = Buffer.from(`${JSON.stringify(parsed)}\n`, 'utf8');
  if (bytes.byteLength > APP_SERVER_RPC_MAX_FRAME_BYTES) {
    throw new Error(`App Server RPC frame 超过 ${APP_SERVER_RPC_MAX_FRAME_BYTES} bytes`);
  }
  return bytes;
}
