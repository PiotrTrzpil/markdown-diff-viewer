/**
 * Shared debug logging utility.
 * Enable with --debug flag or by setting globalThis.__MD_DIFF_DEBUG__ = true
 */

/**
 * Check if debug mode is enabled.
 */
export function isDebugEnabled(): boolean {
  return !!(globalThis as Record<string, unknown>).__MD_DIFF_DEBUG__;
}

/**
 * Create a debug logger with an optional module prefix.
 * @param prefix Optional prefix to identify the module (e.g., "move-detection")
 */
export function createDebugLogger(prefix?: string) {
  const tag = prefix ? `[DEBUG ${prefix}]` : "[DEBUG]";
  return (...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.log(tag, ...args);
    }
  };
}

/**
 * Default debug logger without prefix.
 */
export const debug = createDebugLogger();
