<script setup lang="ts">
import { ref } from 'vue';
import { AlertDialog, BaseButton } from '@linnya/renderer-ui';
import BackendStatusStrip from '../prototypes/BackendStatusStrip.vue';
import MockComposer from '../prototypes/MockComposer.vue';
import MockTimeline from '../prototypes/MockTimeline.vue';
import RunStatusSidebar, { type RunStatusProject } from '../prototypes/RunStatusSidebar.vue';
import type { RunStatus } from '../prototypes/runStatus';
import type { TimelineEntry } from '../prototypes/steeringDemo';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

/** 两个对话在运行时后台出事；同一份数据按阶段改状态。 */
function projects(a: RunStatus, b: RunStatus): RunStatusProject[] {
  return [
    {
      id: 'market',
      name: '季度复盘',
      expanded: true,
      chats: [
        { id: 'deck', title: '把季度复盘整理成三页演示稿', time: '刚刚', status: a },
        { id: 'tr', title: '翻译投资人汇报', time: '1 分钟前', status: b },
        { id: 'notes', title: '整理客户访谈要点', time: '10月19日', status: 'idle' },
      ],
    },
  ];
}

const DECK_TIMELINE: readonly TimelineEntry[] = [
  { kind: 'user', text: '把季度复盘整理成三页演示稿。' },
  { kind: 'thought', text: '已思考 4 秒' },
  { kind: 'step', icon: 'read', text: '读取文件 · 季度复盘.md' },
  { kind: 'step', icon: 'edit', text: '编辑演示稿 · 第 1 页', state: 'running' },
];

const DECK_INTERRUPTED: readonly TimelineEntry[] = [
  ...DECK_TIMELINE.slice(0, 3),
  { kind: 'step', icon: 'edit', text: '编辑演示稿 · 第 1 页', meta: '已中断' },
  { kind: 'notice', text: '后台服务意外停止，运行已中断。发送“继续”或新消息即可接着做。' },
];

const TOOL_RUNNING: readonly TimelineEntry[] = [
  { kind: 'user', text: '给汇报配一张封面图。' },
  { kind: 'thought', text: '已思考 3 秒' },
  { kind: 'step', icon: 'edit', text: '生成图片 · 封面插图', state: 'running' },
];

const TOOL_STOPPED: readonly TimelineEntry[] = [
  ...TOOL_RUNNING.slice(0, 2),
  { kind: 'step', icon: 'edit', text: '生成图片 · 封面插图', meta: '已停止，没等它结束' },
];

