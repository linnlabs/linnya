/**
 * 科技产品介绍 fixtures
 */
import type { GoldenFixture } from './types.js';

export const productFixtures: GoldenFixture[] = [
  {
    id: 'product-saas',
    name: 'SaaS 产品介绍',
    category: 'product',
    description: '功能列表+对比表格+定价页',
    deckSpec: {
      title: 'CloudSync Pro 产品介绍',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { color: '#F0F4FF' },
            elements: [
              { type: 'title', content: 'CloudSync Pro', style: { fontSize: 36, color: '#1E40AF' }, position: { x: 1, y: 1.5, w: 8, h: 1.5 } },
              { type: 'text', content: '企业级数据同步解决方案', style: { fontSize: 18, color: '#6B7280' }, position: { x: 1, y: 3.2, w: 8, h: 0.8 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '核心功能', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'bulletList', items: [
                { text: '实时双向同步 — 毫秒级延迟' },
                { text: '冲突自动解决 — 基于 CRDT 算法' },
                { text: '端到端加密 — AES-256' },
                { text: '多云支持 — AWS / Azure / GCP' },
              ], style: { fontSize: 16 }, position: { x: 0.5, y: 1.5, w: 9, h: 3.5 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '竞品对比', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'table', headers: ['特性', 'CloudSync Pro', '竞品 A', '竞品 B'], rows: [
                [{ text: '实时同步' }, { text: '✓', style: { bold: true } }, { text: '✓' }, { text: '✗' }],
                [{ text: '端到端加密' }, { text: '✓', style: { bold: true } }, { text: '✗' }, { text: '✓' }],
                [{ text: '多云支持' }, { text: '3 家', style: { bold: true } }, { text: '1 家' }, { text: '2 家' }],
                [{ text: '价格/月' }, { text: '$99' }, { text: '$149' }, { text: '$129' }],
              ], position: { x: 0.5, y: 1.5, w: 9, h: 3.5 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 3, elementTypes: ['title', 'text', 'bulletList', 'table'] },
  },
  {
    id: 'product-api',
    name: 'API 平台介绍',
    category: 'product',
    description: '架构图占位+性能数据+接入流程',
    deckSpec: {
      title: 'OpenAPI 平台',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'OpenAPI 平台', style: { fontSize: 32 }, position: { x: 1, y: 2, w: 8, h: 1.5 } },
              { type: 'text', content: '一站式 API 管理与分发', position: { x: 1, y: 3.8, w: 8, h: 0.5 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '性能基准', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'chart', chartType: 'bar', data: { categories: ['P50', 'P95', 'P99'], series: [{ name: '延迟(ms)', labels: ['P50', 'P95', 'P99'], values: [12, 45, 120] }] }, position: { x: 0.5, y: 1.5, w: 9, h: 4 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '接入流程', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'numberedList', items: [
                { text: '注册开发者账号' },
                { text: '创建应用并获取 API Key' },
                { text: '集成 SDK（支持 10+ 语言）' },
                { text: '上线并监控' },
              ], position: { x: 0.5, y: 1.5, w: 9, h: 3.5 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 3, elementTypes: ['title', 'text', 'chart', 'numberedList'] },
  },
];
