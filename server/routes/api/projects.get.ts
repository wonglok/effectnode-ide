import { defineEventHandler } from 'h3';
import { authGuard } from '../../utils/auth';
import { listProjects } from '../../utils/projects';

export default defineEventHandler(async (event) => {
  const denied = await authGuard(event);
  if (denied) return denied;

  const projects = await listProjects();
  return { projects };
});
