/**
 * @file apps/renderer/features/KnowledgeBase/stores/knowledgeBase/actions/ipcBridge.js
 * 
 * @brief IPC桥接与监听管理
 * 
 * @description
 * 功能 (What): 管理IPC监听器的设置、清理和测试
 * 输入 (Input): 状态引用和回调函数
 * 输出 (Output): IPC管理函数
 * 副作用 (Side-effects): 设置/清理IPC监听器，启动/停止轮询和Watchdog
 */

/**
 * 功能 (What): 初始化IPC监听器，接收实时状态推送
 * 输入 (Input): 状态引用、更新函数和控制函数
 * 输出 (Output): IPC监听器设置函数
 * 副作用 (Side-effects): 设置IPC监听器，替代轮询机制
 */
export function createSetupIpcStatusListener(state, updateTaskState, pendingUpdatesByDocId, fetchDocuments, setupPollingFallback, setupCalibrationPolling) {
  return function setupIpcStatusListener() {
    // 检查任务状态更新监听器是否可用
    const hasTaskStatusUpdate = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onTaskStatusUpdate;
    
    if (typeof window !== 'undefined' && hasTaskStatusUpdate) {
      const handleStatusUpdate = (event, statusUpdate) => {
        // 🔥 优先使用 taskId 精确匹配
        const hasTaskId = !!statusUpdate.taskId;
        let matchedTasks = [];
        if (hasTaskId) {
          const t = state.uploadTasks.get(statusUpdate.taskId);
          if (t) matchedTasks = [t];
        }
        
        // 若 taskId 未命中，再用 docId 做兜底匹配
        if (matchedTasks.length === 0 && statusUpdate.docId) {
          const allTasks = Array.from(state.uploadTasks.values());
          matchedTasks = allTasks.filter(task => task.docId === statusUpdate.docId);
        }
        
        // 若仍未命中，则缓存在内存，待任务绑定后回放
        if (matchedTasks.length === 0) {
          if (hasTaskId && state.pendingUpdatesByTaskId) {
            console.warn('[IPC状态更新] ⚠️ 未找到匹配任务，按 taskId 缓存等待回放:', statusUpdate.taskId);
            state.pendingUpdatesByTaskId.set(statusUpdate.taskId, statusUpdate);
          } else if (statusUpdate.docId) {
            console.warn('[IPC状态更新] ⚠️ 未找到匹配任务，按 docId 缓存等待回放:', statusUpdate.docId);
            pendingUpdatesByDocId.set(statusUpdate.docId, statusUpdate);
          } else {
            console.warn('[IPC状态更新] ⚠️ 无法缓存（缺少 taskId 与 docId）:', statusUpdate);
          }
          return;
        }
        
        // 🔥 统一处理标准化的状态格式
        for (const task of matchedTasks) {
          const standardizedUpdate = {
            status: statusUpdate.status,
            message: statusUpdate.message,
            progress: statusUpdate.progress,
            error: statusUpdate.error,
            // 阶段信息
            stage: statusUpdate.stage,
            stage_progress: statusUpdate.stage_progress,
            // 时间戳
            updated_at: statusUpdate.updated_at,
            timestamp: statusUpdate.timestamp
          };
          updateTaskState(task.id, standardizedUpdate);
        }
        
        // 如果任务完成，刷新文档列表
        if (statusUpdate.status === 'completed' || statusUpdate.status === 'duplicate') {
          const targetKbId = statusUpdate.kbId || state.currentKbId.value;
          console.log(`[IPC状态更新] 📋 任务完成，刷新文档列表: kbId=${targetKbId}, status=${statusUpdate.status}`);
          fetchDocuments(targetKbId);
        }
      };
      
      try {
        // 使用专门的任务状态更新API
        const cleanup = window.electronAPI.onTaskStatusUpdate((statusUpdate) => {
          // 注意：这里不需要 event 参数，因为 preload 已经处理了
          handleStatusUpdate(null, statusUpdate);
        });

        state.ipcCleanup = () => {
          cleanup();
        };

        // [重构] 启动校准轮询（即使 IPC 可用，也做低频校准）
        setupCalibrationPolling();
        
      } catch (error) {
        console.error('[KnowledgeBase Store] ❌ 设置IPC监听器失败:', error);
        setupPollingFallback();
      }
    } else {
      console.warn('[KnowledgeBase Store] ❌ 任务状态更新API不可用，将保留轮询作为兜底');
      console.warn('[KnowledgeBase Store] IPC不可用详情:', {
        hasWindow: typeof window !== 'undefined',
        hasElectronAPI: typeof window !== 'undefined' && !!window.electronAPI,
        hasTaskStatusUpdate: typeof window !== 'undefined' && window.electronAPI && !!window.electronAPI.onTaskStatusUpdate,
        allKeys: typeof window !== 'undefined' && window.electronAPI ? Object.keys(window.electronAPI) : 'N/A'
      });
      // 如果IPC不可用，保留轮询作为兜底
      setupPollingFallback();
    }
  }
}
