import { describe, expect, it } from 'vitest';
import { ImageSearchResultSchema } from '@app/schemas';
import { WebHttpError } from '../../../infra/adapters/web-http/webHttpFetch';
import type { CommonsImageItem } from '../../../infra/adapters/image-search/commonsImageSearchAdapter';
import type { OpenverseImageItem } from '../../../infra/adapters/image-search/openverseImageSearchAdapter';
import { ImageSourceRegistry } from '../shared/images/imageSourceRegistry';
import { normalizeImageLicense } from './functions/normalizeImageLicense';
import { runImageSearch } from './orchestration/runImageSearch';

describe('normalizeImageLicense', () => {
  it.each([
    [{ name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' }, 'by-sa', true, true, true],
    [{ name: 'CC BY 4.0' }, 'by', true, true, true],
    [{ name: 'CC0' }, 'cc0', true, true, false],
    [{ name: 'Public domain' }, 'pdm', true, true, false],
    [{ code: 'by-nc-nd', version: '2.0' }, 'by-nc-nd', false, false, true],
    [{ code: 'by-nd' }, 'by-nd', true, false, true],
    [{ url: 'https://creativecommons.org/publicdomain/zero/1.0/' }, 'cc0', true, true, false],
    [{ name: 'GFDL' }, 'other', false, false, true],
  ] as const)('%o → %s', (input, code, commercial, modifications, attribution) => {
    expect(normalizeImageLicense(input)).toMatchObject({
      code, commercial_use: commercial, modifications, attribution_required: attribution,
    });
  });

  it('Openverse 只给代码时按代码与版本生成名称', () => {
    expect(normalizeImageLicense({ code: 'by', version: '2.0' }).name).toBe('CC BY 2.0');
  });
});

const commons = (title: string, extra: Partial<CommonsImageItem> = {}): CommonsImageItem => ({
  title: `File:${title}.jpg`,
  pageUrl: `https://commons.wikimedia.org/wiki/File:${title}.jpg`,
  imageUrl: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${title}.jpg`,
  thumbUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${title}.jpg/1920px-${title}.jpg?utm_source=commons.wikimedia.org`,
  thumbWidth: 1920,
  width: 4000,
  height: 3000,
  mime: 'image/jpeg',
  metadata: { LicenseShortName: 'CC BY 4.0' },
  ...extra,
});

const openverse = (id: string, license: string, extra: Partial<OpenverseImageItem> = {}): OpenverseImageItem => ({
  id,
  title: `Flickr ${id}`,
  imageUrl: `https://live.staticflickr.com/1/${id}_b.jpg`,
  pageUrl: `https://www.flickr.com/photos/someone/${id}`,
  width: 1024,
  height: 768,
  license,
  licenseVersion: '2.0',
  creator: 'someone',
  source: 'flickr',
  attribution: `"Flickr ${id}" by someone is licensed under CC ${license.toUpperCase()} 2.0.`,
  ...extra,
});

describe('runImageSearch', () => {
  it('两个来源交替排入候选，去掉跟踪参数，跳过不能下载的格式，并记下来源', async () => {
    const registry = new ImageSourceRegistry();
    let excluded: readonly string[] | undefined;
    const output = await runImageSearch({ query: 'ding', max_results: 4 }, {}, {
      imageSources: registry,
      searchCommons: async () => ({
        tookMs: 1,
        items: [
          commons('A'),
          commons('Animated', { mime: 'image/gif', thumbUrl: 'https://upload.wikimedia.org/x/Animated.gif', imageUrl: 'https://upload.wikimedia.org/x/Animated.gif' }),
          commons('B'),
        ],
      }),
      searchOpenverse: async args => {
        excluded = args.excludeSources;
        return { tookMs: 1, items: [openverse('1', 'by'), openverse('2', 'cc0'), openverse('3', 'by-nc')] };
      },
    });
    const result = ImageSearchResultSchema.parse(JSON.parse(output));
    expect(excluded).toEqual(['wikimedia']);
    expect(result.data.candidates.map(candidate => [candidate.id, candidate.source, candidate.title])).toEqual([
      ['c1', 'wikimedia_commons', 'A'],
      ['c2', 'openverse', 'Flickr 1'],
      ['c3', 'wikimedia_commons', 'B'],
      ['c4', 'openverse', 'Flickr 2'],
    ]);
    expect(result.data.candidates[0]!.download_url).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/1920px-A.jpg');
    expect(result.data.candidates[0]!.download_width).toBe(1920);
    expect(result.data.candidates[0]!.attribution).toContain('via Wikimedia Commons is licensed under CC BY 4.0');
    expect(result.data.sources).toEqual([
      { source: 'wikimedia_commons', status: 'ok', result_count: 2 },
      { source: 'openverse', status: 'ok', result_count: 2 },
    ]);
    expect(registry.lookup('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/1920px-A.jpg?utm_source=x'))
      .toMatchObject({ foundVia: 'image_search', license: { code: 'by' } });
    expect(result.observation).toContain('[c1] 1920×1440 download (original 4000×3000); CC BY 4.0 — commercial use allowed; attribution required');
    expect(result.observation).toContain('BEGIN_UNTRUSTED_WEB_CONTENT');
  });

  it('commercial_only 去掉非商用许可；一个来源失败时照常返回另一个并标出失败', async () => {
    const output = await runImageSearch({ query: 'ding', commercial_only: true }, {}, {
      imageSources: new ImageSourceRegistry(),
      searchCommons: async () => {
        throw new WebHttpError('rate_limited', 'Wikimedia Commons 请求失败: HTTP 429。', { status: 429 });
      },
      searchOpenverse: async args => {
        expect(args.commercialOnly).toBe(true);
        return { tookMs: 1, items: [openverse('1', 'by-nc'), openverse('2', 'by-sa')] };
      },
    });
    const result = ImageSearchResultSchema.parse(JSON.parse(output));
    expect(result.data.candidates.map(candidate => candidate.license.code)).toEqual(['by-sa']);
    expect(result.data.sources[0]).toEqual({ source: 'wikimedia_commons', status: 'failed', result_count: 0, error_kind: 'rate_limited' });
    expect(result.observation).toContain('Wikimedia Commons failed (rate_limited)');
  });

  it('全部来源失败时报错；只查一个来源时不排除 Openverse 里的 Wikimedia', async () => {
    await expect(runImageSearch({ query: 'ding', source: 'wikimedia_commons' }, {}, {
      searchCommons: async () => {
        throw new WebHttpError('network_error', 'down');
      },
    })).rejects.toThrow(/IMAGE_SEARCH_FAILED/);

    let excluded: readonly string[] | undefined = ['unset'];
    const output = await runImageSearch({ query: 'ding', source: 'openverse' }, {}, {
      imageSources: new ImageSourceRegistry(),
      searchOpenverse: async args => {
        excluded = args.excludeSources;
        return { tookMs: 1, items: [] };
      },
    });
    expect(excluded).toBeUndefined();
    expect(JSON.parse(output).observation).toContain('No images found');
  });
});
