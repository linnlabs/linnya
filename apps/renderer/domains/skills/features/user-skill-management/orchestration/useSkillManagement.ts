import { computed, onBeforeUnmount, onMounted } from 'vue';
import type { ManagedSkill, SkillManagementRequest } from '@app/schemas';
import { confirm } from '@shared/composables/confirmDialog';
import { executeSkillManagement } from '../infrastructure/skillManagementGateway';
import { pickSkillFolder } from '../infrastructure/skillFolderPicker';
import { useSkillManagementStore } from '../store/skillManagementStore';
import { useSkillMessages } from '../definitions/messages';
import { groupSkills } from '../functions/groupSkills';
import { buildFileTree } from '../functions/buildFileTree';

const ENTRY_FILE = 'SKILL.md';

/** autoRefresh 只由页面开启：窗口重新获得焦点时静默刷新，详情弹窗共用同一份状态但不重复注册监听。 */
export function useSkillManagement(options: { autoRefresh?: boolean } = {}) {
  const store = useSkillManagementStore();
  const message = useSkillMessages();
  const state = computed(() => store.state);
  const groups = computed(() => groupSkills(store.state.skills));
  const detail = computed(() => store.state.detail);
  const fileRows = computed(() => buildFileTree(store.state.detail?.skill.files ?? []));
  const editable = computed(() => store.state.detail?.skill.source === 'user');
  const dirty = computed(() => {
    const current = store.state.detail;
    return current !== null && current.original !== null && current.draft !== current.original;
  });
  const draft = computed({
    get: () => store.state.detail?.draft ?? '',
    set: value => {
      const current = store.state.detail;
      if (current) store.apply({ detail: { ...current, draft: value } });
    },
  });

  function fail(error: unknown): void {
    store.apply({ feedback: { kind: 'error', message: error instanceof Error ? error.message : message('failed') } });
  }
  function succeed(text: string): void {
    store.apply({ feedback: { kind: 'success', message: text } });
  }
  async function allowDiscard(): Promise<boolean> {
    return !dirty.value || await confirm({
      title: message('discardTitle'), message: message('discardMessage'),
      confirmText: message('discardConfirm'), cancelText: message('keepEditing'), isDangerousAction: true,
    });
  }

  async function loadList(): Promise<readonly ManagedSkill[]> {
    const response = await executeSkillManagement({ action: 'list' });
    if (response.action !== 'list') throw new Error(message('failed'));
    store.apply({ skills: response.skills });
    return response.skills;
  }
  async function readFile(skill: ManagedSkill, file: string): Promise<void> {
    const response = await executeSkillManagement({ action: 'read', name: skill.name, path: file, source: skill.source });
    if (response.action !== 'read') throw new Error(message('failed'));
    store.apply({ detail: { skill, file, original: response.content, draft: response.content } });
  }
  /** 让已打开的详情跟上当前目录：Skill 被外部卸载则关闭，支持文件被移除则回到入口文件。 */
  async function syncDetail(skills: readonly ManagedSkill[]): Promise<void> {
    const current = store.state.detail;
    if (!current) return;
    const next = skills.find(skill => skill.name === current.skill.name && skill.source === current.skill.source);
    if (!next) { store.apply({ detail: null, editorOpen: false }); return; }
    await readFile(next, next.files.includes(current.file) ? current.file : ENTRY_FILE);
  }

  /** silent：窗口重新获得焦点时的自动刷新，不闪骨架、不打断正在编辑的内容。 */
  async function refresh(options: { silent?: boolean } = {}): Promise<void> {
    if (store.state.busy) return;
    if (!options.silent) store.apply({ busy: true });
    try {
      const skills = await loadList();
      if (!dirty.value) await syncDetail(skills);
      const first = groups.value.flatMap(group => group.skills)[0];
      if (!store.state.detail && first) await readFile(first, ENTRY_FILE);
    } catch (error: unknown) {
      if (!options.silent || store.state.loading) fail(error);
    } finally {
      store.apply({ loading: false, busy: false });
    }
  }

  async function openSkill(skill: ManagedSkill): Promise<void> {
    if (store.state.busy || !await allowDiscard()) return;
    store.apply({ busy: true, feedback: null });
    try { await readFile(skill, ENTRY_FILE); }
    catch (error: unknown) { store.apply({ detail: { skill, file: ENTRY_FILE, original: null, draft: '' } }); fail(error); }
    finally { store.apply({ busy: false }); }
  }
  async function closeDetail(): Promise<void> {
    if (store.state.busy) return;
    if (!await allowDiscard()) return;
    const current = store.state.detail;
    store.apply({ editorOpen: false, feedback: null,
      detail: current ? { ...current, draft: current.original ?? '' } : null });
  }
  function openEditor(): void {
    if (!store.state.detail || store.state.busy) return;
    store.apply({ editorOpen: true, feedback: null });
  }
  async function selectFile(file: string): Promise<void> {
    const current = store.state.detail;
    if (!current || file === current.file || store.state.busy || !await allowDiscard()) return;
    store.apply({ busy: true, feedback: null });
    try { await readFile(current.skill, file); }
    catch (error: unknown) { store.apply({ detail: { ...current, file, original: null, draft: '' } }); fail(error); }
    finally { store.apply({ busy: false }); }
  }

  async function mutate(request: SkillManagementRequest, successText: string): Promise<void> {
    store.apply({ busy: true, feedback: null });
    try {
      await executeSkillManagement(request);
      const skills = await loadList();
      if (request.action === 'remove') store.apply({ detail: null, editorOpen: false });
      else await syncDetail(skills);
      succeed(successText);
    } catch (error: unknown) { fail(error); }
    finally { store.apply({ busy: false }); }
  }

  /** 选文件夹并校验：文件夹的选择、取消、环境不支持、内容无效都在这里统一成反馈。 */
  async function chooseValidatedFolder() {
    const picked = await pickSkillFolder(message('chooseFolder'));
    if (picked.status === 'unavailable') { fail(new Error(message('pickerUnavailable'))); return null; }
    if (picked.status === 'canceled') return null;
    store.apply({ busy: true, feedback: null });
    try {
      const checked = await executeSkillManagement({ action: 'validate', source_directory: picked.path });
      if (checked.action !== 'validate') throw new Error(message('failed'));
      return { path: picked.path, checked };
    } catch (error: unknown) { fail(error); return null; }
    finally { store.apply({ busy: false }); }
  }
  function describeSource(path: string, count: number, name: string, description: string) {
    return [{ title: message('sourceTitle', { name, count }), items: [description, path] }];
  }

  async function install(): Promise<void> {
    if (store.state.busy) return;
    const chosen = await chooseValidatedFolder();
    if (!chosen) return;
    const { name, description, files } = chosen.checked;
    const exists = store.state.skills.some(skill => skill.source === 'user' && skill.name === name);
    const sections = describeSource(chosen.path, files.length, name, description);
    const accepted = exists
      ? await confirm({ title: message('replaceTitle'), message: message('replaceMessage', { name }), sections,
        confirmText: message('replaceConfirm'), cancelText: message('cancel'), isDangerousAction: true })
      : await confirm({ title: message('installTitle'), message: message('installMessage'), sections,
        confirmText: message('installConfirm'), cancelText: message('cancel') });
    if (!accepted) return;
    await mutate({ action: exists ? 'update' : 'install', name, source_directory: chosen.path },
      message(exists ? 'upgradedSuccess' : 'installedSuccess', { name }));
  }
  async function upgrade(): Promise<void> {
    const current = store.state.detail;
    if (!current || !editable.value || store.state.busy) return;
    const chosen = await chooseValidatedFolder();
    if (!chosen) return;
    const { name, description, files } = chosen.checked;
    if (name !== current.skill.name) {
      fail(new Error(message('upgradeMismatch', { found: name, name: current.skill.name })));
      return;
    }
    const accepted = await confirm({
      title: message('upgradeTitle'), message: message('upgradeMessage'),
      sections: describeSource(chosen.path, files.length, name, description),
      confirmText: message('upgradeConfirm'), cancelText: message('cancel'), isDangerousAction: true,
    });
    if (!accepted) return;
    await mutate({ action: 'update', name, source_directory: chosen.path }, message('upgradedSuccess', { name }));
  }
  async function remove(): Promise<void> {
    const current = store.state.detail;
    if (!current || !editable.value || store.state.busy) return;
    const name = current.skill.name;
    const accepted = await confirm({
      title: message('removeTitle', { name }), message: message('removeMessage'),
      confirmText: message('removeConfirm'), cancelText: message('cancel'), isDangerousAction: true,
    });
    if (!accepted) return;
    await mutate({ action: 'remove', name }, message('removedSuccess', { name }));
  }
  async function save(): Promise<void> {
    const current = store.state.detail;
    if (!current || !editable.value || current.original === null || !dirty.value || store.state.busy) return;
    await mutate({ action: 'write', name: current.skill.name, path: current.file,
      content: current.draft, expected_content: current.original }, message('savedSuccess'));
  }

  if (options.autoRefresh) {
    const refreshOnFocus = (): void => { void refresh({ silent: true }); };
    onMounted(() => {
      void refresh({ silent: true });
      window.addEventListener('focus', refreshOnFocus);
    });
    onBeforeUnmount(() => window.removeEventListener('focus', refreshOnFocus));
  }

  return { state, groups, detail, fileRows, editable, dirty, draft, message,
    refresh: () => refresh(), openSkill, openEditor, closeDetail, selectFile, install, upgrade, remove, save };
}
