<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  AlertDialog,
  BaseButton,
  CustomNumberInput,
  CustomSelect,
  IconButton,
  Switch,
  type CustomSelectOption,
} from '@linnya/renderer-ui';
import {
  AddCircleIcon,
  AddIcon,
  AppsIcon,
  ChatIcon,
  ChevronIcon,
  ClockIcon,
  FolderIcon,
  GlanceIcon,
  LibraryIcon,
  MoreIcon,
  SearchIcon,
  TerminalIcon,
} from '@linnya/renderer-ui/icons';
import ScheduledTaskEditor from '../prototypes/ScheduledTaskEditor.vue';
import { TIER_LABELS, type PermissionTier } from '../prototypes/permissionTier.ts';
import {
  CURRENT_PROJECT_ID,
  DEMO_PROJECTS,
  DEMO_RUNS,
  DEMO_TASKS,
  RUN_STATUS_LABELS,
  isTaskActive,
  taskStatusPresentation,
  type DemoTask,
} from '../prototypes/scheduledTasksDemo.ts';
import GalleryBlock from '../ui/GalleryBlock.vue';

const GLOBAL_TIER: PermissionTier = 'standard';

const projectName = (id: string) => DEMO_PROJECTS.find(project => project.id === id)?.name ?? id;
const taskById = (id: string) => DEMO_TASKS.find(task => task.id === id)!;

/* ---------- 侧栏 ---------- */

const currentProjectTasks = DEMO_TASKS.filter(task => task.projectId === CURRENT_PROJECT_ID);
const unreadTotal = DEMO_TASKS.reduce((sum, task) => sum + task.unread, 0);
const unreadInProject = currentProjectTasks.reduce((sum, task) => sum + task.unread, 0);

type SidebarRow =
  | { readonly kind: 'conversation'; readonly title: string; readonly time: string }
  | { readonly kind: 'task'; readonly taskId: string; readonly time: string };

/** 项目对话列表：每个任务折叠成一行，按最近一次运行排进去。 */
const SIDEBAR_ROWS: readonly SidebarRow[] = [
  { kind: 'task', taskId: 'news', time: '9:02' },
  { kind: 'conversation', title: '竞品跟踪', time: '昨天' },
  { kind: 'conversation', title: '定价讨论', time: '昨天' },
  { kind: 'task', taskId: 'competitor', time: '周五' },
  { kind: 'conversation', title: '访谈记录整理', time: '周四' },
  { kind: 'task', taskId: 'weekly-report', time: '11月1日' },
  { kind: 'conversation', title: '第四季度计划', time: '10月30日' },
];

const openedRunTaskId = ref('news');

/* ---------- 定时任务视图 ---------- */

const maxConcurrent = ref(5);
const selectedTaskId = ref<string | null>('news');
const editing = ref<'new' | 'edit' | null>(null);
const savedNotice = ref('');
const enabledOverrides = ref<Record<string, boolean>>({});

const selectedTask = computed(() => (selectedTaskId.value ? taskById(selectedTaskId.value) : null));
const otherProjects = DEMO_PROJECTS.filter(project => project.id !== CURRENT_PROJECT_ID).map(project => ({
  project,
  tasks: DEMO_TASKS.filter(task => task.projectId === project.id),
}));

function isEnabled(task: DemoTask) {
  return enabledOverrides.value[task.id] ?? isTaskActive(task);
}
function setEnabled(task: DemoTask, value: boolean) {
  enabledOverrides.value = { ...enabledOverrides.value, [task.id]: value };
}
function selectTask(id: string) {
  selectedTaskId.value = id;
  editing.value = null;
  savedNotice.value = '';
}
function startNew() {
  selectedTaskId.value = null;
  editing.value = 'new';
  savedNotice.value = '';
}
function onSaved(name: string) {
  savedNotice.value = editing.value === 'new' ? `已创建“${name}”。` : `已保存“${name}”，下一次运行开始生效。`;
  editing.value = null;
  if (!selectedTaskId.value) selectedTaskId.value = 'news';
}
function onCancelEdit() {
  editing.value = null;
  if (!selectedTaskId.value) selectedTaskId.value = 'news';
}

const TONE_CLASS = {
  neutral: 'is-neutral',
  accent: 'is-accent',
  warning: 'is-warning',
  error: 'is-error',
  muted: 'is-muted',
} as const;

