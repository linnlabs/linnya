import { describe, expect, it } from 'vitest';

import {
  ConversationFileLocatorSchema,
  FileLocatorSchema,
  HostFileLocatorSchema,
  WorkspaceFileLocatorSchema,
  formatConversationFileLocator,
  formatHostFileLocator,
  formatWorkspaceFileLocator,
  parseFileLocator,
} from './file-locator';

describe('file locator contract', () => {
  it('parses canonical Workspace and conversation locators without encoding Unicode or spaces', () => {
    expect(parseFileLocator('workspace:/项目资料/报告 final.md')).toEqual({
      kind: 'workspace',
      locator: 'workspace:/项目资料/报告 final.md',
      path: '/项目资料/报告 final.md',
    });
    expect(parseFileLocator('conversation:/slides-renders/第 1 页.png')).toEqual({
      kind: 'conversation',
      locator: 'conversation:/slides-renders/第 1 页.png',
      relativePath: 'slides-renders/第 1 页.png',
    });
    expect(formatWorkspaceFileLocator('/')).toBe('workspace:/');
    expect(formatConversationFileLocator('out/a.png')).toBe('conversation:/out/a.png');
  });

  it('rejects naked, ambiguous and non-canonical custom-scheme paths', () => {
    for (const value of [
      '/docs/a.md',
      'docs/a.md',
      'workspace:docs/a.md',
      'workspace:/docs//a.md',
      'workspace:/docs/./a.md',
      'workspace:/docs/../a.md',
      'workspace:/docs/a.md?raw=1',
      'conversation:/out/a.png#page',
      'conversation:/',
      ' conversation:/out/a.png',
    ]) {
      expect(FileLocatorSchema.safeParse(value).success, value).toBe(false);
    }
    expect(WorkspaceFileLocatorSchema.safeParse('conversation:/a.png').success).toBe(false);
    expect(ConversationFileLocatorSchema.safeParse('workspace:/a.png').success).toBe(false);
  });

  it('formats POSIX, Windows drive and UNC host paths as canonical file URLs', () => {
    expect(formatHostFileLocator('/Users/name/项目 report.md'))
      .toBe('file:///Users/name/%E9%A1%B9%E7%9B%AE%20report.md');
    expect(formatHostFileLocator('C:\\Users\\name\\项目 report.md'))
      .toBe('file:///C:/Users/name/%E9%A1%B9%E7%9B%AE%20report.md');
    expect(formatHostFileLocator('C:\\')).toBe('file:///C:/');
    expect(formatHostFileLocator('\\\\Server\\Share\\项目 report.md'))
      .toBe('file://server/Share/%E9%A1%B9%E7%9B%AE%20report.md');
  });

  it('parses host file locators without pretending URL pathname is an OS path', () => {
    const locator = 'file:///Users/name/%E9%A1%B9%E7%9B%AE%20report.md';
    expect(parseFileLocator(locator)).toEqual({ kind: 'file', locator, url: locator });
    expect(HostFileLocatorSchema.safeParse('file:///Users/name/report.md?raw=1').success).toBe(false);
    expect(HostFileLocatorSchema.safeParse('file:///Users/name/../report.md').success).toBe(false);
    expect(HostFileLocatorSchema.safeParse('file:///Users/name/%2e%2e/report.md').success).toBe(false);
    expect(HostFileLocatorSchema.safeParse('file://LOCALHOST/Users/name/report.md').success).toBe(false);
  });
});
