/**
 * referenceHighDensityShowcase — 英文咨询风格范例样本
 *
 * 三页高密度咨询风格 PPT 参考实现（通过底层 directCompose API 构建）。
 * 用途：作为 AI-PPT 工具集的视觉基准——此脚本展示了"理想输出"的上限。
 *
 * - Slide 1: SaaS ARR 增长仪表盘（深蓝科技风格，KPI 行 + 折线图 + 柱状图 + 洞察）
 * - Slide 2: 东南亚医疗市场进入策略（波士顿绿风格，饼图 + 横向柱状图 + 战略建议）
 * - Slide 3: 供应链韧性评估（橙色工业风格，雷达图 + 堆叠柱状图 + 风险矩阵）
 *
 * 运行方式：
 *   LINNYA_DEV_MODE=true node scripts/test-runner/run-test-with-electron.cjs \
 *     packages/plugins/slides/dev/tools/referenceHighDensityShowcase.ts \
 *     [--project-id <id>] [--parent-id <id>]
 *
 * 注意：此脚本使用 readDirectComposeInput / directCompose 底层 API，
 * 不经过 agent tool chain。如需测试 tool chain 上限，请使用 toolChainShowcaseTest.ts。
 */

import type { Database } from 'better-sqlite3';
import { DatabaseService } from 'src/electron-main/services/database.js';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace.js';
import { createPptCoordinator } from '@plugin/slides/backend-coordinator';
import { PptInspectTool } from '@plugin/slides/backend-tool-classes';
import type { StructuredToolResult, ToolContext } from 'src/tools/types.js';
import { attachPresentationCoordinatorToToolContext } from '@plugin/slides/backend-tools';
import {
  readDirectComposeInput,
  buildDeckSpecFromDirectInput,
} from '@plugin/slides/backend-codegen';
import { createInProcessPresentationBuildExecution } from '../../src/backend/features/presentationBuildExecution';

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface CliOptions {
  projectId?: string;
  parentId?: string;
}

