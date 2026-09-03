import { describe, expect, it } from 'vitest';
import { resolveWorkspaceMessage } from './resolveWorkspaceMessage';

describe('resolveWorkspaceMessage', () => {
  it('uses the workspace fallback for markdown lifecycle labels', () => {
    expect(resolveWorkspaceMessage(
      'workspace.fileManager.markdown.untitledDocument',
      (_key, fallback) => fallback,
    )).toBe('未命名文档');
  });

  it('keeps markdown open failure as an operation-level message', () => {
    const result = resolveWorkspaceMessage(
      'workspace.fileManager.markdown.openFailed',
      (_key, fallback, params) => fallback.replace('{errorMessage}', String(params?.errorMessage)),
      { errorMessage: 'Boom' },
    );

    expect(result).toBe('打开文档失败');
  });

  it('resolves markdown serializer export labels', () => {
    expect(resolveWorkspaceMessage(
      'workspace.export.markdownSerializer.imageDescriptionWithSize',
      (_key, fallback, params) => fallback
        .replace('{alt}', String(params?.alt))
        .replace('{width}', String(params?.width))
        .replace('{height}', String(params?.height)),
      { alt: 'Demo', width: 320, height: 240 },
    )).toBe('[图片：Demo，宽度320px，高度240px]');
  });

  it('resolves project file loading failures without raw error details', () => {
    expect(resolveWorkspaceMessage(
      'workspace.sidebar.fileTree.loadFailed',
      (_key, fallback, params) => fallback.replace('{errorMessage}', String(params?.errorMessage ?? '')),
      { errorMessage: 'SQLITE_BUSY' },
    )).toBe('加载项目文件失败，请稍后重试。');
  });

  it('resolves the new file badge in the file tree', () => {
    expect(resolveWorkspaceMessage(
      'workspace.sidebar.fileTree.newBadge',
      (_key, fallback) => fallback,
    )).toBe('新建');
  });
});
