import { registerMessageCatalogs, useLocalization } from '@app/localization';

const zh = {
  description: '安装和维护可复用的工作方法。用户 Skill 可直接编辑；内置与插件 Skill 随产品更新。',
  installed: '已安装', install: '安装 Skill', source: '本机来源目录', name: 'Skill 名称',
  sourceHint: '选择已下载或编写好的文件夹，其中须包含 SKILL.md。',
  nameHint: '名称须与 SKILL.md 的 name 一致，使用小写字母、数字和单连字符。',
  refresh: '刷新', empty: '还没有 Skill。', unavailable: '不可用',
  builtin: '内置', plugin: '插件', user: '用户', file: '文件',
  save: '保存文件', upgrade: '从目录升级', remove: '卸载',
  upgradeHint: '升级会替换当前文件集合，包括本地修改。请填写上方来源目录。',
  readonly: '此 Skill 随产品或插件发布，仅可查看。',
  lifecycle: '改动会影响后续运行；此前暂停的运行可能因内容改变而无法继续。',
  removeTitle: '卸载 Skill', removeMessage: '将永久删除此用户 Skill 的当前文件。需要旧内容时请重新安装。',
  upgradeTitle: '替换当前 Skill', upgradeMessage: '将用来源目录完整替换当前 Skill，包括尚未导出的本地编辑。',
  discardTitle: '放弃未保存的编辑', discardMessage: '切换后将丢弃当前未保存的内容。',
  success: '操作完成。', failed: '操作失败，请检查文件内容或目录后重试。',
  newFile: '新建支持文件', filePath: '相对文件路径', create: '新建', deleteFile: '删除文件',
  deleteTitle: '删除支持文件', deleteMessage: '将永久删除当前支持文件。',
};
const en: Record<keyof typeof zh, string> = {
  description: 'Install reusable workflows. User skills are editable files; bundled and plugin skills update with their source.',
  installed: 'Installed', install: 'Install skill', source: 'Local source directory', name: 'Skill name',
  sourceHint: 'Use a downloaded or authored folder containing SKILL.md.',
  nameHint: 'Match the SKILL.md name: lowercase letters, digits and single hyphens.',
  refresh: 'Refresh', empty: 'No skills installed.', unavailable: 'Unavailable',
  builtin: 'Built-in', plugin: 'Plugin', user: 'User', file: 'File',
  save: 'Save file', upgrade: 'Upgrade from directory', remove: 'Uninstall',
  upgradeHint: 'Upgrade replaces all current files, including local edits. Enter the source directory above.',
  readonly: 'This skill is distributed with the product or a plugin and is read-only.',
  lifecycle: 'Changes affect future runs. Older paused runs may no longer resume after their skill content changes.',
  removeTitle: 'Uninstall skill', removeMessage: 'Permanently delete the current user skill files. Reinstall the source if needed.',
  upgradeTitle: 'Replace current skill', upgradeMessage: 'Replace the entire skill with the source directory, including local edits.',
  discardTitle: 'Discard unsaved edits', discardMessage: 'Switching will discard the current unsaved text.',
  success: 'Operation completed.', failed: 'Operation failed. Check the files or directory and try again.',
  newFile: 'New supporting file', filePath: 'Relative file path', create: 'Create', deleteFile: 'Delete file',
  deleteTitle: 'Delete supporting file', deleteMessage: 'Permanently delete the current supporting file.',
};
let registered = false;
export function useSkillMessages() {
  if (!registered) {
    const entries = (values: Record<keyof typeof zh, string>) => Object.fromEntries(
      Object.entries(values).map(([key, value]) => [`skills.${key}`, value]));
    registerMessageCatalogs({ owner: 'skills', catalogs: { 'zh-CN': entries(zh), 'en-US': entries(en) } });
    registered = true;
  }
  const { message } = useLocalization();
  return (key: keyof typeof zh) => message(`skills.${key}`, zh[key]);
}
