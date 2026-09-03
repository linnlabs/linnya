import type {
  PendingRevisionMetadata,
  PendingRevisionOperation,
} from '../persistence';

export type NormalizedToolPendingIntent =
  | { readonly action: 'cancel_insert' }
  | { readonly action: 'write'; readonly metadata: PendingRevisionMetadata | undefined };

function readOperation(metadata: unknown): PendingRevisionOperation | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const operation = (metadata as Record<string, unknown>).operation;
  return operation === 'insert' || operation === 'update' || operation === 'delete'
    ? operation
    : undefined;
}

function readAnchorBlockId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const anchor = (metadata as Record<string, unknown>).anchorBlockId;
  return typeof anchor === 'string' && anchor.trim().length > 0 ? anchor : undefined;
}

function parseMetadataJson(metadataJson: string | null): unknown {
  if (!metadataJson) return undefined;
  try {
    return JSON.parse(metadataJson) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 归一化工具连续写入同一新块时的修订语义。
 *
 * 新块在正式接受前始终保持 insert 身份；insert 后又 delete 的净效果为取消新块。
 */
export function normalizeToolPendingIntent(input: {
  readonly existingMetadataJson: string | null;
  readonly incomingMetadata: PendingRevisionMetadata | undefined;
}): NormalizedToolPendingIntent {
  const existingMetadata = parseMetadataJson(input.existingMetadataJson);
  if (readOperation(existingMetadata) !== 'insert') {
    return { action: 'write', metadata: input.incomingMetadata };
  }

  if (readOperation(input.incomingMetadata) === 'delete') {
    return { action: 'cancel_insert' };
  }

  const metadata: PendingRevisionMetadata = { ...(input.incomingMetadata ?? {}) };
  metadata.operation = 'insert';
  const anchorBlockId = readAnchorBlockId(existingMetadata)
    ?? readAnchorBlockId(input.incomingMetadata);
  if (anchorBlockId) {
    metadata.anchorBlockId = anchorBlockId;
  }
  return { action: 'write', metadata };
}
