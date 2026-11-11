import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectImageSearchPresentation } from './projectImageSearchPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectImageSearchPresentation({
    sourceToolName: 'image_search',
    uiKey: 'image_search',
    args: { query: 'Houmuwu ding' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

const candidate = {
  id: 'c1',
  source: 'wikimedia_commons',
  provider: 'wikimedia_commons',
  title: 'Houmuwu ding',
  image_url: 'https://upload.wikimedia.org/a.jpg',
  download_url: 'https://upload.wikimedia.org/a.jpg',
  page_url: 'https://commons.wikimedia.org/wiki/File:A.jpg',
  license: { code: 'by-sa', name: 'CC BY-SA 3.0', commercial_use: true, modifications: true, attribution_required: true },
  attribution: '"Houmuwu ding" is licensed under CC BY-SA 3.0.',
};

describe('projectImageSearchPresentation', () => {
  it('进行中只显示查询词；参数增量不完整时用省略号', () => {
    expect(project({})).toMatchObject({
      data: { query: 'Houmuwu ding' },
      title: { text: { key: 'conversation.tool.imageSearch.title', params: { query: 'Houmuwu ding' } } },
    });
    expect(project({ args: {} }).data.query).toBe('...');
  });

  it('成功态按正式结果显示候选数，查询不一致时拒绝', () => {
    const result = {
      data: {
        query: 'Houmuwu ding',
        commercial_only: false,
        candidates: [candidate],
        sources: [{ source: 'wikimedia_commons', status: 'ok', result_count: 1 }],
      },
      observation: 'Image search',
    };
    expect(project({ status: 'success', phase: 'complete', result })).toMatchObject({
      data: { query: 'Houmuwu ding', candidateCount: 1 },
      title: { text: { key: 'conversation.tool.imageSearch.result', params: { query: 'Houmuwu ding', count: 1 } } },
    });
    expect(() => project({ status: 'success', phase: 'complete', result, args: { query: 'other' } })).toThrow();
  });
});
