/**
 * @file src/parsers/pdfParser/utils/mathUtils.ts
 * 
 * **功能 (What):** PDF解析器数学工具函数
 * **输入 (Input):** 数值数组或计算参数
 * **输出 (Output):** 计算结果
 * **副作用 (Side-effects):** 无副作用，纯数学计算
 */

/**
 * **功能 (What):** 计算数组的方差
 * **输入 (Input / @param):** 
 * @param values - 数值数组
 * **输出 (Output / @returns):** 方差值
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 */
export function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  
  return variance;
}

/**
 * **功能 (What):** 计算数组的标准差
 * **输入 (Input / @param):** 
 * @param values - 数值数组
 * **输出 (Output / @returns):** 标准差值
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 */
export function calculateStandardDeviation(values: number[]): number {
  return Math.sqrt(calculateVariance(values));
}

/**
 * **功能 (What):** 计算数组的平均值
 * **输入 (Input / @param):** 
 * @param values - 数值数组
 * **输出 (Output / @returns):** 平均值
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 */
export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * **功能 (What):** 找到数组中的最小值和最大值
 * **输入 (Input / @param):** 
 * @param values - 数值数组
 * **输出 (Output / @returns):** 包含最小值和最大值的对象
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 */
export function findMinMax(values: number[]): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }
  
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
} 