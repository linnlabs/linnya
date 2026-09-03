import { describe, expect, it } from 'vitest';
import { parseFileLocator } from '@app/schemas';

import { projectPhysicalResourceLinkPresentation } from './projectConversationResourceLinkPresentation';

describe('projectPhysicalResourceLinkPresentation', () => {
  it('保留 authored title 并追加 locator 后缀', () => {
    expect(projectPhysicalResourceLinkPresentation({
      authoredTitle: '外部报告',
      parsed: parseFileLocator('file:///Users/name/report.pdf'),
    })).toEqual({ title: '外部报告', suffix: '.pdf' });
  });

  it('authored title 已含同一后缀时不重复', () => {
    expect(projectPhysicalResourceLinkPresentation({
      authoredTitle: '外部报告.PDF',
      parsed: parseFileLocator('file:///Users/name/report.pdf'),
    })).toEqual({ title: '外部报告.PDF', suffix: null });
  });

  it('没有 authored title 时使用 basename', () => {
    expect(projectPhysicalResourceLinkPresentation({
      authoredTitle: ' ',
      parsed: parseFileLocator('conversation:/renders/第 1 页.png'),
    })).toEqual({ title: '第 1 页.png', suffix: null });
  });
});
