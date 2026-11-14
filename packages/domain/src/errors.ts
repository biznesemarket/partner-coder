/** Доменные ошибки расчета. Код маппится в HTTP-статус на уровне API. */
export type CalculatorErrorCode =
  | "manual_only_policy_not_supported"
  | "session_without_task_but_required"
  | "invalid_interval"
  | "policy_violation";

export class CalculatorError extends Error {
  constructor(
    readonly code: CalculatorErrorCode,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "CalculatorError";
  }
}

export const CALCULATOR_HTTP_STATUS: Readonly<Record<CalculatorErrorCode, number>> = {
  manual_only_policy_not_supported: 422,
  session_without_task_but_required: 422,
  invalid_interval: 400,
  policy_violation: 409,
};
