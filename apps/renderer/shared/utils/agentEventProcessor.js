import { streamAgentEvents } from '../services/aiService/agentStreamService';
import { createAnswerComposer } from './answerComposer';

/**
 * @typedef {'thought' | 'tool_call' | 'tool_output' | 'final_answer' | 'error'} AgentStepType
 */

/**
 * @typedef {object} AgentStep
 * @property {AgentStepType} type - The type of the event.
 * @property {any} content - The payload of the event.
 */

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
      console.error(`[agentEventProcessor] Error in ${callbackName} callback:`, error);
      // 继续处理，不中断流程
    }
  }
}

/**
 * A utility to process structured event streams from an AI Agent.
 * It acts as an adapter, converting raw agent events into structured "steps" 
 * that are easy for UI components to consume.
 *
 * 解耦与策略说明：
 * - 在 shared 层引入 AnswerComposer（无副作用、无框架依赖），用于统一“思考/答案”的拼接与收敛策略。
 * - 本处理器仅负责：事件转译 + 调用 composer 更新内部累积文本 + 触发上层回调（onAgentStep/onContentSegment 等）。
 * - 不引入 features 层依赖，保持 shared → features 的单向依赖关系。
 *
 * @param {object} callbacks - An object for handling processed events.
 * @param {(step: AgentStep) => void} callbacks.onAgentStep - Called for each discrete step from the agent (thought, tool call, etc.).
 * @param {(finalContent: string) => void} callbacks.onFinalContent - Called only for the agent's final answer string.
 * @param {(contentSegment: string) => void} [callbacks.onContentSegment] - Optional: Called for each segment of the agent's final answer content.
 * @param {(error: Error) => void} callbacks.onError - Called when a stream or processing error occurs.
 * @param {() => void} callbacks.onStreamEnd - Called when the entire event stream is finished.
 * @returns {function(object, object): Promise<void>} A function that takes a requestBody and options, and starts the process.
 */
