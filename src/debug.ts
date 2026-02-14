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

/**
 * Format a timestamp as HH:MM:SS.mmm
 */
function formatTimestamp(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

/**
 * Format duration in milliseconds to a readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Time a synchronous function and log the result in debug mode.
 * @param label Label for the timing output
 * @param fn Function to time
 * @param prefix Optional prefix for the log (module name)
 */
export function timeSync<T>(label: string, fn: () => T, prefix?: string): T {
  if (!isDebugEnabled()) {
    return fn();
  }

  const tag = prefix ? `[DEBUG ${prefix}]` : "[DEBUG]";
  const start = performance.now();
  const startTime = new Date();

  try {
    const result = fn();
    const elapsed = performance.now() - start;
    console.log(`${tag} ${formatTimestamp(startTime)} ${label}: ${formatDuration(elapsed)}`);
    return result;
  } catch (err) {
    const elapsed = performance.now() - start;
    console.log(`${tag} ${formatTimestamp(startTime)} ${label}: FAILED after ${formatDuration(elapsed)}`);
    throw err;
  }
}

/**
 * Time an async function and log the result in debug mode.
 * @param label Label for the timing output
 * @param fn Async function to time
 * @param prefix Optional prefix for the log (module name)
 */
export async function timeAsync<T>(label: string, fn: () => Promise<T>, prefix?: string): Promise<T> {
  if (!isDebugEnabled()) {
    return fn();
  }

  const tag = prefix ? `[DEBUG ${prefix}]` : "[DEBUG]";
  const start = performance.now();
  const startTime = new Date();

  try {
    const result = await fn();
    const elapsed = performance.now() - start;
    console.log(`${tag} ${formatTimestamp(startTime)} ${label}: ${formatDuration(elapsed)}`);
    return result;
  } catch (err) {
    const elapsed = performance.now() - start;
    console.log(`${tag} ${formatTimestamp(startTime)} ${label}: FAILED after ${formatDuration(elapsed)}`);
    throw err;
  }
}

/**
 * Create a scoped timer for measuring multiple stages.
 * @param prefix Optional module prefix for all logs
 */
export function createTimer(prefix?: string) {
  const tag = prefix ? `[DEBUG ${prefix}]` : "[DEBUG]";
  const overallStart = performance.now();

  return {
    /**
     * Time a synchronous stage.
     */
    time<T>(label: string, fn: () => T): T {
      return timeSync(label, fn, prefix);
    },

    /**
     * Time an async stage.
     */
    async timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
      return timeAsync(label, fn, prefix);
    },

    /**
     * Log total elapsed time.
     */
    done(label = "Total"): void {
      if (isDebugEnabled()) {
        const elapsed = performance.now() - overallStart;
        console.log(`${tag} ${formatTimestamp(new Date())} ${label}: ${formatDuration(elapsed)}`);
      }
    },
  };
}
