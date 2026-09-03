/**
 * 复杂图文混排 fixtures
 */
import type { GoldenFixture } from './types.js';

export const mixedLayoutFixtures: GoldenFixture[] = [
  {
    id: 'mixed-multi-element',
    name: '多元素混合页',
    category: 'mixed-layout',
    description: '单页内包含 title+text+chart+table+shape，验证元素共存',
    deckSpec: {
      title: '多元素混合测试',
      layout: '16x9',
      theme: { colors: { accent1: '#2196F3' }, fonts: { major: 'Arial', minor: 'Arial' } },
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { color: '#FAFAFA' },
            notes: '这是一个包含所有元素类型的测试页',
            elements: [
              { type: 'title', content: '综合展示', position: { x: 0.5, y: 0.3, w: 9, h: 0.7 } },
              { type: 'text', content: '以下展示了所有支持的元素类型', style: { fontSize: 12, color: '#999999' }, position: { x: 0.5, y: 1, w: 9, h: 0.4 } },
              { type: 'chart', chartType: 'bar', data: { categories: ['A', 'B', 'C'], series: [{ name: 'S1', labels: ['A', 'B', 'C'], values: [10, 20, 30] }] }, position: { x: 0.5, y: 1.5, w: 4.2, h: 2.5 } },
              { type: 'table', headers: ['Key', 'Value'], rows: [[{ text: 'Alpha' }, { text: '100' }], [{ text: 'Beta' }, { text: '200' }]], position: { x: 5.3, y: 1.5, w: 4.2, h: 2.5 } },
              { type: 'shape', geometry: 'rect', position: { x: 0.5, y: 4.3, w: 2, h: 1 }, style: { fill: '#2196F3' }, text: 'Box A' },
              { type: 'shape', geometry: 'ellipse', position: { x: 3, y: 4.3, w: 2, h: 1 }, style: { fill: '#FF9800' }, text: 'Box B' },
              { type: 'bulletList', items: [{ text: 'Point 1' }, { text: 'Point 2' }], position: { x: 5.5, y: 4.3, w: 4, h: 1 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 1, elementTypes: ['title', 'text', 'chart', 'table', 'bulletList'], hasTheme: true },
  },
  {
    id: 'mixed-10-slides',
    name: '10 页混合 deck',
    category: 'mixed-layout',
    description: '10 页不同类型页面，验证大 deck 生成稳定性',
    deckSpec: {
      title: '10 页混合 Deck',
      layout: '16x9',
      slides: Array.from({ length: 10 }, (_, i) => ({
        slideNumber: i + 1,
        spec: {
          type: 'structured' as const,
          elements: i % 3 === 0
            ? [
                { type: 'title' as const, content: `Slide ${i + 1}`, position: { x: 0.5, y: 0.5, w: 9, h: 1 } },
                { type: 'chart' as const, chartType: 'bar' as const, data: { categories: ['X', 'Y'], series: [{ name: 'D', labels: ['X', 'Y'], values: [i * 10, i * 20] }] }, position: { x: 0.5, y: 1.8, w: 9, h: 3.5 } },
              ]
            : i % 3 === 1
              ? [
                  { type: 'title' as const, content: `Slide ${i + 1}`, position: { x: 0.5, y: 0.5, w: 9, h: 1 } },
                  { type: 'table' as const, headers: ['Col A', 'Col B'], rows: [[{ text: `R${i}-1` }, { text: `R${i}-2` }]], position: { x: 0.5, y: 1.8, w: 9, h: 2 } },
                ]
              : [
                  { type: 'title' as const, content: `Slide ${i + 1}`, position: { x: 0.5, y: 0.5, w: 9, h: 1 } },
                  { type: 'bulletList' as const, items: [{ text: `Item ${i}-A` }, { text: `Item ${i}-B` }, { text: `Item ${i}-C` }], position: { x: 0.5, y: 1.8, w: 9, h: 3 } },
                ],
        },
      })),
    },
    patchSpecs: [
      { type: 'patch', operations: [{ op: 'delete_slide', slideNumber: 5 }] },
    ],
    expectations: { slideCount: 10, elementTypes: ['title', 'chart', 'table', 'bulletList'] },
  },
  {
    id: 'mixed-themed-shapes',
    name: '主题+形状密集页',
    category: 'mixed-layout',
    description: '多个带样式的 shape + 背景 + 主题字体',
    deckSpec: {
      title: '形状与主题测试',
      layout: '16x9',
      theme: { colors: { accent1: '#E91E63', accent2: '#9C27B0' }, fonts: { major: 'Georgia', minor: 'Verdana' } },
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { color: '#F3E5F5' },
            elements: [
              { type: 'title', content: '形状画廊', position: { x: 0.5, y: 0.3, w: 9, h: 0.7 } },
              { type: 'shape', geometry: 'rect', position: { x: 0.5, y: 1.2, w: 2.5, h: 2 }, style: { fill: '#E91E63', rotate: 0 }, text: 'Rect' },
              { type: 'shape', geometry: 'ellipse', position: { x: 3.5, y: 1.2, w: 2.5, h: 2 }, style: { fill: '#9C27B0' }, text: 'Ellipse' },
              { type: 'shape', geometry: 'roundRect', position: { x: 6.5, y: 1.2, w: 2.5, h: 2 }, style: { fill: '#FF9800' }, text: 'RoundRect' },
              { type: 'shape', geometry: 'triangle', position: { x: 0.5, y: 3.5, w: 2.5, h: 2 }, style: { fill: '#4CAF50' }, text: 'Triangle' },
              { type: 'shape', geometry: 'diamond', position: { x: 3.5, y: 3.5, w: 2.5, h: 2 }, style: { fill: '#2196F3' }, text: 'Diamond' },
              { type: 'shape', geometry: 'rect', position: { x: 6.5, y: 3.5, w: 2.5, h: 2 }, style: { fill: '#607D8B', rotate: 15 }, text: 'Rotated' },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 1, elementTypes: ['title', 'text'], hasTheme: true },
  },
  {
    id: 'mixed-freeform-scene-graph',
    name: '复杂 Freeform 场景图',
    category: 'mixed-layout',
    description: 'group + nested group + overlay text + rotated badge 的复杂自由布局页',
    deckSpec: {
      title: 'Scene Graph Stress',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'freeform',
            background: { color: '#0E1726' },
            elements: [
              {
                type: 'group',
                position: { x: 0.8, y: 0.7, w: 8.4, h: 3.2 },
                children: [
                  {
                    type: 'shape',
                    geometry: 'roundRect',
                    position: { x: 0, y: 0, w: 8, h: 3 },
                    style: { fill: '#132238' },
                  },
                  {
                    type: 'text',
                    position: { x: 0.4, y: 0.35, w: 4, h: 0.7 },
                    content: 'North Star Metric',
                    style: { fontSize: 28, color: '#FFFFFF', bold: true },
                  },
                  {
                    type: 'text',
                    position: { x: 0.4, y: 1.15, w: 4.8, h: 0.8 },
                    content: 'Complex freeform group with nested badge and overlay copy',
                    style: { fontSize: 13, color: '#C7D2E2' },
                  },
                  {
                    type: 'group',
                    position: { x: 5.3, y: 0.45, w: 2.1, h: 1.4 },
                    children: [
                      {
                        type: 'shape',
                        geometry: 'ellipse',
                        position: { x: 0, y: 0, w: 2, h: 1.2 },
                        style: { fill: '#2563EB' },
                      },
                      {
                        type: 'text',
                        position: { x: 0.35, y: 0.34, w: 1.3, h: 0.36 },
                        content: '72%',
                        style: { fontSize: 22, color: '#FFFFFF', bold: true, align: 'center' },
                      },
                    ],
                  },
                  {
                    type: 'shape',
                    geometry: 'rect',
                    position: { x: 0.45, y: 2.15, w: 2.1, h: 0.5 },
                    style: { fill: '#F97316', rotate: -4 },
                    content: 'Live now',
                  },
                ],
              },
              {
                type: 'text',
                position: { x: 0.9, y: 4.35, w: 4.7, h: 0.5 },
                content: 'Footer annotation aligned outside main group',
                style: { fontSize: 12, color: '#94A3B8' },
              },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 1, elementTypes: ['text', 'shape'] },
  },
];
