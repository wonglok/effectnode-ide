/**
 * The Claude agent configuration lives in `shared/claude.ts` so the Nitro
 * proxy and the browser loop read the same model, effort, and compaction
 * settings.
 */
export { CLAUDE_AGENT, autoCompactCharBudget } from '../../shared/claude';
