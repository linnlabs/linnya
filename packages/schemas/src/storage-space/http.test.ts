import { describe, expect, it } from 'vitest';

import {
  STORAGE_SPACE_CATEGORY_ORDER,
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
    conversations: [
      {
        conversation_id: 'conversation/with\\path',
        title: '中文对话',
        project_id: null,
        work_files_state: 'available',
        byte_size: 1,
        file_count: 1,
      },
      {
        conversation_id: 'conversation-cleared',
        title: '已清理',
        project_id: 'project-1',
        work_files_state: 'previous_files_unavailable',
        byte_size: 0,
        file_count: 0,
      },
      {
        conversation_id: 'conversation-unavailable',
        title: '无法计量',
        project_id: null,
        work_files_state: 'unavailable',
        byte_size: null,
        file_count: null,
      },
    ],
  } as const;
}

describe('storage-space HTTP wire contract', () => {
  it('accepts six exclusive categories and preserves current conversation identity semantics', () => {
    const parsed = StorageSpaceOverviewResponseSchema.parse(createOverview());

    expect(parsed.total_byte_size).toBe(21);
    expect(parsed.conversations[0]?.conversation_id).toBe('conversation/with\\path');
    expect(parsed.conversations[1]?.project_id).toBe('project-1');
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

  it('rejects unsafe counts and impossible unavailable-work-file projections', () => {
    const overview = createOverview();

    for (const invalidByteSize of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(StorageSpaceOverviewResponseSchema.safeParse({
        ...overview,
        categories: overview.categories.map((category, index) => (
          index === 0 ? { ...category, byte_size: invalidByteSize } : category
        )),
      }).success).toBe(false);
    }
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      conversations: [{
        ...overview.conversations[1],
        byte_size: 1,
      }],
    }).success).toBe(false);
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      conversations: [{
        ...overview.conversations[2],
        byte_size: 0,
        file_count: 0,
      }],
    }).success).toBe(false);
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      conversations: [{
        ...overview.conversations[0],
        byte_size: null,
        file_count: null,
      }],
    }).success).toBe(false);
  });

  it('rejects empty, padded, or NUL conversation identities without banning path characters', () => {
    const overview = createOverview();
    for (const conversationId of ['', ' padded', 'padded ', 'nul\0identity']) {
      expect(StorageSpaceOverviewResponseSchema.safeParse({
        ...overview,
        conversations: [{
          ...overview.conversations[0],
          conversation_id: conversationId,
        }],
      }).success).toBe(false);
    }
  });

  it('keeps successful and error payloads strict', () => {
    const overview = createOverview();
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      hidden_path: '/private/storage',
    }).success).toBe(false);
    expect(StorageSpaceOverviewResponseSchema.safeParse({
      ...overview,
      conversations: [{
        ...overview.conversations[0],
        absolute_path: '/private/storage',
      }],
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
