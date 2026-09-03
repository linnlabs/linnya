/**
 * @file src/parsers/pdfParser/adapters/PdfjsAdapter.ts
 * 
 * **功能 (What):** pdfjs-dist库适配器，提供详细的PDF文本和布局分析
 * **输入 (Input):** PDF二进制数据
 * **输出 (Output):** 详细的文本内容和坐标信息
 * **副作用 (Side-effects):** 使用pdfjs-dist库处理PDF
 */

import { TextItem } from '../types';

// 🔥 修复：全局缓存pdfjs实例，避免重复加载
let cachedPdfJs: any = null;

/**
 * 安全地加载PDF.js库
 * @returns PDF.js库实例
 */
function getPdfJs() {
  if (cachedPdfJs) {
    return cachedPdfJs;
  }
  
  try {
    // 尝试加载legacy版本
    cachedPdfJs = require('pdfjs-dist/legacy/build/pdf');
  } catch (legacyError) {
    try {
      // 尝试加载标准版本
      cachedPdfJs = require('pdfjs-dist');
      console.warn('使用标准版pdfjs-dist，某些功能可能不可用');
    } catch (standardError) {
      console.error('无法加载pdfjs-dist库，PDF功能将不可用:', standardError);
      // 创建一个最小化的模拟对象，防止代码崩溃
      cachedPdfJs = {
        getDocument: () => {
          throw new Error('PDF处理库未正确加载');
        },
        version: 'not-loaded'
      };
    }
  }
  
  // 配置worker
  if (typeof window === 'undefined' && cachedPdfJs.GlobalWorkerOptions) {
    try {
      cachedPdfJs.GlobalWorkerOptions.workerSrc = '';
      if (cachedPdfJs.disableWorker !== undefined) {
        cachedPdfJs.disableWorker = true;
      }
    } catch (workerError) {
      console.warn('配置PDF.js worker失败，但将继续尝试处理:', workerError);
    }
  }
  
  return cachedPdfJs;
}

/**
 * **功能 (What):** 加载PDF文档
 * **输入 (Input / @param):** 
 * @param data - PDF文件二进制数据
 * **输出 (Output / @returns):** PDF文档对象
 * **副作用 (Side-effects):** 初始化pdfjs-dist，设置Worker配置
 */
export async function loadPdfDocument(data: Uint8Array): Promise<any> {
  try {
    const pdfjs = getPdfJs();
    
    // 加载PDF文档
    const loadingTask = pdfjs.getDocument(data);
    return await loadingTask.promise;
    
  } catch (error) {
    console.error('[PdfjsAdapter] ❌ pdfjs-dist处理失败:', error instanceof Error ? error.message : String(error));
    throw new Error(`pdfjs-dist处理失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * **功能 (What):** 从PDF页面提取文本内容和坐标信息
 * **输入 (Input / @param):** 
 * @param page - PDF页面对象
 * @param options - 提取选项
 * **输出 (Output / @returns):** 文本项目数组
 * **副作用 (Side-effects):** 调用pdfjs-dist API
 */
export async function extractTextItemsFromPage(
  page: any,
  options: {
    normalizeWhitespace?: boolean;
    disableCombineTextItems?: boolean;
  } = {}
): Promise<TextItem[]> {
  const textContent = await page.getTextContent({
    normalizeWhitespace: options.normalizeWhitespace ?? true,
    disableCombineTextItems: options.disableCombineTextItems ?? false
  });

  return textContent.items as TextItem[];
}

/**
 * **功能 (What):** 检查页面是否有结构树
 * **输入 (Input / @param):** 
 * @param page - PDF页面对象
 * **输出 (Output / @returns):** 结构树对象或null
 * **副作用 (Side-effects):** 调用pdfjs-dist API
 */
export async function getPageStructTree(page: any): Promise<any | null> {
  try {
    return await page.getStructTree();
  } catch (error) {
    console.warn('[PdfjsAdapter] 获取结构树失败:', error);
    return null;
  }
}

/**
 * **功能 (What):** 获取页面的操作列表（用于检测图像）
 * **输入 (Input / @param):** 
 * @param page - PDF页面对象
 * **输出 (Output / @returns):** 操作列表
 * **副作用 (Side-effects):** 调用pdfjs-dist API
 */
export async function getPageOperatorList(page: any): Promise<any> {
  try {
    return await page.getOperatorList();
  } catch (error) {
    console.warn('[PdfjsAdapter] 获取操作列表失败:', error);
    return { argsArray: [] };
  }
}

/**
 * **功能 (What):** 获取页面视图信息
 * **输入 (Input / @param):** 
 * @param page - PDF页面对象
 * **输出 (Output / @returns):** 页面视图信息
 * **副作用 (Side-effects):** 无副作用，读取页面属性
 */
export function getPageView(page: any): {
  width: number;
  height: number;
  area: number;
} {
  const view = page.view || [0, 0, 612, 792]; // 默认A4尺寸
  return {
    width: view[2] - view[0],
    height: view[3] - view[1],
    area: (view[2] - view[0]) * (view[3] - view[1])
  };
}

/**
 * **功能 (What):** 处理完整的PDF文档
 * **输入 (Input / @param):** 
 * @param data - PDF文件的二进制数据
 * @param pageProcessor - 页面处理函数
 * **输出 (Output / @returns):** 处理结果数组
 * **副作用 (Side-effects):** 逐页处理PDF文档
 */
export async function processPdfDocument<T>(
  data: Uint8Array,
  pageProcessor: (page: any, pageNum: number, totalPages: number) => Promise<T>
): Promise<T[]> {
  const pdf = await loadPdfDocument(data);
  const results: T[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const result = await pageProcessor(page, pageNum, pdf.numPages);
    results.push(result);
  }

  return results;
} 