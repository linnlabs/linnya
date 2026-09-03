/**
 * @file apps/renderer/features/KnowledgeBase/stores/knowledgeBase/utils.js
 * 
 * @brief 知识库Store工具函数
 * 
 * @description
 * 功能 (What): 提供知识库Store相关的纯函数工具
 * 输入 (Input): 各种查询参数和格式化需求
 * 输出 (Output): 格式化结果和查询结果
 * 副作用 (Side-effects): 无，纯函数
 */

/**
 * 功能 (What): 根据ID查找知识库
 * 输入 (Input): 知识库ID和知识库列表
 * 输出 (Output): 匹配的知识库对象或null
 * 副作用 (Side-effects): 无
 */
export function getKnowledgeBaseById(knowledgeBases, id) {
  if (!Array.isArray(knowledgeBases)) {
    console.warn('[KnowledgeBase Utils] knowledgeBases is not an array:', knowledgeBases)
    return null
  }
  return knowledgeBases.find(kb => kb.id === id) || null
}

/**
 * 功能 (What): 根据ID查找文档
 * 输入 (Input): 文档ID和文档列表
 * 输出 (Output): 匹配的文档对象或null
 * 副作用 (Side-effects): 无
 */
export function getDocumentById(documents, id) {
  if (!Array.isArray(documents)) {
    console.warn('[KnowledgeBase Utils] documents is not an array:', documents)
    return null
  }
  return documents.find(doc => doc.id === id) || null
}

/**
 * 功能 (What): 根据知识库ID获取名称
 * 输入 (Input): 知识库ID和知识库列表
 * 输出 (Output): 知识库名称或默认文本
 * 副作用 (Side-effects): 无
 */
export function getKbNameById(knowledgeBases, id, fallbackName = 'Unknown knowledge base') {
  const kb = getKnowledgeBaseById(knowledgeBases, id);
  return kb ? kb.name : fallbackName;
}

/**
 * 功能 (What): 格式化文件大小
 * 输入 (Input): 字节数
 * 输出 (Output): 人类可读的文件大小字符串
 * 副作用 (Side-effects): 无
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
