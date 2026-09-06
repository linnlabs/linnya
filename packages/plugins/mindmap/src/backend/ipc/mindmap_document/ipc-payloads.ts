import { normalizeMindmap, type MindMapData } from '@plugin/mindmap/shared';
import type {
  CreateMindMapParams,
  UpdateMindMapParams,
} from '../../persistence/mindmap_document/services/mindmap_document.service';

export type DocumentIdPayload = { documentId: string };

type MindMapMetadataPayload = NonNullable<UpdateMindMapParams['metadata']>;
type MindMapViewportPayload = NonNullable<MindMapMetadataPayload['viewport']>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(channel: string, message: string): never {
  throw new Error(`[${channel}] IPC payload 无效：${message}`);
}

function readRequiredString(record: Record<string, unknown>, key: string, channel: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) fail(channel, `${key} 必须是非空字符串`);
  return value;
}

function readOptionalNullableString(
  record: Record<string, unknown>,
  key: string,
  channel: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') fail(channel, `${key} 必须是字符串或 null`);
  return value;
}

function readOptionalNumber(record: Record<string, unknown>, key: string, channel: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(channel, `${key} 必须是有限数字`);
  return value;
}

function readPayloadRecord(payload: unknown, channel: string): Record<string, unknown> {
  if (!isRecord(payload)) fail(channel, 'payload 必须是对象');
  return payload;
}

function readOptionalMindMapContent(record: Record<string, unknown>, key: string, fallbackName: string): MindMapData | undefined {
  const value = record[key];
  return value === undefined ? undefined : normalizeMindmap(value, fallbackName);
}

function readRequiredMindMapContent(record: Record<string, unknown>, key: string, fallbackName: string, channel: string): MindMapData {
  if (record[key] === undefined) fail(channel, `${key} 不能为空`);
  return normalizeMindmap(record[key], fallbackName);
}

function parseMindMapViewport(payload: unknown, channel: string): MindMapViewportPayload | undefined {
  if (payload === undefined) return undefined;
  if (!isRecord(payload)) fail(channel, 'metadata.viewport 必须是对象');
  return {
    x: readOptionalNumber(payload, 'x', channel) ?? 0,
    y: readOptionalNumber(payload, 'y', channel) ?? 0,
    scale: readOptionalNumber(payload, 'scale', channel) ?? 1,
  };
}

function parseMindMapMetadata(payload: unknown, channel: string): MindMapMetadataPayload | undefined {
  if (payload === undefined) return undefined;
  if (!isRecord(payload)) fail(channel, 'metadata 必须是对象');

  const metadata: MindMapMetadataPayload = {};
  const rootTopic = readOptionalNullableString(payload, 'rootTopic', channel);
  const themeName = readOptionalNullableString(payload, 'themeName', channel);
  const layoutType = readOptionalNumber(payload, 'layoutType', channel);
  const nodeCount = readOptionalNumber(payload, 'nodeCount', channel);
  const viewport = parseMindMapViewport(payload.viewport, channel);

  if (rootTopic !== undefined && rootTopic !== null) metadata.rootTopic = rootTopic;
  if (themeName !== undefined && themeName !== null) metadata.themeName = themeName;
  if (layoutType !== undefined) metadata.layoutType = layoutType;
  if (nodeCount !== undefined) metadata.nodeCount = nodeCount;
  if (viewport) metadata.viewport = viewport;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function parseCreateMindMapPayload(payload: unknown): CreateMindMapParams {
  const channel = 'mindmap-document:create';
  const record = readPayloadRecord(payload, channel);
  const name = readRequiredString(record, 'name', channel);
  return {
    projectId: readRequiredString(record, 'projectId', channel),
    parentId: readOptionalNullableString(record, 'parentId', channel) ?? null,
    name,
    content: readOptionalMindMapContent(record, 'content', name),
  };
}

export function parseReadMindMapPayload(payload: unknown): DocumentIdPayload {
  const channel = 'mindmap-document:read';
  const record = readPayloadRecord(payload, channel);
  return { documentId: readRequiredString(record, 'documentId', channel) };
}

export function parseUpdateMindMapPayload(payload: unknown): UpdateMindMapParams {
  const channel = 'mindmap-document:update';
  const record = readPayloadRecord(payload, channel);
  const documentId = readRequiredString(record, 'documentId', channel);
  const parsed: UpdateMindMapParams = {
    documentId,
    content: readRequiredMindMapContent(record, 'content', documentId, channel),
  };
  const expectedBaseVersionNumber = readOptionalNumber(record, 'expectedBaseVersionNumber', channel);
  const metadata = parseMindMapMetadata(record.metadata, channel);
  if (expectedBaseVersionNumber !== undefined) parsed.expectedBaseVersionNumber = expectedBaseVersionNumber;
  if (metadata) parsed.metadata = metadata;
  return parsed;
}

export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
