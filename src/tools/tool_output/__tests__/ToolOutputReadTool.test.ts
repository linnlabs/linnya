import { describe, expect, it } from 'vitest';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

import { ToolOutputReadTool } from '../ToolOutputReadTool';
import {
  openToolOutputTextBlobWriter,
  saveToolOutputTextBlob,
  truncateObservationToPreview,
} from '../toolOutputStore';
import {
  TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
  TOOL_OUTPUT_BODY_FILE_NAME,
  TOOL_OUTPUT_INDEX_FILE_NAME,
  ToolOutputBlobManifestSchema,
} from '../definitions/toolOutputBlob';
import { setWorkspaceRoot, resetWorkspaceRootToDefault } from '../../../shared/utils/pathManager';
import { ToolOutputReadResultSchema } from '@app/schemas';
import { ToolCallIdSchema } from 'linnkit/contracts';

/**
 * ToolOutputReadTool 真实落盘测试（ToolOutputStore）：
 * - 目标：验证落盘 blob_id 后能按字符 cursor 完整续读，并严格遵守字符、行与文本单位硬上限。
 *
 * 中文备注：
 * - 这是“真实测试”：会在临时 workspaceRoot 下写入 conversation artifact 的 tool_output/blobs。
 * - 不依赖 Electron，不需要启动应用。
 */
