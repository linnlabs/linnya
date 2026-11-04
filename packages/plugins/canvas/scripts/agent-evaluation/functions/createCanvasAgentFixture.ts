import { CanvasCommandSchema, createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import type { CanvasAgentTaskId } from '../definitions/canvasAgentEvaluation';
import { canvasAgentTasks } from '../definitions/canvasAgentTasks';
import { canvasResearchMaterials } from '../definitions/canvasResearchMaterials';

export const architectureModules = ['Renderer', 'Navigation', 'Shell', 'Canvas', 'Editor', 'References', 'Assets', 'Persistence'] as const;
export const architectureDependencies = [['Renderer', 'Navigation'], ['Navigation', 'Shell'], ['Shell', 'Canvas'], ['Shell', 'Editor'], ['Canvas', 'References'], ['Canvas', 'Assets'], ['Canvas', 'Persistence'], ['Editor', 'References'], ['Editor', 'Assets'], ['Editor', 'Persistence'], ['References', 'Persistence'], ['Assets', 'Persistence']] as const;
const sceneCodes = Array.from({ length: 12 }, (_, index) => `A${Math.floor(index / 4) + 1}S${index % 4 + 1}`);
const scenes = ['雨夜收到失踪信件', '主角在车站遇到证人', '旧账本出现不同笔迹', '证人留下钥匙后离开', '钥匙打开档案室', '搭档承认藏过证据', '追查者在桥头出现', '主角决定公开记录', '证人在听证会露面', '搭档交出原始录音', '记录澄清失踪真相', '主角将钥匙交给家属'];
function card(text: string, index: number, x = index % 5 * 280, y = Math.floor(index / 5) * 160) {
  return CanvasCommandSchema.parse({ op: 'addText', ref: `$seed${index + 1}`, width: 240, height: 120, x, y, content: createCanvasPlainTextDocument(text) });
}
function documents(taskId: CanvasAgentTaskId) {
  if (taskId === 'T1') return Array.from({ length: 8 }, (_, index) => ({ key: `overview-${index + 1}`, filename: `项目资料${index + 1}.md`, text: `# 资料${index + 1}\n主题：${['用户体验', '协作流程', '数据可靠性'][index % 3]}\n事实F${index + 1}：${['新用户需要清楚的首次入口', '评审需要稳定身份和原始来源', '保存失败必须保留草稿'][index % 3]}。本资料的独特约束：样本${index + 1}来自独立访谈。` }));
  if (taskId === 'T2') return canvasResearchMaterials.map((material, index) => ({ key: `research-${index + 1}`, filename: `调研${index + 1}.md`,
    text: `# 调研${index + 1}：${material.title}\n议题：是否统一评审入口\n合成可用性观察，仅供固定评测，并非真实调研结果。观察对象是统一评审入口原型及其对照流程；每条为独立观察，不外推因果或总体比例。\n`
      + material.observations.map((observation, item) => `- R${index + 1}F${item + 1} ${observation.stance}：${observation.text}`).join('\n') }));
  if (taskId === 'T4') return [{ key: 'process', filename: '申请流程.md', text: '# 申请流程\nS01接收申请→S02资料完整？\nS02是→S04资格审核；S02否→S03补充资料→S02。\nS04→S05满足规则？\nS05是→S06生成方案→S08人工复核→S09发送结果→S10归档。\nS05否→S07拒绝通知→S10归档。\n共10步，S02与S05是判断。保留编号。' }];
  if (taskId === 'T5') return [{ key: 'architecture', filename: 'README.md', text: '# 模块依赖\n模块：' + architectureModules.join('、') + '\nA→B表示A依赖B。仅有以下直接依赖：\n' + architectureDependencies.map(([from, to]) => `${from}→${to}`).join('\n') }];
  if (taskId === 'T8') return [
    { key: 'chrome-evidence', filename: 'Chrome官方资料快照.md', text: '# 离线资料快照：Chrome\n检索日期：2026-11-04。以下是历史发布公告摘要，不等于当前完整支持表。\n来源：https://developer.chrome.com/blog/webgpu-release?hl=en\nChrome 113的初始默认支持覆盖macOS、具备Direct3D 12的Windows、具备Vulkan的ChromeOS；文章当时把Linux和Android列为后续计划。不得把该历史计划直接当作2026年的现状。' },
    { key: 'firefox-evidence', filename: 'Firefox官方资料快照.md', text: '# 离线资料快照：Firefox\n检索日期：2026-11-04。\n来源：https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/141\nFirefox 141开发者发行说明确认Windows支持WebGPU，但排除service worker上下文。这条说明本身不能证明其他操作系统在2026年是否已支持。' },
    { key: 'safari-evidence', filename: 'Safari官方资料快照.md', text: '# 离线资料快照：Safari\n检索日期：2026-11-04。\n来源：https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes\nSafari 26.0正式发行说明的WebGPU新功能明确增加WebGPU支持。这段说明没有提供每种系统/硬件的完整覆盖表，不能据此省略平台核对。' },
  ];
  if (taskId === 'T6') return [{ key: 'outline', filename: '三幕大纲.md', text: '# 三幕大纲\n' + sceneCodes.map((code, index) => `${code}：${scenes[index]}。人物：主角、搭档、证人。`).join('\n') }];
  return [];
}
function seedOperations(taskId: CanvasAgentTaskId) {
  if (taskId === 'T3') return [card('问题：如何让独立研究者更快复核信息来源？', 0)];
  if (taskId === 'T7') return sceneCodes.map((code, index) => card(`${code} ${scenes[index]}\n人物：主角、搭档、证人。请保留此场景。`, index, Math.floor(index / 4) * 600, index % 4 * 180));
  if (taskId === 'T8') return [card('问题：截至2026年10月底，WebGPU是否已在Chrome、Firefox、Safari桌面版默认可用？分别说明平台限制并用官方资料查证。', 0)];
  if (taskId === 'T9') return Array.from({ length: 60 }, (_, index) => card(`[主题${'ABCD'[index % 4]}] 条目${index + 1}\n固定正文${index + 1}，不得改写。`, index, index * 137 % 17 * 280, index * 251 % 13 * 180));
  if (taskId === 'T10') return Array.from({ length: 18 }, (_, index) => card(`${index % 3 === 0 ? '待定' : '已确认'}事项${index + 1}\n保留原正文${index + 1}。`, index));
  if (taskId === 'T11') return [card('X\n用户正在编辑的原文。', 0), card('Y\n允许补充的原文。', 1)];
  if (taskId === 'T12') return Array.from({ length: 24 }, (_, index) => card(`无用卡${index + 1}\n仅供清理验收。`, index));
  if (taskId === 'T13') return Array.from({ length: 2000 }, (_, index) => card(`既有卡${index + 1}\n稳定正文，不应被新批次改写。`, index, index % 50 * 280, Math.floor(index / 50) * 160));
  return [];
}
export function createCanvasAgentFixture(taskId: CanvasAgentTaskId) {
  const task = canvasAgentTasks.find(task => task.id === taskId);
  if (!task) throw new Error('Unknown evaluation task');
  return { fixtureVersion: 1, task, offlinePrompt: taskId === 'T8' ? '仅对照给定三份官方历史资料快照，分别提取证据卡并连到问题，附原始URL与资料局限；本次是离线来源结构基线，不能声称已经联网核实2026年现状。' : null, documents: documents(taskId), userSeedOperations: seedOperations(taskId),
    control: taskId === 'T11' ? 'Seed完成后为c1.data登记并续订用户编辑声明，保留独立未保存草稿，模型终止后再释放。' : taskId === 'T9' ? '待确认出现后，可信UI点击允许。' : taskId === 'T12' ? '待确认出现后，可信UI点击不允许。' : null };
}
