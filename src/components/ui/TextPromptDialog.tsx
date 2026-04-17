import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput, UiModal } from './primitives';

interface TextPromptDialogProps {
  isOpen: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmText?: string;
  onClose: () => void;
  onConfirm: (value: string) => Promise<void> | void;
  widthClassName?: string;
}

export function TextPromptDialog({
  isOpen,
  title,
  label,
  placeholder,
  initialValue = '',
  confirmText,
  onClose,
  onConfirm,
  widthClassName = 'w-[440px]',
}: TextPromptDialogProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setValue(initialValue);
    setIsSubmitting(false);

    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialValue, isOpen]);

  const handleConfirm = async () => {
    const nextValue = value.trim();
    if (!nextValue || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(nextValue);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleConfirm();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <UiModal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      widthClassName={widthClassName}
      footer={
        <>
          <UiButton type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting || !value.trim()}
          >
            {confirmText || t('common.confirm')}
          </UiButton>
        </>
      }
    >
      <div className="space-y-2">
        {label ? <div className="text-sm font-medium text-text-dark">{label}</div> : null}
        <UiInput
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
      </div>
    </UiModal>
  );
}
