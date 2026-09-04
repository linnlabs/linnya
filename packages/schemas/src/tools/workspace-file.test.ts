import { describe, expect, it } from 'vitest';

import {
  WorkspaceEditFileArgsSchema,
  WorkspaceGrepArgsSchema,
  WorkspaceListFilesArgsSchema,
  WorkspaceReadFileArgsSchema,
  WorkspaceReadFileEventResultSchema,
  WorkspaceReadFileResultSchema,
  WorkspaceWriteFileArgsSchema,
} from './workspace-file';

describe('Workspace live file-tool locator schemas', () => {
  it('requires canonical locators while preserving Workspace inode addressing', () => {
    expect(WorkspaceListFilesArgsSchema.parse({})).toMatchObject({ locator: 'workspace:/' });
    expect(WorkspaceGrepArgsSchema.parse({ pattern: 'needle' })).toMatchObject({
      locator: 'workspace:/',
    });
    expect(WorkspaceListFilesArgsSchema.parse({ inode: 'workspace:node-1' }).locator).toBeUndefined();
    expect(WorkspaceGrepArgsSchema.parse({ pattern: 'needle', inode: 'workspace:node-1' }).locator).toBeUndefined();
    expect(WorkspaceReadFileArgsSchema.parse({ inode: 'workspace:node-1' })).toMatchObject({
      inode: 'workspace:node-1',
      view: 'text',
      offset: 1,
      limit: 2_000,
    });
    expect(WorkspaceWriteFileArgsSchema.parse({
      locator: 'workspace:/notes.md',
      content: 'notes',
    }).locator).toBe('workspace:/notes.md');
    expect(WorkspaceEditFileArgsSchema.parse({
      locator: 'workspace:/notes.md',
      old_string: 'a',
      new_string: 'b',
    }).locator).toBe('workspace:/notes.md');

    expect(WorkspaceReadFileArgsSchema.safeParse({ path: '/notes.md' }).success).toBe(false);
    expect(WorkspaceWriteFileArgsSchema.safeParse({ path: '/notes.md', content: 'x' }).success)
      .toBe(false);
  });

  it('requires one command identity and never admits locator plus inode together', () => {
    const dualIdentity = {
      locator: 'workspace:/notes.md',
      inode: 'workspace:dummy',
    };

    expect(WorkspaceListFilesArgsSchema.safeParse(dualIdentity).success).toBe(false);
    expect(WorkspaceReadFileArgsSchema.safeParse(dualIdentity).success).toBe(false);
    expect(WorkspaceWriteFileArgsSchema.safeParse({
      ...dualIdentity,
      content: 'notes',
    }).success).toBe(false);
    expect(WorkspaceEditFileArgsSchema.safeParse({
      ...dualIdentity,
      old_string: 'a',
      new_string: 'b',
    }).success).toBe(false);
    expect(WorkspaceGrepArgsSchema.safeParse({
      ...dualIdentity,
      pattern: 'needle',
    }).success).toBe(false);

    expect(WorkspaceListFilesArgsSchema.parse({})).toMatchObject({ locator: 'workspace:/' });
    expect(WorkspaceGrepArgsSchema.parse({ pattern: 'needle' })).toMatchObject({
      locator: 'workspace:/',
    });
  });

  it('rejects invalid address-space usage before provider access', () => {
    expect(WorkspaceReadFileArgsSchema.safeParse({
      locator: 'conversation:/out.png',
      inode: 'workspace:node-1',
    }).success).toBe(false);
    expect(WorkspaceReadFileArgsSchema.safeParse({
      locator: 'file:///tmp/a.md',
      view: 'document',
    }).success).toBe(false);
    expect(WorkspaceReadFileArgsSchema.safeParse({
      locator: 'workspace:/notes.md',
      offset: 0,
    }).success).toBe(false);
    expect(WorkspaceReadFileArgsSchema.safeParse({
      locator: 'workspace:/notes.md',
      view: 'document',
      offset: 1,
    }).success).toBe(false);
    expect(WorkspaceReadFileArgsSchema.safeParse({
      locator: 'workspace:/notes.md',
      offset_chars: 10,
    }).success).toBe(false);
    expect(WorkspaceReadFileArgsSchema.parse({
      locator: 'workspace:/notes.md',
      view: 'document',
      offset_chars: 10,
    })).toMatchObject({ view: 'document', offset_chars: 10, max_chars: 4_000 });
  });

  it('uses locator and source_kind in every live read result family', () => {
    expect(WorkspaceReadFileResultSchema.parse({
      data: {
        source_kind: 'conversation_file',
        locator: 'conversation:/renders/slide-001.png',
        file_name: 'slide-001.png',
        content_type: 'image/png',
        byte_length: 1024,
        width: 1600,
        height: 900,
        attachment_status: 'attached',
      },
      observation: '已读取图片。',
      modelInput: { attachments: [{ id: 'selection-1', uri: 'asset-claim://claims/1' }] },
    }).data.source_kind).toBe('conversation_file');

    expect(WorkspaceReadFileResultSchema.parse({
      data: {
        source_kind: 'host_file',
        locator: 'file:///tmp/report.md',
        file_name: 'report.md',
        content_type: 'text/markdown',
        byte_length: 128,
        offset: 1,
        limit: 2_000,
        line_count: 2,
        total_line_count: 2,
        has_more: false,
      },
      observation: '# Report',
    }).data.source_kind).toBe('host_file');
  });

  it('图片只在 attached 时携带新的模型输入声明', () => {
    const base = {
      source_kind: 'conversation_file' as const,
      locator: 'conversation:/renders/slide-001.png',
      file_name: 'slide-001.png',
      content_type: 'image/png' as const,
      byte_length: 1024,
      width: 1600,
      height: 900,
    };
    expect(WorkspaceReadFileResultSchema.parse({
      data: { ...base, attachment_status: 'already_attached' },
      observation: '相同像素已在当前 run 中。',
    }).data).toMatchObject({ attachment_status: 'already_attached' });
    expect(WorkspaceReadFileResultSchema.safeParse({
      data: { ...base, attachment_status: 'already_attached' },
      observation: 'invalid duplicate',
      modelInput: { attachments: [{ id: 'selection-1', uri: 'asset-claim://claims/1' }] },
    }).success).toBe(false);
    expect(WorkspaceReadFileResultSchema.safeParse({
      data: { ...base, attachment_status: 'attached' },
      observation: 'invalid attachment',
    }).success).toBe(false);
  });

  it('admits the exact persisted event result without renderer or model-only fields', () => {
    expect(WorkspaceReadFileEventResultSchema.parse({
      data: {
        source_kind: 'conversation_file',
        locator: 'conversation:/renders/slide-001.png',
        file_name: 'slide-001.png',
        content_type: 'image/png',
        byte_length: 1024,
        width: 1600,
        height: 900,
      },
      observation: '已读取图片。',
    }).data.source_kind).toBe('conversation_file');
  });
});
