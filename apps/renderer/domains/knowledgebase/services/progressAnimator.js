// src/renderer/features/KnowledgeBase/services/progressAnimator.js
// 文件作用：提供一个独立的、可重用的进度条动画引擎。
// V35 专家方案: 重构为遵循设计原则的艺术化动画引擎

import { UPLOAD_STATUS } from '../constants';
import { makeNoise2D } from 'open-simplex-noise';

// --- 噪声函数，用于平滑随机 ---
const noise2D = makeNoise2D(Date.now());

// 全局动画管线状态
let globalAnimationFrame = null;
const activeTasks = new Map(); // 存储所有活跃的动画任务

/**
 * 全局动画循环 - 在单一帧中处理所有活跃任务
 */
function globalAnimationLoop(now) {
  if (!now) { now = performance.now(); }

  // 遍历所有活跃任务
  for (const [taskId, animationState] of activeTasks) {
    const task = animationState.task;
    
    // 检查任务是否仍然有效
    if (!task) {
      activeTasks.delete(taskId);
      continue;
    }
    
    // V48 Fix: The completion condition should not depend on the status, which causes a deadlock.
    // It should only depend on realProgress (backend signal) and displayProgress (animation progress).
    if (task.realProgress === 1.0 && task.displayProgress >= 99.9) {
        if (animationState.onComplete) {
            animationState.onComplete();
        }
        activeTasks.delete(taskId);
        continue;
    }

    if (task.status === UPLOAD_STATUS.FAILED) {
      activeTasks.delete(taskId);
      continue;
    }

      // 执行单个任务的动画逻辑
  updateTaskAnimation(now, task, animationState);
  }

  // 如果还有活跃任务，继续下一帧
  if (activeTasks.size > 0) {
    globalAnimationFrame = requestAnimationFrame(globalAnimationLoop);
  } else {
    // 没有活跃任务时停止全局循环
    globalAnimationFrame = null;
  }
}

/**
 * V35 专家方案: 核心动画更新逻辑
 */
function updateTaskAnimation(now, task, animationState) {
  const { realProgress, seed, status } = task;
  let displayProgress = task.displayProgress; 
  const { time } = animationState;
  
  const dt = (now - time.last) / 1000; // a-frame time in seconds
  if (dt < 0.001) { // 如果间隔太短，跳过此帧，防止除零或过快更新
      return;
  }
  
  time.last = now;

  // --- 1. 计算艺术化目标 (Artistic Target) ---
  let artisticTarget;

  if (task.realProgress === 1.0) { // V48 Fix: Sprint to 100 when realProgress is 1.0
    artisticTarget = 100;
  } else {
    // 动态超前量，由噪声函数生成，实现平滑随机
    const overshoot = 0.02 + 0.05 * (noise2D(seed, now / 5000) * 0.5 + 0.5); // 2-7% 随机超前
    artisticTarget = Math.min(realProgress + overshoot, 1.0) * 100;
  }

  // --- 2. Clamp (夹紧)，防倒退 ---
  artisticTarget = Math.max(artisticTarget, realProgress * 100, displayProgress);

  // --- 3. 计算步长 (Step) ---
  const diff = artisticTarget - displayProgress;
  let step = 0;

  if (diff > 0.01) {
    // 缓动追赶 (Slow-to-fast)
    let baseSpeed = 0.5 + 1.5 * seed;
    
    // 在完成状态下，加快冲刺速度
    if (task.realProgress === 1.0) { // V48 Fix: Speed up when sprinting
      baseSpeed = baseSpeed * 3;
    }
    
    step = diff * baseSpeed * dt;
    
    // 限制step最大值，防止异常跳跃
    const maxStep = 5; // 限制单次最大跳跃5%
    if (step > maxStep) {
      step = maxStep;
    }
  }
  
  // --- 4. 更新显示进度 ---
  displayProgress += step;
  task.displayProgress = Math.min(displayProgress, 100);
}


/**
 * 启动指定任务的进度条动画。
 * @param {object} task - 任务对象
 * @param {function} onComplete - 动画完成时的回调函数
 */
export function startAnimation(task, onComplete) {
  if (!task || !task.id) return;
  
  const taskId = task.id;



  // 如果任务已在运行，只更新其回调
  if (activeTasks.has(taskId)) {
    const existingState = activeTasks.get(taskId);
    
    // 检测task对象是否被替换
    if (existingState.task !== task) {
      existingState.task = task; // 更新引用
    }
    
    if (onComplete && onComplete !== existingState.onComplete) {
      existingState.onComplete = onComplete;
    }
    return;
  }
  
  // V35: 为每个任务创建完整的动画状态
  const now = performance.now();
  const animationState = {
    task: task,
    onComplete: onComplete,
    
    // --- 动画状态 & 基因 ---
    lastRealProgress: task.realProgress,
    time: {
      start: now,
      last: now,
      stalledFor: 0,
    }
  };
  
  // 添加到活跃任务列表
  activeTasks.set(taskId, animationState);
  
  // 如果全局循环没有运行，启动它
  if (!globalAnimationFrame) {
    globalAnimationFrame = requestAnimationFrame(globalAnimationLoop);
  }
}

/**
 * 停止指定任务的进度条动画。
 * @param {object} task - 任务对象
 */
export function stopAnimation(task) {
  if (!task || !task.id) return;
  
  const taskId = task.id;
  
  if (activeTasks.has(taskId)) {
    activeTasks.delete(taskId);
    
    // 如果没有活跃任务了，全局循环会在下一帧自动停止
  }
}

/**
 * 获取当前活跃任务数量（用于调试）
 */
export function getActiveTaskCount() {
  return activeTasks.size;
}

/**
 * 强制停止所有动画（用于清理）
 */
export function stopAllAnimations() {
  activeTasks.clear();
  
  if (globalAnimationFrame) {
    cancelAnimationFrame(globalAnimationFrame);
    globalAnimationFrame = null;
  }
} 