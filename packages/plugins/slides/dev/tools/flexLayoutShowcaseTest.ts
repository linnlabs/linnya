/**
 * flexLayoutShowcaseTest — 用场景图 DSL 重写 referenceChineseShowcase
 *
 * 此脚本展示 AI 使用场景图 DSL（createSlide/createFrame/createText/add() 等）
 * 构建高密度咨询风格 PPT 的代码风格。与 referenceChineseShowcase 对标，
 * 验证布局编译器的表达力和正确性。
 *
 * 属性名采用 CSS 标准（fontWeight / lineHeight / textAlign），
 * 容器统一使用 View + flexDirection 替代旧版 VStack/HStack。
 *
 * 运行方式：
 *   LINNYA_DEV_MODE=true node scripts/test-runner/run-test-with-electron.cjs \
 *     packages/plugins/slides/dev/tools/flexLayoutShowcaseTest.ts \
 *     [--project-id <id>] [--parent-id <id>]
 */

import type { Database } from 'better-sqlite3';
import { DatabaseService } from 'src/electron-main/services/database.js';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace.js';
import { createPptCoordinator } from '@plugin/slides/backend-coordinator';
import { PptInspectTool } from '@plugin/slides/backend-tool-classes';
import type { StructuredToolResult, ToolContext } from 'src/tools/types.js';
import { attachPresentationCoordinatorToToolContext } from '@plugin/slides/backend-tools';
import { buildDeckSpecFromDirectInput } from '@plugin/slides/backend-codegen';
import { compileFlexInput, initYoga } from '@plugin/slides/backend-codegen';
import type {
  LayoutSlideNode,
  LayoutViewNode,
  LayoutTextNode,
  LayoutShapeNode,
  LayoutChartNode,
  LayoutTableNode,
  LayoutSpacerNode,
  LayoutNode,
  FlexComposeInput,
} from '@plugin/slides/backend-codegen';
import { createInProcessPresentationBuildExecution } from '../../src/backend/features/presentationBuildExecution';

// ─── CLI （复用 referenceChineseShowcase 的逻辑） ────────────────────────────

interface CliOptions { projectId?: string; parentId?: string }
interface ProjectRow { id: string; name: string }

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]; const next = argv[i + 1];
    if (arg === '--project-id') { options.projectId = next; i += 1; }
    else if (arg === '--parent-id') { options.parentId = next; i += 1; }
    else if (arg === '--help') { console.log('Usage: ... [--project-id <id>] [--parent-id <id>]'); process.exit(0); }
  }
  return options;
}

