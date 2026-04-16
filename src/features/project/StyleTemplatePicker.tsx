import {
  createPortal,
} from "react-dom";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiChipButton } from "@/components/ui";
import { StyleTemplateDialog } from "@/features/project/StyleTemplateDialog";
import { StyleTemplateMenuPanel } from "@/features/project/StyleTemplateMenuPanel";
import { useSettingsStore } from "@/stores/settingsStore";

interface StyleTemplatePickerProps {
  selectedTemplateId: string | null;
  onTemplateChange: (templateId: string | null, prompt: string) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}

interface AnchorRect {
  left: number;
  top: number;
}

export const StyleTemplatePicker = memo(
  ({
    selectedTemplateId,
    onTemplateChange,
    className = "",
    disabled = false,
    title,
  }: StyleTemplatePickerProps) => {
    const { t } = useTranslation();
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const styleTemplates = useSettingsStore((state) => state.styleTemplates);
    const [panelOpen, setPanelOpen] = useState(false);
    const [showManager, setShowManager] = useState(false);
    const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);

    const resolvedTitle =
      title?.trim() || t("styleTemplate.selectTemplate");
    const selectedTemplateName = useMemo(
      () =>
        selectedTemplateId
          ? styleTemplates.find((template) => template.id === selectedTemplateId)
              ?.name ?? t("styleTemplate.selectTemplate")
          : t("styleTemplate.selectTemplate"),
      [selectedTemplateId, styleTemplates, t],
    );

    useEffect(() => {
      if (!panelOpen) {
        return;
      }

      const updateAnchor = () => {
        const trigger = triggerRef.current;
        if (!trigger) {
          return;
        }

        const rect = trigger.getBoundingClientRect();
        setAnchorRect({
          left: rect.left + rect.width / 2,
          top: rect.bottom + 8,
        });
      };

      updateAnchor();
      window.addEventListener("resize", updateAnchor);
      window.addEventListener("scroll", updateAnchor, true);

      return () => {
        window.removeEventListener("resize", updateAnchor);
        window.removeEventListener("scroll", updateAnchor, true);
      };
    }, [panelOpen]);

    useEffect(() => {
      if (!panelOpen) {
        return;
      }

      const handlePointerDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (
          target &&
          (panelRef.current?.contains(target) || triggerRef.current?.contains(target))
        ) {
          return;
        }

        setPanelOpen(false);
      };

      window.addEventListener("mousedown", handlePointerDown);
      return () => {
        window.removeEventListener("mousedown", handlePointerDown);
      };
    }, [panelOpen]);

    return (
      <>
        <UiChipButton
          ref={triggerRef}
          type="button"
          active={panelOpen || Boolean(selectedTemplateId)}
          disabled={disabled}
          className={className}
          aria-label={resolvedTitle}
          title={
            selectedTemplateId
              ? `${resolvedTitle}: ${selectedTemplateName}`
              : resolvedTitle
          }
          onClick={(event) => {
            event.stopPropagation();
            setPanelOpen((previous) => !previous);
          }}
        >
          <Palette className="h-4 w-4 origin-center scale-[1.08]" />
        </UiChipButton>

        {typeof document !== "undefined" && panelOpen && anchorRect
          ? createPortal(
              <div
                ref={panelRef}
                className="fixed z-[80]"
                style={{
                  left: `${anchorRect.left}px`,
                  top: `${anchorRect.top}px`,
                  transform: "translateX(-50%)",
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <StyleTemplateMenuPanel
                  selectedTemplateId={selectedTemplateId}
                  onTemplateChange={onTemplateChange}
                  onRequestClose={() => setPanelOpen(false)}
                  onManage={() => setShowManager(true)}
                />
              </div>,
              document.body,
            )
          : null}

        <StyleTemplateDialog
          isOpen={showManager}
          onClose={() => setShowManager(false)}
        />
      </>
    );
  },
);

StyleTemplatePicker.displayName = "StyleTemplatePicker";