describe('tool_output_read (ToolOutputReadTool)', () => {
  it('只写入并读取当前严格 blob 合同，且 blob_id 校验完整记录', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_store_contract_'));
    setWorkspaceRoot(tmpRoot);

    try {
      const context = {
        conversationId: 'conv_contract',
        turnId: 'turn_contract',
        parentToolCallId: ToolCallIdSchema.parse('call_contract'),
        research: { instanceId: 'instance_contract' },
      };
      const saved = await saveToolOutputTextBlob({
        context,
        toolName: 'search_knowledge_base',
        text: 'strict content',
        meta: { filename: 'source.md' },
      });

      const stored = ToolOutputBlobManifestSchema.parse(
        JSON.parse(await fsp.readFile(saved.filePath, 'utf-8'))
      );
      expect(stored).toMatchObject({
        kind: 'tool_output_text',
        format_version: 2,
        conversation_id: 'conv_contract',
        instance_id: 'instance_contract',
        tool_name: 'search_knowledge_base',
        turn_id: 'turn_contract',
        tool_call_id: 'call_contract',
        meta: { filename: 'source.md' },
        body: { char_count: 14, byte_count: 28, line_count: 1 },
      });
      await expect(fsp.readFile(path.join(path.dirname(saved.filePath), TOOL_OUTPUT_BODY_FILE_NAME), 'utf16le'))
        .resolves.toBe('strict content');
      await expect(fsp.stat(path.join(path.dirname(saved.filePath), TOOL_OUTPUT_INDEX_FILE_NAME)))
        .resolves.toMatchObject({ size: 64 });

      await fsp.writeFile(saved.filePath, JSON.stringify({ ...stored, unsupported: true }), 'utf-8');
      await expect(new ToolOutputReadTool().run({ blob_id: saved.blobId }, context)).rejects.toThrow(
        'Unrecognized key'
      );
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('拒绝伪造工具名，不用 unknown_tool 掩盖调用方错误', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_store_identity_'));
    setWorkspaceRoot(tmpRoot);

    try {
      await expect(
        saveToolOutputTextBlob({
          context: { conversationId: 'conv_test' },
          toolName: '  ',
          text: 'content',
        })
      ).rejects.toThrow();
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('截断 observation 时应返回原始与预览字符/行计量', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_store_metrics_'));
    setWorkspaceRoot(tmpRoot);

    try {
      const text = Array.from({ length: 20 }, (_, i) => `line_${i + 1}_${'x'.repeat(20)}`).join(
        '\n'
      );
      const result = await truncateObservationToPreview({
        context: {
          conversationId: 'conv_test',
          turnId: 'turn_test',
          parentToolCallId: ToolCallIdSchema.parse('call_metrics'),
        },
        toolName: 'search_knowledge_base',
        text,
        maxChars: 120,
        maxLines: 6,
      });

      expect(result.truncated).toBe(true);
      if (result.truncated) {
        expect(result.originalChars).toBe(text.length);
        expect(result.previewChars).toBe(result.preview.length);
        expect(result.originalLines).toBe(20);
        expect(result.previewLines).toBe(result.preview.split('\n').length);
      }
    } finally {
      resetWorkspaceRootToDefault();
      try {
        await fsp.rm(tmpRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('按真实逻辑行保留预览尾部，并在字符裁剪时保持 Unicode 边界', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_store_preview_'));
    setWorkspaceRoot(tmpRoot);

    try {
      const context = {
        conversationId: 'conv_preview_lines',
        turnId: 'turn_preview_lines',
        parentToolCallId: ToolCallIdSchema.parse('call_preview_lines'),
      };
      const truncate = async (text: string, maxLines = 4, maxChars = 2_000) => {
        const result = await truncateObservationToPreview({
          context,
          toolName: 'preview_lines_tool',
          text,
          maxChars,
          maxLines,
        });
        expect(result.truncated).toBe(true);
        if (!result.truncated) throw new Error('expected truncated preview');
        return result.preview;
      };

      const eightLines = Array.from({ length: 8 }, (_, index) => `line_${index + 1}`).join('\n');
      const regular = await truncate(eightLines);
      expect(regular).toContain('line_1\nline_2');
      expect(regular).toContain('line_7\nline_8');
      expect(regular).not.toContain('line_3');
      expect(regular).not.toContain('line_6');

      const trailingNewline = await truncate(`${eightLines}\n`);
      expect(trailingNewline).toContain('line_8\n');
      expect(trailingNewline).not.toContain('line_7');

      const consecutiveEmptyLines = await truncate(
        ['line_1', 'line_2', 'line_3', 'line_4', 'line_5', 'line_6', '', 'line_8'].join('\n'),
        6,
      );
      expect(consecutiveEmptyLines).toContain('line_6\n\nline_8');
      expect(consecutiveEmptyLines).not.toContain('line_5');

      const unicodeTail = await truncate(
        [...Array.from({ length: 7 }, (_, index) => `line_${index + 1}`), `middle🙂${'z'.repeat(17)}`].join('\n'),
        4,
        60,
      );
      const unicodePreviewLines = unicodeTail.split('\n');
      const lastLine = unicodePreviewLines[unicodePreviewLines.length - 1];
      expect(lastLine).toBe('z'.repeat(17));
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('多行读取返回第一个未读字符 cursor，并保留行范围用于展示', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_store_'));
    setWorkspaceRoot(tmpRoot);

    try {
      const lines = Array.from({ length: 50 }, (_, i) => `line_${String(i + 1).padStart(2, '0')}`);
      const text = lines.join('\n');

      const { blobId } = await saveToolOutputTextBlob({
        context: {
          conversationId: 'conv_test',
          turnId: 'turn_test',
          parentToolCallId: ToolCallIdSchema.parse('call_1'),
        },
        toolName: 'search_knowledge_base',
        text,
      });

      const tool = new ToolOutputReadTool();
      const firstWindow = `${lines.slice(0, 5).join('\n')}\n`;
      const out = await tool.run(
        { blob_id: blobId, offset: 0, limit: firstWindow.length },
        { conversationId: 'conv_test', turnId: 'turn_test' }
      );

      const parsed = ToolOutputReadResultSchema.parse(JSON.parse(out));

      expect(parsed.data.blob_id).toBe(blobId);
      expect(parsed.data.start_line).toBe(1);
      expect(parsed.data.end_line).toBe(5);
      expect(parsed.data.total_lines).toBe(50);
      expect(parsed.data.start_offset).toBe(0);
      expect(parsed.data.end_offset_exclusive).toBe(firstWindow.length);
      expect(parsed.data.total_chars).toBe(text.length);
      expect(parsed.data.has_more).toBe(true);
      expect(parsed.data.next_offset).toBe(firstWindow.length);

      // observation 应包含窗口内容与 cursor 提示
      expect(parsed.observation).toContain(`blob_id=${blobId}`);
      expect(parsed.observation).toContain(`Cursor: to continue, set offset=${firstWindow.length}`);
      expect(parsed.observation).toContain('line_01');
      expect(parsed.observation).toContain('line_05');
      expect(parsed.observation).not.toContain('line_06');
      expect(parsed.observation).toContain('SECURITY NOTICE');
      expect(parsed.observation).toMatch(/<<<BEGIN_UNTRUSTED_TOOL_OUTPUT_WINDOW_[0-9a-f]{16}>>>/);
      expect(parsed.observation).toMatch(/<<<END_UNTRUSTED_TOOL_OUTPUT_WINDOW_[0-9a-f]{16}>>>/);
      expect(parsed.data.window_text).toBe(firstWindow);
    } finally {
      resetWorkspaceRootToDefault();
      try {
        await fsp.rm(tmpRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('严格拒绝超出公开 limit，并在内部执行行数与文本单位硬上限', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_store_caps_'));
    setWorkspaceRoot(tmpRoot);

    try {
      // 生成大量行与大量中文单位，用于触发内部文本单位预算。
      const longLine = '字'.repeat(500); // 500 个“中文单位”
      const text = Array.from({ length: 800 }, () => longLine).join('\n');

      const { blobId } = await saveToolOutputTextBlob({
        context: {
          conversationId: 'conv_test',
          turnId: 'turn_test',
          parentToolCallId: ToolCallIdSchema.parse('call_2'),
        },
        toolName: 'browse_document_by_chunk',
        text,
      });

      const tool = new ToolOutputReadTool();
      await expect(
        tool.run(
          { blob_id: blobId, offset: 0, limit: 9001 },
          { conversationId: 'conv_test', turnId: 'turn_test' }
        )
      ).rejects.toThrow();

      const out = await tool.run(
        { blob_id: blobId, offset: 0, limit: 9000 },
        { conversationId: 'conv_test', turnId: 'turn_test' }
      );

      const parsed = ToolOutputReadResultSchema.parse(JSON.parse(out));
      const returnedLines = parsed.data.end_line - parsed.data.start_line + 1;
      expect(returnedLines).toBeLessThanOrEqual(300);

      // windowText 有字符硬上限（9000）+ 少量 header 行，这里给一个宽松上界确保不会爆炸
      expect(parsed.observation.length).toBeLessThanOrEqual(10_500);
    } finally {
      resetWorkspaceRootToDefault();
      try {
        await fsp.rm(tmpRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('单个超长行可沿 next_offset 完整续读，不丢正文也不切断 emoji', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_store_long_line_'));
    setWorkspaceRoot(tmpRoot);

    try {
      const text = `${'字'.repeat(2_500)}🙂${'tail'.repeat(800)}`;
      const context = { conversationId: 'conv_long_line', turnId: 'turn_long_line' };
      const { blobId } = await saveToolOutputTextBlob({
        context,
        toolName: 'long_line_tool',
        text,
      });
      const tool = new ToolOutputReadTool();
      const windows: string[] = [];
      let offset = 0;
      let pageCount = 0;

      while (true) {
        const page = ToolOutputReadResultSchema.parse(
          JSON.parse(await tool.run({ blob_id: blobId, offset, limit: 9000 }, context))
        );
        expect(page.data.start_offset).toBe(offset);
        expect(page.data.start_line).toBe(1);
        expect(page.data.end_line).toBe(1);
        expect(page.data.total_lines).toBe(1);
        expect(page.data.end_offset_exclusive - page.data.start_offset).toBe(
          page.data.window_text.length
        );
        const lastCodeUnit = page.data.window_text.charCodeAt(page.data.window_text.length - 1);
        expect(lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff).toBe(false);
        windows.push(page.data.window_text);
        pageCount += 1;

        if (page.data.next_offset === null) break;
        expect(page.data.next_offset).toBeGreaterThan(offset);
        offset = page.data.next_offset;
      }

      expect(pageCount).toBeGreaterThan(2);
      expect(windows.join('')).toBe(text);
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('拒绝旧行 cursor 参数，避免同一工具存在两套分页合同', async () => {
    const tool = new ToolOutputReadTool();
    await expect(
      tool.run({ blob_id: 'abcdef1234567890', offset_line: 1, max_lines: 20 }, {})
    ).rejects.toThrow('Unrecognized key');
  });

  it('limit=1 遇到 emoji 时仍返回完整 code point 并推进 cursor', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_store_emoji_'));
    setWorkspaceRoot(tmpRoot);

    try {
      const context = { conversationId: 'conv_emoji', turnId: 'turn_emoji' };
      const { blobId } = await saveToolOutputTextBlob({
        context,
        toolName: 'emoji_tool',
        text: '🙂x',
      });
      const first = ToolOutputReadResultSchema.parse(
        JSON.parse(
          await new ToolOutputReadTool().run({ blob_id: blobId, offset: 0, limit: 1 }, context)
        )
      );

      expect(first.data.window_text).toBe('🙂');
      expect(first.data.end_offset_exclusive).toBe(2);
      expect(first.data.next_offset).toBe(2);
      await expect(
        new ToolOutputReadTool().run({ blob_id: blobId, offset: 1, limit: 1 }, context)
      ).rejects.toThrow('位于 Unicode 字符中间');
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('当 blob_id 非法时应抛错（要求 16 位 hex）', async () => {
    const tool = new ToolOutputReadTool();
    await expect(tool.run({ blob_id: 'not-a-hex-id' }, {})).rejects.toThrow('非法 blob_id');
  });

  it('流式 writer 的内容身份不受 chunk 分法影响，并且 finalize 幂等', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_stream_'));
    setWorkspaceRoot(tmpRoot);
    const context = {
      conversationId: 'conv_stream',
      turnId: 'turn_stream',
      parentToolCallId: ToolCallIdSchema.parse('call_stream'),
    };
    const text = `${'alpha🙂\n'.repeat(12_000)}omega`;

    try {
      const firstWriter = await openToolOutputTextBlobWriter({
        context,
        toolName: 'stream_tool',
      });
      await firstWriter.append(text.slice(0, 17));
      await firstWriter.append(text.slice(17, 65_537));
      await firstWriter.append(text.slice(65_537));
      const first = await firstWriter.finalize();
      await expect(firstWriter.finalize()).resolves.toEqual(first);
      await expect(firstWriter.append('late')).rejects.toThrow('终结阶段');

      const secondWriter = await openToolOutputTextBlobWriter({
        context,
        toolName: 'stream_tool',
      });
      for (let offset = 0; offset < text.length; offset += 997) {
        await secondWriter.append(text.slice(offset, offset + 997));
      }
      const second = await secondWriter.finalize();
      expect(second.blobId).toBe(first.blobId);
      const blobRoot = path.dirname(path.dirname(first.filePath));
      expect((await fsp.readdir(blobRoot)).filter((name) => name.startsWith('.pending-')))
        .toEqual([]);
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('两个 writer 并发发布相同内容时复用同一 blob，不覆盖半成品', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_concurrent_'));
    setWorkspaceRoot(tmpRoot);
    const context = { conversationId: 'conv_concurrent', turnId: 'turn_concurrent' };

    try {
      const [left, right] = await Promise.all([
        openToolOutputTextBlobWriter({ context, toolName: 'same_tool' }),
        openToolOutputTextBlobWriter({ context, toolName: 'same_tool' }),
      ]);
      await Promise.all([left.append('same🙂content'), right.append('same🙂content')]);
      const [leftResult, rightResult] = await Promise.all([left.finalize(), right.finalize()]);
      expect(rightResult.blobId).toBe(leftResult.blobId);
      const page = ToolOutputReadResultSchema.parse(JSON.parse(
        await new ToolOutputReadTool().run({ blob_id: leftResult.blobId }, context),
      ));
      expect(page.data.window_text).toBe('same🙂content');
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('代理对跨固定 block 边界时仍可无损读取，并拒绝低代理项 cursor', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_block_emoji_'));
    setWorkspaceRoot(tmpRoot);
    const context = { conversationId: 'conv_block_emoji', turnId: 'turn_block_emoji' };
    const text = `${'x'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY - 1)}🙂z`;

    try {
      const { blobId } = await saveToolOutputTextBlob({
        context,
        toolName: 'block_emoji_tool',
        text,
      });
      const page = ToolOutputReadResultSchema.parse(JSON.parse(
        await new ToolOutputReadTool().run({
          blob_id: blobId,
          offset: TOOL_OUTPUT_BLOCK_CHAR_CAPACITY - 2,
          limit: 4,
        }, context),
      ));
      expect(page.data.window_text).toBe('x🙂z');
      await expect(new ToolOutputReadTool().run({
        blob_id: blobId,
        offset: TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
        limit: 1,
      }, context)).rejects.toThrow('位于 Unicode 字符中间');
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('随机前向窗口能逐字符重建跨 block 正文，且晚 offset 不改变行号', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_windows_'));
    setWorkspaceRoot(tmpRoot);
    const context = { conversationId: 'conv_windows', turnId: 'turn_windows' };
    const text = Array.from(
      { length: 18_000 },
      (_, index) => `${index % 7 === 0 ? '🙂' : 'word'}_${index}\n`,
    ).join('');

    try {
      const { blobId } = await saveToolOutputTextBlob({
        context,
        toolName: 'window_tool',
        text,
      });
      let seed = 0x5eed_1234;
      let offset = 0;
      const windows: string[] = [];
      while (offset < text.length) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        const limit = 1 + (seed % 9_000);
        const page = ToolOutputReadResultSchema.parse(JSON.parse(
          await new ToolOutputReadTool().run({ blob_id: blobId, offset, limit }, context),
        ));
        const expectedStartLine = text.slice(0, offset).split('\n').length;
        expect(page.data.start_line).toBe(expectedStartLine);
        expect(page.data.start_offset).toBe(offset);
        windows.push(page.data.window_text);
        if (page.data.next_offset === null) break;
        expect(page.data.next_offset).toBeGreaterThan(offset);
        offset = page.data.next_offset;
      }
      expect(windows.join('')).toBe(text);
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('正文或索引被同长度改写时拒绝读取，不返回未经验证的窗口', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_corrupt_'));
    setWorkspaceRoot(tmpRoot);
    const context = { conversationId: 'conv_corrupt', turnId: 'turn_corrupt' };

    try {
      const first = await saveToolOutputTextBlob({
        context,
        toolName: 'corrupt_body_tool',
        text: 'body content',
      });
      const firstDir = path.dirname(first.filePath);
      await fsp.writeFile(path.join(firstDir, TOOL_OUTPUT_BODY_FILE_NAME), Buffer.alloc(24, 0x42));
      await expect(
        new ToolOutputReadTool().run({ blob_id: first.blobId }, context),
      ).rejects.toThrow('正文 block 校验失败');

      const second = await saveToolOutputTextBlob({
        context,
        toolName: 'corrupt_index_tool',
        text: 'index content',
      });
      const indexPath = path.join(path.dirname(second.filePath), TOOL_OUTPUT_INDEX_FILE_NAME);
      const index = await fsp.readFile(indexPath);
      index[0] ^= 0xff;
      await fsp.writeFile(indexPath, index);
      await expect(
        new ToolOutputReadTool().run({ blob_id: second.blobId }, context),
      ).rejects.toThrow('block index record 校验失败');
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('读取不存在的 blob 不创建 conversation artifact 空目录', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'temp_tool_output_missing_'));
    setWorkspaceRoot(tmpRoot);
    const context = { conversationId: 'conv_missing', turnId: 'turn_missing' };

    try {
      await expect(
        new ToolOutputReadTool().run({ blob_id: 'abcdef1234567890' }, context),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fsp.stat(path.join(tmpRoot, 'Artifacts'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
