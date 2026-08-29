import type { ActivationOperationPhase } from '../domain/activation-operation';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

export const ROLE_COLOR_NAMES = { success: 'green', degraded: 'yellow', attention: 'yellow', failure: 'red' } as const;
export function shouldColor(): boolean { return process.env.NO_COLOR === undefined && process.stdout.isTTY === true; }
function wrap(code: string, text: string): string { return shouldColor() ? `${code}${text}${RESET}` : text; }
export function success(text: string): string { return wrap(GREEN, text); }
export function degraded(text: string): string { return wrap(YELLOW, text); }
export function attention(text: string): string { return wrap(YELLOW, text); }
export function failure(text: string): string { return wrap(RED, text); }
export function dim(text: string): string { return wrap(DIM, text); }
export function colorForPhase(phase: ActivationOperationPhase, text: string): string {
  if (phase === 'succeeded') return success(text);
  if (phase === 'degraded') return degraded(text);
  if (phase === 'failed') return failure(text);
  if (phase === 'cancelled' || phase === 'requires-restart') return attention(text);
  return text;
}
