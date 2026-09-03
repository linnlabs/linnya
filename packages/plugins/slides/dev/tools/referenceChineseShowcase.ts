/**
 * referenceChineseShowcase — 中文咨询风格范例样本
 *
 * 三页高密度咨询风格 PPT 参考实现（通过底层 directCompose API 构建）。
 * 用途：作为 AI-PPT 工具集的视觉基准——此脚本展示了"理想输出"的上限。
 *
 * - Slide 1: 新能源汽车产业仪表盘（深蓝科技风，KPI + 折线柱图 + 圆环图）
 * - Slide 2: 消费零售数字化转型（翡翠绿风格，横向柱状图 + 堆叠柱状图 + 战略卡片）
 * - Slide 3: ESG 可持续发展评估（琥珀橙风格，雷达图 + 堆叠柱状图 + 风险表格）
 *
 * 运行方式：
 *   LINNYA_DEV_MODE=true node scripts/test-runner/run-test-with-electron.cjs \
 *     packages/plugins/slides/dev/tools/referenceChineseShowcase.ts \
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

// 中文字体：标题用思源宋体 fallback 到系统宋体，正文用苹方/微软雅黑
const TITLE_FONT = 'PingFang SC';
const BODY_FONT = 'PingFang SC';

// ─── KPI 卡片构建器 ──────────────────────────────────────────────────────────

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
      position: { x: x + 0.12, y: y + 0.08, w: w - 0.24, h: 0.28 },
      style: { fontSize: 18, bold: true, color: accentColor, fontFamily: TITLE_FONT },
    },
    {
      type: 'text',
      content: label,
      position: { x: x + 0.12, y: y + 0.35, w: w - 0.24, h: 0.14 },
      style: { fontSize: 7, color: '#666666', fontFamily: BODY_FONT },
    },
    {
      type: 'text',
      content: delta,
      position: { x: x + 0.12, y: y + 0.5, w: w - 0.24, h: 0.14 },
      style: { fontSize: 7, bold: true, color: '#1B6B3A', fontFamily: BODY_FONT },
    },
  ];
}

// ─── 战略卡片构建器 ──────────────────────────────────────────────────────────

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
      style: { fontSize: 7.5, bold: true, color: accentColor, fontFamily: BODY_FONT },
    },
    {
      type: 'text',
      content: description,
      position: { x: x + 0.12, y: y + 0.22, w: w - 0.2, h: h - 0.28 },
      style: { fontSize: 6.5, color: '#444444', fontFamily: BODY_FONT, lineSpacing: 1.15 },
    },
  ];
}

// ─── Slide 1: 新能源汽车产业仪表盘 ──────────────────────────────────────────

function buildEvSlide() {
  const kpiY = 0.92;
  const kpiH = 0.7;
  const kpiW = 2.15;
  const kpiGap = 0.1;

  const chartY = 1.78;
  const chartH = 2.1;
  const leftChartW = 5.4;
  const rightChartW = 3.4;
  const chartGap = 0.2;
  const leftX = MX;
  const rightX = leftX + leftChartW + chartGap;

  const insightY = 4.08;
  const insightH = 1.1;

  return {
    background: { color: '#FFFFFF' },
    elements: [
      // 顶部深蓝强调线
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: 0, w: W, h: 0.03 }, style: { fill: '#0B2545' } },

      // Eyebrow
      {
        type: 'text',
        content: '新能源汽车 | 2025年度产业报告 | 中国市场',
        position: { x: MX, y: MY, w: INNER_W, h: 0.2 },
        style: { fontSize: 7, color: '#888888', fontFamily: BODY_FONT },
      },

      // 主标题
      {
        type: 'text',
        content: '2025年中国新能源汽车渗透率突破52%，全年销量达1,480万辆（同比+31%），智能驾驶与固态电池成为新增长极',
        position: { x: MX, y: 0.3, w: INNER_W, h: 0.46 },
        style: { fontSize: 13, bold: true, color: '#0B2545', fontFamily: TITLE_FONT, lineSpacing: 1.15 },
      },

      // 左侧竖条装饰
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0.14, y: 0.33, w: 0.055, h: 0.38 }, style: { fill: '#0B2545' } },

      // 灰色分隔线
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: MX, y: 0.82, w: INNER_W, h: 0.005 }, style: { fill: '#D0D0D0' } },

      // KPI 行
      ...buildKpiCard(MX, kpiY, kpiW, kpiH, '1,480万', '全年销量（辆）', '同比+31%', '#0B2545'),
      ...buildKpiCard(MX + kpiW + kpiGap, kpiY, kpiW, kpiH, '52.3%', '新能源渗透率', '+8.7pp vs 去年', '#1B6B3A'),
      ...buildKpiCard(MX + 2 * (kpiW + kpiGap), kpiY, kpiW, kpiH, '¥15.8万', '平均成交价', '-6.2% vs 去年', '#C45B28'),
      ...buildKpiCard(MX + 3 * (kpiW + kpiGap), kpiY, kpiW, kpiH, '312万', '出口量', '+48% YoY', '#0B2545'),

      // 左图标题
      {
        type: 'text',
        content: '季度销量走势与渗透率变化',
        position: { x: leftX, y: chartY - 0.2, w: leftChartW, h: 0.18 },
        style: { fontSize: 7.5, bold: true, color: '#333333', fontFamily: BODY_FONT },
      },

      // 左图：季度销量堆叠柱状图
      {
        type: 'chart',
        chartPreset: 'stacked-column',
        position: { x: leftX, y: chartY, w: leftChartW, h: chartH },
        categories: ['Q1\'24', 'Q2\'24', 'Q3\'24', 'Q4\'24', 'Q1\'25', 'Q2\'25', 'Q3\'25', 'Q4\'25'],
        series: [
          { name: '纯电（万辆）', labels: ['Q1\'24', 'Q2\'24', 'Q3\'24', 'Q4\'24', 'Q1\'25', 'Q2\'25', 'Q3\'25', 'Q4\'25'], values: [142, 168, 195, 230, 188, 225, 260, 310] },
          { name: '插混（万辆）', labels: ['Q1\'24', 'Q2\'24', 'Q3\'24', 'Q4\'24', 'Q1\'25', 'Q2\'25', 'Q3\'25', 'Q4\'25'], values: [58, 72, 85, 110, 82, 105, 125, 155] },
          { name: '增程（万辆）', labels: ['Q1\'24', 'Q2\'24', 'Q3\'24', 'Q4\'24', 'Q1\'25', 'Q2\'25', 'Q3\'25', 'Q4\'25'], values: [18, 22, 28, 35, 25, 32, 40, 52] },
        ],
        legendPosition: 'bottom',
      },

      // 右图标题
      {
        type: 'text',
        content: '市场份额分布（2025全年）',
        position: { x: rightX, y: chartY - 0.2, w: rightChartW, h: 0.18 },
        style: { fontSize: 7.5, bold: true, color: '#333333', fontFamily: BODY_FONT },
      },

      // 右图：品牌份额圆环图
      {
        type: 'chart',
        chartPreset: 'doughnut',
        position: { x: rightX, y: chartY, w: rightChartW, h: chartH },
        categories: ['比亚迪', '特斯拉', '吉利', '长安', '理想', '其他'],
        series: [
          { name: '市场份额', labels: ['比亚迪', '特斯拉', '吉利', '长安', '理想', '其他'], values: [33.2, 8.5, 7.8, 6.4, 5.1, 39.0] },
        ],
        showDataLabels: true,
        dataLabelFormat: '#,##0.0"%"',
        legendPosition: 'bottom',
      },

      // 洞察区背景
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: MX - 0.05, y: insightY - 0.06, w: INNER_W + 0.1, h: insightH + 0.08 },
        style: { fill: '#F4F6F9', border: { color: '#E0E4EA', width: 0.5, dash: 'solid' } },
      },

      // 洞察列 1
      {
        type: 'text',
        content: '• 比亚迪以33.2%市占率稳居第一，年销量突破490万辆，海外市场贡献12%\n\n• 15-20万元价位段竞争最激烈，该区间新车型发布数量同比增长67%',
        position: { x: MX + 0.08, y: insightY, w: 2.95, h: insightH },
        style: { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineSpacing: 1.2 },
      },

      // 洞察列 2
      {
        type: 'text',
        content: '• 固态电池量产进度超预期，宁德时代凝聚态电池能量密度达500Wh/kg\n\n• L2+智能驾驶装配率达68%，城市NOA功能覆盖城市超200个',
        position: { x: MX + 3.15, y: insightY, w: 2.95, h: insightH },
        style: { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineSpacing: 1.2 },
      },

      // 洞察列 3
      {
        type: 'text',
        content: '• 充电基础设施总量突破420万台，高速公路覆盖率达95%\n\n• 预计2026年新能源渗透率将突破60%，纯电与插混比例趋于均衡',
        position: { x: MX + 6.22, y: insightY, w: 2.95, h: insightH },
        style: { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineSpacing: 1.2 },
      },

      // 来源
      {
        type: 'text',
        content: '数据来源：中国汽车工业协会、乘联会、工信部公报、团队分析',
        position: { x: MX, y: 5.26, w: 6, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: BODY_FONT, italic: true },
      },

      // 品牌标识
      {
        type: 'text',
        content: '机密 — 仅供内部董事会使用',
        position: { x: 7, y: 5.26, w: 2.8, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: BODY_FONT, italic: true, align: 'right' },
      },

      // 底部强调线
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: H - 0.03, w: W, h: 0.03 }, style: { fill: '#0B2545' } },
    ],
  };
}

// ─── Slide 2: 消费零售数字化转型 ────────────────────────────────────────────

function buildRetailSlide() {
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
      // 顶部翡翠绿强调线
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: 0, w: W, h: 0.025 }, style: { fill: '#1A6B4A' } },

      // Eyebrow
      {
        type: 'text',
        content: '数字化转型 | 消费零售行业 | 2025–2028战略规划',
        position: { x: MX, y: 0.06, w: INNER_W, h: 0.2 },
        style: { fontSize: 7.5, color: '#888888', fontFamily: BODY_FONT },
      },

      // 主标题
      {
        type: 'text',
        content: '全渠道数字化率从38%提升至72%，线上线下融合驱动客单价增长22%；私域用户突破8,000万，复购率同比提升15个百分点',
        position: { x: MX, y: 0.26, w: INNER_W, h: 0.52 },
        style: { fontSize: 13, bold: true, color: '#1A3A2A', fontFamily: TITLE_FONT, lineSpacing: 1.15 },
      },

      // 竖条装饰
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0.14, y: 0.28, w: 0.055, h: 0.42 }, style: { fill: '#1A6B4A' } },

      // 灰色分隔线
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: MX, y: 0.84, w: INNER_W, h: 0.005 }, style: { fill: '#D0D0D0' } },

      // 左图框
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: leftX - 0.06, y: 0.86, w: leftW + 0.12, h: chartH + 0.44 },
        style: { fill: '#FAFBFC', border: { color: '#E0E7DF', width: 0.5, dash: 'solid' } },
      },

      // 左图标题
      {
        type: 'text',
        content: '各渠道GMV占比变化（亿元）',
        position: { x: leftX + 0.08, y: 0.9, w: leftW - 0.16, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#333333', fontFamily: BODY_FONT },
      },

      // 左图：渠道GMV横向柱状图
      {
        type: 'chart',
        chartPreset: 'horizontal-bar',
        position: { x: leftX, y: chartTopY, w: leftW, h: chartH },
        categories: ['直营门店', '电商旗舰店', '小程序商城', '直播电商', '社区团购', '经销商'],
        series: [
          { name: '2023年', labels: ['直营门店', '电商旗舰店', '小程序商城', '直播电商', '社区团购', '经销商'], values: [186, 142, 58, 35, 22, 95] },
          { name: '2025年', labels: ['直营门店', '电商旗舰店', '小程序商城', '直播电商', '社区团购', '经销商'], values: [210, 228, 145, 118, 68, 82] },
        ],
        showDataLabels: true,
        legendPosition: 'bottom',
      },

      // 右图框
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: rightX - 0.06, y: 0.86, w: rightW + 0.12, h: chartH + 0.44 },
        style: { fill: '#FAFBFC', border: { color: '#E0E7DF', width: 0.5, dash: 'solid' } },
      },

      // 右图标题
      {
        type: 'text',
        content: '数字化投入与回报（亿元）',
        position: { x: rightX + 0.08, y: 0.9, w: rightW - 0.16, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#333333', fontFamily: BODY_FONT },
      },

      // 右图：投入回报堆叠柱状图
      {
        type: 'chart',
        chartPreset: 'stacked-column',
        position: { x: rightX, y: chartTopY, w: rightW, h: chartH },
        categories: ['2022', '2023', '2024', '2025'],
        series: [
          { name: 'IT基础设施', labels: ['2022', '2023', '2024', '2025'], values: [3.2, 4.8, 6.5, 8.2] },
          { name: '数据中台', labels: ['2022', '2023', '2024', '2025'], values: [1.5, 2.8, 4.2, 5.6] },
          { name: 'AI应用', labels: ['2022', '2023', '2024', '2025'], values: [0.8, 1.5, 3.8, 7.2] },
          { name: '私域运营', labels: ['2022', '2023', '2024', '2025'], values: [0.5, 1.2, 2.5, 4.8] },
        ],
        showDataLabels: true,
        legendPosition: 'bottom',
      },

      // ROI标注
      {
        type: 'text',
        content: 'ROI: 3.8x\n(+1.2x vs 2023)',
        position: { x: rightX + rightW - 1.4, y: 0.9, w: 1.2, h: 0.2 },
        style: { fontSize: 7, bold: true, color: '#1A6B4A', fontFamily: BODY_FONT, align: 'right' },
      },

      // 核心发现区背景
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: MX - 0.05, y: 3.48, w: INNER_W + 0.1, h: 0.48 },
        style: { fill: '#F4F8F5', border: { color: '#D4E2D9', width: 0.5, dash: 'solid' } },
      },

      // 核心发现左
      {
        type: 'text',
        content: '小程序商城GMV两年增长150%，成为增速最快渠道。直播电商贡献增量GMV达83亿，用户平均停留时长12分钟，转化率4.8%。',
        position: { x: MX + 0.08, y: 3.52, w: 4.4, h: 0.38 },
        style: { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineSpacing: 1.2 },
      },

      // 核心发现右
      {
        type: 'text',
        content: 'AI应用投入增长最快（+380% vs 2022），主要用于智能选品、个性化推荐和智能客服。预计2026年AI驱动的GMV占比将超过25%。',
        position: { x: MX + 4.7, y: 3.52, w: 4.4, h: 0.38 },
        style: { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineSpacing: 1.2 },
      },

      // 战略建议标题
      {
        type: 'text',
        content: '三阶段转型路线图',
        position: { x: MX, y: 4.06, w: INNER_W, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#1A3A2A', fontFamily: BODY_FONT },
      },

      // 战略阶段
      ...buildPhaseCard(MX, 4.28, 2.85, 0.65, '第一阶段 — 2025下半年', '完成全渠道中台建设，打通线上线下库存与会员体系，实现「一盘货」管理。目标：库存周转提升20%。', '#1A6B4A'),
      ...buildPhaseCard(MX + 3.05, 4.28, 2.85, 0.65, '第二阶段 — 2026年', '部署AI驱动的千人千面推荐系统，构建私域数据资产。目标：私域复购率提升至55%。', '#2D8B6A'),
      ...buildPhaseCard(MX + 6.1, 4.28, 2.85, 0.65, '第三阶段 — 2027–28年', '推进智慧门店改造（AR试穿、自助结算），实现线上线下体验无缝衔接。目标：坪效提升35%。', '#4AAA8A'),

      // 来源
      {
        type: 'text',
        content: '数据来源：公司内部BI系统、艾瑞咨询、贝恩消费者洞察2025、团队分析',
        position: { x: MX, y: 5.1, w: 7, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: BODY_FONT, italic: true },
      },

      // 品牌
      {
        type: 'text',
        content: '草案 — 仅供讨论',
        position: { x: 7.5, y: 5.1, w: 2.3, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: BODY_FONT, italic: true, align: 'right' },
      },

      // 底部翡翠绿强调线
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: H - 0.025, w: W, h: 0.025 }, style: { fill: '#1A6B4A' } },
    ],
  };
}

// ─── Slide 3: ESG 可持续发展评估 ────────────────────────────────────────────

function buildEsgSlide() {
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
      // 顶部琥珀橙强调线
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0, y: 0, w: W, h: 0.03 }, style: { fill: '#C45B28' } },

      // Eyebrow
      {
        type: 'text',
        content: 'ESG评估 | 可持续发展年度报告 | 2025财年',
        position: { x: MX, y: MY, w: INNER_W, h: 0.2 },
        style: { fontSize: 7.5, color: '#888888', fontFamily: BODY_FONT },
      },

      // 主标题
      {
        type: 'text',
        content: 'ESG综合评级由BBB提升至A级，碳排放强度同比下降18%；绿色供应链覆盖率达85%，但社会责任维度仍存在改善空间',
        position: { x: MX, y: 0.28, w: INNER_W, h: 0.52 },
        style: { fontSize: 13, bold: true, color: '#3A2518', fontFamily: TITLE_FONT, lineSpacing: 1.1 },
      },

      // 竖条装饰
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: 0.14, y: 0.3, w: 0.055, h: 0.42 }, style: { fill: '#C45B28' } },

      // 灰色分隔线
      { type: 'shape', geometry: { type: 'preset', name: 'rect' }, position: { x: MX, y: 0.86, w: INNER_W, h: 0.005 }, style: { fill: '#D0D0D0' } },

      // 左图框
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: leftX - 0.06, y: 0.88, w: leftW + 0.12, h: chartH + 0.42 },
        style: { fill: '#FDFAF7', border: { color: '#E8DDD4', width: 0.5, dash: 'solid' } },
      },

      // 左图标题
      {
        type: 'text',
        content: 'ESG各维度评分（满分5分）',
        position: { x: leftX + 0.08, y: 0.92, w: leftW - 0.16, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#333333', fontFamily: BODY_FONT },
      },

      // 左图：雷达图
      {
        type: 'chart',
        chartPreset: 'radar',
        position: { x: leftX, y: chartTopY, w: leftW, h: chartH },
        categories: ['碳排放管理', '能源效率', '水资源利用', '员工权益', '社区投入', '公司治理'],
        series: [
          { name: '2024年', labels: ['碳排放管理', '能源效率', '水资源利用', '员工权益', '社区投入', '公司治理'], values: [3.0, 3.5, 2.8, 2.5, 2.2, 3.8] },
          { name: '2025年', labels: ['碳排放管理', '能源效率', '水资源利用', '员工权益', '社区投入', '公司治理'], values: [4.2, 4.0, 3.5, 3.0, 2.8, 4.2] },
        ],
        legendPosition: 'bottom',
      },

      // 右图框
      {
        type: 'shape', geometry: { type: 'preset', name: 'rect' },
        position: { x: rightX - 0.06, y: 0.88, w: rightW + 0.12, h: chartH + 0.42 },
        style: { fill: '#FDFAF7', border: { color: '#E8DDD4', width: 0.5, dash: 'solid' } },
      },

      // 右图标题
      {
        type: 'text',
        content: '碳排放与减排投入趋势',
        position: { x: rightX + 0.08, y: 0.92, w: rightW - 0.16, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#333333', fontFamily: BODY_FONT },
      },

      // 右图：碳排放堆叠柱状图
      {
        type: 'chart',
        chartPreset: 'stacked-column',
        position: { x: rightX, y: chartTopY, w: rightW, h: chartH },
        categories: ['2022', '2023', '2024', '2025'],
        series: [
          { name: '范围一排放（万吨）', labels: ['2022', '2023', '2024', '2025'], values: [28.5, 25.2, 21.8, 18.6] },
          { name: '范围二排放（万吨）', labels: ['2022', '2023', '2024', '2025'], values: [42.3, 38.6, 32.4, 26.8] },
          { name: '范围三排放（万吨）', labels: ['2022', '2023', '2024', '2025'], values: [85.2, 78.4, 72.1, 65.3] },
        ],
        showDataLabels: true,
        legendPosition: 'bottom',
      },

      // 减排标注
      {
        type: 'text',
        content: '总量: 110.7万吨\n(–29% vs 2022)',
        position: { x: rightX + rightW - 1.5, y: 0.92, w: 1.3, h: 0.2 },
        style: { fontSize: 6.5, bold: true, color: '#1B6B3A', fontFamily: BODY_FONT, align: 'right' },
      },

      // 风险矩阵标题
      {
        type: 'text',
        content: 'ESG关键改进事项与进度',
        position: { x: MX, y: 3.44, w: INNER_W, h: 0.18 },
        style: { fontSize: 8, bold: true, color: '#3A2518', fontFamily: BODY_FONT },
      },

      // 风险矩阵表格
      {
        type: 'table',
        position: { x: MX, y: 3.64, w: INNER_W, h: 1.3 },
        headers: ['改进事项', '所属维度', '优先级', '目标', '当前状态'],
        rows: [
          [
            { text: '建设屋顶光伏发电系统' },
            { text: '环境' },
            { text: '高' },
            { text: '年发电量2,000万度，减排1.2万吨' },
            { text: '施工中', style: { color: '#C45B28', bold: true } },
          ],
          [
            { text: '供应链碳足迹追溯平台' },
            { text: '环境' },
            { text: '高' },
            { text: '覆盖Tier-1供应商100%' },
            { text: '已完成', style: { color: '#1B6B3A', bold: true } },
          ],
          [
            { text: '员工心理健康支持计划' },
            { text: '社会' },
            { text: '中' },
            { text: '全员覆盖EAP服务' },
            { text: '已完成', style: { color: '#1B6B3A', bold: true } },
          ],
          [
            { text: '乡村教育公益项目' },
            { text: '社会' },
            { text: '中' },
            { text: '资助1,000名乡村教师培训' },
            { text: '进行中', style: { color: '#C45B28', bold: true } },
          ],
          [
            { text: '董事会ESG专委会设立' },
            { text: '治理' },
            { text: '高' },
            { text: '独立ESG委员会+季度审议机制' },
            { text: '规划中', style: { color: '#888888', bold: true } },
          ],
        ],
      },

      // 来源
      {
        type: 'text',
        content: '数据来源：集团ESG管理部、碳排放核算系统、MSCI ESG评级报告、团队分析',
        position: { x: MX, y: 5.12, w: 7, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: BODY_FONT, italic: true },
      },

      // 品牌
      {
        type: 'text',
        content: '内部文件 — 2025年度ESG报告',
        position: { x: 7.5, y: 5.12, w: 2.3, h: 0.16 },
        style: { fontSize: 5, color: '#AAAAAA', fontFamily: BODY_FONT, italic: true, align: 'right' },
      },

      // 底部琥珀橙强调线
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

    console.log(`[showcase-cn] 项目: ${project.name} (${project.id})`);
    console.log('[showcase-cn] 开始建稿（3页中文高密度咨询风格）…');

    const rawArgs = {
      title: '中文高密度咨询报告 — 建稿测试（3页）',
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
          major: TITLE_FONT,
          minor: BODY_FONT,
        },
        chart: {
          palette: ['#0B2545', '#1A6B4A', '#C45B28', '#8EA0B8', '#D7A35A', '#7A828A'],
        },
      },
      slides: [
        buildEvSlide(),
        buildRetailSlide(),
        buildEsgSlide(),
      ],
    };

    const parsed = readDirectComposeInput(rawArgs);
    if (parsed.error || !parsed.input) throw new Error(parsed.error ?? '解析失败');
    const deckSpec = buildDeckSpecFromDirectInput(parsed.input);
    const genResult = await coordinator.directCompose(deckSpec, { projectId: project.id });

    const pid = genResult.nodeId;
    console.log(`[showcase-cn] 建稿完成: ${pid} (${deckSpec.slides.length} 页)`);

    if (options.parentId?.trim()) {
      workspaceService.moveNode(pid, options.parentId.trim());
    }
    workspaceService.notifyDocumentOpened(pid);

    // 检查
    const inspectResult = parse<Record<string, unknown>>(await inspectTool.run({
      presentation_id: pid,
    }, context));
    console.log(`[showcase-cn] 检查结果:\n${inspectResult.observation}`);

    console.log(JSON.stringify({
      presentationId: pid,
      versionId: genResult.versionId,
      title: deckSpec.title,
      slideCount: deckSpec.slides.length,
    }, null, 2));

    console.log('\n[showcase-cn] 请在前端打开此PPT，手动导出PPTX进行对比。');
  } finally {
    databaseService.close();
  }
}

void main().catch((err: unknown) => {
  console.error(`[showcase-cn] ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exitCode = 1;
});
