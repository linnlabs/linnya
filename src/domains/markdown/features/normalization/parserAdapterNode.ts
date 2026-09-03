/**
 * @file parserAdapterNode.ts
 * @description Node/Electron main 侧的 parser-wasm 适配器。
 */

import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import type { WasmBlockEventLike } from './types';

type UnknownRecord = Record<string, unknown>;

type StreamingParserInstance = {
  process_chunk: (chunk: string) => Promise<unknown> | unknown;
  finalize_parsing: () => Promise<unknown> | unknown;
};

type WasmParserApi = {
  init: () => Promise<unknown>;
  StreamingParser: new () => StreamingParserInstance;
};

let cachedApiPromise: Promise<WasmParserApi> | null = null;
const NODE_WASM_ENTRY_RELATIVE_PATHS = [
  'packages/parser-wasm/pkg-node/parser_wasm.js',
  'packages/parser-wasm/pkg-nodejs/parser_wasm.js'
] as const;
const requireFromWorkspace = createRequire(path.join(process.cwd(), 'package.json'));

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function isStreamingParserConstructor(value: unknown): value is new () => StreamingParserInstance {
  return typeof value === 'function';
}

function getFunction(value: unknown, key: string): ((...args: unknown[]) => unknown) | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return isCallable(candidate) ? candidate : null;
}

function getConstructor(value: unknown, key: string): (new () => StreamingParserInstance) | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return isStreamingParserConstructor(candidate) ? candidate : null;
}

function getNodeParserCandidatePaths(cwd: string = process.cwd()): string[] {
  return NODE_WASM_ENTRY_RELATIVE_PATHS.map((relativePath) => path.resolve(cwd, relativePath));
}

/**
 * 解析 Electron main / Node 侧可用的 wasm 入口。
 *
 * 中文说明：
 * - 后端只允许加载 `wasm-pack --target nodejs` 的产物；
 * - 明确禁止回退到 `pkg/` 的 web 版 wrapper，否则会在 Node 环境里走 fetch 初始化并失败；
 * - 这样一旦开发链路漏掉 `build:wasm`，错误会被立即暴露，而不是继续把 placeholder 当成真实块文档。
 */
export function resolveNodeParserModulePath(cwd: string = process.cwd()): string {
  const candidatePaths = getNodeParserCandidatePaths(cwd);
  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  const checked = candidatePaths.map((candidatePath) => `- ${candidatePath}`).join('\n');
  throw new Error(
    [
      '未找到 Node 侧 parser-wasm 产物（pkg-node / pkg-nodejs）。',
      '后端 Markdown 规范化只允许使用 nodejs target 的 wasm wrapper，不能回退到 web 版 pkg。',
      '请先执行 `npm run build:wasm`，或使用会预构建 wasm 的 Electron 开发流程。',
      '已检查路径：',
      checked
    ].join('\n')
  );
}

async function importLocalParserModule(): Promise<unknown> {
  const modulePath = resolveNodeParserModulePath();
  return requireFromWorkspace(modulePath);
}

export function resetNodeParserApiCacheForTests(): void {
  cachedApiPromise = null;
}

async function loadParserApi(): Promise<WasmParserApi> {
  if (cachedApiPromise) {
    return cachedApiPromise;
  }

  cachedApiPromise = (async () => {
    const importedModule = await importLocalParserModule();
    const init =
      getFunction(importedModule, 'default') ??
      getFunction(isRecord(importedModule) ? importedModule.default : null, 'default');
    const StreamingParser =
      getConstructor(importedModule, 'StreamingParser') ??
      getConstructor(isRecord(importedModule) ? importedModule.default : null, 'StreamingParser');

    if (!init || !StreamingParser) {
      if (!StreamingParser) {
        throw new Error('未能从 parser-wasm 模块解析出 StreamingParser。');
      }

      // 中文说明：
      // - `wasm-pack --target nodejs` 产物通过 CommonJS `require()` 加载时会在模块初始化阶段自动完成 wasm 启动；
      // - 这类产物通常不会再暴露 default init，因此这里需要接受“无 init、但有 StreamingParser”的合法形态。
      return {
        init: async () => {},
        StreamingParser
      };
    }

    return {
      init: async () => {
        await init();
      },
      StreamingParser
    };
  })().catch((error) => {
    // 中文说明：
    // - 初始化失败后必须清空缓存；
    // - 否则用户补跑 `build:wasm` 后，本进程仍会复用失败 Promise，只能靠重启恢复。
    cachedApiPromise = null;
    throw error;
  });

  return cachedApiPromise;
}

function normalizeBlockEvents(value: unknown): WasmBlockEventLike[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is WasmBlockEventLike => {
    return isRecord(item) && typeof item.block_type === 'string';
  });
}

/**
 * 使用 Node/Electron main 可用的 parser-wasm 解析完整 Markdown。
 */
export async function parseMarkdownToBlocksInNode(markdown: string): Promise<WasmBlockEventLike[]> {
  if (!markdown.trim()) {
    return [];
  }
  const api = await loadParserApi();
  await api.init();

  const parser = new api.StreamingParser();
  const chunkEvents = await parser.process_chunk(markdown);
  const finalEvents = await parser.finalize_parsing();
  return [
    ...normalizeBlockEvents(chunkEvents),
    ...normalizeBlockEvents(finalEvents)
  ];
}
