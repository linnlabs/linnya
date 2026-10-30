import { parseSlidesCommand } from '@plugin/slides/shared/ipcCommands';
import * as z from 'zod';
import {
  SlidesNodePayloadSchema,
  SlidesManualEditCommandSchema,
  SlidesSourceSlicesSchema,
  SlidesTemplateImportSchema,
} from '@plugin/slides/shared/ipcCommands';
import type { SlidesIpcChannel } from '@plugin/slides/shared/ipc';

export {
  SLIDES_IPC,
  SLIDES_IPC_CHANNELS,
  SLIDES_PLUGIN_ID,
  SLIDES_TEMPLATE_IMPORT_MAX_BYTES,
} from '@plugin/slides/shared/ipc';
export type { OperationResult, SlidesIpcChannel } from '@plugin/slides/shared/ipc';
export { parsePresentationExportRequest } from '@plugin/slides/shared/presentationExport';
export type SlidesNodePayload = z.infer<typeof SlidesNodePayloadSchema>;
export type SlidesSourceSlicesPayload = z.infer<typeof SlidesSourceSlicesSchema>;
export type SlidesTemplateImportPayload = Omit<
  z.infer<typeof SlidesTemplateImportSchema>,
  'buffer'
> & { buffer: Buffer };

export function parseSlidesNodePayload(
  payload: unknown,
  _channel: SlidesIpcChannel
): SlidesNodePayload {
  return parseSlidesCommand(SlidesNodePayloadSchema, payload);
}
export function parseSlidesSourceSlicesPayload(payload: unknown): SlidesSourceSlicesPayload {
  return parseSlidesCommand(SlidesSourceSlicesSchema, payload);
}
export function parseSlidesManualEditPayload(payload: unknown) {
  return parseSlidesCommand(SlidesManualEditCommandSchema, payload);
}
export function parseSlidesTemplateImportPayload(payload: unknown): SlidesTemplateImportPayload {
  const parsed = parseSlidesCommand(SlidesTemplateImportSchema, payload);
  return {
    ...parsed,
    buffer: Buffer.from(parsed.buffer.buffer, parsed.buffer.byteOffset, parsed.buffer.byteLength),
  };
}
export function readSlidesIpcErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return `请求参数无效：${
      error.issues
        .map(issue => issue.path.join('.'))
        .filter(Boolean)
        .join('、') || 'payload'
    }`;
  return error instanceof Error ? error.message : String(error);
}
