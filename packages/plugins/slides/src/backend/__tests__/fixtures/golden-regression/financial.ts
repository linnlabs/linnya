/**
 * 财报/数据驱动 fixtures
 */
import type { GoldenFixture } from './types.js';

export const financialFixtures: GoldenFixture[] = [
  {
    id: 'financial-quarterly',
    name: '季度财报',
    category: 'financial',
    description: '多图表+表格+KPI 数字页',
    deckSpec: {
      title: 'Q1 2026 财务报告',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Q1 2026 财务报告', style: { fontSize: 32 }, position: { x: 1, y: 2, w: 8, h: 1.5 } },
              { type: 'text', content: '财务部 · 2026年4月', style: { color: '#666666' }, position: { x: 1, y: 3.8, w: 8, h: 0.5 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '收入结构', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'chart', chartType: 'pie', data: { categories: ['订阅', '广告', '增值服务', '其他'], series: [{ name: '收入占比', labels: ['订阅', '广告', '增值服务', '其他'], values: [55, 25, 15, 5] }] }, position: { x: 0.5, y: 1.5, w: 4.2, h: 4 } },
              { type: 'chart', chartType: 'bar', data: { categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: '2025', labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [800, 920, 1050, 1200] }, { name: '2026', labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [1100, 0, 0, 0] }] }, position: { x: 5.3, y: 1.5, w: 4.2, h: 4 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '损益表摘要', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'table', headers: ['科目', 'Q1 2026', 'Q1 2025', 'YoY'], rows: [
                [{ text: '营业收入' }, { text: '¥11.0M' }, { text: '¥8.0M' }, { text: '+37.5%', style: { color: '#16A34A', bold: true } }],
                [{ text: '营业成本' }, { text: '¥4.4M' }, { text: '¥3.6M' }, { text: '+22.2%' }],
                [{ text: '毛利润' }, { text: '¥6.6M', style: { bold: true } }, { text: '¥4.4M' }, { text: '+50.0%', style: { color: '#16A34A', bold: true } }],
                [{ text: '净利润' }, { text: '¥2.2M', style: { bold: true } }, { text: '¥1.0M' }, { text: '+120%', style: { color: '#16A34A', bold: true } }],
              ], position: { x: 0.5, y: 1.5, w: 9, h: 3.5 } },
            ],
          },
        },
        {
          slideNumber: 4,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '现金流趋势', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'chart', chartType: 'line', data: { categories: ['1月', '2月', '3月'], series: [{ name: '经营现金流', labels: ['1月', '2月', '3月'], values: [320, 380, 450] }, { name: '投资现金流', labels: ['1月', '2月', '3月'], values: [-150, -200, -180] }] }, position: { x: 0.5, y: 1.5, w: 9, h: 4 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 4, elementTypes: ['title', 'text', 'chart', 'table'] },
  },
  {
    id: 'financial-kpi-dashboard',
    name: 'KPI 仪表盘',
    category: 'financial',
    description: '纯数字+图表的数据密集型 deck',
    deckSpec: {
      title: 'KPI Dashboard',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'KPI Dashboard — March 2026', style: { fontSize: 28 }, position: { x: 0.5, y: 0.3, w: 9, h: 0.7 } },
              { type: 'text', content: 'MRR: $850K', style: { fontSize: 24, bold: true, color: '#16A34A' }, position: { x: 0.5, y: 1.2, w: 3, h: 0.8 } },
              { type: 'text', content: 'Churn: 2.1%', style: { fontSize: 24, bold: true, color: '#DC2626' }, position: { x: 3.5, y: 1.2, w: 3, h: 0.8 } },
              { type: 'text', content: 'NPS: 72', style: { fontSize: 24, bold: true, color: '#2563EB' }, position: { x: 6.5, y: 1.2, w: 3, h: 0.8 } },
              { type: 'chart', chartType: 'line', data: { categories: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'], series: [{ name: 'MRR($K)', labels: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'], values: [620, 680, 720, 780, 810, 850] }] }, position: { x: 0.5, y: 2.2, w: 9, h: 3.3 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '用户漏斗', position: { x: 0.5, y: 0.3, w: 9, h: 0.7 } },
              { type: 'chart', chartType: 'bar', data: { categories: ['访问', '注册', '激活', '付费', '续费'], series: [{ name: '用户数', labels: ['访问', '注册', '激活', '付费', '续费'], values: [50000, 12000, 8000, 3200, 2800] }] }, position: { x: 0.5, y: 1.2, w: 9, h: 4.3 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 2, elementTypes: ['title', 'text', 'chart'] },
  },
  {
    id: 'financial-investor',
    name: '投资者简报',
    category: 'financial',
    description: '融资 pitch 风格：市场+增长+财务',
    deckSpec: {
      title: 'Series A Pitch',
      layout: '16x9',
      theme: { colors: { accent1: '#7C3AED' }, fonts: { major: 'Inter', minor: 'Inter' } },
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { color: '#7C3AED' },
            elements: [
              { type: 'title', content: 'Series A Pitch', style: { fontSize: 40, color: '#FFFFFF', align: 'center' }, position: { x: 1, y: 2, w: 8, h: 1.5 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'TAM / SAM / SOM', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'chart', chartType: 'doughnut', data: { categories: ['TAM', 'SAM', 'SOM'], series: [{ name: '市场规模(亿)', labels: ['TAM', 'SAM', 'SOM'], values: [500, 80, 12] }] }, position: { x: 0.5, y: 1.5, w: 9, h: 4 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '融资用途', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'table', headers: ['用途', '金额', '占比'], rows: [
                [{ text: '研发' }, { text: '$3M' }, { text: '50%' }],
                [{ text: '市场' }, { text: '$1.8M' }, { text: '30%' }],
                [{ text: '运营' }, { text: '$1.2M' }, { text: '20%' }],
              ], position: { x: 0.5, y: 1.5, w: 9, h: 3 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 3, elementTypes: ['title', 'chart', 'table'], hasTheme: true },
  },
];
