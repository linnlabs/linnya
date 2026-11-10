// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, it } from 'vitest';
import { registerMessageCatalogs, useLocalizationStore } from '@app/localization';
import { CanvasUserFailureCodeSchema } from '@plugin/canvas/shared';
import {
  CANVAS_EN_MESSAGES,
  CANVAS_MESSAGE_CATALOG,
  CANVAS_ZH_MESSAGES,
} from '../definitions/canvasMessageCatalog';
import { canvasText } from '../functions/canvasText';
import { projectCanvasFailureText } from '../functions/projectCanvasFailureText';

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
  expect(projectCanvasFailureText('canvas_self_connection')).toBe(
    "A card can't connect to itself. Connect two different cards."
  );
  expect(projectCanvasFailureText('宿主给出的原文')).toBe('宿主给出的原文');
  setActivePinia(undefined);
  expect(canvasText('canvas.zoom.out')).toBe('缩小');
});
