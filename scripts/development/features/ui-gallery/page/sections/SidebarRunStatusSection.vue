<script setup lang="ts">
import { reactive } from 'vue';
import { BaseButton } from '@linnya/renderer-ui';
import RunStatusIndicator from '../prototypes/RunStatusIndicator.vue';
import RunStatusSidebar, { type RunStatusChat, type RunStatusProject } from '../prototypes/RunStatusSidebar.vue';
import type { RunStatus } from '../prototypes/runStatus';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

function makeProjects(): RunStatusProject[] {
  return [
    {
      id: 'market',
      name: '市场研究',
      expanded: true,
      chats: [
        { id: 'pinned', title: '总结项目现状', time: '昨天', pinned: true, status: 'idle' },
        { id: 'running', title: '把季度复盘整理成三页演示稿', time: '刚刚', status: 'running' },
        { id: 'answer', title: '检索竞品资料并写对比表', time: '2 分钟前', status: 'awaiting-answer' },
        { id: 'approval', title: '批量重命名访谈纪要', time: '5 分钟前', status: 'awaiting-approval' },
        { id: 'interrupted', title: '翻译投资人汇报', time: '11:20', status: 'interrupted' },
        { id: 'idle', title: '整理客户访谈要点', time: '10月19日', status: 'idle' },
      ],
    },
    {
      id: 'default',
      name: '默认项目',
      expanded: false,
      chats: [
        { id: 'd1', title: '最近黄金走势如何', time: '10月16日', status: 'running' },
        { id: 'd2', title: '哈喽呀', time: '10月19日', status: 'idle' },
      ],
    },
    { id: 'notes', name: '读书笔记', expanded: false, chats: [{ id: 'n1', title: '第三章摘录', time: '10月2日', status: 'idle' }] },
  ];
}

interface Board {
  readonly key: 'none' | 'quiet' | 'colored';
  readonly caption: string;
  projects: RunStatusProject[];
  activeId: string;
}

const boards = reactive<Board[]>([
  { key: 'none', caption: '现状：没有运行状态', projects: makeProjects(), activeId: 'pinned' },
  { key: 'quiet', caption: '推荐：行首一个记号，等你处理的写在行尾', projects: makeProjects(), activeId: 'pinned' },
  { key: 'colored', caption: '对照：11-17 候选，三种颜色的圆点', projects: makeProjects(), activeId: 'pinned' },
]);

/** 打开对话：中断查看后消失；进行中与等你处理由运行本身结束，不因查看而清除。 */
function open(board: Board, chat: RunStatusChat) {
  board.activeId = chat.id;
  if (chat.status === 'interrupted') chat.status = 'idle';
}

function reset() {
  for (const board of boards) {
    board.projects = makeProjects();
    board.activeId = 'pinned';
  }
}

function single(id: string, title: string, time: string, status: RunStatus, pinned = false): RunStatusProject[] {
  return [{ id: `p-${id}`, name: '市场研究', expanded: true, chats: [{ id, title, time, status, pinned }] }];
}

const legend: readonly { status: Exclude<RunStatus, 'idle'>; text: string }[] = [
  { status: 'running', text: '进行中' },
  { status: 'awaiting-answer', text: '待回答（行尾写“待回答”）' },
  { status: 'awaiting-approval', text: '待审批（行尾写“待审批”）' },
  { status: 'interrupted', text: '已中断，打开后消失' },
];

const cases = {
  pinnedIdle: single('pi', '总结项目现状', '昨天', 'idle', true),
  pinnedRunning: single('pr', '总结项目现状', '刚刚', 'running', true),
  watchingInterrupted: single('wi', '翻译投资人汇报', '11:20', 'interrupted'),
  hover: single('hv', '检索竞品资料并写对比表', '2 分钟前', 'awaiting-answer'),
  hoverCollapsed: [
    {
      id: 'hc',
      name: '市场研究',
      expanded: false,
      chats: [
        { id: 'hc1', title: 'a', time: '', status: 'awaiting-approval' as RunStatus },
        { id: 'hc2', title: 'b', time: '', status: 'awaiting-approval' as RunStatus },
      ],
    },
  ],
  collapsed: [
    {
      id: 'c1',
      name: '市场研究',
      expanded: false,
      chats: [
        { id: 'c1a', title: 'a', time: '', status: 'running' as RunStatus },
        { id: 'c1b', title: 'b', time: '', status: 'awaiting-approval' as RunStatus },
        { id: 'c1c', title: 'c', time: '', status: 'awaiting-approval' as RunStatus },
      ],
    },
    { id: 'c2', name: '默认项目', expanded: false, chats: [{ id: 'c2a', title: 'a', time: '', status: 'running' as RunStatus }] },
    { id: 'c3', name: '读书笔记', expanded: false, chats: [{ id: 'c3a', title: 'a', time: '', status: 'interrupted' as RunStatus }] },
  ],
  narrow: single('nw', '批量重命名二〇二六年第四季度全部访谈纪要', '5 分钟前', 'awaiting-approval'),
};

