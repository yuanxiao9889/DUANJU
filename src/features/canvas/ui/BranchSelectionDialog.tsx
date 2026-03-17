import { useState, useMemo } from 'react';
import { GitBranch, X } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { detectBranches, type ExportFormat, exportScript } from '../application/scriptExporter';
import { UiButton } from '@/components/ui/primitives';
import { Edge } from '@xyflow/react';

interface BranchSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BranchSelectionDialog({ isOpen, onClose }: BranchSelectionDialogProps) {
  const { nodes, edges } = useCanvasStore();
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>(['main']);
  const [showFormatMenu, setShowFormatMenu] = useState(false);

  const branches = useMemo(() => {
    const chapters = nodes.filter((n) => n.type === 'scriptChapterNode');
    return detectBranches(chapters as any, edges as Edge[]);
  }, [nodes, edges]);

  const hasBranches = branches.length > 1;

  const handleBranchToggle = (branchId: string) => {
    if (branchId === 'main') {
      setSelectedBranchIds(['main']);
    } else {
      setSelectedBranchIds((prev) => {
        const withoutMain = prev.filter((id) => id !== 'main');
        if (prev.includes(branchId)) {
          return withoutMain.length > 0 ? withoutMain : ['main'];
        }
        return [...prev, branchId];
      });
    }
  };

  const handleExport = (format: ExportFormat) => {
    exportScript(nodes, edges as Edge[], {
      format,
      branchIds: selectedBranchIds,
    });
    setShowFormatMenu(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-dark border border-border-dark rounded-xl max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border-dark">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-text-dark">选择导出分支</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-dark rounded">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {!hasBranches ? (
            <p className="text-sm text-text-muted">
              当前剧本没有分支，将导出完整故事。
            </p>
          ) : (
            <>
              <p className="text-sm text-text-muted">
                检测到剧本包含多个分支，请选择要导出的范围：
              </p>

              <div className="space-y-2">
                <label className="flex items-center gap-2 p-2 rounded hover:bg-bg-dark cursor-pointer">
                  <input
                    type="radio"
                    name="branch"
                    checked={selectedBranchIds.length === 1 && selectedBranchIds[0] === 'main'}
                    onChange={() => setSelectedBranchIds(['main'])}
                    className="accent-amber-500"
                  />
                  <div>
                    <div className="text-sm text-text-dark font-medium">主分支 (Main)</div>
                    <div className="text-xs text-text-muted">从根节点沿主路径导出</div>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-2 rounded hover:bg-bg-dark cursor-pointer">
                  <input
                    type="radio"
                    name="branch"
                    checked={selectedBranchIds.length === branches.length}
                    onChange={() => setSelectedBranchIds(branches.map((b) => b.id))}
                    className="accent-amber-500"
                  />
                  <div>
                    <div className="text-sm text-text-dark font-medium">所有分支 (All)</div>
                    <div className="text-xs text-text-muted">导出完整故事，包含所有分支</div>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-2 rounded hover:bg-bg-dark cursor-pointer">
                  <input
                    type="radio"
                    name="branch"
                    checked={
                      selectedBranchIds.length > 0 &&
                      selectedBranchIds.length < branches.length &&
                      !selectedBranchIds.includes('main')
                    }
                    onChange={() => {
                      const nonMainBranches = branches.filter((b) => !b.isMainBranch).map((b) => b.id);
                      setSelectedBranchIds(nonMainBranches);
                    }}
                    className="accent-amber-500"
                  />
                  <div>
                    <div className="text-sm text-text-dark font-medium">指定分支 (Specific)</div>
                    <div className="text-xs text-text-muted">选择要导出的特定分支</div>
                  </div>
                </label>

                {selectedBranchIds.length > 0 && selectedBranchIds.length < branches.length && !selectedBranchIds.includes('main') && (
                  <div className="ml-6 mt-2 space-y-1">
                    {branches
                      .filter((b) => !b.isMainBranch)
                      .map((branch) => (
                        <label
                          key={branch.id}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-bg-dark cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedBranchIds.includes(branch.id)}
                            onChange={() => handleBranchToggle(branch.id)}
                            className="accent-amber-500"
                          />
                          <span className="text-sm text-text-dark">
                            {branch.name} (章节 {branch.startChapter} - {branch.endChapter})
                          </span>
                        </label>
                      ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-border-dark">
          <div className="relative">
            <UiButton
              variant="primary"
              onClick={() => setShowFormatMenu(!showFormatMenu)}
              className="w-full"
            >
              选择格式并导出
            </UiButton>

            {showFormatMenu && (
              <div className="absolute bottom-full mb-2 left-0 right-0 bg-surface-dark border border-border-dark rounded-lg shadow-lg overflow-hidden">
                <button
                  onClick={() => handleExport('txt')}
                  className="w-full px-4 py-2 text-left text-sm text-text-dark hover:bg-bg-dark"
                >
                  📄 导出为 TXT
                </button>
                <button
                  onClick={() => handleExport('docx')}
                  className="w-full px-4 py-2 text-left text-sm text-text-dark hover:bg-bg-dark"
                >
                  📝 导出为 Word (.docx)
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className="w-full px-4 py-2 text-left text-sm text-text-dark hover:bg-bg-dark"
                >
                  📋 导出为 JSON
                </button>
                <button
                  onClick={() => handleExport('markdown')}
                  className="w-full px-4 py-2 text-left text-sm text-text-dark hover:bg-bg-dark"
                >
                  📑 导出为 Markdown
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