interface TaskBanner {
  readonly text: string;
  readonly action: string;
  readonly tone: 'warning' | 'error';
}
const taskBanner = computed<TaskBanner | null>(() => {
  const task = selectedTask.value;
  if (!task) return null;
  switch (task.status) {
    case 'awaiting-approval':
      return { text: '上一次运行在等你批准一条命令。批准或拒绝之前，到点的运行都会跳过。', action: '去审批', tone: 'warning' };
    case 'auto-paused-unread':
      return { text: '连续 14 天没打开过这个任务的结果，已自动暂停，免得一直花钱。', action: '恢复', tone: 'warning' };
    case 'auto-paused-failures':
      return { text: '连续 3 次失败，已自动暂停。最近一次：模型不可用（Qwen 3.5 Plus 已被删除）。', action: '恢复', tone: 'error' };
    default:
      return null;
  }
});

/** 运行记录里的档位是那一次实际用的；样例让最早一条与现在不同，表示中途改过。 */
function runTier(runId: string): PermissionTier {
  const current = selectedTask.value?.tier ?? 'standard';
  if (runId !== 'r36') return current;
  return current === 'standard' ? 'read_only' : 'standard';
}

/* ---------- 定时运行的对话 ---------- */

const runOptions: CustomSelectOption<string>[] = DEMO_RUNS.filter(run => run.hasConversation).map((run, index) => ({
  text: `第 ${42 - index - (index > 2 ? 1 : 0)} 次 · ${run.scheduled}`,
  value: run.id,
}));
const openedRunId = ref('r42');
const openedRun = computed(() => DEMO_RUNS.find(run => run.id === openedRunId.value)!);
const openedRunTask = computed(() => taskById(openedRunTaskId.value));

function openTaskRun(taskId: string) {
  openedRunTaskId.value = taskId;
  openedRunId.value = 'r42';
}

/* ---------- 确认框 ---------- */

type DialogKind = 'quit' | 'delete-running' | 'delete-model' | null;
const dialog = ref<DialogKind>(null);
const DIALOGS = {
  quit: {
    title: '退出 Linnya？',
    message: '有 2 个定时任务正在运行：“站会要点汇总”“每日行业新闻”。退出会中断它们，下次打开也不会重跑。',
    confirmText: '仍然退出',
    cancelText: '取消',
  },
  'delete-running': {
    title: '删除“站会要点汇总”？',
    message: '这个任务正在运行。删除后不会再按时运行，已经生成的对话会保留。\n\n要同时停止正在运行的这一次吗？',
    confirmText: '删除并停止',
    cancelText: '只删除任务',
  },
  'delete-model': {
    title: '删除模型“DeepSeek V4”？',
    message: '有 3 个定时任务指定了这个模型：每日行业新闻、周报初稿、整理下载文件夹。\n\n删除后，它们下一次运行会记为失败并通知你，不会自动换成别的模型。',
    confirmText: '删除模型',
    cancelText: '取消',
  },
} as const;
const dialogCopy = computed(() => (dialog.value ? DIALOGS[dialog.value] : DIALOGS.quit));

/* ---------- Agent 建任务：高于对话档位时的审批 ---------- */

const approvalChoice = ref<'pending' | 'allowed' | 'denied'>('pending');
</script>

