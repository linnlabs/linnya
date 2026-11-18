<script setup lang="ts">
import { computed, ref } from 'vue';
import { BaseButton, SegmentedTabs, type SegmentedTabItem } from '@linnya/renderer-ui';
import MockComposer from '../prototypes/MockComposer.vue';
import MockTimeline from '../prototypes/MockTimeline.vue';
import PendingSteerTray from '../prototypes/PendingSteerTray.vue';
import {
  HINT_AFTER_BATCH,
  RUNNING_PLACEHOLDER,
  STEER_MESSAGE,
  TIMELINE_APPROVAL,
  TIMELINE_PAUSED,
  TIMELINE_REPLY_FINISHED,
  TIMELINE_RUNNING,
  TIMELINE_SUBRUN,
  deliveredTimeline,
  interruptedTimeline,
  type TimelineEntry,
} from '../prototypes/steeringDemo.ts';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

/* ---------- 插话的整个过程（可操作） ---------- */

type Phase = 'running' | 'delivered' | 'interrupted' | 'paused';

const phase = ref<Phase>('running');
const draft = ref(STEER_MESSAGE);
const pending = ref<string[]>([]);
const delivered = ref<string[]>([]);

const DEMO_TABS: SegmentedTabItem[] = [
  { id: 'typing', label: '正在输入' },
  { id: 'pending', label: '待送达' },
  { id: 'delivered', label: '已送达' },
  { id: 'interrupted', label: '立即打断' },
  { id: 'paused', label: '暂停后' },
];

const demoTab = computed(() => {
  if (phase.value !== 'running') return phase.value;
  return pending.value.length > 0 ? 'pending' : 'typing';
});

const timeline = computed<readonly TimelineEntry[]>(() => {
  switch (phase.value) {
    case 'running':
      return TIMELINE_RUNNING;
    case 'delivered':
      return deliveredTimeline(delivered.value);
    case 'interrupted':
      return interruptedTimeline(delivered.value);
    case 'paused':
      return TIMELINE_PAUSED;
  }
});

const running = computed(() => phase.value !== 'paused');

const PHASE_NOTES: Readonly<Record<string, string>> = {
  typing: '运行中也能输入。有草稿时，底栏同时有暂停和发送；回车就是插话。',
  pending: '消息先放在输入框上方，写明 Agent 什么时候会读到。送达前每条都能编辑（放回输入框改完再发）或撤回（不发了），也可以立即打断。',
  delivered: '这批步骤做完后送达：消息出现在它被读到的位置，Agent 在同一次回复里接着做。',
  interrupted: '立即打断：暂停正在执行的步骤，消息作为新的一条发出，另起一次回复（与现在先暂停再发一样）。',
  paused: '暂停时，待送达的消息回到输入框，不会自动发出；点发送就另起一次回复。',
};
const phaseNote = computed(() => PHASE_NOTES[demoTab.value] ?? '');
const canFinishBatch = computed(() => phase.value === 'running' && pending.value.length > 0);

function setDemo(id: string) {
  pending.value = [];
  delivered.value = [];
  draft.value = '';
  switch (id) {
    case 'typing':
      phase.value = 'running';
      draft.value = STEER_MESSAGE;
      break;
    case 'pending':
      phase.value = 'running';
      pending.value = [STEER_MESSAGE];
      break;
    case 'delivered':
    case 'interrupted':
      phase.value = id;
      delivered.value = [STEER_MESSAGE];
      break;
    case 'paused':
      phase.value = 'paused';
      draft.value = STEER_MESSAGE;
      break;
  }
}

function send() {
  const text = draft.value.trim();
  if (!text) return;
  draft.value = '';
  if (phase.value === 'paused') {
    // 暂停后发出的消息另起一次回复，与现在一致。
    delivered.value = [text];
    phase.value = 'interrupted';
    return;
  }
  pending.value = [...pending.value, text];
}

const composerRef = ref<InstanceType<typeof MockComposer> | null>(null);

/** 编辑：从待送达里拿回输入框，改完再发。 */
function edit(index: number) {
  const text = pending.value[index];
  if (text === undefined) return;
  pending.value = pending.value.filter((_, i) => i !== index);
  draft.value = [text, draft.value].filter((part) => part.trim()).join('\n');
  void composerRef.value?.focusEnd();
}

/** 撤回：这条不发了。 */
function withdraw(index: number) {
  pending.value = pending.value.filter((_, i) => i !== index);
}

function interruptNow() {
  delivered.value = [...pending.value];
  pending.value = [];
  phase.value = 'interrupted';
}

function finishBatch() {
  if (!canFinishBatch.value) return;
  delivered.value = [...pending.value];
  pending.value = [];
  phase.value = 'delivered';
}

function pause() {
  // 暂停时，待送达的消息回到输入框，不自动发出。
  draft.value = [...pending.value, draft.value].filter((part) => part.trim()).join('\n');
  pending.value = [];
  phase.value = 'paused';
}

/* ---------- 其他情形（静态） ---------- */

interface Scene {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly timeline: readonly TimelineEntry[];
  readonly pending: readonly string[];
  readonly hint: string;
  readonly running: boolean;
  readonly awaitingUser?: boolean;
}

