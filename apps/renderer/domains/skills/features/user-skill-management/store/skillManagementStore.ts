import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { SkillManagementState } from '../definitions/skillManagementState';

export const useSkillManagementStore = defineStore('skill-management', () => {
  const state = ref<SkillManagementState>({ skills: [], loading: false, busy: false,
    selected: null, file: 'SKILL.md', original: null, draft: '', feedback: null });
  function apply(update: Partial<SkillManagementState>): void { state.value = { ...state.value, ...update }; }
  return { state, apply };
});