<template>
  <div class="gallery-section sched">
    <!-- 侧栏入口 -->
    <GalleryBlock
      title="入口：全局侧栏与项目侧栏"
      note="全局侧栏的“定时任务”列出所有项目的任务；项目侧栏里先列当前项目，再列其他项目。项目对话列表里每个任务折叠成一行，按最近一次运行排序，点开是最近一次运行的对话。角标是没看过的运行次数。"
    >
      <div class="sched__sidebars">
        <figure class="sched__figure">
          <figcaption>全局侧栏</figcaption>
          <nav class="mock-sidebar">
            <button type="button" class="mock-sidebar__entry"><AddIcon /><span>新对话</span></button>
            <button type="button" class="mock-sidebar__entry"><AddCircleIcon /><span>新建项目</span></button>
            <button type="button" class="mock-sidebar__entry"><LibraryIcon /><span>知识库</span></button>
            <button type="button" class="mock-sidebar__entry"><AppsIcon /><span>插件</span></button>
            <button type="button" class="mock-sidebar__entry is-selected">
              <ClockIcon /><span>定时任务</span><span class="sched-badge">{{ unreadTotal }}</span>
            </button>
            <div class="mock-sidebar__heading">项目</div>
            <button v-for="project in DEMO_PROJECTS" :key="project.id" type="button" class="mock-sidebar__entry">
              <FolderIcon /><span>{{ project.name }}</span>
            </button>
          </nav>
        </figure>

        <figure class="sched__figure">
          <figcaption>项目侧栏（对话）</figcaption>
          <nav class="mock-sidebar">
            <div class="mock-sidebar__project">
              <ChevronIcon direction="left" class="mock-sidebar__back" />
              <span class="mock-sidebar__project-name">市场研究</span>
              <span class="mock-sidebar__tabs"><ChatIcon class="is-selected" /><FolderIcon /></span>
            </div>
            <button type="button" class="mock-sidebar__entry"><GlanceIcon /><span>概览</span></button>
            <button type="button" class="mock-sidebar__entry">
              <ClockIcon /><span>定时任务</span><span class="sched-badge">{{ unreadInProject }}</span>
            </button>
            <button type="button" class="mock-sidebar__create"><AddIcon /><span>新对话</span></button>
            <label class="mock-sidebar__search"><SearchIcon /><span>搜索对话</span></label>
            <template v-for="(row, index) in SIDEBAR_ROWS" :key="index">
              <button
                v-if="row.kind === 'task'"
                type="button"
                class="mock-sidebar__chat is-task"
                :class="{ 'is-selected': openedRunTaskId === row.taskId, 'is-muted': !isTaskActive(taskById(row.taskId)) }"
                :title="`定时任务 · ${taskById(row.taskId).schedule} · 共 ${taskById(row.taskId).runCount} 次运行`"
                @click="openTaskRun(row.taskId)"
              >
                <ClockIcon class="mock-sidebar__chat-icon" />
                <span class="mock-sidebar__chat-title">{{ taskById(row.taskId).name }}</span>
                <span v-if="taskById(row.taskId).status === 'awaiting-approval'" class="mock-sidebar__chat-flag">待审批</span>
                <span v-if="taskById(row.taskId).unread" class="sched-badge">{{ taskById(row.taskId).unread }}</span>
                <span v-else class="mock-sidebar__chat-time">{{ row.time }}</span>
              </button>
              <button v-else type="button" class="mock-sidebar__chat">
                <span class="mock-sidebar__chat-title">{{ row.title }}</span>
                <span class="mock-sidebar__chat-time">{{ row.time }}</span>
              </button>
            </template>
          </nav>
        </figure>

        <figure class="sched__figure sched__figure--grow">
          <figcaption>点开折叠行：最近一次运行的对话，可切到更早的运行</figcaption>
          <div class="mock-run">
            <header class="mock-run__header">
              <ClockIcon class="mock-run__icon" />
              <span class="mock-run__task">{{ openedRunTask.name }}</span>
              <CustomSelect v-model="openedRunId" class="mock-run__select" :options="runOptions" variant="minimal" :bordered="false" font-size="12px" trigger-aria-label="切换运行" />
              <span class="mock-run__spacer" />
              <button type="button" class="mock-run__link">任务设置</button>
            </header>
            <div class="mock-run__meta">
              定时运行 · 计划 {{ openedRun.scheduled }}<template v-if="openedRun.started">，{{ openedRun.started }} 开始</template>
              · 权限：<span :class="{ 'is-full-access': openedRunTask.tier === 'full_access' }">{{ TIER_LABELS[openedRunTask.tier] }}</span>
              · 模型：{{ openedRunTask.model }}
            </div>
            <div class="mock-run__body">
              <div class="mock-run__prompt">{{ openedRunTask.prompt }}</div>
              <div class="mock-run__answer">
                <p>今天挑了 5 条，已写进“行业动态”文档第 3 节：</p>
                <ol>
                  <li>某协作办公套件发布 AI 写作助手，免费额度从每月 50 次提到 200 次。对我们的个人免费档有直接压力。</li>
                  <li>两家文档工具宣布打通数据导入，迁移成本明显下降。</li>
                  <li>……</li>
                </ol>
                <p class="mock-run__assumption">我的假设：“过去 24 小时”按北京时间昨天 9:00 到今天 9:00 计算；有 2 条只有英文报道，已附原文链接。</p>
              </div>
            </div>
          </div>
        </figure>
      </div>
    </GalleryBlock>

    <!-- 定时任务视图 -->
    <GalleryBlock
      title="定时任务视图（从项目侧栏进入）"
      note="左边先列当前项目，再列其他项目；右边是选中任务的设置和运行记录。点“新建任务”或“编辑”看表单；选“完全访问”会弹确认框，比设置页多一段警告。"
    >
      <div class="sched-view">
        <header class="sched-view__header">
          <div class="sched-view__heading">
            <h3 class="sched-view__title">定时任务</h3>
            <p class="sched-view__subtitle">到点自动新建一个对话去做。需要 Linnya 开着；电脑睡眠或 App 没开时错过的，下次打开补跑最近一次。</p>
          </div>
          <div class="sched-view__toolbar">
            <span class="sched-view__concurrency">
              同时最多运行
              <CustomNumberInput :model-value="maxConcurrent" :min="1" :max="5" :step="1" input-width="72px" show-spin-buttons @update:model-value="value => maxConcurrent = Math.min(5, Math.max(1, Number(value) || 1))" />
              个
            </span>
            <BaseButton variant="primary" size="md" @click="startNew"><template #icon><AddIcon /></template>新建任务</BaseButton>
          </div>
        </header>

        <div class="sched-view__body">
          <aside class="sched-list">
            <div class="sched-list__group">市场研究 · 当前项目</div>
            <button
              v-for="task in currentProjectTasks"
              :key="task.id"
              type="button"
              class="sched-row"
              :class="{ 'is-selected': selectedTaskId === task.id, 'is-off': !isEnabled(task) }"
              @click="selectTask(task.id)"
            >
              <span class="sched-row__main">
                <span class="sched-row__name">
                  {{ task.name }}
                  <span v-if="task.tier === 'full_access'" class="sched-tag is-warning">完全访问</span>
                </span>
                <span class="sched-row__meta">
                  {{ task.schedule }} ·
                  <span :class="TONE_CLASS[taskStatusPresentation(task).tone]">{{ taskStatusPresentation(task).text }}</span>
                </span>
              </span>
              <span v-if="task.unread" class="sched-badge">{{ task.unread }}</span>
            </button>

            <div class="sched-list__group sched-list__group--other">其他项目</div>
            <template v-for="group in otherProjects" :key="group.project.id">
              <div class="sched-list__project">{{ group.project.name }}</div>
              <button
                v-for="task in group.tasks"
                :key="task.id"
                type="button"
                class="sched-row"
                :class="{ 'is-selected': selectedTaskId === task.id, 'is-off': !isEnabled(task) }"
                @click="selectTask(task.id)"
              >
                <span class="sched-row__main">
                  <span class="sched-row__name">
                    {{ task.name }}
                    <span v-if="task.tier === 'full_access'" class="sched-tag is-warning">完全访问</span>
                  </span>
                  <span class="sched-row__meta">
                    {{ task.schedule }} ·
                    <span :class="TONE_CLASS[taskStatusPresentation(task).tone]">{{ taskStatusPresentation(task).text }}</span>
                  </span>
                </span>
                <span v-if="task.unread" class="sched-badge">{{ task.unread }}</span>
              </button>
            </template>
          </aside>

          <section class="sched-detail">
            <ScheduledTaskEditor
              v-if="editing"
              :key="`${editing}-${selectedTaskId}`"
              :task="editing === 'edit' ? selectedTask : null"
              :global-tier="GLOBAL_TIER"
              @save="onSaved"
              @cancel="onCancelEdit"
            />
            <template v-else-if="selectedTask">
              <p v-if="savedNotice" class="sched-detail__saved">{{ savedNotice }}</p>
              <header class="sched-detail__header">
                <div class="sched-detail__heading">
                  <h3 class="sched-detail__title">{{ selectedTask.name }}</h3>
                  <p class="sched-detail__source">{{ projectName(selectedTask.projectId) }} · {{ selectedTask.createdBy }}</p>
                </div>
                <div class="sched-detail__actions">
                  <label class="sched-detail__enable">
                    <Switch
                      :model-value="isEnabled(selectedTask)"
                      ariaLabel="启用"
                      :disabled="selectedTask.status === 'finished'"
                      @update:model-value="value => setEnabled(selectedTask!, value)"
                    />
                    {{ isEnabled(selectedTask) ? '已启用' : '已暂停' }}
                  </label>
                  <BaseButton variant="secondary" size="sm">立即运行</BaseButton>
                  <BaseButton variant="secondary" size="sm" @click="editing = 'edit'">编辑</BaseButton>
                  <IconButton label="更多"><MoreIcon /></IconButton>
                </div>
              </header>

              <div v-if="taskBanner" class="sched-banner" :class="`is-${taskBanner.tone}`">
                <span>{{ taskBanner.text }}</span>
                <BaseButton variant="secondary" size="sm">{{ taskBanner.action }}</BaseButton>
              </div>

              <dl class="sched-facts">
                <div><dt>时间</dt><dd>{{ selectedTask.schedule }}</dd></div>
                <div><dt>下次运行</dt><dd>{{ selectedTask.nextRun ?? '—' }}</dd></div>
                <div><dt>Agent</dt><dd>{{ selectedTask.agent }}</dd></div>
                <div><dt>模型</dt><dd>{{ selectedTask.model }}</dd></div>
                <div>
                  <dt>命令权限</dt>
                  <dd :class="{ 'is-full-access': selectedTask.tier === 'full_access' }">{{ TIER_LABELS[selectedTask.tier] }}</dd>
                </div>
                <div><dt>错过的运行</dt><dd>{{ selectedTask.skipMissed ? '跳过' : '补跑最近一次' }}</dd></div>
                <div class="is-wide"><dt>每次要做的事</dt><dd class="sched-facts__prompt">{{ selectedTask.prompt }}</dd></div>
              </dl>

              <div class="sched-runs">
                <div class="sched-runs__header">
                  <span>运行记录</span>
                  <span class="sched-runs__stats">共 {{ selectedTask.runCount }} 次 · 占用 {{ selectedTask.storage }}</span>
                </div>
                <div v-for="run in DEMO_RUNS" :key="run.id" class="sched-run" :class="{ 'is-unread': run.unread }">
                  <span class="sched-run__dot" aria-hidden="true" />
                  <span class="sched-run__time">
                    <span class="sched-run__scheduled">{{ run.scheduled }}</span>
                    <span v-if="run.started" class="sched-run__started">{{ run.started }} 开始</span>
                  </span>
                  <span class="sched-run__status" :class="TONE_CLASS[RUN_STATUS_LABELS[run.status].tone]">{{ RUN_STATUS_LABELS[run.status].text }}</span>
                  <span class="sched-run__detail">{{ run.detail }}</span>
                  <span class="sched-run__tier" :class="{ 'is-full-access': runTier(run.id) === 'full_access' }">{{ TIER_LABELS[runTier(run.id)] }}</span>
                  <span class="sched-run__tokens">{{ run.tokens ? `${run.tokens} tokens` : '' }}</span>
                  <button v-if="run.hasConversation" type="button" class="sched-run__open">打开对话</button>
                  <span v-else />
                </div>
              </div>
            </template>
          </section>
        </div>
      </div>
    </GalleryBlock>

    <!-- 回答结束后的卡片 -->
    <GalleryBlock
      title="Agent 建了任务以后：回答末尾的提示"
      note="A 沿用“这一轮改了哪些文档”的尾注，安静、不加色块；B 是一张小卡片。两种都按完全访问时显著警告，回答正文里 Agent 也会说明风险。点任何一处进入定时任务视图。"
    >
      <div class="sched-cards">
        <figure class="sched__figure">
          <figcaption>A　尾注 · 标准</figcaption>
          <div class="mock-answer">
            <p>好的，已建好定时任务：每个工作日早上 9 点搜集办公软件和 AI 写作工具的新闻，挑 5 条写进“行业动态”。</p>
            <div class="mock-answer__tail">
              <button type="button" class="sched-note">
                <span>建了定时任务“每日行业新闻”</span>
                <span class="sched-note__sep">·</span>
                <span>每个工作日 9:00</span>
                <ChevronIcon direction="right" class="sched-note__chevron" />
              </button>
            </div>
          </div>
        </figure>
        <figure class="sched__figure">
          <figcaption>A　尾注 · 完全访问</figcaption>
          <div class="mock-answer">
            <p>已建好定时任务：每天 22:00 整理下载文件夹。<strong>注意：这个任务用的是“完全访问”，运行时删除、移动文件都不会再问你。</strong>如果不放心，可以改成“标准”。</p>
            <div class="mock-answer__tail">
              <button type="button" class="sched-note">
                <span>建了定时任务“整理下载文件夹”</span>
                <span class="sched-note__sep">·</span>
                <span>每天 22:00</span>
                <span class="sched-note__sep">·</span>
                <span class="sched-note__warning">完全访问</span>
                <ChevronIcon direction="right" class="sched-note__chevron" />
              </button>
            </div>
          </div>
        </figure>
        <figure class="sched__figure">
          <figcaption>B　卡片 · 标准</figcaption>
          <div class="mock-answer">
            <p>好的，已建好定时任务：每个工作日早上 9 点搜集办公软件和 AI 写作工具的新闻，挑 5 条写进“行业动态”。</p>
            <div class="sched-card">
              <ClockIcon class="sched-card__icon" />
              <div class="sched-card__text">
                <span class="sched-card__name">每日行业新闻</span>
                <span class="sched-card__meta">每个工作日 9:00 · 下次明天 9:00 · 标准</span>
              </div>
              <BaseButton variant="secondary" size="sm">查看</BaseButton>
            </div>
          </div>
        </figure>
        <figure class="sched__figure">
          <figcaption>B　卡片 · 完全访问</figcaption>
          <div class="mock-answer">
            <p>已建好定时任务：每天 22:00 整理下载文件夹。<strong>注意：这个任务用的是“完全访问”，运行时删除、移动文件都不会再问你。</strong>如果不放心，可以改成“标准”。</p>
            <div class="sched-card is-full-access">
              <ClockIcon class="sched-card__icon" />
              <div class="sched-card__text">
                <span class="sched-card__name">整理下载文件夹</span>
                <span class="sched-card__meta">每天 22:00 · 下次今天 22:00</span>
                <span class="sched-card__warning">完全访问：无人在场时自动允许所有命令，包括删除和上传文件。</span>
              </div>
              <div class="sched-card__actions">
                <BaseButton variant="secondary" size="sm">改为标准</BaseButton>
                <BaseButton variant="ghost" size="sm">查看</BaseButton>
              </div>
            </div>
          </div>
        </figure>
      </div>
    </GalleryBlock>

    <!-- 高于对话档位：只给允许本次 -->
    <GalleryBlock
      title="Agent 建的任务权限高于当前对话"
      note="在“标准”对话里让 Agent 建“完全访问”的任务，要经你批准，而且只给“允许本次”，没有“本对话内允许相同命令”。等于或低于对话档位时直接放行。"
    >
      <div class="sched-approval">
        <div class="sched-approval__title"><TerminalIcon />允许执行这条命令吗？</div>
        <p class="sched-approval__reason">这条命令会创建一个“完全访问”的定时任务，高于这个对话的“标准”。任务会在你不在场时自动允许所有命令。</p>
        <code class="sched-approval__command">linnya schedules create --name "整理下载文件夹" --daily 22:00 --tier full_access</code>
        <div v-if="approvalChoice === 'pending'" class="sched-approval__actions">
          <BaseButton variant="secondary" size="sm" @click="approvalChoice = 'denied'">拒绝</BaseButton>
          <BaseButton variant="primary" size="sm" @click="approvalChoice = 'allowed'">允许本次</BaseButton>
        </div>
        <p v-else class="sched-approval__result">
          {{ approvalChoice === 'allowed' ? '已允许本次。' : '已拒绝。' }}
          <button type="button" class="sched-approval__reset" @click="approvalChoice = 'pending'">重置</button>
        </p>
      </div>
    </GalleryBlock>

    <!-- 其他确认框 -->
    <GalleryBlock title="其他确认框" note="退出时有任务在跑、删除正在运行的任务、删除被任务指定的模型。">
      <div class="sched-dialog-buttons">
        <BaseButton variant="secondary" size="md" @click="dialog = 'quit'">退出 App</BaseButton>
        <BaseButton variant="secondary" size="md" @click="dialog = 'delete-running'">删除正在运行的任务</BaseButton>
        <BaseButton variant="secondary" size="md" @click="dialog = 'delete-model'">删除模型</BaseButton>
      </div>
    </GalleryBlock>

    <AlertDialog
      :visible="dialog !== null"
      is-confirmation
      :is-dangerous-action="dialog !== 'delete-running'"
      :close-is-cancel="dialog !== 'delete-running'"
      width="440px"
      :title="dialogCopy.title"
      :message="dialogCopy.message"
      :confirm-text="dialogCopy.confirmText"
      :cancel-text="dialogCopy.cancelText"
      @confirm="dialog = null"
      @cancel="dialog = null"
      @close="dialog = null"
    />
  </div>
