import { defineEventHandler } from 'h3';
import { authStatus } from '../../utils/auth';

export default defineEventHandler((event) => authStatus(event));
