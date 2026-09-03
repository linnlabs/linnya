import { z } from 'zod';

import type {
  PluginCredentialListStatusRpcRequest,
  PluginCredentialListStatusRpcResponse,
  PluginCredentialReadRpcRequest,
  PluginCredentialReadRpcResponse,
  PluginCredentialWriteRpcRequest,
  PluginCredentialWriteRpcResponse,
} from '../definitions/pluginCredentialRuntimeRpc';

const CredentialStatusSchema = z.object({
  key: z.string(),
  configured: z.boolean(),
}).strict();
const ReadRequestSchema = z.object({
  pluginId: z.string().min(1),
  key: z.string().min(1),
}).strict();
const ReadResponseSchema = z.object({ value: z.string().nullable() }).strict();
const ListStatusRequestSchema = z.object({
  pluginId: z.string().min(1),
  keys: z.array(z.string().min(1)),
}).strict();
const ListStatusResponseSchema = z.object({
  statuses: z.array(CredentialStatusSchema),
}).strict();
const WriteRequestSchema = z.object({
  pluginId: z.string().min(1),
  values: z.record(z.string(), z.string().nullable()),
}).strict();
const WriteResponseSchema = z.object({
  statuses: z.array(CredentialStatusSchema),
}).strict();

export function parsePluginCredentialReadRpcRequest(
  value: unknown,
): PluginCredentialReadRpcRequest {
  return ReadRequestSchema.parse(value);
}

export function parsePluginCredentialReadRpcResponse(
  value: unknown,
): PluginCredentialReadRpcResponse {
  return ReadResponseSchema.parse(value);
}

export function parsePluginCredentialListStatusRpcRequest(
  value: unknown,
): PluginCredentialListStatusRpcRequest {
  return ListStatusRequestSchema.parse(value);
}

export function parsePluginCredentialListStatusRpcResponse(
  value: unknown,
): PluginCredentialListStatusRpcResponse {
  return ListStatusResponseSchema.parse(value);
}

export function parsePluginCredentialWriteRpcRequest(
  value: unknown,
): PluginCredentialWriteRpcRequest {
  return WriteRequestSchema.parse(value);
}

export function parsePluginCredentialWriteRpcResponse(
  value: unknown,
): PluginCredentialWriteRpcResponse {
  return WriteResponseSchema.parse(value);
}
