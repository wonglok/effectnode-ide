/**
 * Diagnostic: prove the DeepSeek Harness SDK can boot the `sdk` profile, answer
 * a turn, and write a file inside its workspace.
 *
 *   DEEPSEEK_API_KEY=... node scripts/harness-smoke.mjs
 *
 * Uses a throwaway workspace under the OS temp dir so nothing in the project
 * is touched by the agent.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';

const provider = process.env.DSH_PROVIDER || 'deepseek-official';
const model = process.env.DSH_MODEL || process.env.AGENT_MODEL || 'deepseek-v4-flash';
const reasoningEffort = process.env.DSH_REASONING_EFFORT ?? 'max';
const maxTokens = Number(process.env.DSH_MAX_TOKENS ?? 49_152);

const workspace = await mkdtemp(join(tmpdir(), 'dsh-smoke-'));
console.log(JSON.stringify({ workspace, provider, model, reasoningEffort, maxTokens }));

const harness = new DeepSeekHarness({
  profile: 'sdk',
  patches: ['./automation.cordis.yml'],
  provider,
  model,
  ...(reasoningEffort ? { reasoningEffort: ReasoningEffortId(reasoningEffort) } : {}),
  ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {}),
  cwd: workspace,
  dshHome: join(workspace, '.dsh-home'),
  initializeTimeoutMs: 60_000,
});

try {
  const shared = { sessionId: undefined };
  const first = await harness.run('say hi', {
    onNotification: (notification) => {
      process.stderr.write(`[notify] ${notification.method}\n`);
    },
  });
  shared.sessionId = first.sessionId;
  console.log('--- first finalResponse ---');
  console.log(first.finalResponse);
  console.log('--- stats ---');
  console.log(
    JSON.stringify({
      sessionId: first.sessionId,
      events: first.events.length,
      notifications: first.notifications.length,
      methods: [...new Set(first.notifications.map((item) => item.method))],
    })
  );

  const second = await harness.run(
    'Create a file named hello.txt in the current working directory containing exactly: harness-ok',
    { sessionId: shared.sessionId }
  );
  console.log('--- second finalResponse ---');
  console.log(second.finalResponse);

  const written = await readFile(join(workspace, 'hello.txt'), 'utf8').catch(() => null);
  console.log('--- file write ---');
  console.log(written === null ? 'hello.txt was NOT created' : JSON.stringify(written));
} finally {
  await harness.close();
  await rm(workspace, { recursive: true, force: true });
}
