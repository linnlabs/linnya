import { describe, expect, it } from 'vitest';

import { normalizeMarkdownFileLocatorHref } from './normalizeMarkdownFileLocatorHref';

describe('normalizeMarkdownFileLocatorHref', () => {
  it('规范化 parser 编码后的 Workspace 中文路径', () => {
    const result = normalizeMarkdownFileLocatorHref(
      'workspace:/%E6%B3%B0%E8%B1%AA%E7%A7%91%E6%8A%80/%E8%AF%95%E7%A8%BF.slides',
    );
    expect(result).toEqual({
      ok: true,
      parsed: {
        kind: 'workspace',
        locator: 'workspace:/泰豪科技/试稿.slides',
        path: '/泰豪科技/试稿.slides',
      },
    });
  });

  it('规范化 Conversation 空格路径', () => {
    const result = normalizeMarkdownFileLocatorHref(
      'conversation:/slides-renders/%E7%AC%AC%201%20%E9%A1%B5.png',
    );
    expect(result).toMatchObject({
      ok: true,
      parsed: {
        kind: 'conversation',
        locator: 'conversation:/slides-renders/第 1 页.png',
        relativePath: 'slides-renders/第 1 页.png',
      },
    });
  });

  it('把含空格的尖括号 file destination 规范化为 canonical URL', () => {
    const result = normalizeMarkdownFileLocatorHref(
      '<file:///Users/name/Documents/外部 报告.pdf>',
    );
    expect(result).toMatchObject({
      ok: true,
      parsed: {
        kind: 'file',
        locator: 'file:///Users/name/Documents/%E5%A4%96%E9%83%A8%20%E6%8A%A5%E5%91%8A.pdf',
      },
    });
  });

  it('拒绝编码后会变成路径分隔符的 segment', () => {
    expect(normalizeMarkdownFileLocatorHref('workspace:/folder%2Fsecret.slides')).toMatchObject({
      ok: false,
    });
  });

  it('拒绝非正式 locator', () => {
    expect(normalizeMarkdownFileLocatorHref('linnya://slides/document-id')).toMatchObject({
      ok: false,
    });
  });
});
