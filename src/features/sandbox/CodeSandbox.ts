/**
 * CodeSandbox — Sandbox profile 使用的受限 JavaScript evaluator primitive
 *
 * 基于 Node.js `node:vm` 提供独立 global context、能力注入和同步执行期限。`node:vm`
 * 不是 OS confinement，也不能作为抵抗恶意代码逃逸的安全边界；Main 的故障隔离、
 * heap 上限和整棵进程树收口由外层一次性 evaluator 进程与 local-process owner 保证。
 *
 * 这里的约束用途：
 * 1. 空 globalThis —— 不主动向 profile 暴露 Node.js globals
 * 2. 原型属性冻结 —— 减少 workload 意外改写共享语言内建对象
 * 3. IIFE + strict mode —— 避免 workload 意外污染当前 context
 * 4. 超时保护 —— vm.runInContext timeout 中断同步死循环
 * 5. 白名单注入 —— 只把 profile 批准的 globals 暴露给 workload
 */

import vm from 'node:vm';

// ─── 公共类型 ────────────────────────────────────────────────────────────────

export interface SandboxResult<T = unknown> {
  /** 是否执行成功（无语法/运行时/超时错误） */
  success: boolean;
  /** 捕获到的返回值（仅 success 时有效） */
  value?: T;
  /** console.log 收集到的日志行 */
  logs: string[];
  /** 错误详情（仅 success === false 时有效） */
  error?: SandboxError;
  /** 执行耗时（毫秒） */
  elapsedMs: number;
}

export interface SandboxError {
  /** 错误类别：syntax=代码解析失败，runtime=执行中抛出，timeout=超时中断，security=原型链/安全阻断 */
  type: 'syntax' | 'runtime' | 'timeout' | 'security' | 'compile' | 'policy_denied' | 'resource_exhausted' | 'transport';
  /** 人可读的错误信息 */
  message: string;
  /** 出错行号（1-based，仅可提取时有值） */
  line?: number;
  /** 出错列号（1-based） */
  column?: number;
  /** 原始 Error.stack（便于 Agent 重试调试） */
  stack?: string;
}

export interface SandboxOptions {
  /** 超时时间（毫秒），默认 5000 */
  timeoutMs?: number;
  /** 最大日志行数，默认 200 */
  maxLogLines?: number;
  /** 单行日志最大长度，默认 2000 */
  maxLogLineLength?: number;
  /** 注入到沙箱全局作用域的变量 */
  globals?: Record<string, unknown>;
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_LOG_LINES = 200;
const DEFAULT_MAX_LOG_LINE_LENGTH = 2000;

// ─── 核心实现 ─────────────────────────────────────────────────────────────────

/**
 * 在隔离沙箱中执行 JavaScript 代码并捕获返回值。
 *
 * 代码被包裹在 strict mode IIFE 中，最后一个表达式的值即为返回值。
 * 如果需要返回复杂结构，代码应以表达式结尾或在末尾 return。
 *
 * @param code - 要执行的 JavaScript 代码字符串
 * @param options - 沙箱配置
 * @returns 执行结果，包含返回值/错误/日志/耗时
 */
export function executeInSandbox<T = unknown>(
  code: string,
  options: SandboxOptions = {},
): SandboxResult<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxLogLines = options.maxLogLines ?? DEFAULT_MAX_LOG_LINES;
  const maxLogLineLength = options.maxLogLineLength ?? DEFAULT_MAX_LOG_LINE_LENGTH;
  const logs: string[] = [];
  const startTime = performance.now();

  try {
    // 1. 构建隔离上下文
    const contextGlobals = buildSandboxContext(logs, options.globals, maxLogLines, maxLogLineLength);
    const context = vm.createContext(contextGlobals);

    // 2. 冻结常见原型属性，减少 workload 对当前 context 内建对象的意外改写。
    // 这不是 vm escape 防护；真正不可信代码需要另行引入 OS confinement。
    freezePrototypes(context);

    // 3. 包裹 IIFE + strict mode
    const wrappedCode = wrapInIIFE(code);

    // 4. 编译（捕获语法错误）
    let script: vm.Script;
    try {
      script = new vm.Script(wrappedCode, { filename: 'sandbox.js' });
    } catch (err) {
      return buildSyntaxError<T>(err, logs, performance.now() - startTime);
    }

    // 5. 执行（捕获运行时错误 + 超时）
    const rawResult = script.runInContext(context, { timeout: timeoutMs });

    return {
      success: true,
      value: rawResult as T,
      logs,
      elapsedMs: Math.round(performance.now() - startTime),
    };
  } catch (err) {
    return buildExecutionError<T>(err, logs, performance.now() - startTime);
  }
}

// ─── 上下文构建 ───────────────────────────────────────────────────────────────

/**
 * 构建沙箱全局变量对象：只包含白名单注入项 + 安全 console。
 */
function buildSandboxContext(
  logCollector: string[],
  userGlobals?: Record<string, unknown>,
  maxLogLines: number = DEFAULT_MAX_LOG_LINES,
  maxLogLineLength: number = DEFAULT_MAX_LOG_LINE_LENGTH,
): Record<string, unknown> {
  const globals: Record<string, unknown> = {};

  // 注入用户提供的全局变量
  if (userGlobals) {
    for (const [key, value] of Object.entries(userGlobals)) {
      globals[key] = value;
    }
  }

  // 提供受限的 console 对象，只支持 log/warn/error
  globals.console = {
    log: (...args: unknown[]) => collectLog(logCollector, args, maxLogLines, maxLogLineLength),
    warn: (...args: unknown[]) => collectLog(logCollector, args, maxLogLines, maxLogLineLength),
    error: (...args: unknown[]) => collectLog(logCollector, args, maxLogLines, maxLogLineLength),
  };

  // 提供安全的 JSON 操作
  globals.JSON = JSON;

  // 提供基础数学工具
  globals.Math = Math;

  return globals;
}