</template>

<style scoped>
.sched__sidebars {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
}

.sched__figure {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.sched__figure--grow {
  flex: 1 1 420px;
  max-width: 640px;
}

.sched__figure figcaption {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.sched-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  margin-left: auto;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--color-accent-bg);
  color: var(--color-accent-text);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
}

/* ---------- 侧栏 ---------- */

.mock-sidebar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 248px;
  height: 460px;
  padding: var(--space-2) var(--space-2-5);
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--color-bg-sidebar);
  box-shadow: 0 0 0 1px var(--color-border-light);
  font-size: var(--font-size-body);
}

.mock-sidebar__entry,
.mock-sidebar__chat,
.mock-sidebar__create {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 32px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mock-sidebar__entry :deep(svg),
.mock-sidebar__create :deep(svg) {
  flex: none;
  width: 16px;
  height: 16px;
}

.mock-sidebar__entry:hover,
.mock-sidebar__chat:hover {
  background: var(--color-bg-hover);
}

.mock-sidebar__entry.is-selected,
.mock-sidebar__chat.is-selected {
  background: var(--color-bg-active);
  color: var(--color-text-primary);
}

.mock-sidebar__heading {
  margin: var(--space-3) var(--space-2) var(--space-1);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.mock-sidebar__project {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  height: 36px;
  padding: 0 var(--space-1);
  color: var(--color-text-primary);
}

.mock-sidebar__back {
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
}

.mock-sidebar__project-name {
  flex: 1;
  font-weight: var(--font-weight-medium);
}

.mock-sidebar__tabs {
  display: inline-flex;
  gap: var(--space-2);
  color: var(--color-text-tertiary);
}

.mock-sidebar__tabs :deep(svg) {
  width: 16px;
  height: 16px;
}

.mock-sidebar__tabs :deep(.is-selected) {
  color: var(--color-text-primary);
}

.mock-sidebar__create {
  margin-top: var(--space-1);
  color: var(--color-text-primary);
}

.mock-sidebar__search {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  height: 30px;
  margin: var(--space-1) 0 var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-bg-search);
  color: var(--color-text-placeholder);
  font-size: var(--font-size-sm);
}

.mock-sidebar__search :deep(svg) {
  width: 14px;
  height: 14px;
}

.mock-sidebar__chat {
  color: var(--color-text-primary);
}

.mock-sidebar__chat.is-muted {
  color: var(--color-text-tertiary);
}

.mock-sidebar__chat-icon {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
}

.mock-sidebar__chat-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mock-sidebar__chat-time {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.mock-sidebar__chat-flag {
  flex: none;
  color: var(--color-warning-text);
  font-size: var(--font-size-caption);
}

/* ---------- 定时运行的对话 ---------- */

.mock-run {
  display: flex;
  flex-direction: column;
  height: 460px;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--color-bg-default);
  box-shadow: 0 0 0 1px var(--color-border-light);
}

.mock-run__header {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  height: 40px;
  padding: 0 var(--space-3);
  border-bottom: 0.5px solid var(--color-border-light);
}

.mock-run__icon {
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
}

.mock-run__task {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.mock-run__select {
  width: 168px;
}

.mock-run__spacer {
  flex: 1;
}

.mock-run__link {
  border: 0;
  background: none;
  color: var(--color-text-link);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.mock-run__meta {
  padding: var(--space-2) var(--space-4) 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.mock-run__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  overflow: auto;
  color: var(--color-text-primary);
  font-size: var(--font-size-prose);
  line-height: 1.7;
}

.mock-run__prompt {
  align-self: flex-end;
  max-width: 85%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--color-bg-subtle);
  font-size: var(--font-size-body);
}

.mock-run__answer p,
.mock-run__answer ol {
  margin: 0 0 var(--space-2);
}

.mock-run__assumption {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.is-full-access {
  color: var(--color-warning-text);
  font-weight: var(--font-weight-medium);
}

/* ---------- 定时任务视图 ---------- */

.sched-view {
  display: flex;
  flex-direction: column;
  max-width: 1120px;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--color-bg-default);
  box-shadow: 0 0 0 1px var(--color-border-light);
}

.sched-view__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-5) var(--space-6) var(--space-4);
}

