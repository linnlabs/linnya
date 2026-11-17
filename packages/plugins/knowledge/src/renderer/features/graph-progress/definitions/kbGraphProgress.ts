export type KbGraphProgress = {
  kbId: string;
  percent: number;
  totalUnits: number;
  doneUnits: number;
  updatedAtSeconds: number | null;
};
