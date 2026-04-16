import {
  Component,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { RichTextEditor, type RichTextEditorProps } from './RichTextEditor';

function normalizePlainText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return '';
  }

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const document = parser.parseFromString(trimmed, 'text/html');
    return normalizePlainText(document.body.innerText || document.body.textContent || '');
  }

  const withLineBreaks = trimmed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<\/(p|div|section|article|blockquote|h[1-6]|li|ul|ol|pre)>/gi, '$&\n')
    .replace(/<(li)\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"');

  return normalizePlainText(withLineBreaks);
}

function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => (
      `<p>${paragraph
        .split('\n')
        .map((line) => line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;'))
        .join('<br />')}</p>`
    ))
    .join('');
}

type PlainTextSelectionRange = {
  from: number;
  to: number;
};

function PlainTextEditorRescue({
  content,
  onChange,
  onSelect,
  onContextMenu,
  pendingSelectionReplacement,
  onSelectionReplacementApplied,
  placeholder,
  className = '',
  readOnly = false,
  onRetry,
}: RichTextEditorProps & {
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSelectionRangeRef = useRef<PlainTextSelectionRange | null>(null);
  const lastAppliedReplacementIdRef = useRef<number | null>(null);
  const [value, setValue] = useState(() => stripHtmlToPlainText(content));

  useEffect(() => {
    setValue(stripHtmlToPlainText(content));
  }, [content]);

  const emitSelection = () => {
    const textarea = textareaRef.current;
    if (!textarea || !onSelect) {
      return;
    }

    const from = textarea.selectionStart ?? 0;
    const to = textarea.selectionEnd ?? 0;
    if (from === to) {
      lastSelectionRangeRef.current = null;
      onSelect({ text: '', range: null });
      return;
    }

    const nextRange = { from, to };
    lastSelectionRangeRef.current = nextRange;
    onSelect({ text: value.slice(from, to), range: nextRange });
  };

  const updateValue = (nextValue: string) => {
    setValue(nextValue);
    onChange(plainTextToHtml(nextValue));
  };

  useEffect(() => {
    if (!pendingSelectionReplacement) {
      return;
    }

    const { requestId, text, mode = 'replace' } = pendingSelectionReplacement;
    if (requestId === lastAppliedReplacementIdRef.current) {
      return;
    }

    lastAppliedReplacementIdRef.current = requestId;

    const textarea = textareaRef.current;
    const currentRange = pendingSelectionReplacement.range
      ?? lastSelectionRangeRef.current
      ?? (textarea
        ? {
            from: textarea.selectionStart ?? value.length,
            to: textarea.selectionEnd ?? value.length,
          }
        : null);

    let nextValue = value;
    let nextCursor = value.length;

    if (mode === 'insertBelow') {
      const insertAt = currentRange?.to ?? value.length;
      const prefix = value.slice(0, insertAt);
      const suffix = value.slice(insertAt);
      const separator = prefix.trim().length > 0 ? '\n\n' : '';
      nextValue = `${prefix}${separator}${text}${suffix}`;
      nextCursor = insertAt + separator.length + text.length;
    } else {
      const from = currentRange?.from ?? value.length;
      const to = currentRange?.to ?? from;
      nextValue = `${value.slice(0, from)}${text}${value.slice(to)}`;
      nextCursor = from + text.length;
    }

    updateValue(nextValue);
    lastSelectionRangeRef.current = null;
    onSelectionReplacementApplied?.();

    window.requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current;
      if (!nextTextarea) {
        return;
      }
      nextTextarea.focus();
      nextTextarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [onSelectionReplacementApplied, pendingSelectionReplacement, value]);

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="mb-2 flex items-start justify-between gap-3 border-b border-amber-500/20 pb-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-amber-300">
            {t('script.richTextEditor.loadFailedTitle')}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-text-muted">
            {t('script.richTextEditor.loadFailedDescription')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-border-dark px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
        >
          {t('common.retry')}
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => updateValue(event.target.value)}
        onSelect={emitSelection}
        onKeyUp={emitSelection}
        onMouseUp={emitSelection}
        onContextMenu={(event) => {
          if (!onContextMenu) {
            return;
          }
          event.preventDefault();
          onContextMenu({ clientX: event.clientX, clientY: event.clientY });
        }}
        className="ui-scrollbar min-h-0 flex-1 resize-none rounded-xl border border-border-dark bg-bg-dark/35 px-3 py-2 text-sm leading-6 text-text-dark outline-none transition-colors placeholder:text-text-muted/60 focus:border-accent/50"
        placeholder={placeholder}
        readOnly={readOnly}
      />
    </div>
  );
}

class RichTextEditorErrorBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
  resetKey: number;
}, {
  hasError: boolean;
}> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Failed to render RichTextEditor', error, errorInfo);
  }

  componentDidUpdate(prevProps: Readonly<{ resetKey: number }>) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

export function LazyRichTextEditor(props: RichTextEditorProps) {
  const [retryNonce, setRetryNonce] = useState(0);

  return (
    <RichTextEditorErrorBoundary
      resetKey={retryNonce}
      fallback={(
        <PlainTextEditorRescue
          {...props}
          onRetry={() => setRetryNonce((current) => current + 1)}
        />
      )}
    >
      <RichTextEditor key={retryNonce} {...props} />
    </RichTextEditorErrorBoundary>
  );
}
