<template>
  <div>
    <p v-if="presentation.data.kind === 'result' && presentation.data.outcome === 'inputs_changed'">
      {{ conversationMessage('conversation.tool.researchRun.changedNotice') }}
    </p>
    <ul v-if="presentation.data.kind === 'result' && presentation.data.changedPaths.length > 0">
      <li
        v-for="path in presentation.data.changedPaths"
        :key="path"
      >
        {{ path }}
      </li>
    </ul>
    <p v-if="presentation.data.kind === 'result' && presentation.data.outcome === 'delivered'">
      {{ conversationMessage('conversation.tool.researchRun.savedNotice') }}
    </p>
    <section
      v-for="item in presentation.data.items"
      :key="item.subrunId"
    >
      <ConversationResourceLinkNode
        v-if="item.artifactPath"
        :href="item.artifactPath"
        :authored-title="localizedText(item.label)"
      />
      <SubrunTracePanel
        :status="presentation.status"
        :enabled="true"
        :subrun-trace="subrunTrace"
        :subrun-trace-version="subrunTraceVersion"
        :lazy-source="itemSource(item.subrunId)"
        :title-executing="localizedText(item.label)"
        :title-completed="localizedText(item.label)"
        :show-top-divider="false"
        disclosure-mode="collapsible"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { useLocalization } from '@app/localization';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { ToolCardPresentation } from '../../../ui/tools/types';
import { ConversationResourceLinkNode } from '../../resource-link';
import { SubrunTracePanel, type HistoricalSubrunTraceLazySource } from '../../subrun-trace';
import type { ResearchRunPresentationData } from '../definitions/researchRunPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<ResearchRunPresentationData>;
  subrunTrace?: unknown;
  subrunTraceVersion?: number;
  lazySubrunTraceSource?: HistoricalSubrunTraceLazySource;
}>();
const { conversationMessage } = useConversationLocalization();
const { t: localizedText } = useLocalization();

function itemSource(subrunId: string): HistoricalSubrunTraceLazySource | undefined {
  return props.lazySubrunTraceSource ? { ...props.lazySubrunTraceSource, subrunId } : undefined;
}
</script>
