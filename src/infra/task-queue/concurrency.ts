/**
 * @file src/task-queue/concurrency.ts
 * 
 * @brief 并发度计算工具
 * 
 * @description
 * 功能 (What): 基于系统资源（CPU/内存）智能计算推荐的Worker并发数
 * 输入 (Input): 无
 * 输出 (Output): 推荐并发数 (number)
 * 副作用 (Side-effects): 无
 */

import os from 'os';

/**
 * 功能 (What): 智能计算Worker并发数
 * 输入 (Input): 无
 * 输出 (Output): 推荐的并发Worker数量 (最大4)
 * 副作用 (Side-effects): 无
 */
export function calculateOptimalConcurrency(): number {
  const cpuCount = os.cpus().length;
  const memoryGB = os.totalmem() / (1024 * 1024 * 1024);

  // 基于系统资源智能计算，最大限制4线程
  const optimalCount = Math.min(
    Math.max(2, Math.floor(cpuCount / 2)), // 至少2个，最多CPU一半
    Math.floor(memoryGB / 2),              // 每2GB内存支持1个Worker
    4                                       // 最大限制4个
  );

  console.log(`[WorkerQueue] 🧠 智能计算并发数: ${optimalCount} (CPU: ${cpuCount}核, 内存: ${memoryGB.toFixed(1)}GB)`);
  return optimalCount;
} 