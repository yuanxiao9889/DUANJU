import { useState } from 'react';
import { Film, FileText } from 'lucide-react';
import { useProjectStore, type ProjectType } from '@/stores/projectStore';
import { UI_CONTENT_OVERLAY_INSET_CLASS } from '@/components/ui/motion';
import { UiButton } from '@/components/ui/primitives';

interface ProjectTypeSelectorProps {
  onClose: () => void;
  onSelectType: (type: ProjectType) => void;
}

export function ProjectTypeSelector({ onClose, onSelectType }: ProjectTypeSelectorProps) {
  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 flex items-center justify-center`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-dark/95 backdrop-blur-md border border-border-dark/50 rounded-2xl p-8 max-w-lg w-full mx-4 shadow-[0_24px_48px_rgba(0,0,0,0.25)]">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-text-dark">选择项目类型</h2>
          <p className="text-text-muted mt-2">请选择您要创建的项目类型</p>
        </div>

        <div className="grid grid-cols-2 gap-5 mb-6">
          <button
            onClick={() => onSelectType('storyboard')}
            className="flex flex-col items-center gap-4 p-6 border-2 border-border-dark/50 rounded-2xl bg-bg-dark/30 hover:border-accent/50 hover:bg-accent/5 hover:shadow-[0_8px_24px_rgba(59,130,246,0.15)] transition-all duration-300 group"
          >
            <div className="w-16 h-16 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 group-hover:scale-110 transition-all">
              <Film className="w-8 h-8 text-accent" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-text-dark">分镜项目</h3>
              <p className="text-sm text-text-muted mt-1">图片生成/编辑</p>
              <p className="text-xs text-text-muted">故事板拆分</p>
            </div>
          </button>

          <button
            onClick={() => onSelectType('script')}
            className="flex flex-col items-center gap-4 p-6 border-2 border-border-dark/50 rounded-2xl bg-bg-dark/30 hover:border-amber-500/50 hover:bg-amber-500/5 hover:shadow-[0_8px_24px_rgba(245,158,11,0.15)] transition-all duration-300 group"
          >
            <div className="w-16 h-16 rounded-xl bg-amber-500/10 flex items-center justify-center group-hover:bg-amber-500/20 group-hover:scale-110 transition-all">
              <FileText className="w-8 h-8 text-amber-400" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-text-dark">剧本项目</h3>
              <p className="text-sm text-text-muted mt-1">章节写作/AI</p>
              <p className="text-xs text-text-muted">剧本解构</p>
            </div>
          </button>
        </div>

        <UiButton variant="ghost" onClick={onClose} className="w-full">
          取消
        </UiButton>
      </div>
    </div>
  );
}

interface CreateProjectDialogProps {
  projectType: ProjectType;
  isOpen: boolean;
  onClose: () => void;
}

export function CreateProjectDialog({ projectType, isOpen, onClose }: CreateProjectDialogProps) {
  const { createProject } = useProjectStore();
  const [name, setName] = useState('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (name.trim()) {
      createProject(name.trim(), projectType);
      onClose();
      setName('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      handleConfirm();
    }
  };

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 flex items-center justify-center`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-dark/95 backdrop-blur-md border border-border-dark/50 rounded-2xl p-8 max-w-md w-full mx-4 shadow-[0_24px_48px_rgba(0,0,0,0.25)]">
        <h2 className="text-xl font-bold text-text-dark mb-5">
          {projectType === 'script' ? '创建剧本项目' : '创建分镜项目'}
        </h2>

        <div className="mb-5">
          <label className="block text-sm font-medium text-text-dark mb-2">
            项目名称
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="请输入项目名称"
            className="w-full px-4 py-2.5 bg-bg-dark/80 border border-border-dark/50 rounded-xl text-text-dark placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
            autoFocus
          />
        </div>

        <div className="flex gap-3">
          <UiButton variant="ghost" onClick={onClose} className="flex-1 rounded-xl">
            取消
          </UiButton>
          <UiButton 
            variant="primary" 
            onClick={handleConfirm} 
            disabled={!name.trim()}
            className="flex-1 rounded-xl shadow-lg shadow-accent/20"
          >
            创建项目
          </UiButton>
        </div>
      </div>
    </div>
  );
}