.sched-view__heading {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sched-view__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-title);
  font-weight: var(--font-weight-semibold, 600);
}

.sched-view__subtitle {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.sched-view__toolbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-4);
}

.sched-view__concurrency {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.sched-view__body {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  min-height: 640px;
  border-top: 0.5px solid var(--color-border-light);
}

.sched-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-2-5);
  border-right: 0.5px solid var(--color-border-light);
}

.sched-list__group {
  padding: var(--space-1) var(--space-2) var(--space-1-5);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
}

.sched-list__group--other {
  margin-top: var(--space-4);
}

.sched-list__project {
  padding: var(--space-1-5) var(--space-2) var(--space-0-5);
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
}

.sched-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.sched-row:hover {
  background: var(--color-bg-hover);
}

.sched-row.is-selected {
  background: var(--color-bg-active);
}

.sched-row__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sched-row__name {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
}

.sched-row.is-off .sched-row__name {
  color: var(--color-text-secondary);
}

.sched-row__meta {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sched-tag {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 var(--space-1-5);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
}

.sched-tag.is-warning {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
}

.is-neutral { color: var(--color-text-tertiary); }
.is-accent { color: var(--color-accent-text); }
.is-warning { color: var(--color-warning-text); }
.is-error { color: var(--color-error-text); }
.is-muted { color: var(--color-text-placeholder); }

.sched-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-5) var(--space-6);
}

