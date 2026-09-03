/**
 * 发布会/Keynote 风 fixtures
 */
import type { GoldenFixture } from './types.js';

export const keynoteFixtures: GoldenFixture[] = [
  {
    id: 'keynote-product-launch',
    name: '产品发布会',
    category: 'keynote',
    description: '大标题+数据亮点+功能介绍',
    deckSpec: {
      title: 'Linnya 2.0 发布会',
      layout: '16x9',
      theme: {
        colors: { accent1: '#1A1A2E', accent2: '#E94560' },
        fonts: { major: 'Helvetica Neue', minor: 'Helvetica Neue' },
      },
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { color: '#1A1A2E' },
            elements: [
              { type: 'title', content: 'Linnya 2.0', style: { fontSize: 54, bold: true, color: '#FFFFFF', align: 'center' }, position: { x: 1, y: 1.5, w: 8, h: 2 } },
              { type: 'text', content: '重新定义 AI 写作', style: { fontSize: 24, color: '#E94560', align: 'center' }, position: { x: 1, y: 3.5, w: 8, h: 1 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            background: { color: '#1A1A2E' },
            elements: [
              { type: 'text', content: '10x', style: { fontSize: 72, bold: true, color: '#E94560', align: 'center' }, position: { x: 1, y: 1, w: 8, h: 2 } },
              { type: 'text', content: '写作效率提升', style: { fontSize: 28, color: '#FFFFFF', align: 'center' }, position: { x: 1, y: 3, w: 8, h: 1 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '三大核心能力', position: { x: 0.5, y: 0.5, w: 9, h: 1 } },
              { type: 'bulletList', items: [
                { text: 'AI 长文写作 — 一键生成万字报告' },
                { text: 'AI PPT — 从对话到演示文稿' },
                { text: 'AI 思维导图 — 结构化思考助手' },
              ], style: { fontSize: 20 }, position: { x: 1, y: 1.8, w: 8, h: 3 } },
            ],
          },
        },
        {
          slideNumber: 4,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '用户增长', position: { x: 0.5, y: 0.5, w: 9, h: 1 } },
              { type: 'chart', chartType: 'area', data: { categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: '用户数(万)', labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [5, 18, 52, 120] }] }, position: { x: 0.5, y: 1.5, w: 9, h: 4 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 4, elementTypes: ['title', 'text', 'bulletList', 'chart'], hasTheme: true },
  },
  {
    id: 'keynote-annual',
    name: '年度大会',
    category: 'keynote',
    description: '年度总结+愿景+团队致谢',
    deckSpec: {
      title: '2025 年度大会',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { color: '#0D1117' },
            elements: [
              { type: 'title', content: '2025 · 回顾与展望', style: { fontSize: 40, color: '#FFFFFF', align: 'center' }, position: { x: 1, y: 2, w: 8, h: 1.5 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '年度里程碑', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'numberedList', items: [
                { text: '3月 — 产品 1.0 上线' },
                { text: '6月 — 用户突破 10 万' },
                { text: '9月 — 完成 A 轮融资' },
                { text: '12月 — 海外版本发布' },
              ], style: { fontSize: 18 }, position: { x: 1, y: 1.5, w: 8, h: 3.5 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '2026 愿景', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'text', content: '让每个人都有 AI 助手', style: { fontSize: 28, align: 'center', color: '#333333' }, position: { x: 1, y: 2, w: 8, h: 2 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 3, elementTypes: ['title', 'text', 'numberedList'] },
  },
];
