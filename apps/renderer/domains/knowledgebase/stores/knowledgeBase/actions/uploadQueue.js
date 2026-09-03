/**
 * @file apps/renderer/features/KnowledgeBase/stores/knowledgeBase/actions/uploadQueue.js
 * 
 * @brief 上传队列管理与任务调度
 * 
 * @description
 * 功能 (What): 管理文件上传队列、并发控制、任务执行等核心逻辑
 * 输入 (Input): 文件列表、任务配置
 * 输出 (Output): 队列管理函数
 * 副作用 (Side-effects): 执行文件上传，管理任务状态，调度任务队列
 */

import { knowledgeBaseService } from '../../../services/knowledgeBaseService.js'
import { stopAnimation } from '../../../services/progressAnimator.js'
import { UPLOAD_STATUS, MAX_CONCURRENT_UPLOADS } from '../../../constants/index.js'
import { resolveCurrentKnowledgeBaseMessage } from '../../../functions/resolveCurrentKnowledgeBaseMessage'
import { createKnowledgeBaseUploadMessage } from '../../../functions/knowledgeBaseUploadPresentation'
import {
  readEffectiveAuxiliaryModelPurposeBinding,
  readEffectiveModelPurposeBinding,
} from '@/domains/model-configuration'
import { PromptKeys } from '@app/schemas'

class KnowledgeBaseUploadTaskError extends Error {
  constructor(messageKey, diagnostic) {
    super(diagnostic)
    this.name = 'KnowledgeBaseUploadTaskError'
    this.uploadMessage = createKnowledgeBaseUploadMessage(messageKey)
  }
}

function resolveUploadErrorMessage(error) {
  return error instanceof KnowledgeBaseUploadTaskError
    ? error.uploadMessage
    : createKnowledgeBaseUploadMessage('knowledgeBase.upload.error.failed')
}

/**
 * 功能 (What): 创建文件添加到队列的函数
 * 输入 (Input): 状态引用和任务计数器
 * 输出 (Output): 文件添加函数
 * 副作用 (Side-effects): 创建任务对象，添加到队列和映射中
 */
export function createAddFilesToQueue(state) {
  return function addFilesToQueue(kbId, files, options = {}) {
    if (!kbId) return;

    console.log(`[添加文件] 开始处理 ${files.length} 个文件`);

    // 功能 (What): 仅对“同一知识库(kbId)”内的上传队列做去重，避免跨知识库误判重复
    // 说明：
    // - 这里的“重复”仅指：同一 KB 的 uploadTasks 中已存在相同文件（同一批次重复选择 / 未清理的队列项）
    // - 不检查“知识库已上传文档”的重复：该语义由后端处理，并在 UI 中显示 duplicate 状态
    const existingFiles = new Set(
      Array.from(state.uploadTasks.values())
        .filter((task) => task && task.kbId === kbId && task.file)
        .map((task) => `${task.file.name}|${task.file.size}|${task.file.lastModified}`)
    );

    let skippedCount = 0;
    let addedCount = 0;

    for (const file of files) {
      const fileIdentifier = `${file.name}|${file.size}|${file.lastModified}`;
      
      console.log(`[添加文件] 检查文件: ${file.name} (${file.size} bytes)`);
      
      // 只检查上传队列中的重复（同一批次选择的重复文件）
      if (existingFiles.has(fileIdentifier)) {
        console.log(`[添加文件] ⚠️ 跳过重复文件（同一知识库队列中）: ${file.name}`);
        skippedCount++;
        continue;
      }

      console.log(`[添加文件] ✅ 文件通过队列重复检测: ${file.name}`);

      const id = `file-${Date.now()}-${state.taskCounter()}` // V44 Fix: Use counter for unique ID
      const fileHash = `${file.name}-${file.size}-${file.lastModified}`;
      
      const task = {
        id,
        kbId,
        file,
        filename: file.name,
        size: file.size,
        status: UPLOAD_STATUS.PENDING,
        
        // --- V35 专家方案: 新进度模型 ---
        realProgress: 0,
        displayProgress: 0,
        seed: (parseInt(fileHash.slice(-10), 36) % 1000) / 1000,
        
        message: createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.waiting'),
        error: null,
        docId: null,
      }

      state.uploadTasks.set(id, task)
      // [V166 修复] 将新任务推入待处理队列
      // [V168 修复] 移除此处的自动调度，将控制权交还给"开始解析"按钮
      state.uploadQueue.value.push(task);
      addedCount++;
      // _scheduleNext();
    }
    
    // 🔥 修复：提供准确的用户反馈
    if (skippedCount > 0) {
      console.log(`[添加文件] 📋 总结: 添加 ${addedCount} 个文件，跳过 ${skippedCount} 个重复文件（同一知识库队列中重复）`);

      if (typeof options.onDuplicateFilesSkipped === 'function') {
        options.onDuplicateFilesSkipped(skippedCount)
      }
    } else {
      console.log(`[添加文件] ✅ 成功添加 ${addedCount} 个文件到队列`);
    }
  }
}