interface ProjectRow {
  id: string;
  name: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--project-id':
        if (!next) throw new Error('Missing value for --project-id');
        options.projectId = next;
        i += 1;
        break;
      case '--parent-id':
        if (!next) throw new Error('Missing value for --parent-id');
        options.parentId = next;
        i += 1;
        break;
      case '--help':
        console.log('Usage: ... [--project-id <id>] [--parent-id <id>]');
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function resolveProject(db: Database, requestedId?: string): ProjectRow {
  if (requestedId?.trim()) {
    const row = db.prepare<[string], ProjectRow>(
      `SELECT id, name FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    ).get(requestedId.trim());
    if (!row) throw new Error(`Project not found: ${requestedId}`);
    return row;
  }
  const row = db.prepare<[], ProjectRow>(
    `SELECT id, name FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
  ).get();
  if (!row) throw new Error('No project found.');
  return row;
}

function buildToolContext(projectId: string) {
  const databaseService = new DatabaseService();
  databaseService.initialize();
  const db = databaseService.getDb();
  return {
    databaseService,
    workspaceService: new WorkspaceService(db),
    context: attachPresentationCoordinatorToToolContext({
      workspaceProjectId: projectId,
      databaseService,
      workspaceService: new WorkspaceService(db),
    } as ToolContext, createPptCoordinator(db, {
      buildExecution: createInProcessPresentationBuildExecution(),
    })),
  };
}

function parse<T>(raw: string): StructuredToolResult<T> {
  return JSON.parse(raw) as StructuredToolResult<T>;
}

// ─── 画布常量（16:9 = 10" × 5.625"） ────────────────────────────────────────

const W = 10;
const H = 5.625;
const MX = 0.4;
const MY = 0.1;
const INNER_W = W - 2 * MX;

// ─── Slide 1: SaaS ARR 增长仪表盘 ──────────────────────────────────────────

function buildSaasSlide() {
  const kpiY = 0.92;
  const kpiH = 0.7;
  const kpiW = 2.15;
  const kpiGap = 0.1;

  // 图表区域
  const chartY = 1.78;
  const chartH = 2.1;
  const leftChartW = 5.4;
  const rightChartW = 3.4;
  const chartGap = 0.2;
  const leftX = MX;
  const rightX = leftX + leftChartW + chartGap;

  // 洞察区域
  const insightY = 4.08;
  const insightH = 1.1;

  return {
    background: { color: '#FFFFFF' },
    elements: [
      // ── 顶部深蓝强调线 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: 0, w: W, h: 0.03 }, style: { fill: '#0B2545' } },

      // ── Eyebrow ──
      {
        type: 'text',
        content: 'SaaS Metrics | ARR Growth & Unit Economics | Q4 FY2025',
        position: { x: MX, y: MY, w: INNER_W, h: 0.2 },
        style: { fontSize: 7, color: '#888888', fontFamily: 'Arial' },
      },

      // ── 主标题 ──
      {
        type: 'text',
        content: 'ARR surpassed $240M (+38% YoY); Net Revenue Retention exceeded 130% for the third consecutive quarter, driven by platform upsell',
        position: { x: MX, y: 0.3, w: INNER_W, h: 0.46 },
        style: { fontSize: 14, bold: true, color: '#0B2545', fontFamily: 'Georgia', lineSpacing: 1.07 },
      },

      // ── 左侧竖条装饰 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0.14, y: 0.33, w: 0.055, h: 0.38 }, style: { fill: '#0B2545' } },

      // ── 灰色分隔线 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: MX, y: 0.82, w: INNER_W, h: 0.005 }, style: { fill: '#D0D0D0' } },

      // ── KPI 行（4 个指标卡片） ──
      ...buildKpiCard(MX, kpiY, kpiW, kpiH, '$241M', 'Annual Recurring Revenue', '+38% YoY', '#0B2545'),
      ...buildKpiCard(MX + kpiW + kpiGap, kpiY, kpiW, kpiH, '131%', 'Net Revenue Retention', '+4pp vs Q3', '#1B6B3A'),
      ...buildKpiCard(MX + 2 * (kpiW + kpiGap), kpiY, kpiW, kpiH, '$18.2K', 'Avg Contract Value', '+22% YoY', '#0B2545'),
      ...buildKpiCard(MX + 3 * (kpiW + kpiGap), kpiY, kpiW, kpiH, '8.4 mo', 'CAC Payback Period', '–2.1 mo vs FY24', '#1B6B3A'),

      // ── 左图标题 ──
      {
        type: 'text',
        content: 'ARR Trajectory & Growth Rate (Quarterly)',
        position: { x: leftX, y: chartY - 0.2, w: leftChartW, h: 0.18 },
        style: { fontSize: 7.5, bold: true, color: '#333333', fontFamily: 'Arial' },
      },

      // ── 左图：ARR 增长堆叠柱状图（New + Expansion – Churn） ──
      {
        type: 'chart',
        chartPreset: 'stacked-column',
        position: { x: leftX, y: chartY, w: leftChartW, h: chartH },
        categories: ['Q1\'24', 'Q2\'24', 'Q3\'24', 'Q4\'24', 'Q1\'25', 'Q2\'25', 'Q3\'25', 'Q4\'25'],
        series: [
          { name: 'New ARR ($M)', labels: ['Q1\'24', 'Q2\'24', 'Q3\'24', 'Q4\'24', 'Q1\'25', 'Q2\'25', 'Q3\'25', 'Q4\'25'], values: [8.2, 9.5, 11.1, 14.3, 12.8, 15.6, 17.2, 21.4] },
          { name: 'Expansion ($M)', labels: ['Q1\'24', 'Q2\'24', 'Q3\'24', 'Q4\'24', 'Q1\'25', 'Q2\'25', 'Q3\'25', 'Q4\'25'], values: [3.1, 3.8, 4.5, 5.2, 5.8, 6.9, 8.1, 9.5] },
          { name: 'Churn ($M)', labels: ['Q1\'24', 'Q2\'24', 'Q3\'24', 'Q4\'24', 'Q1\'25', 'Q2\'25', 'Q3\'25', 'Q4\'25'], values: [-1.8, -2.0, -1.9, -2.3, -2.1, -2.4, -2.2, -2.6] },
        ],
        legendPosition: 'bottom',
      },

      // ── 右图标题 ──
      {
        type: 'text',
        content: 'ARR by Segment ($M)',
        position: { x: rightX, y: chartY - 0.2, w: rightChartW, h: 0.18 },
        style: { fontSize: 7.5, bold: true, color: '#333333', fontFamily: 'Arial' },
      },

      // ── 右图：客户分层柱状图 ──
      {
        type: 'chart',
        chartPreset: 'horizontal-bar',
        position: { x: rightX, y: chartY, w: rightChartW, h: chartH },
        categories: ['Enterprise', 'Mid-Market', 'SMB', 'Self-Serve'],
        series: [
          { name: 'FY24', labels: ['Enterprise', 'Mid-Market', 'SMB', 'Self-Serve'], values: [68, 42, 38, 27] },
          { name: 'FY25', labels: ['Enterprise', 'Mid-Market', 'SMB', 'Self-Serve'], values: [98, 58, 52, 33] },
        ],
        showDataLabels: true,
        legendPosition: 'bottom',
      },

      // ── 洞察区背景 ──
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: MX - 0.05, y: insightY - 0.06, w: INNER_W + 0.1, h: insightH + 0.08 },
        style: { fill: '#F4F6F9', border: { color: '#E0E4EA', width: 0.5, dash: 'solid' } },
      },

      // ── 洞察列 1 ──
      {
        type: 'text',
        content: '• Enterprise segment grew 44% YoY driven by 3 seven-figure platform deals in Q4\n\n• Top-10 accounts now represent $62M ARR (26% of total), up from 19% in FY24',
        position: { x: MX + 0.08, y: insightY, w: 2.95, h: insightH },
        style: { fontSize: 7, color: '#333333', fontFamily: 'Arial', lineSpacing: 1.2 },
      },

      // ── 洞察列 2 ──
      {
        type: 'text',
        content: '• Platform attach rate reached 68% for new logos vs. 41% a year ago\n\n• Gross margin improved to 78.3% as infrastructure costs scaled sub-linearly',
        position: { x: MX + 3.15, y: insightY, w: 2.95, h: insightH },
        style: { fontSize: 7, color: '#333333', fontFamily: 'Arial', lineSpacing: 1.2 },
      },

      // ── 洞察列 3 ──
      {
        type: 'text',
        content: '• CAC payback shortened by 2.1 months; sales productivity up 31% per rep\n\n• Path to $400M ARR by FY27 requires sustaining 35%+ growth and keeping NRR >125%',
        position: { x: MX + 6.22, y: insightY, w: 2.95, h: insightH },
        style: { fontSize: 7, color: '#333333', fontFamily: 'Arial', lineSpacing: 1.2 },
      },

      // ── 来源 ──
      {
        type: 'text',
        content: 'Source: Internal Finance Systems, Salesforce CRM, Board-approved FY25 results (unaudited)',
        position: { x: MX, y: 5.26, w: 6, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: 'Arial', italic: true },
      },

      // ── 品牌标识 ──
      {
        type: 'text',
        content: 'CONFIDENTIAL — Board Review Material',
        position: { x: 7, y: 5.26, w: 2.8, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: 'Arial', italic: true, align: 'right' },
      },

      // ── 底部强调线 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: H - 0.03, w: W, h: 0.03 }, style: { fill: '#0B2545' } },
    ],
  };
}

