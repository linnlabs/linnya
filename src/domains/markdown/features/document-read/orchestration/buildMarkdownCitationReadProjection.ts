import { DocumentBlockIdSchema, type FlattenedBlock } from '@app/schemas';
import {
  admitDocumentCitationNodeSnapshots,
  collectDocumentCitationNodeSnapshots,
  extractCanonicalCitationRefs,
  projectMarkdownCitationTokens,
  type DocumentCitationNodeSnapshot,
  type DocumentCitationProjection,
} from '../../../../citation';
import { buildCitationNodeAttrs, type CitationNodeHydrationData } from '../../normalization';
import type { MarkdownInlineNodeProjector } from '../../normalization';
import type { MarkdownPendingRevisionLike } from '../../pending-revisions';
import { flattenMarkdownDocumentBlocks } from '../../../shared/markdownBlockProjection';
import { buildMarkdownPreviewBlocks } from '../functions/markdownPreviewBlocks';

interface PendingCitationFacts {
  readonly snapshots: readonly DocumentCitationNodeSnapshot[];
  readonly citationIdByRef: ReadonlyMap<string, string>;
}

export interface MarkdownCitationReadProjection {
  readonly citationProjection: DocumentCitationProjection;
  readonly baseBlocks: readonly FlattenedBlock[];
  readonly viewBlocks: readonly FlattenedBlock[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalString(
  record: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string
): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return undefined;
  return value;
}

function parseCitationHydrationData(value: unknown): CitationNodeHydrationData | null {
  if (!isRecord(value)) return null;
  const title = value['title'];
  const snippet = value['snippet'];
  if (typeof title !== 'string' || typeof snippet !== 'string') return null;
  const sourceType = value['sourceType'];
  const admittedSourceType =
    sourceType === 'knowledge_base' || sourceType === 'web' || sourceType === 'manual'
      ? sourceType
      : undefined;
  const authors = readStringArray(value, 'authors');
  return {
    title,
    snippet,
    ...(readOptionalString(value, 'docId') ? { docId: readOptionalString(value, 'docId') } : {}),
    ...(readOptionalString(value, 'blockId')
      ? { blockId: readOptionalString(value, 'blockId') }
      : {}),
    ...(readOptionalString(value, 'kbId') ? { kbId: readOptionalString(value, 'kbId') } : {}),
    ...(admittedSourceType ? { sourceType: admittedSourceType } : {}),
    ...(readOptionalString(value, 'url') ? { url: readOptionalString(value, 'url') } : {}),
    ...(readOptionalString(value, 'date') ? { date: readOptionalString(value, 'date') } : {}),
    ...(authors ? { authors } : {}),
    ...(readOptionalString(value, 'containerTitle')
      ? { containerTitle: readOptionalString(value, 'containerTitle') }
      : {}),
  };
}

function parsePendingMetadata(metaJson: string | null): Readonly<Record<string, unknown>> {
  if (!metaJson) return {};
  try {
    const parsed: unknown = JSON.parse(metaJson);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isDeletePending(pending: MarkdownPendingRevisionLike): boolean {
  if (pending.operation === 'delete') return true;
  const operation = parsePendingMetadata(pending.meta_json)['operation'];
  return (
    operation === 'delete' ||
    typeof pending.new_markdown !== 'string' ||
    pending.new_markdown.trim().length === 0
  );
}

function buildPendingCitationFacts(pending: MarkdownPendingRevisionLike): PendingCitationFacts {
  if (typeof pending.new_markdown !== 'string') {
    throw new Error(`Pending block ${pending.target_block_id} 没有可读取的 Markdown 内容。`);
  }
  const metadata = parsePendingMetadata(pending.meta_json);
  const rawHydration = metadata['citation_hydration'];
  const hydration = isRecord(rawHydration) ? rawHydration : {};
  const snapshots: DocumentCitationNodeSnapshot[] = [];
  const citationIdByRef = new Map<string, string>();

  for (const ref of extractCanonicalCitationRefs(pending.new_markdown)) {
    const citationId = `pending:${pending.target_block_id}:${ref}`;
    citationIdByRef.set(ref, citationId);
    const data = parseCitationHydrationData(hydration[ref]);
    snapshots.push({
      attrs: data ? buildCitationNodeAttrs({ data, ref, citationId }) : { citationId, ref },
    });
  }

  return { snapshots, citationIdByRef };
}

function listRootBlocks(content: unknown): ReadonlyArray<{
  readonly blockId: string;
  readonly node: unknown;
}> {
  if (!isRecord(content) || !Array.isArray(content['content'])) return [];
  const result: Array<{ readonly blockId: string; readonly node: unknown }> = [];
  for (const rawNode of content['content']) {
    if (!isRecord(rawNode) || rawNode['type'] !== 'rootBlock') continue;
    const attrs = isRecord(rawNode['attrs']) ? rawNode['attrs'] : {};
    const parsedBlockId = DocumentBlockIdSchema.safeParse(attrs['id']);
    if (!parsedBlockId.success) {
      throw new Error(
        `Markdown root block ${result.length + 1} is missing its admitted block identity`
      );
    }
    const blockId = parsedBlockId.data;
    result.push({ blockId, node: rawNode });
  }
  return result;
}

function createSelectiveInlineNodeProjector(params: {
  readonly projection: DocumentCitationProjection;
  readonly visibleCitationIds: ReadonlySet<string>;
}): MarkdownInlineNodeProjector {
  return input => {
    if (input.type !== 'citationNode') return null;
    const citationId = input.attrs['citationId'];
    if (typeof citationId !== 'string' || !params.visibleCitationIds.has(citationId)) return null;
    return params.projection.getBodyTokenForCitationId(citationId);
  };
}

/**
 * 将 persisted root blocks 与 pending hydration 按当前读取视图合成为同一 Citation admission。
 * 这里是 Workspace/Citation 的装配点；Markdown serializer 与 read_file facade 均不解释来源领域。
 */
export function buildMarkdownCitationReadProjection(params: {
  readonly content: unknown;
  readonly pendings: readonly MarkdownPendingRevisionLike[];
  readonly viewMode: 'original' | 'preview';
  readonly includeAnnotations?: boolean;
}): MarkdownCitationReadProjection {
  const roots = listRootBlocks(params.content);
  const pendingByBlockId = new Map(
    params.pendings.map(pending => [pending.target_block_id, pending])
  );
  const pendingFactsByBlockId = new Map<string, PendingCitationFacts>();
  const snapshots: DocumentCitationNodeSnapshot[] = [];

  for (const root of roots) {
    const pending = pendingByBlockId.get(root.blockId);
    if (params.viewMode === 'preview' && pending) {
      if (isDeletePending(pending)) continue;
      const facts = buildPendingCitationFacts(pending);
      pendingFactsByBlockId.set(root.blockId, facts);
      snapshots.push(...facts.snapshots);
      continue;
    }
    snapshots.push(...collectDocumentCitationNodeSnapshots(root.node));
  }

  const citationProjection = admitDocumentCitationNodeSnapshots(snapshots);
  const visibleCitationIds = new Set(
    snapshots
      .map(snapshot => snapshot.attrs['citationId'])
      .filter((citationId): citationId is string => typeof citationId === 'string')
  );
  const citationAwareBaseBlocks = flattenMarkdownDocumentBlocks(params.content, {
    projectInlineNode: createSelectiveInlineNodeProjector({
      projection: citationProjection,
      visibleCitationIds,
    }),
    includeAnnotations: params.includeAnnotations,
  });

  if (params.viewMode === 'original') {
    return {
      citationProjection,
      baseBlocks: citationAwareBaseBlocks,
      viewBlocks: citationAwareBaseBlocks,
    };
  }

  const projectedPendings = params.pendings.map(pending => {
    const facts = pendingFactsByBlockId.get(pending.target_block_id);
    if (!facts || isDeletePending(pending)) return pending;
    if (typeof pending.new_markdown !== 'string') {
      throw new Error(`Pending block ${pending.target_block_id} 没有可投影的 Markdown 内容。`);
    }
    return {
      ...pending,
      new_markdown: projectMarkdownCitationTokens({
        markdown: pending.new_markdown,
        resolveRef: ref => {
          const citationId = facts.citationIdByRef.get(ref);
          if (!citationId) {
            throw new Error(`Pending citation ${ref} 缺少当前视图的 admission identity。`);
          }
          return citationProjection.getBodyTokenForCitationId(citationId);
        },
      }),
    };
  });

  return {
    citationProjection,
    baseBlocks: citationAwareBaseBlocks,
    viewBlocks: buildMarkdownPreviewBlocks({
      baseBlocks: citationAwareBaseBlocks,
      pendings: projectedPendings,
    }),
  };
}
