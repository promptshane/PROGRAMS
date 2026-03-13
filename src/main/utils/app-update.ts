export const emitSettledAppUpdateStatus = async <TStatus>({
  applySettlement,
  readStatus,
  emitStatus,
}: {
  applySettlement: () => void;
  readStatus: () => Promise<TStatus>;
  emitStatus: (status: TStatus) => void;
}): Promise<TStatus> => {
  applySettlement();
  const status = await readStatus();
  emitStatus(status);
  return status;
};
