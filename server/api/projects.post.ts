import { createError, defineEventHandler, readBody } from 'h3';
import type { ProjectMeta, SaveProjectPayload } from '../../shared/types';
import { ProjectValidationError, saveProject } from '../utils/projects';

export default defineEventHandler(async (event): Promise<ProjectMeta> => {
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
