import { describe, expect, it } from 'vitest';
import { readBlockVersionHandleSummary } from './readBlockVersionHandleSummary';

describe('readBlockVersionHandleSummary', () => {
  it('为空版本列表返回无历史摘要', () => {
    expect(readBlockVersionHandleSummary([])).toEqual({
      hasHistory: false,
      versionCount: 0,
      latestVersionNumber: 0,
    });
  });

  it('读取版本数量和最新版本号', () => {
    expect(readBlockVersionHandleSummary([
      { version_number: 7 },
      { version_number: 3 },
    ])).toEqual({
      hasHistory: true,
      versionCount: 2,
      latestVersionNumber: 7,
    });
  });
});
