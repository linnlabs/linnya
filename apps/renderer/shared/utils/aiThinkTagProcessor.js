// src/renderer/shared/utils/aiThinkTagProcessor.js

/**
 * @file aiThinkTagProcessor.js
 * @description
 * 本文件提供了一个专门用于预处理 AI 流式文本块的工具，其核心目标是识别、提取并分离出
 * AI 在生成内容时可能附带的"思考过程"或"元指令"。这些特殊指令通常被包裹在
 * `<think>...</think>` 标签内。
 *
 * --- 何时使用 ---
 * 当您集成的 AI 服务在输出内容时，可能会在实际文本之间插入用 `<think>...</think>` 标签
 * 包裹的中间步骤、推理过程或元数据时，应使用此处理器。
 *
 * --- 如何定位在数据流中 ---
 * 此处理器应作为从 AI 服务接收到原始文本流（chunk）后的【第一个】处理环节。
 * 它的输出（分离后的"思考片段"和"内容片段"）随后可以被传递到不同模块进行后续处理：
 *  - 对于【表格AI填充】等场景：分离出的"内容片段"可以直接用于更新单元格；"思考片段"可由对应业务决定是否展示。
 *  - 对于【通用AI撰写】等场景：分离出的"内容片段"后续可能需要送入更复杂的解析器（如 WASM Markdown 解析器）进行渲染；
 *    "思考片段"同样可以用于UI展示。在这些复杂场景下，确保此预处理器在数据进入特定解析器之前运行至关重要。
 *  - 对于不涉及 `<think>` 标签的简单 AI 服务调用，则不需要使用此处理器。
 *
 * --- 功能 ---
 * 通过回调机制，它能实时地将解析出的"思考片段"和"内容片段"分别派发出去，
 * 从而允许上层应用根据需要分别处理或展示这两类信息。
 */

const THINK_START_TAG = '<think>';
const THINK_END_TAG = '</think>';

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
      console.error(`[aiThinkTagProcessor] Error in ${callbackName} callback:`, error);
      // 继续处理，不中断流程
    }
  }
}

/**
 * 清理文本块，移除空行但保持流式特性
 * @param {string} text - 要清理的文本块
 * @returns {string} - 清理后的文本
 */
const cleanChunk = (text) => {
  if (!text) return '';

  // 1) 将所有 \r\n, \r 统一为 \n
  let cleaned = text.replace(/\r\n|\r/g, '\n');

  /*
   * 2) **压缩**连续超过 2 个的换行符到单个 \n。
   *    这样可以去掉"空行"，但不会删除用来分隔段落的单个换行符。
   *    例如：\n\n 或 \n\n\n -> \n
   */
  cleaned = cleaned.replace(/\n{2,}/g, '\n');

  return cleaned;
};

/**
 * 创建一个 AI 文本块预处理器实例，专门用于处理 <think> 标签。
 *
 * @param {object} callbacks - 回调函数对象。
 * @param {(thinkSegment: string) => void} callbacks.onThinkSegment - 当提取到"思考过程"的片段（<think>标签内部内容）时调用。
 * @param {(contentSegment: string) => void} callbacks.onContentSegment - 当提取到常规"内容"的片段（<think>标签外部内容）时调用。
 * @param {(isThinking: boolean) => void} [callbacks.onThinkStateChange] - 可选：当处理器进入或退出 <think> 块时调用，用于状态通知。
 * @returns {object} 返回一个包含 `process`、`flush` 和 `reset` 方法的对象，用于控制处理流程。
 */