// ── KPI 卡片构建器 ──
function buildKpiCard(
  x: number, y: number, w: number, h: number,
  value: string, label: string, delta: string, accentColor: string,
) {
  return [
    {
      type: 'shape', geometry: { type: 'preset', name: 'rect' },
      position: { x, y, w, h },
      style: { fill: '#F8F9FB', border: { color: '#E4E7EC', width: 0.5, dash: 'solid' } },
    },
    {
      type: 'shape', geometry: { type: 'preset', name: 'rect' },
      position: { x, y, w, h: 0.03 },
      style: { fill: accentColor },
    },
    {
      type: 'text',
      content: value,
      position: { x: x + 0.12, y: y + 0.1, w: w - 0.24, h: 0.28 },
      style: { fontSize: 18, bold: true, color: accentColor, fontFamily: 'Georgia' },
    },
    {
      type: 'text',
      content: label,
      position: { x: x + 0.12, y: y + 0.35, w: w - 0.24, h: 0.14 },
      style: { fontSize: 7, color: '#666666', fontFamily: 'Arial' },
    },
    {
      type: 'text',
      content: delta,
      position: { x: x + 0.12, y: y + 0.5, w: w - 0.24, h: 0.14 },
      style: { fontSize: 7, bold: true, color: '#1B6B3A', fontFamily: 'Arial' },
    },
  ];
}

