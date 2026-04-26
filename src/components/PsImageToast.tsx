import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Plus, Check } from 'lucide-react';
import { UiLoadingAnimation } from '@/components/ui';
import { usePsIntegrationStore } from '@/stores/psIntegrationStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

export function PsImageToast() {
  const { t } = useTranslation();
  const pendingImages = usePsIntegrationStore((state) => state.pendingImages);
  const removePendingImage = usePsIntegrationStore((state) => state.removePendingImage);
  const addImageFromBase64 = useCanvasStore((state) => state.addImageFromBase64);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  if (!currentProjectId || pendingImages.length === 0) {
    return null;
  }

  const handleAddToCanvas = async (imageId: string, base64: string, width: number, height: number) => {
    setAddingIds((prev) => new Set(prev).add(imageId));
    try {
      await addImageFromBase64(base64, width, height);
      setAddedIds((prev) => new Set(prev).add(imageId));
      setTimeout(() => {
        removePendingImage(imageId);
        setAddedIds((prev) => {
          const next = new Set(prev);
          next.delete(imageId);
          return next;
        });
      }, 1500);
    } catch (error) {
      console.error('Failed to add image to canvas:', error);
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
    }
  };

  const handleDismiss = (imageId: string) => {
    removePendingImage(imageId);
  };

  return createPortal(
    <div className="fixed bottom-20 right-4 z-[100] flex flex-col gap-2 max-w-xs">
      {pendingImages.map((image) => {
        const isAdding = addingIds.has(image.id);
        const isAdded = addedIds.has(image.id);
        
        const imageSrc = image.base64.startsWith('data:') 
          ? image.base64 
          : `data:image/jpeg;base64,${image.base64}`;

        return (
          <div
            key={image.id}
            className="border ui-panel rounded-lg p-3 shadow-lg flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-dark">
                {t('psImageToast.imageFromPs')}
              </span>
              <button
                type="button"
                className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.1)] text-text-muted hover:text-text-dark transition-colors"
                onClick={() => handleDismiss(image.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-16 h-16 rounded overflow-hidden bg-bg-dark/50 flex-shrink-0">
                <img
                  src={imageSrc}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-muted mb-1">
                  {image.width} × {image.height}
                </div>
                <button
                  type="button"
                  disabled={isAdding || isAdded}
                  className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  onClick={() => handleAddToCanvas(image.id, image.base64, image.width, image.height)}
                >
                  {isAdded ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      {t('common.success')}
                    </>
                  ) : isAdding ? (
                    <>
                      <UiLoadingAnimation size="xs" />
                      {t('common.loading')}
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      {t('psImageToast.addToCanvas')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
