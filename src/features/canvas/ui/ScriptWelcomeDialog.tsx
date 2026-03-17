import { useState, useCallback, useEffect } from 'react';
import { FileText, Sparkles, Upload, Wand2 } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { parseDocument, detectCharacterNames, detectLocations } from '../application/documentParser';
import { analyzeScript, createChapterNodesFromAnalysis } from '../application/scriptAnalyzer';
import { generateOutline } from '../application/outlineGenerator';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { UiButton } from '@/components/ui/primitives';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import { OutlineConfirmDialog, type OutlineGenerationOptions } from './OutlineConfirmDialog';
import type { StoryOutline } from '../application/outlineGenerator';

interface ScriptWelcomeDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ScriptWelcomeDialog({ isOpen, onClose }: ScriptWelcomeDialogProps) {
  const { addNode, addEdge } = useCanvasStore();
  const { scriptProviderEnabled, apiKeys } = useSettingsStore();
  const [mode, setMode] = useState<'select' | 'import' | 'create'>('select');
  const [storyOutline, setStoryOutline] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [outlineDialogOpen, setOutlineDialogOpen] = useState(false);
  const [generatedOutline, setGeneratedOutline] = useState<StoryOutline | null>(null);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [chapterCount, setChapterCount] = useState(5);
  const hasScriptProvider = scriptProviderEnabled && apiKeys[scriptProviderEnabled];

  useEffect(() => {
    if (isOpen) {
      setChapterCount(5);
    }
  }, [isOpen]);

  const handleGenerateOutline = useCallback(async (options: OutlineGenerationOptions) => {
    if (!storyOutline.trim()) return;
    
    if (!hasScriptProvider) {
      openSettingsDialog({ category: 'providers' });
      return;
    }

    setIsGeneratingOutline(true);
    setGeneratedOutline(null);
    try {
      const outline = await generateOutline(storyOutline, options);
      setGeneratedOutline(outline);
    } catch (err) {
      console.error('Generate outline failed:', err);
      if (err instanceof Error && err.message.includes('请先在设置中')) {
        openSettingsDialog({ category: 'providers' });
      }
    } finally {
      setIsGeneratingOutline(false);
    }
  }, [storyOutline, hasScriptProvider]);

  const handleConfirmOutline = useCallback((outline: StoryOutline, options: OutlineGenerationOptions) => {
    const rootId = addNode(CANVAS_NODE_TYPES.scriptRoot, { x: 50, y: 100 }, {
      displayName: '剧本',
      title: outline.title,
      genre: outline.genre || '',
      totalChapters: outline.chapters.length,
    });

    const NODE_HEIGHT = 400;
    const GAP = 40;
    outline.chapters.forEach((chapter, index) => {
      const chapterId = addNode(CANVAS_NODE_TYPES.scriptChapter, { x: 500, y: 100 + index * (NODE_HEIGHT + GAP) }, {
        displayName: `第${chapter.number}章 ${chapter.title}`,
        chapterNumber: chapter.number,
        title: chapter.title,
        summary: chapter.summary,
        content: '',
        sceneHeadings: [],
        isBranchPoint: false,
        branchType: 'main',
        depth: 1,
      });
      if (rootId && chapterId) {
        addEdge(rootId, chapterId);
      }
    });

    // Create worldview node if worldview data exists
    if (outline.worldview || options.worldviewDescription) {
      const worldviewData = outline.worldview || {
        name: '世界观',
        description: options.worldviewDescription,
        era: '',
        technology: '',
        magic: '',
        society: '',
        geography: '',
      };
      
      addNode(CANVAS_NODE_TYPES.scriptWorldview, { x: 900, y: 100 }, {
        displayName: worldviewData.name || '世界观',
        worldviewName: worldviewData.name || '',
        description: worldviewData.description || options.worldviewDescription || '',
        era: worldviewData.era || '',
        technology: worldviewData.technology || '',
        magic: worldviewData.magic || '',
        society: worldviewData.society || '',
        geography: worldviewData.geography || '',
        rules: [],
      });
    }

    setOutlineDialogOpen(false);
    onClose();
  }, [addNode, addEdge, onClose]);

