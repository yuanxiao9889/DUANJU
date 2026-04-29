import { memo, useEffect, useState } from "react";
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiChipButton, UiModal } from "@/components/ui";
import { StyleTemplateDialog } from "@/features/project/StyleTemplateDialog";
import { StyleTemplateMenuPanel } from "@/features/project/StyleTemplateMenuPanel";
import type { StyleTemplate } from "@/features/project/styleTemplateUtils";

interface StyleTemplatePickerProps {
  onTemplateApply: (template: StyleTemplate) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}

export const StyleTemplatePicker = memo(
  ({
    onTemplateApply,
    className = "",
    disabled = false,
    title,
  }: StyleTemplatePickerProps) => {
    const { t } = useTranslation();
    const [panelOpen, setPanelOpen] = useState(false);
    const [showManager, setShowManager] = useState(false);

    const resolvedTitle = title?.trim() || t("styleTemplate.selectTemplate");

    useEffect(() => {
      if (disabled && panelOpen) {
        setPanelOpen(false);
      }
    }, [disabled, panelOpen]);

    return (
      <>
        <UiChipButton
          type="button"
          active={panelOpen}
          disabled={disabled}
          className={className}
          aria-label={resolvedTitle}
          title={resolvedTitle}
          onClick={(event) => {
            event.stopPropagation();
            setPanelOpen((previous) => !previous);
          }}
        >
          <Palette className="h-4 w-4 origin-center scale-[1.08]" />
        </UiChipButton>

        <UiModal
          isOpen={panelOpen}
          title={resolvedTitle}
          onClose={() => setPanelOpen(false)}
          widthClassName="w-[820px] max-w-[calc(100vw-32px)]"
          headerClassName="border-b-0 !px-4 !pt-3 !pb-1"
          bodyClassName="!pt-0 !pb-4"
        >
          <StyleTemplateMenuPanel
            embedded
            onTemplateApply={onTemplateApply}
            onRequestClose={() => setPanelOpen(false)}
            onManage={() => {
              setPanelOpen(false);
              setShowManager(true);
            }}
          />
        </UiModal>

        <StyleTemplateDialog
          isOpen={showManager}
          onClose={() => setShowManager(false)}
        />
      </>
    );
  },
);

StyleTemplatePicker.displayName = "StyleTemplatePicker";