</script>

<template>
  <div class="gallery-section">
    <GalleryBlock
      title="三种做法并排"
      note="同一份数据。点“翻译投资人汇报”打开它，中断记号随即消失；进行中和等你处理的记号要等运行本身结束，不因查看而消失。悬停任意行，行尾换成更多按钮。"
    >
      <div class="srs__boards">
        <figure v-for="board in boards" :key="board.key" class="srs__figure">
          <figcaption>{{ board.caption }}</figcaption>
          <RunStatusSidebar
            :projects="board.projects"
            :variant="board.key"
            :active-id="board.activeId"
            @open="chat => open(board, chat)"
          />
        </figure>
      </div>
      <div class="srs__actions">
        <BaseButton variant="plain" size="sm" @click="reset">重置状态</BaseButton>
      </div>
    </GalleryBlock>

    <GalleryBlock
      title="推荐做法的规则"
      note="只有两种“等你处理”的状态改写行尾，并把标题提亮一级；它们共用一种强调色，靠文字区分，不靠颜色。中断只在行首留一个小红点，行尾照旧是时间。"
    >
      <GalleryRow label="图例">
        <span v-for="item in legend" :key="item.status" class="srs__legend">
          <RunStatusIndicator :status="item.status" />
          <span>{{ item.text }}</span>
        </span>
        <span class="srs__legend srs__legend--muted">无运行：行首留空</span>
      </GalleryRow>
      <GalleryRow label="置顶对话" align="start">
        <div class="srs__pair">
          <figure class="srs__case"><figcaption>空闲：照旧显示图钉</figcaption><RunStatusSidebar :projects="cases.pinnedIdle" variant="quiet" :show-entries="false" /></figure>
          <figure class="srs__case"><figcaption>有状态：状态替换图钉（置顶对话本来就排在最前）</figcaption><RunStatusSidebar :projects="cases.pinnedRunning" variant="quiet" :show-entries="false" /></figure>
        </div>
      </GalleryRow>
      <GalleryRow label="正在看的对话" align="start">
        <figure class="srs__case"><figcaption>在这个对话里被中断：已经看到了，不出红点</figcaption><RunStatusSidebar :projects="cases.watchingInterrupted" variant="quiet" active-id="wi" :show-entries="false" /></figure>
      </GalleryRow>
      <GalleryRow label="悬停" align="start">
        <div class="srs__pair">
          <figure class="srs__case"><figcaption>对话行：行尾换成更多按钮，和现在一样；行首记号保留</figcaption><RunStatusSidebar :projects="cases.hover" variant="quiet" hover-id="hv" :show-entries="false" /></figure>
          <figure class="srs__case"><figcaption>收起的项目行：记号左移让出操作按钮</figcaption><RunStatusSidebar :projects="cases.hoverCollapsed" variant="quiet" hover-id="hc" :show-entries="false" /></figure>
        </div>
      </GalleryRow>
      <GalleryRow label="收起的项目" align="start">
        <figure class="srs__case"><figcaption>项目行尾只显示里面最需要处理的一种，悬停记号看数量</figcaption><RunStatusSidebar :projects="cases.collapsed" variant="quiet" :show-entries="false" /></figure>
      </GalleryRow>
      <GalleryRow label="最窄侧栏 200px" align="start">
        <figure class="srs__case"><figcaption>长标题截断，“待审批”完整显示</figcaption><RunStatusSidebar :projects="cases.narrow" variant="quiet" :width="200" :show-entries="false" /></figure>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="实现时要做的" note="预览确认后再开工；以下是会影响工作量的几点。">
      <ol class="srs__notes">
        <li>状态读 Host 已有的“当前执行状态”（随对话 CLI 合入 main），侧栏不自己从消息或选中的 Agent 推断。</li>
        <li>侧栏要在运行开始、结束、出现审批或提问时及时变化：需要列表级的推送或轻量刷新，实现前先查现有对话事件能否复用。</li>
        <li>“打开后消失”要记住看过哪一次中断（按运行记），打开对话就记下，重启后保留；只影响显示，不改运行事实。</li>
        <li>范围：列表态项目下的对话、项目态的对话页、收起的项目汇总。右侧对话面板的历史下拉现在不显示行首位，保持不变。</li>
      </ol>
    </GalleryBlock>
  </div>
</template>

<style scoped>
.srs__boards {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  align-items: flex-start;
}

.srs__figure,
.srs__case {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
}

.srs__figure figcaption,
.srs__case figcaption {
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
}

.srs__actions {
  margin-top: var(--space-3);
}

.srs__pair {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
}

.srs__legend {
  display: inline-flex;
  gap: var(--space-1-5);
  align-items: center;
  margin-right: var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
}

.srs__legend--muted {
  color: var(--color-text-tertiary);
}

.srs__notes {
  max-width: 720px; /* scale-exempt: 版面尺寸 */
  margin: 0;
  padding-left: var(--space-5);
  list-style: decimal;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
  line-height: var(--line-height-prose);
}
</style>