.sched-detail__saved {
  margin: 0;
  color: var(--color-success-text);
  font-size: var(--font-size-sm);
}

.sched-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.sched-detail__heading {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.sched-detail__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-medium);
}

.sched-detail__source {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.sched-detail__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
}

.sched-detail__enable {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  margin-right: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.sched-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-2-5) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.sched-banner.is-warning {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
}

.sched-banner.is-error {
  background: var(--color-error-bg-subtle);
  color: var(--color-error-text);
}

.sched-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3) var(--space-6);
  margin: 0;
}

.sched-facts > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sched-facts > div.is-wide {
  grid-column: 1 / -1;
}

.sched-facts dt {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.sched-facts dd {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.sched-facts__prompt {
  color: var(--color-text-secondary) !important;
  line-height: 1.6;
}

.sched-runs {
  display: flex;
  flex-direction: column;
}

.sched-runs__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: var(--space-2);
  border-bottom: 0.5px solid var(--color-border-light);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.sched-runs__stats {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  font-weight: normal;
}

.sched-run {
  display: grid;
  grid-template-columns: 6px 112px 84px minmax(0, 1fr) 56px 88px 56px;
  align-items: center;
  gap: var(--space-2);
  min-height: 40px;
  border-bottom: 0.5px solid var(--color-border-light);
  font-size: var(--font-size-caption);
}

.sched-run__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.sched-run.is-unread .sched-run__dot {
  background: var(--color-accent);
}

.sched-run__time {
  display: flex;
  flex-direction: column;
}

.sched-run__scheduled {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.sched-run.is-unread .sched-run__scheduled {
  font-weight: var(--font-weight-medium);
}

.sched-run__started,
.sched-run__tokens,
.sched-run__tier {
  color: var(--color-text-tertiary);
}

.sched-run__detail {
  overflow: hidden;
  color: var(--color-text-secondary);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sched-run__open {
  border: 0;
  background: none;
  color: var(--color-text-link);
  font: inherit;
  cursor: pointer;
}

/* ---------- 回答末尾 ---------- */

.sched-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 560px));
  gap: var(--space-5) var(--space-8);
}

.mock-answer {
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--color-bg-default);
  box-shadow: 0 0 0 1px var(--color-border-light);
  color: var(--color-text-primary);
  font-size: var(--font-size-prose);
  line-height: 1.7;
}

