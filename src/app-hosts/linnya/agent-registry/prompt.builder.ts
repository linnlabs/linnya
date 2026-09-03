/**
 * @file src/app-hosts/linnya/agent-registry/prompt.builder.ts
 *
 * @description
 * 提示词构建器（从 `agent-registry/prompts/builder.ts` 上移）。
 */

import type { PromptTemplate, TemplateVariables } from './prompt.types';

export function extractTemplateVariables(template: string): string[] {
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  const variables: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    variables.push(match[1]);
  }

  return [...new Set(variables)];
}

export function fillTemplate(template: string, variables: TemplateVariables = {}): string {
  let filledTemplate = template;
  const templateVars = extractTemplateVariables(template);

  for (const varName of templateVars) {
    const value = variables[varName];
    const regex = new RegExp(`\\{${varName}\\}`, 'g');
    filledTemplate = filledTemplate.replace(regex, value?.toString() || '');
  }

  if (process.env.NODE_ENV !== 'production') {
    const remainingVars = extractTemplateVariables(filledTemplate);
    if (remainingVars.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`Warning: Template still contains unfilled variables: ${remainingVars.join(', ')}`);
    }
  }

  return filledTemplate;
}

export function buildPrompt(template: PromptTemplate, variables: TemplateVariables = {}): string {
  return fillTemplate(template.content, variables);
}


