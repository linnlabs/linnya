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

  it('authored title 已含同一后缀时拆分展示并保留大小写', () => {
    expect(projectPhysicalResourceLinkPresentation({
      authoredTitle: '外部报告.PDF',
      parsed: parseFileLocator('file:///Users/name/report.pdf'),
    })).toEqual({ title: '外部报告', suffix: '.PDF' });
  });

  it('没有 authored title 时使用 basename', () => {
    expect(projectPhysicalResourceLinkPresentation({
      authoredTitle: ' ',
      parsed: parseFileLocator('conversation:/renders/第 1 页.png'),
    })).toEqual({ title: '第 1 页', suffix: '.png' });
  });

  it('标题只有后缀时不补回标题造成重复', () => {
    expect(projectPhysicalResourceLinkPresentation({
      authoredTitle: '.md',
      parsed: parseFileLocator('conversation:/report.md'),
    })).toEqual({ title: '', suffix: '.md' });
  });

  it('无扩展名的文件不把标题中的点误判为后缀', () => {
    expect(projectPhysicalResourceLinkPresentation({
      authoredTitle: '发布 v1.2',
      parsed: parseFileLocator('conversation:/README'),
    })).toEqual({ title: '发布 v1.2', suffix: null });
  });
});
