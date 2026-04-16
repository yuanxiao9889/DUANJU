import { useEffect, useMemo, useState } from "react";
import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiButton, UiInput, UiModal, UiSelect, UiTextArea } from "@/components/ui";
import {
  STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
  sortStyleTemplateCategories,
  sortStyleTemplates,
  type StyleTemplate,
  type StyleTemplateCategory,
} from "@/features/project/styleTemplateUtils";
import { useSettingsStore } from "@/stores/settingsStore";

interface StyleTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface EditCategoryModalProps {
  isOpen: boolean;
  initialName?: string;
  title: string;
  onClose: () => void;
  onSave: (name: string) => void;
}

interface EditTemplateModalProps {
  isOpen: boolean;
  title: string;
  initialTemplate?: StyleTemplate | null;
  initialCategoryId: string | null;
  categories: StyleTemplateCategory[];
  onClose: () => void;
  onSave: (input: {
    name: string;
    prompt: string;
    categoryId: string | null;
  }) => void;
}

interface DeleteConfirmState {
  type: "template" | "category";
  id: string;
  name: string;
  affectedTemplateCount?: number;
}

function EditCategoryModal({
  isOpen,
  initialName = "",
  title,
  onClose,
  onSave,
}: EditCategoryModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setName(initialName);
  }, [initialName, isOpen]);

  return (
    <UiModal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      widthClassName="w-[calc(100vw-32px)] max-w-[420px]"
      footer={
        <>
          <UiButton type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={!name.trim()}
            onClick={() => onSave(name.trim())}
          >
            {t("common.save")}
          </UiButton>
        </>
      }
    >
      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
          {t("styleTemplate.categoryName")}
        </label>
        <UiInput
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("styleTemplate.categoryNamePlaceholder")}
        />
      </div>
    </UiModal>
  );
}

function EditTemplateModal({
  isOpen,
  title,
  initialTemplate,
  initialCategoryId,
  categories,
  onClose,
  onSave,
}: EditTemplateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialTemplate?.name ?? "");
  const [prompt, setPrompt] = useState(initialTemplate?.prompt ?? "");
  const [categoryId, setCategoryId] = useState<string>(
    initialTemplate?.categoryId ?? initialCategoryId ?? STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setName(initialTemplate?.name ?? "");
    setPrompt(initialTemplate?.prompt ?? "");
    setCategoryId(
      initialTemplate?.categoryId ??
        initialCategoryId ??
        STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
    );
  }, [initialCategoryId, initialTemplate, isOpen]);

  return (
    <UiModal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      widthClassName="w-[calc(100vw-32px)] max-w-[560px]"
      footer={
        <>
          <UiButton type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={!name.trim() || !prompt.trim()}
            onClick={() =>
              onSave({
                name: name.trim(),
                prompt: prompt.trim(),
                categoryId:
                  categoryId === STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID
                    ? null
                    : categoryId,
              })
            }
          >
            {t("common.save")}
          </UiButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
            {t("styleTemplate.templateName")}
          </label>
          <UiInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("styleTemplate.templateNamePlaceholder")}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
            {t("styleTemplate.category")}
          </label>
          <UiSelect
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value={STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID}>
              {t("styleTemplate.uncategorized")}
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </UiSelect>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
            {t("styleTemplate.templatePrompt")}
          </label>
          <UiTextArea
            rows={7}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("styleTemplate.templatePromptPlaceholder")}
          />
        </div>
      </div>
    </UiModal>
  );
}