/**
 * 功能 (What): 内部函数，执行单个任务的上传和处理
 * 输入 (Input): 状态引用和相关函数
 * 输出 (Output): 任务执行函数
 * 副作用 (Side-effects): 执行文件上传，更新任务状态
 */
export function createPerformUpload(
  state,
  updateTaskState,
  scheduleNext,
  fetchInitialTaskStatus,
  replayPendingUpdates,
  message = resolveCurrentKnowledgeBaseMessage
) {
  return async function performUpload(task) {
    console.log(`[任务开始] 开始处理任务: ${task.id} (${task.filename})`);
    
    try {
      // 状态切换为处理中，并提供一个临时的前端消息
      updateTaskState(task.id, {
        status: UPLOAD_STATUS.PROCESSING,
        message: createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.uploading'),
      });

      const onUploadProgress = (progressEvent) => {
         // 这里可以根据需要更新一个纯粹的上传进度，但当前方案已将其包含在阶段内
      }
      
      const modelConfig = {
        embedding_model_id: readEffectiveModelPurposeBinding('embedding'),
        rerank_model_id: readEffectiveModelPurposeBinding('rerank'),
        pdf_ocr_model_id: readEffectiveModelPurposeBinding('pdf_ocr'),
        image_vision_model_id: readEffectiveModelPurposeBinding('image_vision'),
        graph_extraction_model_id: readEffectiveAuxiliaryModelPurposeBinding(PromptKeys.KNOWLEDGE_GRAPH_EXTRACTION),
        vision_model_id: null,
        force_vision_mode: state.parsingSettings?.forceVisionMode ?? false, // 🔥 修复：直接从store状态读取最新设置
      };

      // 确保关键模型已选择
      if (!modelConfig.embedding_model_id) {
        throw new KnowledgeBaseUploadTaskError(
          'knowledgeBase.upload.error.embeddingModelRequired',
          'Embedding model is required for knowledge base upload',
        );
      }

      console.log(`[任务上传] 📋 任务 ${task.id} 配置: 强制视觉模式=${modelConfig.force_vision_mode}`);

      const response = await knowledgeBaseService.uploadDocument(
        task.kbId, 
        task.file, 
        modelConfig, // [新增] 传递模型配置（包含forceVisionMode）
        onUploadProgress
      );

      // 🔥 关键：上传接口返回后端创建的 document 记录（通常为 pending/processing）
      // 为了让「文档数量」在上传/清理/删除时保持响应式，这里对“当前KB”做一次乐观同步：
      // - 立即把 document 放进 state.documents（若当前正处于该 KB）
      // - 这样 FileManageTab / 详情页头部 / 列表页的 documentCount 都能即时更新（documentCount 由 store 内 watcher 同步）
      const createdDocument = response && response.document ? response.document : null
      if (
        createdDocument &&
        createdDocument.id &&
        state.currentKbId &&
        state.currentKbId.value === task.kbId &&
        Array.isArray(state.documents.value)
      ) {
        const exists = state.documents.value.some((d) => d && d.id === createdDocument.id)
        if (!exists) {
          // 新文档放到最前面，符合“最近上传更靠前”的直觉
          state.documents.value = [createdDocument, ...state.documents.value]
        }
      }
      
      const taskInMap = state.uploadTasks.get(task.id);
      if (taskInMap) {
        // [核心修复] 立即检查后端返回的直接结果
        // 场景 A: 后端直接返回了最终状态 (如 'duplicate')
        if (response.status === 'duplicate' || response.status === 'failed') {
          // 直接使用后端返回的完整状态对象更新UI
          // updateTaskState会自动处理终态清理（移除activeUploads、调度下个任务）
          updateTaskState(task.id, response);
        } else {
          // 场景 B: 后端返回了初始状态 (如 'pending')，等待IPC推送
          const documentId = response.document?.id;
          const backendTaskId = response.task_id; // 🔥 修复：保存后端返回的taskId
          if (documentId) {
            taskInMap.docId = documentId;
            console.log(`[任务提交] ✅ 文档ID已设置: ${task.id} -> docId: ${documentId}`);

            // [优化] 立即进行一次乐观更新：直接显示"解析中"标签，消除短暂空白
            updateTaskState(task.id, {
              status: UPLOAD_STATUS.PROCESSING,
              message: createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.parsing'),
              stage: 'parsing',
              stage_progress: 5,
              timestamp: Date.now()
            });

            // [新增] 绑定 docId 后：
            // 1) 立即拉取首帧进度，避免首批推送丢失
            await fetchInitialTaskStatus(task.id, documentId);
            
            // 2) 回放缓存中该 docId 的最新一条状态
            replayPendingUpdates(task.id, documentId);
          } else {
            console.error(`[任务提交] ❌ 响应中缺少文档ID:`, response);
          }
          
          // 🔥 修复：保存后端返回的taskId，用于任务控制操作
          if (backendTaskId) {
            taskInMap.backendTaskId = backendTaskId;
            console.log(`[任务提交] ✅ 后端任务ID已设置: ${task.id} -> backendTaskId: ${backendTaskId}`);
            // [新增] 如有按 taskId 缓存的早到状态，立即回放
            try {
              const kbStore = require('../index.js').useKnowledgeBaseStore?.();
              if (kbStore && kbStore.pendingUpdatesByTaskId && kbStore.pendingUpdatesByTaskId.has(backendTaskId)) {
                const cached = kbStore.pendingUpdatesByTaskId.get(backendTaskId);
                kbStore.pendingUpdatesByTaskId.delete(backendTaskId);
                updateTaskState(task.id, {
                  status: cached.status,
                  message: cached.message,
                  progress: cached.progress,
                  error: cached.error,
                  stage: cached.stage,
                  stage_progress: cached.stage_progress,
                  updated_at: cached.updated_at,
                  timestamp: cached.timestamp
                });
              }
            } catch (e) {
              // 忽略索引引入失败（避免循环依赖），不影响主流程
            }
          } else {
            console.error(`[任务提交] ❌ 响应中缺少任务ID:`, response);
          }
          
          // 使用后端返回的初始状态更新UI
          updateTaskState(task.id, response);

          // 注意：不再需要启动轮询，状态更新将通过IPC推送自动到达
          console.log(`[任务提交] 任务 ${task.id} 已提交，等待IPC状态推送`);
          console.log(`[任务提交] 当前任务状态:`, {
            id: task.id,
            docId: taskInMap.docId,
            backendTaskId: taskInMap.backendTaskId, // 🔥 修复：显示后端任务ID
            filename: taskInMap.filename,
            status: taskInMap.status
          });
        }
      }
    } catch (error) {
      updateTaskState(task.id, {
        status: UPLOAD_STATUS.FAILED,
        error: resolveUploadErrorMessage(error),
        message: createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.failed'),
      });
      // [V166 修复] 抛出错误以通知队列管理器此任务已失败
      throw error;
    }
  }
}

