<!-- apps/renderer/domains/workspace/ui/sidebar/project-list/ProjectListView.vue -->
<template>
  <div class="project-list-view">
    <div v-if="projects.length === 0" class="empty-state">
      <svg class="empty-icon" viewBox="0 0 24 24">
        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 9h-2v4H9v-4H7V9h2V5h2v4h2v2zm5 7H6V4h7v5h5v9z"/>
      </svg>
      <p>{{ workspaceMessage('workspace.sidebar.project.empty') }}</p>
      <button @click="$emit('create-project')" class="empty-action-button">
        {{ workspaceMessage('workspace.sidebar.project.createFirst') }}
      </button>
    </div>

    <div v-else class="project-list">
      <div 
        v-for="project in projects" 
        :key="project.id" 
        class="project-item" 
        @click="handleProjectClick(project.id)"
        @mouseenter="hoveredProjectId = project.id"
        @mouseleave="handleProjectMouseLeave(project.id)"
      >
        <div class="project-icon">
          <FolderIcon />
        </div>
        <span class="project-name">{{ project.name }}</span>
        
        <!-- 更多菜单按钮 -->
        <div class="project-actions">
          <button 
            v-show="hoveredProjectId === project.id || activeMenuProjectId === project.id"
            :ref="el => setMoreButtonRef(project.id, el)"
            class="more-button"
            :title="workspaceMessage('workspace.sidebar.project.moreOptions')"
            @click.stop="toggleMenu(project.id, $event)"
          >
            <MoreIcon direction="horizontal" />
          </button>
        </div>
      </div>
    </div>
    
    <!-- 下拉菜单 Teleport -->
    <Teleport to="body">
      <transition name="workspace-project-list-menu-fade">
        <div 
          v-if="activeMenuProjectId"
          ref="dropdownRef"
          class="project-menu-wrapper"
          :style="dropdownStyle"
        >
          <CustomSelect
            :model-value="null"
            :options="menuOptions"
            :manual-mode="true"
            :parent-is-open="Boolean(activeMenuProjectId)"
            semantic-role="menu"
            variant="minimal"
            :bordered="false"
            :external-trigger-ref="moreButtonRefs[activeMenuProjectId]"
            @update:model-value="handleMenuSelect"
            @close="closeMenu"
          />
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { FolderIcon } from '@linnya/renderer-ui/icons';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
import { useFixedDropdownPosition } from '../composables/useFixedDropdownPosition';
import { buildProjectMenuOptions, isProjectDeleteDisabled } from '../functions/projectMenuModel';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';

const props = defineProps({
  projects: {
    type: Array,
    required: true,
  },
});

const emit = defineEmits(['select-project', 'create-project', 'overview-project', 'edit-project', 'delete-project']);

// 鼠标悬浮的项目 ID
const hoveredProjectId = ref(null);

// 当前打开菜单的项目 ID
const activeMenuProjectId = ref(null);
const { workspaceMessage } = useWorkspaceLocalization();

// 更多按钮引用映射
const moreButtonRefs = ref({});
const {
  dropdownRef,
  dropdownStyle,
  positionDropdownAfterRender,
} = useFixedDropdownPosition();

const activeMenuProject = computed(() => {
  if (!activeMenuProjectId.value) return null;
  return props.projects.find(project => project.id === activeMenuProjectId.value) || null;
});

// 菜单选项
const menuOptions = computed(() => buildProjectMenuOptions(activeMenuProject.value, workspaceMessage));

// 设置更多按钮引用
const setMoreButtonRef = (projectId, el) => {
  if (el) {
    moreButtonRefs.value[projectId] = el;
  }
};

// 处理项目点击
const handleProjectClick = (projectId) => {
  // 如果菜单打开，不触发选择
  if (activeMenuProjectId.value) {
    return;
  }
  emit('select-project', projectId);
};

// 处理鼠标离开项目
const handleProjectMouseLeave = (projectId) => {
  // 如果菜单打开，不改变 hover 状态
  if (activeMenuProjectId.value === projectId) {
    return;
  }
  hoveredProjectId.value = null;
};

// 切换菜单
const toggleMenu = (projectId, event) => {
  event.stopPropagation();
  
  if (activeMenuProjectId.value === projectId) {
    closeMenu();
  } else {
    activeMenuProjectId.value = projectId;
    void positionDropdownAfterRender(moreButtonRefs.value[projectId]);
  }
};

// 关闭菜单
const closeMenu = () => {
  activeMenuProjectId.value = null;
};

// 处理菜单选择
const handleMenuSelect = (value) => {
  const projectId = activeMenuProjectId.value;
  const project = props.projects.find(p => p.id === projectId);
  
  if (value === 'overview' && project) {
    emit('overview-project', project.id);
  } else if (value === 'edit' && project) {
    emit('edit-project', project);
  } else if (value === 'delete' && project) {
    if (isProjectDeleteDisabled(project)) {
      closeMenu();
      return;
    }
    emit('delete-project', project.id);
  }
  
  closeMenu();
};

// 点击外部关闭菜单
const handleClickOutside = (event) => {
  if (!activeMenuProjectId.value) return;
  
  const buttonEl = moreButtonRefs.value[activeMenuProjectId.value];
  const menuEl = dropdownRef.value;
  
  if (buttonEl && buttonEl.contains(event.target)) return;
  if (menuEl && menuEl.contains(event.target)) return;
  
  closeMenu();
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>
