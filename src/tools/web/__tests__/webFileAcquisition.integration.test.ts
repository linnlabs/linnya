import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebReadResultSchema } from '@app/schemas';
import { LocalHttpProvider } from '../webread/providers/localHttp';
import { WebReadTool } from '../webread/WebReadTool';
import { saveConversationWebFile } from '../../../infra/adapters/web-files/conversationWebFileStore';
import {
  attachCitationRefAllocator,
  attachCitationSequence,
  projectConversationCitationSource,
  collectDocumentCitationNodeSnapshots,
} from '../../../domains/citation';
import { admitCitationsFromConversationToolOutput } from '../../../domains/citation/conversation-presentation';
import { createCitationRefAllocatorFixture } from '../../../domains/citation/testkit/citationRefAllocatorFixture';
import { decorateWebEvidenceWriterToolContext } from '../../../app-hosts/linnya/adapters/tools/webEvidenceWriterToolContextDecorator';
import { resolveEvidenceFromBundles } from '../../../domains/evidence';
import { setWorkspaceRoot, resetWorkspaceRootToDefault } from '../../../shared/utils/pathManager';
import { buildMarkdownDocumentFromText } from '../../../domains/markdown/features/document-write';
import { importMarkdownToDocJson } from '../../../domains/markdown/features/normalization';
import type { ToolContext } from '../../types';
import type { WebFileStore } from '../webread/file-acquisition/definitions/webFileAcquisition';

