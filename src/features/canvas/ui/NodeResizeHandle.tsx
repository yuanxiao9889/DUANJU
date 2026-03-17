import { NodeResizeControl } from '@xyflow/react';
import type { ControlPosition } from '@xyflow/system';

type NodeResizeHandleProps = {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  isVisible?: boolean;
  position?: ControlPosition;
};

const DEFAULT_MIN_WIDTH = 160;
const DEFAULT_MIN_HEIGHT = 100;
const DEFAULT_MAX_WIDTH = 1400;
const DEFAULT_MAX_HEIGHT = 1400;

const CORNER_STYLES: Record<string, string> = {
  'bottom-right': 'bottom-0.5 right-0.5 border-b-2 border-r-2 rounded-br-sm',
  'bottom-left': 'bottom-0.5 left-0.5 border-b-2 border-l-2 rounded-bl-sm',
  'top-right': 'top-0.5 right-0.5 border-t-2 border-r-2 rounded-tr-sm',
  'top-left': 'top-0.5 left-0.5 border-t-2 border-l-2 rounded-tl-sm',
};

export function NodeResizeHandle({
  minWidth = DEFAULT_MIN_WIDTH,
  minHeight = DEFAULT_MIN_HEIGHT,
  maxWidth = DEFAULT_MAX_WIDTH,
  maxHeight = DEFAULT_MAX_HEIGHT,
  isVisible = false,
  position = 'bottom-right',
}: NodeResizeHandleProps) {
  return (
    <NodeResizeControl
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
      position={position}
      className={`!h-4 !w-4 !min-h-0 !min-w-0 !rounded-none !border-0 !bg-transparent !p-0 transition-opacity duration-150 ${isVisible ? '!opacity-100' : '!opacity-0'} hover:!opacity-100 focus-within:!opacity-100 group-hover:!opacity-70`}
    >
      <div className={`pointer-events-none absolute h-2.5 w-2.5 border-accent/70 ${CORNER_STYLES[position]}`} />
    </NodeResizeControl>
  );
}
