import { createError, defineEventHandler, getRouterParam } from 'h3';
import type { ProjectSnapshot } from '../../../../shared/types';
import { getProject, ProjectValidationError } from '../../../utils/projects';

export default defineEventHandler(async (event): Promise<ProjectSnapshot> => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Missing project id' });
  }

  try {
    const project = await getProject(id);
    if (!project) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Project not found' });
    }
    return project;
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: error.message });
    }
    throw error;
  }
});