export function createAgentEventProcessor({ onAgentStep, onFinalContent, onContentSegment, onError, onStreamEnd }) {
  // 统一拼接策略：共享的 AnswerComposer 状态机
  const composer = createAnswerComposer();
  
  // Agent模式下用于累积当前阶段思考内容的变量（供 UI 观察用）
  let currentThoughtSegment = '';
  let currentThoughtStepId = null;
  let stepIdCounter = 0;

  // 结束当前思考阶段（重置本地可视变量 + 通知 composer 收敛）
  function finalizeCurrentThought() {
    try {
      if (currentThoughtSegment && currentThoughtStepId) {
        currentThoughtSegment = '';
        currentThoughtStepId = null;
      }
      composer.finalizeThought();
    } catch (error) {
      console.error('[agentEventProcessor] Error in finalizeCurrentThought:', error);
    }
  }
  
  /**
   * 重置处理器内部所有状态，为一次全新的、可能包含多步骤的AI任务做准备。
   */
  function reset() {
    currentThoughtSegment = '';
    currentThoughtStepId = null;
    stepIdCounter = 0;
    composer.finalizeThought();
    composer.finalizeAnswer();
  }

  /**
   * Starts one turn of the agent event streaming and processing.
   * Does NOT reset the state, allowing for continuous multi-turn conversations.
   * @param {object} requestBody - The request payload for the agent service.
   * @param {object} options - Additional fetch options, like the AbortSignal.
   * @param {AbortSignal | null} [options.signal=null] - AbortSignal to cancel the request.
   */
  async function start(requestBody, options = {}, turnContext = {}) {
    // **重要**: 此处不再重置状态，以支持连续对话
    
    try {
      await streamAgentEvents(
        requestBody,
        {
          onThought: (data) => {
            try {
              // 🔥 后端发送的思考事件格式为 {type: 'thought', content: thought}
              if (data.content) {
                // 与 thinkProcessor 的 onThinkSegment 行为保持一致
                const prevContent = currentThoughtSegment || null;
                const { shouldCreate, mergedContent } = composer.updateThought(prevContent, data.content, true);

                if (shouldCreate || !currentThoughtStepId) {
                  currentThoughtSegment = mergedContent;
                  currentThoughtStepId = `thought-${++stepIdCounter}`;
                  safelyCallCallback(onAgentStep, { 
                    type: 'thought', 
                    content: currentThoughtSegment,
                    id: currentThoughtStepId
                  }, 'onAgentStep');
                } else {
                  currentThoughtSegment = mergedContent;
                  safelyCallCallback(onAgentStep, { 
                    type: 'thought_update', 
                    content: currentThoughtSegment,
                    id: currentThoughtStepId
                  }, 'onAgentStep');
                }
              }
            } catch (error) {
              console.error('[agentEventProcessor] Error in onThought handler:', error);
            }
          },
          // onToolExecution 已废弃：后端现在发送独立的 tool_call 和 tool_output 事件
          onToolCall: (data) => {
            try {
              // 工具调用发生时，结束当前思考阶段（同步 composer 收敛）
              composer.onInterruptByToolOrFinal();
              finalizeCurrentThought();
              
              // 保留原始的工具调用数据供组件使用
              safelyCallCallback(onAgentStep, { 
                type: 'tool_call', 
                content: `调用工具: \`${data.tool_name}\``,
                id: `tool-call-${++stepIdCounter}`,
                metadata: {
                  tool_name: data.tool_name,
                  tool_args: data.tool_args || {}
                }
              }, 'onAgentStep');
            } catch (error) {
              console.error('[agentEventProcessor] Error in onToolCall handler:', error);
            }
          },
          onToolOutput: (data) => {
            try {
              const outputString = typeof data.output === 'object' 
                ? JSON.stringify(data.output, null, 2) 
                : String(data.output);
              
              // 工具输出不直接拼接答案，仅转发给上层
              safelyCallCallback(onAgentStep, { 
                type: 'tool_output', 
                content: outputString,
                id: `tool-output-${++stepIdCounter}`,
                metadata: { tool_name: data.tool_name }
              }, 'onAgentStep');
            } catch (error) {
              console.error('[agentEventProcessor] Error in onToolOutput handler:', error);
            }
          },
          onFinalAnswer: (data) => {
            try {
              // 最终答案前，结束当前思考阶段（同步 composer 收敛）
              composer.onInterruptByToolOrFinal();
              finalizeCurrentThought();
              
              // 最终答案内容交由上层处理（内容已通过 onTextChunk -> onContentSegment 流式传递）
              const finalContentCallback = turnContext.onFinalContent || onFinalContent;
              safelyCallCallback(finalContentCallback, data.answer || '', 'onFinalContent');

            } catch (error) {
              console.error('[agentEventProcessor] Error in onFinalAnswer handler:', error);
            }
          },
          onError: (data) => {
            try {
              // 错误发生时，结束当前思考阶段（同步 composer 收敛）
              composer.onInterruptByToolOrFinal();
              finalizeCurrentThought();
              
              const errorMessage = data.details || data.error || 'Agent execution failed';
              const errorCallback = turnContext.onError || onError;
              safelyCallCallback(errorCallback, new Error(errorMessage), 'onError');

              // Also bubble this up as a step for visibility in the UI
              safelyCallCallback(onAgentStep, { 
                type: 'error', 
                content: errorMessage,
                id: `error-${++stepIdCounter}`
              }, 'onAgentStep');
            } catch (error) {
              console.error('[agentEventProcessor] Error in onError handler:', error);
            }
          },
          onStreamEnd: () => {
            try {
              // 流结束时，确保当前思考阶段结束
              finalizeCurrentThought();

              const streamEndCallback = turnContext.onStreamEnd || onStreamEnd;
              safelyCallCallback(streamEndCallback, undefined, 'onStreamEnd');

            } catch (error) {
              console.error('[agentEventProcessor] Error in onStreamEnd handler:', error);
            }
          }
        },
        options
      );
    } catch (error) {
       if (error.name !== 'AbortError') {
         console.error('[AgentEventProcessor] Critical error:', error);
         const errorCallback = turnContext.onError || onError;
         safelyCallCallback(errorCallback, error, 'onError');
       }
       // 重置状态
       finalizeCurrentThought();
       const streamEndCallback = turnContext.onStreamEnd || onStreamEnd;
       safelyCallCallback(streamEndCallback, undefined, 'onStreamEnd');
    }
  }

  // Return the start function to be called by the consumer.
  return { start, reset };
} 