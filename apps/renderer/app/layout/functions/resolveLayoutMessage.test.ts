import { describe, expect, it } from 'vitest';
import { resolveLayoutMessage } from './resolveLayoutMessage';

describe('resolveLayoutMessage', () => {
  it('uses the layout fallback for pane resize labels', () => {
    expect(resolveLayoutMessage(
      'layout.pane.resizeSidebar',
      (_key, fallback) => fallback,
    )).toBe('调整左侧栏宽度');

    expect(resolveLayoutMessage(
      'layout.pane.resizeDocument',
      (_key, fallback) => fallback,
    )).toBe('调整文档宽度');

    expect(resolveLayoutMessage(
      'layout.pane.resizeConversation',
      (_key, fallback) => fallback,
    )).toBe('调整对话宽度');
  });

  it('keeps save shortcut unexpected errors as operation-level messages', () => {
    const result = resolveLayoutMessage(
      'layout.shortcuts.save.unexpectedError',
      (_key, fallback, params) => fallback.replace('{errorMessage}', String(params?.errorMessage)),
      { errorMessage: 'Boom' },
    );

    expect(result).toBe('保存时发生意外错误');
  });

  it('resolves project planning conversation title fallback', () => {
    const result = resolveLayoutMessage(
      'layout.sidebar.project.planningConversationTitle',
      (_key, fallback, params) => fallback.replace('{projectName}', String(params?.projectName)),
      { projectName: 'Demo' },
    );

    expect(result).toBe('Demo - 项目规划');
  });

  it('resolves workspace document export fallbacks', () => {
    expect(resolveLayoutMessage(
      'layout.workspaceDocumentExport.noActiveProject',
      (_key, fallback) => fallback,
    )).toBe('没有活动项目，无法创建文档');

    expect(resolveLayoutMessage(
      'layout.workspaceDocumentExport.autoSaveFailed',
      (_key, fallback) => fallback,
    )).toBe('内容已插入编辑器，但自动保存失败（请手动保存）');
  });
});
