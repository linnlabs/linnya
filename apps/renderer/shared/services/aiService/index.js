// ==================== 推荐使用的统一API ====================
export { generateText, generateTextStream } from './unifiedApiService';

// ==================== 其他工具函数 ====================
export { fetchOllamaModels } from './ollamaService';

// ==================== 废弃说明 ====================
// 以下函数已被移除，请使用新的统一API：
// - generateTextNonStreaming → 使用 generateText
// - startSseStreaming → 使用 generateTextStream  
// - stopSseStreaming → 使用 AbortController
// - generateTextPlainTextStreaming → 使用 generateTextStream
// - testApiConnection → 直接调用 /api/v1/health

// 你可以在此按需导出 common.js 中的内容，如果外部模块需要直接访问它们
// export { API_BASE_URL, determineModelId } from './common'; 