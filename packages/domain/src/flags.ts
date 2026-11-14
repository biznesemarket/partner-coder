/** Флаги дня (R16). Флаг не отменяет начисление, кроме `replay`. */
export type DayFlagCode =
  | "no_output"
  | "synthetic_input"
  | "night_autonomous_spike"
  | "clock_skew"
  | "replay"
  | "no_task_link"
  | "cap_applied"
  | "autonomous_cap_applied"
  | "pending"
  | "late_rejected"
  | "late_arrival"
  | "manual_track_only";

export interface DayFlag {
  code: DayFlagCode;
  detail: string;
}

export const DAY_FLAG_TITLES: Readonly<Record<DayFlagCode, string>> = {
  no_output: "Оплачено много времени без результата в репозитории",
  synthetic_input: "Похоже на синтетический ввод",
  night_autonomous_spike: "Ночной автономный прогон агента",
  clock_skew: "Расхождение часов устройства",
  replay: "Повтор события или нарушение последовательности",
  no_task_link: "Сессия без привязки к задаче",
  cap_applied: "Применен дневной кап",
  autonomous_cap_applied: "Применен кап автономного класса",
  pending: "Пул исчерпан: доля не растет до переоценки",
  late_rejected: "Поздние события за пределами грейса",
  late_arrival: "События поступили после закрытия суток",
  manual_track_only: "Работа без агента: учтено, не оплачивается",
};

export function flag(code: DayFlagCode, detail: string): DayFlag {
  return { code, detail };
}
