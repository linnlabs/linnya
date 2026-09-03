// src/renderer/shared/services/markdownService.js
// 使用wasm解析markdown

import initWasmParser, { parse_markdown as actualParseFunction, StreamingParser } from 'parser-wasm';

let wasmApi = null;
let wasmInitializationError = null;

// +++ 为流式解析器实例添加存储 +++
let activeStreamingParser = null;

// +++ 用于序列化 WASM 流式方法调用的 Promise 链 +++
let streamingProcessingQueue = Promise.resolve();

// 在模块顶层显式调用并等待 WASM 初始化函数
const wasmReadyPromise = (async () => {
  try {
    console.log("[MarkdownService] Attempting to initialize WASM module via explicit init call...");
    await initWasmParser(); // 显式调用并等待默认导出的异步初始化函数
    // 此时，parser_wasm.js 内部的 `wasm`变量应该已经设置好了
    // 并且 #[wasm_bindgen(start)] 应该已经执行

    // 再次进行健全性检查和测试
    if (typeof actualParseFunction === 'function' && typeof StreamingParser === 'function') {
      new StreamingParser(); // 测试构造函数是否可用
      wasmApi = {
        parse: actualParseFunction,
        StreamingParser
      };
      console.log("[MarkdownService] WASM API initialized successfully after explicit init call.");
      return wasmApi; // Promise 解析为 wasmApi
    } else {
      throw new Error("actualParseFunction or StreamingParser not available even after explicit init.");
    }
  } catch (error) {
    console.error("[MarkdownService] Critical error during explicit WASM module initialization:", error);
    wasmInitializationError = error; // 存储错误
    throw error; // 重新抛出，使 wasmReadyPromise reject
  }
})();

async function ensureWasmReady() {
  if (wasmApi) {
    return wasmApi;
  }
  if (wasmInitializationError) {
    // 如果顶层初始化明确失败，则直接抛出该错误
    console.error("[MarkdownService] ensureWasmReady: Re-throwing stored WASM initialization error.");
    throw wasmInitializationError;
  }
  // 等待顶层的 wasmReadyPromise 完成
  // 如果到这里 wasmApi 仍然是 null，说明顶层 Promise reject 了，或者出了意外
  try {
    return await wasmReadyPromise;
  } catch (error) {
    console.error("[MarkdownService] ensureWasmReady: Error awaiting wasmReadyPromise:", error);
    // 应该已经被顶层初始化逻辑的 throw 捕获，但作为双重保险
    throw new Error(`Failed to ensure WASM readiness: ${error.message || error}`);
  }
}

/**
 * Parses Markdown text using WASM (non-streaming).
 * @param {string} markdownText The Markdown text to parse.
 * @param {'blocks' | 'html'} mode The parsing mode.
 * @returns {Promise<Array<object> | string>} Parsed block events or HTML string.
 * @throws {Error} If WASM initialization or parsing fails.
 */
export async function parseMarkdown(markdownText, mode) {
  const api = await ensureWasmReady();
  if (!api || typeof api.parse !== 'function') {
    // 这个错误理论上会被 ensureWasmReady 中的 reject 更早捕获
    throw new Error("WASM parse function is not available.");
  }
  try {
    // This mode calls the legacy parser in rust, not the streaming one.
    return api.parse(markdownText, mode);
  } catch (error) {
    console.error("Error during WASM non-streaming parsing:", error);
    // 重新抛出错误，以便调用者可以处理
    // 可以考虑包装错误信息，提供更多上下文
    throw new Error(`WASM non-streaming parsing failed: ${error.message || error}`);
  }
}

/**
 * 使用 WASM StreamingParser 一次性解析完整 Markdown 文本为 blocks（BlockEvent[]）。
 *
 * 背景：
 * - 当前 `parseMarkdown(text, 'blocks')` 走的是 legacy 解析器（见上方注释），它不支持部分结构（例如 pipe table）。
 * - StreamingParser 才是我们功能更全、与流式渲染一致的解析实现。
 *
 * 重要：
 * - 这里**不复用**全局的 activeStreamingParser，避免与 AI 流式会话互相干扰。
 * - 每次调用都会创建一个独立的 StreamingParser 实例，适合“首开迁移/粘贴解析”等一次性场景。
 *
 * @param {string} markdownText 完整 Markdown 文本
 * @returns {Promise<Array<object>>} BlockEvent 数组
 */
export async function parseMarkdownToBlocksByStreaming(markdownText) {
  const api = await ensureWasmReady();
  if (!api || typeof api.StreamingParser !== 'function') {
    throw new Error('WASM StreamingParser constructor is not available.');
  }

  const parser = new api.StreamingParser();
  // wasm-bindgen 导出的函数可能是同步返回值，但 await 对同步值也安全
  const chunkEvents = await parser.process_chunk(markdownText);
  const finalEvents = await parser.finalize_parsing();

  const a = Array.isArray(chunkEvents) ? chunkEvents : [];
  const b = Array.isArray(finalEvents) ? finalEvents : [];
  return [...a, ...b];
}

