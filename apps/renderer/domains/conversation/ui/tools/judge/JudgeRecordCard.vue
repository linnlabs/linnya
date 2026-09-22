<template>
  <div class="judge-record-card">
    <ToolActivityIndicator
      v-if="presentation.status === 'loading'"
      :running-label="conversationMessage('conversation.tool.judgeRecord.loading')"
    />
    <p v-else-if="presentation.status === 'error'">
      {{ conversationMessage('conversation.tool.judgeRecord.failed') }}
    </p>
    <template v-else-if="presentation.data.kind === 'record'">
      <p>{{ presentation.data.target }}</p>
      <p>{{ conversationMessage('conversation.tool.judgeRecord.disclaimer') }}</p>
      <ul>
        <li
          v-for="(finding, index) in presentation.data.findings"
          :key="index"
        >
          <strong>{{ finding.criterion }}</strong> — {{ conversationMessage(assessmentKeys[finding.assessment]) }}
          <p>{{ finding.explanation }}</p>
          <blockquote
            v-for="(evidence, n) in finding.evidence"
            :key="n"
          >
            {{ evidence.quote }} <small>({{ evidence.locator }})</small>
          </blockquote>
        </li>
      </ul>
      <p>{{ conversationMessage('conversation.tool.judgeRecord.output') }} {{ presentation.data.output }}</p>
    </template>
  </div>
</template>
<script setup lang="ts">
import type { ToolCardPresentation } from '../types';
import type { JudgeRecordPresentationData } from './projectJudgeRecordPresentation';
import { ToolActivityIndicator } from '../../../shared/execution-presentation';
import { useConversationLocalization } from '../../useConversationLocalization';
const { conversationMessage } = useConversationLocalization();
defineProps<{ presentation: ToolCardPresentation<JudgeRecordPresentationData> }>();
const assessmentKeys = {
  supported: 'conversation.tool.judgeRecord.supported',
  revision_needed: 'conversation.tool.judgeRecord.revisionNeeded',
  unverified: 'conversation.tool.judgeRecord.unverified',
} as const;
</script>
<style scoped>
.judge-record-card { font-size: 0.875rem; overflow-wrap: anywhere; }
.judge-record-card p { margin-block: 0.4rem; }
.judge-record-card blockquote { margin-inline: 0.8rem; opacity: 0.8; }
</style>
