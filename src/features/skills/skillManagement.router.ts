import { Router } from 'express';
import { SkillManagementRequestSchema, SkillManagementResultSchema } from '@app/schemas';
import { SkillManagementError, type SkillManagementPort } from './definitions/skillManagement';

/** Renderer 使用现有 App API 鉴权；CLI 仍走自己的控制桥鉴权。 */
export function createSkillManagementRouter(owner: SkillManagementPort): Router {
  const router = Router();
  router.post('/', (req, res) => {
    const parsed = SkillManagementRequestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ code: 'invalid_skill', message: 'Skill 请求格式无效' }); return; }
    try { res.json(SkillManagementResultSchema.parse(owner.execute(parsed.data))); }
    catch (error: unknown) {
      if (!(error instanceof SkillManagementError)) throw error;
      res.status(error.code === 'conflict' ? 409 : error.code === 'not_found' ? 404 : 400)
        .json({ code: error.code, message: error.message });
    }
  });
  return router;
}
