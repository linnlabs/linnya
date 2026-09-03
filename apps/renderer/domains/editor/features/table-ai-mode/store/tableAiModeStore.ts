import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type {
  SettleTableAiModeExecutionInput,
  StartTableAiModeSessionInput,
  TableAiModeActiveColumnReference,
  TableAiModeContext,
  TableAiModePhase,
  TableAiModeSession,
} from '../definitions/tableAiMode';
import { copyTableAiModeContext } from '../functions/copyTableAiModeContext';

const idleExecution = () => ({
  isLoading: false,
  isStreaming: false,
  error: null,
  controller: null,
  completedSuccessfully: false,
});

export const useTableAiModeStore = defineStore('tableAiMode', () => {
  const phase = ref<TableAiModePhase>('off');
  const session = shallowRef<TableAiModeSession | null>(null);

  const isActive = computed(() => phase.value === 'active');
  const isClosing = computed(() => phase.value === 'closing');
  const activeTable = computed(() => (
    phase.value === 'active' ? session.value?.table ?? null : null
  ));
  const activeContext = computed(() => (
    phase.value === 'active' ? session.value?.context ?? null : null
  ));
  const activeExecution = computed(() => (
    phase.value === 'active' ? session.value?.execution ?? null : null
  ));

  const startSession = (input: StartTableAiModeSessionInput): TableAiModeSession => {
    if (phase.value !== 'off') {
      throw new Error(`[TableAiMode] 当前 phase=${phase.value}，不能开始新会话`);
    }
    const sessionId = input.sessionId.trim();
    if (!sessionId) {
      throw new Error('[TableAiMode] sessionId 不能为空');
    }
    const nextSession: TableAiModeSession = {
      sessionId,
      table: { ...input.table },
      context: copyTableAiModeContext(input.context),
      execution: idleExecution(),
    };
    session.value = nextSession;
    phase.value = 'active';
    return nextSession;
  };

  const updateContext = (context: TableAiModeContext): boolean => {
    if (!session.value || phase.value !== 'active') return false;
    session.value = {
      ...session.value,
      context: copyTableAiModeContext(context),
    };
    return true;
  };

  const updateActiveColumnRefs = (
    activeColumnRefs: Readonly<Record<string, TableAiModeActiveColumnReference>>,
  ): boolean => {
    if (!session.value || phase.value !== 'active') return false;
    session.value = {
      ...session.value,
      context: copyTableAiModeContext({
        ...session.value.context,
        activeColumnRefs,
      }),
    };
    return true;
  };

  const beginClosing = (sessionId: string): boolean => {
    if (phase.value !== 'active' || session.value?.sessionId !== sessionId) return false;
    phase.value = 'closing';
    return true;
  };

  const completeClosing = (sessionId: string): boolean => {
    if (phase.value !== 'closing' || session.value?.sessionId !== sessionId) return false;
    session.value = null;
    phase.value = 'off';
    return true;
  };

  const beginExecution = (controller: AbortController): boolean => {
    if (!session.value || phase.value !== 'active') return false;
    session.value = {
      ...session.value,
      execution: {
        isLoading: true,
        isStreaming: true,
        error: null,
        controller,
        completedSuccessfully: false,
      },
    };
    return true;
  };

  const settleExecution = (input: SettleTableAiModeExecutionInput): boolean => {
    if (!session.value || session.value.execution.controller !== input.controller) return false;
    session.value = {
      ...session.value,
      execution: {
        isLoading: false,
        isStreaming: false,
        error: input.errorMessage,
        controller: null,
        completedSuccessfully: input.completedSuccessfully,
      },
    };
    return true;
  };

  const clearExecution = (): AbortController | null => {
    if (!session.value) return null;
    const controller = session.value.execution.controller;
    session.value = {
      ...session.value,
      execution: idleExecution(),
    };
    return controller;
  };

  return {
    phase,
    session,
    isActive,
    isClosing,
    activeTable,
    activeContext,
    activeExecution,
    startSession,
    updateContext,
    updateActiveColumnRefs,
    beginClosing,
    completeClosing,
    beginExecution,
    settleExecution,
    clearExecution,
  };
});