function DeleteConfirmModal({
  state,
  onClose,
  onConfirm,
}: {
  state: DeleteConfirmState | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <UiModal
      isOpen={Boolean(state)}
      title={t("styleTemplate.deleteTitle")}
      onClose={onClose}
      widthClassName="w-[calc(100vw-32px)] max-w-[440px]"
      footer={
        <>
          <UiButton type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </UiButton>
          <UiButton type="button" variant="primary" onClick={onConfirm}>
            {t("common.delete")}
          </UiButton>
        </>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        {state?.type === "category"
          ? t("styleTemplate.deleteCategoryConfirm", {
              name: state.name,
              count: state.affectedTemplateCount ?? 0,
            })
          : t("styleTemplate.deleteTemplateConfirm", {
              name: state?.name ?? "",
            })}
      </p>
    </UiModal>
  );
}

export function StyleTemplateDialog({
  isOpen,
  onClose,
}: StyleTemplateDialogProps) {
  const { t } = useTranslation();
  const styleTemplateCategories = useSettingsStore(
    (state) => state.styleTemplateCategories,
  );
  const styleTemplates = useSettingsStore((state) => state.styleTemplates);
  const addStyleTemplateCategory = useSettingsStore(
    (state) => state.addStyleTemplateCategory,
  );
  const updateStyleTemplateCategory = useSettingsStore(
    (state) => state.updateStyleTemplateCategory,
  );
  const deleteStyleTemplateCategory = useSettingsStore(
    (state) => state.deleteStyleTemplateCategory,
  );
  const addStyleTemplate = useSettingsStore((state) => state.addStyleTemplate);
  const updateStyleTemplate = useSettingsStore(
    (state) => state.updateStyleTemplate,
  );
  const deleteStyleTemplate = useSettingsStore(
    (state) => state.deleteStyleTemplate,
  );

  const sortedCategories = useMemo(
    () => sortStyleTemplateCategories(styleTemplateCategories),
    [styleTemplateCategories],
  );
  const sortedTemplates = useMemo(
    () => sortStyleTemplates(styleTemplates),
    [styleTemplates],
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID,
  );
  const [editingCategory, setEditingCategory] =
    useState<StyleTemplateCategory | null>(null);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<StyleTemplate | null>(null);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DeleteConfirmState | null>(
    null,
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedCategoryId((currentCategoryId) => {
      if (currentCategoryId === STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID) {
        return currentCategoryId;
      }

      if (sortedCategories.some((category) => category.id === currentCategoryId)) {
        return currentCategoryId;
      }

      return sortedCategories[0]?.id ?? STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID;
    });
  }, [isOpen, sortedCategories]);

  const selectedCategoryName =
    selectedCategoryId === STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID
      ? t("styleTemplate.uncategorized")
      : sortedCategories.find((category) => category.id === selectedCategoryId)
          ?.name ?? t("styleTemplate.uncategorized");
  const filteredTemplates = useMemo(
    () =>
      selectedCategoryId === STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID
        ? sortedTemplates.filter((template) => !template.categoryId)
        : sortedTemplates.filter(
            (template) => template.categoryId === selectedCategoryId,
          ),
    [selectedCategoryId, sortedTemplates],
  );

  return (
    <>
      <UiModal
        isOpen={isOpen}
        title={t("styleTemplate.title")}
        onClose={onClose}
        widthClassName="w-[calc(100vw-40px)] max-w-[980px]"
      >
        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-text-dark">
                {t("styleTemplate.categoryTitle")}
              </div>
              <UiButton
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowCreateCategory(true)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("styleTemplate.newCategory")}
              </UiButton>
            </div>

            <div className="mt-3 space-y-2">
              <button
                type="button"
                className={`group flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${
                  selectedCategoryId === STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID
                    ? "border-accent/35 bg-accent/12 text-text-dark"
                    : "border-white/10 bg-white/[0.03] text-text-muted hover:bg-white/[0.05]"
                }`}
                onClick={() =>
                  setSelectedCategoryId(STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID)
                }
              >
                <span className="truncate text-sm">
                  {t("styleTemplate.uncategorized")}
                </span>
                <span className="ml-2 shrink-0 text-[11px] opacity-70">
                  {sortedTemplates.filter((template) => !template.categoryId).length}
                </span>
              </button>

              {sortedCategories.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-text-muted">
                  {t("styleTemplate.emptyCategoryHint")}
                </div>
              ) : (
                sortedCategories.map((category) => {
                  const templateCount = sortedTemplates.filter(
                    (template) => template.categoryId === category.id,
                  ).length;
                  const isActive = selectedCategoryId === category.id;

                  return (
                    <div
                      key={category.id}
                      className={`group rounded-xl border px-3 py-2 transition-colors ${
                        isActive
                          ? "border-accent/35 bg-accent/12"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setSelectedCategoryId(category.id)}
                        >
                          <div className="truncate text-sm font-medium text-text-dark">
                            {category.name}
                          </div>
                          <div className="mt-1 text-[11px] text-text-muted">
                            {t("styleTemplate.templateCount", {
                              count: templateCount,
                            })}
                          </div>
                        </button>

                        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-dark"
                            onClick={() => setEditingCategory(category)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-rose-500/12 hover:text-rose-300"
                            onClick={() =>
                              setPendingDelete({
                                type: "category",
                                id: category.id,
                                name: category.name,
                                affectedTemplateCount: templateCount,
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-sm font-medium text-text-dark">
                  <FolderTree className="h-4 w-4 text-text-muted" />
                  {selectedCategoryName}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {t("styleTemplate.templateCount", {
                    count: filteredTemplates.length,
                  })}
                </div>
              </div>

              <UiButton
                type="button"
                size="sm"
                variant="primary"
                onClick={() => setShowCreateTemplate(true)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("styleTemplate.newTemplate")}
              </UiButton>
            </div>

            <div className="ui-scrollbar mt-3 max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {filteredTemplates.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-text-muted">
                  {t("styleTemplate.emptyTemplateHint")}
                </div>
              ) : (
                filteredTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="group rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.05]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-dark">
                          {template.name}
                        </div>
                        <div className="mt-2 line-clamp-3 text-xs leading-5 text-text-muted">
                          {template.prompt}
                        </div>
                      </div>

                      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-dark"
                          onClick={() => setEditingTemplate(template)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-rose-500/12 hover:text-rose-300"
                          onClick={() =>
                            setPendingDelete({
                              type: "template",
                              id: template.id,
                              name: template.name,
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </UiModal>

      <EditCategoryModal
        isOpen={showCreateCategory}
        title={t("styleTemplate.newCategory")}
        onClose={() => setShowCreateCategory(false)}
        onSave={(name) => {
          const nextCategoryId = addStyleTemplateCategory({ name });
          if (nextCategoryId) {
            setSelectedCategoryId(nextCategoryId);
          }
          setShowCreateCategory(false);
        }}
      />

      <EditCategoryModal
        isOpen={Boolean(editingCategory)}
        initialName={editingCategory?.name ?? ""}
        title={t("styleTemplate.editCategory")}
        onClose={() => setEditingCategory(null)}
        onSave={(name) => {
          if (!editingCategory) {
            return;
          }

          updateStyleTemplateCategory(editingCategory.id, { name });
          setEditingCategory(null);
        }}
      />

      <EditTemplateModal
        isOpen={showCreateTemplate}
        title={t("styleTemplate.newTemplate")}
        initialCategoryId={
          selectedCategoryId === STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID
            ? null
            : selectedCategoryId
        }
        categories={sortedCategories}
        onClose={() => setShowCreateTemplate(false)}
        onSave={(input) => {
          addStyleTemplate(input);
          setShowCreateTemplate(false);
        }}
      />

      <EditTemplateModal
        isOpen={Boolean(editingTemplate)}
        title={t("styleTemplate.editTemplate")}
        initialTemplate={editingTemplate}
        initialCategoryId={editingTemplate?.categoryId ?? null}
        categories={sortedCategories}
        onClose={() => setEditingTemplate(null)}
        onSave={(input) => {
          if (!editingTemplate) {
            return;
          }

          updateStyleTemplate(editingTemplate.id, input);
          setEditingTemplate(null);
        }}
      />

      <DeleteConfirmModal
        state={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) {
            return;
          }

          if (pendingDelete.type === "category") {
            deleteStyleTemplateCategory(pendingDelete.id);
            if (selectedCategoryId === pendingDelete.id) {
              setSelectedCategoryId(STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID);
            }
          } else {
            deleteStyleTemplate(pendingDelete.id);
          }

          setPendingDelete(null);
        }}
      />
    </>
  );
}
