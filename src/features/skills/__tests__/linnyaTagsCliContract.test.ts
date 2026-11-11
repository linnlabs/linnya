import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parsePropsCommand,
  parseQueryCommand,
  parseSchemaCommand,
} from '../../../app-hosts/linnya/application/core-cli/functions/parseSemanticCommands';

/**
 * 内置 Skill `linnya-tags` 里的每条 `linnya schema / props / query` 示例都要被真实 CLI 解析器接受，
 * 避免 CLI 改了参数而 Skill 还在教旧写法。只解析参数，不碰数据库。
 */
const skill = readFileSync(
  fileURLToPath(new URL('../builtin/skills/linnya-tags/SKILL.md', import.meta.url)),
  'utf8',
);

/** 把一行命令拆成参数：去掉行尾注释，按空白分开（示例里不用引号）。 */
function argvOf(line: string): string[] {
  return line.replace(/\s+#.*$/u, '').trim().split(/\s+/u).slice(2);
}

/** 只取 bash 代码块里的命令：正文里的行内写法可能带占位符。 */
const commands = [...skill.matchAll(/```bash\n([\s\S]*?)```/gu)]
  .flatMap(block => block[1].split('\n'))
  .map(line => line.match(/^linnya (schema|props|query)\b.*/u))
  .filter((match): match is RegExpMatchArray => match !== null)
  .map(match => ({ line: match[0].trim(), command: match[1] }));

const PARSERS: Record<string, (argv: string[]) => unknown> = {
  schema: parseSchemaCommand,
  props: parsePropsCommand,
  query: parseQueryCommand,
};

describe('linnya-tags Skill 的 CLI 示例', () => {
  it('覆盖三类命令', () => {
    expect(new Set(commands.map(item => item.command))).toEqual(new Set(['schema', 'props', 'query']));
  });

  it.each(commands)('$line', ({ line, command }) => {
    expect(() => PARSERS[command](argvOf(line))).not.toThrow();
  });

  it('保存与建议的写法与 query 的参数一致', () => {
    expect(parseQueryCommand(['--tag', '论文', '--save', '待读论文', '--suggest'])).toMatchObject({
      save: { name: '待读论文', suggest: true },
    });
  });
});
