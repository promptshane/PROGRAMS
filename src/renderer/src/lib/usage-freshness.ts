export const isUsageSnapshotStale = (
  updatedAt: string | null | undefined,
  nowMs: number,
  staleMs: number,
): boolean => {
  if (!updatedAt) {
    return true;
  }

  const updatedMs = new Date(updatedAt).getTime();
  return !Number.isFinite(updatedMs) || nowMs - updatedMs >= staleMs;
};