function resolveProject(db: Database, requestedId?: string): ProjectRow {
  if (requestedId?.trim()) {
    const row = db.prepare<[string], ProjectRow>(`SELECT id, name FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1`).get(requestedId.trim());
    if (!row) throw new Error(`Project not found: ${requestedId}`);
    return row;
  }
  const row = db.prepare<[], ProjectRow>(`SELECT id, name FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`).get();
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

// ─── 字体常量 ────────────────────────────────────────────────────────────────

const TITLE_FONT = 'PingFang SC';
const BODY_FONT = 'PingFang SC';

// ─── 场景图 DSL 构造辅助（模拟沙箱的 createSlide/createFrame/createText） ───

/** Slide 根容器 */
function slide(props: Partial<Omit<LayoutSlideNode, '_type' | 'children'>>, ...children: LayoutNode[]): LayoutSlideNode {
  return { _type: 'Slide', ...props, children: children.flat().filter(Boolean) } as LayoutSlideNode;
}

/** 竖向容器（flexDirection 默认 column，等效旧 VStack） */
function col(props: Partial<Omit<LayoutViewNode, '_type' | 'children'>>, ...children: LayoutNode[]): LayoutViewNode {
  return { _type: 'View', ...props, children: children.flat().filter(Boolean) } as LayoutViewNode;
}

/** 横向容器（flexDirection: row，等效旧 HStack） */
function row(props: Partial<Omit<LayoutViewNode, '_type' | 'children' | 'flexDirection'>>, ...children: LayoutNode[]): LayoutViewNode {
  return { _type: 'View', flexDirection: 'row', ...props, children: children.flat().filter(Boolean) } as LayoutViewNode;
}

/** 文本节点（content 提取为首参，与沙箱 createText(content) 一致） */
function text(content: string, props?: Partial<Omit<LayoutTextNode, '_type' | 'content'>>): LayoutTextNode {
  return { _type: 'Text', content, ...props } as LayoutTextNode;
}

/** 形状节点 */
function shape(props?: Partial<Omit<LayoutShapeNode, '_type'>>): LayoutShapeNode {
  return { _type: 'Shape', ...props } as LayoutShapeNode;
}

/** 图表节点 */
function chart(props?: Partial<Omit<LayoutChartNode, '_type'>>): LayoutChartNode {
  return { _type: 'Chart', ...props } as LayoutChartNode;
}

/** 表格节点 */
function table(props?: Partial<Omit<LayoutTableNode, '_type'>>): LayoutTableNode {
  return { _type: 'Table', ...props } as LayoutTableNode;
}

/** 弹簧占位 */
function spacer(props?: Partial<Omit<LayoutSpacerNode, '_type'>>): LayoutSpacerNode {
  return { _type: 'Spacer', ...props } as LayoutSpacerNode;
}

// ─── 复用组件：KPI 卡片 ────────────────────────────────────────────────────

function kpiCard(value: string, label: string, delta: string, accent: string) {
  return col({ flex: 1, backgroundColor: '#F8F9FB', border: { color: '#E4E7EC', width: 0.5, dash: 'solid' }, padding: { top: 0.06, left: 0.12, right: 0.12, bottom: 0.06 } },
    shape({ position: 'absolute', top: 0, left: 0, width: '100%', height: 0.03, fill: accent }),
    spacer({ height: 0.04 }),
    text(value, { fontSize: 18, fontWeight: 'bold', color: accent, fontFamily: TITLE_FONT, height: 0.28 }),
    text(label, { fontSize: 7, color: '#666666', fontFamily: BODY_FONT, height: 0.14 }),
    text(delta, { fontSize: 7, fontWeight: 'bold', color: '#1B6B3A', fontFamily: BODY_FONT, height: 0.14 }),
  );
}

// ─── 复用组件：战略卡片 ────────────────────────────────────────────────────

function phaseCard(title: string, description: string, accent: string) {
  return col({ flex: 1, backgroundColor: '#FFFFFF', border: { color: '#D4E2D9', width: 0.5, dash: 'solid' }, padding: { top: 0.04, left: 0.12, right: 0.08, bottom: 0.04 } },
    shape({ position: 'absolute', top: 0, left: 0, width: 0.04, height: '100%', fill: accent }),
    text(title, { fontSize: 7.5, fontWeight: 'bold', color: accent, fontFamily: BODY_FONT, height: 0.16 }),
    spacer({ height: 0.02 }),
    text(description, { fontSize: 6.5, color: '#444444', fontFamily: BODY_FONT, lineHeight: 1.15, flex: 1 }),
  );
}

// ─── 公共布局：页面头部（Eyebrow + 主标题 + 装饰） ────────────────────────

function slideHeader(eyebrow: string, title: string, titleColor: string, accentColor: string) {
  return col({ padding: { left: 0.4, right: 0.4, top: 0.1 } },
    shape({ position: 'absolute', top: 0, left: 0, width: '100%', height: 0.03, fill: accentColor }),
    shape({ position: 'absolute', top: 0.23, left: 0.14, width: 0.055, height: 0.38, fill: accentColor }),
    text(eyebrow, { fontSize: 7, color: '#888888', fontFamily: BODY_FONT, height: 0.2 }),
    text(title, { fontSize: 13, fontWeight: 'bold', color: titleColor, fontFamily: TITLE_FONT, lineHeight: 1.15, height: 0.46 }),
    shape({ height: 0.02, fill: '#D0D0D0', marginTop: 0.06 }),
  );
}

// ─── 公共布局：页面页脚 ────────────────────────────────────────────────────

function slideFooter(source: string, brand: string, accentColor: string) {
  return col({},
    row({ height: 0.16 },
      text(source, { fontSize: 5, color: '#AAAAAA', fontFamily: BODY_FONT, fontStyle: 'italic', flex: 1 }),
      text(brand, { fontSize: 5, color: '#AAAAAA', fontFamily: BODY_FONT, fontStyle: 'italic', textAlign: 'right', flex: 1 }),
    ),
    shape({ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 0.03, fill: accentColor }),
  );
}

// ─── Slide 1: 新能源汽车产业仪表盘 ────────────────────────────────────────

function buildEvSlide() {
  return slide({ background: { color: '#FFFFFF' } },
    slideHeader(
      '新能源汽车 | 2025年度产业报告 | 中国市场',
      '2025年中国新能源汽车渗透率突破52%，全年销量达1,480万辆（同比+31%），智能驾驶与固态电池成为新增长极',
      '#0B2545', '#0B2545',
    ),

    // KPI 行
    row({ height: 0.7, gap: 0.1, padding: { left: 0.4, right: 0.4 }, marginTop: 0.02 },
      kpiCard('1,480万', '全年销量（辆）', '同比+31%', '#0B2545'),
      kpiCard('52.3%', '新能源渗透率', '+8.7pp vs 去年', '#1B6B3A'),
      kpiCard('¥15.8万', '平均成交价', '-6.2% vs 去年', '#C45B28'),
      kpiCard('312万', '出口量', '+48% YoY', '#0B2545'),
    ),

    // 图表区
    row({ flex: 1, gap: 0.2, padding: { left: 0.4, right: 0.4 }, marginTop: 0.1 },
      col({ flex: 6 },
        text('季度销量走势与渗透率变化', { fontSize: 7.5, fontWeight: 'bold', color: '#333333', fontFamily: BODY_FONT, height: 0.18 }),
        chart({
          flex: 1, preset: 'stacked-column',
          categories: ["Q1'24", "Q2'24", "Q3'24", "Q4'24", "Q1'25", "Q2'25", "Q3'25", "Q4'25"],
          series: [
            { name: '纯电（万辆）', labels: ["Q1'24", "Q2'24", "Q3'24", "Q4'24", "Q1'25", "Q2'25", "Q3'25", "Q4'25"], values: [142, 168, 195, 230, 188, 225, 260, 310] },
            { name: '插混（万辆）', labels: ["Q1'24", "Q2'24", "Q3'24", "Q4'24", "Q1'25", "Q2'25", "Q3'25", "Q4'25"], values: [58, 72, 85, 110, 82, 105, 125, 155] },
            { name: '增程（万辆）', labels: ["Q1'24", "Q2'24", "Q3'24", "Q4'24", "Q1'25", "Q2'25", "Q3'25", "Q4'25"], values: [18, 22, 28, 35, 25, 32, 40, 52] },
          ],
          legendPosition: 'bottom',
        }),
      ),
      col({ flex: 4 },
        text('市场份额分布（2025全年）', { fontSize: 7.5, fontWeight: 'bold', color: '#333333', fontFamily: BODY_FONT, height: 0.18 }),
        chart({
          flex: 1, preset: 'doughnut',
          categories: ['比亚迪', '特斯拉', '吉利', '长安', '理想', '其他'],
          series: [{ name: '市场份额', labels: ['比亚迪', '特斯拉', '吉利', '长安', '理想', '其他'], values: [33.2, 8.5, 7.8, 6.4, 5.1, 39.0] }],
          showDataLabels: true, dataLabelFormat: '#,##0.0"%"', legendPosition: 'bottom',
        }),
      ),
    ),

    // 洞察区
    row({ height: 1.1, gap: 0.12, padding: { left: 0.4, right: 0.4 }, backgroundColor: '#F4F6F9', border: { color: '#E0E4EA', width: 0.5, dash: 'solid' } },
      text('• 比亚迪以33.2%市占率稳居第一，年销量突破490万辆，海外市场贡献12%\n\n• 15-20万元价位段竞争最激烈，该区间新车型发布数量同比增长67%',
        { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineHeight: 1.2, flex: 1 }),
      text('• 固态电池量产进度超预期，宁德时代凝聚态电池能量密度达500Wh/kg\n\n• L2+智能驾驶装配率达68%，城市NOA功能覆盖城市超200个',
        { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineHeight: 1.2, flex: 1 }),
      text('• 充电基础设施总量突破420万台，高速公路覆盖率达95%\n\n• 预计2026年新能源渗透率将突破60%，纯电与插混比例趋于均衡',
        { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineHeight: 1.2, flex: 1 }),
    ),

    slideFooter('数据来源：中国汽车工业协会、乘联会、工信部公报、团队分析', '机密 — 仅供内部董事会使用', '#0B2545'),
  );
}

// ─── Slide 2: 消费零售数字化转型 ──────────────────────────────────────────

function buildRetailSlide() {
  return slide({ background: { color: '#FFFFFF' } },
    slideHeader(
      '数字化转型 | 消费零售行业 | 2025–2028战略规划',
      '全渠道数字化率从38%提升至72%，线上线下融合驱动客单价增长22%；私域用户突破8,000万，复购率同比提升15个百分点',
      '#1A3A2A', '#1A6B4A',
    ),

    // 图表区
    row({ flex: 1, gap: 0.2, padding: { left: 0.4, right: 0.4 }, marginTop: 0.02 },
      col({ flex: 5, backgroundColor: '#FAFBFC', border: { color: '#E0E7DF', width: 0.5, dash: 'solid' }, padding: 0.08 },
        text('各渠道GMV占比变化（亿元）', { fontSize: 8, fontWeight: 'bold', color: '#333333', fontFamily: BODY_FONT, height: 0.18 }),
        chart({
          flex: 1, preset: 'horizontal-bar',
          categories: ['直营门店', '电商旗舰店', '小程序商城', '直播电商', '社区团购', '经销商'],
          series: [
            { name: '2023年', labels: ['直营门店', '电商旗舰店', '小程序商城', '直播电商', '社区团购', '经销商'], values: [186, 142, 58, 35, 22, 95] },
            { name: '2025年', labels: ['直营门店', '电商旗舰店', '小程序商城', '直播电商', '社区团购', '经销商'], values: [210, 228, 145, 118, 68, 82] },
          ],
          showDataLabels: true, legendPosition: 'bottom',
        }),
      ),
      col({ flex: 5, backgroundColor: '#FAFBFC', border: { color: '#E0E7DF', width: 0.5, dash: 'solid' }, padding: 0.08 },
        row({},
          text('数字化投入与回报（亿元）', { fontSize: 8, fontWeight: 'bold', color: '#333333', fontFamily: BODY_FONT, flex: 1, height: 0.18 }),
          text('ROI: 3.8x (+1.2x vs 2023)', { fontSize: 7, fontWeight: 'bold', color: '#1A6B4A', fontFamily: BODY_FONT, textAlign: 'right', width: 2, height: 0.18 }),
        ),
        chart({
          flex: 1, preset: 'stacked-column',
          categories: ['2022', '2023', '2024', '2025'],
          series: [
            { name: 'IT基础设施', labels: ['2022', '2023', '2024', '2025'], values: [3.2, 4.8, 6.5, 8.2] },
            { name: '数据中台', labels: ['2022', '2023', '2024', '2025'], values: [1.5, 2.8, 4.2, 5.6] },
            { name: 'AI应用', labels: ['2022', '2023', '2024', '2025'], values: [0.8, 1.5, 3.8, 7.2] },
            { name: '私域运营', labels: ['2022', '2023', '2024', '2025'], values: [0.5, 1.2, 2.5, 4.8] },
          ],
          showDataLabels: true, legendPosition: 'bottom',
        }),
      ),
    ),

    // 核心发现区
    row({ height: 0.48, padding: { left: 0.4, right: 0.4 }, gap: 0.3, backgroundColor: '#F4F8F5', border: { color: '#D4E2D9', width: 0.5, dash: 'solid' } },
      text('小程序商城GMV两年增长150%，成为增速最快渠道。直播电商贡献增量GMV达83亿，用户平均停留时长12分钟，转化率4.8%。',
        { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineHeight: 1.2, flex: 1 }),
      text('AI应用投入增长最快（+380% vs 2022），主要用于智能选品、个性化推荐和智能客服。预计2026年AI驱动的GMV占比将超过25%。',
        { fontSize: 7, color: '#333333', fontFamily: BODY_FONT, lineHeight: 1.2, flex: 1 }),
    ),

    // 战略路线图
    col({ padding: { left: 0.4, right: 0.4 }, marginTop: 0.06 },
      text('三阶段转型路线图', { fontSize: 8, fontWeight: 'bold', color: '#1A3A2A', fontFamily: BODY_FONT, height: 0.18 }),
      row({ height: 0.65, gap: 0.1, marginTop: 0.04 },
        phaseCard('第一阶段 — 2025下半年', '完成全渠道中台建设，打通线上线下库存与会员体系，实现「一盘货」管理。目标：库存周转提升20%。', '#1A6B4A'),
        phaseCard('第二阶段 — 2026年', '部署AI驱动的千人千面推荐系统，构建私域数据资产。目标：私域复购率提升至55%。', '#2D8B6A'),
        phaseCard('第三阶段 — 2027–28年', '推进智慧门店改造（AR试穿、自助结算），实现线上线下体验无缝衔接。目标：坪效提升35%。', '#4AAA8A'),
      ),
    ),

    slideFooter('数据来源：公司内部BI系统、艾瑞咨询、贝恩消费者洞察2025、团队分析', '草案 — 仅供讨论', '#1A6B4A'),
  );
}

// ─── Slide 3: ESG 可持续发展评估 ──────────────────────────────────────────

function buildEsgSlide() {
  return slide({ background: { color: '#FFFFFF' } },
    slideHeader(
      'ESG评估 | 可持续发展年度报告 | 2025财年',
      'ESG综合评级由BBB提升至A级，碳排放强度同比下降18%；绿色供应链覆盖率达85%，但社会责任维度仍存在改善空间',
      '#3A2518', '#C45B28',
    ),

    // 图表区
    row({ flex: 1, gap: 0.2, padding: { left: 0.4, right: 0.4 }, marginTop: 0.02 },
      col({ flex: 5, backgroundColor: '#FDFAF7', border: { color: '#E8DDD4', width: 0.5, dash: 'solid' }, padding: 0.08 },
        text('ESG各维度评分（满分5分）', { fontSize: 8, fontWeight: 'bold', color: '#333333', fontFamily: BODY_FONT, height: 0.18 }),
        chart({
          flex: 1, preset: 'radar',
          categories: ['碳排放管理', '能源效率', '水资源利用', '员工权益', '社区投入', '公司治理'],
          series: [
            { name: '2024年', labels: ['碳排放管理', '能源效率', '水资源利用', '员工权益', '社区投入', '公司治理'], values: [3.0, 3.5, 2.8, 2.5, 2.2, 3.8] },
            { name: '2025年', labels: ['碳排放管理', '能源效率', '水资源利用', '员工权益', '社区投入', '公司治理'], values: [4.2, 4.0, 3.5, 3.0, 2.8, 4.2] },
          ],
          legendPosition: 'bottom',
        }),
      ),
      col({ flex: 5, backgroundColor: '#FDFAF7', border: { color: '#E8DDD4', width: 0.5, dash: 'solid' }, padding: 0.08 },
        row({},
          text('碳排放与减排投入趋势', { fontSize: 8, fontWeight: 'bold', color: '#333333', fontFamily: BODY_FONT, flex: 1, height: 0.18 }),
          text('总量: 110.7万吨 (–29% vs 2022)', { fontSize: 6.5, fontWeight: 'bold', color: '#1B6B3A', fontFamily: BODY_FONT, textAlign: 'right', width: 2.5, height: 0.18 }),
        ),
        chart({
          flex: 1, preset: 'stacked-column',
          categories: ['2022', '2023', '2024', '2025'],
          series: [
            { name: '范围一排放（万吨）', labels: ['2022', '2023', '2024', '2025'], values: [28.5, 25.2, 21.8, 18.6] },
            { name: '范围二排放（万吨）', labels: ['2022', '2023', '2024', '2025'], values: [42.3, 38.6, 32.4, 26.8] },
            { name: '范围三排放（万吨）', labels: ['2022', '2023', '2024', '2025'], values: [85.2, 78.4, 72.1, 65.3] },
          ],
          showDataLabels: true, legendPosition: 'bottom',
        }),
      ),
    ),

    // 改进事项标题 + 表格
    col({ padding: { left: 0.4, right: 0.4 }, marginTop: 0.06 },
      text('ESG关键改进事项与进度', { fontSize: 8, fontWeight: 'bold', color: '#3A2518', fontFamily: BODY_FONT, height: 0.18 }),
      table({
        marginTop: 0.04, height: 1.3,
        headers: ['改进事项', '所属维度', '优先级', '目标', '当前状态'],
        rows: [
          [{ text: '建设屋顶光伏发电系统' }, { text: '环境' }, { text: '高' }, { text: '年发电量2,000万度，减排1.2万吨' }, { text: '施工中', style: { color: '#C45B28', bold: true } }],
          [{ text: '供应链碳足迹追溯平台' }, { text: '环境' }, { text: '高' }, { text: '覆盖Tier-1供应商100%' }, { text: '已完成', style: { color: '#1B6B3A', bold: true } }],
          [{ text: '员工心理健康支持计划' }, { text: '社会' }, { text: '中' }, { text: '全员覆盖EAP服务' }, { text: '已完成', style: { color: '#1B6B3A', bold: true } }],
          [{ text: '乡村教育公益项目' }, { text: '社会' }, { text: '中' }, { text: '资助1,000名乡村教师培训' }, { text: '进行中', style: { color: '#C45B28', bold: true } }],
          [{ text: '董事会ESG专委会设立' }, { text: '治理' }, { text: '高' }, { text: '独立ESG委员会+季度审议机制' }, { text: '规划中', style: { color: '#888888', bold: true } }],
        ],
      }),
    ),

    slideFooter('数据来源：集团ESG管理部、碳排放核算系统、MSCI ESG评级报告、团队分析', '内部文件 — 2025年度ESG报告', '#C45B28'),
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────

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

    console.log(`[flex-showcase] 项目: ${project.name} (${project.id})`);
    console.log('[flex-showcase] 开始建稿（3页中文高密度咨询风格 — 场景图 DSL 版）…');

    const flexInput: FlexComposeInput = {
      title: '中文高密度咨询报告 — 场景图 DSL 版（3页）',
      layout: '16x9',
      theme: {
        colors: {
          dk1: '#1A1A1A', lt1: '#FFFFFF',
          accent1: '#0B2545', accent2: '#1A6B4A', accent3: '#C45B28',
          accent4: '#8EA0B8', accent5: '#D7A35A', accent6: '#7A828A',
        },
        fonts: { major: TITLE_FONT, minor: BODY_FONT },
        chart: { palette: ['#0B2545', '#1A6B4A', '#C45B28', '#8EA0B8', '#D7A35A', '#7A828A'] },
      },
      slides: [buildEvSlide(), buildRetailSlide(), buildEsgSlide()],
    };

    await initYoga();
    const compiled = compileFlexInput(flexInput);
    if (compiled.error || !compiled.input) throw new Error(`编译失败: ${compiled.error}`);

    console.log(`[flex-showcase] 布局编译完成，共 ${compiled.input.slides.length} 页`);
    for (let i = 0; i < compiled.input.slides.length; i++) {
      console.log(`  Slide ${i + 1}: ${compiled.input.slides[i].elements.length} 个元素`);
    }

    const deckSpec = buildDeckSpecFromDirectInput(compiled.input);
    const genResult = await coordinator.directCompose(deckSpec, { projectId: project.id });

    const pid = genResult.nodeId;
    console.log(`[flex-showcase] 建稿完成: ${pid}`);

    if (options.parentId?.trim()) {
      workspaceService.moveNode(pid, options.parentId.trim());
    }
    workspaceService.notifyDocumentOpened(pid);

    const inspectResult = parse<Record<string, unknown>>(await inspectTool.run({ presentation_id: pid }, context));
    console.log(`[flex-showcase] 检查结果:\n${inspectResult.observation}`);

    console.log(JSON.stringify({
      presentationId: pid,
      versionId: genResult.versionId,
      title: deckSpec.title,
      slideCount: deckSpec.slides.length,
    }, null, 2));

    console.log('\n[flex-showcase] 请在前端打开此PPT，与 referenceChineseShowcase 对比。');
  } finally {
    databaseService.close();
  }
}

void main().catch((err: unknown) => {
  console.error(`[flex-showcase] ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
});
