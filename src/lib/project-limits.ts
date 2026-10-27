/** Hard cap for all project files (text + public binaries). */
export const MAX_PROJECT_BYTES = 50 * 1024 * 1024;

/** Hard cap for a single attachment. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Attachments above this size still upload, but the user is warned. */
export const ATTACHMENT_WARNING_BYTES = 10 * 1024 * 1024;

/**
 * Compressed ZIP envelope. It is slightly larger than the project cap to
 * leave room for archive metadata and files that do not compress.
 */
export const MAX_ARCHIVE_BYTES = MAX_PROJECT_BYTES + 8 * 1024 * 1024;
