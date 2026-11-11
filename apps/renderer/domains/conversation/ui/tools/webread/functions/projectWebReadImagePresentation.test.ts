import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectWebReadImagePresentation } from './projectWebReadImagePresentation';
import { resolveWebReadUiKey } from './resolveWebReadUiKey';

const IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Ding.jpg';
const HASH = 'b'.repeat(64);

function imageResult(options: { readonly source?: Record<string, unknown>; readonly media?: boolean } = {}) {
  return {
    data: {
      url: IMAGE_URL,
      title: 'Ding.jpg',
      charCount: 0,
      truncated: false,
      provider: 'local_http',
      renderMode: 'http',
      extractor: 'file_download',
      renderAttempted: false,
      escalated: false,
      image: { width: 1200, height: 900, ...(options.source ? { source: options.source } : {}) },
      file: {
        path: `web-downloads/${HASH}.jpg`, sha256: HASH, format: 'jpg', mimeType: 'image/jpeg', byteLength: 4000,
        acquiredAt: '2026-11-11T00:00:00.000Z', requestedUrl: IMAGE_URL, finalUrl: IMAGE_URL, trust: 'untrusted_external_file',
      },
      citations: {
        query: IMAGE_URL,
        searchMode: 'web',
        citations: [{ sourceType: 'web', ref: 'ABC234', index: 1, url: IMAGE_URL, docTitle: 'Ding.jpg', snippet: '' }],
      },
      evidence_store: { bundle_id: 'bundle-image' },
      cacheStatus: 'miss',
    },
    observation: 'Image saved.',
    ...(options.media === false
      ? {}
      : { media: { path: `/data/conversations/c1/web-downloads/${HASH}.jpg`, media_type: 'image/jpeg', width: 1200, height: 900 } }),
  };
}

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectWebReadImagePresentation({
    sourceToolName: 'web_read',
    uiKey: 'web_read_image',
    args: { url: IMAGE_URL },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

describe('resolveWebReadUiKey', () => {
  it('成功结果按是否带图片事实分流；结果到达前按地址是否图片扩展名', () => {
    expect(resolveWebReadUiKey({ url: IMAGE_URL }, imageResult())).toBe('web_read_image');
    expect(resolveWebReadUiKey({ url: IMAGE_URL })).toBe('web_read_image');
    expect(resolveWebReadUiKey({ url: 'https://example.com/a.PNG?x=1' }, { error: 'HTTP 502' })).toBe('web_read_image');
    expect(resolveWebReadUiKey({ url: 'https://example.com/article' })).toBe('web_read_page');
    expect(resolveWebReadUiKey({})).toBe('web_read_page');
    const pageData: Record<string, unknown> = { ...imageResult().data, charCount: 10, extractor: 'readability' };
    delete pageData.image;
    delete pageData.file;
    expect(resolveWebReadUiKey({ url: IMAGE_URL }, { data: pageData, observation: 'page' })).toBe('web_read_page');
  });
});

describe('projectWebReadImagePresentation', () => {
  it('进行中不给标题（组件画“正在下载图片”），失败给单行错误标题', () => {
    expect(project({})).toEqual({ data: { kind: 'lifecycle' } });
    expect(project({ status: 'error', phase: 'error' }).title).toMatchObject({
      text: { key: 'conversation.tool.webReadImage.failed' },
    });
  });

  it('图库来源：本机路径、尺寸、来源页与许可要点', () => {
    const result = imageResult({
      source: {
        found_via: 'image_search',
        page_url: 'https://commons.wikimedia.org/wiki/File:Ding.jpg',
        provider: 'wikimedia_commons',
        license: { code: 'by-sa', name: 'CC BY-SA 4.0', commercial_use: true, modifications: true, attribution_required: true },
      },
    });
    const projection = project({ status: 'success', phase: 'complete', result });
    expect(projection.title).toBeUndefined();
    expect(projection.data).toEqual({
      kind: 'image',
      media: { path: `/data/conversations/c1/web-downloads/${HASH}.jpg`, mediaType: 'image/jpeg', width: 1200, height: 900 },
      width: 1200,
      height: 900,
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Ding.jpg',
      sourceHost: 'commons.wikimedia.org',
      license: { code: 'by-sa', name: 'CC BY-SA 4.0', commercialUse: true, modifications: true, attributionRequired: true },
    });
    expect(project({ status: 'success', phase: 'complete', result: JSON.parse(JSON.stringify(result)) })).toEqual(projection);
  });

  it('网页上的图带署名与网页版权声明；旧回执没有本机路径；没有来源记录时来源就是图片地址', () => {
    const fromPage = project({
      status: 'success',
      phase: 'complete',
      result: imageResult({
        media: false,
        source: { found_via: 'web_page', page_url: 'https://www.catl.com/news/1.html', credit: 'Photo: CATL', page_rights: '© CATL' },
      }),
    });
    expect(fromPage.data).toMatchObject({ kind: 'image', sourceHost: 'catl.com', credit: 'Photo: CATL', pageRights: '© CATL' });
    expect(fromPage.data).not.toHaveProperty('media');
    expect(project({ status: 'success', phase: 'complete', result: imageResult() }).data)
      .toMatchObject({ sourceUrl: IMAGE_URL, sourceHost: 'upload.wikimedia.org' });
  });
});
