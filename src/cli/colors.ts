/**
 * Terminal color utilities with NO_COLOR support.
 */

const isColorSupported = process.stdout.isTTY && !process.env["NO_COLOR"];

export const c = {
  reset: isColorSupported ? "\x1b[0m" : "",
  bold: isColorSupported ? "\x1b[1m" : "",
  dim: isColorSupported ? "\x1b[2m" : "",
  red: isColorSupported ? "\x1b[31m" : "",
  green: isColorSupported ? "\x1b[32m" : "",
  yellow: isColorSupported ? "\x1b[33m" : "",
  blue: isColorSupported ? "\x1b[34m" : "",
  cyan: isColorSupported ? "\x1b[36m" : "",
} as const;

export function logError(msg: string, hint?: string): void {
  console.error(`${c.red}Error:${c.reset} ${msg}`);
  if (hint) {
    console.error(`${c.dim}Hint: ${hint}${c.reset}`);
  }
}

export function logSuccess(msg: string): void {
  console.log(`${c.green}✓${c.reset} ${msg}`);
}

export function logInfo(msg: string): void {
  console.log(`${c.dim}${msg}${c.reset}`);
}
