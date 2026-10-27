import { registerMessageCatalogs, useLocalization } from '@app/localization';

const zh = {
  description: 'Skill 是 Agent 按需加载的工作方法。可以在对话里让 Agent 把常用流程做成 Skill，也可以从本机文件夹安装。',
  installed: '已安装', install: '从文件夹安装…', refresh: '刷新',
  groupUser: '我的 Skill', groupBuiltin: '内置', groupPlugin: '插件',
  tagUser: '我的 Skill', tagBuiltin: '内置', tagPlugin: '插件',
  emptyUser: '还没有自己的 Skill。可以在对话中让 Agent 把常用流程做成 Skill，或从文件夹安装。',
  unavailable: '不可用',
  chooseFolder: '选择包含 SKILL.md 的文件夹', pickerUnavailable: '当前环境无法打开文件夹选择器。',
  sourceTitle: '{name} · {count} 个文件',
  installTitle: '安装 Skill', installConfirm: '安装',
  installMessage: '安装后，Agent 会在合适的任务里自动使用它。只安装你信任来源的 Skill。',
  replaceTitle: '替换已有 Skill', replaceConfirm: '替换',
  replaceMessage: 'Skill「{name}」已经安装。继续会用这个文件夹完整替换当前内容，包括你在本地做的修改。',
  upgrade: '从文件夹升级…', upgradeTitle: '升级 Skill', upgradeConfirm: '升级',
  upgradeMessage: '将用这个文件夹完整替换当前内容，包括你在本地做的修改，且无法撤销。',
  upgradeMismatch: '这个文件夹里的 Skill 名称是「{found}」，与当前 Skill「{name}」不一致。',
  remove: '卸载', removeTitle: '卸载 Skill「{name}」', removeConfirm: '卸载',
  removeMessage: '将永久删除这个 Skill 的全部文件。需要时可以重新安装。',
  save: '保存', saveHint: '保存后从下一次对话生效', readonly: '内置和插件 Skill 随产品更新，只能查看。',
  files: '文件', unsaved: '未保存',
  viewFiles: '查看文件', editContent: '编辑 Skill 内容', viewContent: '查看 Skill 内容',
  selectSkill: '选择一个 Skill，查看它的工作方法。',
  previewHint: '点击编辑', fileCount: '{count} 个文件', readFailed: '文件读取失败，请重新选择后重试。',
  editorMode: '内容显示方式', source: '原文', preview: '预览', done: '完成', close: '关闭',
  discardTitle: '放弃未保存的修改', discardConfirm: '放弃修改', keepEditing: '继续编辑',
  discardMessage: '关闭或切换后，当前未保存的内容会丢失。',
  cancel: '取消',
  installedSuccess: '已安装 Skill「{name}」。', upgradedSuccess: '已升级 Skill「{name}」。',
  removedSuccess: '已卸载 Skill「{name}」。', savedSuccess: '已保存。',
  failed: '操作失败，请检查文件内容后重试。',
};
const en: Record<keyof typeof zh, string> = {
  description: 'Skills are working methods the agent loads on demand. Ask the agent to turn a routine into a skill in chat, or install one from a local folder.',
  installed: 'Installed', install: 'Install from folder…', refresh: 'Refresh',
  groupUser: 'My skills', groupBuiltin: 'Built-in', groupPlugin: 'Plugins',
  tagUser: 'My skill', tagBuiltin: 'Built-in', tagPlugin: 'Plugin',
  emptyUser: 'No skills of your own yet. Ask the agent in chat to turn a routine into a skill, or install one from a folder.',
  unavailable: 'Unavailable',
  chooseFolder: 'Choose a folder that contains SKILL.md', pickerUnavailable: 'The folder picker is not available here.',
  sourceTitle: '{name} · {count} files',
  installTitle: 'Install skill', installConfirm: 'Install',
  installMessage: 'After installing, the agent uses it automatically when a task fits. Only install skills from sources you trust.',
  replaceTitle: 'Replace existing skill', replaceConfirm: 'Replace',
  replaceMessage: 'Skill "{name}" is already installed. Continuing replaces its current content with this folder, including your local edits.',
  upgrade: 'Upgrade from folder…', upgradeTitle: 'Upgrade skill', upgradeConfirm: 'Upgrade',
  upgradeMessage: 'The current content, including your local edits, will be replaced by this folder. This cannot be undone.',
  upgradeMismatch: 'The skill in this folder is named "{found}", which does not match the current skill "{name}".',
  remove: 'Uninstall', removeTitle: 'Uninstall skill "{name}"', removeConfirm: 'Uninstall',
  removeMessage: 'All files of this skill will be deleted permanently. You can install it again later.',
  save: 'Save', saveHint: 'Takes effect from the next conversation', readonly: 'Built-in and plugin skills update with the product and are view-only.',
  files: 'Files', unsaved: 'Unsaved',
  viewFiles: 'View files', editContent: 'Edit skill content', viewContent: 'View skill content',
  selectSkill: 'Select a skill to explore how it works.',
  previewHint: 'Click to edit', fileCount: '{count} files', readFailed: 'Could not read the file. Select it again to retry.',
  editorMode: 'Content display mode', source: 'Source', preview: 'Preview', done: 'Done', close: 'Close',
  discardTitle: 'Discard unsaved changes', discardConfirm: 'Discard changes', keepEditing: 'Keep editing',
  discardMessage: 'Unsaved content is lost when you close or switch.',
  cancel: 'Cancel',
  installedSuccess: 'Installed skill "{name}".', upgradedSuccess: 'Upgraded skill "{name}".',
  removedSuccess: 'Uninstalled skill "{name}".', savedSuccess: 'Saved.',
  failed: 'The operation failed. Check the file content and try again.',
};

export type SkillMessageKey = keyof typeof zh;
export type SkillMessageResolver = (key: SkillMessageKey, params?: Record<string, string | number>) => string;

let registered = false;
export function useSkillMessages(): SkillMessageResolver {
  if (!registered) {
    const entries = (values: Record<SkillMessageKey, string>) => Object.fromEntries(
      Object.entries(values).map(([key, value]) => [`skills.${key}`, value]));
    registerMessageCatalogs({ owner: 'skills', catalogs: { 'zh-CN': entries(zh), 'en-US': entries(en) } });
    registered = true;
  }
  const { message } = useLocalization();
  return (key, params) => message(`skills.${key}`, zh[key], params);
}
