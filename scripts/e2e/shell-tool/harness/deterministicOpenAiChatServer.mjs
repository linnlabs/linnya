import { createServer } from 'node:http';
import { URL } from 'node:url';

import { CommandAgentModelControlV1Schema } from '@app/schemas/commands';

export const DETERMINISTIC_OPENAI_MAX_REQUEST_BYTES = 1024 * 1024;
export const DETERMINISTIC_OPENAI_MAX_RESPONSE_BYTES = 64 * 1024;

const CHAT_COMPLETIONS_SUFFIX = '/v1/chat/completions';
const CONTROL_LINE_PREFIX = 'command_control: ';

/**
 * @typedef {{
 *   kind: 'fixed',
 *   value: Record<string, unknown>,
 * }} FixedToolArguments
 */

/**
 * @typedef {{
 *   kind: 'process_from_tool_result',
 *   sourceToolCallId: string,
 *   action: Record<string, unknown>,
 *   useNextCursor?: boolean,
 * }} ProcessToolArgumentsFromResult
 */

/**
 * @typedef {{
 *   kind: 'tool_call',
 *   id: string,
 *   name: string,
 *   arguments: FixedToolArguments | ProcessToolArgumentsFromResult,
 *   hold?: string,
 * }} ToolCallStep
 */

/**
 * @typedef {{
 *   kind: 'assistant_text',
 *   id: string,
 *   content: string,
 *   hold?: string,
 * }} AssistantTextStep
 */

/** @typedef {ToolCallStep | AssistantTextStep} DeterministicChatStep */

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failContract(message) {
  throw new Error(`[DeterministicOpenAiChatServer] ${message}`);
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failContract(`${field} 必须是非空字符串`);
  }
  return value;
}

function parseSessionPath(url) {
  let pathname;
  try {
    pathname = new URL(url, 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith('/sessions/') || !pathname.endsWith(CHAT_COMPLETIONS_SUFFIX)) {
    return null;
  }
  const encoded = pathname.slice('/sessions/'.length, -CHAT_COMPLETIONS_SUFFIX.length);
  if (!encoded || encoded.includes('/')) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function readJsonRequest(request, maxRequestBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxRequestBytes) {
        // 继续排空 socket，但不再缓存正文。直接销毁上传连接会让客户端只看到 EPIPE，
        // 无法稳定验证 provider 的 413 合同。
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('request_too_large'), { statusCode: 413 }));
        return;
      }
      try {
        resolve({
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          requestBytes: totalBytes,
        });
      } catch {
        reject(Object.assign(new Error('invalid_json'), { statusCode: 400 }));
      }
    });
    request.on('aborted', () => {
      reject(Object.assign(new Error('request_aborted'), { statusCode: 400 }));
    });
    request.on('error', reject);
  });
}

function requirePositiveSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    failContract(`${field} 必须是正整数`);
  }
  return value;
}

function validateChatRequest(body) {
  if (!isRecord(body)) failContract('请求体必须是 JSON 对象');
  requireNonEmptyString(body.model, 'model');
  if (body.stream !== true) failContract('完整 App harness 只接受 stream=true');
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    failContract('messages 必须是非空数组');
  }
  for (const [index, message] of body.messages.entries()) {
    if (!isRecord(message) || !['system', 'user', 'assistant', 'tool'].includes(message.role)) {
      failContract(`messages[${index}] 不是支持的 Chat Completions 消息`);
    }
  }
  if (!Array.isArray(body.tools)) failContract('tools 必须是数组');
  return body;
}

function readToolResult(messages, sourceToolCallId) {
  const message = messages.findLast((candidate) => (
    isRecord(candidate)
    && candidate.role === 'tool'
    && candidate.tool_call_id === sourceToolCallId
  ));
  if (!message || typeof message.content !== 'string') {
    failContract(`缺少工具结果 ${sourceToolCallId}`);
  }

  let structured;
  try {
    structured = JSON.parse(message.content);
  } catch {
    failContract(`工具结果 ${sourceToolCallId} 不是结构化 JSON`);
  }
  if (!isRecord(structured) || typeof structured.observation !== 'string') {
    failContract(`工具结果 ${sourceToolCallId} 缺少模型 observation`);
  }
  const firstLine = structured.observation.split('\n', 1)[0];
  if (!firstLine.startsWith(CONTROL_LINE_PREFIX)) {
    failContract(`工具结果 ${sourceToolCallId} 缺少命令控制首行`);
  }

  let encodedControl;
  try {
    encodedControl = JSON.parse(firstLine.slice(CONTROL_LINE_PREFIX.length));
  } catch {
    failContract(`工具结果 ${sourceToolCallId} 的命令控制首行无效`);
  }
  const parsedControl = CommandAgentModelControlV1Schema.safeParse(encodedControl);
  const control = parsedControl.success ? parsedControl.data : null;
  if (
    !control
    || control.status !== 'running'
  ) {
    failContract(`工具结果 ${sourceToolCallId} 没有可继续控制的 opaque handle`);
  }
  return control;
}

