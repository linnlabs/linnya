import { describe, expect, it } from 'vitest';
import {
  analyzeMigratedHeaderOnlyToolConfig,
  analyzeMigratedToolCard,
  compareToolPresentationMigrationBaseline,
  parseToolPresentationMigrationBaseline,
  runConversationToolPresentationMigrationGuard,
  runHeaderOnlyToolPresentationBaselineRatchet,
  runToolPresentationMigrationBaselineRatchet,
} from '../guards/conversation-tool-presentation-migration-guard';

describe('conversation tool presentation migration guard', () => {
  it('当前已迁移卡片保持 presentation-only', () => {
    expect(runConversationToolPresentationMigrationGuard()).toEqual([]);
    expect(runToolPresentationMigrationBaselineRatchet()).toEqual({ removed: [], added: [] });
    expect(runHeaderOnlyToolPresentationBaselineRatchet()).toEqual({ removed: [], added: [] });
  });

  it('未同步 baseline 时应识别迁移清单中的删除', () => {
    expect(compareToolPresentationMigrationBaseline(
      ['TaskStateCard.vue', 'NewCard.vue'],
      ['TaskStateCard.vue', 'AgentTodoCard.vue'],
    )).toEqual({
      removed: ['AgentTodoCard.vue'],
      added: ['NewCard.vue'],
    });
  });

  it('拒绝 baseline 中的重复路径', () => {
    expect(() => parseToolPresentationMigrationBaseline('Card.vue\nCard.vue\n'))
      .toThrow('presentation baseline 存在重复路径');
  });

  it('允许只读取 presentation 的薄卡片', () => {
    const source = `<script setup lang="ts">
const props = defineProps<{ presentation: { data: unknown } }>();
const data = computed(() => props.presentation.data);
</script>`;
    expect(analyzeMigratedToolCard('Card.vue', source)).toEqual([]);
  });

  it('拦截 raw props 的声明与读取', () => {
    const source = `<script setup lang="ts">
const props = defineProps<{ presentation: unknown; args: unknown; result: unknown }>();
void props.args;
void props.result;
</script>`;
    expect(analyzeMigratedToolCard('Card.vue', source).map(item => item.rule)).toEqual([
      'raw-prop-declaration',
      'raw-prop-declaration',
      'raw-prop-read',
      'raw-prop-read',
    ]);
  });

  it('拦截组件内 schema parse、safeParse 与 throw', () => {
    const source = `<script setup lang="ts">
defineProps<{ presentation: unknown }>();
Schema.parse(value);
Schema.safeParse(value);
throw new Error('invalid');
</script>`;
    expect(analyzeMigratedToolCard('Card.vue', source).map(item => item.rule)).toEqual([
      'schema-parse',
      'schema-parse',
      'throw',
    ]);
  });

  it('header-only 注册项必须使用 projector 且不得恢复 raw title resolver', () => {
    const valid = `export const configs = {
      grep: { component: Noop, presentation: projectGrep, layout: { hideContent: true } },
    };`;
    expect(analyzeMigratedHeaderOnlyToolConfig({
      file: 'configs.ts',
      exportName: 'configs',
      toolName: 'grep',
    }, valid)).toEqual([]);

    const invalid = `export const configs = {
      grep: { component: Noop, title: (args) => String(args.pattern) },
    };`;
    expect(analyzeMigratedHeaderOnlyToolConfig({
      file: 'configs.ts',
      exportName: 'configs',
      toolName: 'grep',
    }, invalid).map(item => item.rule)).toEqual([
      'missing-presentation-config',
      'legacy-title-config',
    ]);
  });
});
