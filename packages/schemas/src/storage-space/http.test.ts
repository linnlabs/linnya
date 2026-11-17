import { describe, expect, it } from 'vitest';

import {
  STORAGE_SPACE_CATEGORY_ORDER,
  StorageSpaceConversationIdSchema,
  StorageSpaceErrorResponseSchema,
  StorageSpaceOverviewResponseSchema,
} from './http';

function createOverview() {
  return {
    measured_at_ms: 1_786_104_001_000,
    total_byte_size: 21,
    categories: STORAGE_SPACE_CATEGORY_ORDER.map((kind, index) => ({
      kind,
      byte_size: index + 1,
    })),
  } as const;
}

describe('storage-space HTTP wire contract', () => {
  it('accepts six exclusive categories without conversation details', () => {
    const parsed = StorageSpaceOverviewResponseSchema.parse(createOverview());

    expect(parsed.total_byte_size).toBe(21);
    expect(parsed).not.toHaveProperty('conversations');
  });

  it('does not make category order a schema concern', () => {
    const overview = createOverview();
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      categories: [...overview.categories].reverse(),
    }).success).toBe(true);
  });

  it('rejects duplicate, missing, or arithmetically inconsistent categories', () => {
    const overview = createOverview();
    const duplicate = overview.categories.map((category, index) => (
      index === overview.categories.length - 1
        ? { ...category, kind: 'diagnostic_logs' as const }
        : category
    ));

    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      categories: duplicate,
    }).success).toBe(false);
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      categories: overview.categories.slice(0, -1),
    }).success).toBe(false);
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      total_byte_size: 20,
    }).success).toBe(false);
  });

  it('rejects unsafe counts', () => {
    const overview = createOverview();

    for (const invalidByteSize of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(StorageSpaceOverviewResponseSchema.safeParse({
        ...overview,
        categories: overview.categories.map((category, index) => (
          index === 0 ? { ...category, byte_size: invalidByteSize } : category
        )),
      }).success).toBe(false);
    }
  });

  it('rejects empty, padded, or NUL conversation identities without banning path characters', () => {
    for (const conversationId of ['', ' padded', 'padded ', 'nul\0identity']) {
      expect(StorageSpaceConversationIdSchema.safeParse(conversationId).success).toBe(false);
    }
    expect(StorageSpaceConversationIdSchema.parse('conversation/with\\path')).toBe('conversation/with\\path');
  });

  it('keeps successful and error payloads strict', () => {
    const overview = createOverview();
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      hidden_path: '/private/storage',
    }).success).toBe(false);
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      conversations: [],
    }).success).toBe(false);

    const codes = [
      'storage_space.invalid_conversation_id',
      'storage_space.conversation_not_found',
      'storage_space.conversation_deletion_in_progress',
      'storage_space.overview_failed',
      'storage_space.work_directory_clear_failed',
    ] as const;
    for (const code of codes) {
      expect(StorageSpaceErrorResponseSchema.parse({ code })).toEqual({ code });
    }
    expect(StorageSpaceErrorResponseSchema.safeParse({
      code: 'storage_space.overview_failed',
      details: '/private/storage',
    }).success).toBe(false);
    expect(StorageSpaceErrorResponseSchema.safeParse({
      code: 'storage_space.unknown',
    }).success).toBe(false);
  });
});