// ─── Slide 2: 东南亚医疗市场进入策略 ──────────────────────────────────────────

function buildHealthcareSlide() {
  const leftW = 4.3;
  const rightW = 4.5;
  const gap = 0.2;
  const leftX = MX;
  const rightX = leftX + leftW + gap;
  const chartTopY = 1.12;
  const chartH = 2.1;

  return {
    background: { color: '#FFFFFF' },
    elements: [
      // ── 顶部绿色强调线 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: 0, w: W, h: 0.025 }, style: { fill: '#1A6B4A' } },

      // ── Eyebrow ──
      {
        type: 'text',
        content: 'Market Entry Strategy | Southeast Asia Healthcare | 2025–2030',
        position: { x: MX, y: 0.06, w: INNER_W, h: 0.2 },
        style: { fontSize: 7.5, color: '#888888', fontFamily: 'Arial' },
      },

      // ── 主标题 ──
      {
        type: 'text',
        content: 'SEA healthcare market will reach $98B by 2030 (9.2% CAGR); Vietnam and Philippines represent the highest-growth entry points for digital health platforms',
        position: { x: MX, y: 0.26, w: INNER_W, h: 0.52 },
        style: { fontSize: 13.5, bold: true, color: '#1A3A2A', fontFamily: 'Georgia', lineSpacing: 1.1 },
      },

      // ── 竖条装饰 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0.14, y: 0.28, w: 0.055, h: 0.42 }, style: { fill: '#1A6B4A' } },

      // ── 灰色分隔线 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: MX, y: 0.84, w: INNER_W, h: 0.005 }, style: { fill: '#D0D0D0' } },

      // ── 左图框 ──
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: leftX - 0.06, y: 0.86, w: leftW + 0.12, h: chartH + 0.44 },
        style: { fill: '#FAFBFC', border: { color: '#E0E7DF', width: 0.5, dash: 'solid' } },
      },

      // ── 左图标题 ──
      {
        type: 'text',
        content: 'Healthcare Spend by Segment | 2030E ($B)',
        position: { x: leftX + 0.08, y: 0.9, w: leftW - 0.16, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#333333', fontFamily: 'Arial' },
      },

      // ── 左图：医疗支出饼图 ──
      {
        type: 'chart',
        chartPreset: 'doughnut',
        position: { x: leftX, y: chartTopY, w: leftW, h: chartH },
        categories: ['Hospitals & Clinics', 'Pharma & Biotech', 'Digital Health', 'Medical Devices', 'Diagnostics'],
        series: [
          { name: 'Spend $B', labels: ['Hospitals & Clinics', 'Pharma & Biotech', 'Digital Health', 'Medical Devices', 'Diagnostics'], values: [38.2, 24.5, 15.8, 12.3, 7.2] },
        ],
        showDataLabels: true,
        dataLabelFormat: '$#,##0.0"B"',
        legendPosition: 'bottom',
      },

      // ── 右图框 ──
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: rightX - 0.06, y: 0.86, w: rightW + 0.12, h: chartH + 0.44 },
        style: { fill: '#FAFBFC', border: { color: '#E0E7DF', width: 0.5, dash: 'solid' } },
      },

      // ── 右图标题 ──
      {
        type: 'text',
        content: 'Market Size by Country | 2025 vs 2030E ($B)',
        position: { x: rightX + 0.08, y: 0.9, w: rightW - 0.16, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#333333', fontFamily: 'Arial' },
      },

      // ── 右图：各国市场横向柱状图 ──
      {
        type: 'chart',
        chartPreset: 'horizontal-bar',
        position: { x: rightX, y: chartTopY, w: rightW, h: chartH },
        categories: ['Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'Malaysia', 'Singapore'],
        series: [
          { name: '2025', labels: ['Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'Malaysia', 'Singapore'], values: [18.4, 12.1, 8.6, 7.2, 6.8, 5.9] },
          { name: '2030E', labels: ['Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'Malaysia', 'Singapore'], values: [31.2, 18.5, 16.8, 14.1, 10.2, 7.2] },
        ],
        showDataLabels: true,
        dataLabelFormat: '$#,##0.0',
        legendPosition: 'bottom',
      },

      // ── CAGR 标注 ──
      {
        type: 'text',
        content: 'Vietnam CAGR\n14.3%',
        position: { x: rightX + rightW - 1.2, y: 0.9, w: 1.0, h: 0.2 },
        style: { fontSize: 7, bold: true, color: '#1A6B4A', fontFamily: 'Arial', align: 'right' },
      },

      // ── 核心发现区背景 ──
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: MX - 0.05, y: 3.48, w: INNER_W + 0.1, h: 0.48 },
        style: { fill: '#F4F8F5', border: { color: '#D4E2D9', width: 0.5, dash: 'solid' } },
      },

      // ── 核心发现左 ──
      {
        type: 'text',
        content: 'Digital health is the fastest-growing segment at 18.5% CAGR, driven by telemedicine adoption post-COVID and rising smartphone penetration (78% in urban SEA).',
        position: { x: MX + 0.08, y: 3.52, w: 4.4, h: 0.38 },
        style: { fontSize: 7, color: '#333333', fontFamily: 'Arial', lineSpacing: 1.2 },
      },

      // ── 核心发现右 ──
      {
        type: 'text',
        content: 'Vietnam and Philippines show 2x the growth rate of mature markets (Singapore, Malaysia). Low insurance penetration (18–25%) creates a greenfield opportunity for digital-first models.',
        position: { x: MX + 4.7, y: 3.52, w: 4.4, h: 0.38 },
        style: { fontSize: 7, color: '#333333', fontFamily: 'Arial', lineSpacing: 1.2 },
      },

      // ── 战略建议标题 ──
      {
        type: 'text',
        content: 'Recommended Entry Sequence',
        position: { x: MX, y: 4.06, w: INNER_W, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#1A3A2A', fontFamily: 'Arial' },
      },

      // ── 战略阶段 ──
      ...buildPhaseCard(MX, 4.28, 2.85, 0.65, 'Phase 1 — 2025–26', 'Vietnam market entry via telemedicine partnerships with VinMec and FPT Health. Target 500K MAU within 18 months.', '#1A6B4A'),
      ...buildPhaseCard(MX + 3.05, 4.28, 2.85, 0.65, 'Phase 2 — 2027–28', 'Philippines expansion leveraging GCash and Maya integrations. Scale diagnostic platform to 3 provincial networks.', '#2D8B6A'),
      ...buildPhaseCard(MX + 6.1, 4.28, 2.85, 0.65, 'Phase 3 — 2029–30', 'Indonesia full-market launch with BPJS integration. Requires local JV structure and regulatory pre-clearance.', '#4AAA8A'),

      // ── 来源 ──
      {
        type: 'text',
        content: 'Sources: WHO SEA Health Report 2024, Bain SEA Healthcare 2025, Frost & Sullivan MedTech Outlook, Team analysis',
        position: { x: MX, y: 5.1, w: 7, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: 'Arial', italic: true },
      },

      // ── 品牌 ──
      {
        type: 'text',
        content: 'DRAFT — For Discussion Only',
        position: { x: 7.5, y: 5.1, w: 2.3, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: 'Arial', italic: true, align: 'right' },
      },

      // ── 底部绿色强调线 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: H - 0.025, w: W, h: 0.025 }, style: { fill: '#1A6B4A' } },
    ],
  };
}

// ── 战略阶段卡片构建器 ──
function buildPhaseCard(
  x: number, y: number, w: number, h: number,
  title: string, description: string, accentColor: string,
) {
  return [
    {
      type: 'shape', geometry: { type: 'preset', name: 'rect' },
      position: { x, y, w, h },
      style: { fill: '#FFFFFF', border: { color: '#D4E2D9', width: 0.5, dash: 'solid' } },
    },
    {
      type: 'shape', geometry: { type: 'preset', name: 'rect' },
      position: { x, y, w: 0.04, h },
      style: { fill: accentColor },
    },
    {
      type: 'text',
      content: title,
      position: { x: x + 0.12, y: y + 0.04, w: w - 0.2, h: 0.16 },
      style: { fontSize: 7.5, bold: true, color: accentColor, fontFamily: 'Arial' },
    },
    {
      type: 'text',
      content: description,
      position: { x: x + 0.12, y: y + 0.2, w: w - 0.2, h: h - 0.28 },
      style: { fontSize: 6.5, color: '#444444', fontFamily: 'Arial', lineSpacing: 1.15 },
    },
  ];
}

// ─── Slide 3: 供应链韧性评估 ────────────────────────────────────────────────

function buildSupplyChainSlide() {
  const leftW = 4.2;
  const rightW = 4.6;
  const gap = 0.2;
  const leftX = MX;
  const rightX = leftX + leftW + gap;
  const chartTopY = 1.12;
  const chartH = 2.2;

  return {
    background: { color: '#FFFFFF' },
    elements: [
      // ── 顶部橙色强调线 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: 0, w: W, h: 0.03 }, style: { fill: '#C45B28' } },

      // ── Eyebrow ──
      {
        type: 'text',
        content: 'Supply Chain Resilience | Risk Assessment & Mitigation | FY2025 Review',
        position: { x: MX, y: MY, w: INNER_W, h: 0.2 },
        style: { fontSize: 7.5, color: '#888888', fontFamily: 'Arial' },
      },

      // ── 主标题 ──
      {
        type: 'text',
        content: 'Overall supply chain resilience score improved from 2.8 to 3.6 (out of 5); critical single-source dependencies reduced by 40%, but logistics cost inflation remains a headwind',
        position: { x: MX, y: 0.28, w: INNER_W, h: 0.52 },
        style: { fontSize: 13, bold: true, color: '#3A2518', fontFamily: 'Georgia', lineSpacing: 1.1 },
      },

      // ── 竖条装饰 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0.14, y: 0.3, w: 0.055, h: 0.42 }, style: { fill: '#C45B28' } },

      // ── 灰色分隔线 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: MX, y: 0.86, w: INNER_W, h: 0.005 }, style: { fill: '#D0D0D0' } },

      // ── 左图框 ──
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: leftX - 0.06, y: 0.88, w: leftW + 0.12, h: chartH + 0.42 },
        style: { fill: '#FDFAF7', border: { color: '#E8DDD4', width: 0.5, dash: 'solid' } },
      },

      // ── 左图标题 ──
      {
        type: 'text',
        content: 'Resilience Score by Dimension (1–5)',
        position: { x: leftX + 0.08, y: 0.92, w: leftW - 0.16, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#333333', fontFamily: 'Arial' },
      },

      // ── 左图：雷达图 ──
      {
        type: 'chart',
        chartPreset: 'radar',
        position: { x: leftX, y: chartTopY, w: leftW, h: chartH },
        categories: ['Supplier Diversity', 'Inventory Buffers', 'Logistics Flexibility', 'Demand Sensing', 'Digital Visibility', 'Workforce Agility'],
        series: [
          { name: 'FY24', labels: ['Supplier Diversity', 'Inventory Buffers', 'Logistics Flexibility', 'Demand Sensing', 'Digital Visibility', 'Workforce Agility'], values: [2.1, 3.2, 2.5, 2.8, 3.0, 3.5] },
          { name: 'FY25', labels: ['Supplier Diversity', 'Inventory Buffers', 'Logistics Flexibility', 'Demand Sensing', 'Digital Visibility', 'Workforce Agility'], values: [3.8, 3.6, 3.1, 3.9, 4.2, 3.5] },
        ],
        legendPosition: 'bottom',
      },

      // ── 右图框 ──
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: rightX - 0.06, y: 0.88, w: rightW + 0.12, h: chartH + 0.42 },
        style: { fill: '#FDFAF7', border: { color: '#E8DDD4', width: 0.5, dash: 'solid' } },
      },

      // ── 右图标题 ──
      {
        type: 'text',
        content: 'Supply Disruption Cost by Category ($M)',
        position: { x: rightX + 0.08, y: 0.92, w: rightW - 0.16, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#333333', fontFamily: 'Arial' },
      },

      // ── 右图：成本分解堆叠柱状图 ──
      {
        type: 'chart',
        chartPreset: 'stacked-column',
        position: { x: rightX, y: chartTopY, w: rightW, h: chartH },
        categories: ['FY22', 'FY23', 'FY24', 'FY25'],
        series: [
          { name: 'Raw Materials', labels: ['FY22', 'FY23', 'FY24', 'FY25'], values: [12.4, 18.6, 14.2, 8.1] },
          { name: 'Logistics', labels: ['FY22', 'FY23', 'FY24', 'FY25'], values: [8.2, 14.1, 11.3, 9.8] },
          { name: 'Production Delays', labels: ['FY22', 'FY23', 'FY24', 'FY25'], values: [5.6, 9.2, 6.8, 3.2] },
          { name: 'Quality Issues', labels: ['FY22', 'FY23', 'FY24', 'FY25'], values: [3.1, 4.5, 3.9, 2.4] },
        ],
        showDataLabels: true,
        dataLabelFormat: '$#,##0.0',
        legendPosition: 'bottom',
      },

      // ── 总成本标注 ──
      {
        type: 'text',
        content: 'Total: $23.5M\n(–49% vs FY23)',
        position: { x: rightX + rightW - 1.5, y: 0.92, w: 1.3, h: 0.2 },
        style: { fontSize: 6.5, bold: true, color: '#1B6B3A', fontFamily: 'Arial', align: 'right' },
      },

      // ── 风险矩阵标题 ──
      {
        type: 'text',
        content: 'Top-5 Residual Risks & Mitigation Status',
        position: { x: MX, y: 3.44, w: INNER_W, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#3A2518', fontFamily: 'Arial' },
      },

      // ── 风险矩阵表格 ──
      {
        type: 'table',
        position: { x: MX, y: 3.64, w: INNER_W, h: 1.3 },
        headers: ['Risk', 'Impact', 'Probability', 'Mitigation', 'Status'],
        rows: [
          [
            { text: 'Rare earth single-source (China)' },
            { text: 'Critical' },
            { text: 'High' },
            { text: 'Dual-source qualification (Australia, Canada)' },
            { text: 'In Progress', style: { color: '#C45B28', bold: true } },
          ],
          [
            { text: 'Suez/Panama canal disruption' },
            { text: 'High' },
            { text: 'Medium' },
            { text: 'Air-freight contingency + 6-week safety stock' },
            { text: 'Completed', style: { color: '#1B6B3A', bold: true } },
          ],
          [
            { text: 'Semiconductor lead-time volatility' },
            { text: 'High' },
            { text: 'Medium' },
            { text: 'LTA with 2 fabs; strategic inventory reserve' },
            { text: 'Completed', style: { color: '#1B6B3A', bold: true } },
          ],
          [
            { text: 'Tier-2 supplier financial distress' },
            { text: 'Medium' },
            { text: 'Medium' },
            { text: 'Quarterly financial health monitoring program' },
            { text: 'In Progress', style: { color: '#C45B28', bold: true } },
          ],
          [
            { text: 'Cyber attack on logistics systems' },
            { text: 'Critical' },
            { text: 'Low' },
            { text: 'SOC monitoring + manual fallback procedures' },
            { text: 'Planned', style: { color: '#888888', bold: true } },
          ],
        ],
      },

      // ── 来源 ──
      {
        type: 'text',
        content: 'Source: Supply Chain Risk Management Office, ERP disruption tracking, Resilience audit FY25 Q4',
        position: { x: MX, y: 5.12, w: 7, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: 'Arial', italic: true },
      },

      // ── 品牌 ──
      {
        type: 'text',
        content: 'Operations Review — Q4 FY2025',
        position: { x: 7.5, y: 5.12, w: 2.3, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: 'Arial', italic: true, align: 'right' },
      },

      // ── 底部橙色强调线 ──
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: H - 0.03, w: W, h: 0.03 }, style: { fill: '#C45B28' } },
    ],
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const bootstrapDb = new DatabaseService();
  bootstrapDb.initialize();
  const project = resolveProject(bootstrapDb.getDb(), options.projectId);
  bootstrapDb.close();

  const { databaseService, workspaceService, context } = buildToolContext(project.id);

  try {
    const coordinator = createPptCoordinator(databaseService.getDb(), {
      buildExecution: createInProcessPresentationBuildExecution(),
    });
    const inspectTool = new PptInspectTool();

    console.log(`[showcase-en] project: ${project.name} (${project.id})`);
    console.log('[showcase-en] 开始直接建稿（3 页高密度咨询风格）…');

    const rawArgs = {
      title: 'High-Density Consulting Deck — Compose Test (3 slides)',
      layout: '16x9',
      theme: {
        colors: {
          dk1: '#1A1A1A',
          lt1: '#FFFFFF',
          accent1: '#0B2545',
          accent2: '#1A6B4A',
          accent3: '#C45B28',
          accent4: '#8EA0B8',
          accent5: '#D7A35A',
          accent6: '#7A828A',
        },
        fonts: {
          major: 'Georgia',
          minor: 'Arial',
        },
        chart: {
          palette: ['#0B2545', '#1A6B4A', '#C45B28', '#8EA0B8', '#D7A35A', '#7A828A'],
        },
      },
      slides: [
        buildSaasSlide(),
        buildHealthcareSlide(),
        buildSupplyChainSlide(),
      ],
    };

    const parsed = readDirectComposeInput(rawArgs);
    if (parsed.error || !parsed.input) throw new Error(parsed.error ?? '解析失败');
    const deckSpec = buildDeckSpecFromDirectInput(parsed.input);
    const genResult = await coordinator.directCompose(deckSpec, { projectId: project.id });

    const pid = genResult.nodeId;
    console.log(`[showcase-en] 建稿完成: ${pid} (${deckSpec.slides.length} slides)`);

    if (options.parentId?.trim()) {
      workspaceService.moveNode(pid, options.parentId.trim());
    }
    workspaceService.notifyDocumentOpened(pid);

    // 检查
    const inspectResult = parse<Record<string, unknown>>(await inspectTool.run({
      presentation_id: pid,
    }, context));
    console.log(`[showcase-en] inspect observation:\n${inspectResult.observation}`);

    console.log(JSON.stringify({
      presentationId: pid,
      versionId: genResult.versionId,
      title: deckSpec.title,
      slideCount: deckSpec.slides.length,
    }, null, 2));
  } finally {
    databaseService.close();
  }
}

void main().catch((err: unknown) => {
  console.error(`[showcase-en] ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exitCode = 1;
});