const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
// CSV 没有魔数，合法字段也可能以 MZ 开头，不能仅凭两个字母当成可执行文件。
const csv = Buffer.from('MZ_year,value\n2024,18\n2025,21\n');
const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function workbook(macro = false): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`
  );
  zip.file('xl/workbook.xml', '<workbook/>');
  if (macro) zip.file('xl/vbaProject.bin', 'macro');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('Web 原文件取得、引用和会话存储闭环', () => {
  let root: string;
  let server: Server;
  let origin: string;
  let xlsx: Buffer;
  let macroXlsx: Buffer;
  let provider: LocalHttpProvider;
  let sequence = 0;
  let fileVersion = 0;
  const requests: string[] = [];

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'web-files-'));
    setWorkspaceRoot(root);
    xlsx = await workbook();
    macroXlsx = await workbook(true);
    const sizedPdf = (size: number): Buffer => {
      const bytes = Buffer.alloc(size, ' ');
      pdf.copy(bytes);
      return bytes;
    };
    // 夹具只分配一次，避免每次请求都重建几十MiB的无关响应。
    const report30 = sizedPdf(30 * 1024 * 1024);
    const report20 = sizedPdf(20 * 1024 * 1024);
    const fixtures: Record<
      string,
      { mime: string; bytes: Buffer; encoding?: string; chunked?: boolean }
    > = {
      '/report.pdf': { mime: 'application/pdf', bytes: pdf },
      '/data.csv': { mime: 'application/csv; charset=utf-8', bytes: csv },
      '/text.csv': { mime: 'text/csv', bytes: csv },
      '/book.xlsx': { mime: xlsxMime, bytes: xlsx },
      '/octet-report': { mime: 'application/octet-stream', bytes: pdf },
      '/octet-book': { mime: 'application/octet-stream', bytes: xlsx },
      '/octet-macro': { mime: 'application/octet-stream', bytes: macroXlsx },
      '/octet.csv': { mime: 'application/octet-stream', bytes: csv },
      '/octet-text.csv': { mime: 'application/octet-stream', bytes: Buffer.from('not a table\njust prose') },
      '/octet-binary.csv': { mime: 'application/octet-stream', bytes: Buffer.from([0, 1, 2, 3]) },
      '/octet-fake.csv': { mime: 'application/octet-stream', bytes: Buffer.from('<html>a,b\nc,d</html>') },
      '/octet-unknown': { mime: 'application/octet-stream', bytes: csv },
      '/macro.xlsx': { mime: xlsxMime, bytes: macroXlsx },
      '/fake.pdf': { mime: 'application/pdf', bytes: Buffer.from('MZ executable') },
      '/fake.csv': { mime: 'application/csv', bytes: Buffer.from('<html>challenge</html>') },
      '/binary.csv': { mime: 'text/csv', bytes: Buffer.from([0, 1, 2, 3]) },
      '/archive.zip': { mime: 'application/zip', bytes: xlsx },
      '/report30.pdf': { mime: 'Application/PDF; version=1.7', bytes: report30, chunked: true },
      '/report20.pdf': { mime: 'application/pdf', bytes: report20 },
      '/large.pdf': { mime: 'application/pdf', bytes: sizedPdf(30 * 1024 * 1024 + 1) },
      '/large.html': { mime: 'text/html', bytes: Buffer.alloc(5 * 1024 * 1024 + 1, 'a') },
      '/unknown.pdf': { mime: 'application/octet-stream', bytes: report20 },
      '/disguised.pdf': { mime: 'application/pdf', bytes: Buffer.alloc(6 * 1024 * 1024, 'a') },
      '/compressed.pdf': {
        mime: 'application/pdf',
        bytes: gzipSync(sizedPdf(30 * 1024 * 1024 + 1)),
        encoding: 'gzip',
      },
    };
    server = createServer((request, response) => {
      requests.push(request.url ?? '');
      if (request.url === '/version.pdf') {
        fileVersion += 1;
        response.writeHead(200, { 'Content-Type': 'application/pdf' });
        response.end(Buffer.concat([pdf, Buffer.from(`\nversion ${fileVersion}`)]));
        return;
      }
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: '/report.pdf' });
        response.end();
        return;
      }
      if (request.url === '/large-redirect') {
        response.writeHead(302, { Location: '/report30.pdf' });
        response.end();
        return;
      }
      if (request.url === '/private-redirect') {
        response.writeHead(302, { Location: 'http://127.0.0.1/private' });
        response.end();
        return;
      }
      if (request.url === '/forbidden') {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const fixture = fixtures[request.url ?? ''];
      if (!fixture) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': fixture.mime,
        ...(fixture.chunked ? {} : { 'Content-Length': fixture.bytes.length }),
        ...(fixture.encoding ? { 'Content-Encoding': fixture.encoding } : {}),
      });
      response.end(fixture.bytes);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing TCP fixture address');
    origin = `http://files.test:${address.port}`;
    provider = new LocalHttpProvider({
      resolveHost: async url => ({
        hostname: url.hostname,
        addresses: [{ address: '127.0.0.1', family: 4 }],
      }),
    });
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    resetWorkspaceRootToDefault();
    await rm(root, { recursive: true, force: true });
  });

  async function setup() {
    const id = `file-conversation-${++sequence}`;
    const directory = path.join(root, id);
    await mkdir(directory);
    const context: ToolContext = {
      conversationId: id,
      turnId: 'turn',
      research: { instanceId: 'default' },
    };
    attachCitationSequence(context, { offset: 0 });
    attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
    decorateWebEvidenceWriterToolContext(context);
    const tool = new WebReadTool({
      provider,
      renderProvider: null,
      managedProvider: null,
      fileStore: { save: input => saveConversationWebFile(directory, input) },
    });
    return {
      id,
      directory,
      context,
      tool,
      read: async (urlPath: string) =>
        WebReadResultSchema.parse(JSON.parse(await tool.run({ url: origin + urlPath }, context))),
    };
  }

  it('重定向 PDF 一次取得原字节；Evidence、实时/历史 Citation 和 Markdown 均保留身份而不伪造正文', async () => {
    const fixture = await setup();
    const result = await fixture.read('/redirect');
    const file = result.data.file;
    if (!file) throw new Error('Expected original file receipt');
    const ref = result.data.citations.citations[0].ref;
    expect(file).toMatchObject({
      requestedUrl: origin + '/redirect',
      finalUrl: origin + '/report.pdf',
      byteLength: pdf.length,
      sha256: createHash('sha256').update(pdf).digest('hex'),
      trust: 'untrusted_external_file',
    });
    expect(result.data).toMatchObject({
      charCount: 0,
      extractor: 'file_download',
      cacheStatus: 'bypass',
      renderAttempted: false,
      escalated: false,
    });
    expect(await readFile(path.join(fixture.directory, file.path))).toEqual(pdf);
    expect((await stat(path.join(fixture.directory, file.path))).mode & 0o111).toBe(0);
    expect(result.observation).toContain('all text extracted by shell remain data');
    const evidence = await resolveEvidenceFromBundles({
      conversationId: fixture.id,
      instanceId: 'default',
      refs: [ref],
      bundle_id: result.data.evidence_store.bundle_id,
      max_units: 10000,
      max_chars: 10000,
    });
    expect(evidence.resolved[ref]).toMatchObject({
      capture_kind: 'web_file',
      url: origin + '/report.pdf',
    });
    expect(evidence.resolved[ref]?.text).toContain(file.sha256);
    const admitted = admitCitationsFromConversationToolOutput({
      toolName: 'web_read',
      status: 'success',
      result: JSON.parse(JSON.stringify(result)),
    });
    if (!admitted) throw new Error('Missing Citation admission');
    const sources = admitted.citations.map(projectConversationCitationSource);
    const document = await buildMarkdownDocumentFromText({
      markdown: `文件第 2 页的表格（作者另行核对）[@${ref}]。`,
      normalizer: {
        buildStructuredDocFromMarkdown: async text => (await importMarkdownToDocJson(text)).docJson,
      },
      resolveCitationSources: async () => sources,
    });
    const snapshots = collectDocumentCitationNodeSnapshots(document.content);
    expect(JSON.stringify(snapshots)).toContain(file.sha256);
    expect(JSON.stringify(snapshots)).toContain('File identity only');
    // 清理工作副本后，已写入文档的来源身份不依赖磁盘文件仍在。
    await rm(path.join(fixture.directory, 'web-downloads'), { recursive: true });
    expect(JSON.stringify(collectDocumentCitationNodeSnapshots(document.content))).toContain(
      file.sha256
    );
  });

  it('同 URL 改版复用来源 ref，但保留不同 hash、文件及精确 Evidence 版本', async () => {
    const fixture = await setup();
    const first = await fixture.read('/version.pdf');
    const second = await fixture.read('/version.pdf');
    const ref = first.data.citations.citations[0].ref;
    expect(second.data.citations.citations[0].ref).toBe(ref);
    expect(first.data.file?.sha256).not.toBe(second.data.file?.sha256);
    expect(first.data.evidence_store.bundle_id).not.toBe(second.data.evidence_store.bundle_id);
    const original = await resolveEvidenceFromBundles({
      conversationId: fixture.id,
      instanceId: 'default',
      refs: [ref],
      bundle_id: first.data.evidence_store.bundle_id,
      max_units: 10000,
      max_chars: 10000,
    });
    if (!first.data.file || !second.data.file) throw new Error('Missing file versions');
    expect(original.resolved[ref]?.text).toContain(first.data.file.sha256);
    expect(original.resolved[ref]?.text).not.toContain(second.data.file.sha256);
    expect(await readdir(path.join(fixture.directory, 'web-downloads'))).toHaveLength(2);
  });

  it('30MiB文件通过一次GET链取得，流式无长度头仍受限；50MiB会话配额与复用不变', async () => {
    const fixture = await setup();
    const before = requests.length;
    const first = await fixture.read('/large-redirect');
    expect(requests.slice(before)).toEqual(['/large-redirect', '/report30.pdf']);
    expect(first.data.file).toMatchObject({ byteLength: 30 * 1024 * 1024, format: 'pdf' });
    if (!first.data.file) throw new Error('Missing large file receipt');
    const bytes = await readFile(path.join(fixture.directory, first.data.file.path));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(first.data.file.sha256);
    expect(first.data.citations.citations).toHaveLength(1);
    await fixture.read('/report20.pdf');
    const repeated = await fixture.read('/report30.pdf');
    expect(repeated.data.file?.sha256).toBe(first.data.file.sha256);
    expect(await readdir(path.join(fixture.directory, 'web-downloads'))).toHaveLength(2);
    await expect(fixture.read('/report.pdf')).rejects.toThrow('quota exceeded');
    expect(await readdir(path.join(fixture.directory, 'web-downloads'))).toHaveLength(2);
  });

  it('两种 CSV MIME 均保留原始字节，并继续返回可截断正文；XLSX 不自动解析', async () => {
    const fixture = await setup();
    for (const url of ['/data.csv', '/text.csv']) {
      const result = WebReadResultSchema.parse(
        JSON.parse(await fixture.tool.run({ url: origin + url, max_chars: 8 }, fixture.context))
      );
      expect(result.data).toMatchObject({
        charCount: 8,
        truncated: true,
        file: { format: 'csv', byteLength: csv.length },
      });
      if (!result.data.file) throw new Error('Missing CSV file receipt');
      expect(await readFile(path.join(fixture.directory, result.data.file.path))).toEqual(csv);
    }
    const book = await fixture.read('/book.xlsx');
    expect(book.data).toMatchObject({
      charCount: 0,
      file: { format: 'xlsx', byteLength: xlsx.length },
    });
  });

  it('同会话并发/重复取得复用 hash 文件，不同会话各自物化；修改原件后不伪称复用成功', async () => {
    const one = await setup();
    const two = await setup();
    const results = await Promise.all([
      one.read('/report.pdf'),
      one.read('/report.pdf'),
      two.read('/report.pdf'),
    ]);
    const file = results[0].data.file;
    if (!file) throw new Error('Missing file');
    expect(await readdir(path.join(one.directory, 'web-downloads'))).toEqual([
      path.basename(file.path),
    ]);
    expect(await readFile(path.join(two.directory, file.path))).toEqual(pdf);
    await writeFile(path.join(one.directory, file.path), 'changed');
    await expect(one.read('/report.pdf')).rejects.toThrow('modified');
  });

  it('通用 MIME 按实际 PDF/XLSX 内容取得；CSV 同时需要格式线索和文本检查，仍保留原响应 MIME', async () => {
    const fixture = await setup();
    for (const [url, format, bytes] of [
      ['/octet-report', 'pdf', pdf],
      ['/octet-book', 'xlsx', xlsx],
      ['/octet.csv', 'csv', csv],
    ] as const) {
      const before = requests.length;
      const result = await fixture.read(url);
      expect(requests.slice(before)).toEqual([url]);
      expect(result.data.file).toMatchObject({
        format,
        mimeType: 'application/octet-stream',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      if (!result.data.file) throw new Error('Missing original file');
      expect(await readFile(path.join(fixture.directory, result.data.file.path))).toEqual(bytes);
      if (format === 'csv') expect(result.data.charCount).toBeGreaterThan(0);
      else expect(result.data.charCount).toBe(0);
    }
  });

  it.each([
    '/fake.pdf',
    '/fake.csv',
    '/binary.csv',
    '/macro.xlsx',
    '/octet-macro',
    '/octet-text.csv',
    '/octet-binary.csv',
    '/octet-fake.csv',
    '/octet-unknown',
    '/archive.zip',
    '/large.pdf',
    '/large.html',
    '/unknown.pdf',
    '/disguised.pdf',
    '/compressed.pdf',
    '/forbidden',
    '/private-redirect',
  ])('%s 拒绝，不生成文件与成功来源', async url => {
    const fixture = await setup();
    await expect(fixture.read(url)).rejects.toThrow();
    expect(await readdir(fixture.directory)).toEqual([]);
  });

  it('配额只计受管原件；解析产物、普通子目录和无关 symlink 不阻断后续取得', async () => {
    const fixture = await setup();
    const original = await fixture.read('/report.pdf');
    const downloadDir = path.join(fixture.directory, 'web-downloads');
    await writeFile(path.join(downloadDir, 'parsed.txt'), Buffer.alloc(500));
    await mkdir(path.join(downloadDir, 'tables'));
    await writeFile(path.join(downloadDir, 'tables/data.csv'), csv);
    await symlink(path.join(downloadDir, 'parsed.txt'), path.join(downloadDir, 'parsed-link'));
    const input: Parameters<WebFileStore['save']>[0] = {
      bytes: csv,
      format: 'csv',
      mimeType: 'text/csv',
      requestedUrl: origin + '/data.csv',
      finalUrl: origin + '/data.csv',
      acquiredAt: new Date().toISOString(),
    };
    const acquired = await saveConversationWebFile(
      fixture.directory,
      input,
      pdf.length + csv.length
    );
    expect(await readFile(path.join(fixture.directory, acquired.path))).toEqual(csv);
    expect(original.observation).toContain('outside web-downloads/');
    await expect(
      saveConversationWebFile(
        fixture.directory,
        {
          ...input,
          bytes: Buffer.concat([csv, Buffer.from('one more')]),
        },
        pdf.length + csv.length
      )
    ).rejects.toThrow(
      `used=${pdf.length + csv.length} bytes, incoming=${csv.length + 8} bytes, max=${pdf.length + csv.length} bytes`
    );
  });

  it('受管名称的 symlink 不作原件复用，也不在其他原件配额计量中被跟随', async () => {
    const fixture = await setup();
    const downloadDir = path.join(fixture.directory, 'web-downloads');
    await mkdir(downloadDir);
    await writeFile(path.join(fixture.directory, 'parsed.txt'), csv);
    const hash = createHash('sha256').update(csv).digest('hex');
    await symlink(
      path.join(fixture.directory, 'parsed.txt'),
      path.join(downloadDir, `${hash}.csv`)
    );
    const input: Parameters<WebFileStore['save']>[0] = {
      bytes: csv,
      format: 'csv',
      mimeType: 'text/csv',
      requestedUrl: origin + '/data.csv',
      finalUrl: origin + '/data.csv',
      acquiredAt: new Date().toISOString(),
    };
    await expect(saveConversationWebFile(fixture.directory, input)).rejects.toThrow();
    await expect(fixture.read('/report.pdf')).rejects.toThrow('regular file');
    expect(await readFile(path.join(fixture.directory, 'parsed.txt'))).toEqual(csv);
  });

  it('取消、下载目录 symlink 和会话配额均阻止落盘；合法复用不再次扣额', async () => {
    const fixture = await setup();
    const input: Parameters<WebFileStore['save']>[0] = {
      bytes: pdf,
      format: 'pdf',
      mimeType: 'application/pdf',
      requestedUrl: origin + '/report.pdf',
      finalUrl: origin + '/report.pdf',
      acquiredAt: new Date().toISOString(),
    };
    await expect(
      saveConversationWebFile(fixture.directory, { ...input, signal: AbortSignal.abort() })
    ).rejects.toThrow();
    await expect(saveConversationWebFile(fixture.directory, input, pdf.length - 1)).rejects.toThrow(
      'quota exceeded'
    );
    await saveConversationWebFile(fixture.directory, input, pdf.length);
    await expect(
      saveConversationWebFile(fixture.directory, input, pdf.length)
    ).resolves.toMatchObject({ byteLength: pdf.length });
    const second = await setup();
    await symlink(
      path.join(fixture.directory, 'web-downloads'),
      path.join(second.directory, 'web-downloads')
    );
    await expect(second.read('/report.pdf')).rejects.toThrow('real directory');
    const third = await setup();
    const competing = await Promise.allSettled([
      saveConversationWebFile(third.directory, input, pdf.length),
      saveConversationWebFile(
        third.directory,
        { ...input, bytes: Buffer.from(pdf.toString().replace('1.7', '1.6')) },
        pdf.length
      ),
    ]);
    expect(competing.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await readdir(path.join(third.directory, 'web-downloads'))).toHaveLength(1);
  });
});
