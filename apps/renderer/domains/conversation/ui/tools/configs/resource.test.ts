import { describe, expect, it } from 'vitest';
import { readResourceReadUiKeyFromResult, resourceToolConfigs } from './resource';

describe('readResourceReadUiKeyFromResult', () => {
  it('应从 result.data.uri 识别知识库阅读卡片', () => {
    expect(
      readResourceReadUiKeyFromResult({
        data: {
          uri: 'kb://documents/doc_123',
        },
      }),
    ).toBe('knowledge_read');
  });

  it('应把 asset 图片读取路由到统一 image_read 展示合同', () => {
    expect(
      readResourceReadUiKeyFromResult({
        data: {
          uri: 'asset://assets/asset-image-1',
          resource_type: 'image',
        },
      }),
    ).toBe('image_read');
  });

  it('应把 conversation_file 图片读取路由到统一 image_read 展示合同', () => {
    expect(
      resourceToolConfigs['resource_read']?.resolveUiKey(
        { uri: 'conversation_file://files/slides-renders/run-1/slide-001.png' },
        undefined,
      ),
    ).toBe('image_read');
  });

  it('应从 result.data.uri 识别网页阅读卡片', () => {
    expect(
      readResourceReadUiKeyFromResult({
        data: {
          uri: 'https://example.com/article',
        },
      }),
    ).toBe('web_read');
  });

  it('应从 result.data.uri 识别 tool output 续读卡片', () => {
    expect(
      readResourceReadUiKeyFromResult({
        data: {
          uri: 'tool_output://blobs/blob_123',
        },
      }),
    ).toBe('tool_output_read');
  });

  it('应从 result.data.uri 识别 skill 资源续读卡片', () => {
    expect(
      readResourceReadUiKeyFromResult({
        data: {
          uri: 'skill://skills/slides-design/references/api-reference.md',
        },
      }),
    ).toBe('skill_resource_read');
  });

  it('缺失 uri 时不再兼容旧结构猜测', () => {
    expect(
      readResourceReadUiKeyFromResult({
        data: {
          filename: 'legacy.pdf',
          chunks: [{ index: 1, text: 'legacy chunk' }],
        },
      }),
    ).toBeNull();
  });

  it('当 result.data.uri 缺失但 args.uri 存在时，仍应按 URI 协议路由卡片', () => {
    expect(
      resourceToolConfigs['resource_read']?.resolveUiKey(
        { uri: 'kb://documents/doc_legacy' },
        {
          data: {
            filename: 'legacy.pdf',
            chunks: [{ index: 1, text: 'legacy chunk' }],
          },
        },
      ),
    ).toBe('knowledge_read');
  });

  it('当 skill 资源读取还在 loading 阶段时，应从 args.uri 路由到 skill 卡片', () => {
    expect(
      resourceToolConfigs['resource_read']?.resolveUiKey(
        { uri: 'skill://skills/slides-design/references/showcases/modern.md' },
        undefined,
      ),
    ).toBe('skill_resource_read');
  });
});
