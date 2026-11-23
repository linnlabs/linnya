// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, it, vi } from 'vitest';
import { registerMessageCatalogs, useLocalizationStore } from '@app/localization';
import { CanvasUserFailureCodeSchema } from '@plugin/canvas/shared';
import {
  CANVAS_EN_MESSAGES,
  CANVAS_MESSAGE_CATALOG,
  CANVAS_ZH_MESSAGES,
} from '../definitions/canvasMessageCatalog';
import { canvasText } from '../functions/canvasText';
import { CanvasUserError, canvasUserMessage } from '../functions/canvasUserMessage';

const params = (text: string) => [...text.matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map(m => m[1]).sort();
beforeEach(() => {
  setActivePinia(createPinia());
  registerMessageCatalogs(CANVAS_MESSAGE_CATALOG);
});
it('中英文目录键一致、占位符一致，英文里没有中文', () => {
  const keys = Object.keys(CANVAS_ZH_MESSAGES);
  expect(Object.keys(CANVAS_EN_MESSAGES).sort()).toEqual([...keys].sort());
  for (const key of keys) {
    const zh = CANVAS_ZH_MESSAGES[key as keyof typeof CANVAS_ZH_MESSAGES];
    const en = CANVAS_EN_MESSAGES[key as keyof typeof CANVAS_EN_MESSAGES];
    expect(params(en), key).toEqual(params(zh));
    expect(en, key).not.toMatch(/[一-龥]/);
  }
});
it('后端每个失败编号都有文案', () => {
  for (const code of CanvasUserFailureCodeSchema.options)
    expect(CANVAS_ZH_MESSAGES[`canvas.failure.${code}`], code).toBeTruthy();
});
it('按当前语言取文案并替换占位符；没有 Pinia 时回到中文', () => {
  expect(canvasText('canvas.selection.label', { count: 3 })).toBe('已选 3 张卡片');
  useLocalizationStore().setCurrentLocale('en-US');
  expect(canvasText('canvas.selection.label', { count: 3 })).toBe('Selected cards: 3');
  expect(canvasUserMessage(new Error('canvas_self_connection'))).toBe(
    "A card can't connect to itself. Connect two different cards."
  );
  setActivePinia(undefined);
  expect(canvasText('canvas.zoom.out')).toBe('缩小');
});

it('给用户看的失败：画布提示、失败编号与 Host 可展示消息照常显示；内部原文只进日志、界面给通用提示', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    expect(canvasUserMessage(new CanvasUserError('卡片已锁定'))).toBe('卡片已锁定');
    expect(canvasUserMessage(new Error('canvas_self_connection'))).toBe(
      canvasText('canvas.failure.canvas_self_connection')
    );
    const preview = new Error('这个文档已被删除');
    preview.name = 'DocumentPreviewUserError';
    expect(canvasUserMessage(preview)).toBe('这个文档已被删除');
    expect(warn).not.toHaveBeenCalled();

    for (const [code, key] of [
      ['canvas_2d_unavailable', 'canvas.error.drawingUnavailable'],
      ['canvas_webgl_required', 'canvas.error.drawingUnavailable'],
      ['html_canvas_unavailable', 'canvas.error.htmlDrawingUnavailable'],
      ['canvas_graphics_context_lost', 'canvas.error.graphicsContextLost'],
    ] as const)
      expect(canvasUserMessage(new Error(code))).toBe(canvasText(key));
    // 只有名单里的编号换成具体说明；程序内部问题（如渲染队列满）给通用句。
    expect(canvasUserMessage(new Error('raster_queue_capacity'))).toBe(
      canvasText('canvas.failure.canvas_operation_failed')
    );
    const busy = new Error(
      "Error invoking remote method 'plugin:invoke': SqliteError: SQLITE_BUSY: database is locked"
    );
    expect(canvasUserMessage(busy)).toBe(canvasText('canvas.failure.canvas_operation_failed'));
    expect(canvasUserMessage('raw string')).toBe(
      canvasText('canvas.failure.canvas_operation_failed')
    );
    expect(canvasUserMessage(undefined)).toBe(canvasText('canvas.failure.canvas_operation_failed'));
    for (const text of [
      canvasText('canvas.error.drawingUnavailable'),
      canvasText('canvas.error.htmlDrawingUnavailable'),
      canvasText('canvas.error.graphicsContextLost'),
      canvasText('canvas.failure.canvas_operation_failed'),
    ]) {
      expect(text).not.toMatch(/canvas_|SQLITE|Error invoking/u);
    }
    // 4 个环境编号 + 渲染队列满 + 3 个宿主原文/非 Error，每次都记一条日志。
    expect(warn).toHaveBeenCalledTimes(8);
    expect(warn.mock.calls[5]?.[1]).toBe(busy);
  } finally {
    warn.mockRestore();
  }
});

it('无法证明可展示时一律给通用提示：Host 未声明的错误名、空消息的可展示错误', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const unnamed = new Error('内部原文');
    unnamed.name = 'SomeHostError';
    expect(canvasUserMessage(unnamed)).toBe(canvasText('canvas.failure.canvas_operation_failed'));
    const empty = new Error('');
    empty.name = 'DocumentPreviewUserError';
    expect(canvasUserMessage(empty)).toBe(canvasText('canvas.failure.canvas_operation_failed'));
  } finally {
    warn.mockRestore();
  }
});