/**
 * 功能 (What): 开始处理所有处于"待处理"状态的任务
 * 输入 (Input): 状态引用和调度函数
 * 输出 (Output): 解析启动函数
 * 副作用 (Side-effects): 使用并发控制，最多同时处理4个文件
 */
export function createStartParsing(state, scheduleNext) {
  return async function startParsing() {
    console.log(`[开始解析] 当前状态检查: isParsing=${state.isParsing.value}, 队列长度=${state.uploadQueue.value.length}, 活动任务=${state.activeUploads.size}`);
    
    if (state.isParsing.value) {
      console.log(`[开始解析] ⚠️ 解析已在进行中，跳过此次请求`);
      return; // 防止重复启动
    }
    
    state.isParsing.value = true;
    console.log(`[开始解析] ✅ 设置isParsing=true，开始调度任务`);
    
    // [V169 修复] 初始时，尝试填满所有并发槽位
    for (let i = 0; i < MAX_CONCURRENT_UPLOADS; i++) {
      scheduleNext();
    }
  }
}

/**
 * 功能 (What): 调度器逻辑重构，修复并发控制
 * 输入 (Input): 状态引用和执行函数
 * 输出 (Output): 调度函数
 * 副作用 (Side-effects): 该函数是启动下一个上传任务的唯一入口点
 */
