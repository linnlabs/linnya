/**
 * @file apps/renderer/features/KnowledgeBase/stores/knowledgeBase/actions/fetchers.js
 * 
 * @brief 知识库数据获取actions
 * 
 * @description
 * 功能 (What): 处理知识库和文档的获取、删除、更新等操作
 * 输入 (Input): API调用参数
 * 输出 (Output): 更新状态的函数
 * 副作用 (Side-effects): 调用API，更新响应式状态
 */

import { knowledgeBaseService } from '../../../services/knowledgeBaseService.js'
import { resolveCurrentKnowledgeBaseMessage } from '../../../functions/resolveCurrentKnowledgeBaseMessage'
import { readEffectiveModelPurposeBinding } from '@/domains/model-configuration'

/**
 * 功能 (What): 获取所有知识库列表
 * 输入 (Input): 状态引用对象
 * 输出 (Output): 异步函数，无返回值
 * 副作用 (Side-effects): 更新knowledgeBases、currentKbId、isLoading、error状态
 */
export function createFetchKnowledgeBases(state, fetchDocuments) {
  return async function fetchKnowledgeBases() {
    state.isLoading.value = true
    state.error.value = null
    
    try {
      const response = await knowledgeBaseService.getAllKnowledgeBases()

      // 🔧 修复：正确提取知识库数组
      const kbs = response.knowledge_bases || []

      state.knowledgeBases.value = kbs
      // ❌ 不再在这里自动选择第一个知识库：
      // - 这会导致进入「知识库首页」时直接跳到默认知识库详情，而不是展示知识库列表
      // - 当前设计下，谁需要默认选中哪个知识库，应由调用方主动调用 setCurrentKnowledgeBase
    } catch (err) {
      console.error('[KnowledgeBase Store] 💥 获取知识库列表失败:', err);
      state.error.value = resolveCurrentKnowledgeBaseMessage('knowledgeBase.store.error.fetchListFailed')
      state.knowledgeBases.value = []
    } finally {
      state.isLoading.value = false
    }
  }
}

/**
 * 功能 (What): 设置当前选中的知识库
 * 输入 (Input): 状态引用对象
 * 输出 (Output): 函数
 * 副作用 (Side-effects): 更新currentKbId状态，watcher会自动触发文档加载
 */
export function createSetCurrentKnowledgeBase(state, fetchDocuments) {
  return function setCurrentKnowledgeBase(kbId) {
    // 支持两种模式：
    // 1) 传入具体 kbId：切换当前知识库
    // 2) 传入 null / undefined：清空当前选择，回到「知识库列表」视图
    if (kbId == null) {
      if (state.currentKbId.value == null) {
        return
      }
      console.log('[KnowledgeBase Store] 🔄 清空当前知识库选择，回到列表视图')
      state.currentKbId.value = null
      // 清空当前文档列表，避免旧数据在 UI 中造成误导
      state.documents.value = []
      return
    }

    // 统一通道：只设置ID，文档加载由 Store 内的 watcher 自动处理
    if (!kbId || state.currentKbId.value === kbId) return
    console.log(`[KnowledgeBase Store] 🔄 切换知识库: ${kbId}`)
    state.currentKbId.value = kbId
    // fetchDocuments 调用已移除，由 watcher 统一处理
  }
}

/**
 * 功能 (What): 获取指定知识库的文档列表
 * 输入 (Input): 状态引用对象
 * 输出 (Output): 异步函数
 * 副作用 (Side-effects): 更新documents、isLoading、error状态
 */
