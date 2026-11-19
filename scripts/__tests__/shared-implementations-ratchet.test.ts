import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  collectSharedImplementationEntries,
  compareSharedImplementations,
  countSharedImplementationHits,
  formatSharedImplementationBaseline,
  parseSharedImplementationBaseline,
} from '../guards/shared-implementations-ratchet';

describe('共享实现棘轮', () => {
  it.each([
    ['packages/plugins/slides/src/backend/engine/Compiler.ts', 'const imgOpts: PptxGenJS.ImageProps = {};', 'SLIDES-image-props'],
    ['packages/plugins/slides/src/backend/engine/Compiler.ts', 'private buildGroupTransform(group, parent) {}', 'SLIDES-freeform-transform'],
    ['packages/plugins/slides/src/renderer/features/other/registry.ts', 'function waitForConsumer(pending, signal) {}', 'SLIDES-resource-consumer'],
    ['apps/renderer/shared/utils/textUnits.ts', 'function countTextUnitsZhEn(text) {}', 'SCHEMAS-text-units'],
    ['src/shared/utils/refIdGenerator.ts', 'function hashToBase62(hash) {}', 'SCHEMAS-block-reference'],
    ['apps/renderer/domains/editor/functions/parse.ts', 'function assertNodeJson(value) {}', 'MARKDOWN-strict-json'],
  ])('阻止 %s 恢复已经迁走的规则', (file, source, ruleId) => {
    expect(countSharedImplementationHits(file, source)).toMatchObject([{ ruleId, count: 1 }]);
  });

  it('Slides 的共享 owner 与 OOXML parser 变换不会被误判', () => {
    expect(countSharedImplementationHits('packages/plugins/slides/src/renderer/shared/renderResourceCache.ts', 'function waitForResourceConsumer(pending, signal) {}')).toEqual([]);
    expect(countSharedImplementationHits('packages/plugins/slides/src/backend/engine/parser/xml/GeometryParser.ts', 'export function buildGroupTransform(xfrm, parent) {}')).toEqual([]);
  });

  it('合同 declare 和共享 owner 不算第二份运行实现', () => {
    expect(countSharedImplementationHits('packages/plugin-host-contract/renderer/refId.ts', 'export declare function normalizeRef(ref: string): string;')).toEqual([]);
    expect(countSharedImplementationHits('packages/schemas/src/text-units.ts', 'function countTextUnitsZhEn(text) {}')).toEqual([]);
  });
  it('文件大小只能定义在本地化 owner，业务未知值包装可保留', () => {
    const source = 'function formatFileSize(bytes: number) { return String(bytes); }';
    expect(countSharedImplementationHits('apps/renderer/domains/x/presentation.ts', source))
      .toMatchObject([{ ruleId: 'LOCALIZATION-byte-size', count: 1 }]);
    expect(countSharedImplementationHits('apps/renderer/app/localization/functions/formatStorageBytes.ts', source)).toEqual([]);
    expect(countSharedImplementationHits('apps/renderer/domains/x/presentation.ts', 'function formatImageFileSize(bytes) { return bytes < 0 ? "unknown" : formatStorageBytes(bytes, locale); }')).toEqual([]);
  });
  it('共享位置以外的本地定义算命中，共享位置自己不算', () => {
    const source = 'function isRecord(value: unknown): value is Record<string, unknown> {\n  return true;\n}\n';
    expect(countSharedImplementationHits('src/domains/x/readX.ts', source))
      .toEqual([{ ruleId: 'FOUNDATION-is-record', file: 'src/domains/x/readX.ts', count: 1 }]);
    expect(countSharedImplementationHits('packages/foundation/src/isRecord.ts', source)).toEqual([]);
  });

  it('同名宽松对象判断也只允许共享 owner 定义', () => {
    const source = 'function isObjectLike(value: unknown) { return typeof value === "object" && value !== null; }';
    expect(countSharedImplementationHits('src/features/x/read.ts', source)).toMatchObject([{ ruleId: 'FOUNDATION-object-like', count: 1 }]);
    expect(countSharedImplementationHits('packages/foundation/src/isObjectLike.ts', source)).toEqual([]);
  });

  it('调用共享实现、名字只是前缀相同的都不算', () => {
    const source = [
      "import { isRecord, clamp, sleep } from '@linnya/foundation';",
      'const delay = Math.max(a - b, 0);',
      'const clamp = id === "name" ? clampNameWidth : clampColumnWidth;',
      'function clampColumnWidth(width: number) { return clamp(width, 80, 600); }',
      'if (isRecord(value)) await sleep(10);',
    ].join('\n');
    expect(countSharedImplementationHits('src/domains/x/readX.ts', source)).toEqual([]);
  });

  it('时间显示规则只管界面，且不管本地化自己', () => {
    const source = "const text = new Intl.DateTimeFormat(locale).format(date);\n";
    expect(countSharedImplementationHits('apps/renderer/domains/x/ui/X.vue', source)).toHaveLength(1);
    expect(countSharedImplementationHits('apps/renderer/app/localization/vue/useHistoryTime.ts', source)).toEqual([]);
    expect(countSharedImplementationHits('src/domains/x/formatX.ts', source)).toEqual([]);
  });

  it('只拦同体错误转换函数，不扩展到内联表达式或业务错误规则', () => {
    const file = 'src/features/x/failure.ts';
    const body = 'function getErrorMessage(error: unknown): string {\n return error instanceof Error ? error.message : String(error);\n}';
    expect(countSharedImplementationHits(file, body)).toMatchObject([{ ruleId: 'FOUNDATION-error-to-string', count: 1 }]);
    expect(countSharedImplementationHits(file, 'const diagnostic = error instanceof Error ? error.message : String(error);')).toEqual([]);
    expect(countSharedImplementationHits(file, 'function getErrorMessage(error: unknown): string { return error instanceof Error ? error.message : "unknown"; }')).toEqual([]);
    expect(countSharedImplementationHits('packages/foundation/src/errorToString.ts', body)).toEqual([]);
  });

  it('只许减少：新增报 expanded，减少报 reduced，基线可往返', () => {
    const baseline = parseSharedImplementationBaseline(formatSharedImplementationBaseline([
      { ruleId: 'FOUNDATION-clamp', file: 'a.ts', count: 2 },
      { ruleId: 'FOUNDATION-sleep', file: 'b.ts', count: 1 },
    ]));
    const diff = compareSharedImplementations([
      { ruleId: 'FOUNDATION-clamp', file: 'a.ts', count: 1 },
      { ruleId: 'FOUNDATION-is-record', file: 'c.ts', count: 1 },
    ], baseline);
    expect(diff.expanded).toEqual([{ ruleId: 'FOUNDATION-is-record', file: 'c.ts', count: 1 }]);
    expect(diff.reduced).toEqual([
      { ruleId: 'FOUNDATION-clamp', file: 'a.ts', count: 1 },
      { ruleId: 'FOUNDATION-sleep', file: 'b.ts', count: 0 },
    ]);
  });
});

