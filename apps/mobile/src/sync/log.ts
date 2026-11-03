// Development only: prints a sync failure to the Metro terminal, so a
// failure that only shows as "Couldn't sync, will try again" can be traced
// to its step (spec 006)
export function logSyncError(context: string, error: unknown) {
  if (!__DEV__) return;
  const described =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.log(`[sync] ${context}: ${described}`);
}
