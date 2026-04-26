import { memo } from 'react';

import { UiTextArea } from '@/components/ui';

export const NODE_DESCRIPTION_PANEL_EXPANDED_HEIGHT = 120;
export const NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT =
  NODE_DESCRIPTION_PANEL_EXPANDED_HEIGHT + 8;

interface NodeDescriptionPanelProps {
  isOpen: boolean;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

export const NodeDescriptionPanel = memo(({
  isOpen,
  value,
  placeholder,
  onChange,
}: NodeDescriptionPanelProps) => (
  <div
    className={`overflow-hidden transition-[max-height,opacity,margin] duration-200 ease-out ${
      isOpen ? 'mt-2 opacity-100' : 'pointer-events-none mt-0 opacity-0'
    }`}
    style={{
      maxHeight: isOpen ? `${NODE_DESCRIPTION_PANEL_EXPANDED_HEIGHT}px` : '0px',
    }}
    onPointerDown={(event) => event.stopPropagation()}
    onMouseDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
  >
    <div className="rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <UiTextArea
        value={value}
        rows={3}
        placeholder={placeholder}
        className="nodrag nowheel min-h-[92px] border-white/10 bg-black/20 text-sm leading-5"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  </div>
));

NodeDescriptionPanel.displayName = 'NodeDescriptionPanel';
