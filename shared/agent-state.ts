/** Agent transcript file stored beside the project code. */
export const AGENT_STATE_FILENAME = 'agent-state.json';
export const AGENT_STATE_VERSION = 1;
/** Import/persist guard for a corrupted or hostile state file. */
export const AGENT_STATE_MAX_BYTES = 4 * 1024 * 1024;
