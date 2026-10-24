import { createError, defineEventHandler, readBody } from 'h3';
import type { SaveProjectPayload } from '../../../shared/types';
import { authGuard } from '../../utils/auth';
import { ProjectValidationError, saveProject } from '../../utils/projects';

export default defineEventHandler(async (event) => {
  const denied = await authGuard(event);
  if (denied) return denied;

  const body = await readBody<SaveProjectPayload>(event);
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Missing project payload' });
  }

  try {
    return await saveProject(body);
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: error.message });
    }
    throw error;
  }
});
