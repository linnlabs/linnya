import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseMarkdownToBlocksInNode,
  resetNodeParserApiCacheForTests,
  resolveNodeParserModulePath
} from '../parserAdapterNode';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function ensureFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '// test stub');
}

const tempDirs: string[] = [];

describe('parserAdapterNode', () => {
  afterEach(() => {
    resetNodeParserApiCacheForTests();
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('prefers nodejs wasm wrapper under pkg-node', () => {
    const tempDir = createTempDir('linnya-parser-node-');
    tempDirs.push(tempDir);

    const nodeEntry = path.join(tempDir, 'packages/parser-wasm/pkg-node/parser_wasm.js');
    ensureFile(nodeEntry);

    expect(resolveNodeParserModulePath(tempDir)).toBe(nodeEntry);
  });

  it('throws explicit error when only web pkg exists', () => {
    const tempDir = createTempDir('linnya-parser-web-only-');
    tempDirs.push(tempDir);

    const webEntry = path.join(tempDir, 'packages/parser-wasm/pkg/parser_wasm.js');
    ensureFile(webEntry);

    expect(() => resolveNodeParserModulePath(tempDir)).toThrowError(
      /未找到 Node 侧 parser-wasm 产物/
    );
  });

  it('can load the real nodejs wasm parser and parse markdown in node', async () => {
    const events = await parseMarkdownToBlocksInNode('# 标题\n\n普通段落');

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.block_type).toBe('HeadingBlock');
    expect(events[0]?.raw_content_fallback).toBe('标题');
    expect(events[1]?.block_type).toBe('BaseBlock');
    expect(events[1]?.raw_content_fallback).toBe('普通段落');
  });

  it('preserves CommonMark comments as independent block events', async () => {
    const events = await parseMarkdownToBlocksInNode(
      '正文\n<!-- 批注\n\n第二行 -->\n下一段'
    );

    expect(events.map(event => event.block_type)).toEqual([
      'BaseBlock',
      'HtmlComment',
      'BaseBlock'
    ]);
    expect(events[1]?.raw_content_fallback).toBe('<!-- 批注\n\n第二行 -->');
  });

  it('emits one ListItemBlock per markdown list item', async () => {
    const events = await parseMarkdownToBlocksInNode('- one\n- two\n  - nested');

    expect(events).toHaveLength(3);
    expect(events.map(event => event.block_type)).toEqual([
      'ListItemBlock',
      'ListItemBlock',
      'ListItemBlock'
    ]);
    expect(events.map(event => event.raw_content_fallback)).toEqual(['one', 'two', 'nested']);
    expect(events.map(event => event.list_level)).toEqual([0, 0, 1]);
  });
});
