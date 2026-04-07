import { lazy, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { RichTextEditorProps } from './RichTextEditor';

const RichTextEditor = lazy(async () => {
  const module = await import('./RichTextEditor');
  return { default: module.RichTextEditor };
});

function stripHtmlToPlainText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return '';
  }

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const document = parser.parseFromString(trimmed, 'text/html');
    return (document.body.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return trimmed
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function RichTextEditorFallback({
  className = '',
  content,
}: Pick<RichTextEditorProps, 'className' | 'content'>) {
  const { t } = useTranslation();
  const previewText = useMemo(() => stripHtmlToPlainText(content), [content]);

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="mb-2 flex items-center justify-between border-b border-border-dark pb-2">
        <div className="h-4 w-10 animate-pulse rounded bg-white/8" />
        <span className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
          {t('common.loading')}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border-dark bg-bg-dark/35 px-3 py-2">
        {previewText ? (
          <div className="whitespace-pre-wrap text-sm leading-6 text-text-muted">
            {previewText}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="h-4 w-11/12 animate-pulse rounded bg-white/6" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-white/6" />
            <div className="h-4 w-3/5 animate-pulse rounded bg-white/6" />
          </div>
        )}
      </div>
    </div>
  );
}

export function LazyRichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={<RichTextEditorFallback className={props.className} content={props.content} />}
    >
      <RichTextEditor {...props} />
    </Suspense>
  );
}
