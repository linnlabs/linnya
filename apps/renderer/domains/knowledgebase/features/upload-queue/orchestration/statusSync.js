/**
 * @file apps/renderer/domains/knowledgebase/features/upload-queue/orchestration/statusSync.js
 * 
 * @brief 任务状态同步与进度管理
 * 
 * @description
 * 功能 (What): 处理任务状态更新、首帧拉取、缓存回放、Watchdog自愈等核心逻辑
 * 输入 (Input): 状态更新数据、任务上下文
 * 输出 (Output): 状态同步函数
 * 副作用 (Side-effects): 更新任务状态，启动动画，调度队列
 */

import { knowledgeBaseService } from '../../../services/knowledgeBaseService.js'
import { startAnimation, stopAnimation } from '../../../services/progressAnimator.js'
import { UPLOAD_STATUS } from '../../../constants/index.js'
import { getStatusWeight } from '../../../functions/uploadTaskProgress';
import { createKnowledgeBaseUploadMessage } from '../../../functions/knowledgeBaseUploadPresentation'

/**
 * 功能 (What): 立即拉取任务的初始状态（首帧保障）
 * 输入 (Input): 状态引用和更新函数
 * 输出 (Output): 首帧拉取函数
 * 副作用 (Side-effects): 如果后端已有进度，立即更新到前端
 */
export function createFetchInitialTaskStatus(updateTaskState) {
  return async function fetchInitialTaskStatus(taskId, documentId) {
    try {
      console.log(`[首帧拉取] 开始拉取初始状态: taskId=${taskId}, docId=${documentId}`);
      const statuses = await knowledgeBaseService.getTasksStatus([documentId]);
      const statusInfo = statuses[documentId];
      if (statusInfo) {
        console.log('[首帧拉取] 获取到后端状态:', statusInfo);
        updateTaskState(taskId, statusInfo);
      } else {
        console.log('[首帧拉取] 后端尚无状态数据，等待IPC推送');
      }
    } catch (e) {
      console.warn('[首帧拉取] 拉取任务状态失败:', e?.message || e);
    }
  }
}

/**
 * 功能 (What): 回放缓存中的未知 docId 状态更新
 * 输入 (Input): 状态引用和更新函数
 * 输出 (Output): 缓存回放函数
 * 副作用 (Side-effects): 应用缓存的状态更新并清理缓存
 */
export function createReplayPendingUpdates(state, pendingUpdatesByDocId, updateTaskState) {
  return function replayPendingUpdates(taskId, documentId) {
    if (pendingUpdatesByDocId.has(documentId)) {
      const buffered = pendingUpdatesByDocId.get(documentId);
      console.log('[回放缓存] 应用缓存状态:', buffered);
      
      // 构造标准化的状态更新对象
      const standardizedUpdate = {
        status: buffered.status,
        message: buffered.message,
        progress: buffered.progress,
        error: buffered.error,
        stage: buffered.stage,
        stage_progress: buffered.stage_progress,
        timestamp: buffered.timestamp
      };
      
      updateTaskState(taskId, standardizedUpdate);
      state.removePendingDocumentUpdate(documentId);
    }
  }
}

/**
 * 功能 (What): 统一的任务状态更新函数
 * 输入 (Input): 状态引用和相关函数
 * 输出 (Output): 状态更新函数
 * 副作用 (Side-effects): 更新任务状态，处理动画，调度队列
 */
