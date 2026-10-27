import { create } from 'zustand';
import type { PreviewIssueLevel } from '@/lib/preview-errors';

export interface PreviewIssue {
  id: string;
  level: PreviewIssueLevel;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  at: number;
  /** How many times the same issue was observed. */
  count: number;
}

export interface PreviewIssueInput {
  level: PreviewIssueLevel;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
}

interface PreviewErrorsState {
  issues: PreviewIssue[];
  /** Diagnostics panel visibility; the launcher only shows when issues exist. */
  open: boolean;
  addIssue: (input: PreviewIssueInput) => void;
  clearIssues: () => void;
  setOpen: (open: boolean) => void;
}

const MAX_ISSUES = 100;
const MAX_MESSAGE = 2_000;
const MAX_STACK = 4_000;
const MAX_SOURCE = 500;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function issueId(): string {
  return `preview_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const usePreviewErrorsStore = create<PreviewErrorsState>((set) => ({
  issues: [],
  open: false,

  addIssue: (input) =>
    set((state) => {
      const message = clip(input.message.trim(), MAX_MESSAGE) || 'Unknown preview error';
      const stack = input.stack?.trim()
        ? clip(input.stack.trim(), MAX_STACK)
        : undefined;
      const source = input.source?.trim()
        ? clip(input.source.trim(), MAX_SOURCE)
        : undefined;
      const line = Number.isFinite(input.line) ? input.line : undefined;
      const column = Number.isFinite(input.column) ? input.column : undefined;

      const existing = state.issues.find(
        (issue) =>
          issue.level === input.level &&
          issue.message === message &&
          issue.source === source &&
          issue.line === line &&
          issue.column === column
      );

      if (existing) {
        return {
          issues: state.issues.map((issue) =>
            issue === existing
              ? { ...issue, count: issue.count + 1, at: Date.now() }
              : issue
          ),
        };
      }

      return {
        issues: [
          ...state.issues.slice(-(MAX_ISSUES - 1)),
          {
            id: issueId(),
            level: input.level,
            message,
            stack,
            source,
            line,
            column,
            at: Date.now(),
            count: 1,
          },
        ],
      };
    }),

  clearIssues: () => set({ issues: [], open: false }),

  setOpen: (open) => set({ open }),
}));
