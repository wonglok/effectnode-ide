import { createError, defineEventHandler, getRouterParam } from 'h3';
import type { DeleteResponse } from '../../../shared/types';
import { deleteProject, ProjectValidationError } from '../../utils/projects';

export default defineEventHandler(async (event): Promise<DeleteResponse> => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Missing project id' });
  }

  try {
    const deleted = await deleteProject(id);
    if (!deleted) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Project not found' });
    }
    return { ok: true, id };
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: error.message });
    }
    throw error;
  }
});
