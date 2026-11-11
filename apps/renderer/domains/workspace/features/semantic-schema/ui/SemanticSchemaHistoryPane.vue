<template>
  <div class="semantic-schema-history">
    <p class="semantic-schema-history__lead">
      {{ message('workspace.semanticSchema.history.lead') }}
    </p>
    <p
      v-if="changes.length === 0"
      class="semantic-schema-muted"
    >
      {{ message('workspace.semanticSchema.history.empty') }}
    </p>
    <div
      v-for="change in changes"
      :key="change.id"
      class="semantic-schema-history__row"
      :class="{ 'is-undone': change.undone_at !== null }"
    >
      <div class="semantic-schema-history__main">
        <p class="semantic-schema-history__what">
          {{ changeSummaryText(change.summary, message) }}
        </p>
        <p class="semantic-schema-history__meta">
          {{ changeMetaText(change, context) }}
        </p>
        <p
          v-if="errors[change.id]"
          class="semantic-schema-detail__error"
          role="alert"
        >
          {{ errors[change.id] }}
        </p>
      </div>
      <span
        v-if="change.undone_at !== null"
        class="semantic-schema-history__state"
      >{{ message('workspace.semanticSchema.history.undone') }}</span>
      <BaseButton
        v-else
        variant="plain"
        size="sm"
        :disabled="busy"
        @click="emit('undo', change.id)"
      >
        <template #icon>
          <UndoIcon />
        </template>{{ message('workspace.semanticSchema.history.undo') }}
      </BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SemanticSchemaChangeItem } from '@app/schemas';
import { BaseButton } from '@linnya/renderer-ui';
import { UndoIcon } from '@linnya/renderer-ui/icons';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import { changeMetaText, changeSummaryText, type SemanticSchemaTextContext } from '../functions/semanticSchemaText';

/** 最近改动：标签和字段本身的改动，新的在前；每批可整批撤回。 */
const props = defineProps<{
  changes: readonly SemanticSchemaChangeItem[];
  busy: boolean;
  /** 撤回失败的原因，按改动 ID。 */
  errors: Readonly<Record<string, string>>;
  context: SemanticSchemaTextContext;
}>();

const emit = defineEmits<{ undo: [changeId: string] }>();

const message: WorkspaceMessageResolver = (key, params) => props.context.message(key, params);
</script>
