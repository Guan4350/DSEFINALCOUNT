const PREFIX = '[focus-tree]';

export function logInfo(event: string, meta?: unknown): void {
  console.info(PREFIX, event, meta ?? '');
}

export function logError(event: string, error: unknown, meta?: unknown): void {
  console.error(PREFIX, event, error, meta ?? '');
}
