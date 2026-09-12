import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

export const slidesDataIntegrityStressCase = {
  id: 'slides_data_integrity_stress_v1',
  revision: 1,
  name: '数据与图表压力：独立 8 页技术验收',
  description: '排除文献检索变量，验证高密度图表、脏数据计算与诚实降级的能力边界。',
  tags: ['slides', 'data-integrity', 'stress', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'high',
  timeoutMs: 40 * 60 * 1000,
  promptTemplate: `请独立制作恰好 8 页中文技术汇报，保存为 workspace:/data-integrity-stress-v1.slides。全部输入来自 {{dataset}}，不需要联网，不要使用其他模型生成图像或补齐数据。
这是教学模拟数据的图表能力验收，每页写明“教学模拟数据”。不要读取或修改其他文稿、评测报告或答案，只使用给定输入独立完成。用简洁白底、深蓝标题和跨页一致的分组颜色，16:9，优先可编辑的图表和表格。

逐页内容：
1. 12×8 完整 heatmap，清晰区分 null 和 0，不丢行列或缩成不可读图例。
2. time_series 全 24 个月、3 组 positive/n 检出率，另外报告各组两年累计阳性数/累计样本数的加权比例；不能拿月比例的简单平均冒充累计比例。
3. flows 三阶段桑基图，保留全部节点/连线/数值，所有中间节点和总量守恒；含守恒核对表。
4. forest 六项森林图，对数横轴、参照线1、正确区间，标明哪些区间跨1，不伪造研究或合并效应。
5. scatter 全36点分组气泡图，正确使用x/y/size，保留三组图例，轴和尺寸都有含义说明。
6. composition 四组100%堆积图与原始总数，正确归一化及舍入，不歪曲分母。
7. raw_qc 数据清洗审计表：重复记录仅保留最新revision，排除QC fail，缺失不补零，单位全部转换copies/mL；给出每阶段数量、精确数值主分析均值、以2.5替代<5后的敏感性均值。
8. 可复算结果汇总与能力限制：精确重复第2/3/7页关键数字，列出计算方法与未支持的编辑/导出行为。

请保存可复算的派生数据/计算文件。需要降级图表时保留数据含义和全量标签，并在第8页说明；不能把缺失、不支持或未检查写成通过。完成后编译、渲染并检查全部8页，再给出文稿路径、检查范围和真实限制。`,
  inputs: [{ key: 'dataset', label: '模拟监测数据 JSON', kind: 'absolute_file', required: true }],
  interaction: { awaitingUser: 'manual', maxResponses: 0 },
  artifactExpectation: '8 页完整数据验收稿，包含七类数据任务的准确结果、计算记录与限制披露。',
  humanReview: [
    { id: 'numeric', label: '数值真值', guidance: '使用独立 oracle 核对，不接受运行成功代替正确答案。' },
    { id: 'encoding', label: '图形编码', guidance: '核验全部点/类别/流量/区间及单位，不允许静默丢数据。' },
    { id: 'consistency', label: '跨页一致性', guidance: '结果汇总与源图、表以及派生数据应完全一致。' },
    { id: 'limits', label: '上限与诚实性', guidance: '区分模型失误、图表合同不支持、导出降级和运行时故障。' },
  ],
} satisfies BenchmarkCaseDefinition;
