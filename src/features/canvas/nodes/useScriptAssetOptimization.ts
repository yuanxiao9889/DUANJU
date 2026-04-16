import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import { ScriptAssetOptimizationParseError } from '@/features/canvas/application/scriptAssetOptimizer';
import { useCanvasStore } from '@/stores/canvasStore';

interface UseScriptAssetOptimizationOptions<TResult> {
  validateSource: () => string | null;
  optimize: (nodes: CanvasNode[]) => Promise<TResult>;
  applyOptimizedResult: (result: TResult) => void;
  onStart?: () => void;
}

export function useScriptAssetOptimization<TResult>({
  validateSource,
  optimize,
  applyOptimizedResult,
  onStart,
}: UseScriptAssetOptimizationOptions<TResult>) {
  const { t } = useTranslation();
  const [isOptimizing, setIsOptimizing] = useState(false);

  const handleOptimize = useCallback(async () => {
    const validationMessage = validateSource();
    if (validationMessage) {
      await showErrorDialog(validationMessage, t('common.error'));
      return;
    }

    setIsOptimizing(true);
    onStart?.();

    try {
      const nodes = useCanvasStore.getState().nodes;
      const result = await optimize(nodes);
      applyOptimizedResult(result);
    } catch (error) {
      if (error instanceof ScriptAssetOptimizationParseError) {
        await showErrorDialog(
          t('scriptNodes.common.optimizeParseFailed'),
          t('common.error'),
          error.details
        );
      } else {
        const content = resolveErrorContent(error, t('scriptNodes.common.optimizeFailed'));
        await showErrorDialog(content.message, t('common.error'), content.details);
      }
    } finally {
      setIsOptimizing(false);
    }
  }, [applyOptimizedResult, onStart, optimize, t, validateSource]);

  return {
    isOptimizing,
    handleOptimize,
  };
}
