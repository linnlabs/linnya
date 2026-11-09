import { setTimeout as sleep } from 'node:timers/promises';
import { ProbeError } from '../definitions/probeContract.mjs';

export async function waitFor(check, description, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      lastError = error;
    }
    await sleep(50);
  } while (Date.now() < deadline);
  throw new ProbeError('TIMEOUT', `等待${description}超时${lastError ? `：${lastError.message}` : ''}`);
}

export async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;

  const opened = Promise.withResolvers();
  const timer = setTimeout(() => opened.reject(new Error('CDP 连接超时')), 5_000);
  socket.addEventListener('open', opened.resolve, { once: true });
  socket.addEventListener('error', () => opened.reject(new Error('CDP 连接失败')), { once: true });
  socket.addEventListener('close', () => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('CDP 连接已关闭'));
    }
    pending.clear();
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) {
      for (const listener of listeners) listener(message);
      return;
    }
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  });
  try {
    await opened.promise;
  } catch (error) {
    socket.close();
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return {
    get connected() { return socket.readyState === WebSocket.OPEN; },
    send(method, params = {}, timeoutMs = 10_000) {
      if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP 连接已关闭'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ProbeError('TIMEOUT', `${method} 超时`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() { socket.close(); },
  };
}

export function unwrapCdpResult(response) {
  if (response.exceptionDetails) {
    throw new ProbeError('EVAL_ERROR', response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

export async function evaluate(cdp, expression, timeoutMs) {
  return unwrapCdpResult(await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  }, timeoutMs));
}

export async function findPage(port, origin) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
  const targets = await response.json();
  return targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl &&
    URL.canParse(target.url) && new URL(target.url).origin === origin);
}
