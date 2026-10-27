import type { SkillManagementRequest } from '@app/schemas';
import { SkillManagementError } from '../definitions/skillManagement';
import { parseSkillFile } from '../frontmatter';

/** 只计算此次文件改动，冲突时保留磁盘原文；不引入文件修订身份。 */
export function computeSkillFileEdit(
  request: Extract<SkillManagementRequest, { action: 'write' | 'edit' }>,
  previous: string | null,
): string {
  let content: string;
  if (request.action === 'write') {
    if (previous !== request.expected_content) throw new SkillManagementError('conflict', '文件已改变，请重新读取后修改');
    content = request.content;
  } else {
    if (previous === null) throw new SkillManagementError('not_found', '要编辑的文件不存在');
    const index = previous.indexOf(request.old_string);
    if (index < 0 || previous.indexOf(request.old_string, index + request.old_string.length) >= 0) {
      throw new SkillManagementError('conflict', '原文必须恰好匹配一次，请重新读取文件');
    }
    content = previous.slice(0, index) + request.new_string + previous.slice(index + request.old_string.length);
  }
  if (Buffer.byteLength(content, 'utf8') > 512 * 1024) throw new SkillManagementError('invalid_skill', '文件不能超过 512 KiB');
  if (request.path === 'SKILL.md' && !parseSkillFile(content, 'SKILL.md', request.name)) {
    throw new SkillManagementError('invalid_skill', '修改后的 SKILL.md 格式无效');
  }
  return content;
}
