import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  ColorPaletteCheckOutcomeSchema,
  ColorPaletteSuggestOutcomeSchema,
  ColorPaletteUseOutcomeSchema,
  type ColorPalette,
  type ColorPaletteSuggestOutcome,
} from '@app/schemas/color-palette';
import { encodeRngId, paletteFamilies } from '@linnya/color-core/palette';
import Database from 'better-sqlite3';
import {
  checkColorPalette,
  createSqliteColorPaletteHistory,
  renderPalettePreview,
  suggestColorPalettes,
  useColorPalette,
  type ColorPaletteHistoryPort,
} from '..';
import { getColorPaletteSchemaProviders } from '../infrastructure/sqlite/schemaProviders';

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/**
 * 一个工作区库：只建本 domain schema provider 给出的表（Desktop 启动时 DatabaseService 执行的就是这些 DDL；
 * 经 DatabaseService 的完整路径由插件门面与 Shell 桥测试覆盖）。
 */
function workspaceHistory(): ColorPaletteHistoryPort {
  const db = new Database(':memory:');
  databases.push(db);
  for (const statement of getColorPaletteSchemaProviders().flatMap(provider => provider.getSchema())) db.exec(statement);
  return createSqliteColorPaletteHistory(db);
}

async function twoColorPng(left: string, right: string): Promise<Uint8Array> {
  const half = await sharp({ create: { width: 32, height: 64, channels: 3, background: right } }).png().toBuffer();
  return await sharp({ create: { width: 64, height: 64, channels: 3, background: left } })
    .composite([{ input: half, left: 32, top: 0 }])
    .png()
    .toBuffer();
}

function suggestion(outcome: ColorPaletteSuggestOutcome) {
  if (outcome.status !== 'ok') throw new Error(`${outcome.code}: ${outcome.message}`);
  return outcome;
}

