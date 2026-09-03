/**
 * 教育/课程 fixtures
 */
import type { GoldenFixture } from './types.js';

export const educationFixtures: GoldenFixture[] = [
  {
    id: 'education-course',
    name: '课程讲义',
    category: 'education',
    description: '章节页+要点列表+练习页',
    deckSpec: {
      title: '数据结构与算法 — 第三讲',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { color: '#1E3A5F' },
            elements: [
              { type: 'title', content: '数据结构与算法', style: { fontSize: 36, color: '#FFFFFF' }, position: { x: 1, y: 1.5, w: 8, h: 1.5 } },
              { type: 'text', content: '第三讲：树与二叉树', style: { fontSize: 22, color: '#90CAF9' }, position: { x: 1, y: 3.2, w: 8, h: 0.8 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '本讲大纲', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'numberedList', items: [
                { text: '树的基本概念与术语' },
                { text: '二叉树的性质' },
                { text: '遍历算法：前序、中序、后序' },
                { text: '平衡二叉树简介' },
                { text: '课堂练习' },
              ], style: { fontSize: 18 }, position: { x: 0.5, y: 1.5, w: 9, h: 3.5 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '树的基本概念', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'bulletList', items: [
                { text: '根节点（Root）：没有父节点的节点' },
                { text: '叶节点（Leaf）：没有子节点的节点' },
                { text: '深度（Depth）：从根到该节点的路径长度' },
                { text: '高度（Height）：从该节点到最远叶节点的路径长度' },
              ], position: { x: 0.5, y: 1.5, w: 9, h: 3.5 } },
            ],
            notes: '强调深度和高度的区别，学生容易混淆',
          },
        },
        {
          slideNumber: 4,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '二叉树的性质', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'table', headers: ['性质', '描述'], rows: [
                [{ text: '性质 1' }, { text: '第 i 层最多有 2^(i-1) 个节点' }],
                [{ text: '性质 2' }, { text: '深度为 k 的二叉树最多有 2^k - 1 个节点' }],
                [{ text: '性质 3' }, { text: 'n0 = n2 + 1（叶节点数 = 度为2的节点数 + 1）' }],
              ], position: { x: 0.5, y: 1.5, w: 9, h: 3 } },
            ],
          },
        },
        {
          slideNumber: 5,
          spec: {
            type: 'structured',
            background: { color: '#FFF8E1' },
            elements: [
              { type: 'title', content: '课堂练习', style: { color: '#E65100' }, position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'numberedList', items: [
                { text: '画出以下序列构建的 BST：[5, 3, 7, 1, 4, 6, 8]' },
                { text: '写出上述 BST 的中序遍历结果' },
                { text: '删除节点 3 后，画出新的 BST' },
              ], style: { fontSize: 16 }, position: { x: 0.5, y: 1.5, w: 9, h: 3.5 } },
            ],
            notes: '给学生 10 分钟完成，然后一起讲解',
          },
        },
      ],
    },
    expectations: { slideCount: 5, elementTypes: ['title', 'text', 'numberedList', 'bulletList', 'table'] },
  },
  {
    id: 'education-workshop',
    name: '工作坊材料',
    category: 'education',
    description: '互动式工作坊：步骤+图表+讨论',
    deckSpec: {
      title: 'Design Thinking Workshop',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Design Thinking Workshop', style: { fontSize: 32 }, position: { x: 1, y: 2, w: 8, h: 1.5 } },
              { type: 'text', content: 'Duration: 3 hours', style: { color: '#666666' }, position: { x: 1, y: 3.8, w: 8, h: 0.5 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Five Phases', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'chart', chartType: 'bar', data: { categories: ['Empathize', 'Define', 'Ideate', 'Prototype', 'Test'], series: [{ name: 'Time (min)', labels: ['Empathize', 'Define', 'Ideate', 'Prototype', 'Test'], values: [30, 20, 40, 50, 40] }] }, position: { x: 0.5, y: 1.5, w: 9, h: 4 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Discussion Questions', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'bulletList', items: [
                { text: 'Who is your target user?' },
                { text: 'What is their biggest pain point?' },
                { text: 'How might we solve this?' },
              ], style: { fontSize: 20 }, position: { x: 0.5, y: 1.5, w: 9, h: 3.5 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 3, elementTypes: ['title', 'text', 'chart', 'bulletList'] },
  },
];
