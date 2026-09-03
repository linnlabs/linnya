/**
 * 咨询/汇报风 fixtures
 */
import type { GoldenFixture } from './types.js';

export const consultingFixtures: GoldenFixture[] = [
  {
    id: 'consulting-strategy',
    name: '战略咨询报告',
    category: 'consulting',
    description: '典型 McKinsey 风格：封面+目录+分析+图表+总结',
    deckSpec: {
      title: '2026 年度战略规划',
      layout: '16x9',
      theme: {
        colors: { accent1: '#003366', accent2: '#0066CC' },
        fonts: { major: 'Arial', minor: 'Calibri' },
      },
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { color: '#003366' },
            elements: [
              { type: 'title', content: '2026 年度战略规划', style: { fontSize: 36, bold: true, color: '#FFFFFF' }, position: { x: 1, y: 2, w: 8, h: 1.5 } },
              { type: 'text', content: '机密 — 仅供内部使用', style: { fontSize: 14, color: '#CCCCCC' }, position: { x: 1, y: 4, w: 8, h: 0.5 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '目录', position: { x: 0.5, y: 0.5, w: 9, h: 1 } },
              { type: 'numberedList', items: [{ text: '市场分析' }, { text: '竞争格局' }, { text: '战略建议' }, { text: '实施路线图' }], position: { x: 1, y: 1.8, w: 8, h: 3 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '市场规模与增长趋势', position: { x: 0.5, y: 0.5, w: 9, h: 1 } },
              { type: 'chart', chartType: 'bar', data: { categories: ['2023', '2024', '2025', '2026E'], series: [{ name: '市场规模(亿)', labels: ['2023', '2024', '2025', '2026E'], values: [120, 156, 198, 245] }] }, position: { x: 0.5, y: 1.8, w: 9, h: 4 } },
            ],
          },
        },
        {
          slideNumber: 4,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '竞争格局分析', position: { x: 0.5, y: 0.5, w: 9, h: 1 } },
              { type: 'table', headers: ['公司', '市场份额', '增速', '核心优势'], rows: [
                [{ text: 'A 公司' }, { text: '35%' }, { text: '+12%' }, { text: '品牌' }],
                [{ text: 'B 公司' }, { text: '28%' }, { text: '+8%' }, { text: '渠道' }],
                [{ text: '我们' }, { text: '15%', style: { bold: true } }, { text: '+22%', style: { bold: true } }, { text: '技术' }],
              ], position: { x: 0.5, y: 1.8, w: 9, h: 3 } },
            ],
          },
        },
        {
          slideNumber: 5,
          spec: {
            type: 'structured',
            background: { color: '#003366' },
            elements: [
              { type: 'title', content: '谢谢', style: { fontSize: 36, color: '#FFFFFF', align: 'center' }, position: { x: 1, y: 2.5, w: 8, h: 1.5 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 5, elementTypes: ['title', 'text', 'numberedList', 'chart', 'table'], hasTheme: true },
  },
  {
    id: 'consulting-quarterly',
    name: '季度业务回顾',
    category: 'consulting',
    description: '季度汇报：KPI + 图表 + 要点列表',
    deckSpec: {
      title: 'Q1 2026 业务回顾',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Q1 2026 业务回顾', style: { fontSize: 32 }, position: { x: 1, y: 2, w: 8, h: 1.5 } },
              { type: 'text', content: '产品部 · 2026年4月', style: { fontSize: 16, color: '#666666' }, position: { x: 1, y: 3.8, w: 8, h: 0.5 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: '核心指标概览', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'text', content: 'DAU: 1.2M (+15%)', style: { fontSize: 20, bold: true }, position: { x: 0.5, y: 1.5, w: 4, h: 0.8 } },
              { type: 'text', content: '收入: ¥8.5M (+22%)', style: { fontSize: 20, bold: true }, position: { x: 5, y: 1.5, w: 4.5, h: 0.8 } },
              { type: 'chart', chartType: 'line', data: { categories: ['1月', '2月', '3月'], series: [{ name: 'DAU(万)', labels: ['1月', '2月', '3月'], values: [100, 110, 120] }, { name: '收入(万)', labels: ['1月', '2月', '3月'], values: [250, 280, 320] }] }, position: { x: 0.5, y: 2.5, w: 9, h: 3 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Q2 重点工作', position: { x: 0.5, y: 0.5, w: 9, h: 0.8 } },
              { type: 'bulletList', items: [{ text: '完成 v2.0 核心功能开发' }, { text: '启动海外市场调研' }, { text: '优化用户留存至 45%' }, { text: '团队扩招 3 人' }], position: { x: 0.5, y: 1.5, w: 9, h: 3.5 } },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 3, elementTypes: ['title', 'text', 'chart', 'bulletList'] },
  },
  {
    id: 'consulting-swot',
    name: 'SWOT 分析',
    category: 'consulting',
    description: '经典 SWOT 四象限 + 结论页',
    deckSpec: {
      title: 'SWOT 分析',
      layout: '16x9',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'SWOT 分析', style: { fontSize: 32 }, position: { x: 1, y: 2.5, w: 8, h: 1 } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'SWOT 矩阵', position: { x: 0.5, y: 0.3, w: 9, h: 0.7 } },
              { type: 'shape', geometry: 'rect', position: { x: 0.5, y: 1.2, w: 4.2, h: 2 }, style: { fill: '#E8F5E9' }, text: 'S: 技术领先' },
              { type: 'shape', geometry: 'rect', position: { x: 5.3, y: 1.2, w: 4.2, h: 2 }, style: { fill: '#FFF3E0' }, text: 'W: 品牌弱' },
              { type: 'shape', geometry: 'rect', position: { x: 0.5, y: 3.4, w: 4.2, h: 2 }, style: { fill: '#E3F2FD' }, text: 'O: 市场增长' },
              { type: 'shape', geometry: 'rect', position: { x: 5.3, y: 3.4, w: 4.2, h: 2 }, style: { fill: '#FFEBEE' }, text: 'T: 竞争加剧' },
            ],
          },
        },
      ],
    },
    patchSpecs: [
      {
        type: 'patch',
        operations: [
          { op: 'insert_slide', slideNumber: 3, spec: { type: 'structured', elements: [{ type: 'title', content: '结论与建议', position: { x: 0.5, y: 0.5, w: 9, h: 1 } }, { type: 'bulletList', items: [{ text: '发挥技术优势，加速产品迭代' }, { text: '加大品牌投入' }], position: { x: 0.5, y: 1.8, w: 9, h: 3 } }] } },
        ],
      },
    ],
    expectations: { slideCount: 2, elementTypes: ['title', 'text'] },
  },
  {
    id: 'consulting-mckinsey-10',
    name: '十页咨询风示例',
    category: 'consulting',
    description: '偏麦肯锡风格的 10 页复杂 deck，用于展示和回归复杂排版能力',
    deckSpec: {
      title: 'China Industrial AI Growth Strategy',
      layout: '16x9',
      theme: {
        colors: {
          accent1: '#0F2747',
          accent2: '#1D4E89',
          accent3: '#6B7280',
        },
        fonts: { major: 'Arial', minor: 'Arial' },
      },
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            background: { color: '#0F2747' },
            elements: [
              { type: 'title', content: 'China Industrial AI Growth Strategy', style: { fontSize: 28, bold: true, color: '#FFFFFF' }, position: { x: 0.8, y: 1.35, w: 8.4, h: 0.8 } },
              { type: 'text', content: 'Board discussion material | April 2026', style: { fontSize: 13, color: '#D1D5DB' }, position: { x: 0.8, y: 2.35, w: 5.5, h: 0.35 } },
              { type: 'shape', geometry: 'rect', position: { x: 0.8, y: 4.85, w: 2.1, h: 0.12 }, style: { fill: '#60A5FA' } },
            ],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Executive summary', position: { x: 0.7, y: 0.45, w: 8.8, h: 0.55 } },
              { type: 'shape', geometry: 'rect', position: { x: 0.7, y: 1.35, w: 2.8, h: 2.3 }, style: { fill: '#EEF4FB' }, text: '1\nMarket is scaling faster than most incumbents can respond' },
              { type: 'shape', geometry: 'rect', position: { x: 3.65, y: 1.35, w: 2.8, h: 2.3 }, style: { fill: '#EEF4FB' }, text: '2\nWe have an advantaged right-to-win in high-complexity verticals' },
              { type: 'shape', geometry: 'rect', position: { x: 6.6, y: 1.35, w: 2.7, h: 2.3 }, style: { fill: '#EEF4FB' }, text: '3\nA focused two-year capability build can double EBITDA contribution' },
              { type: 'text', content: 'Recommendation: prioritize three vertical wedges, build a repeatable delivery engine, and front-load ecosystem partnerships.', style: { fontSize: 13, color: '#374151' }, position: { x: 0.7, y: 4.25, w: 8.8, h: 0.55 } },
            ],
          },
        },
        {
          slideNumber: 3,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Industrial AI market is entering a steeper growth curve', position: { x: 0.7, y: 0.45, w: 8.6, h: 0.55 } },
              { type: 'bulletList', items: [
                { text: 'Policy tailwinds continue to support factory modernization' },
                { text: 'Labor shortages accelerate automation demand' },
                { text: 'Large enterprises are shifting from pilots to scaled deployments' },
                { text: 'Software-led service layers expand total value pools' },
              ], position: { x: 0.7, y: 1.35, w: 4.1, h: 3.5 } },
              { type: 'chart', chartType: 'bar', data: { categories: ['2023', '2024', '2025', '2026E', '2027E'], series: [{ name: 'Market size ($B)', labels: ['2023', '2024', '2025', '2026E', '2027E'], values: [12, 15, 19, 24, 30] }] }, position: { x: 5.1, y: 1.35, w: 4.2, h: 3.5 } },
            ],
          },
        },
        {
          slideNumber: 4,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Where value pools concentrate across the stack', position: { x: 0.7, y: 0.45, w: 8.8, h: 0.55 } },
              { type: 'table', headers: ['Layer', '2026E value pool', 'Growth', 'Implication'], rows: [
                [{ text: 'Applications' }, { text: '$6.8B' }, { text: '+28%' }, { text: 'Own vertical use cases' }],
                [{ text: 'Data & workflow' }, { text: '$4.2B' }, { text: '+24%' }, { text: 'Differentiate via orchestration' }],
                [{ text: 'Industrial foundation models' }, { text: '$3.1B' }, { text: '+35%' }, { text: 'Partner, don’t build from scratch' }],
                [{ text: 'Integration services' }, { text: '$5.5B' }, { text: '+18%' }, { text: 'Build repeatable deployment playbooks' }],
              ], position: { x: 0.7, y: 1.35, w: 5.7, h: 2.8 } },
              { type: 'shape', geometry: 'rect', position: { x: 6.8, y: 1.35, w: 2.5, h: 0.9 }, style: { fill: '#E6EEF7' }, text: 'Highest value concentration sits in applications + integration' },
              { type: 'shape', geometry: 'rect', position: { x: 6.8, y: 2.45, w: 2.5, h: 0.9 }, style: { fill: '#E6EEF7' }, text: 'Model economics favor ecosystem plays over full-stack build' },
              { type: 'shape', geometry: 'rect', position: { x: 6.8, y: 3.55, w: 2.5, h: 0.9 }, style: { fill: '#E6EEF7' }, text: 'Repeatable delivery is the main scale unlock' },
            ],
          },
        },
        {
          slideNumber: 5,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Three vertical wedges are most attractive', position: { x: 0.7, y: 0.45, w: 8.8, h: 0.55 } },
              { type: 'shape', geometry: 'rect', position: { x: 0.8, y: 1.35, w: 2.6, h: 1.85 }, style: { fill: '#EEF4FB' }, text: 'Precision electronics\nLarge installed base\nFast ROI cycles' },
              { type: 'shape', geometry: 'rect', position: { x: 3.7, y: 1.35, w: 2.6, h: 1.85 }, style: { fill: '#EEF4FB' }, text: 'Auto components\nStrong defect-reduction case\nProcurement-led buying' },
              { type: 'shape', geometry: 'rect', position: { x: 6.6, y: 1.35, w: 2.6, h: 1.85 }, style: { fill: '#EEF4FB' }, text: 'Pharma packaging\nCompliance pain points\nPremium willingness to pay' },
              { type: 'chart', chartType: 'scatter', data: { categories: ['Precision electronics', 'Auto components', 'Pharma packaging'], series: [{ name: 'Attractiveness', labels: ['Precision electronics', 'Auto components', 'Pharma packaging'], values: [8, 7, 9] }] }, position: { x: 0.9, y: 3.55, w: 3.8, h: 1.6 } },
              { type: 'bulletList', items: [
                { text: 'Start with 2 lighthouse accounts per wedge' },
                { text: 'Codify reusable solution blueprints by quarter 2' },
                { text: 'Use partnerships to shorten model and deployment lead time' },
              ], position: { x: 5.2, y: 3.55, w: 4, h: 1.35 } },
            ],
          },
        },
        {
          slideNumber: 6,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Competitive benchmark suggests we are strong in delivery, weaker in commercial scale', position: { x: 0.7, y: 0.45, w: 8.6, h: 0.55 } },
              { type: 'table', headers: ['Capability', 'Us', 'Peer A', 'Peer B', 'Peer C'], rows: [
                [{ text: 'Domain expertise' }, { text: 'High' }, { text: 'High' }, { text: 'Medium' }, { text: 'Medium' }],
                [{ text: 'Product breadth' }, { text: 'Medium' }, { text: 'High' }, { text: 'High' }, { text: 'Low' }],
                [{ text: 'Delivery repeatability' }, { text: 'High' }, { text: 'Medium' }, { text: 'Medium' }, { text: 'Low' }],
                [{ text: 'Commercial engine' }, { text: 'Low' }, { text: 'High' }, { text: 'Medium' }, { text: 'Medium' }],
                [{ text: 'Partner ecosystem' }, { text: 'Medium' }, { text: 'High' }, { text: 'Low' }, { text: 'Medium' }],
              ], position: { x: 0.7, y: 1.35, w: 8.6, h: 3.8 } },
            ],
          },
        },
        {
          slideNumber: 7,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Prioritization matrix clarifies where to invest first', position: { x: 0.7, y: 0.45, w: 8.8, h: 0.55 } },
              { type: 'shape', geometry: 'rect', position: { x: 1.2, y: 1.45, w: 3.4, h: 1.6 }, style: { fill: '#E6EEF7' }, text: 'Invest now\nCommercial engine\nSolution blueprint factory' },
              { type: 'shape', geometry: 'rect', position: { x: 5.3, y: 1.45, w: 3.4, h: 1.6 }, style: { fill: '#F3F4F6' }, text: 'Selective bets\nPartner ecosystem\nGenAI copilots' },
              { type: 'shape', geometry: 'rect', position: { x: 1.2, y: 3.4, w: 3.4, h: 1.3 }, style: { fill: '#F9FAFB' }, text: 'Monitor\nCustom hardware' },
              { type: 'shape', geometry: 'rect', position: { x: 5.3, y: 3.4, w: 3.4, h: 1.3 }, style: { fill: '#F9FAFB' }, text: 'Deprioritize\nLong-tail bespoke projects' },
              { type: 'text', content: 'High strategic value', style: { fontSize: 11, color: '#6B7280' }, position: { x: 0.8, y: 0.95, w: 2, h: 0.25 } },
              { type: 'shape', geometry: 'rect', text: 'Low ease of execution', style: { fill: '#FFFFFF', opacity: 0, rotate: -90 }, position: { x: 0.15, y: 2.1, w: 1.1, h: 0.35 } },
            ],
          },
        },
        {
          slideNumber: 8,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Twelve-month roadmap focuses on commercialization before broad productization', position: { x: 0.7, y: 0.45, w: 8.6, h: 0.55 } },
              { type: 'shape', geometry: 'rect', style: { fill: '#EEF4FB' }, text: 'Q2\nSelect vertical wedges\nSet 2 lighthouse accounts', position: { x: 0.7, y: 1.6, w: 1.9, h: 2.4 } },
              { type: 'shape', geometry: 'rect', style: { fill: '#EEF4FB' }, text: 'Q3\nLaunch solution blueprint factory\nBuild partner certifications', position: { x: 2.85, y: 1.6, w: 1.9, h: 2.4 } },
              { type: 'shape', geometry: 'rect', style: { fill: '#EEF4FB' }, text: 'Q4\nScale delivery pods\nPublish commercial playbooks', position: { x: 5, y: 1.6, w: 1.9, h: 2.4 } },
              { type: 'shape', geometry: 'rect', style: { fill: '#EEF4FB' }, text: 'Q1\nExpand to adjacent accounts\nLock in repeatable metrics', position: { x: 7.15, y: 1.6, w: 1.9, h: 2.4 } },
            ],
          },
        },
        {
          slideNumber: 9,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Financial upside is meaningful with disciplined focus', position: { x: 0.7, y: 0.45, w: 8.8, h: 0.55 } },
              { type: 'text', content: 'Revenue uplift\n+$42M', style: { fontSize: 24, bold: true, align: 'center' }, position: { x: 0.8, y: 1.25, w: 2.5, h: 0.9 } },
              { type: 'text', content: 'EBITDA uplift\n+$11M', style: { fontSize: 24, bold: true, align: 'center' }, position: { x: 3.7, y: 1.25, w: 2.5, h: 0.9 } },
              { type: 'text', content: 'Payback\n<18 months', style: { fontSize: 24, bold: true, align: 'center' }, position: { x: 6.6, y: 1.25, w: 2.5, h: 0.9 } },
              { type: 'chart', chartType: 'line', data: { categories: ['Base', 'Year 1', 'Year 2', 'Year 3'], series: [{ name: 'Revenue ($M)', labels: ['Base', 'Year 1', 'Year 2', 'Year 3'], values: [55, 68, 84, 97] }, { name: 'EBITDA ($M)', labels: ['Base', 'Year 1', 'Year 2', 'Year 3'], values: [8, 11, 16, 19] }] }, position: { x: 0.8, y: 2.35, w: 8.3, h: 2.5 } },
            ],
          },
        },
        {
          slideNumber: 10,
          spec: {
            type: 'structured',
            elements: [
              { type: 'title', content: 'Immediate next steps', position: { x: 0.7, y: 0.45, w: 8.8, h: 0.55 } },
              { type: 'bulletList', items: [
                { text: 'Approve the three-vertical wedge strategy and target economics' },
                { text: 'Nominate a cross-functional commercialization leader within 2 weeks' },
                { text: 'Select lighthouse accounts and stand up joint account teams' },
                { text: 'Finalize partner shortlist and define blueprint development sprint' },
              ], position: { x: 0.8, y: 1.35, w: 8.2, h: 2.2 } },
              { type: 'shape', geometry: 'rect', position: { x: 0.8, y: 4.25, w: 8.2, h: 0.55 }, style: { fill: '#E6EEF7' }, text: 'Decision required today: approve wedge focus and capability build sequence' },
            ],
          },
        },
      ],
    },
    expectations: { slideCount: 10, elementTypes: ['title', 'text', 'bulletList', 'chart', 'table', 'shape'], hasTheme: true },
  },
];