export function createScheduleNext(
  state,
  performUpload,
  updateTaskState,
  message = resolveCurrentKnowledgeBaseMessage
) {
  return function scheduleNext() {
    console.log(`[调度器] 调度检查: 活动任务=${state.activeUploads.size}/${MAX_CONCURRENT_UPLOADS}, 队列剩余=${state.uploadQueue.value.length}`);
    
    // 检查是否有空闲的槽位以及队列中是否有等待的任务
    if (state.activeUploads.size >= MAX_CONCURRENT_UPLOADS || state.uploadQueue.value.length === 0) {
      // 如果没有新任务需要启动，检查是否所有任务都已完成
      if (state.uploadQueue.value.length === 0 && state.activeUploads.size === 0) {
        state.isParsing.value = false;
        console.log("[调度器] ✅ 所有上传任务已处理完成，重置isParsing=false");
      } else {
        console.log(`[调度器] ⏸️ 调度暂停: 并发已满或队列为空 (活动=${state.activeUploads.size}, 队列=${state.uploadQueue.value.length})`);
      }
      return; // 没有可做的事情，直接返回
    }

    const task = state.uploadQueue.value.shift(); // 从队列中获取下一个任务
    state.activeUploads.set(task.id, task);     // 将其标记为活动状态
    
    console.log(`[调度器] 启动新任务: ${task.id} (${task.filename}), 当前活动任务: ${state.activeUploads.size}/${MAX_CONCURRENT_UPLOADS}, 队列剩余: ${state.uploadQueue.value.length}`);

    // 异步执行上传，不阻塞调度器
    performUpload(task)
      .catch(err => {
        // [V169 修复] 即使上传本身失败，也需要从活动池移除并调度下一个
        console.error(`[Scheduler] Task ${task.id} failed during upload:`, err.message);
        updateTaskState(task.id, {
          status: UPLOAD_STATUS.FAILED,
          error: resolveUploadErrorMessage(err),
          message: createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.failed'),
        });
      });
  }
}

/**
 * 功能 (What): 取消上传任务
 * 输入 (Input): 状态引用和相关函数
 * 输出 (Output): 取消函数
 * 副作用 (Side-effects): 中断任务执行，清理状态
 */
