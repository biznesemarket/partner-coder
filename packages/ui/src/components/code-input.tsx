"use client";

import { useRef } from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react";

import { cn } from "../lib/cn";
import { normalizeOtp } from "../lib/code";

const CODE_LENGTH = 6;

type CodeInputProps = {
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
  const digits = normalizeOtp(value);
  const chars = Array.from({ length: CODE_LENGTH }, (_, index) => digits[index] ?? "");

  function focusAt(index: number): void {
    const next = Math.min(Math.max(index, 0), CODE_LENGTH - 1);
    const input = inputsRef.current[next];

    input?.focus();
    input?.select();
  }

  function apply(nextChars: Array<string>, focusIndex: number): void {
    onChange(normalizeOtp(nextChars.join("")));
    focusAt(focusIndex);
  }

  function handleChange(index: number, event: ChangeEvent<HTMLInputElement>): void {
    const incoming = normalizeOtp(event.target.value);
    const nextChars = [...chars];

    if (incoming.length === 0) {
      nextChars[index] = "";
      onChange(normalizeOtp(nextChars.join("")));
      return;
    }

    if (incoming.length > 1) {
      const available = Math.min(incoming.length, CODE_LENGTH - index);

      for (let offset = 0; offset < available; offset += 1) {
        nextChars[index + offset] = incoming[offset] ?? "";
      }

      apply(nextChars, index + available);
      return;
    }

    nextChars[index] = incoming;
    apply(nextChars, index + 1);
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>): void {
    const pasted = normalizeOtp(event.clipboardData.getData("text"));

    if (pasted.length === 0) {
      return;
    }

    event.preventDefault();

    const nextChars = [...chars];
    const available = Math.min(pasted.length, CODE_LENGTH - index);

    for (let offset = 0; offset < available; offset += 1) {
      nextChars[index + offset] = pasted[offset] ?? "";
    }

    apply(nextChars, index + available);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Backspace") {
      event.preventDefault();

      const nextChars = [...chars];

      if (nextChars[index]) {
        nextChars[index] = "";
        onChange(normalizeOtp(nextChars.join("")));
        return;
      }

      const previous = Math.max(index - 1, 0);
      nextChars[previous] = "";
      apply(nextChars, previous);
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();

      const nextChars = [...chars];
      nextChars[index] = "";
      onChange(normalizeOtp(nextChars.join("")));
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
      {chars.map((char, index) => (
        <input
          key={index}
          ref={(node) => {
            inputsRef.current[index] = node;
          }}
          id={id ? (index === 0 ? id : `${id}-${index + 1}`) : undefined}
          name={index === 0 ? name : undefined}
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
