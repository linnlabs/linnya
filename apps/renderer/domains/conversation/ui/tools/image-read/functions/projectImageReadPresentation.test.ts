import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectImageReadPresentation } from './projectImageReadPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput> = {}) {
  return projectImageReadPresentation({
    sourceToolName: 'resource_read',
    uiKey: 'image_read',
    args: { uri: 'conversation_file://files/slides-renders/run-1/slide-001.png' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

function liveImageResult(sourceKind: 'conversation_file' | 'host_file') {
  const locator = sourceKind === 'conversation_file'
    ? 'conversation:/slides-renders/run-1/slide-001.png'
    : 'file:///tmp/slide-001.png';
  return {
    data: {
      source_kind: sourceKind,
      locator,
      file_name: 'slide-001.png',
      content_type: 'image/png',
      byte_length: 1024,
      width: 1600,
      height: 900,
    },
    observation: '图片已进入模型输入。',
  };
}

describe('projectImageReadPresentation', () => {
  it('历史 Resource loading 只返回来源无关的图片读取生命周期', () => {
    expect(project()).toMatchObject({
      data: { kind: 'lifecycle' },
      title: { text: { key: 'conversation.tool.imageRead.title' } },
    });
  });

  it('历史 Resource 图片继续按独立 replay schema 接纳', () => {
    expect(project({
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          uri: 'conversation_file://files/slides-renders/run-1/slide-001.png',
          resource_type: 'image',
          relative_path: 'slides-renders/run-1/slide-001.png',
          file_name: 'slide-001.png',
        },
        observation: '历史图片已读取。',
      },
    })).toMatchObject({
      data: { kind: 'image', source: 'conversation_file', fileName: 'slide-001.png' },
    });
  });

  it.each([
    ['conversation_file', 'conversation:/slides-renders/run-1/slide-001.png'],
    ['host_file', 'file:///tmp/slide-001.png'],
  ] as const)('read_file 成功的 %s 图片进入统一展示', (sourceKind, locator) => {
    expect(project({
      sourceToolName: 'read_file',
      args: { locator },
      status: 'success',
      phase: 'complete',
      result: liveImageResult(sourceKind),
    })).toMatchObject({
      title: { text: { key: 'conversation.tool.imageRead.title' } },
      data: { kind: 'image', source: sourceKind, fileName: 'slide-001.png' },
    });
  });

  it('旧 path read_file 图片仍按 historical schema 回放', () => {
    expect(project({
      sourceToolName: 'read_file',
      args: { path: 'slides-renders/run-1/slide-001.png' },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          source: 'conversation_file',
          path: 'slides-renders/run-1/slide-001.png',
          relative_path: 'slides-renders/run-1/slide-001.png',
          file_name: 'slide-001.png',
          content_type: 'image/png',
        },
        observation: '历史图片已回放。',
      },
    })).toMatchObject({
      data: { kind: 'image', source: 'conversation_file', fileName: 'slide-001.png' },
    });
  });

  it('拒绝跨来源 payload 和非图片 read_file 结果', () => {
    expect(() => project({
      status: 'success',
      phase: 'complete',
      args: { uri: 'asset://assets/asset-image-1' },
      result: {
        data: {
          uri: 'asset://assets/asset-image-1',
          resource_type: 'image',
          file_name: 'unexpected.png',
        },
        observation: 'invalid',
      },
    })).toThrow('must not contain conversation file fields');

    expect(() => project({
      sourceToolName: 'read_file',
      args: { locator: 'conversation:/notes.txt' },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          source_kind: 'conversation_file',
          locator: 'conversation:/notes.txt',
          file_name: 'notes.txt',
          content_type: 'text/plain',
          byte_length: 10,
          offset: 1,
          limit: 2_000,
          line_count: 1,
          total_line_count: 1,
          has_more: false,
        },
        observation: 'notes',
      },
    })).toThrow('non-image live result');
  });
});
