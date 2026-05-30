import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { CanvasHandle } from "@/features/canvas/ui/CanvasHandle";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, FileText, Images, LayoutTemplate, PackageSearch, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UiInput, UiSelect, UiTextAreaField } from "@/components/ui";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import {
  CANVAS_NODE_TYPES,
  type CommerceAgentPlanNodeData,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
  type CommerceVisualPreferenceNodeData,
  type CanvasNodeType,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { nodeHasSourceHandle, nodeHasTargetHandle } from "@/features/canvas/domain/nodeRegistry";
import {
  BRAND_ACCENT_PRESETS,
  VISUAL_PREFERENCE_OPTION_KEYS,
  buildVisualPreferencePatch,
} from "@/features/commerce-ad/application/commerceAdVisualPreference";
import { normalizeCommerceAdVisualPreferenceState } from "@/features/commerce-ad/types";
import type { CommerceAdDetailPage, CommercePromptSpec } from "@/features/commerce-ad/types";
import {
  getImageModel,
  getModelProvider,
  listImageModels,
  resolveImageModelResolution,
  resolveImageModelResolutions,
  STORYBOARD_OOPII_MODEL_ID,
} from "@/features/canvas/models";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import {
  SCRIPT_NODE_EMPTY_HINT_CLASS,
  SCRIPT_NODE_SCROLL_AREA_CLASS,
  SCRIPT_NODE_SECTION_CARD_CLASS,
  SCRIPT_NODE_TEXTAREA_CLASS,
  ScriptNodeCard,
  resolveScriptNodeDimension,
} from "./ScriptNodeCard";

type CommerceStageNodeData =
  | CommerceProductNodeData
  | CommerceBriefNodeData
  | CommerceVisualPreferenceNodeData
  | CommerceBatchGenerateNodeData
  | CommerceAgentPlanNodeData
  | CommerceResultGroupNodeData;

type CommerceStageNodeProps = NodeProps & {
  id: string;
  type: CanvasNodeType;
  data: CommerceStageNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const DEFAULT_WIDTH = 360;
const LEGACY_DEFAULT_HEIGHT = 460;
const COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT = 5;
const COMMERCE_START_IMAGE_GENERATION_EVENT = "commerce-ad:start-image-generation";
const COMMERCE_START_AGENT_PLAN_GENERATION_EVENT = "commerce-ad:start-agent-plan-generation";
const COMMERCE_RETRY_IMAGE_GENERATION_EVENT = "commerce-ad:retry-image-generation";
const COMMERCE_SYNC_DOWNSTREAM_EVENT = "commerce-ad:sync-downstream";
const COMMERCE_INFER_PRODUCT_EVENT = "commerce-ad:infer-product";
const COMMERCE_UPLOAD_PRODUCT_IMAGE_EVENT = "commerce-ad:upload-product-image";
const COMMERCE_DEFAULT_IMAGE_MODEL_ID = STORYBOARD_OOPII_MODEL_ID;

function resolveCommerceDefaultResolution(
  model: Parameters<typeof resolveImageModelResolutions>[0],
): string {
  const resolutions = resolveImageModelResolutions(model, { extraParams: {} });
  return (
    resolutions.find((item) => item.value === "2K")?.value
    ?? resolutions.find((item) => item.value === model.defaultResolution)?.value
    ?? resolutions[0]?.value
    ?? model.defaultResolution
  );
}

function resolveCommerceAspectRatiosForModel(
  model: Parameters<typeof resolveImageModelResolutions>[0],
  preferredRatios: string[],
): string[] {
  const supportedRatios = new Set(model.aspectRatios.map((item) => item.value));
  const selectedRatios = preferredRatios.filter((ratio) => supportedRatios.has(ratio));
  if (selectedRatios.length > 0) {
    return selectedRatios;
  }

  const defaultRatio = supportedRatios.has(model.defaultAspectRatio)
    ? model.defaultAspectRatio
    : model.aspectRatios[0]?.value;
  return defaultRatio ? [defaultRatio] : preferredRatios;
}

function dispatchCommerceSyncDownstream() {
  window.dispatchEvent(new CustomEvent(COMMERCE_SYNC_DOWNSTREAM_EVENT));
}

function dispatchCommerceInferProduct() {
  window.dispatchEvent(new CustomEvent(COMMERCE_INFER_PRODUCT_EVENT));
}

function dispatchCommerceUploadProductImage() {
  window.dispatchEvent(new CustomEvent(COMMERCE_UPLOAD_PRODUCT_IMAGE_EVENT));
}

function SyncDownstreamButton() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="nodrag nowheel inline-flex h-8 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-text-dark/15 bg-text-dark/10 px-3 text-xs font-medium text-text-dark transition-colors hover:bg-text-dark/15"
      onClick={dispatchCommerceSyncDownstream}
    >
      <RefreshCw className="h-3.5 w-3.5" />
      {t("commerceAd.agent.syncProductInfo")}
    </button>
  );
}

function InferProductButton() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="nodrag nowheel inline-flex h-8 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-text-dark/15 bg-text-dark/10 px-3 text-xs font-medium text-text-dark transition-colors hover:bg-text-dark/15"
      onClick={dispatchCommerceInferProduct}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {t("commerceAd.agent.inferProduct")}
    </button>
  );
}