.mock-answer p {
  margin: 0 0 var(--space-2);
}

.mock-answer strong {
  font-weight: var(--font-weight-medium);
}

.mock-answer__tail {
  display: flex;
  margin-left: calc(-1 * var(--space-1-5));
}

.sched-note {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 24px;
  padding: 0 var(--space-1) 0 var(--space-1-5);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  font: inherit;
  font-size: var(--font-size-caption);
  white-space: nowrap;
  cursor: pointer;
}

.sched-note:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.sched-note__sep {
  color: var(--color-text-placeholder);
}

.sched-note__warning {
  color: var(--color-warning-text);
  font-weight: var(--font-weight-medium);
}

.sched-note__chevron {
  width: 14px;
  height: 14px;
}

.sched-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
}

.sched-card.is-full-access {
  align-items: flex-start;
  background: var(--color-warning-bg);
}

.sched-card__icon {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--color-text-secondary);
}

.sched-card__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sched-card__name {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.sched-card__meta {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.sched-card__warning {
  margin-top: var(--space-1);
  color: var(--color-warning-text);
  font-size: var(--font-size-caption);
}

.sched-card__actions {
  display: flex;
  flex: none;
  gap: var(--space-1);
}

/* ---------- 审批 ---------- */

.sched-approval {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 560px;
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--color-border-default);
}

.sched-approval__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.sched-approval__title :deep(svg) {
  width: 16px;
  height: 16px;
}

.sched-approval__reason {
  margin: 0;
  color: var(--color-warning-text);
  font-size: var(--font-size-sm);
}

.sched-approval__command {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
  font-size: var(--font-size-caption);
  white-space: pre-wrap;
  word-break: break-all;
}

.sched-approval__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.sched-approval__result {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.sched-approval__reset {
  border: 0;
  background: none;
  color: var(--color-text-link);
  font: inherit;
  cursor: pointer;
}

.sched-dialog-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
