import { memo, useEffect, useMemo, useState } from "react";
import { FolderTree, History, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiPanel } from "@/components/ui";
import {
  STYLE_TEMPLATE_ALL_CATEGORY_ID,
  STYLE_TEMPLATE_RECENT_CATEGORY_ID,
  STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
  sortStyleTemplateCategories,
  sortStyleTemplates,
} from "@/features/project/styleTemplateUtils";
import { useSettingsStore } from "@/stores/settingsStore";

interface StyleTemplateMenuPanelProps {
  selectedTemplateId: string | null;
  onTemplateChange: (templateId: string | null, prompt: string) => void;
  onManage: () => void;
  onRequestClose: () => void;
  className?: string;
}

interface StyleTemplateMenuCategoryItem {
  id: string;
  name: string;
  count: number;
  icon?: "all" | "recent";
}

export const StyleTemplateMenuPanel = memo(
  ({
    selectedTemplateId,
    onTemplateChange,
    onManage,
    onRequestClose,
    className = "",
  }: StyleTemplateMenuPanelProps) => {
    const { t } = useTranslation();
    const styleTemplateCategories = useSettingsStore(
      (state) => state.styleTemplateCategories,
    );
    const styleTemplates = useSettingsStore((state) => state.styleTemplates);
    const markStyleTemplateUsed = useSettingsStore(
      (state) => state.markStyleTemplateUsed,
    );

    const sortedCategories = useMemo(
      () => sortStyleTemplateCategories(styleTemplateCategories),
      [styleTemplateCategories],
    );
    const sortedTemplates = useMemo(
      () => sortStyleTemplates(styleTemplates),
      [styleTemplates],
    );
    const selectedTemplate = useMemo(
      () =>
        selectedTemplateId
          ? sortedTemplates.find((template) => template.id === selectedTemplateId) ??
            null
          : null,
      [selectedTemplateId, sortedTemplates],
    );
    const ungroupedTemplates = useMemo(
      () => sortedTemplates.filter((template) => !template.categoryId),
      [sortedTemplates],
    );
    const recentTemplates = useMemo(
      () =>
        [...sortedTemplates]
          .filter(
            (template) =>
              typeof template.lastUsedAt === "number" && template.lastUsedAt > 0,
          )
          .sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0))
          .slice(0, 12),
      [sortedTemplates],
    );
    const menuCategories = useMemo(() => {
      const items: StyleTemplateMenuCategoryItem[] = [
        {
          id: STYLE_TEMPLATE_ALL_CATEGORY_ID,
          name: t("styleTemplate.all"),
          count: sortedTemplates.length,
          icon: "all",
        },
      ];

      if (recentTemplates.length > 0) {
        items.push({
          id: STYLE_TEMPLATE_RECENT_CATEGORY_ID,
          name: t("styleTemplate.recent"),
          count: recentTemplates.length,
          icon: "recent",
        });
      }

      if (ungroupedTemplates.length > 0) {
        items.push({
          id: STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
          name: t("styleTemplate.uncategorized"),
          count: ungroupedTemplates.length,
        });
      }

      items.push(
        ...sortedCategories.map((category) => ({
          id: category.id,
          name: category.name,
          count: sortedTemplates.filter(
            (template) => template.categoryId === category.id,
          ).length,
        })),
      );

      return items;
    }, [recentTemplates.length, sortedCategories, sortedTemplates, t, ungroupedTemplates.length]);
    const initialCategoryId = useMemo(() => {
      if (selectedTemplate?.categoryId) {
        return selectedTemplate.categoryId;
      }

      if (selectedTemplate) {
        return STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID;
      }

      return STYLE_TEMPLATE_ALL_CATEGORY_ID;
    }, [selectedTemplate]);
    const [activeCategoryId, setActiveCategoryId] = useState(initialCategoryId);

    useEffect(() => {
      setActiveCategoryId(initialCategoryId);
    }, [initialCategoryId]);

    useEffect(() => {
      if (menuCategories.some((category) => category.id === activeCategoryId)) {
        return;
      }

      setActiveCategoryId(STYLE_TEMPLATE_ALL_CATEGORY_ID);
    }, [activeCategoryId, menuCategories]);

    const visibleTemplates = useMemo(() => {
      if (activeCategoryId === STYLE_TEMPLATE_RECENT_CATEGORY_ID) {
        return recentTemplates;
      }

      if (activeCategoryId === STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID) {
        return ungroupedTemplates;
      }

      if (activeCategoryId === STYLE_TEMPLATE_ALL_CATEGORY_ID) {
        return sortedTemplates;
      }

      return sortedTemplates.filter(
        (template) => template.categoryId === activeCategoryId,
      );
    }, [
      activeCategoryId,
      recentTemplates,
      sortedTemplates,
      ungroupedTemplates,
    ]);
    const activeCategoryName =
      menuCategories.find((category) => category.id === activeCategoryId)?.name ??
      t("styleTemplate.all");

    return (
      <UiPanel
        className={`w-[440px] max-w-[calc(100vw-24px)] overflow-hidden p-0 ${className}`}
      >
        <div className="grid grid-cols-[148px_minmax(0,1fr)]">
          <div className="border-r border-white/10 bg-black/10 p-1">
            {menuCategories.map((category) => {
              const isActive = category.id === activeCategoryId;
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors last:mb-0 ${
                    isActive
                      ? "bg-accent/15 text-accent"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-dark"
                  }`}
                  onClick={() => setActiveCategoryId(category.id)}
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {category.icon === "all" ? (
                      <FolderTree className="h-3.5 w-3.5 shrink-0" />
                    ) : category.icon === "recent" ? (
                      <History className="h-3.5 w-3.5 shrink-0" />
                    ) : null}
                    <span className="truncate">{category.name}</span>
                  </span>
                  <span className="ml-2 shrink-0 text-[10px] opacity-70">
                    {category.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex min-h-[280px] max-h-[360px] min-w-0 flex-col">
            <div className="border-b border-white/10 px-3 py-2 text-xs font-medium text-text-muted">
              {activeCategoryName}
            </div>

            <div className="ui-scrollbar flex-1 space-y-1 overflow-y-auto p-1.5">
              {visibleTemplates.length === 0 ? (
                <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-xs text-text-muted">
                  {activeCategoryId === STYLE_TEMPLATE_RECENT_CATEGORY_ID
                    ? t("styleTemplate.recentEmpty")
                    : t("styleTemplate.emptyCategory")}
                </div>
              ) : (
                visibleTemplates.map((template) => {
                  const isSelected = selectedTemplateId === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        isSelected
                          ? "border-accent/35 bg-accent/12 text-text-dark"
                          : "border-white/10 bg-white/[0.03] text-text-muted hover:bg-white/[0.05] hover:text-text-dark"
                      }`}
                      onClick={() => {
                        if (isSelected) {
                          onTemplateChange(null, "");
                          onRequestClose();
                          return;
                        }

                        markStyleTemplateUsed(template.id);
                        onTemplateChange(template.id, template.prompt);
                        onRequestClose();
                      }}
                    >
                      <div className="truncate text-sm font-medium">
                        {template.name}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">
                        {template.prompt}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-t border-white/10 p-1.5">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text-dark"
                onClick={() => {
                  onRequestClose();
                  onManage();
                }}
              >
                <Settings className="h-3.5 w-3.5" />
                {t("styleTemplate.manageTemplates")}
              </button>
            </div>
          </div>
        </div>
      </UiPanel>
    );
  },
);

StyleTemplateMenuPanel.displayName = "StyleTemplateMenuPanel";
