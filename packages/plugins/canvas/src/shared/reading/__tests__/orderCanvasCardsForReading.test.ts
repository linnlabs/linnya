import { expect, it } from 'vitest';
import {
  CanvasEdgeSchema,
  CanvasTextCardSchema,
  createCanvasPlainTextDocument,
  orderCanvasCardsForReading,
  readCanvasCardConnections,
  searchCanvasElements,
  type CanvasElement,
} from '../..';

const identity = {
  schemaVersion: 1,
  revision: 1,
  order: 'a0',
  color: 'white',
  locked: false,
  createdBy: { kind: 'user', conversationId: null, runId: null },
  updatedBy: { kind: 'user', conversationId: null, runId: null },
  createdAt: 0,
  updatedAt: 0,
} as const;
const card = (id: string, x: number, y: number, width = 150, height = 60) =>
  CanvasTextCardSchema.parse({
    ...identity,
    id,
    x,
    y,
    width,
    height,
    type: 'text',
    parentId: null,
    data: { contentVersion: 1, content: createCanvasPlainTextDocument(`卡${id}`) },
  });
const edge = (id: string, from: string, to: string) =>
  CanvasEdgeSchema.parse({
    ...identity,
    id,
    type: 'edge',
    from: { kind: 'card', cardId: from, side: 'auto' },
    to: { kind: 'card', cardId: to, side: 'auto' },
    direction: 'forward',
    lineStyle: 'curve',
    label: '',
  });
const read = (elements: CanvasElement[]) =>
  orderCanvasCardsForReading(
    elements.filter(element => element.type !== 'edge'),
    readCanvasCardConnections(elements)
  ).map(item => item.id);

it('自由排布按版面成行读，与创建或叠放顺序无关；高卡不把旁边上下错开的卡并进同一行', () => {
  // 数组顺序模拟多次拖动后的叠放顺序。
  const elements = [
    card('c7', 440, 320, 170, 80),
    card('c1', 40, 40, 180, 90),
    card('c9', 640, 360, 130, 70),
    card('c6', 250, 300, 160, 70),
    card('c3', 560, 30, 200, 150),
    card('c8', 80, 360, 150, 70),
    card('c2', 300, 60, 200, 190),
    card('c4', 60, 200, 160, 70),
    card('c5', 600, 230, 150, 70),
  ];
  expect(read(elements)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
  expect(read([card('c1', 0, 0, 150, 400), card('c3', 200, 200), card('c2', 200, 0)])).toEqual([
    'c1',
    'c2',
    'c3',
  ]);
});

it('连线成树按支读：从根开始一支读完再读下一支，整棵树作为一块参与排行', () => {
  const tree = [
    card('c4', 480, 380),
    card('c3', 260, 200),
    card('c5', 480, 20),
    card('c1', 40, 200),
    card('c6', 480, 300),
    card('c2', 260, 60),
    card('c7', 480, 200),
    card('c8', 260, 340),
    card('c9', 480, 100),
  ];
  const edges = [
    edge('e1', 'c1', 'c2'),
    edge('e2', 'c1', 'c3'),
    edge('e3', 'c1', 'c8'),
    edge('e4', 'c2', 'c5'),
    edge('e5', 'c2', 'c9'),
    edge('e6', 'c3', 'c7'),
    edge('e7', 'c8', 'c6'),
    edge('e8', 'c8', 'c4'),
  ];
  expect(read([...tree, ...edges])).toEqual(['c1', 'c2', 'c5', 'c9', 'c3', 'c7', 'c8', 'c6', 'c4']);
  // 树右侧的散卡在整棵树之后，按自己的行继续。
  expect(read([...tree, ...edges, card('c11', 700, 300), card('c10', 700, 40)]).slice(-2)).toEqual([
    'c10',
    'c11',
  ]);
});

it('多上级、成环或首尾在空白处的连线不算树，仍按版面读', () => {
  const cards = [
    card('c4', 320, 400),
    card('c3', 320, 280),
    card('c1', 320, 20),
    card('c2', 140, 150),
  ];
  const merge = [
    edge('e1', 'c1', 'c2'),
    edge('e2', 'c1', 'c3'),
    edge('e3', 'c2', 'c3'),
    edge('e4', 'c3', 'c4'),
  ];
  expect(read([...cards, ...merge])).toEqual(['c1', 'c2', 'c3', 'c4']);
  const cycle = [edge('e1', 'c3', 'c1'), edge('e2', 'c1', 'c2'), edge('e3', 'c2', 'c3')];
  expect(read([...cards, ...cycle])).toEqual(['c1', 'c2', 'c3', 'c4']);
  const loose = { ...edge('e1', 'c4', 'c1'), to: { kind: 'point', x: 0, y: 0 } } as CanvasElement;
  expect(read([...cards, loose])).toEqual(['c1', 'c2', 'c3', 'c4']);
});

it('搜索结果与 Tab 同序，连线排在卡片之后', () => {
  const elements = [
    card('c2', 300, 0),
    { ...edge('e1', 'c1', 'c2'), label: '卡' },
    card('c1', 0, 0),
  ];
  expect(
    searchCanvasElements(elements, '卡', { documentTitles: new Map() }).map(hit => hit.id)
  ).toEqual(['c1', 'c2', 'e1']);
});
