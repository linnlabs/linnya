import { readonly, ref } from 'vue';

interface ProjectAssociationPort {
  loadCatalog(): Promise<void>;
  readLinks(projectId: string): Promise<string[]>;
  replaceLinks(projectId: string, ids: string[]): Promise<void>;
  loadFailed(error: unknown): void;
  saveFailed(error: unknown): void;
  saved(): void;
}

/** 一个挂载实例只属于一个冻结项目；切项目或停用由 Host 卸载该实例。 */
export function createProjectAssociationSession(projectId: string, port: ProjectAssociationPort) {
  const linkedIds = ref<string[]>([]);
  const status = ref<'loading' | 'ready' | 'failed'>('loading');
  const saving = ref(false);
  let disposed = false;
  return {
    linkedIds: readonly(linkedIds), status: readonly(status), saving: readonly(saving),
    dispose() { disposed = true; },
    link(id: string) {
      if (status.value === 'ready' && !linkedIds.value.includes(id)) linkedIds.value = [...linkedIds.value, id];
    },
    unlink(id: string) {
      if (status.value === 'ready') linkedIds.value = linkedIds.value.filter(value => value !== id);
    },
    async load() {
      try {
        await port.loadCatalog();
        if (disposed) return;
        const ids = await port.readLinks(projectId);
        if (disposed) return;
        linkedIds.value = ids;
        status.value = 'ready';
      } catch (error) {
        if (disposed) return;
        // 读取失败不是空关联；保存必须等已成功读取原始集合。
        status.value = 'failed';
        port.loadFailed(error);
      }
    },
    async save() {
      if (disposed || status.value !== 'ready' || saving.value) return;
      saving.value = true;
      try {
        await port.replaceLinks(projectId, [...linkedIds.value]);
        if (!disposed) port.saved();
      } catch (error) {
        if (!disposed) port.saveFailed(error);
      } finally {
        if (!disposed) saving.value = false;
      }
    },
  };
}
