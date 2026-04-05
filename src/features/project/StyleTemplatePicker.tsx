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
import { Palette, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiChipButton, UiPanel } from "@/components/ui";
import { StyleTemplateDialog } from "@/features/project/StyleTemplateDialog";
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
                <UiPanel className="min-w-[180px] p-1">
                  <button
                    type="button"
                    className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
                      !selectedTemplateId
                        ? "bg-accent/15 text-accent"
                        : "text-text-muted hover:bg-surface-hover"
                    }`}
                    onClick={() => {
                      onTemplateChange(null, "");
                      setPanelOpen(false);
                    }}
                  >
                    {t("styleTemplate.noTemplate")}
                  </button>

                  {styleTemplates.length > 0 ? (
                    <div className="my-1 border-t border-border" />
                  ) : null}

                  {styleTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
                        selectedTemplateId === template.id
                          ? "bg-accent/15 text-accent"
                          : "text-text-muted hover:bg-surface-hover"
                      }`}
                      onClick={() => {
                        onTemplateChange(template.id, template.prompt);
                        setPanelOpen(false);
                      }}
                    >
                      {template.name}
                    </button>
                  ))}

                  <div className="my-1 border-t border-border" />

                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover"
                    onClick={() => {
                      setPanelOpen(false);
                      setShowManager(true);
                    }}
                  >
                    <Settings className="h-3 w-3" />
                    {t("styleTemplate.manageTemplates")}
                  </button>
                </UiPanel>
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
