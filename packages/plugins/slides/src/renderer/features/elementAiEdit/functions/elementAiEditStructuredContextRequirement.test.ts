import { describe, expect, it } from 'vitest';
import { validateSlidesElementAiEditStructuredContext } from './elementAiEditStructuredContextRequirement';

const slidesPrompt = '修改第 1 页选中的 1 个元素：这个能不能搞成矩形';

describe('validateSlidesElementAiEditStructuredContext', () => {
  it('allows ordinary chat without slides structured context', () => {
    expect(validateSlidesElementAiEditStructuredContext({
      prompt: '帮我总结一下这个项目',
      options: {},
    })).toEqual({ ok: true });
  });

  it('allows slides element edit when selected-slides-element fence is present', () => {
    expect(validateSlidesElementAiEditStructuredContext({
      prompt: slidesPrompt,
      options: {
        fences: [{
          kind: 'selected-slides-element',
          content: [
            'source_file_inode: deck-1',
            '<<<deck.js exact source',
            'coverImg.rounding = true;',
            '>>>',
          ].join('\n'),
        }],
      },
    })).toEqual({ ok: true });
  });

  it('blocks legacy contextBefore + documentFragment payloads for slides element edits', () => {
    expect(validateSlidesElementAiEditStructuredContext({
      prompt: slidesPrompt,
      options: {
        context: {
          contextBefore: 'source_file_inode: deck-1',
        },
        documentFragment: [
          '<slides_element_source_context>',
          'source_file_inode: deck-1',
          '<<<deck.js exact source',
          'coverImg.rounding = true;',
          '>>>',
          '</slides_element_source_context>',
        ].join('\n'),
      },
    })).toEqual({
      ok: false,
      message: '点选编辑缺少精确源码上下文。请刷新演示文稿后重新选择元素再发送。',
    });
  });

  it('blocks workflow-shaped slides element edit prompts when exact source context is missing', () => {
    expect(validateSlidesElementAiEditStructuredContext({
      prompt: slidesPrompt,
      options: {},
    })).toEqual({
      ok: false,
      message: '点选编辑缺少精确源码上下文。请刷新演示文稿后重新选择元素再发送。',
    });
  });

  it('blocks slides source-selection userQuote when document_fragment lost in transit', () => {
    expect(validateSlidesElementAiEditStructuredContext({
      prompt: '把它改成矩形',
      options: {
        userQuote: {
          items: [
            {
              pluginId: 'platform',
              kind: 'workspace-document',
              text: '普通引用',
            },
            {
              pluginId: 'slides',
              kind: 'slides-source-selection',
              text: '1. image s1-freeform-0 lines 3-9',
              source: {
                type: 'slides_source_selection',
                presentation_id: 'deck-1',
              },
            },
          ],
        },
        context: {
          contextBefore: 'source_file_inode: deck-1',
        },
      },
    })).toEqual({
      ok: false,
      message: '点选编辑缺少精确源码上下文。请刷新演示文稿后重新选择元素再发送。',
    });
  });
});