  const handleCreateStory = useCallback(() => {
    if (!storyOutline.trim()) return;

    if (!hasScriptProvider) {
      openSettingsDialog({ category: 'providers' });
      return;
    }

    setOutlineDialogOpen(true);
    handleGenerateOutline({ chapterCount, style: '', worldviewDescription: '' });
  }, [storyOutline, hasScriptProvider, chapterCount, handleGenerateOutline]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsProcessing(true);
    try {
      const parsed = await parseDocument(file);
      const analysis = await analyzeScript(parsed);
      const chapterNodes = createChapterNodesFromAnalysis(analysis, '');
      
      const rootId = addNode(CANVAS_NODE_TYPES.scriptRoot, { x: 50, y: 100 }, {
        displayName: '剧本',
        title: parsed.title,
        genre: '',
        totalChapters: chapterNodes.length,
      });

      const characterNames = detectCharacterNames(parsed.scenes);
      const locations = detectLocations(parsed.scenes);

      chapterNodes.forEach((chapter) => {
        const chapterId = addNode(chapter.type as any, chapter.position, chapter.data);
        if (rootId && chapterId) {
          addEdge(rootId, chapterId);
        }
      });

      characterNames.forEach((name, index) => {
        addNode(CANVAS_NODE_TYPES.scriptCharacter, { x: 600, y: 100 + index * 120 }, {
          displayName: name,
          name,
          description: '',
        });
      });

      locations.forEach((name, index) => {
        addNode(CANVAS_NODE_TYPES.scriptLocation, { x: 850, y: 100 + index * 120 }, {
          displayName: name,
          name,
          description: '',
        });
      });

      onClose();
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  }, [addNode, addEdge, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80" />
      <div className="relative bg-surface-dark border border-border-dark rounded-xl max-w-lg w-full mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border-dark">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-text-dark">
              {mode === 'select' ? '欢迎使用剧本助手' :
               mode === 'import' ? '导入剧本' : '创建故事'}
            </h2>
          </div>
        </div>

        {mode === 'select' && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-text-muted mb-4">
              请选择如何开始您的剧本创作：
            </p>
            
            <button
              onClick={() => setMode('import')}
              className="w-full p-4 border border-border-dark rounded-lg hover:bg-bg-dark transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 rounded-lg">
                  <Upload className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <div className="font-medium text-text-dark">导入剧本</div>
                  <div className="text-sm text-text-muted">从 TXT、PDF、Word 文件导入已有剧本</div>
                </div>
              </div>
            </button>

            <button
              onClick={() => setMode('create')}
              className="w-full p-4 border border-border-dark rounded-lg hover:bg-bg-dark transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-accent/20 rounded-lg">
                  <Wand2 className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <div className="font-medium text-text-dark">创建故事</div>
                  <div className="text-sm text-text-muted">输入故事概要，AI 生成大纲</div>
                </div>
              </div>
            </button>
          </div>
        )}

        {mode === 'import' && (
          <div className="p-6 space-y-4">
            <div className="border-2 border-dashed border-border-dark rounded-lg p-8 text-center">
              <input
                type="file"
                accept=".txt,.pdf,.docx,.doc"
                onChange={handleImport}
                disabled={isProcessing}
                className="hidden"
                id="welcome-import-trigger"
              />
              <label
                htmlFor="welcome-import-trigger"
                className="cursor-pointer"
              >
                <FileText className="w-12 h-12 text-text-muted mx-auto mb-3" />
                <div className="text-sm text-text-dark mb-1">
                  点击选择文件或拖拽到此处
                </div>
                <div className="text-xs text-text-muted">
                  支持 TXT、PDF、Word 格式
                </div>
              </label>
            </div>

            <div className="flex gap-2">
              <UiButton variant="ghost" onClick={() => setMode('select')}>
                返回
              </UiButton>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <div className="p-6 space-y-4">
            {!hasScriptProvider && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-400">
                请先配置剧本 API 才能使用 AI 生成功能
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-text-dark mb-2">
                故事概要
              </label>
              <textarea
                value={storyOutline}
                onChange={(e) => setStoryOutline(e.target.value)}
                placeholder="请输入您的故事想法，例如：讲述一个关于友谊和成长的故事，主角是一个高中生..."
                rows={5}
                className="w-full px-3 py-2 bg-bg-dark border border-border-dark rounded-lg text-text-dark placeholder:text-text-muted focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-dark mb-2">
                章节数量
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="3"
                  max="15"
                  value={chapterCount}
                  onChange={(e) => setChapterCount(Number(e.target.value))}
                  className="flex-1 h-2 bg-bg-dark rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-sm font-medium text-text-dark w-8 text-center">
                  {chapterCount} 章
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <UiButton variant="ghost" onClick={() => setMode('select')}>
                返回
              </UiButton>
              <UiButton
                variant="primary"
                onClick={handleCreateStory}
                disabled={!storyOutline.trim() || isProcessing}
                className="flex-1"
              >
                {isProcessing ? 'AI 生成中...' : (hasScriptProvider ? '生成大纲' : '配置 API')}
              </UiButton>
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="absolute inset-0 bg-surface-dark/80 flex items-center justify-center rounded-xl">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto mb-2" />
              <div className="text-sm text-text-muted">处理中...</div>
            </div>
          </div>
        )}
      </div>

      <OutlineConfirmDialog
        isOpen={outlineDialogOpen}
        storyDescription={storyOutline}
        generatedOutline={generatedOutline}
        isGenerating={isGeneratingOutline}
        chapterCount={chapterCount}
        onClose={() => setOutlineDialogOpen(false)}
        onConfirm={handleConfirmOutline}
        onRegenerate={handleGenerateOutline}
      />
    </div>
  );
}
