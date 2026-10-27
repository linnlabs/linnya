export type SkillFolderSelection =
  | { readonly status: 'selected'; readonly path: string }
  | { readonly status: 'canceled' }
  | { readonly status: 'unavailable' };

/** 经桌面壳的系统文件夹选择器取得本机目录；Renderer 不接触其他文件系统能力。 */
export async function pickSkillFolder(title: string): Promise<SkillFolderSelection> {
  const open = window.electronAPI?.openDirectoryDialog;
  if (typeof open !== 'function') return { status: 'unavailable' };
  const result = await open({ title, properties: ['openDirectory'] });
  if (!result.success) return { status: 'unavailable' };
  const path = result.data?.filePaths[0];
  return result.data?.canceled || !path ? { status: 'canceled' } : { status: 'selected', path };
}
