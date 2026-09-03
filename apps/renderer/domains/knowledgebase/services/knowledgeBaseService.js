// src/renderer/features/KnowledgeBase/services/knowledgeBaseService.js
//
// 该文件提供知识库相关的前端服务层，负责与后端API的交互
// 包括知识库管理、文档上传、任务状态查询等功能

import axios from 'axios';
import { getApiBaseUrl, getApiToken, refreshApiSession } from '../../../shared/services/aiService/common';
import { readEffectiveModelPurposeBinding } from '@/domains/model-configuration';
import { resolveCurrentKnowledgeBaseMessage } from '../functions/resolveCurrentKnowledgeBaseMessage';
import { resolveKnowledgeBaseOperationFailure } from '../functions/resolveKnowledgeBaseOperationFailure';
import { extractKnowledgeBaseErrorMessage } from '../functions/extractKnowledgeBaseErrorMessage.js';

function resolveIpcFailure(result, fallbackKey, fallbackParams) {
  if (result && typeof result.error === 'string') {
    return resolveKnowledgeBaseOperationFailure(
      result,
      resolveCurrentKnowledgeBaseMessage,
      fallbackKey,
      fallbackParams
    );
  }

  return resolveCurrentKnowledgeBaseMessage(fallbackKey, fallbackParams);
}

/**
 * @typedef {Object} KnowledgeBaseSummary
 * @description 知识库概要信息（用于列表展示/选择）
 * @property {string} id 知识库 ID
 * @property {string} name 知识库名称
 * @property {string=} description 知识库描述（可选）
 */

/**
 * @typedef {Object} GetAllKnowledgeBasesResponse
 * @description 获取知识库列表的标准响应结构
 * @property {KnowledgeBaseSummary[]} knowledge_bases 知识库列表
 * @property {number} total 总数
 * @property {string} timestamp 时间戳（ISO 字符串）
 */

/**
 * @typedef {Object} KnowledgeBaseSearchResultItem
 * @description 知识库搜索结果项（与后端 SearchResponse.results 对齐的最小字段集合）
 * @property {string} text 命中文本
 * @property {string} docId 文档 ID
 * @property {string} docTitle 文档标题
 * @property {number} score 相关度分数
 * @property {string=} matchType 匹配类型（可选）
 * @property {string=} blockType 块类型（可选）
 * @property {string=} blockId 块 ID（可选）
 * @property {number=} page 页码（可选）
 */

/**
 * @typedef {Object} KnowledgeBaseSearchResponse
 * @description 知识库搜索响应（与后端路由返回结构对齐；额外字段可按需扩展）
 * @property {KnowledgeBaseSearchResultItem[]} results 结果列表
 * @property {Object=} meta 元信息（可选）
 * @property {string=} kbId 知识库 ID（camelCase，可选）
 * @property {string=} kb_id 知识库 ID（snake_case，可选，向后兼容）
 * @property {string=} timestamp 时间戳（可选）
 */

// V22 修复: 统一 API 客户端的创建和管理，消除旧的、有问题的 fetch 和 this.baseUrl 写法
let apiClientInstance = null;

function updateApiClientBaseUrl(client, baseUrl) {
  client.defaults.baseURL = `${baseUrl}/api/v1`;
}

/**
 * 异步获取并缓存一个配置好的 axios 实例。
 * 这个函数现在是所有API请求的唯一入口。
 * @returns {Promise<import('axios').AxiosInstance>}
 */
