/**
 * @file src/parsers/pdfParser/adapters/PdfParseAdapter.ts
 * 
 * **功能 (What):** pdf-parse库适配器，提供跨平台PDF文本提取
 * **输入 (Input):** PDF二进制数据
 * **输出 (Output):** 提取的文本和元数据
 * **副作用 (Side-effects):** 使用pdf-parse库处理PDF
 */

import { TextItem } from '../types';
import { createRequire } from 'node:module';

/**
 * ✅ 根因修复（ESM 环境下 require 不存在）：
 * - 该文件会在 Electron-run-as-node + tsx 的 ESM 运行时被加载；
 * - 直接使用 `require(...)` 会触发 `ReferenceError: require is not defined` 并刷屏噪音日志；
 * - 同时该文件也会被打包进 CJS（dist/main/main.cjs）；此时必须使用 __filename 作为 createRequire 的基准。
 *
 * 约束：
 * - 不使用 any
 * - 不做不安全断言
 */
/**
 * 说明：
 * - CJS（Electron 主进程 bundle）下有 `__filename`；
 * - ESM（tsx 运行）下没有 `__filename`，但 `process.argv[1]` 是当前入口脚本路径，可作为 createRequire 基准。
 *
 * 这样可以彻底避免在 CJS 产物中出现 `import.meta`，同时兼容两种运行形态。
 */
const require = createRequire(typeof __filename === 'string' ? __filename : process.argv[1]);

// 定义pdfjs库的基本接口，避免使用any
interface PDFJSLib {
  getDocument: (params: {data: Uint8Array}) => {promise: Promise<PDFDocumentProxy>};
  version: string;
  GlobalWorkerOptions?: {
    workerSrc: string;
  };
}

interface PDFDocumentProxy {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
  getMetadata: () => Promise<unknown>;
  destroy?: () => Promise<void>;
}

interface PDFPageProxy {
  getTextContent: () => Promise<{ items: unknown[] }>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readNumberArray(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out: number[] = [];
  for (const item of v) {
    const n = readFiniteNumber(item);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

function toTextItem(raw: unknown, page: number): TextItem | null {
  if (!isRecord(raw)) return null;
  const str = raw['str'];
  const transform = raw['transform'];
  const width = raw['width'];
  const height = raw['height'];

  if (typeof str !== 'string' || str.length === 0) return null;
  const t = readNumberArray(transform);
  const w = readFiniteNumber(width);
  const h = readFiniteNumber(height);
  if (!t || w === null || h === null) return null;

  return { str, transform: t, width: w, height: h, page };
}

// 🔥 修复：使用一个Promise来确保pdfjs在使用前被完全加载和配置
const pdfjsPromise: Promise<PDFJSLib> = (async () => {
  let pdfjs: PDFJSLib;
  try {
    // 尝试导入legacy版本
    pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  } catch (legacyError) {
    try {
      // 如果legacy版本失败，尝试导入标准版本
      pdfjs = require('pdfjs-dist');
      console.warn('使用标准版pdfjs-dist，某些功能可能不可用');
    } catch (standardError) {
      console.error('无法加载pdfjs-dist库:', standardError);
      // 创建一个最小化的模拟对象，防止代码崩溃
      pdfjs = {
        getDocument: () => {
          throw new Error('PDF处理库未正确加载');
        },
        version: 'not-loaded'
      };
    }
  }

  // 🔥 修复：在Node.js环境中禁用worker，避免路径问题
  if (typeof window === 'undefined' && pdfjs && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = '';
  }
  return pdfjs;
})();

/**
 * pdf-parse库返回的带有文本项的对象
 */
interface PdfParseData {
  numpages: number;
  numrender: number;
  info: Record<string, unknown>;
  metadata: Record<string, unknown>;
  text: string;
  version: string;
  items: TextItem[];
}


/**
 * **功能 (What):** 使用pdfjs-dist库提取PDF内容和页码
 * **输入 (Input / @param):** 
 * @param data - PDF文件的二进制数据
 * **输出 (Output / @returns):** PDF解析结果
 * **副作用 (Side-effects):** 使用pdfjs-dist库
 */
export async function extractWithPdfParse(data: Uint8Array): Promise<PdfParseData> {
  // 等待pdfjs加载完成
  const pdfjs = await pdfjsPromise;
  try {
    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;
    
    const items: TextItem[] = [];
    const numpages = pdf.numPages;

    for (let i = 1; i <= numpages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        // ✅ 严格收敛为 TextItem（不使用 any / 不做不安全断言）
        const textItem = toTextItem(item, i);
        if (textItem) items.push(textItem);
      }
    }
    
    const text = items.map(item => item.str).join('\n');
    const metadataRaw = await pdf.getMetadata().catch(() => null);
    let info: Record<string, unknown> = {};
    let metadata: Record<string, unknown> = {};
    if (isRecord(metadataRaw)) {
      const rawInfo = metadataRaw['info'];
      const rawMetadata = metadataRaw['metadata'];
      if (isRecord(rawInfo)) info = rawInfo;
      if (isRecord(rawMetadata)) metadata = rawMetadata;
    }

    return {
      numpages,
      numrender: items.length,
      info,
      metadata,
      text,
      version: pdfjs.version,
      items
    };

  } catch (error) {
    console.error(`[PdfParseAdapter] 🔍 PDF解析失败:`, error);
    console.error(`[PdfParseAdapter] 🔍 错误详情:`, {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error)
    });
    throw new Error(`pdfjs-dist处理失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * **功能 (What):** 跨平台获取PDF页数
 * **输入 (Input / @param):** 
 * @param data - PDF二进制数据
 * **输出 (Output / @returns):** 页数
 * **副作用 (Side-effects):** 使用pdf-parse库
 */
export async function getPdfPageCountCrossPlatform(data: Uint8Array): Promise<number> {
  const pdfjs = await pdfjsPromise;
  let pdf: PDFDocumentProxy | null = null;
  try {
    const loadingTask = pdfjs.getDocument({ data });
    pdf = await loadingTask.promise;
    return pdf.numPages;
  } catch (error) {
    throw new Error(`无法获取PDF页数: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await pdf?.destroy?.().catch(() => undefined);
  }
}

/**
 * **功能 (What):** 评估PDF文本提取质量
 * **输入 (Input / @param):** 
 * @param result - pdf-parse解析结果
 * **输出 (Output / @returns):** 质量评估结果
 * **副作用 (Side-effects):** 无副作用，纯评估函数
 */
export function evaluateExtractionQuality(result: {
  text: string;
  numpages: number;
}): {
  textDensity: number;
  isGoodQuality: boolean;
  reason?: string;
} {
  // 增加对空PDF的特殊处理
  if (result.numpages === 0) {
    return {
      textDensity: 0,
      isGoodQuality: false,
      reason: 'PDF文件没有页面'
    };
  }

  const textDensity = result.text.length / result.numpages;
  
  // 如果文本密度太低，选择AI视觉识别策略
  if (textDensity < 50) {
    return {
      textDensity,
      isGoodQuality: false,
      reason: `文本密度较低 (${textDensity.toFixed(1)}字符/页)，适合使用AI视觉识别`
    };
  }

  return {
    textDensity,
    isGoodQuality: true
  };
}
