/**
 * @file documentLoaderService.js
 * @description 统一的文档加载服务，支持多种文档类型的加载策略
 * 
 * 架构设计：
 * - 使用策略模式，每种文档类型有独立的加载器
 * - 通过工厂方法根据文档元数据选择合适的加载器
 * - 易于扩展新的文档类型
 */

import { ref } from 'vue';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import { loadDocumentFromDatabase } from '@/domains/editor/services/editorService';
import { resolveCurrentEditorMessage } from '@/domains/editor/functions/resolveCurrentEditorMessage';

/**
 * 标准 Markdown 文档加载器
 */
class MarkdownDocumentLoader {
  constructor() {
    this.type = 'markdown';
  }

  /**
   * 加载文档
   * @param {Object} params
   * @param {string} params.documentId - 文档ID
   * @param {string} params.documentName - 文档名称
   * @param {Object} params.editor - Tiptap 编辑器实例
   * @param {Object} params.stores - Pinia stores 集合
   * @returns {Promise<void>}
   */
  async load({ documentId, documentName, editor, stores, throwIfCancelled }) {
    console.log(`[MarkdownDocumentLoader] Loading document ${documentId} (${documentName})`);

    try {
      throwIfCancelled?.();
      const documentResult = await workspaceGateway['read-document']({ documentId });
      throwIfCancelled?.();

      if (!documentResult?.success) {
        throw new Error(documentResult?.error || 'read-document failed');
      }
      // Annotation 已内嵌在 content_json 的 rootBlock attrs 中。
      const documentData = {
        documentInfo: { id: documentId, name: documentName },
        content: documentResult.data?.content,
        pendingRevisions: documentResult.data?.pendingRevisions || [],
      };

      // 构造 stores 对象
      const storesWithAnnotation = {
        ...stores,
        annotationStore: ref(editor.annotationStore),
      };

      // 调用编辑器服务加载文档
      loadDocumentFromDatabase({ editor, stores: storesWithAnnotation, documentData });

      console.log(`[MarkdownDocumentLoader] Document ${documentId} loaded successfully`);
    } catch (error) {
      console.error(`[MarkdownDocumentLoader] Failed to load document ${documentId}:`, error);
      throw error;
    }
  }
}

/**
 * 文档加载器工厂
 * 根据文档类型返回对应的加载器实例
 */
class DocumentLoaderFactory {
  constructor() {
    this.loaders = new Map();
    this._registerDefaultLoaders();
  }

  /**
   * 注册默认加载器
   * @private
   */
  _registerDefaultLoaders() {
    this.register('markdown', new MarkdownDocumentLoader());
    // 未来可以添加更多类型：
    // this.register('canvas', new CanvasDocumentLoader());
    // this.register('database', new DatabaseDocumentLoader());
  }

  /**
   * 注册新的文档加载器
   * @param {string} type - 文档类型
   * @param {Object} loader - 加载器实例
   */
  register(type, loader) {
    this.loaders.set(type, loader);
    console.log(`[DocumentLoaderFactory] Registered loader for type: ${type}`);
  }

  /**
   * 获取指定类型的加载器
   * @param {string} type - 文档类型
   * @returns {Object} 加载器实例
   */
  getLoader(type = 'markdown') {
    const loader = this.loaders.get(type);
    if (!loader) {
      console.warn(`[DocumentLoaderFactory] No loader found for type "${type}", using default markdown loader`);
      return this.loaders.get('markdown');
    }
    return loader;
  }
}

// 单例工厂实例
const loaderFactory = new DocumentLoaderFactory();

/**
 * 主文档加载服务
 * 提供统一的文档加载接口
 */
export class DocumentLoaderService {
  constructor() {
    this.factory = loaderFactory;
  }

  /**
   * 加载文档
   * @param {Object} params
   * @param {string} params.documentId - 文档ID
   * @param {string} params.documentName - 文档名称
   * @param {Object} params.editor - Tiptap 编辑器实例
   * @param {Object} params.stores - Pinia stores 集合 { fileStore, uiStore, notificationStore }
   * @param {string} [params.documentType='markdown'] - 文档类型
   * @returns {Promise<void>}
   */
  async loadDocument({ documentId, documentName, editor, stores, documentType = 'markdown', throwIfCancelled }) {
    console.log(`[DocumentLoaderService] Loading document ${documentId} (${documentName}) of type ${documentType}`);

    if (!documentId) {
      throw new Error('documentId is required');
    }
     if (!documentName) {
      throw new Error('documentName is required');
    }
    if (!editor) {
      throw new Error('editor instance is required');
    }
    if (!stores) {
      throw new Error('stores are required');
    }

    const loader = this.factory.getLoader(documentType);
    
    try {
      await loader.load({ documentId, documentName, editor, stores, throwIfCancelled });
    } catch (error) {
      console.error(`[DocumentLoaderService] Failed to load document ${documentId}:`, error);
      stores.notificationStore?.show(
        resolveCurrentEditorMessage('editor.service.loadFileFailed', { errorMessage: error.message }),
        'error'
      );
      throw error;
    }
  }

  /**
   * 注册自定义文档加载器
   * @param {string} type - 文档类型
   * @param {Object} loader - 加载器实例（需实现 load 方法）
   */
  registerLoader(type, loader) {
    this.factory.register(type, loader);
  }
}

// 导出单例
export const documentLoaderService = new DocumentLoaderService();
