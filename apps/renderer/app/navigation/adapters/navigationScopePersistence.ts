import { getRendererPersistStorage } from '@/shared/persistence/rendererPersistStorage';
import type { NavigationScope } from '../definitions/navigationScope';

/** 沿用已发布的存储键，代码命名调整不丢失用户当前项目与会话草稿。 */
export const NAVIGATION_SCOPE_STORAGE_KEY = 'workspace-scope';

export function readInitialNavigationScope(): NavigationScope {
  const storage = getRendererPersistStorage();
  const raw = storage.getItem('project-scope');
  storage.removeItem('project-scope');
  storage.removeItem('conversation-scope');
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'currentProjectId' in parsed &&
        typeof parsed.currentProjectId === 'string' &&
        parsed.currentProjectId.trim()
      ) {
        return { kind: 'project', projectId: parsed.currentProjectId };
      }
    } catch (error: unknown) {
      console.warn('[navigationScope] 旧导航上下文迁移读取失败：', error);
    }
  }
  return { kind: 'linnya-assistant' };
}
