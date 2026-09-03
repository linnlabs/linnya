/**
 * @file src/parsers/pdfParser/layout/PeakDetector.ts
 * 
 * **功能 (What):** x坐标峰值检测器，用于识别PDF多栏布局
 * **输入 (Input):** 文本项目数组
 * **输出 (Output):** x坐标峰值数组
 * **副作用 (Side-effects):** 无副作用，纯算法计算
 */

import { TextItem } from '../types';

/**
 * **功能 (What):** 查找x坐标分布的峰值（栏边界检测）
 * **输入 (Input / @param):** 
 * @param items - 文本项目数组
 * @param binSize - 直方图分箱大小（像素）
 * **输出 (Output / @returns):** x坐标峰值数组
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 */
export function findXCoordinatePeaks(
  items: TextItem[], 
  binSize: number = 10
): number[] {
  if (!items || items.length === 0) {
    return [];
  }

  // 构建x坐标直方图
  const xCoords = items.map(item => item.transform[4]); // x坐标
  const histogram: { [key: number]: number } = {};
  
  // 将x坐标量化到指定精度
  xCoords.forEach(x => {
    const bin = Math.round(x / binSize) * binSize;
    histogram[bin] = (histogram[bin] || 0) + 1;
  });

  // 找出显著峰值
  const bins = Object.keys(histogram).map(Number).sort((a, b) => a - b);
  const peaks: number[] = [];
  const threshold = Math.max(3, items.length * 0.05); // 至少3个文本项，或5%的文本项

  for (let i = 1; i < bins.length - 1; i++) {
    const current = histogram[bins[i]];
    const left = histogram[bins[i - 1]] || 0;
    const right = histogram[bins[i + 1]] || 0;

    // 是局部最大值且超过阈值
    if (current > left && current > right && current >= threshold) {
      peaks.push(bins[i]);
    }
  }

  // 如果没有找到峰值，默认为单栏
  return peaks.length > 0 ? peaks : [Math.min(...xCoords)];
}

/**
 * **功能 (What):** 检查是否为规则的栏布局
 * **输入 (Input / @param):** 
 * @param items - 文本项目数组
 * @param xPeaks - x坐标峰值
 * **输出 (Output / @returns):** 是否为规则布局
 * **副作用 (Side-effects):** 无副作用，纯判断函数
 */
export function isRegularColumnLayout(items: TextItem[], xPeaks: number[]): boolean {
  if (xPeaks.length <= 1) return true;

  // 检查栏间距是否相对均匀
  const gaps: number[] = [];
  for (let i = 1; i < xPeaks.length; i++) {
    gaps.push(xPeaks[i] - xPeaks[i - 1]);
  }

  if (gaps.length === 0) return true;

  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const gapVariance = gaps.reduce((sum, gap) => sum + Math.pow(gap - avgGap, 2), 0) / gaps.length;
  const gapStdDev = Math.sqrt(gapVariance);

  // 如果标准差小于平均值的30%，认为是规则布局
  return gapStdDev < avgGap * 0.3;
}

/**
 * **功能 (What):** 计算x坐标分布的统计信息
 * **输入 (Input / @param):** 
 * @param items - 文本项目数组
 * **输出 (Output / @returns):** 统计信息对象
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 */
export function calculateXCoordinateStats(items: TextItem[]): {
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  range: number;
} {
  if (!items || items.length === 0) {
    return { min: 0, max: 0, mean: 0, stdDev: 0, range: 0 };
  }

  const xCoords = items.map(item => item.transform[4]);
  const min = Math.min(...xCoords);
  const max = Math.max(...xCoords);
  const mean = xCoords.reduce((sum, x) => sum + x, 0) / xCoords.length;
  
  const variance = xCoords.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / xCoords.length;
  const stdDev = Math.sqrt(variance);
  
  return {
    min,
    max,
    mean,
    stdDev,
    range: max - min
  };
} 