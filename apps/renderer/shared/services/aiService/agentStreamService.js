import { getApiBaseUrl, determineModelId, apiFetch } from './common';
import { PromptKeys, TABLE_AI_FILL_PROMPT_KEY } from '@app/schemas';

/**
 * 安全地调用回调函数，捕获并记录任何异常
 * @param {Function} callback - 要调用的回调函数
 * @param {any} arg - 传递给回调函数的参数
 * @param {string} callbackName - 回调函数名称，用于错误日志
 */
function safelyCallCallback(callback, arg, callbackName) {
  if (typeof callback === 'function') {
    try {
      callback(arg);
    } catch (error) {
      console.error(`[agentStreamService] Error in ${callbackName} callback:`, error);
      // 继续处理，不中断流程
    }
  }
}

/**
 * Calls the agent service and streams back structured events via Server-Sent Events (SSE).
 * This function is specifically designed to handle the multi-event format from the agent endpoint.
 *
 * @param {object} requestBody - The request payload, conforming to the AgentInvokeRequest schema from the backend.
 * @param {object} callbacks - An object containing callback functions for different event types.
 * @param {function(string): void} [callbacks.onTextChunk] - Callback for streaming text chunks from the LLM.
 * @param {function(object): void} [callbacks.onThought] - Callback for 'thought' events. The data is the parsed JSON payload.
 * @param {function(object): void} [callbacks.onToolCall] - Callback for 'tool_call' events.
 * @param {function(object): void} [callbacks.onToolOutput] - Callback for 'tool_output' events.
 * @param {function(object): void} [callbacks.onFinalAnswer] - Callback for 'final_answer' events.
 * @param {function(object): void} [callbacks.onError] - Callback for 'error' events.
 * @param {function(): void} [callbacks.onStreamEnd] - Callback when the stream ends for any reason.
 * @param {object} options - Additional fetch options.
 * @param {AbortSignal | null} [options.signal=null] - AbortSignal to cancel the request.
 * @returns {Promise<void>} A promise that resolves when the stream is fully processed or throws on critical error.
 */
export async function streamAgentEvents(requestBody, callbacks = {}, options = {}) {
  const { signal = null } = options;
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}/api/v1/agent/invoke`;

  // 🔥 使用与 unifiedApiService.js 相同的模型选择逻辑
  const promptKey = requestBody.promptKey || PromptKeys.DEFAULT;
  const originalModelId = requestBody.model_id;
  const determinedModelId = determineModelId(promptKey);
  const finalModelId = originalModelId ?? determinedModelId;
  if (finalModelId !== null && finalModelId !== undefined) {
    requestBody.model_id = finalModelId;
  } else {
    delete requestBody.model_id;
  }
  
  console.log('[agentStreamService] 模型选择调试信息:', {
    promptKey,
    originalModelId,
    determinedModelId,
    finalModelId,
    requestBody: JSON.stringify(requestBody, null, 2)
  });

  try {
    const response = await apiFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
      signal: signal,
    });

    if (!response.ok) {
      let errorDetails = `HTTP error ${response.status}`;
      try {
        errorDetails = await response.text();
      } catch (e) { /* ignore */ }
      throw new Error(errorDetails);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        if (signal?.aborted) {
            reader.cancel('Request aborted by user');
            throw new DOMException('Request aborted by user', 'AbortError');
        }

        const { done, value } = await reader.read();
        if (done) {
            safelyCallCallback(callbacks.onStreamEnd, undefined, 'onStreamEnd');
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // SSE messages are separated by double newlines.
        let eolIndex;
        while ((eolIndex = buffer.indexOf('\n\n')) !== -1) {
            const messageBlock = buffer.slice(0, eolIndex);
            buffer = buffer.slice(eolIndex + 2); // Consume message and the two newlines.
            
            let eventType = 'agent_event'; // Default event type.
            let eventData = '';

            const lines = messageBlock.split('\n');
            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    eventType = line.substring(7).trim();
                } else if (line.startsWith('data: ')) {
                    // The rest of the line is the data.
                    eventData += line.substring(6);
                }
            }

            if (eventData) {
                try {
                    const jsonData = JSON.parse(eventData);
                    
                    // Route event to the specific callback.
                    switch(eventType) {
                        case 'thought':
                            safelyCallCallback(callbacks.onThought, jsonData, 'onThought');
                            break;
                        case 'tool_call':
                            safelyCallCallback(callbacks.onToolCall, jsonData, 'onToolCall');
                            break;
                        case 'tool_output':
                            safelyCallCallback(callbacks.onToolOutput, jsonData, 'onToolOutput');
                            break;
                        // tool_execution 事件已废弃，后端不再发送此事件
                        // 现在使用分离的 tool_call 和 tool_output 事件
                        case 'final_answer':
                             // 这是后端发送的最终答案的占位事件，内容通过 markdown_chunk 流式发送
                             // 我们可以选择在这里触发一个信号，但主要内容处理在 markdown_chunk
                            break;
                        case 'markdown_chunk':
                            // 🔥 核心修改：将流式内容块重命名为 onTextChunk 以统一接口
                            safelyCallCallback(callbacks.onTextChunk, jsonData.text, 'onTextChunk');
                            break;
                        case 'error':
                            safelyCallCallback(callbacks.onError, jsonData, 'onError');
                            break;
                        case 'stream_control':
                             if (jsonData.type === 'end_of_stream') {
                                 safelyCallCallback(callbacks.onStreamEnd, undefined, 'onStreamEnd');
                             }
                             break;
                        default:
                            // Generic handler for any unhandled events.
                            safelyCallCallback(callbacks.onEvent, { type: eventType, data: jsonData }, 'onEvent');
                            break;
                    }
                } catch(e) {
                    console.error(`[AIService/agentStream] Error parsing SSE data: ${e}`, eventData);
                }
            }
        }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(`[AIService/agentStream] Critical error during agent stream for key ${requestBody.prompt_key}:`, error);
      safelyCallCallback(callbacks.onError, { error: "Stream setup failed or was aborted", details: error.message }, 'onError');
    } else {
      console.log(`[AIService/agentStream] Stream for key ${requestBody.prompt_key} was intentionally aborted.`);
    }
    safelyCallCallback(callbacks.onStreamEnd, undefined, 'onStreamEnd'); // Ensure stream end is always called on error.
    throw error;
  }
}