function TextAreaControl({
  label,
  value,
  rows = 3,
  onChange,
}: {
  label: string;
  value: string;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col text-[11px] text-text-muted">
      <span>{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className={`nodrag nowheel mt-1 ${SCRIPT_NODE_TEXTAREA_CLASS}`}
      />
    </label>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return null;
  }

  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/[0.08] px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-text-dark">
        {normalizedValue}
      </div>
    </div>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const hasCurrentValue = value.trim().length > 0 && options.some((option) => option.value === value);
  const selectedValue = hasCurrentValue ? value : options[0]?.value ?? "";

  return (
    <label className="block text-[11px] text-text-muted">
      <span>{label}</span>
      <UiSelect
        value={selectedValue}
        className="nodrag nowheel mt-1 h-9 bg-black/[0.08]"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </UiSelect>
    </label>
  );
}

function hasCjkText(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function isMostlyEnglishText(value: string): boolean {
  const letters = value.match(/[a-z]/gi)?.length ?? 0;
  const cjk = value.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  return letters >= 8 && cjk === 0;
}

function extractChineseChipCandidates(text: string): string[] {
  if (!hasCjkText(text)) {
    return [];
  }

  return text
    .split(/[\n。；;，,、]/u)
    .map((item) => item.replace(/^[\s:：\-·•]+|[\s:：。；;，,、]+$/gu, "").trim())
    .filter((item) => hasCjkText(item) && item.length >= 2 && item.length <= 22)
    .map((item) => item.replace(/^(优势是|可见卖点|重点卖点|核心卖点|卖点|特点)[:：]?/u, "").trim())
    .filter((item) => hasCjkText(item) && item.length >= 2 && item.length <= 18);
}

function resolveDisplayChips(items: string[], fallbackText = ""): string[] {
  const cleanedItems = Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
  const chineseItems = cleanedItems.filter((item) => hasCjkText(item));
  if (chineseItems.length > 0) {
    return chineseItems;
  }

  const nonEnglishItems = cleanedItems.filter((item) => !isMostlyEnglishText(item));
  const fallbackItems = extractChineseChipCandidates(fallbackText);
  if (fallbackItems.length > 0 && cleanedItems.some(isMostlyEnglishText)) {
    return Array.from(new Set(fallbackItems)).slice(0, 6);
  }

  return nonEnglishItems;
}

function ChipList({ items, fallbackText = "" }: { items: string[]; fallbackText?: string }) {
  const displayItems = resolveDisplayChips(items, fallbackText);
  if (displayItems.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {displayItems.map((item) => (
        <span
          key={item}
          className="rounded-full border border-border-dark/45 bg-bg-dark/80 px-2 py-1 text-[11px] text-text-dark"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function PromptSpecSummary({ spec }: { spec?: CommercePromptSpec }) {
  if (!spec) {
    return null;
  }

  const rows = [
    ["任务", spec.task],
    ["产品主体", spec.subject],
    ["广告目标", spec.audienceAndGoal],
    ["视觉方向", spec.artDirection],
    ["构图", spec.composition],
    ["文案策略", spec.copyStrategy],
    ["平台适配", spec.platformAdaptation],
    ["参考图使用", spec.referenceUsage],
  ].filter(([, value]) => value.trim().length > 0);
  const checklist = [...spec.negativeConstraints, ...spec.qualityChecklist].filter(Boolean);

  if (rows.length === 0 && checklist.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {rows.map(([label, value]) => (
        <FieldRow key={label} label={label} value={value} />
      ))}
      <ChipList items={checklist.slice(0, 8)} />
    </div>
  );
}

function CompactDisclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string | null;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/[0.06]">
      <button
        type="button"
        className="nodrag nowheel flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
        onClick={() => setIsOpen((value) => !value)}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${isOpen ? "" : "-rotate-90"}`}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-dark">
          {title}
        </span>
        {summary ? (
          <span className="max-w-[52%] truncate text-[11px] text-text-muted">
            {summary}
          </span>
        ) : null}
      </button>
      {isOpen ? (
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function createEmptyDetailPage(pageNo: number, title: string): CommerceAdDetailPage {
  return {
    id: `commerce-detail-page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    pageNo,
    title,
    pageGoal: "",
    lockedCopy: "",
    optimizedCopy: "",
    layoutNotes: "",
    blueprint: "",
    referenceImageIds: [],
    qualityNotes: [],
    prompt: "",
  };
}

function normalizeDetailPageOrder(pages: CommerceAdDetailPage[]): CommerceAdDetailPage[] {
  return pages.map((page, index) => ({
    ...page,
    pageNo: index + 1,
  }));
}

function ProductContent({ data }: { data: CommerceProductNodeData }) {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const nodes = useCanvasStore((state) => state.nodes);
  const node = nodes.find((item) => item.type === CANVAS_NODE_TYPES.commerceProduct);
  const briefNode = nodes.find((item) => item.type === CANVAS_NODE_TYPES.commerceBrief);
  const batchNode = nodes.find((item) => item.type === CANVAS_NODE_TYPES.commerceBatchGenerate);
  const manualPages = useMemo(() => normalizeDetailPageOrder(
    ((batchNode?.data as CommerceBatchGenerateNodeData | undefined)?.detailPages?.length
      ? (batchNode?.data as CommerceBatchGenerateNodeData).detailPages
      : (briefNode?.data as CommerceBriefNodeData | undefined)?.detailPages) ?? [],
  ), [batchNode?.data, briefNode?.data]);
  const visibleImages = data.images.slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
  const inference = data.inference;
  const updateProduct = useCallback((patch: Partial<CommerceProductNodeData>) => {
    if (!node) {
      return;
    }
    updateNodeData(node.id, patch);
  }, [node, updateNodeData]);
  const updateImageDescription = useCallback((imageId: string, description: string) => {
    updateProduct({
      images: data.images.map((image) => (
        image.id === imageId ? { ...image, description } : image
      )),
    } as Partial<CommerceProductNodeData>);
  }, [data.images, updateProduct]);
  const updateDetailPages = useCallback((pages: CommerceAdDetailPage[]) => {
    const nextPages = normalizeDetailPageOrder(pages);
    if (briefNode) {
      updateNodeData(briefNode.id, {
        detailPages: nextPages,
        updatedAt: Date.now(),
      } as Partial<CommerceBriefNodeData>);
    }
    if (batchNode) {
      updateNodeData(batchNode.id, {
        generationMode: "detailPages",
        detailPages: nextPages,
        detailPageIds: nextPages.map((page) => page.id),
        detailPageCount: nextPages.length,
      } as Partial<CommerceBatchGenerateNodeData>);
    }
  }, [batchNode, briefNode, updateNodeData]);
  const addDetailPage = useCallback(() => {
    updateDetailPages([
      ...manualPages,
      createEmptyDetailPage(
        manualPages.length + 1,
        t("commerceAd.agent.detailPages.defaultTitle", { page: manualPages.length + 1 }),
      ),
    ]);
  }, [manualPages, t, updateDetailPages]);
  const updateDetailPage = useCallback((pageId: string, patch: Partial<CommerceAdDetailPage>) => {
    updateDetailPages(manualPages.map((page) => (
      page.id === pageId ? { ...page, ...patch } : page
    )));
  }, [manualPages, updateDetailPages]);
  const deleteDetailPage = useCallback((pageId: string) => {
    updateDetailPages(manualPages.filter((page) => page.id !== pageId));
  }, [manualPages, updateDetailPages]);
  const moveDetailPage = useCallback((pageId: string, direction: -1 | 1) => {
    const currentIndex = manualPages.findIndex((page) => page.id === pageId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= manualPages.length) {
      return;
    }
    const nextPages = [...manualPages];
    const [page] = nextPages.splice(currentIndex, 1);
    nextPages.splice(nextIndex, 0, page);
    updateDetailPages(nextPages);
  }, [manualPages, updateDetailPages]);
  const handleModeChange = useCallback((mode: CommerceProductNodeData["detailInputMode"]) => {
    updateProduct({ detailInputMode: mode });
    if (mode === "manualPages" && manualPages.length === 0) {
      updateDetailPages([
        createEmptyDetailPage(1, t("commerceAd.agent.detailPages.defaultTitle", { page: 1 })),
      ]);
    }
  }, [manualPages.length, t, updateDetailPages, updateProduct]);

  return (
    <div className="nodrag nowheel flex min-h-0 flex-1 flex-col gap-3">
      {visibleImages.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-white/[0.07] bg-black/[0.14] p-2">
          {visibleImages.map((image, index) => (
            <div
              key={image.id}
              className="group flex gap-2 rounded-lg border border-border-dark/70 bg-bg-dark p-2"
            >
              <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border border-border-dark/60 bg-black/20">
                <img
                  src={resolveImageDisplayUrl(
                    image.previewImageUrl || image.imageUrl,
                  )}
                  alt={image.label}
                  className="h-full w-full object-contain"
                  draggable={false}
                />
                <span className="absolute left-1 top-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {index === 0
                    ? t("commerceAd.agent.productImageRoleMain")
                    : t("commerceAd.agent.productImageRoleReference", { index })}
                </span>
              </div>
              <UiTextAreaField
                value={image.description ?? ""}
                rows={3}
                className="min-h-[72px] flex-1 px-2 py-1.5 text-xs leading-5"
                onChange={(event) => updateImageDescription(image.id, event.target.value)}
                placeholder={t("commerceAd.agent.productImageDescriptionPlaceholder")}
              />
            </div>
          ))}
          {visibleImages.length < COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT ? (
            <button
              type="button"
              className="nodrag nowheel flex min-h-[64px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-dark/80 bg-bg-dark/45 text-xs text-text-muted transition hover:border-text-dark/40 hover:bg-text-dark/[0.06] hover:text-text-dark"
              onClick={dispatchCommerceUploadProductImage}
            >
              <Plus className="h-4 w-4" />
              {t("commerceAd.agent.addProductReferenceImage", {
                limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
              })}
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className={`${SCRIPT_NODE_EMPTY_HINT_CLASS} nodrag nowheel flex min-h-[72px] w-full items-center justify-center gap-2 transition hover:border-text-dark/40 hover:bg-text-dark/[0.06] hover:text-text-dark`}
          onClick={dispatchCommerceUploadProductImage}
        >
          <Plus className="h-4 w-4" />
          {t("commerceAd.agent.addProductReferenceImage", {
            limit: COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT,
          })}
        </button>
      )}
      <FieldRow
        label={t("commerceAd.fields.productName")}
        value={data.productName}
      />
      <FieldRow label={t("commerceAd.fields.brand")} value={data.brand} />
      <FieldRow label={t("commerceAd.fields.category")} value={data.category} />
      <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
        <div className="inline-grid w-full grid-cols-2 gap-1.5 rounded-full bg-bg-dark/35 p-0.5">
          {(["auto", "manualPages"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleModeChange(mode)}
              className={`nodrag nowheel inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
                data.detailInputMode === mode
                  ? "border-text-dark/25 bg-surface-dark text-text-dark shadow-[0_6px_18px_rgba(0,0,0,0.18)]"
                  : "border-transparent text-text-muted hover:bg-text-dark/[0.05] hover:text-text-dark"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${
                data.detailInputMode === mode ? "bg-text-dark" : "bg-text-muted/45"
              }`} />
              {t(`commerceAd.agent.detailInputMode.${mode}`)}
            </button>
          ))}
        </div>
        {data.detailInputMode === "manualPages" ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-2 text-xs leading-5 text-text-muted">
              {t("commerceAd.agent.detailInputMode.manualHint")}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-text-dark">
                {t("commerceAd.agent.detailPages.manualFixedInfoTitle")}
              </div>
              <button
                type="button"
                className="nodrag nowheel inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-dark/70 bg-bg-dark px-2.5 text-xs font-medium text-text-dark transition hover:bg-text-dark/[0.06]"
                onClick={addDetailPage}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("commerceAd.agent.detailPages.addFixedInfo")}
              </button>
            </div>
            {manualPages.length > 0 ? (
              <div className="space-y-2">
                {manualPages.map((page, index) => (
                  <div key={page.id} className="rounded-lg border border-border-dark/70 bg-bg-dark/45 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-text-dark">
                        {t("commerceAd.agent.detailPages.pageBadge", { page: index + 1 })}
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="nodrag nowheel inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-dark/70 text-text-muted hover:text-text-dark disabled:opacity-40"
                          onClick={() => moveDetailPage(page.id, -1)}
                          disabled={index === 0}
                          aria-label={t("commerceAd.agent.detailPages.moveUp")}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="nodrag nowheel inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-dark/70 text-text-muted hover:text-text-dark disabled:opacity-40"
                          onClick={() => moveDetailPage(page.id, 1)}
                          disabled={index === manualPages.length - 1}
                          aria-label={t("commerceAd.agent.detailPages.moveDown")}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="nodrag nowheel inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-300/30 text-rose-100 hover:bg-rose-500/10"
                          onClick={() => deleteDetailPage(page.id)}
                          aria-label={t("commerceAd.agent.detailPages.delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <UiInput
                      value={page.title}
                      className="nodrag nowheel mb-2 h-9 bg-black/[0.08] text-xs"
                      onChange={(event) => updateDetailPage(page.id, { title: event.target.value })}
                      placeholder={t("commerceAd.agent.detailPages.pageTitlePlaceholder")}
                    />
                    <UiTextAreaField
                      value={page.lockedCopy}
                      rows={3}
                      className="nodrag nowheel text-xs leading-5"
                      onChange={(event) => updateDetailPage(page.id, { lockedCopy: event.target.value })}
                      placeholder={t("commerceAd.agent.detailPages.fixedInfoPlaceholder")}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border-dark/70 bg-bg-dark/45 px-3 py-3 text-xs leading-5 text-text-muted">
                {t("commerceAd.agent.detailPages.manualEmpty")}
              </div>
            )}
            <label className="block space-y-1.5 text-xs text-text-muted">
              <span>{t("commerceAd.agent.userIdeaInfoLabel")}</span>
              <UiTextAreaField
                value={data.userIdeaInfo || data.userInfo}
                rows={4}
                className="nodrag nowheel text-xs leading-5"
                onChange={(event) => updateProduct({ userIdeaInfo: event.target.value, userInfo: event.target.value })}
                placeholder={t("commerceAd.agent.userIdeaInfoPlaceholder")}
              />
            </label>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <label className="block space-y-1.5 text-xs text-text-muted">
              <span>{t("commerceAd.agent.lockedDocumentInfoLabel")}</span>
              <UiTextAreaField
                value={data.lockedDocumentInfo}
                rows={5}
                className="nodrag nowheel text-xs leading-5"
                onChange={(event) => updateProduct({ lockedDocumentInfo: event.target.value })}
                placeholder={t("commerceAd.agent.lockedDocumentInfoPlaceholder")}
              />
            </label>
            <label className="block space-y-1.5 text-xs text-text-muted">
              <span>{t("commerceAd.agent.userIdeaInfoLabel")}</span>
              <UiTextAreaField
                value={data.userIdeaInfo || data.userInfo}
                rows={4}
                className="nodrag nowheel text-xs leading-5"
                onChange={(event) => updateProduct({ userIdeaInfo: event.target.value, userInfo: event.target.value })}
                placeholder={t("commerceAd.agent.userIdeaInfoPlaceholder")}
              />
            </label>
          </div>
        )}
      </div>
      {inference ? (
        <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
          <div className="mb-2 text-xs font-medium text-text-dark">
            {t("commerceAd.fields.qualityCheckSummary")}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-5 text-text-dark/85">
            {inference.summary || inference.visualDescription}
          </p>
          <div className="mt-3 space-y-2">
            <ChipList
              items={inference.visibleSellingPoints}
              fallbackText={`${inference.summary}\n${inference.visualDescription}`}
            />
            <ChipList
              items={inference.followUpQuestions}
              fallbackText={`${inference.summary}\n${inference.visualDescription}`}
            />
          </div>
        </div>
      ) : null}
      {data.lastError ? (
        <div className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {data.lastError}
        </div>
      ) : null}
      <InferProductButton />
      <SyncDownstreamButton />
    </div>
  );
}

function BriefContent({ data }: { data: CommerceBriefNodeData }) {
  const { t } = useTranslation();
  return (
    <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
      {data.normalizedBrief ? (
        <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
          <p className="whitespace-pre-wrap text-sm leading-5 text-text-dark/85">
            {data.normalizedBrief}
          </p>
        </div>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t("commerceAd.nodes.briefEmpty")}
        </div>
      )}
      <FieldRow label={t("commerceAd.fields.headline")} value={data.headline} />
      <FieldRow
        label={t("commerceAd.fields.optimizedUserIdeaInfo")}
        value={data.optimizedUserIdeaInfo}
      />
      <ChipList items={data.sellingPoints} fallbackText={data.normalizedBrief} />
      {data.qualityCheckSummary || data.qualityIssues.length > 0 ? (
        <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
          <div className="mb-2 text-xs font-medium text-text-dark">
            {t("commerceAd.fields.inference")}
          </div>
          <p className="whitespace-pre-wrap text-xs leading-5 text-text-dark/85">
            {data.qualityCheckSummary}
          </p>
          <ChipList items={data.qualityIssues} fallbackText={data.qualityCheckSummary} />
        </div>
      ) : null}
    </div>
  );
}

function normalizeBatchPages(data: CommerceBatchGenerateNodeData) {
  if (data.detailPages.length > 0) {
    return data.detailPages.map((page, index) => ({
      ...page,
      pageNo: index + 1,
    }));
  }
  return [];
}

function BatchContent({ id, data }: { id: string; data: CommerceBatchGenerateNodeData }) {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const nodes = useCanvasStore((state) => state.nodes);
  const storyboardCompatibleModelConfig = useSettingsStore((state) => state.storyboardCompatibleModelConfig);
  const storyboardNewApiModelConfig = useSettingsStore((state) => state.storyboardNewApiModelConfig);
  const storyboardNewApiModelConfigs = useSettingsStore((state) => state.storyboardNewApiModelConfigs);
  const storyboardApi2OkModelConfig = useSettingsStore((state) => state.storyboardApi2OkModelConfig);
  const storyboardProviderCustomModels = useSettingsStore((state) => state.storyboardProviderCustomModels);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const pages = useMemo(() => normalizeBatchPages(data), [data]);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0] ?? null;
  const imageModels = useMemo(
    () => listImageModels(
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    ),
    [
      storyboardApi2OkModelConfig,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    ],
  );
  const selectedImageModel = useMemo(
    () => getImageModel(
      data.modelId || COMMERCE_DEFAULT_IMAGE_MODEL_ID,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    ),
    [
      data.modelId,
      storyboardApi2OkModelConfig,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    ],
  );
  const imageProviderOptions = useMemo(() => {
    const providerIds = Array.from(new Set(imageModels.map((model) => model.providerId)));
    return providerIds
      .sort((left, right) => {
        if (left === "oopii") return -1;
        if (right === "oopii") return 1;
        return left.localeCompare(right);
      })
      .map((providerId) => {
        const provider = getModelProvider(providerId);
        return {
          id: providerId,
          label: providerId === "oopii"
            ? `oopii-${t("commerceAd.agent.recommended")}`
            : provider.label || provider.name || providerId,
        };
      });
  }, [imageModels, t]);
  const selectedProviderImageModels = useMemo(
    () => imageModels.filter((model) => model.providerId === selectedImageModel.providerId),
    [imageModels, selectedImageModel.providerId],
  );
  const resolutionOptions = useMemo(
    () => resolveImageModelResolutions(selectedImageModel, { extraParams: {} }),
    [selectedImageModel],
  );
  const selectedResolution = useMemo(
    () => resolveImageModelResolution(
      selectedImageModel,
      data.size || resolveCommerceDefaultResolution(selectedImageModel),
      { extraParams: {} },
    ),
    [data.size, selectedImageModel],
  );
  const currentRatios = useMemo(
    () => resolveCommerceAspectRatiosForModel(selectedImageModel, data.aspectRatios),
    [data.aspectRatios, selectedImageModel],
  );
  const currentVariantsPerRatio = Math.max(1, Math.min(8, Math.round(Number(data.variantsPerRatio) || 1)));
  const currentBatchCount = Math.max(1, Math.min(20, Math.round(Number(data.batchCount) || 1)));
  const imageCount = data.generationMode === "detailPages"
    ? (data.detailPageCount || 0) * currentRatios.length * currentVariantsPerRatio * currentBatchCount
    : currentVariantsPerRatio;
  const canStartGeneration = imageCount > 0 && pages.length > 0;

  const handleStartGeneration = useCallback(() => {
    window.dispatchEvent(new CustomEvent(COMMERCE_START_IMAGE_GENERATION_EVENT));
  }, []);

  useEffect(() => {
    if (!activePageId || !pages.some((page) => page.id === activePageId)) {
      setActivePageId(pages[0]?.id ?? null);
    }
  }, [activePageId, pages]);

  const updateBatch = useCallback((patch: Partial<CommerceBatchGenerateNodeData>) => {
    updateNodeData(id, patch);
  }, [id, updateNodeData]);

  const handleImageModelChange = useCallback((modelId: string) => {
    const nextModel = getImageModel(
      modelId,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    );
    const nextResolution = resolveImageModelResolution(
      nextModel,
      resolveCommerceDefaultResolution(nextModel),
      { extraParams: {} },
    );
    updateBatch({
      aspectRatios: resolveCommerceAspectRatiosForModel(nextModel, currentRatios),
      modelId: nextModel.id,
      size: nextResolution.value,
    });
  }, [
    currentRatios,
    storyboardApi2OkModelConfig,
    storyboardCompatibleModelConfig,
    storyboardNewApiModelConfig,
    storyboardProviderCustomModels,
    updateBatch,
  ]);

  const handleImageProviderChange = useCallback((providerId: string) => {
    const nextModelId =
      imageModels.find((model) => model.providerId === providerId)?.id
      ?? COMMERCE_DEFAULT_IMAGE_MODEL_ID;
    handleImageModelChange(nextModelId);
  }, [handleImageModelChange, imageModels]);

  const togglePageRatio = useCallback((ratio: string) => {
    const nextRatios = currentRatios.includes(ratio)
      ? currentRatios.filter((item) => item !== ratio)
      : [...currentRatios, ratio];
    updateBatch({ aspectRatios: nextRatios.length > 0 ? nextRatios : [ratio] });
  }, [currentRatios, updateBatch]);

  const updatePage = useCallback((pageId: string, patch: { lockedCopy?: string; prompt?: string; pageGoal?: string; blueprint?: string }) => {
    const nextPages = pages.map((page) => (
      page.id === pageId ? { ...page, ...patch } : page
    ));
    updateBatch({
      detailPages: nextPages,
      detailPageIds: nextPages.map((page) => page.id),
      detailPageCount: nextPages.length,
      corePrompt: nextPages.map((page) => [
        `${t("commerceAd.agent.detailPages.pageBadge", { page: page.pageNo })} ${page.title}`,
        page.lockedCopy,
        page.prompt,
      ].filter(Boolean).join("\n")).join("\n\n"),
    } as Partial<CommerceBatchGenerateNodeData>);

    const briefNode = nodes.find((node) => node.type === CANVAS_NODE_TYPES.commerceBrief);
    if (briefNode) {
      updateNodeData(briefNode.id, {
        detailPages: nextPages,
        updatedAt: Date.now(),
      } as Partial<CommerceBriefNodeData>);
    }
  }, [nodes, pages, t, updateBatch, updateNodeData]);

  return (
    <div className="nodrag nowheel flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pr-1">
      <div className="shrink-0 space-y-3">
        <label className="block text-[11px] text-text-muted">
          <span>{t("commerceAd.agent.imageProvider")}</span>
          <UiSelect
            value={selectedImageModel.providerId}
            className="nodrag nowheel mt-1 h-9 bg-black/[0.08]"
            onChange={(event) => handleImageProviderChange(event.target.value)}
          >
            {imageProviderOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </UiSelect>
        </label>
        <label className="block text-[11px] text-text-muted">
          <span>{t("commerceAd.agent.imageModel")}</span>
          <UiSelect
            value={selectedImageModel.id}
            className="nodrag nowheel mt-1 h-9 bg-black/[0.08]"
            onChange={(event) => handleImageModelChange(event.target.value)}
          >
            {selectedProviderImageModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </UiSelect>
        </label>
        <label className="block text-[11px] text-text-muted">
          <span>{t("commerceAd.agent.resolution")}</span>
          <UiSelect
            value={selectedResolution.value}
            className="nodrag nowheel mt-1 h-9 bg-black/[0.08]"
            onChange={(event) => updateBatch({ size: event.target.value })}
          >
            {resolutionOptions.map((resolution) => (
              <option key={resolution.value} value={resolution.value}>
                {resolution.label}
              </option>
            ))}
          </UiSelect>
        </label>
        <div className="space-y-1.5">
          <div className="text-[11px] text-text-muted">
            {t("commerceAd.fields.ratios")}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedImageModel.aspectRatios.map((ratio) => {
              const active = currentRatios.includes(ratio.value);
              return (
                <button
                  key={ratio.value}
                  type="button"
                  onClick={() => togglePageRatio(ratio.value)}
                  className={`nodrag nowheel inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-text-dark/30 bg-text-dark/10 text-text-dark"
                      : "border-border-dark/70 bg-bg-dark text-text-muted hover:text-text-dark"
                  }`}
                >
                  {ratio.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] text-text-muted">
            <span>{t("commerceAd.agent.imagesPerGroup")}</span>
            <UiInput
              type="number"
              min={1}
              max={8}
              step={1}
              value={currentVariantsPerRatio}
              className="nodrag nowheel mt-1 h-9 bg-black/[0.08] text-xs"
              onChange={(event) => updateBatch({
                variantsPerRatio: Math.max(1, Math.min(8, Math.round(event.target.valueAsNumber || 1))),
              })}
            />
          </label>
          <label className="block text-[11px] text-text-muted">
            <span>{t("commerceAd.agent.batchCount")}</span>
            <UiInput
              type="number"
              min={1}
              max={20}
              step={1}
              value={currentBatchCount}
              className="nodrag nowheel mt-1 h-9 bg-black/[0.08] text-xs"
              onChange={(event) => updateBatch({
                batchCount: Math.max(1, Math.min(20, Math.round(event.target.valueAsNumber || 1))),
              })}
            />
          </label>
        </div>
        <FieldRow label={t("commerceAd.fields.count")} value={String(imageCount)} />
        <FieldRow
          label={t("commerceAd.fields.unifiedStyle")}
          value={data.stylePromptFragment}
        />
      </div>
      {pages.length > 0 ? (
        <div className={`${SCRIPT_NODE_SECTION_CARD_CLASS} flex min-h-0 flex-1 flex-col overflow-hidden`}>
          <div className="mb-3 flex shrink-0 gap-1 overflow-x-auto pb-1">
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setActivePageId(page.id)}
                className={`nodrag nowheel shrink-0 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  activePage?.id === page.id
                    ? "border-text-dark/30 bg-text-dark/10 text-text-dark"
                    : "border-border-dark/60 bg-bg-dark/70 text-text-muted hover:text-text-dark"
                }`}
              >
                {t("commerceAd.agent.detailPages.pageBadge", { page: page.pageNo })}
              </button>
            ))}
          </div>
          {activePage ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <label className="flex shrink-0 flex-col text-[11px] text-text-muted">
                <span>{t("commerceAd.agent.detailPages.lockedCopy")}</span>
                <textarea
                  value={activePage.lockedCopy}
                  onChange={(event) => updatePage(activePage.id, { lockedCopy: event.target.value })}
                  className={`mt-1 h-[clamp(88px,18%,140px)] min-h-[88px] ${SCRIPT_NODE_TEXTAREA_CLASS}`}
                />
              </label>
              <TextAreaControl
                label={t("commerceAd.fields.pageGoal")}
                value={activePage.pageGoal}
                rows={2}
                onChange={(value) => updatePage(activePage.id, { pageGoal: value })}
              />
              <TextAreaControl
                label={t("commerceAd.fields.blueprint")}
                value={activePage.blueprint}
                rows={3}
                onChange={(value) => updatePage(activePage.id, { blueprint: value })}
              />
              <label className="flex min-h-0 flex-1 flex-col text-[11px] text-text-muted">
                <span>{t("commerceAd.agent.detailPages.imagePrompt")}</span>
                <textarea
                  value={activePage.prompt}
                  onChange={(event) => updatePage(activePage.id, { prompt: event.target.value })}
                  className={`mt-1 min-h-[120px] flex-1 ${SCRIPT_NODE_TEXTAREA_CLASS}`}
                />
              </label>
            </div>
          ) : null}
        </div>
      ) : data.corePrompt ? (
        <div className={`${SCRIPT_NODE_SECTION_CARD_CLASS} ui-scrollbar min-h-0 flex-1 overflow-y-auto`}>
          <div className="mb-2 text-xs font-medium text-text-dark">
            {t("commerceAd.fields.corePrompt")}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-5 text-text-dark/85">
            {data.corePrompt}
          </p>
        </div>
      ) : (
        <div className={`${SCRIPT_NODE_EMPTY_HINT_CLASS} flex min-h-0 flex-1 items-center justify-center`}>
          {t("commerceAd.nodes.batchEmpty")}
        </div>
      )}
      <button
        type="button"
        className="nodrag nowheel inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-text-dark/15 bg-text-dark/10 px-3 text-sm font-medium text-text-dark transition-colors hover:bg-text-dark/15 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleStartGeneration}
        disabled={!canStartGeneration}
      >
        <Sparkles className="h-4 w-4" />
        {t("commerceAd.agent.startImageGeneration")}
      </button>
    </div>
  );
}

function AgentPlanContent({ id, data }: { id: string; data: CommerceAgentPlanNodeData }) {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const storyboardCompatibleModelConfig = useSettingsStore((state) => state.storyboardCompatibleModelConfig);
  const storyboardNewApiModelConfig = useSettingsStore((state) => state.storyboardNewApiModelConfig);
  const storyboardNewApiModelConfigs = useSettingsStore((state) => state.storyboardNewApiModelConfigs);
  const storyboardApi2OkModelConfig = useSettingsStore((state) => state.storyboardApi2OkModelConfig);
  const storyboardProviderCustomModels = useSettingsStore((state) => state.storyboardProviderCustomModels);
  const imageModels = useMemo(
    () => listImageModels(
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    ),
    [
      storyboardApi2OkModelConfig,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    ],
  );
  const selectedImageModel = useMemo(
    () => getImageModel(
      data.modelId || COMMERCE_DEFAULT_IMAGE_MODEL_ID,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    ),
    [
      data.modelId,
      storyboardApi2OkModelConfig,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    ],
  );
  const imageProviderOptions = useMemo(() => {
    const providerIds = Array.from(new Set(imageModels.map((model) => model.providerId)));
    return providerIds
      .sort((left, right) => {
        if (left === "oopii") return -1;
        if (right === "oopii") return 1;
        return left.localeCompare(right);
      })
      .map((providerId) => {
        const provider = getModelProvider(providerId);
        return {
          id: providerId,
          label: providerId === "oopii"
            ? `oopii-${t("commerceAd.agent.recommended")}`
            : provider.label || provider.name || providerId,
        };
      });
  }, [imageModels, t]);
  const selectedProviderImageModels = useMemo(
    () => imageModels.filter((model) => model.providerId === selectedImageModel.providerId),
    [imageModels, selectedImageModel.providerId],
  );
  const resolutionOptions = useMemo(
    () => resolveImageModelResolutions(selectedImageModel, { extraParams: {} }),
    [selectedImageModel],
  );
  const selectedResolution = useMemo(
    () => resolveImageModelResolution(
      selectedImageModel,
      data.size || resolveCommerceDefaultResolution(selectedImageModel),
      { extraParams: {} },
    ),
    [data.size, selectedImageModel],
  );
  const currentRatios = useMemo(
    () => resolveCommerceAspectRatiosForModel(selectedImageModel, data.aspectRatios),
    [data.aspectRatios, selectedImageModel],
  );
  const currentVariantsPerRatio = Math.max(1, Math.min(8, Math.round(Number(data.variantsPerRatio) || 1)));
  const currentBatchCount = Math.max(1, Math.min(20, Math.round(Number(data.batchCount) || 1)));
  const imageCount = currentRatios.length * currentVariantsPerRatio * currentBatchCount;
  const referenceImages = data.referenceImages.slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
  const effectivePrompt = data.renderedPrompt || data.prompt;
  const canStartGeneration = (effectivePrompt.trim().length > 0 || Boolean(data.promptSpec)) && imageCount > 0 && data.status !== "generating";
  const productionSummary = [
    selectedImageModel.displayName,
    selectedResolution.label,
    currentRatios.map((ratio) => {
      const ratioOption = selectedImageModel.aspectRatios.find((item) => item.value === ratio);
      return ratioOption?.label ?? ratio;
    }).join(" / "),
    t("commerceAd.agentPlan.imageCountSummary", { count: imageCount }),
  ].filter(Boolean).join(" · ");
  const hasAdvancedContent = referenceImages.length > 0 || data.riskNotes.length > 0 || effectivePrompt.trim().length > 0 || Boolean(data.promptSpec);

  const updatePlan = useCallback((patch: Partial<CommerceAgentPlanNodeData>) => {
    updateNodeData(id, patch);
  }, [id, updateNodeData]);

  const handleImageModelChange = useCallback((modelId: string) => {
    const nextModel = getImageModel(
      modelId,
      storyboardCompatibleModelConfig,
      storyboardNewApiModelConfig,
      storyboardApi2OkModelConfig,
      storyboardProviderCustomModels,
      storyboardNewApiModelConfigs,
    );
    const nextResolution = resolveImageModelResolution(
      nextModel,
      resolveCommerceDefaultResolution(nextModel),
      { extraParams: {} },
    );
    updatePlan({
      providerId: nextModel.providerId,
      modelId: nextModel.id,
      size: nextResolution.value,
      aspectRatios: resolveCommerceAspectRatiosForModel(nextModel, currentRatios),
    } as Partial<CommerceAgentPlanNodeData>);
  }, [
    currentRatios,
    storyboardApi2OkModelConfig,
    storyboardCompatibleModelConfig,
    storyboardNewApiModelConfig,
    storyboardProviderCustomModels,
    updatePlan,
  ]);

  const handleImageProviderChange = useCallback((providerId: string) => {
    const nextModelId =
      imageModels.find((model) => model.providerId === providerId)?.id
      ?? COMMERCE_DEFAULT_IMAGE_MODEL_ID;
    handleImageModelChange(nextModelId);
  }, [handleImageModelChange, imageModels]);

  const toggleRatio = useCallback((ratio: string) => {
    const nextRatios = currentRatios.includes(ratio)
      ? currentRatios.filter((item) => item !== ratio)
      : [...currentRatios, ratio];
    updatePlan({ aspectRatios: nextRatios.length > 0 ? nextRatios : [ratio] } as Partial<CommerceAgentPlanNodeData>);
  }, [currentRatios, updatePlan]);

  const handleStartGeneration = useCallback(() => {
    window.dispatchEvent(new CustomEvent(COMMERCE_START_AGENT_PLAN_GENERATION_EVENT, {
      detail: { planNodeId: id },
    }));
  }, [id]);

  return (
    <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
      <FieldRow label={t("commerceAd.agentPlan.summary")} value={data.summary} />
      <FieldRow label={t("commerceAd.agentPlan.productUnderstanding")} value={data.productUnderstanding} />
      <FieldRow label={t("commerceAd.agentPlan.creativeDirection")} value={data.creativeDirection} />
      <CompactDisclosure
        title={t("commerceAd.agentPlan.productionSettings")}
        summary={productionSummary}
        defaultOpen={false}
      >
        <div className="space-y-3">
          <label className="block text-[11px] text-text-muted">
            <span>{t("commerceAd.agent.imageProvider")}</span>
            <UiSelect
              value={selectedImageModel.providerId}
              className="nodrag nowheel mt-1 h-9 bg-black/[0.08]"
              onChange={(event) => handleImageProviderChange(event.target.value)}
            >
              {imageProviderOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </UiSelect>
          </label>
          <label className="block text-[11px] text-text-muted">
            <span>{t("commerceAd.agent.imageModel")}</span>
            <UiSelect
              value={selectedImageModel.id}
              className="nodrag nowheel mt-1 h-9 bg-black/[0.08]"
              onChange={(event) => handleImageModelChange(event.target.value)}
            >
              {selectedProviderImageModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </UiSelect>
          </label>
          <label className="block text-[11px] text-text-muted">
            <span>{t("commerceAd.agent.resolution")}</span>
            <UiSelect
              value={selectedResolution.value}
              className="nodrag nowheel mt-1 h-9 bg-black/[0.08]"
              onChange={(event) => updatePlan({ size: event.target.value } as Partial<CommerceAgentPlanNodeData>)}
            >
              {resolutionOptions.map((resolution) => (
                <option key={resolution.value} value={resolution.value}>
                  {resolution.label}
                </option>
              ))}
            </UiSelect>
          </label>
          <div className="space-y-1.5">
            <div className="text-[11px] text-text-muted">
              {t("commerceAd.fields.ratios")}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedImageModel.aspectRatios.map((ratio) => {
                const active = currentRatios.includes(ratio.value);
                return (
                  <button
                    key={ratio.value}
                    type="button"
                    onClick={() => toggleRatio(ratio.value)}
                    className={`nodrag nowheel inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-text-dark/30 bg-text-dark/10 text-text-dark"
                        : "border-border-dark/70 bg-bg-dark text-text-muted hover:text-text-dark"
                    }`}
                  >
                    {ratio.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-text-muted">
              <span>{t("commerceAd.agent.imagesPerGroup")}</span>
              <UiInput
                type="number"
                min={1}
                max={8}
                step={1}
                value={currentVariantsPerRatio}
                className="nodrag nowheel mt-1 h-9 bg-black/[0.08] text-xs"
                onChange={(event) => updatePlan({
                  variantsPerRatio: Math.max(1, Math.min(8, Math.round(event.target.valueAsNumber || 1))),
                } as Partial<CommerceAgentPlanNodeData>)}
              />
            </label>
            <label className="block text-[11px] text-text-muted">
              <span>{t("commerceAd.agent.batchCount")}</span>
              <UiInput
                type="number"
                min={1}
                max={20}
                step={1}
                value={currentBatchCount}
                className="nodrag nowheel mt-1 h-9 bg-black/[0.08] text-xs"
                onChange={(event) => updatePlan({
                  batchCount: Math.max(1, Math.min(20, Math.round(event.target.valueAsNumber || 1))),
                } as Partial<CommerceAgentPlanNodeData>)}
              />
            </label>
          </div>
          <FieldRow label={t("commerceAd.fields.count")} value={String(imageCount)} />
        </div>
      </CompactDisclosure>
      {hasAdvancedContent ? (
        <CompactDisclosure
          title={t("commerceAd.agentPlan.details")}
          summary={[
            referenceImages.length > 0 ? t("commerceAd.agentPlan.referenceImageCount", { count: referenceImages.length }) : "",
            data.riskNotes.length > 0 ? t("commerceAd.agentPlan.riskCount", { count: data.riskNotes.length }) : "",
            effectivePrompt.trim() ? t("commerceAd.agentPlan.promptReady") : "",
          ].filter(Boolean).join(" · ")}
          defaultOpen={false}
        >
          <div className="space-y-3">
            {referenceImages.length > 0 ? (
              <div>
                <div className="mb-2 text-xs font-medium text-text-dark">
                  {t("commerceAd.agentPlan.referenceImages")}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {referenceImages.map((image) => (
                    <div
                      key={image.id}
                      className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-bg-dark"
                      title={image.description || image.label}
                    >
                      <img
                        src={resolveImageDisplayUrl(image.previewImageUrl || image.imageUrl)}
                        alt={image.label}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted">
                  {data.referenceImageNotes || t("commerceAd.agentPlan.noReferenceImageNotes")}
                </p>
              </div>
            ) : null}
            {data.promptSpec ? (
              <CompactDisclosure
                title={t("commerceAd.agentPlan.promptStructure")}
                summary={t("commerceAd.agentPlan.promptStructureReady")}
                defaultOpen={false}
              >
                <PromptSpecSummary spec={data.promptSpec} />
              </CompactDisclosure>
            ) : null}
            <ChipList items={data.riskNotes} />
            <TextAreaControl
              label={t("commerceAd.agentPlan.prompt")}
              value={effectivePrompt}
              rows={5}
              onChange={(value) => updatePlan({
                prompt: value,
                renderedPrompt: value,
                status: "ready",
                lastError: null,
              } as Partial<CommerceAgentPlanNodeData>)}
            />
          </div>
        </CompactDisclosure>
      ) : null}
      {data.lastError ? (
        <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-100">
          {data.lastError}
        </div>
      ) : null}
      <button
        type="button"
        className="nodrag nowheel inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-text-dark/15 bg-text-dark/10 px-3 text-sm font-medium text-text-dark transition-colors hover:bg-text-dark/15 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={handleStartGeneration}
        disabled={!canStartGeneration}
      >
        <Sparkles className="h-4 w-4" />
        {data.status === "generating"
          ? t("commerceAd.agentPlan.generating")
          : t("commerceAd.agentPlan.startProduction")}
      </button>
    </div>
  );
}

function VisualPreferenceContent({ data }: { data: CommerceVisualPreferenceNodeData }) {
  const { t } = useTranslation();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const nodes = useCanvasStore((state) => state.nodes);
  const node = nodes.find((item) => item.type === CANVAS_NODE_TYPES.commerceVisualPreference);
  const batchNode = nodes.find((item) => item.type === CANVAS_NODE_TYPES.commerceBatchGenerate);
  const optionGroups = useMemo(() => ({
    designStyle: VISUAL_PREFERENCE_OPTION_KEYS.designStyle.map((optionKey) => {
      const label = t(`commerceAd.agent.visualPreference.options.designStyle.${optionKey}`);
      return { value: label, label };
    }),
    colorPalette: VISUAL_PREFERENCE_OPTION_KEYS.colorPalette.map((optionKey) => {
      const label = t(`commerceAd.agent.visualPreference.options.colorPalette.${optionKey}`);
      return { value: label, label };
    }),
    platformVisual: VISUAL_PREFERENCE_OPTION_KEYS.platformVisual.map((optionKey) => {
      const label = t(`commerceAd.agent.visualPreference.options.platformVisual.${optionKey}`);
      return { value: label, label };
    }),
    language: VISUAL_PREFERENCE_OPTION_KEYS.language.map((optionKey) => {
      const label = t(`commerceAd.agent.visualPreference.options.language.${optionKey}`);
      return { value: label, label };
    }),
  }), [t]);
  const updatePreference = useCallback((patch: Partial<CommerceVisualPreferenceNodeData>) => {
    if (!node) {
      return;
    }
    const nextPreference = buildVisualPreferencePatch(normalizeCommerceAdVisualPreferenceState({
      ...data,
      ...patch,
      updatedAt: Date.now(),
    }));
    updateNodeData(node.id, {
      ...nextPreference,
    } as Partial<CommerceVisualPreferenceNodeData>);
    if (batchNode) {
      updateNodeData(batchNode.id, {
        stylePromptFragment: nextPreference.promptFragment,
      } as Partial<CommerceBatchGenerateNodeData>);
    }
  }, [batchNode, data, node, updateNodeData]);

  return (
    <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
      <SelectControl
        label={t("commerceAd.fields.designStyle")}
        value={data.designStyle}
        options={optionGroups.designStyle}
        onChange={(value) => updatePreference({ designStyle: value } as Partial<CommerceVisualPreferenceNodeData>)}
      />
      <SelectControl
        label={t("commerceAd.fields.colorPalette")}
        value={data.colorPalette}
        options={optionGroups.colorPalette}
        onChange={(value) => updatePreference({ colorPalette: value } as Partial<CommerceVisualPreferenceNodeData>)}
      />
      <SelectControl
        label={t("commerceAd.fields.platformVisual")}
        value={data.platformVisual}
        options={optionGroups.platformVisual}
        onChange={(value) => updatePreference({ platformVisual: value } as Partial<CommerceVisualPreferenceNodeData>)}
      />
      <SelectControl
        label={t("commerceAd.fields.language")}
        value={data.language}
        options={optionGroups.language}
        onChange={(value) => updatePreference({ language: value } as Partial<CommerceVisualPreferenceNodeData>)}
      />
      <div className="space-y-2">
        <div className="text-[11px] text-text-muted">
          {t("commerceAd.fields.brandAccentColor")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => updatePreference({ brandAccentColor: "auto" } as Partial<CommerceVisualPreferenceNodeData>)}
            className={`nodrag nowheel inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors ${
              data.brandAccentColor.toLowerCase() === "auto"
                ? "border-text-dark/30 bg-text-dark/10 text-text-dark"
                : "border-border-dark/70 bg-bg-dark text-text-muted hover:text-text-dark"
            }`}
          >
            {t("commerceAd.agent.visualPreference.autoAccent")}
          </button>
          {BRAND_ACCENT_PRESETS.map(({ key, color }) => (
            <button
              key={key}
              type="button"
              onClick={() => updatePreference({ brandAccentColor: color } as Partial<CommerceVisualPreferenceNodeData>)}
              className={`nodrag nowheel h-8 w-8 rounded-full border transition-transform hover:scale-105 ${
                data.brandAccentColor.toUpperCase() === color
                  ? "border-white ring-2 ring-white/30"
                  : "border-white/20"
              }`}
              style={{ backgroundColor: color }}
              aria-label={t("commerceAd.agent.visualPreference.chooseAccent", {
                color: t(`commerceAd.agent.visualPreference.options.accentColor.${key}`),
              })}
              title={t("commerceAd.agent.visualPreference.chooseAccent", {
                color: t(`commerceAd.agent.visualPreference.options.accentColor.${key}`),
              })}
            />
          ))}
        </div>
        <UiInput
          value={data.brandAccentColor}
          className="nodrag nowheel h-9 bg-black/[0.08] text-xs"
          onChange={(event) => updatePreference({ brandAccentColor: event.target.value } as Partial<CommerceVisualPreferenceNodeData>)}
          placeholder="#3B82F6"
        />
      </div>
      {!data.designStyle && !data.colorPalette && !data.platformVisual && !data.language ? (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t("commerceAd.nodes.visualPreferenceEmpty")}
        </div>
      ) : null}
      <FieldRow
        label={t("commerceAd.fields.visualPromptFragment")}
        value={data.promptFragment}
      />
    </div>
  );
}

function ResultContent({ data }: { data: CommerceResultGroupNodeData }) {
  const { t } = useTranslation();
  const nodes = useCanvasStore((state) => state.nodes);
  const activeBatch =
    data.batches.find((batch) => batch.id === data.activeBatchId) ??
    data.batches[0] ??
    null;
  const images = activeBatch?.images ?? [];

  const handleRetryImage = useCallback((batchId: string, imageId: string) => {
    window.dispatchEvent(new CustomEvent(COMMERCE_RETRY_IMAGE_GENERATION_EVENT, {
      detail: { batchId, imageId },
    }));
  }, []);

  return (
    <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
      {activeBatch ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-border-dark/45 bg-bg-dark/80 px-2 py-1 text-[11px] text-text-dark">
              {t("commerceAd.fields.batches")}: {data.batches.length}
            </span>
            <span className="rounded-full border border-border-dark/45 bg-bg-dark/80 px-2 py-1 text-[11px] text-text-dark">
              {t("commerceAd.fields.images")}: {images.length}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {images.slice(0, 8).map((image) => {
                const imageNode = image.nodeId
                  ? nodes.find((node) => node.id === image.nodeId)
                  : null;
                const nodePhase = imageNode?.data && typeof imageNode.data === "object"
                  ? (imageNode.data as { generationPhase?: unknown }).generationPhase
                  : null;
                const status = nodePhase === "failed" ? "failed" : image.status;
                return (
                  <div
                    key={image.id}
                    className={`min-h-[72px] rounded-lg border px-2 py-2 text-xs text-text-muted ${
                      status === "failed"
                        ? "border-rose-400/35 bg-rose-500/10"
                        : "border-white/[0.07] bg-black/[0.1]"
                    }`}
                  >
                    <div className="font-medium text-text-dark">
                      {image.detailPageNo
                        ? t("commerceAd.agent.detailPages.resultTitle", {
                            page: image.detailPageNo,
                            title: image.detailPageTitle || t("commerceAd.agent.detailPages.untitled"),
                          })
                        : image.aspectRatio}
                    </div>
                    <div className="mt-1">
                      {t(`commerceAd.status.${status}`)}
                    </div>
                    {status === "failed" ? (
                      <button
                        type="button"
                        className="nodrag nowheel mt-2 inline-flex h-7 items-center justify-center rounded-md border border-rose-300/30 bg-rose-500/10 px-2 text-[11px] font-medium text-rose-100 transition hover:bg-rose-500/20"
                        onClick={() => handleRetryImage(activeBatch.id, image.id)}
                      >
                        {t("commerceAd.agent.retryImageGeneration")}
                      </button>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t("commerceAd.nodes.resultsEmpty")}
        </div>
      )}
    </div>
  );
}

export const CommerceStageNode = memo(
  ({ id, type, data, selected, width, height }: CommerceStageNodeProps) => {
    const updateNodeInternals = useUpdateNodeInternals();
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const deleteNode = useCanvasStore((state) => state.deleteNode);
    const updateNodeSize = useCanvasStore((state) => state.updateNodeSize);
    const cardWrapRef = useRef<HTMLDivElement | null>(null);
    const lastAutoHeightRef = useRef<number | null>(null);
    const isManualHeight = Boolean(
      (data as { isSizeManuallyAdjusted?: unknown }).isSizeManuallyAdjusted,
    );
    const resolvedWidth = resolveScriptNodeDimension(width, DEFAULT_WIDTH);
    const resolvedHeight = typeof height === "number"
      && Number.isFinite(height)
      && height > 1
      && Math.round(height) !== LEGACY_DEFAULT_HEIGHT
      && isManualHeight
      ? Math.round(height)
      : undefined;
    const title = useMemo(
      () => resolveNodeDisplayName(type as CanvasNodeType, data),
      [data, type],
    );

    const stageMeta = useMemo(() => {
      if (type === CANVAS_NODE_TYPES.commerceProduct) {
        return {
          icon: <PackageSearch className="h-4 w-4" />,
          accent: "amber" as const,
        };
      }
      if (type === CANVAS_NODE_TYPES.commerceBrief) {
        return {
          icon: <FileText className="h-4 w-4" />,
          accent: "cyan" as const,
        };
      }
      if (type === CANVAS_NODE_TYPES.commerceVisualPreference) {
        return {
          icon: <LayoutTemplate className="h-4 w-4" />,
          accent: "emerald" as const,
        };
      }
      if (type === CANVAS_NODE_TYPES.commerceBatchGenerate) {
        return {
          icon: <Sparkles className="h-4 w-4" />,
          accent: "violet" as const,
        };
      }
      if (type === CANVAS_NODE_TYPES.commerceAgentPlan) {
        return {
          icon: <BookOpen className="h-4 w-4" />,
          accent: "cyan" as const,
        };
      }
      return {
        icon: <Images className="h-4 w-4" />,
        accent: "emerald" as const,
      };
    }, [type]);

    useEffect(() => {
      updateNodeInternals(id);
    }, [data, id, resolvedHeight, resolvedWidth, type, updateNodeInternals]);

    useEffect(() => {
      if (resolvedHeight) {
        return;
      }

      const element = cardWrapRef.current;
      if (!element) {
        return;
      }

      let frameId: number | null = null;
      const syncAutoSize = () => {
        const measuredElement = element.firstElementChild instanceof HTMLElement
          ? element.firstElementChild
          : element;
        const rect = measuredElement.getBoundingClientRect();
        const nextHeight = Math.max(260, Math.ceil(rect.height));
        if (Math.abs((lastAutoHeightRef.current ?? 0) - nextHeight) <= 1) {
          return;
        }
        lastAutoHeightRef.current = nextHeight;
        updateNodeSize(id, {
          width: resolvedWidth,
          height: nextHeight,
        });
        updateNodeInternals(id);
      };
      const scheduleSync = () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
        frameId = window.requestAnimationFrame(() => {
          frameId = null;
          syncAutoSize();
        });
      };
      const observer = new ResizeObserver(scheduleSync);
      observer.observe(element);
      scheduleSync();

      return () => {
        observer.disconnect();
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
      };
    }, [id, resolvedHeight, resolvedWidth, updateNodeInternals, updateNodeSize]);

    return (
      <div className={`pointer-events-none relative w-full ${resolvedHeight ? "h-full" : ""}`}>
        {nodeHasTargetHandle(type) ? (
          <CanvasHandle
            type="target"
            id="target"
            position={Position.Left}
            className="!pointer-events-auto !h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-slate-400"
          />
        ) : null}
        {nodeHasSourceHandle(type) ? (
          <CanvasHandle
            type="source"
            id="source"
            position={Position.Right}
            className="!pointer-events-auto !h-3 !w-3 !-right-1.5 !rounded-full !border-surface-dark !bg-slate-400"
          />
        ) : null}
        <div ref={cardWrapRef} className="pointer-events-auto inline-block align-top">
          <ScriptNodeCard
            accent={stageMeta.accent}
            icon={stageMeta.icon}
            title={title}
            selected={selected}
            width={resolvedWidth}
            height={resolvedHeight}
            minHeight={260}
            isEditing={false}
            showEditButton={false}
            contentClassName={type === CANVAS_NODE_TYPES.commerceBatchGenerate ? "overflow-hidden" : ""}
            onToggleEdit={() => setSelectedNode(id)}
            onDelete={() => deleteNode(id)}
            onClick={() => setSelectedNode(id)}
          >
            {type === CANVAS_NODE_TYPES.commerceProduct ? (
              <ProductContent data={data as CommerceProductNodeData} />
            ) : type === CANVAS_NODE_TYPES.commerceBrief ? (
              <BriefContent data={data as CommerceBriefNodeData} />
            ) : type === CANVAS_NODE_TYPES.commerceVisualPreference ? (
              <VisualPreferenceContent data={data as CommerceVisualPreferenceNodeData} />
            ) : type === CANVAS_NODE_TYPES.commerceBatchGenerate ? (
              <BatchContent id={id} data={data as CommerceBatchGenerateNodeData} />
            ) : type === CANVAS_NODE_TYPES.commerceAgentPlan ? (
              <AgentPlanContent id={id} data={data as CommerceAgentPlanNodeData} />
            ) : (
              <ResultContent data={data as CommerceResultGroupNodeData} />
            )}
          </ScriptNodeCard>
        </div>
        <NodeResizeHandle
          minWidth={320}
          minHeight={360}
          maxWidth={1800}
          maxHeight={1800}
          isVisible={selected}
          className="!pointer-events-auto"
        />
      </div>
    );
  },
);

CommerceStageNode.displayName = "CommerceStageNode";
