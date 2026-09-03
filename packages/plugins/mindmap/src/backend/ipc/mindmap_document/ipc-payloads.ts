import { isCitationSourceType } from '@app/schemas';
import { normalizeMindmap, type MindMapData } from '@plugin/mindmap/shared';
import type {
  CreateMindMapParams,
  UpdateMindMapParams,
} from '../../persistence/mindmap_document/services/mindmap_document.service';
import type {
  CreateEvidenceParams,
  UpdateEvidenceParams,
} from '../../persistence/mindmap_document/services/blocks/evidence.service';

export type DocumentIdPayload = {
  documentId: string;
};

export type EvidenceIdPayload = {
  id: string;
};

export type EvidenceListPayload = {
  documentId: string;
  nodeId: string;
};

export type EvidenceNodeIdsPayload = {
  documentId: string;
  nodeIds: string[];
};

export type EvidenceMovePayload = {
  documentId: string;
  sourceNodeId: string;
  targetNodeId: string;
};

type MindMapMetadataPayload = NonNullable<UpdateMindMapParams['metadata']>;
type MindMapViewportPayload = NonNullable<MindMapMetadataPayload['viewport']>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(channel: string, message: string): never {
  throw new Error(`[${channel}] IPC payload 无效：${message}`);
}

function readRequiredString(record: Record<string, unknown>, key: string, channel: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(channel, `${key} 必须是非空字符串`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string, channel: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    fail(channel, `${key} 必须是字符串`);
  }
  return value;
}

function readOptionalNullableString(record: Record<string, unknown>, key: string, channel: string): string | null | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    fail(channel, `${key} 必须是字符串或 null`);
  }
  return value;
}

function readOptionalNumber(record: Record<string, unknown>, key: string, channel: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(channel, `${key} 必须是有限数字`);
  }
  return value;
}

function readRequiredStringArray(record: Record<string, unknown>, key: string, channel: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    fail(channel, `${key} 必须是非空字符串数组`);
  }
  return value;
}

function readOptionalStringArray(record: Record<string, unknown>, key: string, channel: string): string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(channel, `${key} 必须是字符串数组`);
  }
  return value;
}

function readPayloadRecord(payload: unknown, channel: string): Record<string, unknown> {
  if (!isRecord(payload)) {
    fail(channel, 'payload 必须是对象');
  }
  return payload;
}

function readOptionalMindMapContent(record: Record<string, unknown>, key: string, fallbackName: string): MindMapData | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  return normalizeMindmap(value, fallbackName);
}

function readRequiredMindMapContent(record: Record<string, unknown>, key: string, fallbackName: string, channel: string): MindMapData {
  const value = record[key];
  if (value === undefined) {
    fail(channel, `${key} 不能为空`);
  }
  return normalizeMindmap(value, fallbackName);
}

function parseMindMapViewport(payload: unknown, channel: string): MindMapViewportPayload | undefined {
  if (payload === undefined) return undefined;
  if (!isRecord(payload)) {
    fail(channel, 'metadata.viewport 必须是对象');
  }
  return {
    x: readOptionalNumber(payload, 'x', channel) ?? 0,
    y: readOptionalNumber(payload, 'y', channel) ?? 0,
    scale: readOptionalNumber(payload, 'scale', channel) ?? 1,
  };
}