async function getApiClient() {
  if (apiClientInstance) {
    return apiClientInstance;
  }

  // 检查是否在浏览器环境中（例如 Vite dev server)
  const isWebEnvironment = !window.electronAPI;

  if (isWebEnvironment) {
    // 在Web环境中，我们假设Vite的代理会处理请求转发
    apiClientInstance = axios.create({
      baseURL: '/api/v1', // 相对路径，例如 /api/v1/knowledge-base/...
      timeout: 180000,
    });
  } else {
    // 在Electron环境中，我们必须动态获取由后端启动的端口
    try {
      const baseUrl = await getApiBaseUrl();
      
      if (!baseUrl) {
        throw new Error('API基础URL为空');
      }
      
      const fullBaseURL = `${baseUrl}/api/v1`;
      
      apiClientInstance = axios.create({
        baseURL: fullBaseURL, // 完整的URL，例如 http://127.0.0.1:3000/api/v1/...
        timeout: 180000,
      });
      apiClientInstance.interceptors.request.use(async (config) => {
        config.headers.set('X-API-Token', await getApiToken());
        return config;
      });
      apiClientInstance.interceptors.response.use(undefined, async (error) => {
        if (
          error?.response?.status !== 401 ||
          error.config?._apiSessionRetried === true
        ) {
          throw error;
        }

        const session = await refreshApiSession();
        updateApiClientBaseUrl(apiClientInstance, session.baseUrl);
        const retryConfig = {
          ...error.config,
          _apiSessionRetried: true,
          headers: axios.AxiosHeaders.from(error.config.headers),
        };
        retryConfig.headers.set('X-API-Token', session.token);
        retryConfig.baseURL = apiClientInstance.defaults.baseURL;
        return apiClientInstance.request(retryConfig);
      });
    } catch (error) {
      console.error('[KnowledgeBaseService] 💥 获取API基础URL失败:', error);
      throw new Error(resolveCurrentKnowledgeBaseMessage('knowledgeBase.service.error.apiBaseUrlUnavailable'));
    }
  }

  return apiClientInstance;
}
/**
 * 知识库管理服务。
 * V22 重构: 所有方法现在都使用 getApiClient() 来确保请求的正确性。
 */
