import { isTauri } from '@tauri-apps/api/core';
import { useMemo, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { startSystemFileDrag } from '@/commands/system';
import type { AssetItemRecord } from '@/features/assets/domain/types';
import {
  applyExternalFileDragDataTransfer,
  resolveExternalFileDragPayload,
} from '@/features/assets/application/externalFileDrag';

interface AssetExternalDragHandleProps {
  item: AssetItemRecord;
  className?: string;
  showLabel?: boolean;
  label?: string;
}

function shouldUseNativeSystemDrag(): boolean {
  if (!isTauri() || typeof navigator === 'undefined') {
    return false;
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };
  const platformText =
    navigatorWithUserAgentData.userAgentData?.platform
    || navigator.platform
    || navigator.userAgent
    || '';

  return /win/i.test(platformText);
}

export function AssetExternalDragHandle({
  item,
  className = '',
  showLabel = false,
  label,
}: AssetExternalDragHandleProps) {
  const { t } = useTranslation();
  const dragPayload = useMemo(
    () => resolveExternalFileDragPayload(item.sourcePath),
    [item.sourcePath]
  );

  if (!dragPayload) {
    return null;
  }

  const dragLabel = label || t('assets.dragToOtherApps');
  const useNativeSystemDrag = shouldUseNativeSystemDrag();

  const handleDragStart = (event: ReactDragEvent<HTMLSpanElement>) => {
    if (useNativeSystemDrag) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    applyExternalFileDragDataTransfer(event.dataTransfer, {
      ...dragPayload,
      mimeType: item.mimeType,
    });
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (!useNativeSystemDrag || event.button !== 0) {
      return;
    }

    event.preventDefault();
    void startSystemFileDrag(dragPayload.localPath);
  };

  return (
    <span
      draggable={!useNativeSystemDrag}
      title={t('assets.externalDragHint')}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={handleMouseDown}
      onDragStart={handleDragStart}
      className={className}
    >
      <GripVertical className={showLabel ? 'h-4 w-4 shrink-0' : 'h-4 w-4'} />
      {showLabel ? <span className="truncate">{dragLabel}</span> : null}
    </span>
  );
}
