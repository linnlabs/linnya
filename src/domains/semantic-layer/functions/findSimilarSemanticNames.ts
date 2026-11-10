import { semanticNameKey } from './normalizeSemanticName';

/** 比较时忽略空格、连字符、下划线与点：`to-do`、`to do`、`todo` 视为相近。 */
function compactKey(name: string): string {
  return semanticNameKey(name).replace(/[\s\-_.·]/g, '');
}

function editDistance(left: readonly string[], right: readonly string[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/**
 * 新建前找名称相近的已有定义，交给调用方提示复用（同类产品里 #task 与 #todo 并存的教训）。
 * 规则：去分隔符后相同；一方包含另一方（两字以上）；或编辑距离很小（短名 1、六字以上 2）。
 */
export function findSimilarSemanticNames<T extends { readonly name: string }>(
  candidate: string,
  existing: readonly T[]
): T[] {
  const key = compactKey(candidate);
  const keyChars = [...key];
  return existing.filter(item => {
    const other = compactKey(item.name);
    if (other === key) return true;
    const otherChars = [...other];
    const shorter = Math.min(keyChars.length, otherChars.length);
    if (shorter >= 2 && (other.includes(key) || key.includes(other))) return true;
    if (shorter < 3) return false;
    const allowed = Math.max(keyChars.length, otherChars.length) >= 6 ? 2 : 1;
    return editDistance(keyChars, otherChars) <= allowed;
  });
}
