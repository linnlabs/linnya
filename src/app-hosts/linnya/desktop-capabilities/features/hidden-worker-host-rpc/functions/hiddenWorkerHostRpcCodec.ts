import path from 'node:path';

import { z } from 'zod';
import type { DesktopHiddenWorkerInvocation } from '../../../definitions/desktopHiddenWorkerHostPort';

const NonEmptyStringSchema = z.string().trim().min(1);
const AbsolutePathSchema = NonEmptyStringSchema.refine(value => path.isAbsolute(value), {
  message: '必须是绝对路径',
});
const PositiveIntegerSchema = z.number().int().positive();

export const HiddenWorkerDescriptorRpcSchema = z.object({
  id: NonEmptyStringSchema,
  requestChannel: NonEmptyStringSchema,
  responseChannel: NonEmptyStringSchema,
  readyChannel: NonEmptyStringSchema,
  workerHtmlPath: AbsolutePathSchema,
  preloadPath: AbsolutePathSchema,
  partition: NonEmptyStringSchema.optional(),
  cancelChannel: NonEmptyStringSchema.optional(),
  idleTimeoutMs: PositiveIntegerSchema.optional(),
  readyTimeoutMs: PositiveIntegerSchema.optional(),
  requestTimeoutMs: PositiveIntegerSchema.optional(),
  maxConsecutiveTimeouts: PositiveIntegerSchema.optional(),
}).strict();

export const HiddenWorkerRegisterRpcSchema = z.object({
  descriptor: HiddenWorkerDescriptorRpcSchema,
  replace: z.boolean(),
}).strict();

export const HiddenWorkerIdRpcSchema = z.object({
  workerId: NonEmptyStringSchema,
}).strict();

export const HiddenWorkerInvalidateRpcSchema = z.object({
  workerId: NonEmptyStringSchema,
  reason: NonEmptyStringSchema,
}).strict();

export const HiddenWorkerVoidRpcSchema = z.null();
export const HiddenWorkerBooleanRpcSchema = z.boolean();

export function parseHiddenWorkerInvocationRpc(
  value: unknown,
): DesktopHiddenWorkerInvocation {
  if (!isRecord(value)) throw new Error('Hidden worker invocation 必须是对象');
  const keys = Object.keys(value);
  if (!keys.includes('payload')
    || keys.some(key => key !== 'requestId' && key !== 'payload' && key !== 'cancelPayload')) {
    throw new Error('Hidden worker invocation 字段不合法');
  }
  const requestId = NonEmptyStringSchema.parse(value.requestId);
  return {
    requestId,
    payload: value.payload,
    ...(Object.prototype.hasOwnProperty.call(value, 'cancelPayload')
      ? { cancelPayload: value.cancelPayload }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
