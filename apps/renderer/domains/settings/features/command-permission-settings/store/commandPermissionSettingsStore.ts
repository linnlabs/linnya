import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  CommandInternalDataAccess,
  CommandPermissionLevel,
} from '@app/schemas/commands';

import {
  createCommandPermissionSettingsDraft,
  type CommandPermissionSettingsDraft,
  type CommandPermissionSettingsProjection,
} from '../definitions/commandPermissionSettingsProjection';

export type CommandPermissionSettingsLoadState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unavailable';
export type CommandPermissionSettingsSaveState =
  | 'idle'
  | 'confirming'
  | 'saving'
  | 'saved'
  | 'failed';
export type CommandPermissionSettingsSaveFailure =
  | 'invalid_update'
  | 'invalid_config'
  | 'read_failed'
  | 'write_failed'
  | 'revision_conflict';

export const useCommandPermissionSettingsStore = defineStore(
  'command-permission-settings',
  () => {
    const loadState = ref<CommandPermissionSettingsLoadState>('idle');
    const projection = ref<CommandPermissionSettingsProjection>();
    const draft = ref<CommandPermissionSettingsDraft>();
    const saveState = ref<CommandPermissionSettingsSaveState>('idle');
    const saveFailure = ref<CommandPermissionSettingsSaveFailure>();
    const isDirty = computed(() => Boolean(
      projection.value
      && draft.value
      && (projection.value.permissionLevel !== draft.value.permissionLevel
        || projection.value.internalDataAccess !== draft.value.internalDataAccess),
    ));

    function beginLoad(): void {
      loadState.value = 'loading';
    }

    function loadSucceeded(next: CommandPermissionSettingsProjection): void {
      projection.value = next;
      draft.value = createCommandPermissionSettingsDraft(next);
      loadState.value = 'ready';
      saveState.value = 'idle';
      saveFailure.value = undefined;
    }

    function loadFailed(): void {
      projection.value = undefined;
      draft.value = undefined;
      loadState.value = 'unavailable';
      saveState.value = 'idle';
      saveFailure.value = undefined;
    }

    function editPermissionLevel(level: CommandPermissionLevel): void {
      if (!draft.value) return;
      draft.value = { ...draft.value, permissionLevel: level };
      saveState.value = 'idle';
      saveFailure.value = undefined;
    }

    function editInternalDataAccess(access: CommandInternalDataAccess): void {
      if (!draft.value) return;
      draft.value = { ...draft.value, internalDataAccess: access };
      saveState.value = 'idle';
      saveFailure.value = undefined;
    }

    function beginSave(): void {
      saveState.value = 'saving';
      saveFailure.value = undefined;
    }

    function beginConfirmation(): void {
      saveState.value = 'confirming';
      saveFailure.value = undefined;
    }

    function restoreDraftFromProjection(): void {
      if (projection.value) {
        draft.value = createCommandPermissionSettingsDraft(projection.value);
      }
      saveState.value = 'idle';
      saveFailure.value = undefined;
    }

    function saveSucceeded(next: CommandPermissionSettingsProjection): void {
      projection.value = next;
      draft.value = createCommandPermissionSettingsDraft(next);
      saveState.value = 'saved';
      saveFailure.value = undefined;
    }

    function saveFailed(input: {
      readonly code: CommandPermissionSettingsSaveFailure;
      readonly backend?: CommandPermissionSettingsProjection;
    }): void {
      if (input.backend) projection.value = input.backend;
      if (projection.value) {
        draft.value = createCommandPermissionSettingsDraft(projection.value);
      }
      saveState.value = 'failed';
      saveFailure.value = input.code;
    }

    return {
      loadState,
      projection,
      draft,
      saveState,
      saveFailure,
      isDirty,
      beginLoad,
      loadSucceeded,
      loadFailed,
      editPermissionLevel,
      editInternalDataAccess,
      beginSave,
      beginConfirmation,
      restoreDraftFromProjection,
      saveSucceeded,
      saveFailed,
    };
  },
);
