<template>
  <div class="todo-sidebar">
    <!-- Content -->
    <div class="content">
      <div class="content-inner">
        <div class="create-card-wrapper">
          <CreateTodoCard :is-open="showCreateCard" @close="showCreateCard = false" @add="handleAddTodo" />
        </div>

        <!-- Scheduled Section -->
        <SectionHeader
          :title="workspaceMessage('workspace.todo.section.schedule')"
          :count="scheduledCount"
          :is-expanded="expandedSections.scheduled"
          @toggle="toggleSection('scheduled')"
          color="text-primary"
        />
        <div v-if="expandedSections.scheduled" class="section-content">
          <template v-if="allScheduledTasks.length > 0">
            <!-- Today Tasks -->
            <div v-if="todayTasks.length > 0" class="today-tasks-group">
              <div class="sub-header">
                <span class="dot primary-dot" />
                {{ workspaceMessage('workspace.todo.date.today') }}
              </div>
              <div class="timeline-list">
                <div v-for="todo in todayTasks" :key="todo.id" class="timeline-item">
                  <div class="timeline-time">{{ todo.dueTime || '--:--' }}</div>
                  <div class="timeline-connector">
                    <div class="timeline-dot"></div>
                  </div>
                  <div class="timeline-content">
                    <TodoItem
                      :todo="todo"
                      @toggle-complete="handleToggleComplete"
                      @delete="handleDelete"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Overdue Tasks Section -->
            <div v-if="overdueTasks.length > 0" class="sub-tasks-section overdue-tasks-section">
              <button
                @click="expandOverdueTasks = !expandOverdueTasks"
                class="sub-header-button"
              >
                <span class="sub-header-title">
                  <ChevronIcon :class="['chevron', { 'is-expanded': expandOverdueTasks }]" />
                  <span class="dot danger-dot" />
                  <span>{{ workspaceMessage('workspace.todo.section.overdue') }}</span>
                </span>
                <span class="sub-header-count">{{ overdueTasks.length }}</span>
              </button>

              <div v-if="expandOverdueTasks" class="todo-list">
                <TodoItem
                  v-for="todo in overdueTasks"
                  :key="todo.id"
                  :todo="todo"
                  @toggle-complete="handleToggleComplete"
                  @delete="handleDelete"
                />
              </div>
            </div>

            <!-- Future Tasks Section -->
            <div v-if="futureTasks.length > 0" class="sub-tasks-section future-tasks-section">
              <button
                @click="expandFutureTasks = !expandFutureTasks"
                class="sub-header-button"
              >
                <span class="sub-header-title">
                  <ChevronIcon :class="['chevron', { 'is-expanded': expandFutureTasks }]" />
                  <span class="dot muted-dot" />
                  <span>{{ workspaceMessage('workspace.todo.section.future') }}</span>
                </span>
                <span class="sub-header-count">{{ futureTasks.length }}</span>
              </button>

              <div v-if="expandFutureTasks" class="todo-list">
                <TodoItem
                  v-for="todo in futureTasks"
                  :key="todo.id"
                  :todo="todo"
                  @toggle-complete="handleToggleComplete"
                  @delete="handleDelete"
                />
              </div>
            </div>

            <div v-if="todayTasks.length === 0 && futureTasks.length === 0" class="no-tasks-placeholder">
              {{ workspaceMessage('workspace.todo.empty') }}
            </div>
          </template>
          <div v-else class="no-tasks-placeholder">
            {{ workspaceMessage('workspace.todo.empty') }}
          </div>
        </div>

        <!-- Todo Section -->
        <SectionHeader
          :title="workspaceMessage('workspace.todo.section.todo')"
          :count="todoTasks.length"
          :is-expanded="expandedSections.todo"
          @toggle="toggleSection('todo')"
          color="text-primary"
        />
        <div v-if="expandedSections.todo" class="section-content">
          <template v-if="todoTasks.length > 0">
            <div class="todo-list">
              <TodoItem
                v-for="todo in todoTasks"
                :key="todo.id"
                :todo="todo"
                @toggle-complete="handleToggleComplete"
                @delete="handleDelete"
              />
            </div>
          </template>
          <div v-else class="no-tasks-placeholder">
            {{ workspaceMessage('workspace.todo.empty') }}
          </div>
        </div>

        <!-- Completed Section -->
        <SectionHeader
          :title="workspaceMessage('workspace.todo.section.completed')"
          :count="completedTasks.length"
          :is-expanded="expandedSections.completed"
          @toggle="toggleSection('completed')"
          color="text-success"
        />
        <div v-if="expandedSections.completed" class="section-content">
          <template v-if="completedTasks.length > 0">
            <div class="todo-list">
              <TodoItem
                v-for="todo in completedTasks"
                :key="todo.id"
                :todo="todo"
                @toggle-complete="handleToggleComplete"
                @delete="handleDelete"
                is-completed
              />
            </div>
          </template>
          <div v-else class="no-tasks-placeholder">
            {{ workspaceMessage('workspace.todo.empty') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useTodoStore } from '../store/todoStore';
import type { Todo } from '../types';
import TodoItem from './TodoItem.vue';
import CreateTodoCard from './CreateTodoCard.vue';
import SectionHeader from './SectionHeader.vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { useWorkspaceLocalization } from '../../../ui/useWorkspaceLocalization';

const props = defineProps<{
  isActive?: boolean;
}>();

const projectsStore = useWorkspaceProjectsStore();
const { activeProjectId } = storeToRefs(projectsStore);
const { workspaceMessage } = useWorkspaceLocalization();
 
 const todoStore = useTodoStore();
 
onMounted(() => {
  // 首次挂载时，如果当前视图是激活的，加载一次数据
  if (props.isActive && activeProjectId.value) {
    console.log('[TodoSidebar] Mounted and active, fetching initial todos for project:', activeProjectId.value);
    todoStore.fetchTodos(activeProjectId.value);
  }
  // 注册监听器以接收实时更新
  todoStore.listenForChanges();
});

// 当项目切换时，自动加载新项目的待办事项
watch(activeProjectId, (newProjectId, oldProjectId) => {
  if (newProjectId && newProjectId !== oldProjectId) {
    console.log(`[TodoSidebar] Project changed to ${newProjectId}, fetching todos.`);
    todoStore.fetchTodos(newProjectId);
  }
});

const {
  todayTasks,
  futureTasks,
  overdueTasks,
  todoTasks,
  completedTasks,
  allScheduledTasks,
} = storeToRefs(todoStore);

// 日程计数：仅统计“未完成”的日程任务，且与三个子分组展示保持一致
const scheduledCount = computed(() => (
  todayTasks.value.length +
  overdueTasks.value.length +
  futureTasks.value.length
));

const showCreateCard = ref(false);

const toggleCreateCard = () => {
  showCreateCard.value = !showCreateCard.value;
};

defineExpose({
  toggleCreateCard,
});

const expandedSections = reactive({
  scheduled: true,
  todo: true,
  completed: false,
});
const expandFutureTasks = ref(false);
const expandOverdueTasks = ref(true); // Default to expanded

const toggleSection = (section: keyof typeof expandedSections) => {
  expandedSections[section] = !expandedSections[section];
};

const handleAddTodo = (todo: Omit<Todo, 'id'>) => {
  if (activeProjectId.value) {
    todoStore.addTodo(activeProjectId.value, todo);
  } else {
    console.error("No project selected, cannot add todo.");
  }
  showCreateCard.value = false;
};

const handleToggleComplete = (id: string) => {
  todoStore.toggleComplete(id);
};

const handleDelete = (id: string) => {
  todoStore.deleteTodo(id);
};
</script>
