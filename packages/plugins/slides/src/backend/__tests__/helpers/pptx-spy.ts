/**
 * PptxGenJS Spy 工具
 *
 * 拦截 StructuredCompiler.compileSlide 内部对 PptxGenJS slide 的
 * addText / addChart / addTable / addImage / addShape 调用，
 * 将每次调用的参数记录下来，用于与 RenderModel 侧做元素级对比。
 */

import PptxGenJS from 'pptxgenjs';

// ─── 类型 ───────────────────────────────────────────────────────────────

export type CapturedMethod = 'addText' | 'addChart' | 'addTable' | 'addImage' | 'addShape';

export interface CapturedElement {
  method: CapturedMethod;
  /** addText / addImage / addShape 的 opts；addChart 的 chartOpts；addTable 的 tableOpts */
  opts: Record<string, unknown>;
  /** addChart 的 chartType（第一个参数） */
  chartType?: string;
  /** addChart 的 chartData（第二个参数） */
  chartData?: Array<{ name: string; labels: string[]; values: number[] }>;
  /** addTable 的 rows（第一个参数） */
  tableRows?: unknown[];
  /** addText 的文本内容（第一个参数） */
  textContent?: string | unknown[];
}

export interface SpiedPptxResult {
  pptx: PptxGenJS;
  /** 每个 slide 的 captures（按 addSlide 顺序） */
  slideCaptures: CapturedElement[][];
}

// ─── 核心 ───────────────────────────────────────────────────────────────

/**
 * 创建一个带 spy 的 PptxGenJS 实例。
 * 编译器调用 slide.addText / addChart 等方法时，
 * 参数会被拦截并记录到 slideCaptures 中。
 */
export function createSpiedPptx(): SpiedPptxResult {
  const ctor = (
    PptxGenJS as unknown as { default?: new () => PptxGenJS }
  ).default ?? (PptxGenJS as unknown as new () => PptxGenJS);
  const pptx = new ctor();

  const slideCaptures: CapturedElement[][] = [];

  const origAddSlide = pptx.addSlide.bind(pptx);
  pptx.addSlide = (...args: Parameters<typeof pptx.addSlide>) => {
    const slide = origAddSlide(...args);
    const captures: CapturedElement[] = [];
    slideCaptures.push(captures);

    wrapSlideMethod(slide, 'addText', captures);
    wrapSlideMethod(slide, 'addChart', captures);
    wrapSlideMethod(slide, 'addTable', captures);
    wrapSlideMethod(slide, 'addImage', captures);
    wrapSlideMethod(slide, 'addShape', captures);

    return slide;
  };

  return { pptx, slideCaptures };
}

// ─── 内部 ───────────────────────────────────────────────────────────────

/**
 * 包装 slide 上的某个 add* 方法，记录参数后再调用原始实现。
 * 注意：PptxGenJS 内部会原地修改 opts（如将 inches 转 EMU），
 * 所以必须在调用原始方法之前深拷贝参数。
 */
function wrapSlideMethod(
  slide: PptxGenJS.Slide,
  method: CapturedMethod,
  captures: CapturedElement[],
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (slide as any)[method].bind(slide);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (slide as any)[method] = (...args: any[]) => {
    const cloned = args.map(deepClone);
    const captured = extractCapture(method, cloned);
    captures.push(captured);
    return original(...args);
  };
}

function deepClone<T>(obj: T): T {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone) as T;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = deepClone(value);
  }
  return result as T;
}

/**
 * 根据方法签名提取有用信息：
 * - addText(content, opts)
 * - addChart(chartType, chartData, chartOpts)
 * - addTable(rows, tableOpts)
 * - addImage(opts)
 * - addShape(shapeName, shapeOpts)
 */
function extractCapture(method: CapturedMethod, args: unknown[]): CapturedElement {
  switch (method) {
    case 'addText':
      return {
        method,
        textContent: args[0] as string | unknown[],
        opts: (args[1] ?? {}) as Record<string, unknown>,
      };
    case 'addChart':
      return {
        method,
        chartType: args[0] as string,
        chartData: args[1] as CapturedElement['chartData'],
        opts: (args[2] ?? {}) as Record<string, unknown>,
      };
    case 'addTable':
      return {
        method,
        tableRows: args[0] as unknown[],
        opts: (args[1] ?? {}) as Record<string, unknown>,
      };
    case 'addImage':
      return {
        method,
        opts: (args[0] ?? {}) as Record<string, unknown>,
      };
    case 'addShape':
      return {
        method,
        opts: (args[1] ?? {}) as Record<string, unknown>,
      };
  }
}
