"use client";

import { useRef } from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react";

import { cn } from "../lib/cn";
import {
  OTP_LENGTH,
  clearOtpSlot,
  normalizeOtp,
  otpSlots,
  otpSlotsToValue,
  setOtpSlots,
} from "../lib/code";

type CodeInputProps = {
  /**
   * Контролируемое значение из шести позиций. Пробел обозначает пустой слот
   * (`"12 456"`), хвостовые пустые слоты опускаются. Компактное значение
   * (`"123456"` или `"123"`) читается слева направо. Для отправки формы и
   * проверки кода используйте `normalizeOtp(value)`.
   */
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Шестизначный OTP-ввод с позиционными слотами. Удаление средней цифры
 * оставляет пустой слот на своём месте (`"123456"` → `"12 456"`), поэтому
 * последующие цифры не сдвигаются; компактное значение для отправки получается
 * через `normalizeOtp(value)` и скрытый input.
 */
function CodeInput({
  value,
  onChange,
  autoFocus = false,
  disabled = false,
  className,
  id,
  name,
  "aria-label": ariaLabel = "Код подтверждения",
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: CodeInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const slots = otpSlots(value);
  const compactValue = normalizeOtp(otpSlotsToValue(slots));

  function focusAt(index: number): void {
    const next = Math.min(Math.max(index, 0), OTP_LENGTH - 1);
    const input = inputsRef.current[next];

    input?.focus();
    input?.select();
  }

  function commit(nextSlots: Array<string>, focusIndex: number): void {
    onChange(otpSlotsToValue(nextSlots));
    focusAt(focusIndex);
  }

  function handleChange(index: number, event: ChangeEvent<HTMLInputElement>): void {
    const incoming = normalizeOtp(event.target.value);

    if (incoming.length === 0) {
      commit(clearOtpSlot(slots, index), index);
      return;
    }

    const available = Math.min(incoming.length, OTP_LENGTH - index);

    commit(setOtpSlots(slots, index, incoming), index + available);
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>): void {
    const pasted = normalizeOtp(event.clipboardData.getData("text"));

    if (pasted.length === 0) {
      return;
    }

    event.preventDefault();

    const available = Math.min(pasted.length, OTP_LENGTH - index);

    commit(setOtpSlots(slots, index, pasted), index + available);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Backspace") {
      event.preventDefault();

      if (slots[index]) {
        commit(clearOtpSlot(slots, index), index);
        return;
      }

      const previous = Math.max(index - 1, 0);

      commit(clearOtpSlot(slots, previous), previous);
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      commit(clearOtpSlot(slots, index), index);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAt(index - 1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAt(index + 1);
    }
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="code-input"
      className={cn("flex items-center gap-2", className)}
    >
      {name ? <input type="hidden" name={name} value={compactValue} /> : null}
      {slots.map((char, index) => (
        <input
          key={index}
          ref={(node) => {
            inputsRef.current[index] = node;
          }}
          id={id ? (index === 0 ? id : `${id}-${index + 1}`) : undefined}
          value={char}
          onChange={(event) => handleChange(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onFocus={(event) => event.currentTarget.select()}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={1}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          aria-label={`${ariaLabel}, цифра ${index + 1}`}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          data-slot="code-input-box"
          className="h-11 w-10 rounded-md border border-input bg-transparent text-center text-lg font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      ))}
    </div>
  );
}

CodeInput.displayName = "CodeInput";

export { CodeInput };
