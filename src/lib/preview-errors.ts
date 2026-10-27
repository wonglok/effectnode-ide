/** Levels emitted by the preview diagnostics bridge. */
export type PreviewIssueLevel =
  | 'error'
  | 'unhandledrejection'
  | 'console'
  | 'warn'
  | 'resource'
  | 'network';

export interface PreviewIssueLike {
  level: PreviewIssueLevel;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  count: number;
}

const MAX_PROMPT_CHARS = 16_000;

function formatLocation(issue: PreviewIssueLike): string {
  if (!issue.source) return '';
  const path = issue.source.replace(/^https?:\/\/[^/]+/i, '');
  const suffix = [
    issue.line ? String(issue.line) : '',
    issue.column ? String(issue.column) : '',
  ]
    .filter(Boolean)
    .join(':');
  return suffix ? `${path}:${suffix}` : path;
}

/**
 * Builds the prompt sent when someone presses “Fix with AI”. It includes every
 * captured issue (up to a safe size) so the agent can trace the root cause.
 */
export function buildPreviewFixPrompt(
  issues: PreviewIssueLike[],
  context: { projectName: string; previewUrl: string }
): string {
  const blocks: string[] = [];
  let used = 0;

  issues.forEach((issue, index) => {
    const location = formatLocation(issue);
    const stack = issue.stack
      ? issue.stack
          .split('\n')
          .slice(0, 8)
          .map((line) => `   ${line}`)
          .join('\n')
      : '';
    const block = [
      `${index + 1}. [${issue.level}] ${issue.message}${
        issue.count > 1 ? ` (repeated ${issue.count} times)` : ''
      }`,
      location ? `   at ${location}` : '',
      stack,
    ]
      .filter(Boolean)
      .join('\n');

    if (used + block.length > MAX_PROMPT_CHARS - 1_200) return;
    blocks.push(block);
    used += block.length;
  });

  const omitted = issues.length - blocks.length;
  const details = `Detected issues:\n${
    blocks.length > 0 ? blocks.join('\n\n') : '(no details captured)'
  }${
    omitted > 0
      ? `\n\n(${omitted} more issue${omitted === 1 ? '' : 's'} were truncated.)`
      : ''
  }`;

  return [
    'The live preview is reporting errors. Investigate the project source and fix the root cause.',
    `Project: ${context.projectName || 'untitled'}\nPreview: ${
      context.previewUrl || '/__virtual__/3000/'
    }`,
    details,
    'Fix the source rather than hiding the symptoms. If an asset is missing, either add it or make the code handle its absence. After editing, make sure the preview runs without errors.',
  ].join('\n\n');
}