function resolveToolCall(step, messages) {
  if (step.arguments.kind === 'fixed') {
    return {
      id: step.id,
      name: step.name,
      arguments: step.arguments.value,
    };
  }

  const control = readToolResult(messages, step.arguments.sourceToolCallId);
  const action = { ...step.arguments.action };
  if (step.arguments.useNextCursor === true) {
    if (typeof control.next_cursor !== 'number' || !Number.isInteger(control.next_cursor)) {
      failContract(`工具结果 ${step.arguments.sourceToolCallId} 缺少 next_cursor`);
    }
    action.cursor = control.next_cursor;
  }
  return {
    id: step.id,
    name: 'process',
    arguments: {
      process_handle: control.process_handle,
      action,
    },
  };
}

function sseFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function buildToolCallFrames(model, step, messages) {
  const call = resolveToolCall(step, messages);
  const encodedArguments = JSON.stringify(call.arguments);
  const splitAt = Math.max(1, Math.floor(encodedArguments.length / 2));
  const firstArguments = encodedArguments.slice(0, splitAt);
  const secondArguments = encodedArguments.slice(splitAt);
  const id = `chatcmpl-deterministic-${step.id}`;
  const created = 1;
  const frames = [
    sseFrame({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }),
    sseFrame({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: firstArguments } }] }, finish_reason: null }] }),
  ];
  if (secondArguments.length > 0) {
    frames.push(sseFrame({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: secondArguments } }] }, finish_reason: null }] }));
  }
  frames.push(
    sseFrame({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    'data: [DONE]\n\n',
  );
  return frames;
}

function buildTextFrames(model, step) {
  const id = `chatcmpl-deterministic-${step.id}`;
  return [
    sseFrame({ id, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', content: step.content }, finish_reason: null }] }),
    sseFrame({ id, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]\n\n',
  ];
}

function validateScript(sessionId, steps) {
  requireNonEmptyString(sessionId, 'sessionId');
  if (!Array.isArray(steps) || steps.length === 0) failContract(`会话 ${sessionId} 没有脚本步骤`);
  const ids = new Set();
  for (const step of steps) {
    if (!isRecord(step) || !['tool_call', 'assistant_text'].includes(step.kind)) {
      failContract(`会话 ${sessionId} 包含无效脚本步骤`);
    }
    requireNonEmptyString(step.id, `会话 ${sessionId} 的 step.id`);
    if (step.hold !== undefined) {
      requireNonEmptyString(step.hold, `会话 ${sessionId} 的 hold`);
    }
    if (ids.has(step.id)) failContract(`会话 ${sessionId} 的 step.id 重复: ${step.id}`);
    ids.add(step.id);
    if (step.kind === 'assistant_text') {
      requireNonEmptyString(step.content, `会话 ${sessionId} 的文本响应`);
      continue;
    }
    requireNonEmptyString(step.name, `会话 ${sessionId} 的工具名`);
    if (!isRecord(step.arguments) || !['fixed', 'process_from_tool_result'].includes(step.arguments.kind)) {
      failContract(`会话 ${sessionId} 的工具参数来源无效`);
    }
    if (step.arguments.kind === 'fixed' && !isRecord(step.arguments.value)) {
      failContract(`会话 ${sessionId} 的固定工具参数必须是对象`);
    }
    if (step.arguments.kind === 'process_from_tool_result') {
      if (step.name !== 'process') failContract('真实 handle 只能用于 process 工具');
      requireNonEmptyString(step.arguments.sourceToolCallId, 'sourceToolCallId');
      if (!isRecord(step.arguments.action)) failContract('process action 必须是对象');
    }
  }
}

function safeErrorStatus(error) {
  if (isRecord(error) && typeof error.statusCode === 'number') return error.statusCode;
  return 400;
}

/**
 * 完整 App E2E 只替换外部模型边界。服务按 URL 中的 session 选择脚本，
 * 不读取提示词来路由，也不把命令、工具输出或认证头写入观察记录。
 */
export async function startDeterministicOpenAiChatServer(
  /** @type {{
   *   sessions: Record<string, DeterministicChatStep[]>,
   *   maxRequestBytes?: number,
   *   maxResponseBytes?: number,
   * }} */ options,
) {
  const maxRequestBytes = requirePositiveSafeInteger(
    options?.maxRequestBytes ?? DETERMINISTIC_OPENAI_MAX_REQUEST_BYTES,
    'maxRequestBytes',
  );
  const maxResponseBytes = requirePositiveSafeInteger(
    options?.maxResponseBytes ?? DETERMINISTIC_OPENAI_MAX_RESPONSE_BYTES,
    'maxResponseBytes',
  );
  const sessions = new Map();
  for (const [sessionId, steps] of Object.entries(options?.sessions ?? {})) {
    let scriptSnapshot;
    try {
      // harness 启动后不能再受调用方修改脚本对象影响，否则同一场景可能随时序得到不同响应。
      scriptSnapshot = globalThis.structuredClone(steps);
    } catch {
      failContract(`会话 ${sessionId} 的脚本必须是可复制的纯数据`);
    }
    validateScript(sessionId, scriptSnapshot);
    sessions.set(sessionId, { steps: scriptSnapshot, cursor: 0, inFlight: false });
  }
  if (sessions.size === 0) failContract('至少需要一个会话脚本');

  const observations = [];
  const holds = new Map();
  const holdArrivals = new Map();
  let closing = false;

  function holdKey(sessionId, holdId) {
    return `${sessionId}\u0000${holdId}`;
  }

  async function waitAtHold(sessionId, holdId) {
    const key = holdKey(sessionId, holdId);
    if (holds.has(key)) failContract(`hold 已在等待: ${sessionId}/${holdId}`);
    await new Promise((resolve) => {
      holds.set(key, resolve);
      holdArrivals.get(key)?.resolve();
      holdArrivals.delete(key);
    });
  }

  const server = createServer(async (request, response) => {
    const sessionId = parseSessionPath(request.url ?? '/');
    if (request.method !== 'POST' || !sessionId || !sessions.has(sessionId)) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'not_found' } }));
      return;
    }

    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      response.writeHead(415, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'unsupported_media_type' } }));
      return;
    }

    const session = sessions.get(sessionId);
    if (session.inFlight) {
      // 每个 session 的脚本游标是串行事实。明确拒绝重入，避免两个请求重复消费同一步。
      response.writeHead(409, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'session_request_in_flight' } }));
      return;
    }
    session.inFlight = true;
    const sequence = session.cursor;
    try {
      const { body: rawBody, requestBytes } = await readJsonRequest(request, maxRequestBytes);
      const body = validateChatRequest(rawBody);
      const step = session.steps[sequence];
      if (!step) failContract(`会话 ${sessionId} 收到超出脚本的第 ${sequence + 1} 次请求`);

      observations.push(Object.freeze({
        sessionId,
        sequence,
        requestBytes,
        messageCount: body.messages.length,
        toolCount: body.tools.length,
        latestRole: body.messages.at(-1)?.role,
        responseKind: step.kind,
        state: step.hold ? 'held' : 'responded',
      }));

      if (step.hold) await waitAtHold(sessionId, step.hold);
      if (closing) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'server_closing' } }));
        return;
      }

      const frames = step.kind === 'tool_call'
        ? buildToolCallFrames(body.model, step, body.messages)
        : buildTextFrames(body.model, step);
      const responseBytes = Buffer.byteLength(frames.join(''), 'utf8');
      if (responseBytes > maxResponseBytes) failContract('脚本响应超过大小上限');

      session.cursor += 1;
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      for (const frame of frames) response.write(frame);
      response.end();
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      response.writeHead(safeErrorStatus(error), { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'contract_violation' } }));
    } finally {
      session.inFlight = false;
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!isRecord(address) || typeof address.port !== 'number') failContract('无法读取监听端口');
  const origin = `http://127.0.0.1:${address.port}`;

  return Object.freeze({
    origin,
    apiBaseFor(sessionId) {
      if (!sessions.has(sessionId)) failContract(`未知会话: ${sessionId}`);
      return `${origin}/sessions/${encodeURIComponent(sessionId)}/v1`;
    },
    observations() {
      return observations.map(observation => ({ ...observation }));
    },
    waitUntilHeld(sessionId, holdId) {
      const key = holdKey(sessionId, holdId);
      if (holds.has(key)) return Promise.resolve();
      if (closing) return Promise.reject(new Error('deterministic model server is closing'));
      return new Promise((resolve, reject) => {
        holdArrivals.set(key, { resolve, reject });
      });
    },
    release(sessionId, holdId) {
      const key = holdKey(sessionId, holdId);
      const resolve = holds.get(key);
      if (!resolve) failContract(`hold 尚未进入等待: ${sessionId}/${holdId}`);
      holds.delete(key);
      resolve();
    },
    assertComplete() {
      for (const [sessionId, session] of sessions) {
        if (session.cursor !== session.steps.length) {
          failContract(`会话 ${sessionId} 仅完成 ${session.cursor}/${session.steps.length} 个步骤`);
        }
      }
    },
    async close() {
      closing = true;
      for (const resolve of holds.values()) resolve();
      for (const arrival of holdArrivals.values()) {
        arrival.reject(new Error('deterministic model server closed before hold arrival'));
      }
      holds.clear();
      holdArrivals.clear();
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections?.();
      });
    },
  });
}