export function createUpdateTaskState(state, scheduleNext, fetchDocuments, mapBackendToRealProgress) {
  return function updateTaskState(taskId, updates) {
    const task = state.uploadTasks.get(taskId);
    if (!task) {
      console.warn(`[KnowledgeBase Store] 尝试更新不存在的任务: ${taskId}`);
      return;
    }

    // [状态权重机制] 替代纯时间戳比较，解决状态乱序问题
    // 🔧 关键修复：引入状态权重，优先级高的状态不会被权重低的状态覆盖

    const currentWeight = getStatusWeight(task.status);
    const incomingWeight = getStatusWeight(updates.status);
    
    // 1. 绝对不允许状态降级（高权重状态不能被权重低的状态覆盖）
    if (incomingWeight < currentWeight) {
      console.log(`[状态权重] 拒绝状态降级: ${task.status}(权重${currentWeight}) ← ${updates.status}(权重${incomingWeight})`);
      return;
    }

    // 2. 同权重状态才比较时间戳
    let incomingTs = (updates.updated_at ?? updates.timestamp ?? 0);
    // 🔧 归一化时间戳为毫秒
    if (typeof incomingTs === 'string') {
      const parsed = Date.parse(incomingTs);
      incomingTs = isNaN(parsed) ? 0 : parsed;
    } else if (typeof incomingTs === 'number' && incomingTs < 1e12) {
      incomingTs = Math.floor(incomingTs * 1000);
    }

    if (incomingWeight === currentWeight && task._lastUpdateTs && incomingTs <= task._lastUpdateTs) {
      console.log(`[时间戳去重] 丢弃同权重过期状态: task=${task.id}, incomingTs=${incomingTs}, lastTs=${task._lastUpdateTs}`);
      return;
    }

    // 3. 权重升级或同权重但时间更新，允许状态更新
    console.log(`[状态更新] 接受状态变更: ${task.status}(${currentWeight}) → ${updates.status}(${incomingWeight})`);
    

    // 如果任务已经完成或是重复文件，忽略后续的中间状态更新
    if (task.status === UPLOAD_STATUS.COMPLETED || task.status === UPLOAD_STATUS.DUPLICATE) {
      // [V172 修复] 即使任务已完成，但如果它仍在活动池中，也需要将其移除并调度下一个任务。
      // 这种情况可能发生在：任务快速完成，但完成信号和移除操作之间存在延迟。
      if (state.activeUploads.has(taskId)) {
          state.removeActiveUpload(taskId);
          scheduleNext();
      }
      return;
    }
    
    // 处理终止状态：完成、重复文件、失败
    if (updates.status === UPLOAD_STATUS.COMPLETED || 
        updates.status === UPLOAD_STATUS.DUPLICATE || 
        updates.status === UPLOAD_STATUS.FAILED ||
        // 🔥 修复：支持字符串格式的终态状态
        updates.status === 'completed' ||
        updates.status === 'duplicate' ||
        updates.status === 'failed') {
      
      // [REFACTOR] 直接使用后端传递的消息，不再依赖前端的 UPLOAD_STATUS_MAP
      const message = updates.message;
      
      if (updates.status === UPLOAD_STATUS.COMPLETED || updates.status === 'completed') {
        // [关键修复] 立即从活动池中移除任务并调度下一个，不再依赖动画回调
        // 这确保了即使动画因为任何原因未完成，队列调度也不会被阻塞
        if (state.activeUploads.has(taskId)) {
          state.removeActiveUpload(taskId);
          scheduleNext();
        }
        
        state.patchUploadTask(task, { realProgress: 1.0 }) // 设置真实进度为1.0以启动冲刺动画
        
        console.log(`[动画启动] 任务 ${task.id} (${task.filename}) 开始完成动画`);
        startAnimation(task, () => {
          // 动画完成后执行此回调，仅处理UI相关的收尾工作
          console.log(`[动画回调] 任务 ${task.id} (${task.filename}) 动画完成`);
          state.patchUploadTask(task, { status: UPLOAD_STATUS.COMPLETED })
          state.patchUploadTask(task, { message: message })
          state.patchUploadTask(task, { displayProgress: 100 })
          
          // [移除] 不再在动画回调中处理队列调度
          // if (activeUploads.has(taskId)) {
          //   activeUploads.delete(taskId);
          //   _scheduleNext();
          // }
        }, state.patchUploadTask);
      } else if (updates.status === UPLOAD_STATUS.DUPLICATE || updates.status === 'duplicate') {
        // [V170 修复] 特殊处理重复文件状态
        state.patchUploadTask(task, { ...updates,
          status: UPLOAD_STATUS.DUPLICATE,
          message: message, // 直接使用后端消息
          displayProgress: 100, // 重复文件显示为100%进度
          realProgress: 1.0
        });
        stopAnimation(task);
        
        if (state.activeUploads.has(taskId)) {
          state.removeActiveUpload(taskId);
          scheduleNext();
        }
        
        // [V170 修复] 重复文件也需要刷新文档列表，确保UI及时更新
        fetchDocuments(task.kbId);
      } else {
        // 处理失败状态 (包括字符串格式的 'failed')
        state.patchUploadTask(task, { ...updates, 
          status: updates.status === 'failed' ? UPLOAD_STATUS.FAILED : updates.status, 
          message: message // 直接使用后端消息
        });
        stopAnimation(task);
        
        if (state.activeUploads.has(taskId)) {
          state.removeActiveUpload(taskId);
          scheduleNext();
        }
      }
      // 记录最后更新时间戳（对可能缺失时间戳的情况进行兜底提升）
      state.patchUploadTask(task, { _lastUpdateTs: Math.max(task._lastUpdateTs || 0, incomingTs) })
      return;
    }

    // 如果是进行中的阶段更新
    if (updates.stage && 
        task.status !== UPLOAD_STATUS.COMPLETED && task.status !== UPLOAD_STATUS.FAILED && 
        task.status !== 'completed' && task.status !== 'failed') {
      // 🔧 兼容五态：当 stage 不在已知内部阶段或为 'processing' 时，直接使用 progress 百分比
      const knownStages = ['pending', 'parsing', 'embedding', 'storing', 'completed', 'failed', 'duplicate'];
      const useDirectProgress = (!knownStages.includes(updates.stage) || updates.stage === 'processing');
      const newRealProgress = useDirectProgress
        ? (typeof updates.progress === 'number' ? Math.min(updates.progress / 100, 1) : (task.realProgress || 0))
        : mapBackendToRealProgress(updates.stage, updates.stage_progress);
      
      state.patchUploadTask(task, { status: UPLOAD_STATUS.PROCESSING })
      state.patchUploadTask(task, { stage: updates.stage })
      state.patchUploadTask(task, { stage_progress: updates.stage_progress })
      state.patchUploadTask(task, { message: updates.message || createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.parsing') })
      state.patchUploadTask(task, { error: updates.error })
      state.patchUploadTask(task, { realProgress: newRealProgress })
      startAnimation(task, undefined, state.patchUploadTask);
      state.patchUploadTask(task, { _lastUpdateTs: Math.max(task._lastUpdateTs || 0, incomingTs) })
    } else if (updates.status === UPLOAD_STATUS.PROCESSING && !updates.stage) {
      // 处理上传中状态（没有阶段信息的处理状态）
      state.patchUploadTask(task, { status: UPLOAD_STATUS.PROCESSING })
      state.patchUploadTask(task, { message: updates.message || createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.parsing') })
      state.patchUploadTask(task, { _lastUpdateTs: Math.max(task._lastUpdateTs || 0, incomingTs) })
    }
  }
}

/**
 * 功能 (What): 将后端的 [stage, stage_progress] 映射到 0-1 范围的真实进度
 * 输入 (Input): 阶段名称和阶段内进度
 * 输出 (Output): 映射函数
 * 副作用 (Side-effects): 无，纯计算函数
 */
