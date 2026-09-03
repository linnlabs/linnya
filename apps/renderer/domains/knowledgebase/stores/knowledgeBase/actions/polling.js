/**
 * @file apps/renderer/features/KnowledgeBase/stores/knowledgeBase/actions/polling.js
 * 
 * @brief 统一的轮询管理器
 * 
 * @description
 * 功能 (What): 整合原有的GlobalPolling和Watchdog机制，提供统一的状态轮询服务
 * 输入 (Input): 状态引用、更新函数、配置参数
 * 输出 (Output): 轮询管理函数
 * 副作用 (Side-effects): 定期轮询任务状态，自动管理轮询生命周期
 * 
 * 设计理念：
 * 1. 统一轮询：合并GlobalPolling和Watchdog，避免重复轮询
 * 2. 智能调频：根据IPC可用性自动调整轮询频率
 * 3. 自愈机制：检测超时任务并主动校准
 * 4. 生命周期管理：与Store绑定，不受组件影响
 */

import { knowledgeBaseService } from '../../../services/knowledgeBaseService.js'
import { UPLOAD_STATUS } from '../../../constants/index.js'

/**
 * 功能 (What): 创建统一的轮询管理器
 * 输入 (Input): 状态引用和更新函数
 * 输出 (Output): 轮询管理器对象
 * 副作用 (Side-effects): 管理轮询定时器，自动调频
 */
export function createPollingManager(state, updateTaskState) {
  let pollingIntervalId = null
  let isPollingActive = false
  let currentMode = null // 'fallback' | 'calibration'
  
  // 轮询模式配置
  const POLLING_MODES = {
    fallback: {
      interval: 2000,    // 2秒 - IPC不可用时的兜底轮询
      description: '兜底轮询',
      checkTimeout: false // 检查所有processing任务
    },
    calibration: {
      interval: 3000,    // 3秒 - IPC可用时的校准轮询  
      description: '校准轮询',
      checkTimeout: true  // 只检查超时任务
    }
  }

  /**
   * 功能 (What): 执行轮询逻辑
   * 输入 (Input): 轮询模式配置
   * 输出 (Output): 无
   * 副作用 (Side-effects): 拉取并更新任务状态
   */
  async function performPolling(mode) {
    try {
      let tasksToPoll = Array.from(state.uploadTasks.values())
        .filter(task => task.status === UPLOAD_STATUS.PROCESSING && task.docId)

      // 根据模式筛选任务
      if (mode.checkTimeout) {
        // 校准模式：只检查超时任务
        const now = Date.now()
        tasksToPoll = tasksToPoll.filter(task => {
          const lastUpdate = task._lastUpdateTs || 0
          return now - lastUpdate > 3000 // 3秒未更新视为超时
        })
      }

      if (tasksToPoll.length === 0) {
        console.log(`[${mode.description}] 没有需要轮询的任务，停止轮询`)
        stopPolling()
        return
      }

      // 去重docId，避免重复请求
      const uniqueDocIds = [...new Set(tasksToPoll.map(task => task.docId))]
      
      console.log(`[${mode.description}] 轮询 ${uniqueDocIds.length} 个任务状态`)
      
      const statuses = await knowledgeBaseService.getTasksStatus(uniqueDocIds)
      
      console.log(`[${mode.description}] 获取到 ${Object.keys(statuses).length} 个任务状态:`, 
        Object.entries(statuses).map(([docId, status]) => 
          `${docId}: ${status.status} (${status.progress}%)`
        ).join(', ')
      )
      
      let allTasksCompleted = true
      let allTasksDisplayComplete = true
      
      // 更新所有相关任务的状态
      for (const docId in statuses) {
        const statusInfo = statuses[docId]
        const relatedTasks = Array.from(state.uploadTasks.values())
          .filter(task => task.docId === docId)
        
        for (const task of relatedTasks) {
          updateTaskState(task.id, statusInfo)
          
          // 检查是否所有任务都已完成
          if (statusInfo.status !== "completed" && 
              statusInfo.status !== "duplicate" && 
              statusInfo.status !== "failed") {
            allTasksCompleted = false
          }
          
          // 检查前端显示进度
          if (task.displayProgress < 99.9) {
            allTasksDisplayComplete = false
          }
        }
      }
      
      // 如果所有任务都完成了，停止轮询
      if (allTasksCompleted && allTasksDisplayComplete) {
        console.log(`[${mode.description}] 所有任务已完成，停止轮询`)
        stopPolling()
      }
      
    } catch (error) {
      console.error(`[${mode.description}] 轮询任务状态失败:`, error)
    }
  }

  /**
   * 功能 (What): 启动轮询（根据模式自动选择频率）
   * 输入 (Input): 是否为兜底模式
   * 输出 (Output): 无
   * 副作用 (Side-effects): 启动定时器，开始轮询
   */
  function startPolling(isFallbackMode = false) {
    // 防止重复启动
    if (isPollingActive) {
      console.log('[轮询管理器] 轮询已在运行中，跳过重复启动')
      return
    }

    const mode = isFallbackMode ? POLLING_MODES.fallback : POLLING_MODES.calibration
    currentMode = isFallbackMode ? 'fallback' : 'calibration'
    
    console.log(`[轮询管理器] 🚀 启动${mode.description}（间隔: ${mode.interval}ms）`)
    
    isPollingActive = true
    pollingIntervalId = setInterval(() => {
      performPolling(mode)
    }, mode.interval)
  }

  /**
   * 功能 (What): 停止轮询
   * 输入 (Input): 无
   * 输出 (Output): 无  
   * 副作用 (Side-effects): 清理定时器，停止轮询
   */
  function stopPolling() {
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId)
      pollingIntervalId = null
      isPollingActive = false
      console.log(`[轮询管理器] 🛑 ${currentMode === 'fallback' ? '兜底轮询' : '校准轮询'}已停止`)
      currentMode = null
    }
  }

  /**
   * 功能 (What): 切换轮询模式
   * 输入 (Input): 是否为兜底模式
   * 输出 (Output): 无
   * 副作用 (Side-effects): 停止当前轮询，以新模式重启
   */
  function switchMode(isFallbackMode) {
    const newMode = isFallbackMode ? 'fallback' : 'calibration'
    if (currentMode === newMode) {
      return // 模式相同，无需切换
    }
    
    console.log(`[轮询管理器] 🔄 切换模式: ${currentMode || 'none'} → ${newMode}`)
    stopPolling()
    startPolling(isFallbackMode)
  }

  /**
   * 功能 (What): 获取轮询状态信息
   * 输入 (Input): 无
   * 输出 (Output): 轮询状态对象
   * 副作用 (Side-effects): 无
   */
  function getStatus() {
    return {
      isActive: isPollingActive,
      mode: currentMode,
      interval: currentMode ? POLLING_MODES[currentMode].interval : null
    }
  }

  return {
    startPolling,
    stopPolling,
    switchMode,
    getStatus
  }
} 