describe('配色 Core 能力', () => {
  it('从真实编码的图片出配色，输出符合跨边界合同，同一编号逐字节复现', async () => {
    const history = workspaceHistory();
    const images = [await twoColorPng('#4e7a68', '#9a7440'), await twoColorPng('#3f6b5a', '#a07a48')];
    const first = suggestion(await suggestColorPalettes({ images }, history));
    expect(ColorPaletteSuggestOutcomeSchema.parse(first)).toEqual(first);
    expect(first.suggestion.palettes).toHaveLength(3);
    expect(first.suggestion.subject.length).toBeGreaterThan(0);
    expect(first.skippedImages).toEqual([]);

    const again = suggestion(await suggestColorPalettes({ images, rng: first.suggestion.id }, history));
    expect(again).toEqual(first);
  });

  it('解不开的图片跳过并报告下标，其余照常；全部解不开才失败', async () => {
    const history = workspaceHistory();
    const good = await twoColorPng('#4e7a68', '#9a7440');
    const broken = new Uint8Array([1, 2, 3, 4]);
    const outcome = suggestion(await suggestColorPalettes({ images: [broken, good] }, history));
    expect(outcome.skippedImages).toEqual([0]);

    await expect(suggestColorPalettes({ images: [broken] }, history)).resolves.toMatchObject({ status: 'failed', code: 'image_unreadable' });
    // 还有指定色时不算失败，图片只是用不上。
    await expect(suggestColorPalettes({ images: [broken], pinnedColors: ['#1f3a5f'] }, history)).resolves.toMatchObject({
      status: 'ok', skippedImages: [0],
    });
  });

  it('只接受 JPEG、PNG、WebP，不把其它可解码格式交给解码器', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>');
    await expect(suggestColorPalettes({ images: [svg] }, workspaceHistory())).resolves.toMatchObject({ status: 'failed', code: 'image_unreadable' });
  });

  it('每种可预期的失败都有稳定错误码', async () => {
    const history = workspaceHistory();
    const gray = await twoColorPng('#808080', '#6e6e6e');
    await expect(suggestColorPalettes({ images: [gray] }, history)).resolves.toMatchObject({ code: 'no_subject_color' });
    await expect(suggestColorPalettes({ images: Array.from({ length: 21 }, () => gray) }, history)).resolves.toMatchObject({ code: 'too_many_images' });
    await expect(suggestColorPalettes({ seedColors: ['#4e7a68'], rng: 'nonsense' }, history)).resolves.toMatchObject({ code: 'invalid_rng' });
    await expect(suggestColorPalettes({ pinnedColors: ['#000000'] }, history)).resolves.toMatchObject({
      code: 'pinned_color_neutral', message: expect.stringContaining('#000000'),
    });
    await expect(suggestColorPalettes({ pinnedColors: ['#ffffb0'], base: 'light' }, history)).resolves.toMatchObject({ code: 'pinned_color_conflict' });
    await expect(suggestColorPalettes({ seedColors: ['#4e7a68'], count: 6 }, history)).resolves.toMatchObject({
      code: 'invalid_options', message: expect.stringContaining('1–5'),
    });
    await expect(suggestColorPalettes({ pinnedColors: ['red'] }, history)).resolves.toMatchObject({ code: 'invalid_options' });
  });

  it('指定色原样成为每套的主色，强调色数量听调用方的', async () => {
    const outcome = suggestion(await suggestColorPalettes({ pinnedColors: ['#1F3A5F'], accentCount: 4 }, workspaceHistory()));
    for (const palette of outcome.suggestion.palettes) {
      expect(palette.accent[0]).toBe('#1f3a5f');
      expect(palette.accent).toHaveLength(4);
    }
    expect(outcome.suggestion.subject[0]).toMatchObject({ hex: '#1f3a5f', pinned: true });
  });

  it('取消信号在解码之间生效', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    await expect(suggestColorPalettes({ images: [await twoColorPng('#4e7a68', '#9a7440')], signal: controller.signal }, workspaceHistory()))
      .rejects.toThrow('stopped');
  });

  it('检查自写配色：结果符合合同，不合格时给出能通过复检的版本', () => {
    const palette = {
      bg: '#ffffff', surface: '#f2f2f2', ink: '#999999', muted: '#777777',
      accent: ['#1f3a5f'], chart: ['#cccccc', '#333333', '#777777'],
    };
    const outcome = checkColorPalette({ palette });
    if (outcome.status !== 'ok') throw new Error(outcome.message);
    expect(ColorPaletteCheckOutcomeSchema.parse(outcome)).toEqual(outcome);
    expect(outcome.check.ok).toBe(false);
    expect(outcome.check.findings.map(finding => finding.rule)).toEqual(expect.arrayContaining(['ink_contrast', 'chart_order']));
    if (!outcome.check.suggested) throw new Error('应当能修复');
    expect(checkColorPalette({ palette: outcome.check.suggested })).toMatchObject({ check: { ok: true, suggested: null } });
    expect(outcome.check.suggested.accent).toEqual(palette.accent);
  });

  it('预览按套数画行，每行从底色开始', () => {
    const palette = {
      id: 'x-1', relation: 'mono', base: 'light', tone: 'native', bg: '#102030', surface: '#405060', ink: '#708090', muted: '#a0b0c0',
      accent: ['#ff0000', '#00ff00'], chart: ['#0000ff'],
    } as const;
    const preview = renderPalettePreview([{ ...palette, accent: [...palette.accent], chart: [...palette.chart] }]);
    expect(preview.data).toHaveLength(preview.width * preview.height * 4);
    const firstCell = (20 * preview.width + 20) * 4;
    expect([...preview.data.slice(firstCell, firstCell + 4)]).toEqual([0x10, 0x20, 0x30, 255]);
  });
});