export const knowledgeBaseService = {
  /**
   * 获取 Electron preload 暴露的“知识库 IPC API”（若不存在则返回 null）。
   *
   * 设计原则：
   * - Electron 环境优先使用 IPC：与 workspace.sqlite 的写入链路一致，减少“同一功能两套通道”导致的数据不一致；
   * - Web 环境（无 preload）继续走 HTTP。
   */
  _getIpcApi() {
    // eslint-disable-next-line no-undef
    if (typeof window === 'undefined' || !window.electronAPI) {
      return null;
    }
    const api = window.electronAPI;

    return {
      getAllKbs: typeof api.getAllKbs === 'function' ? api.getAllKbs.bind(api) : null,
      createKb: typeof api.createKb === 'function' ? api.createKb.bind(api) : null,
      deleteKb: typeof api.deleteKb === 'function' ? api.deleteKb.bind(api) : null,
      getDocumentsInKb: typeof api.getDocumentsInKb === 'function' ? api.getDocumentsInKb.bind(api) : null,
      updateKbSettings: typeof api.updateKbSettings === 'function' ? api.updateKbSettings.bind(api) : null,
      // Soft Knowledge Graph（M4）
      getKbGraphProgress:
        typeof api.getKbGraphProgress === 'function' ? api.getKbGraphProgress.bind(api) : null,
      onKbGraphProgressUpdated:
        typeof api.onKbGraphProgressUpdated === 'function'
          ? api.onKbGraphProgressUpdated.bind(api)
          : null,
    };
  },

  /**
   * 获取指定知识库的图谱构建进度（M4）
   *
   * 说明：
   * - Electron 环境走 IPC（workspace.sqlite 聚合结果）；
   * - Web 环境暂不支持（返回 null），避免误导用户。
   *
   * @param {string} kbId
   * @returns {Promise<null|{kbId:string, percent:number, totalUnits:number, doneUnits:number, updatedAtSeconds:number|null}>}
   */
  async getKbGraphProgress(kbId) {
    const normalizedKbId = typeof kbId === 'string' ? kbId.trim() : '';
    if (!normalizedKbId) return null;

    const ipc = this._getIpcApi();
    if (ipc && ipc.getKbGraphProgress) {
      try {
        const result = await ipc.getKbGraphProgress(normalizedKbId);
        if (!result || result.success !== true) {
          return null;
        }
        return result.data || null;
      } catch (error) {
        console.warn('[KnowledgeBaseService] getKbGraphProgress IPC 调用失败:', error);
        return null;
      }
    }

    // Web / DevServer 环境：当前没有对应 HTTP API，保持不支持
    return null;
  },

  /**
   * 订阅 KB 图谱进度推送（M4）
   *
   * @param {(payload: unknown) => void} callback
   * @returns {(() => void) | null} 取消订阅函数（若不可用则返回 null）
   */
  onKbGraphProgressUpdated(callback) {
    const ipc = this._getIpcApi();
    if (ipc && ipc.onKbGraphProgressUpdated && typeof callback === 'function') {
      try {
        return ipc.onKbGraphProgressUpdated(callback);
      } catch (error) {
        console.warn('[KnowledgeBaseService] onKbGraphProgressUpdated 注册失败:', error);
        return null;
      }
    }
    return null;
  },

  /**
   * 获取所有知识库列表
   * @returns {Promise<GetAllKnowledgeBasesResponse>} 知识库列表响应
   */
  async getAllKnowledgeBases() {
    try {
      const ipc = this._getIpcApi();
      if (ipc && ipc.getAllKbs) {
        const result = await ipc.getAllKbs();
        if (!result || result.success !== true) {
          throw new Error(resolveIpcFailure(result, 'knowledgeBase.service.error.getAllIpcFailed'));
        }

        const list = Array.isArray(result.data) ? result.data : [];
        return {
          knowledge_bases: list,
          total: list.length,
          timestamp: new Date().toISOString(),
        };
      }

      const apiClient = await getApiClient();
      const response = await apiClient.get('/knowledge-base');
      return response.data;
    } catch (error) {
      console.error('获取知识库列表时出错:', error);
      throw error.response?.data || error;
    }
  },

  /**
   * 读取 Citation Snapshot Store 的 bundle（搜索/阅读结果快照）
   *
   * @param {string} bundleId
   * @returns {Promise<any>}
   */
  async getCitationSnapshotBundle(bundleId, conversationId, instanceId) {
    const id = typeof bundleId === 'string' ? bundleId.trim() : '';
    if (!id) {
      throw new Error('bundleId 不能为空');
    }
    const conv = typeof conversationId === 'string' ? conversationId.trim() : '';
    const inst = typeof instanceId === 'string' ? instanceId.trim() : '';
    if (!conv) {
      throw new Error('conversationId 不能为空（CitationSnapshotStore 已收口到 conversation-root）');
    }
    const apiClient = await getApiClient();
    const query = new URLSearchParams();
    query.set('conversation_id', conv);
    if (inst) query.set('instance_id', inst);
    const response = await apiClient.get(`/knowledge-base/citation-snapshots/bundles/${id}?${query.toString()}`);
    return response.data;
  },

  /**
   * 创建新的知识库
   * @param {Object} kbData - 知识库数据
   * @returns {Promise<Object>} 创建的知识库信息
   */
  async createKnowledgeBase(kbData) {
    try {
      const ipc = this._getIpcApi();
      if (ipc && ipc.createKb) {
        const name = kbData && typeof kbData.name === 'string' ? kbData.name : '';
        const description =
          kbData && typeof kbData.description === 'string' ? kbData.description : undefined;

        const result = await ipc.createKb(name, description);
        if (!result || result.success !== true) {
          throw new Error(resolveIpcFailure(result, 'knowledgeBase.service.error.createIpcFailed'));
        }

        return {
          knowledge_base: result.data,
          message: resolveCurrentKnowledgeBaseMessage('knowledgeBase.service.create.success'),
          timestamp: new Date().toISOString(),
        };
      }

      const apiClient = await getApiClient();
      const response = await apiClient.post('/knowledge-base', kbData);
      return response.data;
    } catch (error) {
      console.error('创建知识库时出错:', error);
      throw error.response?.data || error;
  }
  },

  /**
   * 获取指定知识库的详细信息
   * @param {string} kbId - 知识库ID
   * @returns {Promise<Object|null>} 知识库详细信息, 或在404时返回null
   */
  async getKnowledgeBase(kbId) {
    try {
      const apiClient = await getApiClient();
      const response = await apiClient.get(`/knowledge-base/${kbId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error(`获取知识库 ${kbId} 信息时出错:`, error);
      throw error.response?.data || error;
    }
  },

  /**
   * 删除知识库
   * @param {string} kbId - 知识库ID
   * @returns {Promise<void>}
   */
  async deleteKnowledgeBase(kbId) {
    try {
      const ipc = this._getIpcApi();
      if (ipc && ipc.deleteKb) {
        const result = await ipc.deleteKb(kbId);
        if (!result || result.success !== true) {
          throw new Error(resolveIpcFailure(
            result,
            'knowledgeBase.service.error.deleteIpcFailed',
            { knowledgeBaseId: kbId }
          ));
        }
        return;
      }

      const apiClient = await getApiClient();
      await apiClient.delete(`/knowledge-base/${kbId}`);
    } catch (error) {
      console.error(`删除知识库 ${kbId} 时出错:`, error);
      throw error.response?.data || error;
    }
  },

  /**
   * 获取知识库中的文档列表
   * @param {string} kbId - 知识库ID
   * @returns {Promise<Array>} 文档列表
   */
  async getDocuments(kbId) {
    try {
      const ipc = this._getIpcApi();
      if (ipc && ipc.getDocumentsInKb) {
        const result = await ipc.getDocumentsInKb(kbId);
        if (!result || result.success !== true) {
          throw new Error(resolveIpcFailure(
            result,
            'knowledgeBase.service.error.getDocumentsIpcFailed',
            { knowledgeBaseId: kbId }
          ));
        }

        const documents = Array.isArray(result.data) ? result.data : [];
        return {
          documents,
          total: documents.length,
          kb_id: kbId,
          timestamp: new Date().toISOString(),
        };
      }

      const apiClient = await getApiClient();
      const response = await apiClient.get(`/knowledge-base/${kbId}/documents`);
      return response.data;
    } catch (error) {
      console.error(`获取知识库 ${kbId} 的文档时出错:`, error);
      throw error.response?.data || error;
    }
  },

  /**
   * 上传文档到指定的知识库
   * @param {string} kbId - 知识库ID
   * @param {File} file - 要上传的文件
   * @param {object} modelConfig - 包含模型ID的对象
   * @param {Function} onUploadProgress - 上传进度回调
   * @returns {Promise<Object>} 后端返回的文档记录
   */
  async uploadDocument(kbId, file, modelConfig, onUploadProgress) {
    try {
      const apiClient = await getApiClient();
      const formData = new FormData();
      formData.append('file', file);
      
      // [新增] 将模型配置添加到表单数据中
      if (modelConfig.embedding_model_id) {
        formData.append('embedding_model_id', modelConfig.embedding_model_id);
      }
      if (modelConfig.rerank_model_id) {
        formData.append('rerank_model_id', modelConfig.rerank_model_id);
      }
      if (modelConfig.pdf_ocr_model_id) {
        formData.append('pdf_ocr_model_id', modelConfig.pdf_ocr_model_id);
      }
      if (modelConfig.image_vision_model_id) {
        formData.append('image_vision_model_id', modelConfig.image_vision_model_id);
      }
      if (modelConfig.graph_extraction_model_id) {
        formData.append('graph_extraction_model_id', modelConfig.graph_extraction_model_id);
      }
      // 兼容历史后端字段：仅在新字段缺失时透传旧字段
      if (modelConfig.vision_model_id) {
        formData.append('vision_model_id', modelConfig.vision_model_id);
      }
      // 🔥 新增：添加强制视觉模式设置
      if (typeof modelConfig.force_vision_mode === 'boolean') {
        formData.append('force_vision_mode', modelConfig.force_vision_mode.toString());
      }

      const response = await apiClient.post(
        `/knowledge-base/${kbId}/documents`, 
        formData, 
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress,
        }
      );
      
      return response.data;
    } catch (error) {
      console.error('上传文档时出错:', error);
      // V22 改进: 无论错误类型，都向上抛出一个标准化的错误对象
      if (error.response) {
        // 来自服务器的错误 (例如 4xx, 5xx)
        throw new Error(
          extractKnowledgeBaseErrorMessage(error)
            || resolveCurrentKnowledgeBaseMessage('knowledgeBase.service.error.server', {
              statusCode: error.response.status,
            }),
        );
      } else if (error.request) {
        // 请求已发出但没有收到响应
        throw new Error(resolveCurrentKnowledgeBaseMessage('knowledgeBase.service.error.network'));
      } else {
        // 设置请求时发生错误
        throw new Error(
          resolveCurrentKnowledgeBaseMessage('knowledgeBase.service.error.requestSetup', {
            errorMessage: error.message,
          }),
        );
    }
  }
  },

  /**
   * 删除知识库中的文档
   * @param {string} kbId - 知识库ID
   * @param {string} docId - 文档ID
   * @returns {Promise<void>}
   */
  async deleteDocument(kbId, docId) {
    try {
      const apiClient = await getApiClient();
      await apiClient.delete(`/knowledge-base/${kbId}/documents/${docId}`);
    } catch (error) {
      console.error(`删除文档 ${docId} 时出错:`, error);
      throw error.response?.data || error;
    }
  },

  async continueFailedPdfPages(kbId, docId, modelConfig = {}) {
    try {
      const apiClient = await getApiClient();
      const response = await apiClient.post(
        `/knowledge-base/${kbId}/documents/${docId}/continue-failed-pages`,
        modelConfig
      );
      return response.data;
    } catch (error) {
      console.error(`继续解析 PDF 失败页时出错: ${docId}`, error);
      throw error.response?.data || error;
    }
  },

  /**
   * 批量获取任务状态
   * @param {string[]} taskIds - 任务ID列表
   * @returns {Promise<Object>} 一个以任务ID为键，状态对象为值的字典
   */
  async getTasksStatus(taskIds) {
    if (!taskIds || taskIds.length === 0) {
      return {};
    }
    try {
      const apiClient = await getApiClient();
      const response = await apiClient.get('/knowledge-base/tasks/status', {
        params: { id: taskIds },
        paramsSerializer: params => {
          // 修复: FastAPI 需要重复的 id 参数，如 id=a&id=b。
          // URLSearchParams 会把数组序列化为逗号分隔字符串，导致后端无法解析。
          // 因此手动展开数组。
          if (Array.isArray(params.id)) {
            return params.id.map(id => `id=${encodeURIComponent(id)}`).join('&');
          }
          return `id=${encodeURIComponent(params.id)}`;
        }
      });
      
      // 🔧 修复：正确提取任务状态对象并标准化时间戳字段（updated_at/timestamp）
      const raw = response.data.task_statuses || {};
      const normalized = {};
      for (const key of Object.keys(raw)) {
        const item = raw[key] || {};
        let ts = item.updatedAt || item.updated_at || Date.now();
        // 🔧 归一化时间戳为毫秒
        if (typeof ts === 'string') {
          const parsed = Date.parse(ts);
          ts = isNaN(parsed) ? Date.now() : parsed;
        } else if (typeof ts === 'number' && ts < 1e12) {
          // 可能是秒
          ts = Math.floor(ts * 1000);
        }
        normalized[key] = {
          status: item.status,
          progress: item.progress,
          message: item.message,
          error: item.error,
          stage: item.stage,
          stage_progress: item.stage_progress,
          updated_at: ts,
          timestamp: ts
        };
      }
      return normalized;
    } catch (error) {
      console.error('批量获取任务状态时出错:', error);
      throw error.response?.data || error;
    }
  },

  /**
   * 更新知识库的AI模型设置
   * @param {string} kbId - 知识库ID
   * @param {object} settings - 新的设置
   * @returns {Promise<object>} 更新后的知识库对象
   */
  async updateKbSettings(kbId, settings) {
    try {
      const ipc = this._getIpcApi();
      if (ipc && ipc.updateKbSettings) {
        const result = await ipc.updateKbSettings(kbId, settings);
        if (!result || result.success !== true) {
          throw new Error(resolveIpcFailure(
            result,
            'knowledgeBase.service.error.updateSettingsIpcFailed',
            { knowledgeBaseId: kbId }
          ));
        }
        return result.data;
      }

      const apiClient = await getApiClient();
      const response = await apiClient.patch(`/knowledge-base/${kbId}/settings`, settings);
      // ⚠️ 注意：后端路由 `PATCH /knowledge-base/:kbId/settings` 的返回结构为：
      // { knowledge_base: {...}, message: string, timestamp: string }
      // 之前直接返回 response.data，导致 Store 中把整个响应对象 merge 到知识库元素上，
      // name/description 等字段并没有真正更新，进而触发 UI watcher 又把本地编辑值重置回旧值。
      //
      // 这里显式抽取后端返回的知识库对象，保证上层拿到的就是最新的知识库实体。
      const updatedKb = response.data && response.data.knowledge_base
        ? response.data.knowledge_base
        : response.data;
      
      if (!updatedKb || !updatedKb.id) {
        console.warn('[KnowledgeBaseService] ⚠️ 更新知识库设置后返回的对象不包含有效的 knowledge_base 字段:', response.data);
      }

      return updatedKb;
    } catch (error) {
      console.error(`更新知识库 ${kbId} 设置时出错:`, error);
      throw error.response?.data || error;
    }
  },

  /**
   * 取消任务
   * @param {string} taskId - 任务ID（通常是docId）
   * @returns {Promise<void>}
   */
  async cancelTask(taskId) {
    try {
      const apiClient = await getApiClient();
      await apiClient.post(`/knowledge-base/tasks/${taskId}/cancel`);
    } catch (error) {
      console.error(`取消任务 ${taskId} 时出错:`, error);
      throw error.response?.data || error;
    }
  },

  /**
   * 暂停任务
   * @param {string} taskId - 任务ID
   * @deprecated 暂停/继续功能已简化，进行中的任务只支持取消操作
   */
  async pauseTask(taskId) {
    try {
      const apiClient = await getApiClient();
      await apiClient.post(`/knowledge-base/tasks/${taskId}/pause`);
    } catch (error) {
      console.error('[KnowledgeBaseService] 暂停任务失败:', error);
      throw error.response?.data || error;
    }
  },

  /**
   * 恢复任务
   * @param {string} taskId - 任务ID
   * @deprecated 暂停/继续功能已简化，进行中的任务只支持取消操作
   */
  async resumeTask(taskId) {
    try {
      const apiClient = await getApiClient();
      await apiClient.post(`/knowledge-base/tasks/${taskId}/resume`);
    } catch (error) {
      console.error('[KnowledgeBaseService] 恢复任务失败:', error);
      throw error.response?.data || error;
    }
  },

  /**
   * 在指定知识库中搜索（Phase 2 Citation 功能新增）
   *
   * @param {string} kbId - 知识库 ID（必填，非空字符串）
   * @param {Object} request - 搜索请求参数
   * @param {string} request.query - 搜索关键词（必填，非空字符串）
   * @param {number} [request.topK=5] - 返回结果数量
   * @param {boolean} [request.useReranking=true] - 是否使用重排序
   * @param {Object} [request.filter] - 可选过滤条件
   * @returns {Promise<KnowledgeBaseSearchResponse>} 搜索结果
   */
  async searchInKnowledgeBase(kbId, request) {
    // 参数校验
    if (typeof kbId !== 'string' || kbId.trim().length === 0) {
      throw new Error('[KnowledgeBaseService] searchInKnowledgeBase: kbId 必须是非空字符串');
    }
    if (!request || typeof request.query !== 'string' || request.query.trim().length === 0) {
      throw new Error('[KnowledgeBaseService] searchInKnowledgeBase: request.query 必须是非空字符串');
    }
    if (request.topK !== undefined && (typeof request.topK !== 'number' || request.topK <= 0)) {
      throw new Error('[KnowledgeBaseService] searchInKnowledgeBase: topK 必须是正数');
    }

    try {
      const apiClient = await getApiClient();
      
      // 构造请求体（使用 camelCase，与 TS service 对齐）
      const payload = {
        query: request.query.trim(),
        topK: request.topK ?? 5,
        useReranking: request.useReranking ?? true,
        embeddingModelId: request.embeddingModelId ?? readEffectiveModelPurposeBinding('embedding'),
        rerankModelId: request.rerankModelId ?? readEffectiveModelPurposeBinding('rerank'),
      };
      
      // 可选：添加 filter
      if (request.filter && typeof request.filter === 'object') {
        payload.filter = request.filter;
      }
      
      console.log(`[KnowledgeBaseService] searchInKnowledgeBase: kbId=${kbId}, query="${payload.query}", topK=${payload.topK}`);
      
      const response = await apiClient.post(`/knowledge-base/${kbId}/search`, payload);
      return response.data;
    } catch (error) {
      console.error(`[KnowledgeBaseService] searchInKnowledgeBase 失败 (kbId=${kbId}):`, error);
      throw new Error(
        extractKnowledgeBaseErrorMessage(error)
          || resolveCurrentKnowledgeBaseMessage('knowledgeBase.service.error.searchFailed')
      );
    }
  },
};
