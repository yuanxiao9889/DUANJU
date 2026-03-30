import { useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic } from 'lucide-react';

type RichTextEditorProps = {
  content: string;
  onChange: (content: string) => void;
  onSelect?: (selection: { text: string; range: SelectionRange | null }) => void;
  onContextMenu?: (e: { clientX: number; clientY: number }) => void;
  pendingSelectionReplacement?: {
    requestId: number;
    text: string;
    range?: SelectionRange | null;
    mode?: 'replace' | 'insertBelow';
  } | null;
  onSelectionReplacementApplied?: () => void;
  placeholder?: string;
  className?: string;
};

type SelectionRange = {
  from: number;
  to: number;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToInlineHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br />');
}

function plainTextToBlockHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${plainTextToInlineHtml(paragraph)}</p>`)
    .join('');
}

export function RichTextEditor({
  content,
  onChange,
  onSelect,
  onContextMenu,
  pendingSelectionReplacement,
  onSelectionReplacementApplied,
  placeholder = '开始编写内容...',
  className = '',
}: RichTextEditorProps) {
  const lastSelectionRangeRef = useRef<SelectionRange | null>(null);
  const lastAppliedReplacementIdRef = useRef<number | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5],
        },
      }),
    ],
    content: content || '',
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-full p-2 text-sm leading-relaxed',
      },
      handleDOMEvents: {
        contextmenu: (_view, event) => {
          if (onContextMenu) {
            event.preventDefault();
            onContextMenu({ clientX: event.clientX, clientY: event.clientY });
            return true;
          }
          return false;
        },
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || '');
    }
  }, [content, editor]);

  useEffect(() => {
    if (!editor || !onSelect) return;

    const handleSelection = () => {
      const { from, to } = editor.state.selection;
      if (from !== to) {
        const nextRange = { from, to };
        lastSelectionRangeRef.current = nextRange;
        const text = editor.state.doc.textBetween(from, to);
        onSelect({ text, range: nextRange });
      } else {
        lastSelectionRangeRef.current = null;
        onSelect({ text: '', range: null });
      }
    };

    editor.on('selectionUpdate', handleSelection);
    return () => {
      editor.off('selectionUpdate', handleSelection);
    };
  }, [editor, onSelect]);

  useEffect(() => {
    if (!editor || !pendingSelectionReplacement) return;

    const { requestId, text, mode = 'replace' } = pendingSelectionReplacement;

    if (requestId === lastAppliedReplacementIdRef.current) {
      return;
    }

    lastAppliedReplacementIdRef.current = requestId;

    const range = pendingSelectionReplacement.range ?? lastSelectionRangeRef.current;

    if (mode === 'insertBelow') {
      const insertionPoint = range?.to ?? editor.state.selection.to;
      const html = plainTextToBlockHtml(text);

      editor
        .chain()
        .focus()
        .insertContentAt(insertionPoint, html || `<p>${plainTextToInlineHtml(text)}</p>`)
        .run();
    } else {
      const replacementHtml = plainTextToInlineHtml(text);

      if (range) {
        editor.chain()
          .focus()
          .setTextSelection({ from: range.from, to: range.to })
          .insertContent(replacementHtml)
          .run();
      } else {
        editor.chain()
          .focus()
          .insertContent(replacementHtml)
          .run();
      }
    }

    lastSelectionRangeRef.current = null;

    onSelectionReplacementApplied?.();
  }, [editor, pendingSelectionReplacement, onSelectionReplacementApplied]);

  const toggleBold = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().toggleBold().run();
  }, [editor]);

  const toggleItalic = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().toggleItalic().run();
  }, [editor]);

  const toggleHeading = useCallback(
    (level: 1 | 2 | 3 | 4 | 5) => {
      if (!editor) return;
      editor.chain().focus().toggleHeading({ level }).run();
    },
    [editor]
  );

  const setParagraph = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().setParagraph().run();
  }, [editor]);

  const handleWrapperContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (onContextMenu) {
        e.preventDefault();
        onContextMenu({ clientX: e.clientX, clientY: e.clientY });
      }
    },
    [onContextMenu]
  );

  if (!editor) {
    return null;
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center gap-1 border-b border-border-dark pb-2 mb-2 shrink-0 flex-wrap nodrag">
        <button
          type="button"
          onClick={() => toggleHeading(1)}
          className={`px-1.5 py-0.5 text-xs font-bold hover:bg-bg-dark rounded ${
            editor.isActive('heading', { level: 1 }) ? 'text-amber-400 bg-amber-500/20' : 'text-text-muted hover:text-text-dark'
          }`}
          title="标题1"
        >
          H1
        </button>
        <button
          type="button"
          onClick={() => toggleHeading(2)}
          className={`px-1.5 py-0.5 text-xs font-bold hover:bg-bg-dark rounded ${
            editor.isActive('heading', { level: 2 }) ? 'text-amber-400 bg-amber-500/20' : 'text-text-muted hover:text-text-dark'
          }`}
          title="标题2"
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => toggleHeading(3)}
          className={`px-1.5 py-0.5 text-xs font-bold hover:bg-bg-dark rounded ${
            editor.isActive('heading', { level: 3 }) ? 'text-amber-400 bg-amber-500/20' : 'text-text-muted hover:text-text-dark'
          }`}
          title="标题3"
        >
          H3
        </button>
        <button
          type="button"
          onClick={() => toggleHeading(4)}
          className={`px-1.5 py-0.5 text-xs font-bold hover:bg-bg-dark rounded ${
            editor.isActive('heading', { level: 4 }) ? 'text-amber-400 bg-amber-500/20' : 'text-text-muted hover:text-text-dark'
          }`}
          title="标题4"
        >
          H4
        </button>
        <button
          type="button"
          onClick={setParagraph}
          className={`px-1.5 py-0.5 text-xs font-bold hover:bg-bg-dark rounded ${
            editor.isActive('paragraph') && !editor.isActive('heading') ? 'text-amber-400 bg-amber-500/20' : 'text-text-muted hover:text-text-dark'
          }`}
          title="正文"
        >
          正文
        </button>
        <div className="w-px h-4 bg-border-dark mx-1" />
        <button
          type="button"
          onClick={toggleBold}
          className={`p-1.5 hover:bg-bg-dark rounded ${
            editor.isActive('bold') ? 'text-amber-400 bg-amber-500/20' : 'text-text-muted hover:text-text-dark'
          }`}
          title="加粗"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={toggleItalic}
          className={`p-1.5 hover:bg-bg-dark rounded ${
            editor.isActive('italic') ? 'text-amber-400 bg-amber-500/20' : 'text-text-muted hover:text-text-dark'
          }`}
          title="斜体"
        >
          <Italic className="w-4 h-4" />
        </button>
      </div>

      <div
        className="flex-1 min-h-0 overflow-auto ui-scrollbar nodrag relative"
        onContextMenu={handleWrapperContextMenu}
      >
        <EditorContent
          editor={editor}
          className="h-full bg-bg-dark border border-border-dark rounded text-text-dark"
        />
        {editor.isEmpty && (
          <div className="absolute top-3 left-3 text-text-muted pointer-events-none text-sm">
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}