describe('最近用过', () => {
  const combinationOf = (palette: ColorPalette) => `${palette.base}:${paletteFamilies(palette).sort().join('+')}`;
  /** 连续 10 次调用用的编号，固定下来：有无“最近用过”两边逐次对照，结果可复现。 */
  const TEN_RUNS = Array.from({ length: 10 }, (_, index) => encodeRngId(1000 + index * 37));

  async function countOver(history: ColorPaletteHistoryPort, images: readonly Uint8Array[], combination: string): Promise<number> {
    let count = 0;
    for (const rng of TEN_RUNS) {
      const outcome = suggestion(await suggestColorPalettes({ images, rng }, history));
      count += outcome.suggestion.palettes.filter(palette => combinationOf(palette) === combination).length;
    }
    return count;
  }

  it('同一张图连续调用 10 次：选用过的组合出现次数明显下降，其余照常出', async () => {
    const images = [await twoColorPng('#4e7a68', '#9a7440')];

    // 没有选用记录时，10 次里最常出的组合。
    const baselineHistory = workspaceHistory();
    const counts = new Map<string, number>();
    for (const rng of TEN_RUNS) {
      for (const palette of suggestion(await suggestColorPalettes({ images, rng }, baselineHistory)).suggestion.palettes) {
        counts.set(combinationOf(palette), (counts.get(combinationOf(palette)) ?? 0) + 1);
      }
    }
    const [frequent, baseline] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? ['', 0];
    expect(baseline).toBeGreaterThanOrEqual(4);

    // 另一个工作区：先出一组、选用其中这个组合的那套，再连续调用同样的 10 次。
    const history = workspaceHistory();
    let used: ColorPalette | undefined;
    for (let seed = 0; seed < 50 && !used; seed += 1) {
      const outcome = suggestion(await suggestColorPalettes({ images, rng: encodeRngId(seed) }, history));
      used = outcome.suggestion.palettes.find(palette => combinationOf(palette) === frequent);
    }
    if (!used) throw new Error(`没有出现过 ${frequent}`);
    const recorded = ColorPaletteUseOutcomeSchema.parse(useColorPalette(used.id, history));
    expect(recorded).toMatchObject({ status: 'ok', used: { id: used.id, base: used.base } });

    const after = await countOver(history, images, frequent);
    expect(after, `${frequent}: ${baseline} → ${after}`).toBeLessThanOrEqual(baseline / 3);
  });

  it('use 只认本工作区发出过的单套编号；同一套再选只移到最前，不占两个位置', async () => {
    const history = workspaceHistory();
    expect(useColorPalette('pl8f2a-1', history)).toMatchObject({ status: 'failed', code: 'palette_not_found' });
    expect(useColorPalette('pl8f2a', history)).toMatchObject({ status: 'failed', code: 'palette_not_found' });

    const { suggestion: issued } = suggestion(await suggestColorPalettes({ seedColors: ['#4e7a68'], count: 2 }, history));
    const [first, second] = issued.palettes;
    if (!first || !second) throw new Error('需要两套');
    expect(useColorPalette(`${issued.id}-3`, history)).toMatchObject({ code: 'palette_not_found' });
    expect(useColorPalette(first.id.toUpperCase(), history)).toMatchObject({ status: 'ok', used: { id: first.id } });
    useColorPalette(second.id, history);
    useColorPalette(first.id, history);
    const firstCombination = { base: first.base, families: paletteFamilies(first).sort() };
    const secondCombination = { base: second.base, families: paletteFamilies(second).sort() };
    expect(history.readRecentUses()).toEqual([firstCombination, secondCombination]);
  });

  it('选用记录只留降权要看的最近 15 次；不同工作区互不影响', async () => {
    const history = workspaceHistory();
    for (let seed = 0; seed < 20; seed += 1) {
      const { suggestion: issued } = suggestion(await suggestColorPalettes({ seedColors: ['#4e7a68'], rng: encodeRngId(seed), count: 1 }, history));
      expect(useColorPalette(issued.palettes[0]?.id ?? '', history)).toMatchObject({ status: 'ok' });
    }
    expect(history.readRecentUses()).toHaveLength(15);
    expect(workspaceHistory().readRecentUses()).toEqual([]);
  });

  it('复现用发出时的最近用过：选用其中一套之后，同一编号仍逐字节复现', async () => {
    const history = workspaceHistory();
    const images = [await twoColorPng('#4e7a68', '#9a7440')];
    const first = suggestion(await suggestColorPalettes({ images }, history));
    const chosen = first.suggestion.palettes[0];
    if (!chosen) throw new Error('需要一套');
    expect(useColorPalette(chosen.id, history)).toMatchObject({ status: 'ok' });
    expect(await suggestColorPalettes({ images, rng: first.suggestion.id.toUpperCase() }, history)).toEqual(first);
  });
});