/**
 * Initializes a new WASM streaming parser instance.
 * @returns {Promise<StreamingParser>} The new parser instance.
 * @throws {Error} If WASM initialization fails.
 */
export async function initializeNewStreamingParser() {
  const api = await ensureWasmReady();
  // ensureWasmReady 成功后，api 和 api.StreamingParser 应该是有效的
  // 如果 ensureWasmReady 抛出错误，这里不会执行
  if (!api || typeof api.StreamingParser !== 'function') {
    // 此错误理论上不应发生，因为 ensureWasmReady 内部会处理或抛出
    console.error("[MarkdownService] initializeNewStreamingParser: StreamingParser constructor unexpectedly unavailable after ensureWasmReady resolved without error.");
    throw new Error("WASM StreamingParser constructor is critically unavailable.");
  }
  try {
    activeStreamingParser = new api.StreamingParser();
    // +++ 重置序列化队列 +++
    streamingProcessingQueue = Promise.resolve(); 
    console.log("[MarkdownService] New WASM StreamingParser instance created and activated. Queue reset.");
    return activeStreamingParser;
  } catch (error) {
    console.error("Error creating WASM StreamingParser instance:", error);
    throw new Error(`WASM StreamingParser instantiation failed: ${error.message || error}`);
  }
}

/**
 * Processes a chunk of text with the active WASM streaming parser.
 * @param {string} textChunk The chunk of text to process.
 * @returns {Promise<Array<object>>} Parsed block events. Returns empty array on error or if no parser.
 * @throws {Error} If parsing fails.
 */
export async function processChunkWithStreamingParser(textChunk) {
  if (!activeStreamingParser) {
    console.warn("[MarkdownService] No active streaming parser for processChunk. Call initializeNewStreamingParser first.");
    return []; 
  }

  // 将实际的 WASM 调用添加到 Promise 链中
  const resultPromise = streamingProcessingQueue.then(async () => {
    // 再次检查 activeStreamingParser，因为它可能在等待队列时被 finalize 清除
    if (!activeStreamingParser) {
        console.warn("[MarkdownService] Active streaming parser became null before queued processChunk could run.");
        return [];
    }
    try {
      const blockEvents = await activeStreamingParser.process_chunk(textChunk);
      return blockEvents || [];
    } catch (error) {
      console.error('[MarkdownService] Error calling WASM StreamingParser process_chunk in queue:', error);
      // 即使发生错误，也允许后续的 finalize 操作（如果需要）通过队列
      // 但这个特定的 chunk 处理失败了
      throw new Error(`WASM process_chunk failed in queue: ${error.message || error}`);
    }
  });
  // 更新队列为这个新的 Promise，确保下一个操作等待它完成
  streamingProcessingQueue = resultPromise.catch(() => { /* 吞掉错误以允许队列继续，错误已在上面抛出 */ });
  return resultPromise; 
}

/**
 * Finalizes parsing with the active WASM streaming parser and clears the instance.
 * @returns {Promise<Array<object>>} Parsed block events from any remaining buffered text. Returns empty array on error or if no parser.
 * @throws {Error} If finalization fails.
 */
export async function finalizeStreamingParsing() {
  // 捕获调用 finalize时的 activeStreamingParser 实例
  const parserInstanceToFinalize = activeStreamingParser;
  if (!parserInstanceToFinalize) {
    console.warn("[MarkdownService] No active streaming parser to finalize.");
    return [];
  }
  
  // 清除全局的 activeStreamingParser，表明 finalize 过程已开始，不应再有新的 chunk 被处理到这个实例上
  activeStreamingParser = null; 
  console.log("[MarkdownService] Active WASM StreamingParser instance marked for finalization and cleared globally.");

  // 将 finalize 操作也添加到队列中，以确保它在所有 process_chunk 调用之后执行
  const resultPromise = streamingProcessingQueue.then(async () => {
    try {
      const blockEvents = await parserInstanceToFinalize.finalize_parsing();
      return blockEvents || [];
    } catch (error) {
      console.error('[MarkdownService] Error calling WASM StreamingParser finalize_parsing in queue:', error);
      throw new Error(`WASM finalize_parsing failed in queue: ${error.message || error}`);
    }
  });
  // 更新队列，但不吞掉 finalize 的错误，因为 finalize 通常是最后的操作
  streamingProcessingQueue = resultPromise;
  return resultPromise;
}

// (可选) 如果希望预加载，可以在应用初始化时调用
// ensureWasmReady().catch(err => console.warn("Pre-loading WASM parser failed:", err));
