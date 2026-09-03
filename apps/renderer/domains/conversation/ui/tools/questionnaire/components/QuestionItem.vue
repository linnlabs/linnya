<template>
  <div class="ask-question-item question-item">
    <!-- 问题标题 -->
    <div class="question-header">
      <span class="question-number">{{ props.index + 1 }}.</span>
      <span class="question-text">{{ props.question.question }}</span>
      <span v-if="props.question.required" class="required-indicator">*</span>
    </div>

    <!-- 单选题 -->
    <div v-if="props.question.type === 'single'" class="question-content">
      <div class="radio-group">
        <div
          v-for="option in props.question.options"
          :key="option.id"
          class="radio-option"
          :class="{ 'selected': props.answers[props.question.id] === option.id, 'option-disabled': props.isCompleted }"
          @click="props.isCompleted ? null : props.updateSingleAnswer(props.question.id, option.id)"
        >
          <CustomRadio
            :model-value="props.answers[props.question.id] || ''"
            :value="option.id"
            :name="props.question.id"
            :disabled="props.isCompleted"
          >
            <div class="option-content">
              <span class="option-label">{{ option.label }}</span>
              <span v-if="option.description" class="option-description">
                {{ option.description }}
              </span>
            </div>
          </CustomRadio>
        </div>

        <!-- "其他"选项 -->
        <div
          v-if="props.question.allowOther"
          class="radio-option other-option"
          :class="{ 'selected': props.answers[props.question.id] === '__other__', 'option-disabled': props.isCompleted }"
          @click="props.isCompleted ? null : props.updateSingleAnswer(props.question.id, '__other__')"
        >
          <CustomRadio
            :model-value="props.answers[props.question.id] || ''"
            value="__other__"
            :name="props.question.id"
            :disabled="props.isCompleted"
          >
            <div class="option-content">
              <span class="option-label">{{ props.conversationMessage('conversation.tool.askQuestions.otherOption') }}</span>
              <input
                v-if="props.answers[props.question.id] === '__other__'"
                type="text"
                :value="props.otherAnswers[props.question.id] || ''"
                @input="(e) => props.updateOtherAnswer(props.question.id, (e.target as HTMLInputElement).value)"
                :placeholder="props.conversationMessage('conversation.tool.askQuestions.otherPlaceholder')"
                class="other-input"
                :class="{ 'selected-input': props.answers[props.question.id] === '__other__' }"
                :disabled="props.isCompleted"
                @click.stop
                @mousedown.stop
              />
            </div>
          </CustomRadio>
        </div>
      </div>

      <!-- 验证错误提示 -->
      <div v-if="props.validationErrors[props.question.id]" class="validation-error">
        {{ props.validationErrors[props.question.id] }}
      </div>
    </div>

    <!-- 多选题 -->
    <div v-else-if="props.question.type === 'multi'" class="question-content">
      <div class="checkbox-group">
        <div
          v-for="option in props.question.options"
          :key="option.id"
          class="checkbox-option"
          :class="{ 'selected': (props.multiAnswers[props.question.id] || []).includes(option.id), 'option-disabled': props.isCompleted }"
          @click="props.isCompleted ? null : onCheckboxRowClick($event, option.id)"
        >
          <CustomCheckbox
            :model-value="props.multiAnswers[props.question.id] || []"
            :value="option.id"
            :disabled="props.isCompleted"
            @update:modelValue="() => onCheckboxModelValueUpdate(option.id)"
          >
            <div class="option-content">
              <span class="option-label">{{ option.label }}</span>
              <span v-if="option.description" class="option-description">
                {{ option.description }}
              </span>
            </div>
          </CustomCheckbox>
        </div>

        <!-- "其他"选项 -->
        <div
          v-if="props.question.allowOther"
          class="checkbox-option other-option"
          :class="{ 'selected': (props.multiAnswers[props.question.id] || []).includes('__other__'), 'option-disabled': props.isCompleted }"
          @click="props.isCompleted ? null : onCheckboxRowClick($event, '__other__')"
        >
          <CustomCheckbox
            :model-value="props.multiAnswers[props.question.id] || []"
            value="__other__"
            :disabled="props.isCompleted"
            @update:modelValue="() => onCheckboxModelValueUpdate('__other__')"
          >
            <div class="option-content">
              <span class="option-label">{{ props.conversationMessage('conversation.tool.askQuestions.otherOption') }}</span>
              <input
                v-if="(props.multiAnswers[props.question.id] || []).includes('__other__')"
                type="text"
                :value="props.otherAnswers[props.question.id] || ''"
                @input="(e) => props.updateOtherAnswer(props.question.id, (e.target as HTMLInputElement).value)"
                :placeholder="props.conversationMessage('conversation.tool.askQuestions.otherPlaceholder')"
                class="other-input"
                :class="{ 'selected-input': (props.multiAnswers[props.question.id] || []).includes('__other__') }"
                :disabled="props.isCompleted"
                @click.stop
                @mousedown.stop
              />
            </div>
          </CustomCheckbox>
        </div>
      </div>

      <!-- 多选限制提示 -->
      <div v-if="props.question.maxSelect && props.multiAnswers[props.question.id]?.length > 0" class="multi-hint">
        {{ props.conversationMessage('conversation.tool.askQuestions.selectedCount', {
          count: props.multiAnswers[props.question.id].length,
        }) }}
        <span v-if="props.question.maxSelect > 1">
          {{ props.conversationMessage('conversation.tool.askQuestions.selectedMax', {
            count: props.question.maxSelect,
          }) }}
        </span>
      </div>

      <!-- 验证错误提示 -->
      <div v-if="props.validationErrors[props.question.id]" class="validation-error">
        {{ props.validationErrors[props.question.id] }}
      </div>
    </div>

    <!-- 文本输入题 -->
    <div v-else-if="props.question.type === 'text'" class="question-content">
      <textarea
        :value="props.textAnswers[props.question.id] || ''"
        @input="(e) => props.updateTextAnswer(props.question.id, (e.target as HTMLTextAreaElement).value)"
        :placeholder="props.conversationMessage('conversation.tool.askQuestions.textPlaceholder')"
        class="text-input"
        :class="{ 'input-disabled': props.isCompleted }"
        :disabled="props.isCompleted"
      ></textarea>

      <!-- 验证错误提示 -->
      <div v-if="props.validationErrors[props.question.id]" class="validation-error">
        {{ props.validationErrors[props.question.id] }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  Answers,
  MultiAnswers,
  OtherAnswers,
  Question,
  TextAnswers,
  ValidationErrors,
} from '../definitions/questionnaire';
import { CustomCheckbox, CustomRadio } from '@linnya/renderer-ui';
import type { ConversationMessageResolver } from '../../../../definitions/conversationMessages';

