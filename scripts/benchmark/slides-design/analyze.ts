/**
 * Slides 设计基准分析：读取 `pnpm benchmark:agent slides-design-batch` 的输出目录，
 * 对每次试跑的成稿做 inspect、渲染、结构与素材统计，生成样张、metrics.json 和 summary.md。
 *
 * 用法：
 *   pnpm benchmark:slides-design:analyze --batch DIR [--database FILE] [--skip-render]
 *
 * 只读打开工作区数据库（sqlite3 -readonly）；不修改任何文稿。视觉评分仍由人对照样张完成。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp, { type OverlayOptions } from 'sharp';
import {
  READING_MODE_FONT_FLOOR_REFERENCE_WIDTH_IN,
  READING_MODE_FONT_FLOORS_PT,
} from '../../../packages/plugins/slides/src/backend/engine/quality/aesthetic/thresholds';

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '../../..');

type ReadingMode = keyof typeof READING_MODE_FONT_FLOORS_PT;
const CAPTION_ROLES = new Set(['caption', 'label', 'annotation', 'axis-label']);
const CHROME_ROLES = new Set(['footnote', 'source', 'page-number']);
const ANALYZE_CONCURRENCY = 3;

interface BatchRun {
  readonly runKey: string;
  readonly briefKey: string;
  readonly projectId?: string;
  readonly outcome?: string;
  readonly durationMs?: number;
}

interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
interface Leaf { readonly type: string; readonly position: Box; readonly [key: string]: unknown }

interface RunMetrics {
  readonly runKey: string;
  readonly briefKey: string;
  readonly outcome?: string;
  readonly durationMin?: number;
  readonly presentationId?: string;
  readonly title?: string;
  readonly pages?: number;
  readonly readingMode?: ReadingMode;
  readonly findings?: { readonly p0: number; readonly p1: number; readonly p2: number; readonly fontFloor: number };
  readonly textChars?: number;
  readonly belowFloorShare?: number;
  readonly cream?: boolean;
  readonly dominantBackground?: string;
  readonly photoPageShare?: number;
  readonly imageAreaShare?: number;
  readonly topLeftTitleShare?: number;
  readonly pageKinds?: Readonly<Record<string, number>>;
  readonly error?: string;
}

function parseArgs(argv: readonly string[]) {
  const values = new Map<string, string>();
  let skipRender = false;
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]!;
    if (key === '--') continue;
    if (key === '--skip-render') { skipRender = true; continue; }
    const value = argv[index + 1];
    if (!['--batch', '--database'].includes(key) || !value) throw new Error(`Invalid argument: ${key}`);
    values.set(key, value);
    index += 1;
  }
  const batch = values.get('--batch');
  if (!batch) throw new Error('Usage: analyze --batch DIR [--database FILE] [--skip-render]');
  return {
    batch: path.resolve(batch),
    database: path.resolve(values.get('--database') ?? path.join(repoRoot, '_dev_data/workspace/workspace.sqlite')),
    skipRender,
  };
}

async function findPresentation(database: string, projectId: string) {
  const { stdout } = await run('sqlite3', [
    '-readonly',
    '-json',
    database,
    `select d.node_id as id, d.title as title, d.deck_spec_json as spec from presentation_documents d
     join workspace_nodes n on n.id = d.node_id
     where n.project_id = '${projectId.replace(/'/gu, "''")}'
     order by d.updated_at desc limit 1`,
  ], { maxBuffer: 256 * 1024 * 1024 });
  const rows = stdout.trim() ? (JSON.parse(stdout) as { id: string; title: string; spec: string }[]) : [];
  return rows[0];
}

async function slidesCli(args: readonly string[]) {
  return run('pnpm', ['--silent', 'slides:cli', '--', ...args], {
    cwd: repoRoot,
    maxBuffer: 256 * 1024 * 1024,
  });
}

function leaves(node: unknown, out: Leaf[]): Leaf[] {
  if (Array.isArray(node)) {
    for (const child of node) leaves(child, out);
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.type === 'string' && record.position && typeof record.position === 'object') {
      out.push(record as unknown as Leaf);
    }
    for (const [key, value] of Object.entries(record)) {
      if (!key.startsWith('_') && value && typeof value === 'object') leaves(value, out);
    }
  }
  return out;
}

/** 每段文字及其字号：run 自带字号优先，否则用元素字号。 */
function textRuns(element: Leaf): { text: string; size: number }[] {
  const base = (element.style as { fontSize?: number } | undefined)?.fontSize ?? 0;
  const content = element.content;
  if (typeof content === 'string') return [{ text: content, size: base }];
  const runs: unknown[] = Array.isArray(content)
    ? content
    : ((element.paragraphs as { runs?: unknown[] }[] | undefined) ?? []).flatMap(paragraph => paragraph.runs ?? []);
  return runs.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as { text?: string; fontSize?: number; style?: { fontSize?: number } };
    return [{ text: record.text ?? '', size: record.fontSize ?? record.style?.fontSize ?? base }];
  });
}