describe('颜色公式只放在 @linnya/color-core', () => {
  const outside = 'packages/plugins/slides/src/backend/engine/quality/someNewColorCheck.ts';
  const owner = 'packages/color-core/src/functions/colorSpace.ts';

  it.each([
    ['sRGB 线性化常量', 'return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;', 'COLOR-srgb-transfer'],
    ['近似 gamma 线性化', 'const linear = Math.pow(channel / 255, 2.2);', 'COLOR-srgb-transfer'],
    ['Rec.709 明度系数', 'const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;', 'COLOR-luminance-weights'],
    ['Rec.601 明度系数', 'const luma = 0.299 * r + 0.587 * g + 0.114 * b;', 'COLOR-luminance-weights'],
    ['OKLab 矩阵', 'const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);', 'COLOR-space-constants'],
    ['截短小数位的 OKLab 矩阵', 'const a = 1.977998 * l - 2.428592 * m + 0.450593 * s;', 'COLOR-space-constants'],
    ['CIELab 白点', 'const xn = 95.047;', 'COLOR-space-constants'],
    ['色觉异常矩阵', 'const row = [0.152286, 1.052583, -0.204868];', 'COLOR-space-constants'],
    ['HSL 转换函数', 'function rgbToHsl(r: number, g: number, b: number) { return [0, 0, 0]; }', 'COLOR-hue-math'],
    ['反向 HSV 转换', 'export const hsvToRgb = (h: number, s: number, v: number) => [h, s, v];', 'COLOR-hue-math'],
    ['OKLab 到 OKLCH 的色相', 'const hue = Math.atan2(lab.b, lab.a) * 180 / Math.PI;', 'COLOR-hue-math'],
    ['色相圆形平均', 'const mean = Math.atan2(sumSin, sumCos);', 'COLOR-hue-math'],
    ['ΔE 函数', 'function deltaE76(left: Lab, right: Lab): number { return 0; }', 'COLOR-delta-e'],
    ['Lab 欧氏距离', 'return Math.sqrt(dL * dL + da * da + db * db);', 'COLOR-delta-e'],
  ])('新代码里出现%s算新增存量', (_name, source, ruleId) => {
    expect(countSharedImplementationHits(outside, source)).toEqual([{ ruleId, file: outside, count: 1 }]);
  });

  it('color-core 自己不受限', () => {
    const sources = [
      'return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;',
      'return 0.2126 * red + 0.7152 * green + 0.0722 * blue;',
      'const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green);',
      'function rgbToHsl(r: number, g: number, b: number) {}',
      'const hue = Math.atan2(color.b, color.a);',
      'function deltaEOK(left: Oklab, right: Oklab): number { return 0; }',
    ];
    for (const source of sources) {
      expect(countSharedImplementationHits(owner, source)).toEqual([]);
    }
  });

  it('注释里写公式出处、调用 color-core、无关的几何与尺寸都不算', () => {
    const source = [
      ' * 去色取 Rec.709 权重 0.2126R + 0.7152G + 0.0722B',
      '// sRGB 阈值 0.04045 与 1.055',
      "import { rgbToOklch, relativeLuminance, deltaEOK } from '@linnya/color-core';",
      'export function toOklch(rgb: RgbColor): Oklch { return rgbToOklch([rgb.r, rgb.g, rgb.b]); }',
      'export const ConstraintDeltaEvidenceSchema = z.object({});',
      'const rotation = Math.atan2(end.y - origin.y, end.x - origin.x) * 180 / Math.PI;',
      'createImage({ width: 1.8, height: 2.4, maskShape: arch(1.8, 2.4) });',
      'const eased = Math.pow(progress, 3);',
    ].join('\n');
    expect(countSharedImplementationHits(outside, source)).toEqual([]);
  });

  it('新增一处颜色公式时棘轮判定为新增，门禁会失败', () => {
    const baseline = parseSharedImplementationBaseline(fs.readFileSync('.baseline/shared-implementations.txt', 'utf8'));
    const added = countSharedImplementationHits(outside, 'const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;');
    expect(compareSharedImplementations(added, baseline).expanded).toEqual([
      { ruleId: 'COLOR-luminance-weights', file: outside, count: 1 },
    ]);
  });

  it('当前仓库的颜色公式与 baseline 精确一致，没有 color-core 以外的新增', () => {
    const baseline = parseSharedImplementationBaseline(fs.readFileSync('.baseline/shared-implementations.txt', 'utf8'));
    const diff = compareSharedImplementations(collectSharedImplementationEntries(), baseline);
    expect(diff.expanded.filter(entry => entry.ruleId.startsWith('COLOR-'))).toEqual([]);
  }, 30_000);
});
