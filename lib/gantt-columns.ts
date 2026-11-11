export type GanttColumnId = "name" | "start" | "finish" | "amount" | "payment" | "gate";

export interface GanttColumnLayout {
  name: number;
  date: number;
  amount: number;
  payment: number;
  gate: number;
  locked: number;
  hidden: GanttColumnId[];
}

const PHONE_MAX_WIDTH = 560;

export function columnLayout(width: number): GanttColumnLayout {
  if (width < PHONE_MAX_WIDTH) {
    return {
      name: 148,
      date: 0,
      amount: 0,
      payment: 0,
      gate: 0,
      locked: 148,
      hidden: ["start", "finish", "amount", "payment", "gate"],
    };
  }
  if (width >= 1350) {
    return {
      name: 220,
      date: 108,
      amount: 112,
      payment: 96,
      gate: 60,
      locked: 220 + 108 + 108 + 112 + 96 + 60,
      hidden: [],
    };
  }
  if (width >= 1050) {
    return {
      name: 210,
      date: 100,
      amount: 108,
      payment: 92,
      gate: 56,
      locked: 210 + 100 + 100 + 108 + 92 + 56,
      hidden: [],
    };
  }
  return {
    name: 204,
    date: 90,
    amount: 112,
    payment: 92,
    gate: 52,
    locked: 204 + 90 + 90 + 112 + 92 + 52,
    hidden: [],
  };
}
