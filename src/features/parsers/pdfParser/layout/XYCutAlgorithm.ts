/**
 * @file src/parsers/pdfParser/layout/XYCutAlgorithm.ts
 *
 * **功能 (What):** XY-Cut算法实现，用于多栏PDF布局的文本重排序
 * **输入 (Input):** PDF页面对象和文本项目
 * **输出 (Output):** 按正确阅读顺序排列的文本
 * **副作用 (Side-effects):** 无副作用，纯算法计算
 */

import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

import { extractTextItemsFromPage } from '../adapters/PdfjsAdapter';
import type { TextItem } from '../types';
import { findXCoordinatePeaks } from './PeakDetector';

/**
 * **功能 (What):** 使用XY-Cut算法提取文本
 * **输入 (Input / @param):**
 * @param page - PDF页面对象
 * @param columnCount - 预期栏数
 * **输出 (Output / @returns):** 提取的文本
 * **副作用 (Side-effects):** 无副作用，纯提取函数
 */
export async function extractTextWithXYCut(page: PDFPageProxy): Promise<string> {
  const items = await extractTextItemsFromPage(page);

  // 1. 按x坐标分栏
  const xPeaks = findXCoordinatePeaks(items);
  const columns: TextItem[][] = Array(xPeaks.length)
    .fill(null)
    .map(() => []);

  items.forEach(item => {
    const x = item.transform[4];

    // 找到最近的栏
    let nearestColumn = 0;
    let minDistance = Math.abs(x - xPeaks[0]);

    for (let i = 1; i < xPeaks.length; i++) {
      const distance = Math.abs(x - xPeaks[i]);
      if (distance < minDistance) {
        minDistance = distance;
        nearestColumn = i;
      }
    }

    columns[nearestColumn].push(item);
  });

  // 2. 在每栏内按y坐标排序
  const sortedColumns = columns.map(
    column => column.sort((a, b) => b.transform[5] - a.transform[5]) // y坐标降序
  );

  // 3. 按从左到右的顺序连接各栏
  return sortedColumns.map(column => column.map(item => item.str).join(' ')).join('\n\n');
}

/**
 * **功能 (What):** 直接提取文本（简单排序）
 * **输入 (Input / @param):**
 * @param page - PDF页面对象
 * **输出 (Output / @returns):** 提取的文本
 * **副作用 (Side-effects):** 无副作用，纯提取函数
 */
export async function extractTextDirect(page: PDFPageProxy): Promise<string> {
  const items = await extractTextItemsFromPage(page);

  // 简单的y降序、x升序排序
  const sortedItems = [...items].sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5]; // y坐标降序
    if (Math.abs(yDiff) > 5) return yDiff; // 不同行
    return a.transform[4] - b.transform[4]; // 同行内x坐标升序
  });

  return sortedItems.map(item => item.str).join(' ');
}

/**
 * **功能 (What):** 按栏分组文本项目
 * **输入 (Input / @param):**
 * @param items - 文本项目数组
 * @param xPeaks - x坐标峰值
 * **输出 (Output / @returns):** 按栏分组的文本项目
 * **副作用 (Side-effects):** 无副作用，纯分组函数
 */
export function groupItemsByColumns(items: TextItem[], xPeaks: number[]): TextItem[][] {
  const columns: TextItem[][] = Array(xPeaks.length)
    .fill(null)
    .map(() => []);

  items.forEach(item => {
    const x = item.transform[4];

    // 找到最近的栏
    let nearestColumn = 0;
    let minDistance = Math.abs(x - xPeaks[0]);

    for (let i = 1; i < xPeaks.length; i++) {
      const distance = Math.abs(x - xPeaks[i]);
      if (distance < minDistance) {
        minDistance = distance;
        nearestColumn = i;
      }
    }

    columns[nearestColumn].push(item);
  });

  return columns;
}

/**
 * **功能 (What):** 在栏内按阅读顺序排序文本
 * **输入 (Input / @param):**
 * @param items - 单栏内的文本项目
 * **输出 (Output / @returns):** 排序后的文本项目
 * **副作用 (Side-effects):** 无副作用，纯排序函数
 */
export function sortItemsWithinColumn(items: TextItem[]): TextItem[] {
  return [...items].sort((a, b) => {
    // 首先按y坐标降序（从上到下）
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > 2) return yDiff; // 不同行，2像素容差

    // 同一行内按x坐标升序（从左到右）
    return a.transform[4] - b.transform[4];
  });
}

/**
 * **功能 (What):** 将分栏文本合并为最终结果
 * **输入 (Input / @param):**
 * @param columns - 各栏的文本项目数组
 * @param separateColumns - 是否用段落分隔符分离各栏
 * **输出 (Output / @returns):** 合并后的文本
 * **副作用 (Side-effects):** 无副作用，纯文本处理
 */
export function mergeColumnsToText(columns: TextItem[][], separateColumns: boolean = true): string {
  const columnTexts = columns.map(column => {
    const sortedItems = sortItemsWithinColumn(column);
    return sortedItems.map(item => item.str).join(' ');
  });

  return separateColumns ? columnTexts.join('\n\n') : columnTexts.join(' ');
}
