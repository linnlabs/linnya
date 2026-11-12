import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { readCanvasCardTags, type CanvasCard, type CanvasTagNames } from '../../../../shared';
import { CANVAS_DEFAULT_FONT_FAMILY } from '../../../../shared/rendering/definitions/canvasTypography';

/**
 * 卡片标记：状态是压在卡片右上角的一枚小印签，标签是卡片下方的一行灰字。两样都画在纸外，
 * 不改卡片尺寸与测高；随卡片容器一起移动、淡入淡出。长度为世界坐标。
 */
export interface CanvasCardMarks {
  readonly container: Container;
  readonly stamp: Graphics;
  readonly stampText: Text;
  readonly tagText: Text;
  key: string;
}

const STAMP_HEIGHT = 20;
const STAMP_PADDING = 8;
const STAMP_RIGHT = 14;
const STAMP_RISE = 9;
const TAG_GAP = 6;
const FONT_SIZE = 12;
/** 再远就读不清 12 号字，标记整体隐去，只留卡片本身。 */
export const CANVAS_CARD_MARKS_MIN_ZOOM = 0.45;

const ink = {
  light: { stamp: 0x1b1b18, stampText: 0xffffff, tags: 0x757472 },
  dark: { stamp: 0xecebe8, stampText: 0x1b1b18, tags: 0x878683 },
} as const;

function style(weight: 'normal' | '600'): TextStyle {
  return new TextStyle({
    fontFamily: CANVAS_DEFAULT_FONT_FAMILY,
    fontSize: FONT_SIZE,
    fontWeight: weight,
    fill: 0xffffff,
  });
}

export function createCanvasCardMarks(): CanvasCardMarks {
  const container = new Container();
  const stamp = new Graphics();
  const stampText = new Text({ text: '', style: style('600') });
  const tagText = new Text({ text: '', style: style('normal') });
  container.addChild(stamp, stampText, tagText);
  return { container, stamp, stampText, tagText, key: '' };
}

/** 放大时按 1、2、4 倍档提高文字采样，避免近景发糊又不在连续缩放时反复重画。 */
function textResolution(zoom: number, dpr: number): number {
  return dpr * (zoom > 2 ? 4 : zoom > 1 ? 2 : 1);
}

/** 标签一行放不下卡宽时，从末尾收起，以“+N”说明还有几个。 */
function fitTags(text: Text, names: readonly string[], width: number): void {
  for (let shown = names.length; shown >= 1; shown--) {
    const rest = names.length - shown;
    text.text = `${names
      .slice(0, shown)
      .map(name => `#${name}`)
      .join(' ')}${rest ? ` +${rest}` : ''}`;
    if (text.width <= width || shown === 1) return;
  }
}

export function updateCanvasCardMarks(
  marks: CanvasCardMarks,
  input: {
    readonly card: CanvasCard;
    readonly names: CanvasTagNames;
    readonly zoom: number;
    readonly dark: boolean;
    readonly dpr: number;
  }
): void {
  const { card, names, zoom, dark, dpr } = input;
  const { status, tags } = readCanvasCardTags(card, names);
  const visible = zoom >= CANVAS_CARD_MARKS_MIN_ZOOM && Boolean(status || tags.length);
  marks.container.visible = visible;
  if (!visible) return;
  const resolution = textResolution(zoom, dpr);
  const key = [
    status?.name ?? '',
    tags.map(tag => tag.name).join('\n'),
    card.width,
    card.height,
    dark,
    resolution,
  ].join('\u0000');
  if (marks.key === key) return;
  marks.key = key;
  const palette = dark ? ink.dark : ink.light;
  marks.stampText.resolution = marks.tagText.resolution = resolution;
  marks.stamp.clear();
  marks.stamp.visible = marks.stampText.visible = Boolean(status);
  if (status) {
    marks.stampText.text = status.name;
    marks.stampText.tint = palette.stampText;
    const width = Math.min(marks.stampText.width + STAMP_PADDING * 2, card.width - STAMP_RIGHT);
    const x = card.width - STAMP_RIGHT - width;
    marks.stamp.roundRect(x, -STAMP_RISE, width, STAMP_HEIGHT, 2).fill(palette.stamp);
    marks.stampText.position.set(
      x + STAMP_PADDING,
      -STAMP_RISE + (STAMP_HEIGHT - marks.stampText.height) / 2
    );
  }
  marks.tagText.visible = tags.length > 0;
  if (tags.length) {
    marks.tagText.tint = palette.tags;
    fitTags(
      marks.tagText,
      tags.map(tag => tag.name),
      card.width
    );
    marks.tagText.position.set(2, card.height + TAG_GAP);
  }
}
