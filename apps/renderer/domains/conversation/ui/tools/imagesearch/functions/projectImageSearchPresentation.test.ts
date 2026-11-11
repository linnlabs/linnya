import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { IMAGE_SEARCH_STRIP_MAX, projectImageSearchPresentation } from './projectImageSearchPresentation';

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

const candidate = (id: number, thumbnail = true) => ({
  id: `c${id}`,
  source: 'wikimedia_commons',
  provider: 'wikimedia_commons',
  title: `Houmuwu ding ${id}`,
  image_url: `https://upload.wikimedia.org/${id}.jpg`,
  download_url: `https://upload.wikimedia.org/${id}.jpg`,
  page_url: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
  ...(thumbnail ? { thumbnail_url: `https://upload.wikimedia.org/thumb/${id}.jpg/330px-${id}.jpg` } : {}),
  license: { code: 'by-sa', name: 'CC BY-SA 3.0', commercial_use: true, modifications: true, attribution_required: true },
  attribution: `"Houmuwu ding ${id}" is licensed under CC BY-SA 3.0.`,
});

const result = (candidates: readonly unknown[]) => ({
  data: {
    query: 'Houmuwu ding',
    commercial_only: false,
    candidates,
    sources: [{ source: 'wikimedia_commons', status: 'ok', result_count: candidates.length }],
  },
  observation: 'Image search',
});

describe('projectImageSearchPresentation', () => {
  it('进行中只给查询词、不给标题（组件自己画一行）；参数增量不完整时用省略号', () => {
    const loading = project({});
    expect(loading.data).toEqual({ query: 'Houmuwu ding', thumbnails: [] });
    expect(loading.title).toBeUndefined();
    expect(project({ args: {} }).data.query).toBe('...');
  });

  it('失败时给出单行错误用的标题', () => {
    expect(project({ status: 'error', phase: 'error' }).title).toMatchObject({
      text: { key: 'conversation.tool.imageSearch.failed', params: { query: 'Houmuwu ding' } },
    });
  });

  it('成功态给候选数和带缩略图的小图，最多一条；没有缩略图的候选只计数；查询不一致时拒绝', () => {
    const candidates = [candidate(1, false), ...Array.from({ length: 10 }, (_, index) => candidate(index + 2))];
    const projection = project({ status: 'success', phase: 'complete', result: result(candidates) });
    expect(projection.title).toBeUndefined();
    expect(projection.data.candidateCount).toBe(11);
    expect(projection.data.thumbnails).toHaveLength(IMAGE_SEARCH_STRIP_MAX);
    expect(projection.data.thumbnails[0]).toEqual({
      thumbnailUrl: 'https://upload.wikimedia.org/thumb/2.jpg/330px-2.jpg',
      previewUrl: 'https://upload.wikimedia.org/2.jpg',
      title: 'Houmuwu ding 2',
      provider: 'wikimedia_commons',
      licenseCode: 'by-sa',
      licenseName: 'CC BY-SA 3.0',
    });
    expect(() => project({ status: 'success', phase: 'complete', result: result(candidates), args: { query: 'other' } }))
      .toThrow();
  });
});