function hsl(hex: string): [number, number, number] | undefined {
  const match = /^#?([0-9a-f]{6})$/iu.exec(hex.trim());
  if (!match) return undefined;
  const value = Number.parseInt(match[1]!, 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, saturation, light];
}

/** 米色、宣纸色底：暖黄色相、浅、有一点饱和度。纯白和冷灰不算。 */
function isCream(color: string): boolean {
  const value = hsl(color);
  if (!value) return false;
  const [hue, saturation, light] = value;
  return light >= 0.8 && light < 0.985 && hue >= 20 && hue <= 65 && saturation >= 0.15;
}

function backgroundColor(spec: Record<string, unknown>): string | undefined {
  const background = spec.background as { paint?: { type?: string; color?: string }; color?: string } | undefined;
  if (background?.paint?.type === 'solid') return background.paint.color;
  return background?.color;
}

function analyzeSpec(deck: Record<string, unknown>) {
  const layout = deck.layout as { width?: number } | string | undefined;
  const width = typeof layout === 'object' && layout?.width ? layout.width : layout === '16x9' || layout === 'LAYOUT_16x9' ? 10 : 13.333;
  const height = (width * 9) / 16;
  const pageArea = width * height;
  const reading = ((deck.theme as { reading?: ReadingMode } | undefined)?.reading ?? 'mixed') as ReadingMode;
  const floors = READING_MODE_FONT_FLOORS_PT[reading];
  const scale = width / READING_MODE_FONT_FLOOR_REFERENCE_WIDTH_IN;
  const slides = (deck.slides as { spec: Record<string, unknown> }[]) ?? [];
  let chars = 0;
  let below = 0;
  let photoPages = 0;
  let imageArea = 0;
  let topLeft = 0;
  let contentPages = 0;
  const backgrounds = new Map<string, number>();
  const kinds = new Map<string, number>();

  slides.forEach((slide, index) => {
    const elements = leaves(slide.spec, []);
    const background = backgroundColor(slide.spec);
    if (background) backgrounds.set(background.toUpperCase(), (backgrounds.get(background.toUpperCase()) ?? 0) + 1);
    let maxSize = 0;
    let pageChars = 0;
    for (const element of elements.filter(candidate => candidate.type === 'text')) {
      const role = String(element._semanticRole ?? element.role ?? '').toLowerCase();
      if (role === 'decoration') continue;
      const floor = Math.round((CHROME_ROLES.has(role) ? floors.chrome : CAPTION_ROLES.has(role) ? floors.caption : floors.body) * scale * 4) / 4;
      for (const { text, size } of textRuns(element)) {
        const count = text.replace(/\s/gu, '').length;
        chars += count;
        pageChars += count;
        if (size > 0 && size < floor) below += count;
        maxSize = Math.max(maxSize, size);
      }
    }
    const images = elements.filter(element => element.type === 'image');
    const backgroundImage = JSON.stringify(slide.spec.background ?? {}).includes('"image"');
    const area = backgroundImage ? 1 : Math.min(1, images.reduce((sum, image) => sum + (image.position.w * image.position.h) / pageArea, 0));
    const largest = Math.max(0, ...images.map(image => (image.position.w * image.position.h) / pageArea));
    if (area >= 0.15) photoPages += 1;
    imageArea += area;
    if (index === 0) return;
    contentPages += 1;
    const texts = elements.filter(element => element.type === 'text');
    const titled = texts.some(element => {
      const size = textRuns(element).reduce((max, entry) => Math.max(max, entry.size), 0);
      return size >= maxSize * 0.8 && element.position.y < 0.2 * height && element.position.x < 0.15 * width;
    });
    if (titled) topLeft += 1;
    const vectorArea = elements
      .filter(element => ['svgGraphic', 'svg_graphic', 'brushArtwork', 'brush_artwork', 'brush'].includes(element.type))
      .reduce((sum, element) => sum + (element.position.w * element.position.h) / pageArea, 0);
    const boxes = elements.filter(element => {
      const share = (element.position.w * element.position.h) / pageArea;
      return ['shape', 'frame'].includes(element.type) && share >= 0.03 && share < 0.5;
    });
    const sizes = new Map<string, number>();
    for (const box of boxes) {
      const key = `${Math.round((box.position.w / width) * 25)}x${Math.round((box.position.h / height) * 25)}`;
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    const cards = Math.max(0, ...sizes.values());
    const kind =
      area >= 0.6 || largest >= 0.45 ? '满版大图'
        : area >= 0.15 ? '图文'
          : elements.some(element => element.type === 'chart' || element.type === 'table') ? '图表表格'
            : vectorArea >= 0.15 ? '示意图'
              : cards >= 2 ? '等大卡片'
                : maxSize >= 40 * scale && pageChars < 150 ? '大字'
                  : '纯文字';
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  });

  const dominant = [...backgrounds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const creamPages = [...backgrounds.entries()].filter(([color]) => isCream(color)).reduce((sum, [, count]) => sum + count, 0);
  return {
    pages: slides.length,
    readingMode: reading,
    textChars: chars,
    belowFloorShare: chars > 0 ? below / chars : 0,
    dominantBackground: dominant,
    cream: slides.length > 0 && creamPages / slides.length >= 0.5,
    photoPageShare: slides.length > 0 ? photoPages / slides.length : 0,
    imageAreaShare: slides.length > 0 ? imageArea / slides.length : 0,
    topLeftTitleShare: contentPages > 0 ? topLeft / contentPages : 0,
    pageKinds: Object.fromEntries([...kinds.entries()].sort((a, b) => b[1] - a[1])),
  };
}

function inspectFindings(stdout: string) {
  const line = stdout.split('\n').find(candidate => candidate.startsWith('{"kind"'));
  if (!line) throw new Error('inspect returned no report');
  const report = JSON.parse(line) as {
    findingSummary: { p0Count: number; p1Count: number; p2Count: number };
    findings: { code: string }[];
  };
  return {
    report: line,
    findings: {
      p0: report.findingSummary.p0Count,
      p1: report.findingSummary.p1Count,
      p2: report.findingSummary.p2Count,
      fontFloor: report.findings.filter(finding => finding.code === 'font_size_below_floor').length,
    },
  };
}

function label(text: string, width: number, height: number) {
  const escaped = text.replace(/[<&>]/gu, character => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[character]!);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/><text x="8" y="${height - 9}" font-family="PingFang SC, Helvetica" font-size="17" fill="#222">${escaped}</text></svg>`,
  );
}

async function contactSheet(files: readonly { file: string; caption?: string }[], output: string, columns: number, thumbWidth: number) {
  const thumbHeight = Math.round((thumbWidth * 9) / 16);
  const captionHeight = files.some(entry => entry.caption) ? 28 : 0;
  const gap = 8;
  const rows = Math.ceil(files.length / columns);
  const cellHeight = thumbHeight + captionHeight;
  const composites: OverlayOptions[] = [];
  for (const [index, entry] of files.entries()) {
    const left = gap + (index % columns) * (thumbWidth + gap);
    const top = gap + Math.floor(index / columns) * (cellHeight + gap);
    composites.push({ input: await sharp(entry.file).resize(thumbWidth, thumbHeight, { fit: 'contain', background: '#ddd' }).toBuffer(), left, top });
    if (entry.caption) composites.push({ input: label(entry.caption, thumbWidth, captionHeight), left, top: top + thumbHeight });
  }
  await sharp({
    create: {
      width: gap + columns * (thumbWidth + gap),
      height: gap + rows * (cellHeight + gap),
      channels: 3,
      background: '#e9e9e9',
    },
  })
    .composite(composites)
    .jpeg({ quality: 82 })
    .toFile(output);
}

const percent = (value: number | undefined) => (value === undefined ? '—' : `${Math.round(value * 100)}%`);

function summary(name: string, metrics: readonly RunMetrics[]): string {
  const analyzed = metrics.filter(entry => entry.pages !== undefined);
  const chars = analyzed.reduce((sum, entry) => sum + (entry.textChars ?? 0), 0);
  const below = analyzed.reduce((sum, entry) => sum + (entry.textChars ?? 0) * (entry.belowFloorShare ?? 0), 0);
  const briefs = [...new Set(metrics.map(entry => entry.briefKey))];
  const lines = [
    `# ${name}`,
    '',
    `成稿 ${analyzed.length} / ${metrics.length}；全部文字中低于阅读方式下限的占 ${percent(chars > 0 ? below / chars : 0)}。`,
    '',
    '| 简报 | 成稿 | 米色底 | 平均有图页 | 平均图片面积 | 左上标题页 |',
    '|---|---|---|---|---|---|',
    ...briefs.map(brief => {
      const group = analyzed.filter(entry => entry.briefKey === brief);
      const mean = (pick: (entry: RunMetrics) => number | undefined) =>
        group.length > 0 ? group.reduce((sum, entry) => sum + (pick(entry) ?? 0), 0) / group.length : undefined;
      return `| ${brief} | ${group.length} | ${group.filter(entry => entry.cream).length}/${group.length} | ${percent(mean(entry => entry.photoPageShare))} | ${percent(mean(entry => entry.imageAreaShare))} | ${percent(mean(entry => entry.topLeftTitleShare))} |`;
    }),
    '',
    '| 试跑 | 结果 | 用时 | 页 | 阅读方式 | P0/P1/P2 | 字号下限 | 低于下限 | 主底色 | 有图页 | 页面类型 |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...metrics.map(entry =>
      entry.pages === undefined
        ? `| ${entry.runKey} | ${entry.outcome ?? '—'} | ${entry.durationMin ?? '—'} | — | — | — | — | — | — | — | ${entry.error ?? ''} |`
        : `| ${entry.runKey} | ${entry.outcome ?? '—'} | ${entry.durationMin ?? '—'} | ${entry.pages} | ${entry.readingMode} | ${entry.findings ? `${entry.findings.p0}/${entry.findings.p1}/${entry.findings.p2}` : '—'} | ${entry.findings?.fontFloor ?? '—'} | ${percent(entry.belowFloorShare)} | ${entry.dominantBackground ?? '—'}${entry.cream ? '（米色）' : ''} | ${percent(entry.photoPageShare)} | ${Object.entries(entry.pageKinds ?? {}).map(([kind, count]) => `${kind}${count}`).join(' ')} |`,
    ),
    '',
    '样张：`sheets/covers.jpg`（全部封面）与 `sheets/<试跑>.jpg`（逐稿）。视觉评分对照参考稿人工完成。',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const state = JSON.parse(await readFile(path.join(options.batch, 'batch.json'), 'utf8')) as {
    name: string;
    runs: BatchRun[];
  };
  const sheets = path.join(options.batch, 'sheets');
  const decks = path.join(options.batch, 'decks');
  await mkdir(sheets, { recursive: true });
  await mkdir(decks, { recursive: true });
  const metrics: RunMetrics[] = new Array(state.runs.length);
  const covers: ({ file: string; caption: string } | undefined)[] = new Array(state.runs.length);

  async function analyzeRun(entry: BatchRun, index: number): Promise<void> {
    const base = {
      runKey: entry.runKey,
      briefKey: entry.briefKey,
      outcome: entry.outcome,
      durationMin: entry.durationMs === undefined ? undefined : Math.round(entry.durationMs / 6000) / 10,
    };
    try {
      if (!entry.projectId) throw new Error('no project');
      const presentation = await findPresentation(options.database, entry.projectId);
      if (!presentation) throw new Error('no presentation');
      const deck = JSON.parse(presentation.spec) as Record<string, unknown>;
      const inspect = await slidesCli(['inspect', '--presentation', presentation.id, '--database', options.database]);
      const { report, findings } = inspectFindings(inspect.stdout);
      await writeFile(path.join(decks, `${entry.runKey}.inspect.json`), `${report}\n`);
      const renderDir = path.join(decks, entry.runKey);
      if (!options.skipRender || !existsSync(renderDir)) {
        await rm(renderDir, { recursive: true, force: true });
        await slidesCli(['render', '--presentation', presentation.id, '--database', options.database, '--width', '960', '--output', renderDir, '--overwrite']);
      }
      const images = (await readdir(renderDir)).filter(file => /^slide-\d+\.(jpg|png)$/u.test(file)).sort();
      if (images.length > 0) {
        await contactSheet(images.map(file => ({ file: path.join(renderDir, file) })), path.join(sheets, `${entry.runKey}.jpg`), 5, 384);
        covers[index] = { file: path.join(renderDir, images[0]!), caption: entry.runKey };
      }
      metrics[index] = { ...base, presentationId: presentation.id, title: presentation.title, findings, ...analyzeSpec(deck) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      metrics[index] = { ...base, error: message.split('\n')[0] };
    }
    process.stderr.write(`${entry.runKey} analyzed\n`);
  }

  // 渲染是单稿最慢的一步；并行几份即可，过多会和正在运行的 App 抢 CPU。
  const queue = state.runs.map((entry, index) => ({ entry, index }));
  await Promise.all(
    Array.from({ length: Math.min(ANALYZE_CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await analyzeRun(next.entry, next.index);
    }),
  );

  const coverFiles = covers.filter((entry): entry is { file: string; caption: string } => entry !== undefined);
  if (coverFiles.length > 0) await contactSheet(coverFiles, path.join(sheets, 'covers.jpg'), 6, 384);
  await writeFile(path.join(options.batch, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  await writeFile(path.join(options.batch, 'summary.md'), summary(state.name, metrics));
  process.stdout.write(`${path.join(options.batch, 'summary.md')}\n`);
}

await main();
