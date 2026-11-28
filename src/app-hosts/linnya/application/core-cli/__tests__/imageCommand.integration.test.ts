import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { BackendPluginCliResult } from '@linnya/plugin-host-contract/backend';
import { createNodePhysicalFileReader } from '../../../adapters/file-read';
import { createCoreCli } from '../orchestration/createCoreCli';
import { createVisionForegroundMask } from '../../../adapters/foreground-mask';

/**
 * `linnya image` 走真实的对话工作目录和读文件适配器：读图边界、assets/ 写入、权限声明都按生产路径执行。
 * 图片命令不碰数据库，给一个空的内存库即可。
 */
const db = new Database(':memory:');
const activity = {
  runs: { readCandidates: async () => { throw new Error('unused'); } },
  approvals: { readControlPending: () => { throw new Error('unused'); } },
};
const cli = createCoreCli(db, 4000, createNodePhysicalFileReader(), createVisionForegroundMask(), activity);

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
afterAll(() => db.close());

async function workDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'linnya-image-cli-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  // 泛黄纸上的一块墨
  const ink = await sharp({ create: { width: 60, height: 80, channels: 3, background: '#222222' } }).png().toBuffer();
  await sharp({ create: { width: 300, height: 200, channels: 3, background: '#ebe1c8' } })
    .composite([{ input: ink, left: 100, top: 50 }]).jpeg().toFile(path.join(root, 'src', '拓片.jpg'));
  return root;
}

async function run(root: string, argv: readonly string[]): Promise<BackendPluginCliResult & { access?: string }> {
  const preparation = cli.prepare({ argv: ['image', ...argv], invocationId: 'test', conversationRoot: root });
  if (preparation.status === 'completed') return preparation.result;
  const result = await preparation.plan.execute({ hostContext: null, signal: new AbortController().signal });
  return { ...result, access: preparation.plan.access.conversationFiles };
}

