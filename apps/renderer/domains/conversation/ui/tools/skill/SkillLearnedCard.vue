<template>
  <!--
    SkillLearnedCard

    中文说明：
    - 该工具卡片用于 `skill` 工具与 skill 资源续读：只展示轻量提示，降低对话噪音；
    - 外层 ToolCallsMessage 会把本组件包在透明容器里（hideBorder/hideBackground/noPadding），
      因此这里需要自行提供灰底、圆角与上下间距。
  -->
  <div class="skill-learned-card">
    <span class="skill-learned-card__text">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { SkillPresentationData } from './definitions/skillPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<SkillPresentationData>;
}>();

const { conversationMessage } = useConversationLocalization();

const text = computed(() => {
  const data = props.presentation.data;
  const name = 'skillName' in data ? data.skillName : '';

  if (data.kind === 'resource') {
    if (props.presentation.status === 'loading') {
      return conversationMessage('conversation.tool.skill.loadingResourceNamed', { name });
    }
    return conversationMessage('conversation.tool.skill.resourceNamed', { name });
  }

  if (data.kind === 'lifecycle') {
    return conversationMessage('conversation.tool.skill.loading');
  }

  if (props.presentation.status === 'loading') {
    return conversationMessage('conversation.tool.skill.loadingNamed', { name });
  }

  // 约定：skill 的核心语义是“学会某个技能”，因此默认文案保持一致且单行。
  if (data.action === 'activate') {
    return conversationMessage('conversation.tool.skill.learnedNamed', { name });
  }
  if (data.action === 'list_resources') {
    return conversationMessage('conversation.tool.skill.viewedResourcesNamed', { name });
  }
  return conversationMessage('conversation.tool.skill.readResourceNamed', { name });
});
</script>
