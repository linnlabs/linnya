import { computed, ref } from 'vue';
import type { ManagedSkill, SkillManagementRequest } from '@app/schemas';
import { confirm } from '@shared/composables/confirmDialog';
import { executeSkillManagement } from '../infrastructure/skillManagementGateway';
import { useSkillManagementStore } from '../store/skillManagementStore';
import { useSkillMessages } from '../definitions/messages';

export function useSkillManagement() {
  const store = useSkillManagementStore();
  const message = useSkillMessages();
  const sourceDirectory = ref(''); const installName = ref(''); const newPath = ref('');
  const state = computed(() => store.state);
  const draft = computed({ get: () => store.state.draft, set: value => store.apply({ draft: value }) });
  const dirty = computed(() => store.state.original !== null && store.state.draft !== store.state.original);
  const editable = computed(() => store.state.selected?.source === 'user');

  async function allowDiscard(): Promise<boolean> {
    return !dirty.value || await confirm({ title: message('discardTitle'), message: message('discardMessage'), isDangerousAction: false });
  }
  async function readFile(skill: ManagedSkill, file: string): Promise<void> {
    const response = await executeSkillManagement({ action: 'read', name: skill.name, path: file, source: skill.source });
    if (response.action !== 'read') throw new Error(message('failed'));
    store.apply({ selected: skill, file, original: response.content, draft: response.content });
  }
  async function refresh(): Promise<void> {
    if (!await allowDiscard()) return;
    store.apply({ loading: true, busy: true });
    try {
      const response = await executeSkillManagement({ action: 'list' });
      if (response.action !== 'list') throw new Error(message('failed'));
      store.apply({ skills: response.skills });
      // Agent、CLI 或外部编辑器都能改当前目录，刷新不能保留已经失效的编辑目标。
      const selected = store.state.selected;
      const current = selected && response.skills.find(skill => skill.name === selected.name && skill.source === selected.source);
      if (current) {
        const file = current.files.includes(store.state.file) ? store.state.file : 'SKILL.md';
        await readFile(current, file);
      } else {
        store.apply({ selected: null, file: 'SKILL.md', original: null, draft: '' });
      }
    } catch (error: unknown) { fail(error); }
    finally { store.apply({ loading: false, busy: false }); }
  }
  function fail(error: unknown): void {
    store.apply({ feedback: { kind: 'error', message: error instanceof Error ? error.message : message('failed') } });
  }
  async function select(skill: ManagedSkill, file = 'SKILL.md'): Promise<void> {
    if (!await allowDiscard()) return;
    store.apply({ busy: true, feedback: null });
    try { await readFile(skill, file); }
    catch (error: unknown) { store.apply({ selected: skill, file, original: null, draft: '' }); fail(error); }
    finally { store.apply({ busy: false }); }
  }
  async function mutate(request: SkillManagementRequest): Promise<void> {
    store.apply({ busy: true, feedback: null });
    try {
      await executeSkillManagement(request);
      // 成功后重新读取当前目录；不把输入草稿当成已保存事实。
      store.apply({ original: null, draft: '' });
      const response = await executeSkillManagement({ action: 'list' });
      if (response.action !== 'list') throw new Error(message('failed'));
      store.apply({ skills: response.skills });
      const name = 'name' in request ? request.name : store.state.selected?.name;
      const next = response.skills.find(skill => skill.source === 'user' && skill.name === name);
      if (next) await readFile(next, request.action === 'write' || request.action === 'edit' ? request.path : 'SKILL.md');
      else store.apply({ selected: null });
      store.apply({ feedback: { kind: 'success', message: message('success') } });
    } catch (error: unknown) { fail(error); }
    finally { store.apply({ busy: false }); }
  }
  async function install(): Promise<void> {
    if (!await allowDiscard()) return;
    await mutate({ action: 'install', name: installName.value, source_directory: sourceDirectory.value });
  }
  async function upgrade(): Promise<void> {
    if (!store.state.selected || !await confirm({ title: message('upgradeTitle'), message: message('upgradeMessage'), isDangerousAction: false })) return;
    await mutate({ action: 'update', name: store.state.selected.name, source_directory: sourceDirectory.value });
  }
  async function remove(): Promise<void> {
    if (!store.state.selected || !await confirm({ title: message('removeTitle'), message: message('removeMessage'), isDangerousAction: true })) return;
    await mutate({ action: 'remove', name: store.state.selected.name });
  }
  async function save(): Promise<void> {
    const current = store.state;
    if (!current.selected || current.original === null) return;
    await mutate({ action: 'write', name: current.selected.name, path: current.file,
      content: current.draft, expected_content: current.original });
  }
  async function createFile(): Promise<void> {
    if (!store.state.selected || !await allowDiscard()) return;
    await mutate({ action: 'write', name: store.state.selected.name, path: newPath.value, content: '', expected_content: null });
    newPath.value = '';
  }
  async function deleteFile(): Promise<void> {
    if (!store.state.selected || !await confirm({ title: message('deleteTitle'), message: message('deleteMessage'), isDangerousAction: true })) return;
    await mutate({ action: 'delete_file', name: store.state.selected.name, path: store.state.file });
  }
  return { state, draft, dirty, editable, sourceDirectory, installName, newPath, message,
    refresh, select, install, upgrade, remove, save, createFile, deleteFile };
}