export function createCancelUploadTask(state, scheduleNext, updateTaskState) {
  return async function cancelUploadTask(id) {
    const task = state.uploadTasks.get(id);
    if (!task) {
      console.warn(`[取消任务] ⚠️ 任务不存在: ${id}`);
      return;
    }
    
    console.log(`[取消任务] 开始取消任务: ${id} (${task.filename}), 当前状态: ${task.status}`);
    console.log(`[取消任务] 取消前状态: 活动任务=${state.activeUploads.size}, 队列长度=${state.uploadQueue.value.length}, isParsing=${state.isParsing.value}`);
    
    try {
      // 🔥 修复：优先使用后端任务ID，兜底使用文档ID
      const taskIdForCancel = task.backendTaskId || task.docId;
      if (taskIdForCancel) {
        console.log(`[取消任务] 使用任务ID: ${taskIdForCancel} (类型: ${task.backendTaskId ? 'backendTaskId' : 'docId'})`);
        await knowledgeBaseService.cancelTask(taskIdForCancel);
      }
      
      // 立即更新前端状态（保持在列表中，可见为“已取消/失败”）
      // updateTaskState会自动处理终态清理（stopAnimation、移除activeUploads、调度下个任务）
      updateTaskState(id, {
        status: UPLOAD_STATUS.FAILED,
        message: createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.canceled'),
        error: createKnowledgeBaseUploadMessage('knowledgeBase.upload.error.canceledByUser'),
      });
      
      // 🔥 修复：无论是否在活动池，均应从待处理队列中移除该任务，避免后续被调度
      const idx = state.uploadQueue.value.findIndex(t => t.id === id);
      if (idx !== -1) {
        state.uploadQueue.value.splice(idx, 1);
        console.log(`[取消任务] 🧹 从待处理队列移除: ${id}, 队列长度=${state.uploadQueue.value.length}`);
      }
      
      console.log(`[取消任务] 取消后状态: 活动任务=${state.activeUploads.size}, 队列长度=${state.uploadQueue.value.length}, isParsing=${state.isParsing.value}`);
      
    } catch (error) {
      console.error(`取消任务失败: ${error.message}`);
      // 即使API调用失败，也继续前端清理
      stopAnimation(task);
      state.uploadTasks.delete(id);
      
      // 🔥 修复：确保即使取消失败也要清理activeUploads
      if (state.activeUploads.has(id)) {
        state.activeUploads.delete(id);
        console.log(`[取消任务] ⚠️ API失败但仍清理活动池: ${id}, 剩余活动任务: ${state.activeUploads.size}`);
        scheduleNext();
      }
    }
  }
}

/**
 * 功能 (What): 删除上传任务（仅前端UI移除，不影响已入库文档）
 * 输入 (Input): 状态引用
 * 输出 (Output): 删除函数
 * 副作用 (Side-effects): 从队列、活动池与任务映射中移除该任务
 */
export function createDeleteUploadTask(state) {
  return function deleteUploadTask(id) {
    const task = state.uploadTasks.get(id);
    if (!task) {
      console.warn(`[删除任务] ⚠️ 任务不存在: ${id}`);
      return;
    }

    console.log(`[删除任务] 开始删除任务: ${id} (${task.filename}), 当前状态: ${task.status}`);

    // 不对后端做删除文档操作，这里仅移除前端任务项
    stopAnimation(task);

    // 从活动池移除（通常不会发生，因为活跃态按钮是“取消”）
    if (state.activeUploads.has(id)) {
      state.activeUploads.delete(id);
      console.log(`[删除任务] 从活动池移除: ${id}`);
    }

    // 从待处理队列移除
    const idx = state.uploadQueue.value.findIndex(t => t.id === id);
    if (idx !== -1) {
      state.uploadQueue.value.splice(idx, 1);
      console.log(`[删除任务] 从待处理队列移除: ${id}, 队列长度=${state.uploadQueue.value.length}`);
    }

    // 从任务映射移除（UI将不再显示）
    state.uploadTasks.delete(id);
    console.log(`[删除任务] ✅ 已从UI移除任务: ${id}`);
  }
}

/**
 * 功能 (What): 重试失败的上传任务
 * 输入 (Input): 状态引用和相关函数
 * 输出 (Output): 重试函数
 * 副作用 (Side-effects): 重置任务状态，重新加入队列
 */
export function createRetryUploadTask(state, startParsing, updateTaskState) {
  return async function retryUploadTask(taskId) {
    const task = state.uploadTasks.get(taskId);
    if (task && (task.status === UPLOAD_STATUS.FAILED)) {
      console.log(`[重试任务] 开始重试任务: ${taskId} (${task.filename})`);
      
      const newTask = { ...task };
      Object.assign(newTask, {
        status: UPLOAD_STATUS.PENDING,
        message: createKnowledgeBaseUploadMessage('knowledgeBase.upload.status.waitingRetry'),
        error: null,
        realProgress: 0,
        displayProgress: 0,
        docId: null,
        backendTaskId: null, // 🔥 修复：清空后端任务ID
      });

      state.uploadTasks.set(task.id, newTask);
      stopAnimation(task);
      
      // 🔥 修复：重新添加任务到队列中
      state.uploadQueue.value.push(newTask);
      console.log(`[重试任务] 任务已重新加入队列: ${taskId}, 队列长度: ${state.uploadQueue.value.length}`);
      
      await startParsing();
    }
  }
}
