import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

// 中文说明：Case 只约定调用入口与交付；研究方法由 Skill 维护，避免两份提示词漂移。
// brief 可规定开放检索或固定材料；能力冒烟不等于与无 Skill 基线的质量对照。
export const deepResearchArticleCase = {
  id: 'deep_research_article_v1',
  revision: 3,
  name: '深入研究：Skill 加载、查找资料与长文交付',
  description: 'Default Agent 按任务 brief 使用 deep-research，验证正式加载、工具行为和 Workspace 成稿。',
  tags: ['research', 'writing', 'skill', 'chinese'],
  agentId: 'default',
  reasoningEffort: 'high',
  timeoutMs: 12 * 60 * 1000,
  promptTemplate: `请激活 deep-research Skill，读取研究任务 {{brief}}，按任务规定的材料边界独立完成研究文章。
只使用本次 brief 指定的资料范围与当前工具取得的来源，不读取其他评测答案、旧实验报告或其他会话，不委托其他 Agent。
将成稿与研究依据、计算及未解决问题分成两个新的 Workspace Markdown 文件，建议路径为 workspace:/deep-research-article.md 与 workspace:/deep-research-notes.md。若列表显示同名路径已存在，直接选用未占用的新路径，不读取旧稿来判断归属或补充本次研究；只有 brief 明确指定为更新对象的文件才可读取。
按 brief 的读者和篇幅要求成文，不把研究笔记直接拼成文章。研究记录保留来源、取得范围、计算和会改变结论的未决问题，以实际 Workspace 链接关联正文；保存后回读两份文件。后续评价会在同项目的新会话读取这两份文档，不要求评审者从聊天或本机文件中拼出研究成果。最后只返回短摘要、实际保存的 Workspace 文档链接和剩余限制。总时间预算 12 分钟，留出写入与检查时间。`,
  inputs: [{ key: 'brief', label: '研究任务与材料边界', kind: 'absolute_file', required: true }],
  interaction: { awaitingUser: 'manual', maxResponses: 0 },
  artifactExpectation: 'Workspace 文章与独立研究记录，真实 Skill 调用和按 brief 完成的查找资料、计算、写入与回读。',
  humanReview: [
    { id: 'activation', label: '加载与任务边界', guidance: '从工具输出确认 builtin Skill 激活和所用资源读取；核对是否越过 brief 材料边界，不以口头自述代替。' },
    { id: 'evidence', label: '来源与解释', guidance: '关键主张回到实际取得的原文；区分失败/节选/全文，检查竞争解释、口径与未验证内容。' },
    { id: 'execution', label: '计算与交付', guidance: '核查 Shell 真实退出、数字和正文的一致性，以及 Workspace 写入后回读；引用存在不等于支持结论。' },
    { id: 'reader', label: '读者路径', guidance: '检查必要背景、概念引入、机制与反方衔接、重点分配；给出具体缺陷，不以章节数或句长方差评分。' },
    { id: 'cost', label: '完成与成本', guidance: '保留取消、错误和未测项；actual usage 缺失时不作 token 成本比较，一次调用不证明方法普适优势。' },
  ],
} satisfies BenchmarkCaseDefinition;
