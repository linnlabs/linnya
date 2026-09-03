import { describe, expect, it } from 'vitest';
import { resolveReadFileUiKey } from './resolveReadFileUiKey';

function imageResult(sourceKind: 'conversation_file' | 'host_file') {
  return {
    data: {
      source_kind: sourceKind,
      locator: sourceKind === 'conversation_file'
        ? 'conversation:/slides/slide-007.png'
        : 'file:///tmp/slide-007.png',
      file_name: 'slide-007.png',
      content_type: 'image/png',
      byte_length: 1024,
      width: 1600,
      height: 900,
    },
    observation: '图片已读取。',
  };
}

describe('resolveReadFileUiKey', () => {
  it('loading 与错误结果不按扩展名猜测图片', () => {
    expect(resolveReadFileUiKey({ locator: 'conversation:/slides/slide-007.png' }))
      .toBe('workspace_read_file');
    expect(resolveReadFileUiKey(
      { locator: 'conversation:/slides/slide-007.png' },
      { error: 'not found' },
    )).toBe('workspace_read_file');
  });

  it.each(['conversation_file', 'host_file'] as const)(
    '正式 %s 图片结果路由到 image_read',
    (sourceKind) => {
      expect(resolveReadFileUiKey({}, imageResult(sourceKind))).toBe('image_read');
    },
  );

  it('文本与 DocumentView 结果继续进入 Workspace read config', () => {
    expect(resolveReadFileUiKey({}, {
      data: {
        source_kind: 'conversation_file',
        locator: 'conversation:/notes.txt',
        file_name: 'notes.txt',
        content_type: 'text/plain',
        byte_length: 10,
        offset: 0,
        limit: 20_000,
        truncated: false,
        has_more: false,
      },
      observation: 'notes',
    })).toBe('workspace_read_file');
  });

  it('旧 path 图片结果仍能在 reload 时进入 image_read', () => {
    expect(resolveReadFileUiKey({}, {
      data: {
        source: 'conversation_file',
        path: 'slides/slide-007.png',
        relative_path: 'slides/slide-007.png',
        file_name: 'slide-007.png',
        content_type: 'image/png',
      },
      observation: '历史图片已回放。',
    })).toBe('image_read');
  });

  it('看似图片但不符合正式 schema 的对象不得路由到图片卡', () => {
    expect(resolveReadFileUiKey({}, {
      data: {
        source_kind: 'conversation_file',
        locator: 'conversation:/slides/slide-007.png',
        file_name: 'slide-007.png',
        content_type: 'image/png',
      },
      observation: '缺少宽高与字节事实',
    })).toBe('workspace_read_file');
  });
});
