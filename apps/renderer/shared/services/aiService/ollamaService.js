import { getApiBaseUrl, determineModelId, apiFetch } from './common';
import { OllamaModelFetchError } from './ollamaModelFetchError';

// generateTextNonStreaming 函数已废弃并移除
// 请使用 apps/renderer/shared/services/aiService/unifiedApiService.js 中的 generateText 函数

/**
 * 调用后端代理 API 获取指定 Ollama URL 的可用模型列表。
 *
 * @param {string} ollamaApiUrl - 用户输入的 Ollama 服务 URL (例如 "http://localhost:11434")。
 * @returns {Promise<string[]>} - 返回模型名称的字符串数组。
 * @throws {Error} - 如果 API 请求失败或后端返回错误，则抛出错误。
 */
export async function fetchOllamaModels(ollamaApiUrl) {
  if (!ollamaApiUrl || typeof ollamaApiUrl !== 'string') {
     throw new OllamaModelFetchError({ code: 'INVALID_URL' });
  }

  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}/api/v1/ollama/tags`;
  const requestBody = {
    api_url: ollamaApiUrl,
  };

  // console.log(`[AIService/nonStreaming] 请求 Ollama 模型列表，目标 URL: ${ollamaApiUrl}, 代理端点: ${url}`);

  try {
    const response = await apiFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errorDetail = '';
      try {
        const parsedError = await response.json();
        errorDetail = parsedError.detail || '';
      } catch (parseError) {
         try {
           const textError = await response.text();
           if (textError) {
              errorDetail = textError;
           }
         } catch (textError) {
            console.warn('[AIService/nonStreaming] 读取 Ollama tags 文本错误响应失败:', textError);
         }
         console.warn(`[AIService/nonStreaming] 解析 Ollama tags 错误响应失败:`, parseError);
      }
      throw new OllamaModelFetchError({
        code: 'STATUS_FAILED',
        statusCode: response.status,
        target: ollamaApiUrl,
        detail: errorDetail || undefined,
      });
    }

    const result = await response.json();
    return result.models || [];

  } catch (error) {
    console.error(`[AIService/nonStreaming] 调用 fetchOllamaModels 时出错:`, error);
    if (error instanceof OllamaModelFetchError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new OllamaModelFetchError({
        code: 'CONNECTION_FAILED',
        target: ollamaApiUrl,
        detail: error.message,
      });
    }
    throw error;
  }
}

// testApiConnection 函数已废弃并移除
// 如需测试API连接，请直接调用 /api/v1/health 端点
