import { UPLOAD_STATUS, KB_UPLOAD_STAGES } from '../constants/index.js';

export function getStatusWeight(status) {
  const statusWeights = {
    // 终态状态（最高权重，不可逆转）
    'completed': 100,
    'duplicate': 100, 
    'failed': 100,
    [UPLOAD_STATUS.COMPLETED]: 100,
    [UPLOAD_STATUS.DUPLICATE]: 100,
    [UPLOAD_STATUS.FAILED]: 100,
    
    // 进行中状态（中等权重）
    'processing': 50,
    [UPLOAD_STATUS.PROCESSING]: 50,
    
    // 初始状态（低权重）
    'pending': 10,
    'queued': 10,
    [UPLOAD_STATUS.PENDING]: 10,
    [UPLOAD_STATUS.QUEUED]: 10
  };
  return statusWeights[status] || 0;
}

export function createMapBackendToRealProgress() {
  return function mapBackendToRealProgress(stageName, stageProgress) {
    // [修复] 如果是已完成状态，直接返回1.0 (100%)
    if (stageName === 'completed') {
      return 1.0;
    }
    
    // 🔥 重构修复：更新阶段映射，与状态机的STAGE_TO_PROGRESS_MAP保持一致
    const stageInfo = KB_UPLOAD_STAGES[stageName] || getStageInfoFromStateMachine(stageName);
    if (!stageInfo) {
      console.warn(`[进度映射] 未知的阶段: ${stageName}`);
      return 0;
    }
    
    const progressInStage = (stageProgress || 0) / 100;
    const realProgress = stageInfo.start + (stageInfo.end - stageInfo.start) * progressInStage;
    const clampedProgress = Math.min(realProgress, 1.0);
    
    return clampedProgress;
  }
}

/**
 * 功能 (What): 根据状态机定义获取阶段信息
 * 输入 (Input): 阶段名称
 * 输出 (Output): 阶段信息对象
 * 副作用 (Side-effects): 无
 */
function getStageInfoFromStateMachine(stageName) {
  const stageProgressMap = {
    'pending': { start: 0.0, end: 0.05 },     // 0-5%
    'parsing': { start: 0.05, end: 0.85 },    // 5-85% (80%占比，解析最耗时)
    'embedding': { start: 0.85, end: 0.95 },  // 85-95% (10%占比，向量化较快)
    'storing': { start: 0.95, end: 1.0 },     // 95-100% (5%占比，存储很快)
    'completed': { start: 1.0, end: 1.0 }     // 100%
  };
  
  return stageProgressMap[stageName];
}

// [重构] Watchdog功能已合并到统一的轮询管理器（polling.js）中
