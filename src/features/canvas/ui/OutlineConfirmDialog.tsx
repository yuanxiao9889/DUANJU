import { useState, useEffect, useRef } from 'react';
import { Sparkles, RefreshCw, Check, X, ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { UiButton, UiLoadingAnimation } from '@/components/ui';
import type { StoryOutline } from '../application/outlineGenerator';

export interface OutlineGenerationOptions {
  chapterCount: number;
  style: string;
  worldviewDescription: string;
}

interface OutlineConfirmDialogProps {
  isOpen: boolean;
  storyDescription: string;
  generatedOutline: StoryOutline | null;
  isGenerating: boolean;
  chapterCount: number;
  onClose: () => void;
  onConfirm: (outline: StoryOutline, options: OutlineGenerationOptions) => void;
  onRegenerate: (options: OutlineGenerationOptions) => void;
}

const MIN_CHAPTERS = 3;
const MAX_CHAPTERS = 15;

const STYLE_PRESETS = [
  { value: '', label: '不指定' },
  { value: '悬疑', label: '悬疑' },
  { value: '爱情', label: '爱情' },
  { value: '科幻', label: '科幻' },
  { value: '奇幻', label: '奇幻' },
  { value: '历史', label: '历史' },
  { value: '现代', label: '现代都市' },
  { value: '喜剧', label: '喜剧' },
  { value: '悲剧', label: '悲剧' },
  { value: '动作', label: '动作冒险' },
  { value: '恐怖', label: '恐怖' },
];

export function OutlineConfirmDialog({
  isOpen,
  storyDescription,
  generatedOutline,
  isGenerating,
  chapterCount: initialChapterCount,
  onClose,
  onConfirm,
  onRegenerate,
}: OutlineConfirmDialogProps) {
  const [chapterCount, setChapterCount] = useState(initialChapterCount);
  const [style, setStyle] = useState('');
  const [customStyle, setCustomStyle] = useState('');
  const [worldviewDescription, setWorldviewDescription] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setChapterCount(initialChapterCount);
      setStyle('');
      setCustomStyle('');
      setWorldviewDescription('');
      setShowAdvanced(false);
    }
  }, [isOpen, initialChapterCount]);

  if (!isOpen) return null;

  const effectiveStyle = style === 'custom' ? customStyle : style;

  const handleRegenerate = () => {
    onRegenerate({
      chapterCount,
      style: effectiveStyle,
      worldviewDescription,
    });
  };

  const handleConfirm = () => {
    if (generatedOutline) {
      onConfirm(generatedOutline, {
        chapterCount,
        style: effectiveStyle,
        worldviewDescription,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div
        ref={dialogRef}
        className="relative bg-surface-dark border border-border-dark rounded-xl w-[750px] max-h-[90vh] mx-4 shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-border-dark shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-text-dark">生成故事大纲</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-dark rounded transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-dark mb-2">
              故事概要
            </label>
            <div className="px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-sm text-text-muted max-h-20 overflow-y-auto">
              {storyDescription}
            </div>
          </div>

          {/* 高级设置 */}
          <div className="border border-border-dark rounded-lg overflow-hidden">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-3 py-2 bg-bg-dark/50 hover:bg-bg-dark transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-text-dark">高级设置（可选）</span>
              </div>
              {showAdvanced ? (
                <ChevronUp className="w-4 h-4 text-text-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-text-muted" />
              )}
            </button>
            
            {showAdvanced && (
              <div className="p-3 space-y-3 border-t border-border-dark">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-text-dark mb-1.5">
                      故事风格
                    </label>
                    <select
                      value={style}
                      onChange={(e) => setStyle(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm bg-bg-dark border border-border-dark rounded-lg text-text-dark outline-none focus:border-amber-500"
                    >
                      {STYLE_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                      <option value="custom">自定义...</option>
                    </select>
                    {style === 'custom' && (
                      <input
                        type="text"
                        value={customStyle}
                        onChange={(e) => setCustomStyle(e.target.value)}
                        placeholder="输入自定义风格..."
                        className="w-full mt-1.5 px-2 py-1.5 text-sm bg-bg-dark border border-border-dark rounded-lg text-text-dark outline-none focus:border-amber-500"
                      />
                    )}
                  </div>
                  
                  <div>
                    <label className="block text-xs font-medium text-text-dark mb-1.5">
                      章节数量
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={MIN_CHAPTERS}
                        max={MAX_CHAPTERS}
                        value={chapterCount}
                        onChange={(e) => setChapterCount(Number(e.target.value))}
                        className="flex-1 h-2 bg-bg-dark rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                      <span className="text-sm font-medium text-amber-400 w-10 text-right">
                        {chapterCount} 章
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-dark mb-1.5">
                    世界观概述
                  </label>
                  <textarea
                    value={worldviewDescription}
                    onChange={(e) => setWorldviewDescription(e.target.value)}
                    placeholder="描述故事的世界观设定，如：这是一个充满魔法的中世纪奇幻世界，人类与精灵共存..."
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm bg-bg-dark border border-border-dark rounded-lg text-text-dark outline-none focus:border-amber-500 resize-none placeholder:text-text-muted/60"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <label className="block text-sm font-medium text-text-dark mb-2">
                故事名称
              </label>
              {isGenerating ? (
                <div className="h-10 bg-bg-dark border border-border-dark rounded-lg animate-pulse" />
              ) : generatedOutline ? (
                <div className="px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark font-medium">
                  {generatedOutline.title}
                </div>
              ) : (
                <div className="px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-muted">
                  等待生成...
                </div>
              )}
            </div>

            <div className="w-[180px] shrink-0 flex flex-col justify-end">
              <UiButton
                variant="ghost"
                onClick={handleRegenerate}
                disabled={isGenerating}
                className="w-full border border-amber-500/30 hover:border-amber-500/50 text-amber-400"
              >
                {isGenerating ? <UiLoadingAnimation size="sm" /> : <RefreshCw className="w-4 h-4" />}
                <span>{isGenerating ? '生成中...' : '重新生成'}</span>
              </UiButton>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-dark mb-2">
              章节大纲
            </label>
            {isGenerating ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-bg-dark border border-border-dark rounded-lg animate-pulse" />
                ))}
              </div>
            ) : generatedOutline?.chapters.length ? (
              <div className="space-y-2 max-h-[280px] overflow-y-auto ui-scrollbar">
                {generatedOutline.chapters.map((chapter) => (
                  <div
                    key={chapter.number}
                    className="px-3 py-2 bg-bg-dark border border-border-dark rounded-lg"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-amber-400 font-medium text-sm shrink-0">
                        {chapter.number}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-text-dark text-sm">
                          {chapter.title}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5 line-clamp-2">
                          {chapter.summary}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-8 bg-bg-dark border border-border-dark rounded-lg text-center">
                <div className="text-text-muted text-sm">
                  点击"生成大纲"开始生成
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border-dark shrink-0">
          <UiButton variant="ghost" onClick={onClose}>
            取消
          </UiButton>
          <UiButton
            variant="primary"
            onClick={handleConfirm}
            disabled={!generatedOutline || isGenerating}
          >
            <Check className="w-4 h-4" />
            <span>确认创建大纲</span>
          </UiButton>
        </div>

        {isGenerating && (
          <div className="absolute inset-0 bg-surface-dark/80 flex items-center justify-center rounded-xl">
            <div className="text-center">
              <UiLoadingAnimation size="lg" className="mx-auto mb-2" />
              <div className="text-sm text-text-muted">AI 正在生成大纲...</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