const confirmOpen = ref(false);
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock
      title="后台服务意外停止"
      note="现在：只弹出“时间轴加载失败”这类零散报错，侧栏一直显示运行中，暂停按钮变灰，没有恢复办法，只能退出重开。推荐：主进程自动把后台服务拉起来（5 分钟内最多 3 次），全窗口只用一条状态说明，零散报错不再单独弹。"
    >
      <div class="br__frames">
        <figure class="br__figure">
          <figcaption>① 正在重新启动（通常 2–3 秒）：侧栏暂不显示运行状态，输入框暂不能发送</figcaption>
          <div class="br__window">
            <RunStatusSidebar :projects="projects('idle', 'idle')" variant="quiet" active-id="deck" :show-entries="false" :width="220" />
            <div class="br__main">
              <BackendStatusStrip tone="progress" text="后台服务意外停止，正在重新启动…" />
              <MockTimeline :entries="DECK_TIMELINE.slice(0, 3)" />
              <MockComposer variant="compact" placeholder="后台服务恢复后再发送" :show-usage="false" />
            </div>
          </div>
        </figure>
        <figure class="br__figure">
          <figcaption>② 已恢复：说明几秒后自动消失；被中断的对话照 W-0352 规则出红点，正在看的那个直接写在时间线里</figcaption>
          <div class="br__window">
            <RunStatusSidebar :projects="projects('interrupted', 'interrupted')" variant="quiet" active-id="deck" :show-entries="false" :width="220" />
            <div class="br__main">
              <BackendStatusStrip tone="success" text="已恢复，2 个对话的运行被中断，可以接着做。" />
              <MockTimeline :entries="DECK_INTERRUPTED" />
              <MockComposer variant="compact" placeholder="输入消息，@ 引用文档" :show-usage="false" />
            </div>
          </div>
        </figure>
        <figure class="br__figure">
          <figcaption>③ 5 分钟内第 3 次停止：不再自动重启，交给用户</figcaption>
          <div class="br__window">
            <RunStatusSidebar :projects="projects('idle', 'idle')" variant="quiet" active-id="deck" :show-entries="false" :width="220" />
            <div class="br__main">
              <BackendStatusStrip tone="error" text="后台服务反复停止，已暂停自动重启。">
                <template #actions>
                  <BaseButton variant="plain" size="sm">查看日志</BaseButton>
                  <BaseButton variant="secondary" size="sm">重新启动</BaseButton>
                </template>
              </BackendStatusStrip>
              <MockTimeline :entries="DECK_TIMELINE.slice(0, 3)" />
              <MockComposer variant="compact" placeholder="后台服务恢复后再发送" :show-usage="false" />
            </div>
          </div>
        </figure>
      </div>
    </GalleryBlock>

    <GalleryBlock
      title="位置：顶部一条（推荐）还是右下角卡片"
      note="后台停了，侧栏、文档、设置都会受影响，不只是对话，所以放在主区域顶部，任何页面都看得到，也不挡内容。右下角卡片接近 VS Code 扩展进程崩溃时的提示，但现在那里是会自动消失的轻提示，二者容易混淆。"
    >
      <div class="br__frames">
        <figure class="br__figure">
          <figcaption>A 顶部一条</figcaption>
          <div class="br__window br__window--short">
            <div class="br__main">
              <BackendStatusStrip tone="error" text="后台服务反复停止，已暂停自动重启。">
                <template #actions>
                  <BaseButton variant="plain" size="sm">查看日志</BaseButton>
                  <BaseButton variant="secondary" size="sm">重新启动</BaseButton>
                </template>
              </BackendStatusStrip>
              <MockTimeline :entries="DECK_TIMELINE.slice(0, 3)" />
            </div>
          </div>
        </figure>
        <figure class="br__figure">
          <figcaption>B 右下角卡片（对照）</figcaption>
          <div class="br__window br__window--short br__window--corner">
            <div class="br__main">
              <MockTimeline :entries="DECK_TIMELINE.slice(0, 3)" />
            </div>
            <BackendStatusStrip class="br__corner" tone="error" placement="corner" text="后台服务反复停止，已暂停自动重启。">
              <template #actions>
                <BaseButton variant="plain" size="sm">查看日志</BaseButton>
                <BaseButton variant="secondary" size="sm">重新启动</BaseButton>
              </template>
            </BackendStatusStrip>
          </div>
        </figure>
      </div>
    </GalleryBlock>

    <GalleryBlock
      title="后台服务没有响应"
      note="现在：切到别的对话一直是骨架屏，点暂停一直转圈，没有任何说明；后台缓过来后能自己恢复。推荐：主进程定时问后台，连续 15 秒没回应就出这条说明；恢复后自动收起。重新启动会中断正在运行的对话，所以先确认。"
    >
      <div class="br__frames">
        <figure class="br__figure">
          <figcaption>15 秒没有回应：状态先保持原样，不急着改成中断</figcaption>
          <div class="br__window">
            <RunStatusSidebar :projects="projects('running', 'running')" variant="quiet" active-id="deck" :show-entries="false" :width="220" />
            <div class="br__main">
              <BackendStatusStrip tone="warning" text="后台服务 15 秒没有响应，可能正在处理大量内容。">
                <template #actions>
                  <BaseButton variant="secondary" size="sm" @click="confirmOpen = true">重新启动后台服务</BaseButton>
                </template>
              </BackendStatusStrip>
              <MockTimeline :entries="DECK_TIMELINE" />
              <MockComposer variant="compact" placeholder="补充或纠正" running :show-usage="false" />
            </div>
          </div>
        </figure>
      </div>
      <GalleryRow label="确认">
        <BaseButton variant="secondary" size="sm" @click="confirmOpen = true">打开重新启动确认</BaseButton>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock
      title="工具不响应停止"
      note="现在：点暂停后，如果工具不理会停止，会一直停在“正在暂停”，侧栏显示运行中，这个对话也发不了新消息，直到工具自己结束。推荐：最多等 3 秒，到时直接停下；工具之后才返回的结果丢弃，不写进对话。"
    >
      <div class="br__frames">
        <figure class="br__figure">
          <figcaption>点暂停时：工具正在运行</figcaption>
          <div class="br__window br__window--short">
            <div class="br__main">
              <MockTimeline :entries="TOOL_RUNNING" />
              <MockComposer variant="compact" placeholder="补充或纠正" running :show-usage="false" />
            </div>
          </div>
        </figure>
        <figure class="br__figure">
          <figcaption>3 秒后：已停下，可以接着发消息；没看到中断的人照常在侧栏看到红点</figcaption>
          <div class="br__window br__window--short">
            <div class="br__main">
              <MockTimeline :entries="TOOL_STOPPED" />
              <MockComposer variant="compact" placeholder="输入消息，@ 引用文档" :show-usage="false" />
            </div>
          </div>
        </figure>
      </div>
    </GalleryBlock>

    <GalleryBlock title="同类产品的做法与取舍" note="预览确认后再开工；以下影响工作量与边界。">
      <ol class="br__notes">
        <li>VS Code 扩展进程崩溃后自动重启，5 分钟内第 3 次就停下，改为提示并给“重新启动”按钮；语言服务客户端是 3 分钟内 5 次。这里取 5 分钟 3 次。</li>
        <li>VS Code 会定时探测扩展进程是否卡住；Chrome 页面卡住时给“等待 / 退出”。这里只给说明和重新启动，等待就是什么都不做。</li>
        <li>Temporal 把取消分成“等工具确认”“发出请求就不等”“直接放弃”三种，第一种在工具不配合时会一直卡住；MCP 规定发出取消后不再等结果，迟到的结果忽略。Linnya 现在的暂停相当于第一种，改成“等一会儿再放弃”。</li>
        <li>停止期限要改 Linnkit 的运行时，按跨仓规则先在 linnkit 仓修改、发版，再在 Linnya 升级；被放弃的工具若还在后台跑（如生成图片），费用照算，记一条已知限制。</li>
        <li>强杀 Linnya、断电重启后已经能把遗留运行标成中断，这次不改；后台崩溃后的自动重启也复用同一套启动恢复。</li>
        <li>后台停止期间，各处请求失败不再各自弹错（现在会出现英文 “Failed to fetch”），统一由这条说明代替。</li>
      </ol>
    </GalleryBlock>

    <AlertDialog
      :visible="confirmOpen"
      is-confirmation
      title="重新启动后台服务？"
      message="正在运行的 2 个对话会被中断，重启后可以接着做。已保存的内容不受影响。"
      confirm-text="重新启动"
      @confirm="confirmOpen = false"
      @cancel="confirmOpen = false"
      @close="confirmOpen = false"
    />
  </div>
</template>

<style scoped>
.br__frames {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  align-items: flex-start;
}

.br__figure {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 720px; /* scale-exempt: 示意窗口宽度 */
  margin: 0;
}

.br__figure figcaption {
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
}

.br__window {
  position: relative;
  display: flex;
  width: 720px; /* scale-exempt: 示意窗口宽度 */
  height: 420px; /* scale-exempt: 示意窗口高度 */
  overflow: hidden;
  background-color: var(--color-bg-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.br__window--short {
  width: 420px; /* scale-exempt: 示意窗口宽度 */
  height: 300px; /* scale-exempt: 示意窗口高度 */
}

.br__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3);
}

.br__main > :deep(.mock-timeline) {
  flex: 1;
  overflow: hidden;
}

.br__corner {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-3);
}

.br__notes {
  max-width: 760px; /* scale-exempt: 版面尺寸 */
  margin: 0;
  padding-left: var(--space-5);
  list-style: decimal;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
  line-height: var(--line-height-prose);
}
</style>
