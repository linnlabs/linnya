/**
 * @file apps/renderer/features/KnowledgeBase/stores/knowledgeBase/computed.js
 * 
 * @brief 知识库Store计算属性
 * 
 * @description
 * 功能 (What): 定义知识库Store的计算属性
 * 输入 (Input): 响应式状态
 * 输出 (Output): 计算属性函数
 * 副作用 (Side-effects): 无，纯计算
 */

import { computed } from 'vue'
import { UPLOAD_STATUS } from '../../constants/index.js'
import { getKnowledgeBaseById, getKbNameById, formatFileSize } from './utils.js'
import { resolveCurrentKnowledgeBaseMessage } from '../../functions/resolveCurrentKnowledgeBaseMessage'
import {
  resolveUploadTaskErrorText,
  resolveUploadTaskStatusText,
} from '../../functions/knowledgeBaseUploadPresentation'

/**
 * 功能 (What): 创建当前知识库的计算属性
 * 输入 (Input): 当前知识库ID和知识库列表
 * 输出 (Output): 当前知识库对象的计算属性
 * 副作用 (Side-effects): 无
 */
export function createCurrentKbComputed(currentKbId, knowledgeBases) {
  return computed(() => {
    if (currentKbId.value && Array.isArray(knowledgeBases.value)) {
      return knowledgeBases.value.find(kb => kb.id === currentKbId.value)
    }
    return null
  })
}

/**
 * 功能 (What): 创建上传任务列表的计算属性
 * 输入 (Input): 上传任务Map和知识库列表
 * 输出 (Output): 格式化并排序的任务列表计算属性
 * 副作用 (Side-effects): 无
 */
export function createUploadTasksComputed(uploadTasks, knowledgeBases) {
  return computed(() => {
    const tasks = Array.from(uploadTasks.values()).map(task => ({
      id: task.id,
      name: task.filename,
      size: formatFileSize(task.size),
      category: getKbNameById(
        knowledgeBases.value,
        task.kbId,
        resolveCurrentKnowledgeBaseMessage('knowledgeBase.common.unknownKnowledgeBase'),
      ),
      status: task.status,
      progress: task.displayProgress.toFixed(1),
      statusText: resolveUploadTaskStatusText(task, resolveCurrentKnowledgeBaseMessage),
      error: resolveUploadTaskErrorText(task.error, resolveCurrentKnowledgeBaseMessage),
      createdAt: parseInt(task.id.split('-')[1]) || 0,
    }));
    
    return tasks.sort((a, b) => {
      // [V170 优化] 改进状态排序逻辑，使用更精确的优先级顺序
      const getPriority = (status) => {
        // 优先级从高到低：使用统一的UPLOAD_STATUS常量，避免字符串漂移
        switch(status) {
          case UPLOAD_STATUS.PROCESSING: return 1; // 最高优先级
          case UPLOAD_STATUS.FAILED: return 2;     // 需要用户注意
          case UPLOAD_STATUS.PENDING: 
          case UPLOAD_STATUS.QUEUED: return 3;     // 等待处理
          case UPLOAD_STATUS.DUPLICATE: return 4;  // 信息性通知
          case UPLOAD_STATUS.COMPLETED: return 5;  // 最低优先级
          default: return 6;
        }
      }
      
      const priorityA = getPriority(a.status);
      const priorityB = getPriority(b.status);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB; // 按优先级排序
      }
      
      // 同优先级按创建时间倒序（新的在前）
      return b.createdAt - a.createdAt;
    })
  })
}
