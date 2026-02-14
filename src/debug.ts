/**
 * Debug and verbose logging utilities.
 *
 * --debug: Granular internal logging for debugging algorithm behavior
 * --verbose: High-level timing info for performance analysis
 */

/**
 * Check if debug mode is enabled (granular internals).
 */
export function isDebugEnabled(): boolean {
  return !!(globalThis as Record<string, unknown>).__MD_DIFF_DEBUG__;
}

/**
 * Check if verbose mode is enabled (high-level timing).
 */
export function isVerboseEnabled(): boolean {
  return !!(globalThis as Record<string, unknown>).__MD_DIFF_VERBOSE__;
}

/**
 * Create a debug logger with an optional module prefix.
 * For granular internal logging.
 */
export function createDebugLogger(prefix?: string) {
  const tag = prefix ? `[${prefix}]` : "[debug]";
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
 * Format duration in milliseconds to a readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Log a verbose message (only in verbose mode).
 */
export function verbose(message: string): void {
  if (isVerboseEnabled()) {
    console.log(message);
  }
}

/**
 * Time a synchronous function and log in verbose mode.
 */
export function timeSync<T>(label: string, fn: () => T): T {
  if (!isVerboseEnabled()) {
    return fn();
  }

  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  console.log(`  ${label}: ${formatDuration(elapsed)}`);
  return result;
}

/**
 * Time an async function and log in verbose mode.
 */
export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!isVerboseEnabled()) {
    return fn();
  }

  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  console.log(`  ${label}: ${formatDuration(elapsed)}`);
  return result;
}

/**
 * Create a scoped timer for measuring a file or operation.
 */
export function createTimer(name: string) {
  const overallStart = performance.now();

  if (isVerboseEnabled()) {
    console.log(`Processing: ${name}`);
  }

  return {
    time<T>(label: string, fn: () => T): T {
      return timeSync(label, fn);
    },

    async timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
      return timeAsync(label, fn);
    },

    done(): void {
      if (isVerboseEnabled()) {
        const elapsed = performance.now() - overallStart;
        console.log(`  Total: ${formatDuration(elapsed)}\n`);
      }
    },
  };
}
