/**
 * @file apps/renderer/app/model-inference/orchestration/unifiedApiService.js
 * 
 * @brief 统一的AI API服务，支持新的统一端点
 * 
 * @description
 * 这个服务提供了对新的统一API端点的支持：
 * - POST /api/v1/conversation/next (统一端点，支持 Chat 和 Agent 模式)
 * 
 * 功能：替代原有的多个分散的API调用方式，提供统一的接口
 * 输入：标准化的请求参数
 * 输出：统一格式的响应
 * 副作用：调用后端AI服务
 */

import { getApiBaseUrl, apiFetch } from '../../../shared/services/aiService/common';
import { determineModelId } from './determineModelId';
import { readGenerationEventStream } from './readGenerationEventStream';
import { useAiSettingsStore } from '../../../shared/stores/aiSettings';
import { readPrimaryReasoningEffort } from '@/domains/model-configuration';

function resolveReasoningEffort(requestParams) {
  if (requestParams.reasoning_effort !== null && requestParams.reasoning_effort !== undefined) {
    return requestParams.reasoning_effort;
  }
  return readPrimaryReasoningEffort() ?? undefined;
}

/**
 * 统一的非流式AI生成请求
 * 
 * @description
 * 功能：调用新的统一非流式生成端点
 * 输入：包含prompt、prompt_key等的请求对象
 * 输出：Promise，解析为包含generated_text的响应对象
 * 副作用：调用后端AI服务
 * 
 * @param {Object} requestParams - 请求参数
 * @param {string} requestParams.prompt - 用户输入的提示词
 * @param {string} [requestParams.prompt_key='default'] - 任务类型标识
 * @param {string} [requestParams.model_id] - 模型ID（可选，会自动推断）
 * @param {string} [requestParams.context_before] - 前文上下文
 * @param {string} [requestParams.context_after] - 后文上下文
 * @param {string} [requestParams.current_block_content] - 当前块内容
 * @param {string} [requestParams.document_fragment] - 文档片段（侧边栏对话用）
 * @param {Array<{kind:string,content:string,attrs?:Object,metadata?:Object}>} [requestParams.fences] - 结构化上下文围栏
 * @param {AbortSignal} [signal] - 用于取消请求的信号
 * @returns {Promise<{generated_text: string}>} AI生成的响应
 */
