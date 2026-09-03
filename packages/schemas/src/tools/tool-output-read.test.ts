import { describe, expect, it } from 'vitest';
import { ToolOutputReadDataSchema } from './tool-output-read';

describe('ToolOutputReadDataSchema', () => {
  it('允许同一源行分多页，并以字符 cursor 指向第一个未读字符', () => {
    expect(ToolOutputReadDataSchema.parse({
      blob_id: 'abcdef1234567890',
      start_offset: 0,
      end_offset_exclusive: 4,
      total_chars: 8,
      start_line: 1,
      end_line: 1,
      total_lines: 1,
      has_more: true,
      next_offset: 4,
      window_text: 'abcd',
    })).toMatchObject({
      has_more: true,
      next_offset: 4,
    });
  });

  it('拒绝 cursor 跳过未返回正文或恢复旧行 cursor', () => {
    const base = {
      blob_id: 'abcdef1234567890',
      start_offset: 0,
      end_offset_exclusive: 4,
      total_chars: 8,
      start_line: 1,
      end_line: 1,
      total_lines: 1,
      has_more: true,
      next_offset: 4,
      window_text: 'abcd',
    };

    expect(ToolOutputReadDataSchema.safeParse({ ...base, next_offset: 5 }).success).toBe(false);
    expect(ToolOutputReadDataSchema.safeParse({
      ...base,
      next_offset_line: 2,
    }).success).toBe(false);
  });
});