export function createAiThinkTagProcessor({ onThinkSegment, onContentSegment, onThinkStateChange }) {
  let buffer = ''; // 内部缓冲区，用于累积接收到的、尚未完全解析的文本块
  let isInsideThinkBlock = false; // 状态标记：当前是否正在解析 <think>...</think> 块内部的文本

  // 内部函数：更新当前是否处于"思考块"内部的状态，并在状态实际改变时触发 onThinkStateChange 回调
  const setThinkState = (newState) => {
    if (newState !== isInsideThinkBlock) {
      isInsideThinkBlock = newState;
      safelyCallCallback(onThinkStateChange, isInsideThinkBlock, 'onThinkStateChange');
    }
  };

  /**
   * 处理一个新接收到的文本块 (chunk)。
   * 这是处理器的核心方法，应在每次从 AI 流接收到数据时调用。
   * @param {string} chunk - 从 AI 服务接收到的原始文本块。
   */
  function process(chunk) {
    try {
      // console.log(`[process] Received chunk:`, JSON.stringify(chunk));
      buffer += chunk; // 将新块追加到内部缓冲区

      // 循环处理缓冲区，直到缓冲区内容无法进一步被立即解析
      while (true) {
        if (isInsideThinkBlock) {
          // 当前状态：正在解析 <think> 块内部
          const endTagIndex = buffer.indexOf(THINK_END_TAG);
          if (endTagIndex !== -1) {
            // 找到了结束标签：处理think内容并切换状态
            const thinkContent = buffer.substring(0, endTagIndex);
            const cleanedContent = cleanChunk(thinkContent);
            if (cleanedContent) {
              safelyCallCallback(onThinkSegment, cleanedContent, 'onThinkSegment');
            }
            buffer = buffer.substring(endTagIndex + THINK_END_TAG.length);
            setThinkState(false);
          } else {
            // 未找到结束标签：这意味着当前chunk都是think内容
            // 流式发送这部分内容，保持实时性
            if (buffer) {
              const cleanedContent = cleanChunk(buffer);
              if (cleanedContent) {
                safelyCallCallback(onThinkSegment, cleanedContent, 'onThinkSegment');
              }
              buffer = ''; // 清空缓冲区
            }
            break;
          }
        } else {
          // 当前状态：正在解析 <think> 块外部（即常规内容）
          const startTagIndex = buffer.indexOf(THINK_START_TAG);
          if (startTagIndex !== -1) {
            // 找到了开始标签：处理前面的常规内容并切换状态
            const contentBeforeThink = buffer.substring(0, startTagIndex);
            if (contentBeforeThink) {
              const cleanedContent = cleanChunk(contentBeforeThink);
              if (cleanedContent) {
                safelyCallCallback(onContentSegment, cleanedContent, 'onContentSegment');
              }
            }
            buffer = buffer.substring(startTagIndex + THINK_START_TAG.length);
            setThinkState(true);
          } else {
            // 未找到开始标签：这意味着当前chunk都是常规内容
            // 流式发送这部分内容，保持实时性
            if (buffer) {
              const cleanedContent = cleanChunk(buffer);
              if (cleanedContent) {
                safelyCallCallback(onContentSegment, cleanedContent, 'onContentSegment');
              }
              buffer = ''; // 清空缓冲区
            }
            break;
          }
        }
      }
    } catch (error) {
      console.error('[aiThinkTagProcessor] Error in process method:', error);
      // 继续处理，不中断流程
    }
  }

  /**
   * 清理并处理缓冲区中任何剩余的文本。
   * 当确认 AI 数据流已完全结束时（例如，`reader.read()` 的 `done` 为 `true`），应调用此方法，
   * 以确保所有接收到的数据都得到恰当处理。
   */
  function flush() {
    try {
      // console.log(`[flush] Flushing remaining buffer:`, JSON.stringify(buffer));
      if (buffer.length > 0) {
        const cleanedContent = cleanChunk(buffer);
        if (cleanedContent) {
          if (isInsideThinkBlock) {
            safelyCallCallback(onThinkSegment, cleanedContent, 'onThinkSegment');
          } else {
            safelyCallCallback(onContentSegment, cleanedContent, 'onContentSegment');
          }
        }
        buffer = '';
      }
      setThinkState(false);
    } catch (error) {
      console.error('[aiThinkTagProcessor] Error in flush method:', error);
    }
  }

  /**
   * 重置处理器的内部状态（缓冲区和"是否在思考块内"的标记）。
   * 如果同一个处理器实例需要在不同AI调用之间复用（例如，在一个循环中处理多个独立的流式响应），
   * 则在每次新的处理开始前，应调用此方法。
   */
  function reset() {
    try {
      buffer = '';
      setThinkState(false);
    } catch (error) {
      console.error('[aiThinkTagProcessor] Error in reset method:', error);
    }
  }

  // 返回包含核心处理方法的对象，供外部调用
  return { process, flush, reset };
}
