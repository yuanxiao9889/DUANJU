import { memo, useEffect, useMemo, useState } from "react";
import { FolderTree, History, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiPanel } from "@/components/ui";
import { StyleTemplateCard } from "@/features/project/StyleTemplateCard";
import {
  STYLE_TEMPLATE_ALL_CATEGORY_ID,
  STYLE_TEMPLATE_RECENT_CATEGORY_ID,
  STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
  sortStyleTemplateCategories,
  sortStyleTemplates,
  type StyleTemplate,
} from "@/features/project/styleTemplateUtils";
import { useSettingsStore } from "@/stores/settingsStore";

interface StyleTemplateMenuPanelProps {
  onTemplateApply: (template: StyleTemplate) => void;
  onManage: () => void;
  onRequestClose: () => void;
  className?: string;
  embedded?: boolean;
}

interface StyleTemplateMenuCategoryItem {
  id: string;
  name: string;
  count: number;
  icon?: "all" | "recent";
}

export const StyleTemplateMenuPanel = memo(
  ({
    onTemplateApply,
    onManage,
    onRequestClose,
    className = "",
    embedded = false,
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
    }, [
      recentTemplates.length,
      sortedCategories,
      sortedTemplates,
      t,
      ungroupedTemplates.length,
    ]);

    const [activeCategoryId, setActiveCategoryId] = useState(
      STYLE_TEMPLATE_ALL_CATEGORY_ID,
    );

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

    const panelContent = (
      <div className="grid h-[470px] max-h-[calc(100vh-180px)] grid-cols-[136px_minmax(0,1fr)] gap-2.5 overflow-hidden">
        <div className="ui-scrollbar overflow-y-auto rounded-[14px] border border-white/[0.05] bg-black/[0.14] p-2">
          {menuCategories.map((category) => {
            const isActive = category.id === activeCategoryId;
            return (
              <button
                key={category.id}
                type="button"
                className={`mb-1 flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-xs transition-colors last:mb-0 ${
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

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-white/[0.05] bg-white/[0.015]">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-2">
            <div className="text-xs font-medium text-text-muted">
              {activeCategoryName}
            </div>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.06] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-dark"
              title={t("styleTemplate.manageTemplates")}
              aria-label={t("styleTemplate.manageTemplates")}
              onClick={() => {
                onRequestClose();
                onManage();
              }}
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="ui-scrollbar flex-1 overflow-y-auto px-4 py-3">
            {visibleTemplates.length === 0 ? (
              <div className="flex min-h-[240px] items-center justify-center px-6 text-center text-xs text-text-muted">
                {activeCategoryId === STYLE_TEMPLATE_RECENT_CATEGORY_ID
                  ? t("styleTemplate.recentEmpty")
                  : t("styleTemplate.emptyCategory")}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,132px))] content-start justify-start gap-3">
                {visibleTemplates.map((template) => (
                  <StyleTemplateCard
                    key={template.id}
                    template={template}
                    size="compact"
                    className="w-full"
                    onClick={() => {
                      markStyleTemplateUsed(template.id);
                      onTemplateApply(template);
                      onRequestClose();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );

    if (embedded) {
      return <div className={className}>{panelContent}</div>;
    }

    return (
      <UiPanel
        className={`w-[820px] max-w-[calc(100vw-32px)] overflow-hidden p-0 ${className}`}
      >
        {panelContent}
      </UiPanel>
    );
  },
);

StyleTemplateMenuPanel.displayName = "StyleTemplateMenuPanel";