export function createFetchDocuments(state) {
  return async function fetchDocuments(kbId) {
    if (!kbId) {
      console.warn('[KnowledgeBase Store] fetchDocuments: kbId为空，跳过');
      return;
    }
    
    // 🔧 竞态防护：为本次请求分配顺序号，仅最新一次返回可落库
    state._fetchDocsSeq = (state._fetchDocsSeq || 0) + 1;
    const requestSeq = state._fetchDocsSeq;
    
    console.log(`[KnowledgeBase Store] 📋 开始获取文档列表: kbId=${kbId}`);
    state.isLoading.value = true
    state.error.value = null
    try {
      const response = await knowledgeBaseService.getDocuments(kbId)
      
      // 若有更新的请求已发出，则丢弃本次过期结果
      if (requestSeq !== state._fetchDocsSeq) {
        console.log(`[KnowledgeBase Store] ⏭️ 丢弃过期文档响应 (seq=${requestSeq} < latest=${state._fetchDocsSeq})`)
        return;
      }
      
      // 🔧 修复：正确提取文档数组
      const newDocuments = response.documents || []
      
      // 📊 聚合状态统计，避免冗余日志
      const statusCount = newDocuments.reduce((acc, doc) => {
        acc[doc.status] = (acc[doc.status] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`[KnowledgeBase Store] 📋 获取到 ${newDocuments.length} 个文档`, 
        Object.keys(statusCount).length > 0 ? `状态分布: ${JSON.stringify(statusCount)}` : '');
      
      // 🔧 详细调试（仅在开发环境）
      if (process.env.NODE_ENV === 'development') {
        console.log(`[KnowledgeBase Store] 📋 文档详细信息:`, newDocuments);
      }
      
      state.documents.value = newDocuments;
    } catch (err) {
      // 若请求已过期则不覆盖错误状态
      if (requestSeq !== state._fetchDocsSeq) {
        console.log(`[KnowledgeBase Store] ⏭️ 丢弃过期错误 (seq=${requestSeq} < latest=${state._fetchDocsSeq})`)
        return;
      }
      console.error(`[KnowledgeBase Store] 📋 获取文档列表失败:`, err);
      state.error.value = resolveCurrentKnowledgeBaseMessage('knowledgeBase.store.error.fetchDocumentsFailed')
      state.documents.value = [] // 确保在出错时也是数组
    } finally {
      // 仅当当前仍为最新请求时，才落 isLoading=false
      if (requestSeq === state._fetchDocsSeq) {
        state.isLoading.value = false
      }
    }
  }
}

/**
 * 功能 (What): 删除指定文档
 * 输入 (Input): 状态引用对象
 * 输出 (Output): 异步函数
 * 副作用 (Side-effects): 调用删除API，刷新文档列表
 */
export function createDeleteDocument(state, fetchDocuments) {
  return async function deleteDocument(kbId, documentId) {
    try {
      await knowledgeBaseService.deleteDocument(kbId, documentId)

      // 说明：删除成功后先做一次本地同步，让“文档数量/列表”立即响应；
      // 随后再 fetchDocuments 拉取后端最终结果做校准（防止本地与后端短暂不一致）。
      if (
        state &&
        state.currentKbId &&
        state.currentKbId.value === kbId &&
        Array.isArray(state.documents.value)
      ) {
        state.documents.value = state.documents.value.filter((d) => d && d.id !== documentId)
      }

      await fetchDocuments(kbId)
    } catch (err) {
      console.error(`[Store] 删除文档时发生错误:`, err)
      throw err
    }
  }
}

/**
 * 功能 (What): 继续解析 PDF partial 文档的失败页。
 * 输入 (Input): 知识库 ID 与文档 ID
 * 输出 (Output): 后端增量续跑结果
 * 副作用 (Side-effects): 调用后端续跑接口，并刷新当前知识库文档列表
 */
export function createContinueFailedPdfPages(state, fetchDocuments) {
  return async function continueFailedPdfPages(kbId, documentId) {
    if (!kbId || !documentId) return null
    try {
      const result = await knowledgeBaseService.continueFailedPdfPages(kbId, documentId, {
        pdfOcrModelId: readEffectiveModelPurposeBinding('pdf_ocr'),
        embeddingModelId: readEffectiveModelPurposeBinding('embedding'),
      })
      await fetchDocuments(kbId)
      return result
    } catch (err) {
      console.error('[KnowledgeBase Store] 继续解析 PDF 失败页失败:', err)
      throw err
    }
  }
}

/**
 * 功能 (What): 更新知识库模型设置
 * 输入 (Input): 状态引用对象
 * 输出 (Output): 异步函数
 * 副作用 (Side-effects): 更新知识库设置，修改knowledgeBases状态
 */
export function createUpdateKbModelSettings(state) {
  return async function updateKbModelSettings(kbId, settings) {
    if (!kbId) return
    try {
      const updatedKb = await knowledgeBaseService.updateKbSettings(kbId, settings)
      
      const index = state.knowledgeBases.value.findIndex(kb => kb.id === kbId)
      if (index !== -1) {
        state.knowledgeBases.value[index] = { ...state.knowledgeBases.value[index], ...updatedKb }
      }
    } catch (err) {
      state.error.value = resolveCurrentKnowledgeBaseMessage('knowledgeBase.store.error.updateModelSettingsFailed')
      throw err 
    }
  }
}

/**
 * 功能 (What): 删除指定知识库
 * 输入 (Input): 状态引用对象
 * 输出 (Output): 异步函数
 * 副作用 (Side-effects): 调用删除API，更新 knowledgeBases 和 currentKbId 状态
 */
export function createDeleteKnowledgeBase(state) {
  return async function deleteKnowledgeBase(kbId) {
    if (!kbId) return
    try {
      await knowledgeBaseService.deleteKnowledgeBase(kbId)

      // 从本地列表移除对应知识库
      state.knowledgeBases.value = state.knowledgeBases.value.filter(
        (kb) => kb.id !== kbId
      )

      // 如果当前选中的是被删除的知识库，则清空当前选择，回到列表视图
      if (state.currentKbId.value === kbId) {
        state.currentKbId.value = null
        state.documents.value = []
      }
    } catch (err) {
      console.error('[KnowledgeBase Store] 💥 删除知识库失败:', err)
      state.error.value = resolveCurrentKnowledgeBaseMessage('knowledgeBase.store.error.deleteKnowledgeBaseFailed')
      throw err
    }
  }
}
