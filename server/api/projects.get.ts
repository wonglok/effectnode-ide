import { defineEventHandler } from 'h3';
import type { ProjectListResponse } from '../../shared/types';
import { listProjects } from '../utils/projects';

export default defineEventHandler(async (): Promise<ProjectListResponse> => {
  const projects = await listProjects();
  return { projects };
});