export async function generateText(requestParams, signal = null) {
  const {
    prompt,
    prompt_key = 'default',
    mode = 'agent',
    model_id,
    context_before,
    context_after,
    current_block_content,
    document_fragment,
    fences,
    conversationHistory,
    conversationId,
    turn_id,
    // Review（审阅）扩展字段：仅当 prompt_key === 'review' 时使用
    review_run_id,
    agent_id,
    chunk_index,
    total_chunks,
    review_background,
    review_goal,
    enableTools,
    availableTools,
    persist,
    history_mode,
    run_lane,
    event_visibility,
    // 自动补全增强字段
    completion_length_hint,
    recent_rejections,
    behavior_summary,
    intent_key,
    intent_confidence,
    intent_constraints,
  } = requestParams;

  const finalModelId = model_id ?? determineModelId(prompt_key);
  const reasoning_effort = resolveReasoningEffort(requestParams);
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}/api/v1/conversation/next`;

  // 🔥 新架构：使用统一的 ConversationNextRequest 格式
  const requestBody = {
    conversation_id: conversationId,
    new_events: [{
      type: 'user_input',
      content: prompt,
      timestamp: Date.now(),
      ...(turn_id !== null && turn_id !== undefined && { turn_id }),
      source: 'editor'  // 🔥 修复：使用合法的enum值 'user' | 'editor' | 'system'
    }],
    options: {
      // ⚠️ 关键：Review 必须使用 agent 模式，否则后端会禁用工具（无法落库批注）
      mode,
      promptKey: prompt_key,  // 🔥 修复：使用驼峰式promptKey，与conversationService保持一致
      ...(turn_id !== null && turn_id !== undefined && { turn_id }),
      ...(finalModelId !== null && finalModelId !== undefined && { model_id: finalModelId }),
      ...(reasoning_effort !== null && reasoning_effort !== undefined && { reasoning_effort }),
      // 🔥 修复：过滤掉null值，schema不接受null（只接受string或undefined）
      ...(context_before !== null && context_before !== undefined && { context_before }),
      ...(context_after !== null && context_after !== undefined && { context_after }),
      ...(current_block_content !== null && current_block_content !== undefined && { current_block_content }),
      ...(document_fragment !== null && document_fragment !== undefined && { document_fragment }),
      ...(fences !== null && fences !== undefined && { fences }),
      ...(conversationHistory && { conversationHistory }),
      // Review 的扩展字段（不做 null 透传，保持 schema 严格）
      ...(review_run_id !== null && review_run_id !== undefined && { review_run_id }),
      ...(agent_id !== null && agent_id !== undefined && { agent_id }),
      ...(chunk_index !== null && chunk_index !== undefined && { chunk_index }),
      ...(total_chunks !== null && total_chunks !== undefined && { total_chunks }),
      ...(review_background !== null && review_background !== undefined && { review_background }),
      ...(review_goal !== null && review_goal !== undefined && { review_goal }),

      ...(enableTools !== null && enableTools !== undefined && { enableTools }),
      ...(availableTools !== null && availableTools !== undefined && { availableTools }),
      ...(persist !== null && persist !== undefined ? { persist } : { persist: false }), // 默认不落库
      ...(history_mode !== null && history_mode !== undefined && { history_mode }),
      ...(run_lane !== null && run_lane !== undefined && { run_lane }),
      ...(event_visibility !== null && event_visibility !== undefined && { event_visibility }),
      // 自动补全增强字段
      ...(completion_length_hint !== null && completion_length_hint !== undefined && { completionLengthHint: completion_length_hint }),
      ...(recent_rejections !== null && recent_rejections !== undefined && { recentRejections: recent_rejections }),
      ...(behavior_summary !== null && behavior_summary !== undefined && { behaviorSummary: behavior_summary }),
      ...(intent_key !== null && intent_key !== undefined && { intentKey: intent_key }),
      ...(intent_confidence !== null && intent_confidence !== undefined && { intentConfidence: intent_confidence }),
      ...(intent_constraints !== null && intent_constraints !== undefined && { intentConstraints: intent_constraints }),
    }
  };

  console.log(`[UnifiedAPI] 发送非流式请求到 ${url}:`, requestBody);

  try {
    // 🔥 修复：后端只支持SSE流式响应，所以我们需要在内部使用流式API，但缓冲完整结果
    const response = await apiFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: signal
    });

    if (!response.ok) {
      let errorDetails;
      try {
        const errorText = await response.text();
        errorDetails = errorText || `HTTP ${response.status}`;
      } catch (e) {
        errorDetails = `HTTP ${response.status}`;
      }
      throw new Error(errorDetails);
    }

    // 后端只回 SSE：读完整条流再返回全文。失败（运行报错、未正常收尾）由读取模块抛出，不能当成空文字成功。
    let generatedText = '';
    await readGenerationEventStream(response.body, (event) => {
      if (event.type === 'final_answer_chunk') {
        generatedText += event.chunk;
      } else if (event.type === 'final_answer_reset') {
        // 模型重试会撤回已发出的分片，之后的分片重新开始。
        generatedText = '';
      } else if (event.type === 'final_answer') {
        generatedText = event.content;
      }
    }, signal);

    return {
      generated_text: generatedText
    };

  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`[UnifiedAPI] 非流式请求被取消`);
      throw error;
    } else {
      console.error(`[UnifiedAPI] 非流式请求失败:`, error);
      throw new Error(`Unified API request failed: ${error.message}`);
    }
  }
}

/**
 * 统一的流式AI生成请求 (通过POST方式的SSE)
 * 
 * @description
 * 功能：调用新的统一流式生成端点，使用fetch API处理POST方式的SSE
 * 输入：请求参数和事件回调函数
 * 输出：Promise，在流结束时解析
 * 副作用：调用后端AI服务，触发事件回调
 * 
 * @param {Object} requestParams - 请求参数（同generateText）
 * @param {Object} callbacks - 事件回调函数
 * @param {Function} [callbacks.onOpen] - 连接建立时的回调
 * @param {Function} [callbacks.onTextChunk] - 接收到文本块时的回调
 * @param {Function} [callbacks.onLatexChunk] - 接收到LaTeX块时的回调
 * @param {Function} [callbacks.onThought] - 接收到思考内容时的回调 (新增)
 * @param {Function} [callbacks.onStreamEnd] - 流结束时的回调
 * @param {Function} [callbacks.onError] - 发生错误时的回调
 * @param {Function} [callbacks.onSummarizationStart] - (新增) 摘要开始时的回调
 * @param {Function} [callbacks.onSummarizationEnd] - (新增) 摘要完成时的回调
 * @param {AbortSignal} [signal] - 用于取消请求的信号
 * @returns {Promise<void>} 流处理完成的Promise
 */
export async function generateTextStream(requestParams, callbacks = {}, signal = null) {
  // 🚫 禁用自动补全，防止在AI生成时干扰
  const aiSettings = useAiSettingsStore();
  aiSettings.isProgrammaticallyDisabled = true;
  
  const {
    prompt,
    prompt_key = 'default',
    mode = 'agent',
    model_id,
    context_before,
    context_after,
    current_block_content,
    document_fragment,
    fences,
    conversationHistory,
    conversationId,  // 🔥 新增：支持conversationId参数
    turn_id,
    // Review（审阅）扩展字段：仅当 prompt_key === 'review' 时使用
    review_run_id,
    agent_id,
    chunk_index,
    total_chunks,
    review_background,
    review_goal,
    enableTools,
    availableTools,
    persist,
    history_mode,
  } = requestParams;

  const finalModelId = model_id ?? determineModelId(prompt_key);
  const reasoning_effort = resolveReasoningEffort(requestParams);
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}/api/v1/conversation/next`;

  // 🔥 新架构：使用统一的 ConversationNextRequest 格式
  const requestBody = {
    conversation_id: conversationId,
    new_events: [{
      type: 'user_input',
      content: prompt,
      timestamp: Date.now(),
      ...(turn_id !== null && turn_id !== undefined && { turn_id }),
      source: 'editor'  // 🔥 修复：使用合法的enum值 'user' | 'editor' | 'system'
    }],
    options: {
      // ⚠️ 关键：Review 必须使用 agent 模式，否则后端会禁用工具（无法落库批注）
      mode,
      promptKey: prompt_key,  // 🔥 修复：使用驼峰式promptKey，与conversationService保持一致
      ...(turn_id !== null && turn_id !== undefined && { turn_id }),
      ...(finalModelId !== null && finalModelId !== undefined && { model_id: finalModelId }),
      ...(reasoning_effort !== null && reasoning_effort !== undefined && { reasoning_effort }),
      // 🔥 修复：过滤掉null值，schema不接受null（只接受string或undefined）
      ...(context_before !== null && context_before !== undefined && { context_before }),
      ...(context_after !== null && context_after !== undefined && { context_after }),
      ...(current_block_content !== null && current_block_content !== undefined && { current_block_content }),
      ...(document_fragment !== null && document_fragment !== undefined && { document_fragment }),
      ...(fences !== null && fences !== undefined && { fences }),
      ...(conversationHistory && { conversationHistory }),
      // Review 的扩展字段（不做 null 透传，保持 schema 严格）
      ...(review_run_id !== null && review_run_id !== undefined && { review_run_id }),
      ...(agent_id !== null && agent_id !== undefined && { agent_id }),
      ...(chunk_index !== null && chunk_index !== undefined && { chunk_index }),
      ...(total_chunks !== null && total_chunks !== undefined && { total_chunks }),
      ...(review_background !== null && review_background !== undefined && { review_background }),
      ...(review_goal !== null && review_goal !== undefined && { review_goal }),

      ...(enableTools !== null && enableTools !== undefined && { enableTools }),
      ...(availableTools !== null && availableTools !== undefined && { availableTools }),
      ...(persist !== null && persist !== undefined ? { persist } : { persist: false }), // 默认不落库
      ...(history_mode !== null && history_mode !== undefined && { history_mode }),
    }
  };

  console.log(`[UnifiedAPI] 发送流式请求到 ${url}:`, requestBody);

  try {
    const response = await apiFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: signal
    });

    if (!response.ok) {
      let errorDetails;
      try {
        const errorText = await response.text();
        errorDetails = errorText || `HTTP ${response.status}`;
      } catch (e) {
        errorDetails = `HTTP ${response.status}`;
      }
      throw new Error(errorDetails);
    }

    // 调用连接建立回调
    callbacks.onOpen?.();
    console.log(`[UnifiedAPI] SSE流连接已建立`);

    /*
     * 成功与失败只由整条流的收尾决定：读完且 Host 以 complete 收尾才回调 onStreamEnd；
     * 运行报错或未收尾时读取模块抛错，走下方 catch：回调 onError 并抛出，与 HTTP 失败同一合同。
     */
    let finalAnswer;
    await readGenerationEventStream(response.body, (event) => {
      if (event.type === 'summarization_start') {
        callbacks.onSummarizationStart?.(event);
      } else if (event.type === 'summarization_end') {
        callbacks.onSummarizationEnd?.(event);
      } else if (event.type === 'thought') {
        callbacks.onThought?.(event);
      } else if (event.type === 'final_answer_chunk') {
        if (event.chunk) callbacks.onTextChunk?.(event.chunk);
      } else if (event.type === 'final_answer') {
        finalAnswer = event;
      }
    }, signal);
    callbacks.onStreamEnd?.(finalAnswer);

  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`[UnifiedAPI] 流式请求被用户取消`);
      throw error;
    } else {
      console.error(`[UnifiedAPI] 流式请求失败:`, error);
      callbacks.onError?.(error);
      throw new Error(`Unified streaming API request failed: ${error.message}`);
    }
  } finally {
    // ✅ 重新启用自动补全
    aiSettings.isProgrammaticallyDisabled = false;
  }
}
