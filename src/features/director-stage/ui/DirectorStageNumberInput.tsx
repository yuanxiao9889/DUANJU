import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { UiInput } from '@/components/ui';

type DirectorStageNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> & {
  value: number;
  onValueChange: (value: number) => void;
  formatValue?: (value: number) => string;
};

function defaultFormatValue(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

function parseDraftNumber(value: string): number | null {
  const trimmedValue = value.trim();
  if (
    trimmedValue.length === 0
    || trimmedValue === '-'
    || trimmedValue === '+'
    || trimmedValue === '.'
    || trimmedValue === '-.'
    || trimmedValue === '+.'
  ) {
    return null;
  }
  const numericValue = Number(trimmedValue);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function DirectorStageNumberInput({
  value,
  onValueChange,
  formatValue = defaultFormatValue,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}: DirectorStageNumberInputProps) {
  const [draftValue, setDraftValue] = useState(() => formatValue(value));
  const [isFocused, setIsFocused] = useState(false);
  const skipNextCommitRef = useRef(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(formatValue(value));
    }
  }, [formatValue, isFocused, value]);

  const commitDraftValue = () => {
    const numericValue = parseDraftNumber(draftValue);
    if (numericValue !== null) {
      onValueChange(numericValue);
    }
  };

  return (
    <UiInput
      {...props}
      type="number"
      value={draftValue}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextDraftValue = event.target.value;
        setDraftValue(nextDraftValue);
        const numericValue = parseDraftNumber(nextDraftValue);
        if (numericValue !== null) {
          onValueChange(numericValue);
        }
      }}
      onBlur={(event) => {
        if (skipNextCommitRef.current) {
          skipNextCommitRef.current = false;
        } else {
          commitDraftValue();
        }
        setIsFocused(false);
        onBlur?.(event);
      }}
      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          skipNextCommitRef.current = true;
          setDraftValue(formatValue(value));
          event.currentTarget.blur();
        }
        onKeyDown?.(event);
      }}
    />
  );
}
