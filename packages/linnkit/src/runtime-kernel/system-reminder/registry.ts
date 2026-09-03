import { BUILTIN_SYSTEM_REMINDER_TEMPLATES } from './templates';
import { BUILTIN_SYSTEM_REMINDER_TRIGGERS } from './triggers';
import type {
  SystemReminderContentTemplate,
  SystemReminderRule,
  SystemReminderRuleDefinition,
  SystemReminderTriggerEvaluator,
} from './types';

export class SystemReminderRegistry {
  private readonly triggers = new Map<string, SystemReminderTriggerEvaluator>();
  private readonly templates = new Map<string, SystemReminderContentTemplate>();

  constructor(seed?: {
    triggers?: Record<string, SystemReminderTriggerEvaluator>;
    templates?: Record<string, SystemReminderContentTemplate>;
  }) {
    for (const [kind, evaluator] of Object.entries(seed?.triggers ?? {})) {
      this.registerTriggerKind(kind, evaluator);
    }
    for (const [name, template] of Object.entries(seed?.templates ?? {})) {
      this.registerContentTemplate(name, template);
    }
  }

  registerTriggerKind(kind: string, evaluator: SystemReminderTriggerEvaluator): void {
    const normalized = kind.trim();
    if (!normalized) {
      throw new Error('[SystemReminderRegistry] trigger kind 不能为空');
    }
    this.triggers.set(normalized, evaluator);
  }

  registerContentTemplate(name: string, template: SystemReminderContentTemplate): void {
    const normalized = name.trim();
    if (!normalized) {
      throw new Error('[SystemReminderRegistry] content template 不能为空');
    }
    this.templates.set(normalized, template);
  }

  buildRule(definition: SystemReminderRuleDefinition): SystemReminderRule | undefined {
    const trigger = this.triggers.get(definition.trigger.kind);
    const template = this.templates.get(definition.contentTemplate);
    if (!trigger || !template) {
      return undefined;
    }

    return {
      id: definition.id,
      when: (ctx) => trigger(ctx, definition.trigger),
      build: (ctx) => template(ctx, definition.contentArgs),
    };
  }
}

export function createDefaultSystemReminderRegistry(): SystemReminderRegistry {
  return new SystemReminderRegistry({
    triggers: BUILTIN_SYSTEM_REMINDER_TRIGGERS,
    templates: BUILTIN_SYSTEM_REMINDER_TEMPLATES,
  });
}

export const defaultSystemReminderRegistry = createDefaultSystemReminderRegistry();
