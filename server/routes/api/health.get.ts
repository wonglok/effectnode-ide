import { defineEventHandler } from 'h3';
import type { HealthResponse } from '../../../shared/types';

export default defineEventHandler((): HealthResponse => ({
  ok: true,
  service: 'forge',
  version: '0.1.0',
  time: new Date().toISOString(),
}));