const SCENES: readonly Scene[] = [
  {
    id: 'subrun',
    title: '正在等耗时长的子任务',
    note: '子任务也是这批步骤里的一步，要等它跑完才送达。提示里写出在等哪个子任务；急的话用“立即打断”。',
    timeline: TIMELINE_SUBRUN,
    pending: ['顺便看下有没有教育优惠'],
    hint: 'Agent 在等子任务「国内产品资料调研」，它做完后会读到',
    running: true,
  },
  {
    id: 'approval',
    title: '正在等你批准时',
    note: '可以输入，但消息不代替批准或拒绝；输入框的恢复按钮仍是禁用的，与现在一样。处理完批准、这批步骤做完后照常送达。',
    timeline: TIMELINE_APPROVAL,
    pending: ['上传前先把文件名改成“定价对比”'],
    hint: '先处理上面的批准；这批步骤做完后，Agent 会读到',
    running: true,
    awaitingUser: true,
  },
  {
    id: 'multiple',
    title: '多条待送达',
    note: '按发出的顺序一起送达，每条一个气泡；送达前每条都能单独编辑或撤回。',
    timeline: TIMELINE_RUNNING.slice(-2),
    pending: ['只看国内的产品', '价格统一按年付折算'],
    hint: 'Agent 做完当前这批步骤后会一起读到',
    running: true,
  },
  {
    id: 'finished',
    title: '这次回复先写完了',
    note: '消息发出时 Agent 已经在写最后的回答，后面没有步骤了。回答写完后，消息自动作为下一条发出，不用再点。',
    timeline: TIMELINE_REPLY_FINISHED,
    pending: [],
    hint: '',
    running: true,
  },
];
</script>

<template>
  <div class="gallery-section steer-preview">
    <GalleryBlock
      title="插话的整个过程"
      note="已定（2026-11-18）：回车就是插话；等当前这批步骤做完再送达，正在执行的不打断；插话留在同一次回复里。可以直接在输入框里打字、回车发送，再编辑、撤回或立即打断；右边的按钮模拟这批步骤做完。"
    >
      <GalleryRow label="演示状态">
        <SegmentedTabs :model-value="demoTab" :tabs="DEMO_TABS" aria-label="演示状态" @update:model-value="setDemo" />
        <BaseButton variant="secondary" size="sm" :disabled="!canFinishBatch" @click="finishBatch">这批步骤做完</BaseButton>
      </GalleryRow>
      <p class="steer-preview__phase-note">{{ phaseNote }}</p>

      <div class="steer-preview__stage is-main">
        <MockTimeline :entries="timeline" class="steer-preview__timeline" />
        <MockComposer
          ref="composerRef"
          v-model:draft="draft"
          editable
          :running="running"
          :placeholder="running ? RUNNING_PLACEHOLDER : '输入消息，@ 引用文档'"
          @send="send"
          @pause="pause"
        >
          <template v-if="pending.length" #above>
            <PendingSteerTray :messages="pending" :hint="HINT_AFTER_BATCH" @edit="edit" @withdraw="withdraw" @interrupt="interruptNow" />
          </template>
        </MockComposer>
      </div>
    </GalleryBlock>

    <GalleryBlock
      title="其他情形"
      note="静态示意。时间线只截了插话附近的一段。"
    >
      <div class="steer-preview__grid">
        <figure v-for="scene in SCENES" :key="scene.id" class="steer-preview__figure">
          <figcaption>
            <span class="steer-preview__caption-title">{{ scene.title }}</span>
            <span class="steer-preview__caption-note">{{ scene.note }}</span>
          </figcaption>
          <div class="steer-preview__stage">
            <MockTimeline :entries="scene.timeline" class="steer-preview__timeline" />
            <MockComposer :running="scene.running" :awaiting-user="scene.awaitingUser" :placeholder="RUNNING_PLACEHOLDER">
              <template v-if="scene.pending.length" #above>
                <PendingSteerTray :messages="scene.pending" :hint="scene.hint" />
              </template>
            </MockComposer>
          </div>
        </figure>

        <figure class="steer-preview__figure">
          <figcaption>
            <span class="steer-preview__caption-title">侧边对话（紧凑宽度）</span>
            <span class="steer-preview__caption-note">提示过长时截断，悬停看全文。</span>
          </figcaption>
          <div class="steer-preview__stage is-compact">
            <MockTimeline :entries="TIMELINE_RUNNING.slice(-2)" class="steer-preview__timeline" />
            <MockComposer variant="compact" model="DeepSeek V4 Flash" running :placeholder="RUNNING_PLACEHOLDER">
              <template #above>
                <PendingSteerTray compact :messages="[STEER_MESSAGE]" :hint="HINT_AFTER_BATCH" />
              </template>
            </MockComposer>
          </div>
        </figure>
      </div>
    </GalleryBlock>
  </div>
</template>

<style scoped>
.steer-preview__stage {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-bg-default);
  box-shadow: 0 0 0 1px var(--color-border-light);
}

.steer-preview__stage.is-main {
  max-width: 680px;
  min-height: 500px;
  margin-top: var(--space-3);
}

.steer-preview__phase-note {
  max-width: 680px;
  margin: var(--space-3) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.steer-preview__stage.is-compact {
  max-width: 360px;
  padding: var(--space-3) var(--space-2-5);
}

.steer-preview__timeline {
  padding: 0 var(--space-1);
}

.steer-preview__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 560px));
  gap: var(--space-6) var(--space-8);
  align-items: start;
}

.steer-preview__figure {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.steer-preview__figure figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.steer-preview__caption-title {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.steer-preview__caption-note {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>