const props = defineProps<{
  question: Question;
  index: number;
  isCompleted: boolean;
  answers: Answers;
  multiAnswers: MultiAnswers;
  textAnswers: TextAnswers;
  otherAnswers: OtherAnswers;
  validationErrors: ValidationErrors;
  conversationMessage: ConversationMessageResolver;
  updateSingleAnswer: (questionId: string, value: string) => void;
  updateMultiAnswer: (question: Question, optionId: string) => void;
  updateTextAnswer: (questionId: string, value: string) => void;
  updateOtherAnswer: (questionId: string, value: string) => void;
}>();

/**
 * 多选交互说明：
 * - 用户既可能点击“整行空白”，也可能点击“复选框/文字”；
 * - 复选框内部会触发 input change，并 emit `update:modelValue`；
 * - 为避免同一次点击触发“两次 toggle”（表现为点了没反应），这里做了明确分流：
 *   - 点在 `.checkbox-item` 内：交给 change/update:modelValue；
 *   - 点在行容器空白：走行点击更新。
 */
const onCheckboxModelValueUpdate = (optionId: string) => {
  if (props.isCompleted) return;
  props.updateMultiAnswer(props.question, optionId);
};

const onCheckboxRowClick = (event: MouseEvent, optionId: string) => {
  if (props.isCompleted) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    props.updateMultiAnswer(props.question, optionId);
    return;
  }
  if (target.closest('.checkbox-item')) return;
  props.updateMultiAnswer(props.question, optionId);
};
</script>
