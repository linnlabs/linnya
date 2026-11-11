import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImageSearchResultSchema, WebReadResultSchema } from '@app/schemas';
import { LocalHttpProvider } from '../webread/providers/localHttp';
import { WebReadTool } from '../webread/WebReadTool';
import { ImageSearchTool } from '../imagesearch/ImageSearchTool';
import { ImageSourceRegistry } from '../shared/images/imageSourceRegistry';
import { saveConversationWebFile } from '../../../infra/adapters/web-files/conversationWebFileStore';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../domains/citation/testkit/citationRefAllocatorFixture';
import { decorateWebEvidenceWriterToolContext } from '../../../app-hosts/linnya/adapters/tools/webEvidenceWriterToolContextDecorator';
import { setWorkspaceRoot, resetWorkspaceRootToDefault } from '../../../shared/utils/pathManager';
import type { ToolContext } from '../../types';

describe('图片下载、检查与来源记录', () => {
  let root: string;
  let server: Server;
  let origin: string;
  let provider: LocalHttpProvider;
  let png: Buffer;
  let jpeg: Buffer;
  let sequence = 0;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'web-images-'));
    setWorkspaceRoot(root);
    png = await sharp({ create: { width: 640, height: 400, channels: 3, background: '#8a6d3b' } }).png().toBuffer();
    jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#335577' } }).jpeg().toBuffer();
    const page = `<!doctype html><html lang="en"><head><title>Bronze ding</title>
      <meta property="og:image" content="/share.jpg"></head><body>
      <nav><img src="/nav-photo.jpg" width="800" height="600"></nav>
      <article><h1>Bronze ding</h1><p>${'A ritual vessel from the late Shang dynasty. '.repeat(20)}</p>
        <figure><img data-src="/ding.jpg" src="/placeholder.gif" alt="Front view of the ding">
          <figcaption>Houmuwu ding, front view. <span class="photo-credit">Photo: National Museum</span></figcaption></figure>
        <img class="site-logo" src="/logo.png" width="400" height="400">
        <img src="/detail.png" width="640" height="400" alt="Inscription detail">
        <img src="/thumb.jpg" width="80" height="80">
      </article>
      <footer><p>Contact us</p><p>© 2026 National Museum. All rights reserved.</p></footer></body></html>`;
    const fixtures: Record<string, { mime: string; bytes: Buffer }> = {
      '/photo.png': { mime: 'image/png', bytes: png },
      '/ding.jpg': { mime: 'image/jpeg', bytes: jpeg },
      '/detail.png': { mime: 'image/png', bytes: png },
      '/mislabeled.jpg': { mime: 'image/jpeg', bytes: png },
      '/octet-image': { mime: 'application/octet-stream', bytes: jpeg },
      '/truncated.jpg': { mime: 'image/jpeg', bytes: jpeg.subarray(0, Math.floor(jpeg.length / 2)) },
      '/fake.png': { mime: 'image/png', bytes: Buffer.from('<html>not an image</html>') },
      '/page': { mime: 'text/html; charset=utf-8', bytes: Buffer.from(page) },
    };
    server = createServer((request, response) => {
      const fixture = fixtures[request.url ?? ''];
      if (!fixture) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': fixture.mime, 'Content-Length': fixture.bytes.length });
      response.end(fixture.bytes);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TCP fixture address');
    origin = `http://images.test:${address.port}`;
    provider = new LocalHttpProvider({
      resolveHost: async url => ({ hostname: url.hostname, addresses: [{ address: '127.0.0.1', family: 4 }] }),
    });
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    resetWorkspaceRootToDefault();
    await rm(root, { recursive: true, force: true });
  });

  async function setup() {
    const id = `image-conversation-${++sequence}`;
    const directory = path.join(root, id);
    await mkdir(directory);
    const context: ToolContext = { conversationId: id, turnId: 'turn', research: { instanceId: 'default' } };
    attachCitationSequence(context, { offset: 0 });
    attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
    decorateWebEvidenceWriterToolContext(context);
    const imageSources = new ImageSourceRegistry();
    const tool = new WebReadTool({
      provider,
      renderProvider: null,
      managedProvider: null,
      imageSources,
      fileStore: { save: input => saveConversationWebFile(directory, input) },
    });
    return {
      directory,
      context,
      imageSources,
      read: async (urlPath: string) =>
        WebReadResultSchema.parse(JSON.parse(await tool.run({ url: origin + urlPath }, context))),
    };
  }

  it('image_search 找到的图下载后解码检查、按实际格式保存，回执带许可与署名', async () => {
    const fixture = await setup();
    const search = new ImageSearchTool({
      imageSources: fixture.imageSources,
      searchCommons: async () => ({
        tookMs: 1,
        items: [{
          title: 'File:Photo.png',
          pageUrl: 'https://commons.wikimedia.org/wiki/File:Photo.png',
          imageUrl: `${origin}/photo.png`,
          thumbUrl: `${origin}/photo.png`,
          thumbWidth: 640,
          width: 640,
          height: 400,
          mime: 'image/png',
          metadata: {
            LicenseShortName: 'CC BY-SA 4.0',
            LicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
            Artist: '<a href="//commons.wikimedia.org/wiki/User:Someone">Someone</a>',
            ObjectName: 'Bronze ding photo',
          },
        }],
      }),
      searchOpenverse: async () => ({ tookMs: 1, items: [] }),
    });
    const found = ImageSearchResultSchema.parse(JSON.parse(await search.run({ query: 'ding' }, fixture.context)));
    expect(found.data.candidates[0]).toMatchObject({ id: 'c1', download_url: `${origin}/photo.png`, creator: 'Someone' });

    const result = await fixture.read('/photo.png');
    expect(result.data.file).toMatchObject({ format: 'png', byteLength: png.length });
    expect(result.data.image).toMatchObject({
      width: 640,
      height: 400,
      source: {
        found_via: 'image_search',
        page_url: 'https://commons.wikimedia.org/wiki/File:Photo.png',
        license: { code: 'by-sa', commercial_use: true, modifications: true, attribution_required: true },
      },
    });
    expect(result.data.image?.source?.attribution).toContain('CC BY-SA 4.0');
    expect(await readFile(path.join(fixture.directory, result.data.file!.path))).toEqual(png);
    expect(result.observation).toContain('Image: 640×400 PNG');
    expect(result.observation).toContain(`read_file(${JSON.stringify({ locator: `conversation:/${result.data.file!.path}` })})`);
    expect(result.observation).toContain('Source record (from image_search');
    expect(result.observation).toContain('BY-SA — commercial use allowed; share-alike; attribution required');
    expect(result.observation).not.toContain('Saved characters');
    expect(result.observation).not.toContain('Use shell to parse');
  });

  it('格式取实际字节；通用 MIME 按签名识别；没有来源记录时如实说明', async () => {
    const fixture = await setup();
    const mislabeled = await fixture.read('/mislabeled.jpg');
    expect(mislabeled.data.file?.format).toBe('png');
    expect(mislabeled.data.image).toEqual({ width: 640, height: 400 });
    expect(mislabeled.observation).toContain('Source not recorded');

    const octet = await fixture.read('/octet-image');
    expect(octet.data.file?.format).toBe('jpg');
    expect(octet.data.image).toMatchObject({ width: 1200, height: 800 });
  });

  it('截断或伪装的图片不保存', async () => {
    const fixture = await setup();
    await expect(fixture.read('/truncated.jpg')).rejects.toThrow(/无法完整解码/);
    await expect(fixture.read('/fake.png')).rejects.toThrow();
    const saved = await readdir(path.join(fixture.directory, 'web-downloads')).catch(() => []);
    expect(saved).toEqual([]);
  });

  it('网页列出正文主图、图注署名与版权声明；下载其中一张时回执带上这些原文', async () => {
    const fixture = await setup();
    const page = await fixture.read('/page');
    expect(page.data.images).toEqual([
      {
        url: `${origin}/ding.jpg`,
        kind: 'figure',
        alt: 'Front view of the ding',
        caption: 'Houmuwu ding, front view. Photo: National Museum',
        credit: 'Photo: National Museum',
      },
      { url: `${origin}/detail.png`, kind: 'content', alt: 'Inscription detail', width: 640, height: 400 },
      { url: `${origin}/share.jpg`, kind: 'og' },
    ]);
    expect(page.data.page_rights).toBe('© 2026 National Museum. All rights reserved.');
    expect(page.observation).toContain('Main images on this page');

    const image = await fixture.read('/ding.jpg');
    expect(image.data.image?.source).toMatchObject({
      found_via: 'web_page',
      page_url: `${origin}/page`,
      caption: 'Houmuwu ding, front view. Photo: National Museum',
      credit: 'Photo: National Museum',
      page_rights: '© 2026 National Museum. All rights reserved.',
    });
    expect(image.data.image?.source?.license).toBeUndefined();
    expect(image.observation).toContain('No structured license');
  });
});
