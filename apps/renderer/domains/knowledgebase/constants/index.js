// src/renderer/features/KnowledgeBase/constants/index.js
//
// 知识库特性模块的常量定义

/**
 * 支持的文件类型
 */
export const SUPPORTED_FILE_TYPES = [
  // 文档
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.txt',
  '.md',
  // 图片
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif'
]

/**
 * 文件上传状态常量
 */
export const UPLOAD_STATUS = {
  PENDING: 'pending',      // 等待中
  PROCESSING: 'processing', // 处理中（包含上传和解析）
  COMPLETED: 'completed',  // 已完成
  DUPLICATE: 'duplicate',  // 重复文件
  FAILED: 'failed'         // 失败
};

/**
 * 文件上传状态显示文本映射
 */
// [REFACTOR] 此常量已无用，因为消息现在由后端直接提供。

/**
 * 默认配置
 */
export const DEFAULT_CONFIG = {
  POLLING_INTERVAL: 1000, // 任务状态轮询间隔（毫秒）
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 最大文件大小（100MB）
  OLLAMA_DEFAULT_URL: 'http://localhost:11434'
}

/**
 * 最大并发上传数
 */
export const MAX_CONCURRENT_UPLOADS = 4;

// V35 专家方案: 定义后端阶段到前端进度的映射
// 🔥 重构修复：基于实际耗时重新分配进度占比，解析阶段占75%
export const KB_UPLOAD_STAGES = {
  // stage_name: { start: 0-1, end: 0-1 }
  pending:    { start: 0.0,  end: 0.05, weight: 0.05 }, // 等待占5%
  parsing:    { start: 0.05, end: 0.80, weight: 0.75 }, // 解析占75%（PDF解析是最耗时的）
  embedding:  { start: 0.80, end: 0.95, weight: 0.15 }, // 向量化占15%
  storing:    { start: 0.95, end: 1.0,  weight: 0.05 }, // 存储占5%
};
