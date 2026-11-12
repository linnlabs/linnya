import { UnsupportedWorkflowExpression, type WorkflowConditionContext } from '../definitions/localCiPlan';

type Token =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'op'; readonly value: string };

type Value = string | number | boolean | null;

const OPERATORS = ['==', '!=', '&&', '||', '!', '(', ')'] as const;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === "'") {
      let value = '';
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (source[index] === "'") {
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (source[index] !== "'") throw new UnsupportedWorkflowExpression(source, '字符串没有闭合');
      tokens.push({ kind: 'string', value });
      index += 1;
      continue;
    }
    const operator = OPERATORS.find(candidate => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ kind: 'op', value: operator });
      index += operator.length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/u.exec(source.slice(index));
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][\w-]*(?:\.[\w-]+)*/u.exec(source.slice(index));
    if (!name) throw new UnsupportedWorkflowExpression(source, `无法识别的字符 ${char}`);
    tokens.push({ kind: 'name', value: name[0] });
    index += name[0].length;
  }
  return tokens;
}

/** 只覆盖仓库工作流实际用到的 GitHub 表达式子集；其余写法如实报告为本地无法判断。 */
function resolveName(name: string, context: WorkflowConditionContext, source: string): Value {
  if (name === 'true') return true;
  if (name === 'false') return false;
  if (name === 'null') return null;
  if (name === 'runner.os') return context.runnerOs;
  const matrix = /^matrix\.([\w-]+)$/u.exec(name);
  if (matrix) {
    const value = context.matrix[matrix[1]!];
    if (value === undefined) throw new UnsupportedWorkflowExpression(source, `矩阵没有 ${matrix[1]}`);
    return value;
  }
  const step = /^steps\.([\w-]+)\.(outcome|conclusion)$/u.exec(name);
  if (step) return context.stepOutcomes[step[1]!] ?? null;
  throw new UnsupportedWorkflowExpression(source, `本地无法提供 ${name}`);
}

function callFunction(name: string, context: WorkflowConditionContext, source: string): Value {
  switch (name) {
    case 'always':
      return true;
    case 'cancelled':
      return false;
    case 'success':
      return !context.jobFailed;
    case 'failure':
      return context.jobFailed;
    default:
      throw new UnsupportedWorkflowExpression(source, `本地不支持函数 ${name}()`);
  }
}

function truthy(value: Value): boolean {
  return value !== null && value !== false && value !== 0 && value !== '';
}

/** GitHub 表达式的 == 对字符串不区分大小写。 */
function looselyEqual(left: Value, right: Value): boolean {
  if (typeof left === 'string' && typeof right === 'string') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

export function evaluateWorkflowExpression(source: string, context: WorkflowConditionContext): Value {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const takeOperator = (value: string) => {
    const token = peek();
    if (token?.kind === 'op' && token.value === value) {
      position += 1;
      return true;
    }
    return false;
  };

  function primary(): Value {
    const token = tokens[position++];
    if (!token) throw new UnsupportedWorkflowExpression(source, '表达式不完整');
    if (token.kind === 'string' || token.kind === 'number') return token.value;
    if (token.kind === 'op' && token.value === '(') {
      const value = or();
      if (!takeOperator(')')) throw new UnsupportedWorkflowExpression(source, '括号没有闭合');
      return value;
    }
    if (token.kind === 'op' && token.value === '!') return !truthy(primary());
    if (token.kind === 'name') {
      if (takeOperator('(')) {
        if (!takeOperator(')')) throw new UnsupportedWorkflowExpression(source, `本地不支持带参数的 ${token.value}()`);
        return callFunction(token.value, context, source);
      }
      return resolveName(token.value, context, source);
    }
    throw new UnsupportedWorkflowExpression(source, `意外的 ${token.value}`);
  }

  function comparison(): Value {
    let left = primary();
    for (;;) {
      if (takeOperator('==')) left = looselyEqual(left, primary());
      else if (takeOperator('!=')) left = !looselyEqual(left, primary());
      else return left;
    }
  }

  function and(): Value {
    let left = comparison();
    while (takeOperator('&&')) {
      const right = comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  }

  function or(): Value {
    let left = and();
    while (takeOperator('||')) {
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  const value = or();
  if (position !== tokens.length) throw new UnsupportedWorkflowExpression(source, '表达式有多余内容');
  return value;
}

/** `if:` 可以写成 `${{ ... }}` 或裸表达式。 */
export function evaluateWorkflowCondition(condition: string, context: WorkflowConditionContext): boolean {
  const trimmed = condition.trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/u.exec(trimmed);
  return truthy(evaluateWorkflowExpression(wrapped ? wrapped[1]! : trimmed, context));
}

/** 把命令或环境变量里的 `${{ ... }}` 换成本地值；遇到本地无法提供的值时抛出。 */
export function substituteWorkflowExpressions(text: string, context: WorkflowConditionContext): string {
  return text.replace(/\$\{\{([\s\S]*?)\}\}/gu, (_match, expression: string) => {
    const value = evaluateWorkflowExpression(expression, context);
    return value === null ? '' : String(value);
  });
}
