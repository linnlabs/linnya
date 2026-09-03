import { getWorkspaceReferenceContentPort } from '../../../../shared/ports/workspaceReferenceContentPort';
import {
  getDocumentReferenceRuntimeHandler,
  listDocumentReferenceRuntimeHandlers,
} from '@plugin/renderer/documentReferenceRuntimePort';
import { isValidRef, normalizeRef, resolveIdFromRef } from '../../../../shared/utils/refIdGenerator';
import type { ConversationMessageResolver } from '../../definitions/conversationMessages';
import {
  HistoricalWorkspaceReadFileEventResultSchema,
  WorkspaceReadFileEventResultSchema,
} from '@app/schemas';

export type DocType = string;

export type ParsedWorkspaceRef = {
  ref: string;
  documentId?: string;
  docTypeHint?: DocType;
};

export type DocumentCandidate = {
  documentId: string;
  docType: DocType;
};

/**
 * 只从 canonical read_file 结构化结果中接纳跨文档引用候选。
 * 工具 observation 属于模型文本，不能作为文档身份的恢复来源。
 */
export function readWorkspaceDocumentCandidate(
  toolName: string,
  result: unknown,
): DocumentCandidate | null {
  if (toolName !== 'read_file') return null;

  const live = WorkspaceReadFileEventResultSchema.safeParse(result);
  if (live.success) {
    const data = live.data.data;
    if (data.source_kind !== 'workspace_document') return null;

    return {
      documentId: data.document.documentId,
      docType: data.document.docType,
    };
  }

  const historical = HistoricalWorkspaceReadFileEventResultSchema.safeParse(result);
  if (!historical.success) return null;
  const data = historical.data.data;
  if (!('source' in data) || data.source !== 'workspace_document') return null;

  return {
    documentId: data.document.documentId,
    docType: data.document.docType,
  };
}

export interface ResolvedReferenceMatch {
  documentId: string;
  docType: DocType;
  resolvedId: string;
  /** markdown 段落引用的人类序号；插件文档引用不要求提供。 */
  index?: number;
}

export type ResolvedMarkdownReference = ResolvedReferenceMatch & { docType: 'markdown'; index: number };
export type ResolvedPluginReference = ResolvedReferenceMatch;

const REF_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const REF_LEN = 6;

const inflightMarkdownResolves = new Map<string, Promise<ResolvedMarkdownReference | null>>();
const inflightPluginResolves = new Map<string, Promise<ResolvedPluginReference | null>>();

export function getPluginReferenceLabel(
  docType: DocType,
  conversationMessage: ConversationMessageResolver
): string {
  const runtime = getDocumentReferenceRuntimeHandler(docType.trim());
  return runtime?.referenceLabel?.trim()
    || conversationMessage('conversation.tool.workspace.reference.documentLabel');
}

export function findCurrentPluginReferenceDocument(documentId: string | null | undefined): DocumentCandidate | null {
  if (!documentId) return null;
  for (const runtime of listDocumentReferenceRuntimeHandlers()) {
    if (runtime.getCurrentDocumentId() === documentId) {
      return {
        documentId,
        docType: runtime.documentType,
      };
    }
  }
  return null;
}

export function parseWorkspaceRefId(raw: string): ParsedWorkspaceRef | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const m = new RegExp(`^#?([${REF_CHARSET}]{${REF_LEN}})(?:@([^\\s]+))?$`).exec(s);
  if (!m?.[1]) return null;

  const ref = `#${m[1]}`;
  const hintRaw = typeof m[2] === 'string' ? m[2].trim() : '';
  if (!hintRaw) return { ref };

  const prefixMatch = /^([^:\s]+):(.+)$/.exec(hintRaw);
  if (prefixMatch?.[1] && prefixMatch?.[2]) {
    const docTypeHint = prefixMatch[1].trim();
    const documentId = prefixMatch[2].trim();
    return documentId && docTypeHint ? { ref, documentId, docTypeHint } : { ref };
  }

  return { ref, documentId: hintRaw };
}

export function uniqCandidates(items: DocumentCandidate[]): DocumentCandidate[] {
  const seen = new Set<string>();
  const result: DocumentCandidate[] = [];
  for (const it of items) {
    const key = `${it.docType}:${it.documentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(it);
  }
  return result;
}

export async function resolveMarkdownReferenceInDocument(
  documentId: string,
  ref: string
): Promise<ResolvedMarkdownReference | null> {
  const normalizedRef = normalizeRef(ref);
  if (!isValidRef(normalizedRef)) return null;

  const cacheKey = `${documentId}:${normalizedRef}`;
  const existing = inflightMarkdownResolves.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<ResolvedMarkdownReference | null> => {
    const blockIds = await getWorkspaceReferenceContentPort().getMarkdownRootBlockIds(documentId);
    if (blockIds.length === 0) return null;

    const resolvedId = await resolveIdFromRef(normalizedRef, blockIds);
    if (!resolvedId) return null;

    const index = blockIds.indexOf(resolvedId);
    if (index === -1) return null;

    return {
      documentId,
      docType: 'markdown',
      resolvedId,
      index: index + 1,
    };
  })().finally(() => {
    inflightMarkdownResolves.delete(cacheKey);
  });

  inflightMarkdownResolves.set(cacheKey, promise);
  return promise;
}

export async function resolvePluginReferenceInDocument(
  docType: DocType,
  documentId: string,
  ref: string
): Promise<ResolvedPluginReference | null> {
  const normalizedDocType = docType.trim();
  if (!normalizedDocType || normalizedDocType === 'markdown') return null;

  const normalizedRef = normalizeRef(ref);
  if (!isValidRef(normalizedRef)) return null;

  const cacheKey = `${normalizedDocType}:${documentId}:${normalizedRef}`;
  const existing = inflightPluginResolves.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<ResolvedPluginReference | null> => {
    const referenceRuntime = getDocumentReferenceRuntimeHandler(normalizedDocType);
    if (!referenceRuntime) return null;

    const nodeIds = await referenceRuntime.listReferenceIds(documentId);
    if (nodeIds.length === 0) return null;

    const resolvedId = await resolveIdFromRef(normalizedRef, Array.from(nodeIds));
    if (!resolvedId) return null;

    return {
      documentId,
      docType: normalizedDocType,
      resolvedId,
    };
  })().finally(() => {
    inflightPluginResolves.delete(cacheKey);
  });

  inflightPluginResolves.set(cacheKey, promise);
  return promise;
}

export async function resolveReferenceMatches(
  ref: string,
  candidates: DocumentCandidate[]
): Promise<ResolvedReferenceMatch[]> {
  const uniq = uniqCandidates(candidates);
  if (uniq.length === 0) return [];

  const results = await Promise.all(
    uniq.map((candidate) =>
      candidate.docType === 'markdown'
        ? resolveMarkdownReferenceInDocument(candidate.documentId, ref)
        : resolvePluginReferenceInDocument(candidate.docType, candidate.documentId, ref)
    )
  );

  return results.filter((item): item is ResolvedReferenceMatch => item !== null);
}