/** 将 console.log 参数收集为字符串行 */
function collectLog(
  collector: string[],
  args: unknown[],
  maxLogLines: number,
  maxLogLineLength: number,
): void {
  if (collector.length >= maxLogLines) return;
  const line = args
    .map((a) => {
      try {
        return typeof a === 'string' ? a : JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  collector.push(line.length > maxLogLineLength ? line.slice(0, maxLogLineLength) + '...' : line);
}

// ─── 原型链冻结 ───────────────────────────────────────────────────────────────

/**
 * 在当前 vm context 内冻结关键原型的 constructor 属性，避免 workload 意外改写后
 * 影响同一轮计算。Node 官方不把 vm context 定义为安全机制，这里不作逃逸防护承诺。
 */
function freezePrototypes(context: vm.Context): void {
  const freezeScript = new vm.Script(`
    (function() {
      'use strict';
      var protos = [Object.prototype, Function.prototype, Array.prototype, String.prototype, Number.prototype, Boolean.prototype, RegExp.prototype, Error.prototype, Date.prototype];
      for (var i = 0; i < protos.length; i++) {
        var p = protos[i];
        if (p.hasOwnProperty('constructor')) {
          Object.defineProperty(p, 'constructor', { configurable: false, writable: false });
        }
      }
    })();
  `, { filename: 'sandbox-freeze.js' });
  freezeScript.runInContext(context, { timeout: 1000 });
}

// ─── 代码包装 ─────────────────────────────────────────────────────────────────

/**
 * 将用户代码包裹在 strict mode IIFE 中。
 * 返回值通过 IIFE return 捕获。
 */
function wrapInIIFE(code: string): string {
  return `'use strict';\n(function() {\n${code}\n})();`;
}

// ─── 错误解析 ─────────────────────────────────────────────────────────────────

/** 从 SyntaxError 构建结构化沙箱错误 */
function buildSyntaxError<T>(err: unknown, logs: string[], elapsed: number): SandboxResult<T> {
  const { message, line, column, stack } = extractErrorInfo(err);
  return {
    success: false,
    logs,
    error: {
      type: 'syntax',
      message,
      line: adjustLineNumber(line),
      column,
      stack,
    },
    elapsedMs: Math.round(elapsed),
  };
}

/** 从运行时错误/超时构建结构化沙箱错误 */
function buildExecutionError<T>(err: unknown, logs: string[], elapsed: number): SandboxResult<T> {
  const { message, line, column, stack } = extractErrorInfo(err);

  // 超时检测：优先用 Node.js error code，退而求其次用消息匹配
  const errCode = isErrorLike(err) ? (err as { code?: string }).code : undefined;
  const isTimeout = errCode === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
    || message.includes('Script execution timed out');

  if (isTimeout) {
    return {
      success: false,
      logs,
      error: {
        type: 'timeout',
        message: '代码执行超时，请检查是否存在死循环。',
        stack,
      },
      elapsedMs: Math.round(elapsed),
    };
  }

  // 检测原型链逃逸相关的安全错误
  const isSecurity = message.includes('Cannot assign to read only property')
    || (message.includes('constructor') && message.includes('read only'));

  return {
    success: false,
    logs,
    error: {
      type: isSecurity ? 'security' : 'runtime',
      message,
      line: adjustLineNumber(line),
      column,
      stack,
    },
    elapsedMs: Math.round(elapsed),
  };
}

/**
 * 判断一个值是否具有 Error 的基本形态（duck typing）。
 * vm 上下文抛出的 Error 与宿主 realm 的 Error 不共享原型链，
 * 因此不能用 `instanceof Error` 来判断。
 */
function isErrorLike(err: unknown): err is { message: string; stack?: string; name?: string } {
  return err !== null
    && typeof err === 'object'
    && typeof (err as Record<string, unknown>).message === 'string';
}

/**
 * 从 Error（或类 Error 对象）中提取行号、列号和消息。
 *
 * V8 stack trace 格式：
 * - 运行时错误：`    at sandbox.js:LINE:COLUMN`
 * - 语法错误：`sandbox.js:LINE`（无列号，列信息由 ^ 指示）
 */
function extractErrorInfo(err: unknown): {
  message: string;
  line?: number;
  column?: number;
  stack?: string;
} {
  if (!isErrorLike(err)) {
    return { message: String(err) };
  }

  const message = err.message;
  const stack = err.stack;

  // 先尝试匹配含列号的格式：sandbox.js:LINE:COLUMN
  const matchWithCol = stack?.match(/sandbox\.js:(\d+):(\d+)/);
  if (matchWithCol) {
    return {
      message,
      line: Number(matchWithCol[1]),
      column: Number(matchWithCol[2]),
      stack,
    };
  }

  // 再尝试匹配仅含行号的格式（SyntaxError）：sandbox.js:LINE
  const matchLineOnly = stack?.match(/sandbox\.js:(\d+)/);
  if (matchLineOnly) {
    return { message, line: Number(matchLineOnly[1]), stack };
  }

  return { message, stack };
}

/**
 * IIFE 包装增加了 2 行偏移（'use strict' 和 `(function() {`），
 * 需要减去偏移才能对应用户代码的真实行号。
 */
function adjustLineNumber(line?: number): number | undefined {
  if (line == null) return undefined;
  const adjusted = line - 2;
  return adjusted > 0 ? adjusted : 1;
}
