import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

/** 方法与组别放入冻结 brief；两组共享交付、预算与 Skill，避免把写作差异算作检索收益。 */
export const webSearchMaterialsCase = {
  id: 'web_search_materials_v1',
  revision: 1,
  name: '网页资料搜集：普通与深搜对照',
  description:
    'Default Agent 按 brief 搜集资料，保留正式引用、取得限制和差异线索，不写整篇研究文章。',
  tags: ['web', 'research', 'retrieval'],
  agentId: 'default',
  reasoningEffort: 'high',
  timeoutMs: 12 * 60 * 1000,
  promptTemplate: `请激活 deep-research Skill，并读取任务 {{brief}}。本次只完成资料搜集，不写研究文章、不作最终综合结论。遵守 brief 的检索模式和范围。
输出一份新的 Workspace Markdown 资料清单：每个选中来源的正式引用、标题、URL、主要内容或短摘录、相关用途、实际取得范围与限制；简要列出竞争解释、冲突线索和未解决缺口。用途与暂定解释不应冒充来源事实。
只读取本 brief、Skill 资源、本次检索所得材料和自己创建的文件，不读取其他项目、会话、实验记录或已有答案。不使用 subagent 或旧 Deep Research；brief 允许的 web_search 深搜子运行不受此禁令影响。
将结果写入 workspace:/资料清单.md，并回读确认引用与内容。总时间预算 12 分钟，保留交付时间；不要求耗满时间或用满工具次数。信息不足或读取失败时如实记录，仍交付已取得的资料。最后只返回 Workspace 文档链接与简短限制。`,
  inputs: [{ key: 'brief', label: '冻结选题与检索模式', kind: 'absolute_file', required: true }],
  interaction: { awaitingUser: 'manual', maxResponses: 0 },
  artifactExpectation: '同项目可读取的资料清单，实际搜索/读取/组装轨迹和正式引用。',
  humanReview: [
    {
      id: 'provenance',
      label: '来源与原文支持',
      guidance: '逐项核对实际取得版本，区分摘要、正文、元信息与失败；引用存在不等于支持。',
    },
    {
      id: 'coverage',
      label: '解释与区分性材料',
      guidance: '以具体材料核对关键解释、反方与区分性证据覆盖，不按链接数量评分。',
    },
    {
      id: 'cost',
      label: '完成与成本',
      guidance:
        '主/子运行分别报告 usage、工具次数、失败、网络等待与完成率，避免把树累计和子成本重复相加。',
    },
  ],
} satisfies BenchmarkCaseDefinition;
