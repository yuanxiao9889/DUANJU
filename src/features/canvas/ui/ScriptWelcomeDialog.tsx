import { useState, useCallback, useEffect } from 'react';
import { FileText, Sparkles, Upload, Wand2, ArrowLeft } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useProjectStore } from '@/stores/projectStore';
import { generateOutline } from '../application/outlineGenerator';
import { CANVAS_NODE_TYPES } from '../domain/canvasNodes';
import { UiButton } from '@/components/ui/primitives';
import { openSettingsDialog } from '@/features/settings/settingsEvents';
import {
  resolveActivatedScriptProvider,
  resolveConfiguredScriptModel,
} from '@/features/canvas/models';
import { OutlineConfirmDialog, type OutlineGenerationOptions } from './OutlineConfirmDialog';
import type { StoryOutline } from '../application/outlineGenerator';
import { ChapterCountDialog } from './ChapterCountDialog';

interface ScriptWelcomeDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ScriptWelcomeDialog({ isOpen, onClose }: ScriptWelcomeDialogProps) {
  const { addNode, addEdge } = useCanvasStore();
  const settings = useSettingsStore();
  const { apiKeys } = settings;
  const closeProject = useProjectStore((state) => state.closeProject);
  const [mode, setMode] = useState<'select' | 'import' | 'create'>('select');
  const [storyOutline, setStoryOutline] = useState('');
  const [outlineDialogOpen, setOutlineDialogOpen] = useState(false);
  const [generatedOutline, setGeneratedOutline] = useState<StoryOutline | null>(null);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [chapterCount, setChapterCount] = useState(5);
  const [showChapterCountDialog, setShowChapterCountDialog] = useState(false);
  const activeScriptProvider = resolveActivatedScriptProvider(settings);
  const activeScriptModel = activeScriptProvider
    ? resolveConfiguredScriptModel(activeScriptProvider, settings).trim()
    : '';
  const hasScriptProvider =
    Boolean(activeScriptProvider)
    && Boolean(activeScriptModel)
    && Boolean(activeScriptProvider ? apiKeys[activeScriptProvider]?.trim() : '');

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
    const CHAPTER_NODE_HEIGHT = 380;
    const ROOT_NODE_WIDTH = 320;
    const ROOT_NODE_HEIGHT = 120;
    const GAP = 60;
    const HORIZONTAL_GAP = 150;

    const chapterCount = outline.chapters.length;
    const totalChaptersHeight = chapterCount * CHAPTER_NODE_HEIGHT + (chapterCount - 1) * GAP;
    const chapterStartY = 100;
    const rootY = chapterStartY + totalChaptersHeight / 2 - ROOT_NODE_HEIGHT / 2;
    const rootX = 100;
    const chapterX = rootX + ROOT_NODE_WIDTH + HORIZONTAL_GAP;

    const rootId = addNode(CANVAS_NODE_TYPES.scriptRoot, { x: rootX, y: rootY }, {
      displayName: '剧本',
      title: outline.title,
      genre: outline.genre || '',
      totalChapters: chapterCount,
    });

    outline.chapters.forEach((chapter, index) => {
      const chapterId = addNode(CANVAS_NODE_TYPES.scriptChapter, { x: chapterX, y: chapterStartY + index * (CHAPTER_NODE_HEIGHT + GAP) }, {
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

  const handleImport = useCallback(() => {
    setShowChapterCountDialog(true);
  }, []);

  const handleChapterCountConfirm = useCallback((count: number) => {
    const CHAPTER_NODE_HEIGHT = 380;
    const ROOT_NODE_WIDTH = 320;
    const ROOT_NODE_HEIGHT = 120;
    const GAP = 60;
    const HORIZONTAL_GAP = 150;

    // 计算章节列表的总高度
    const totalChaptersHeight = count * CHAPTER_NODE_HEIGHT + (count - 1) * GAP;
    
    // 章节起始Y坐标（从100开始）
    const chapterStartY = 100;
    
    // 根节点垂直居中：章节列表中心 - 根节点高度/2
    const rootY = chapterStartY + totalChaptersHeight / 2 - ROOT_NODE_HEIGHT / 2;
    // 根节点在章节左侧，保持横向间距
    const rootX = 100;
    
    // 章节节点在根节点右侧
    const chapterX = rootX + ROOT_NODE_WIDTH + HORIZONTAL_GAP;

    const rootId = addNode(CANVAS_NODE_TYPES.scriptRoot, { x: rootX, y: rootY }, {
      displayName: '剧本',
      title: '新剧本',
      genre: '',
      totalChapters: count,
    });

    for (let i = 1; i <= count; i++) {
      const position = {
        x: chapterX,
        y: chapterStartY + (i - 1) * (CHAPTER_NODE_HEIGHT + GAP),
      };
      
      const chapterId = addNode(CANVAS_NODE_TYPES.scriptChapter, position, {
        displayName: `第${i}章`,
        chapterNumber: i,
        title: `第${i}章`,
        content: '',
        summary: '',
        sceneHeadings: [],
        characters: [],
        locations: [],
        items: [],
        emotionalShift: '',
        isBranchPoint: false,
        branchType: 'main',
        depth: 1,
        tables: [],
        plotPoints: [],
      });
      
      if (rootId && chapterId) {
        addEdge(rootId, chapterId);
      }
    }

    setShowChapterCountDialog(false);
    onClose();
    console.log(`[ScriptImport] 创建了 ${count} 个章节节点`);
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

            <div className="pt-4 border-t border-border-dark">
              <button
                onClick={() => {
                  closeProject();
                }}
                className="w-full p-3 flex items-center justify-center gap-2 text-text-muted hover:text-text-dark hover:bg-bg-dark rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">返回项目管理页面</span>
              </button>
            </div>
          </div>
        )}

        {mode === 'import' && (
          <div className="p-6 space-y-4">
            <ChapterCountDialog
              isOpen={showChapterCountDialog}
              onClose={() => setShowChapterCountDialog(false)}
              onConfirm={handleChapterCountConfirm}
            />
            
            <div className="text-center py-8">
              <FileText className="w-16 h-16 text-accent/50 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-text-dark mb-2">创建空白剧本</h3>
              <p className="text-sm text-text-muted mb-6">
                输入章节数量，系统将创建对应数量的空章节节点，您可以自行填写内容
              </p>
              <UiButton variant="primary" onClick={handleImport}>
                开始创建
              </UiButton>
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
                disabled={!storyOutline.trim() || isGeneratingOutline}
                className="flex-1"
              >
                {isGeneratingOutline ? 'AI 生成中...' : (hasScriptProvider ? '生成大纲' : '配置 API')}
              </UiButton>
            </div>
          </div>
        )}

        {isGeneratingOutline && (
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