function parseMindMapMetadata(payload: unknown, channel: string): MindMapMetadataPayload | undefined {
  if (payload === undefined) return undefined;
  if (!isRecord(payload)) {
    fail(channel, 'metadata 必须是对象');
  }

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

function readEvidenceSourceType(record: Record<string, unknown>, channel: string): CreateEvidenceParams['sourceType'] {
  const value = record.sourceType;
  if (!isCitationSourceType(value)) {
    fail(channel, 'sourceType 不是有效引用来源类型');
  }
  return value;
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
  return {
    documentId: readRequiredString(record, 'documentId', channel),
  };
}

export function parseUpdateMindMapPayload(payload: unknown): UpdateMindMapParams {
  const channel = 'mindmap-document:update';
  const record = readPayloadRecord(payload, channel);
  const documentId = readRequiredString(record, 'documentId', channel);
  const expectedBaseVersionNumber = readOptionalNumber(record, 'expectedBaseVersionNumber', channel);
  const parsed: UpdateMindMapParams = {
    documentId,
    content: readRequiredMindMapContent(record, 'content', documentId, channel),
  };
  const metadata = parseMindMapMetadata(record.metadata, channel);
  if (expectedBaseVersionNumber !== undefined) parsed.expectedBaseVersionNumber = expectedBaseVersionNumber;
  if (metadata) parsed.metadata = metadata;
  return parsed;
}

export function parseCreateEvidencePayload(payload: unknown): CreateEvidenceParams {
  const channel = 'mindmap-evidence:add';
  const record = readPayloadRecord(payload, channel);
  const parsed: CreateEvidenceParams = {
    documentId: readRequiredString(record, 'documentId', channel),
    mindmapNodeId: readRequiredString(record, 'mindmapNodeId', channel),
    sourceType: readEvidenceSourceType(record, channel),
    sourceId: readRequiredString(record, 'sourceId', channel),
  };

  const ref = readOptionalString(record, 'ref', channel);
  const title = readOptionalString(record, 'title', channel);
  const snippet = readOptionalString(record, 'snippet', channel);
  const url = readOptionalString(record, 'url', channel);
  const authors = readOptionalStringArray(record, 'authors', channel);
  const date = readOptionalString(record, 'date', channel);
  const containerTitle = readOptionalString(record, 'containerTitle', channel);
  const note = readOptionalString(record, 'note', channel);
  const orderIndex = readOptionalNumber(record, 'orderIndex', channel);

  if (ref !== undefined) parsed.ref = ref;
  if (title !== undefined) parsed.title = title;
  if (snippet !== undefined) parsed.snippet = snippet;
  if (url !== undefined) parsed.url = url;
  if (authors !== undefined) parsed.authors = authors;
  if (date !== undefined) parsed.date = date;
  if (containerTitle !== undefined) parsed.containerTitle = containerTitle;
  if (note !== undefined) parsed.note = note;
  if (orderIndex !== undefined) parsed.orderIndex = orderIndex;
  return parsed;
}

export function parseUpdateEvidencePayload(payload: unknown): UpdateEvidenceParams {
  const channel = 'mindmap-evidence:update';
  const record = readPayloadRecord(payload, channel);
  const parsed: UpdateEvidenceParams = {
    id: readRequiredString(record, 'id', channel),
  };

  const ref = readOptionalString(record, 'ref', channel);
  const title = readOptionalString(record, 'title', channel);
  const snippet = readOptionalString(record, 'snippet', channel);
  const url = readOptionalString(record, 'url', channel);
  const authors = readOptionalStringArray(record, 'authors', channel);
  const date = readOptionalString(record, 'date', channel);
  const containerTitle = readOptionalString(record, 'containerTitle', channel);
  const note = readOptionalString(record, 'note', channel);
  const orderIndex = readOptionalNumber(record, 'orderIndex', channel);

  if (ref !== undefined) parsed.ref = ref;
  if (title !== undefined) parsed.title = title;
  if (snippet !== undefined) parsed.snippet = snippet;
  if (url !== undefined) parsed.url = url;
  if (authors !== undefined) parsed.authors = authors;
  if (date !== undefined) parsed.date = date;
  if (containerTitle !== undefined) parsed.containerTitle = containerTitle;
  if (note !== undefined) parsed.note = note;
  if (orderIndex !== undefined) parsed.orderIndex = orderIndex;
  return parsed;
}

export function parseEvidenceIdPayload(payload: unknown): EvidenceIdPayload {
  const channel = 'mindmap-evidence:remove';
  const record = readPayloadRecord(payload, channel);
  return { id: readRequiredString(record, 'id', channel) };
}

export function parseEvidenceListPayload(payload: unknown): EvidenceListPayload {
  const channel = 'mindmap-evidence:list';
  const record = readPayloadRecord(payload, channel);
  return {
    documentId: readRequiredString(record, 'documentId', channel),
    nodeId: readRequiredString(record, 'nodeId', channel),
  };
}

export function parseEvidenceNodeIdsPayload(payload: unknown, channel: string): EvidenceNodeIdsPayload {
  const record = readPayloadRecord(payload, channel);
  return {
    documentId: readRequiredString(record, 'documentId', channel),
    nodeIds: readRequiredStringArray(record, 'nodeIds', channel),
  };
}

export function parseEvidenceMovePayload(payload: unknown, channel: string): EvidenceMovePayload {
  const record = readPayloadRecord(payload, channel);
  return {
    documentId: readRequiredString(record, 'documentId', channel),
    sourceNodeId: readRequiredString(record, 'sourceNodeId', channel),
    targetNodeId: readRequiredString(record, 'targetNodeId', channel),
  };
}

export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