describe('linnya image', () => {
  it('处理结果写进 assets/，输出 conversation 路径；文件名取原图名，同一操作再跑一次不会覆盖', async () => {
    const root = await workDirectory();
    const first = await run(root, ['ink', 'src/拓片.jpg']);
    const second = await run(root, ['ink', 'conversation:/src/拓片.jpg', '--color', 'b0302a']);
    expect(first).toMatchObject({ exitCode: 0, stderr: '', access: 'write' });
    expect(first.stdout).toMatch(/^conversation:\/assets\/拓片-ink-[0-9a-f]{6}\.png \d+×\d+ png \d+KB\n$/u);
    const files = await readdir(path.join(root, 'assets'));
    expect(files).toHaveLength(2);
    const written = first.stdout.split(' ')[0]?.replace('conversation:/', '') ?? '';
    const meta = await sharp(await readFile(path.join(root, written))).metadata();
    expect([meta.format, meta.hasAlpha]).toEqual(['png', true]);
    expect(second.stdout).not.toBe(first.stdout);
  });

  it('slice 每块写一个文件，序号与检查图一致；首行写实测底色和块数', async () => {
    const root = await workDirectory();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="100%" height="100%" fill="#ff00ff"/>'
      + '<circle cx="100" cy="100" r="60" fill="#285ac8"/><rect x="240" y="40" width="120" height="120" fill="#2a9d3a"/></svg>';
    await sharp(Buffer.from(svg)).png().toFile(path.join(root, 'src', '宫格.png'));
    const result = await run(root, ['slice', 'src/宫格.png']);
    expect(result).toMatchObject({ exitCode: 0, stderr: '', access: 'write' });
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^底色 品红 #ff00ff（实测）· 2 块 · 残留键色 0\.00%$/u);
    expect(lines[1]).toMatch(/^1 conversation:\/assets\/宫格-slice1-[0-9a-f]{6}\.png 120×120 png /u);
    expect(lines[2]).toMatch(/^2 conversation:\/assets\/宫格-slice2-[0-9a-f]{6}\.png 120×120 png /u);
    expect(lines[3]).toMatch(/^检查图 conversation:\/assets\/宫格-slice-check-[0-9a-f]{6}\.jpg /u);
    expect(await readdir(path.join(root, 'assets'))).toHaveLength(3);
    const grid = await run(root, ['slice', 'src/宫格.png', '--grid', '3']);
    expect(grid.exitCode).toBe(2);
    expect(grid.stderr).toContain('--grid 须写成 列x行');
  });

  it('cutout 写出透明结果和检查图，首行写明方法和判别数；--method 写错时给用法', async () => {
    const root = await workDirectory();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#eeeeea"/>'
      + '<rect x="120" y="80" width="160" height="140" rx="20" fill="#3a4a40"/></svg>';
    await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toFile(path.join(root, 'src', '器物.jpg'));
    const result = await run(root, ['cutout', 'src/器物.jpg', '--method', 'edge']);
    expect(result).toMatchObject({ exitCode: 0, stderr: '', access: 'write' });
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^方法 边缘抠图 · 前景占 \d+% · 贴边 0%$/u);
    expect(lines[1]).toMatch(/^conversation:\/assets\/器物-cutout-[0-9a-f]{6}\.png \d+×\d+ png /u);
    expect(lines[2]).toMatch(/^检查图 conversation:\/assets\/器物-cutout-check-[0-9a-f]{6}\.jpg /u);
    expect(await readdir(path.join(root, 'assets'))).toHaveLength(2);
    const wrong = await run(root, ['cutout', 'src/器物.jpg', '--method', 'magic']);
    expect(wrong.exitCode).toBe(2);
    expect(wrong.stderr).toContain('--method 须为 auto、vision 或 edge');
  });

  it('title 读工作目录里的字体，写出 PNG 和 SVG，首行报字体许可；工作目录外的字体读不到', async () => {
    const root = await workDirectory();
    const katexFont = createRequire(import.meta.url).resolve('katex/dist/fonts/KaTeX_Main-Regular.ttf');
    await mkdir(path.join(root, 'assets', 'fonts'), { recursive: true });
    await copyFile(katexFont, path.join(root, 'assets', 'fonts', 'KaTeX_Main-Regular.ttf'));
    const result = await run(root, ['title', 'assets/fonts/KaTeX_Main-Regular.ttf', '--text', 'Bronze Age', '--color', 'b0302a']);
    expect(result).toMatchObject({ exitCode: 0, stderr: '', access: 'write' });
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^字体 KaTeX_Main-Regular · 许可 .*SIL Open Font License/u);
    expect(lines[1]).toMatch(/^conversation:\/assets\/Bronze-Age-title-[0-9a-f]{6}\.png \d+×\d+ png /u);
    expect(lines[2]).toMatch(/^conversation:\/assets\/Bronze-Age-title-[0-9a-f]{6}\.svg \d+×\d+ svg \d+KB \d+ 段路径$/u);
    const svgPath = path.join(root, lines[2]?.split(' ')[0]?.replace('conversation:/', '') ?? '');
    expect(await readFile(svgPath, 'utf8')).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox=/u);

    const missing = await run(root, ['title', 'assets/fonts/KaTeX_Main-Regular.ttf', '--text', '青铜']);
    expect(missing).toMatchObject({ exitCode: 1 });
    expect(missing.stderr).toMatch(/^missing_glyphs 字体里没有这些字：青、铜/u);
    expect((await run(root, ['title', katexFont, '--text', 'Age'])).stderr).toMatch(/^font_unreadable /u);
    expect((await run(root, ['title', 'assets/fonts/KaTeX_Main-Regular.ttf'])).exitCode).toBe(2);
  });

  it('trim 默认只读，给出可直接抄的裁剪比例，不写任何文件', async () => {
    const root = await workDirectory();
    const result = await run(root, ['trim', 'src/拓片.jpg']);
    expect(result).toMatchObject({ exitCode: 0, access: 'read' });
    const crop: Record<string, number> = JSON.parse(/crop (\{[^}]+\})/u.exec(result.stdout)?.[1] ?? '{}');
    expect(crop.left).toBeCloseTo(100 / 300, 2);
    expect(crop.top).toBeCloseTo(50 / 200, 2);
    expect(await readdir(root)).toEqual(['src']);
  });

  it('工作目录外的图片读不到：../、绝对路径和指向外面的符号链接都按读不出处理', async () => {
    const root = await workDirectory();
    const outside = await mkdtemp(path.join(tmpdir(), 'linnya-image-outside-'));
    roots.push(outside);
    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toFile(path.join(outside, 'secret.png'));
    await symlink(path.join(outside, 'secret.png'), path.join(root, 'src', 'link.png'));
    for (const reference of [path.join('..', path.basename(outside), 'secret.png'), path.join(outside, 'secret.png'), 'src/link.png', 'workspace:/a.png']) {
      const result = await run(root, ['grid', reference]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/^image_unreadable /u);
    }
    await writeFile(path.join(root, 'src', 'note.txt'), 'not an image');
    expect((await run(root, ['grid', 'src/note.txt'])).stderr).toMatch(/^image_unreadable /u);
  });

  it('assets 被换成指向外面的链接时拒绝写入，外面的目录里什么也没多', async () => {
    const root = await workDirectory();
    const outside = await mkdtemp(path.join(tmpdir(), 'linnya-image-outside-'));
    roots.push(outside);
    await symlink(outside, path.join(root, 'assets'));
    const result = await run(root, ['texture', 'paper', '--size', '64x64']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^output_unwritable /u);
    expect(await readdir(outside)).toEqual([]);
  });

  it('业务失败退出码 1 并给错误码；参数写错退出码 2，只给该子命令的用法', async () => {
    const root = await workDirectory();
    const photo = await run(root, ['texture', 'paper', '--size', '64x64', '--color', '202830']);
    const darkPath = photo.stdout.split(' ')[0] ?? '';
    const dark = await run(root, ['ink', darkPath]);
    expect(dark).toMatchObject({ exitCode: 1 });
    expect(dark.stderr).toMatch(/^background_not_light /u);

    const usage = await run(root, ['grid', 'src/拓片.jpg', '--region', '0,0,1,1']);
    expect(usage.exitCode).toBe(2);
    expect(usage.stderr).toContain('grid 不接受 --region');
    expect(usage.stderr.trimEnd().split('\n')).toHaveLength(2);
    expect((await run(root, ['perspective', 'src/拓片.jpg', '--to', '1,2,3'])).exitCode).toBe(2);
    expect((await run(root, ['rotate', 'src/拓片.jpg'])).exitCode).toBe(2);
  });

  it('linnya --help 列出 image 的用法', () => {
    const preparation = cli.prepare({ argv: ['--help'], invocationId: 'test', conversationRoot: '/tmp/none' });
    expect(preparation.status === 'completed' && preparation.result.stdout).toContain('linnya image grid <图片>');
  });
});
