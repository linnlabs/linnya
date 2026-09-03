import { z } from 'zod';

import {
  CommandRiskCategorySchema,
  type CommandRiskCategory,
} from '@app/schemas/commands';

import { COMMAND_AUTHORIZATION_MATCHER_REVISION } from './simpleCommand';

export const CommandRiskRuleMatcherSchema = z.enum([
  'delete_rm',
  'delete_find',
  'delete_git_clean',
  'delete_powershell',
  'delete_cmd',
  'move_macos',
  'move_powershell',
  'overwrite_copy_force',
  'upload_curl_file',
  'upload_remote_copy',
  'upload_git_push',
  'upload_git_push_force',
  'upload_powershell_web',
  'download_execute_remote',
  'download_execute_package_runner',
  'system_elevation',
  'system_power',
  'system_disk',
  'system_service',
]);
export type CommandRiskRuleMatcher = z.infer<typeof CommandRiskRuleMatcherSchema>;

const COMMAND_RISK_MATCHER_CATEGORIES: Readonly<
  Record<CommandRiskRuleMatcher, CommandRiskCategory>
> = {
  delete_rm: 'delete',
  delete_find: 'delete',
  delete_git_clean: 'delete',
  delete_powershell: 'delete',
  delete_cmd: 'delete',
  move_macos: 'move_overwrite_rename',
  move_powershell: 'move_overwrite_rename',
  overwrite_copy_force: 'move_overwrite_rename',
  upload_curl_file: 'external_upload',
  upload_remote_copy: 'external_upload',
  upload_git_push: 'external_upload',
  upload_git_push_force: 'external_upload',
  upload_powershell_web: 'external_upload',
  download_execute_remote: 'download_and_execute',
  download_execute_package_runner: 'download_and_execute',
  system_elevation: 'system_or_disk_impact',
  system_power: 'system_or_disk_impact',
  system_disk: 'system_or_disk_impact',
  system_service: 'system_or_disk_impact',
};

export const CommandRiskRuleSchema = z.object({
  id: z.string().regex(
    /^(macos|windows)\.(delete|move-overwrite-rename|external-upload|download-and-execute|system-or-disk-impact)\.[a-z0-9-]+$/u,
  ).max(128),
  platform: z.enum(['macos', 'windows']),
  category: CommandRiskCategorySchema,
  priority: z.number().int().min(1).max(999),
  matcher: CommandRiskRuleMatcherSchema,
}).strict();
export type CommandRiskRule = z.infer<typeof CommandRiskRuleSchema>;

export const CommandRiskRuleCatalogSchema = z.object({
  revision: z.literal(COMMAND_AUTHORIZATION_MATCHER_REVISION),
  platform: z.enum(['macos', 'windows']),
  shell_semantics_ids: z.array(z.string().min(1).max(128)).min(1),
  rules: z.array(CommandRiskRuleSchema).min(1),
}).strict().superRefine((catalog, context) => {
  const categoryIdSegments: Readonly<Record<CommandRiskCategory, string>> = {
    delete: 'delete',
    move_overwrite_rename: 'move-overwrite-rename',
    external_upload: 'external-upload',
    download_and_execute: 'download-and-execute',
    system_or_disk_impact: 'system-or-disk-impact',
  };
  const riskCategories: readonly CommandRiskCategory[] = [
    'delete',
    'move_overwrite_rename',
    'external_upload',
    'download_and_execute',
    'system_or_disk_impact',
  ];
  const macosOnlyMatchers = new Set<CommandRiskRuleMatcher>([
    'delete_rm', 'delete_find', 'move_macos',
  ]);
  const windowsOnlyMatchers = new Set<CommandRiskRuleMatcher>([
    'delete_powershell', 'delete_cmd', 'move_powershell', 'upload_powershell_web',
  ]);
  const supportedShellSemantics = catalog.platform === 'macos'
    ? new Set(['zsh'])
    : new Set(['powershell-5.1', 'powershell-7']);
  const ids = new Set<string>();
  const priorities = new Set<number>();
  const shellSemanticsIds = new Set<string>();
  const categories = new Set<CommandRiskCategory>();

  for (const [index, shellSemanticsId] of catalog.shell_semantics_ids.entries()) {
    if (!supportedShellSemantics.has(shellSemanticsId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shell_semantics_ids', index],
        message: 'risk catalog contains unsupported shell semantics',
      });
    }
    if (shellSemanticsIds.has(shellSemanticsId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shell_semantics_ids', index],
        message: 'shell semantics ids must be unique',
      });
    }
    shellSemanticsIds.add(shellSemanticsId);
  }

  for (const [index, rule] of catalog.rules.entries()) {
    if (rule.platform !== catalog.platform) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'platform'],
        message: 'a risk rule must belong to its catalog platform',
      });
    }
    if (!rule.id.startsWith(
      `${rule.platform}.${categoryIdSegments[rule.category]}.`,
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'id'],
        message: 'risk rule id must encode its platform and category',
      });
    }
    if (
      (catalog.platform === 'macos' && windowsOnlyMatchers.has(rule.matcher))
      || (catalog.platform === 'windows' && macosOnlyMatchers.has(rule.matcher))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'matcher'],
        message: 'risk matcher does not support its catalog platform',
      });
    }
    if (COMMAND_RISK_MATCHER_CATEGORIES[rule.matcher] !== rule.category) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'matcher'],
        message: 'risk matcher does not belong to the declared category',
      });
    }
    if (ids.has(rule.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'id'],
        message: 'risk rule ids must be unique',
      });
    }
    if (priorities.has(rule.priority)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'priority'],
        message: 'risk rule priorities must be unique',
      });
    }
    ids.add(rule.id);
    priorities.add(rule.priority);
    categories.add(rule.category);
  }

  for (const category of riskCategories) {
    if (!categories.has(category)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules'],
        message: `risk catalog must cover category: ${category}`,
      });
    }
  }
});
export type CommandRiskRuleCatalog = z.infer<typeof CommandRiskRuleCatalogSchema>;

export interface CommandRiskLexicalSegment {
  readonly tokens: readonly string[];
  readonly separatorBefore: 'start' | 'chain' | 'pipe' | 'substitution';
  readonly shellSemantics: 'zsh' | 'powershell' | 'cmd';
}

export interface CommandRiskLexicalScan {
  readonly command: string;
  readonly platform: 'macos' | 'windows';
  readonly segments: readonly CommandRiskLexicalSegment[];
}

export interface CommandRiskFinding {
  readonly ruleId: string;
  readonly category: CommandRiskCategory;
  readonly priority: number;
}

export type CommandRiskEvaluation =
  | {
      readonly status: 'matched';
      readonly findings: readonly CommandRiskFinding[];
    }
  | {
      readonly status: 'not_matched';
    }
  | {
      readonly status: 'unavailable';
      readonly code:
        | 'unsupported_risk_context'
        | 'risk_catalog_invalid'
        | 'risk_matcher_failed';
    };
