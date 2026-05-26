import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { CanvasHandle } from "@/features/canvas/ui/CanvasHandle";
import { FileText, Images, LayoutTemplate, PackageSearch, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveImageDisplayUrl } from "@/features/canvas/application/imageData";
import {
  CANVAS_NODE_TYPES,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
  type CommerceVisualPreferenceNodeData,
  type CanvasNodeType,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { useCanvasStore } from "@/stores/canvasStore";
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
  | CommerceResultGroupNodeData;

type CommerceStageNodeProps = NodeProps & {
  id: string;
  type: string;
  data: CommerceStageNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 460;
const COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT = 5;
const COMMERCE_START_IMAGE_GENERATION_EVENT = "commerce-ad:start-image-generation";
const COMMERCE_RETRY_IMAGE_GENERATION_EVENT = "commerce-ad:retry-image-generation";

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

function ProductContent({ data }: { data: CommerceProductNodeData }) {
  const { t } = useTranslation();
  const visibleImages = data.images.slice(0, COMMERCE_PRODUCT_REFERENCE_IMAGE_LIMIT);
  const inference = data.inference;

  return (
    <div className="nodrag nowheel flex min-h-0 flex-1 flex-col gap-3">
      {visibleImages.length > 0 ? (
        <div className="grid grid-cols-5 gap-1.5 rounded-xl border border-white/[0.07] bg-black/[0.14] p-1.5">
          {visibleImages.map((image, index) => (
            <div
              key={image.id}
              className={`relative overflow-hidden rounded-lg border border-white/[0.08] bg-black/[0.16] ${
                index === 0 ? "col-span-3 row-span-2 aspect-[4/3]" : "aspect-square"
              }`}
            >
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
                  ? t("commerceAd.fields.productImageMain")
                  : t("commerceAd.fields.productImageReference", { index })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t("commerceAd.nodes.productEmpty")}
        </div>
      )}
      <FieldRow
        label={t("commerceAd.fields.productName")}
        value={data.productName}
      />
      <FieldRow label={t("commerceAd.fields.brand")} value={data.brand} />
      <FieldRow label={t("commerceAd.fields.category")} value={data.category} />
      <FieldRow
        label={t("commerceAd.fields.lockedDocumentInfo")}
        value={data.lockedDocumentInfo}
      />
      <FieldRow
        label={t("commerceAd.fields.userIdeaInfo")}
        value={data.userIdeaInfo || data.userInfo}
      />
      {visibleImages.some((image) => image.description?.trim()) ? (
        <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
          <div className="mb-2 text-xs font-medium text-text-dark">
            {t("commerceAd.fields.productImageDescriptions")}
          </div>
          <div className="space-y-1.5">
            {visibleImages.map((image, index) => {
              const description = image.description?.trim();
              if (!description) {
                return null;
              }

              return (
                <div key={image.id} className="text-xs leading-5 text-text-dark/85">
                  <span className="text-text-muted">
                    {index === 0
                      ? t("commerceAd.fields.productImageMain")
                      : t("commerceAd.fields.productImageReference", { index })}
                    ：
                  </span>
                  {description}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {inference ? (
        <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
          <div className="mb-2 text-xs font-medium text-text-dark">
            {t("commerceAd.fields.inference")}
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
      <FieldRow label={t("commerceAd.fields.platform")} value={data.platform} />
      <FieldRow label={t("commerceAd.fields.audience")} value={data.audience} />
      <FieldRow label={t("commerceAd.fields.style")} value={data.style} />
      <FieldRow label={t("commerceAd.fields.headline")} value={data.headline} />
      <FieldRow
        label={t("commerceAd.fields.optimizedUserIdeaInfo")}
        value={data.optimizedUserIdeaInfo}
      />
      <ChipList items={data.sellingPoints} fallbackText={data.normalizedBrief} />
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
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const pages = useMemo(() => normalizeBatchPages(data), [data]);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0] ?? null;
  const imageCount = data.generationMode === "detailPages"
    ? (data.detailPageCount || 0) * data.aspectRatios.length * data.variantsPerRatio * data.batchCount
    : data.variantsPerRatio;
  const canStartGeneration = imageCount > 0 && pages.length > 0;

  const handleStartGeneration = useCallback(() => {
    window.dispatchEvent(new CustomEvent(COMMERCE_START_IMAGE_GENERATION_EVENT));
  }, []);

  useEffect(() => {
    if (!activePageId || !pages.some((page) => page.id === activePageId)) {
      setActivePageId(pages[0]?.id ?? null);
    }
  }, [activePageId, pages]);

  const updatePage = useCallback((pageId: string, patch: { lockedCopy?: string; prompt?: string }) => {
    const nextPages = pages.map((page) => (
      page.id === pageId ? { ...page, ...patch } : page
    ));
    updateNodeData(id, {
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
  }, [id, nodes, pages, t, updateNodeData]);

  return (
    <div className="nodrag nowheel flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pr-1">
      <div className="shrink-0 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <FieldRow
            label={t("commerceAd.fields.ratios")}
            value={data.aspectRatios.join(" / ")}
          />
          <FieldRow
            label={t("commerceAd.fields.count")}
            value={String(imageCount)}
          />
        </div>
        <FieldRow label={t("commerceAd.fields.model")} value={data.modelId} />
        <FieldRow label={t("commerceAd.fields.size")} value={data.size} />
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

function VisualPreferenceContent({ data }: { data: CommerceVisualPreferenceNodeData }) {
  const { t } = useTranslation();
  const accentColor = data.brandAccentColor?.trim();
  const isAutoAccent = !accentColor || accentColor.toLowerCase() === "auto";

  return (
    <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label={t("commerceAd.fields.designStyle")} value={data.designStyle} />
        <FieldRow label={t("commerceAd.fields.colorPalette")} value={data.colorPalette} />
        <FieldRow label={t("commerceAd.fields.platformVisual")} value={data.platformVisual} />
        <FieldRow label={t("commerceAd.fields.language")} value={data.language} />
      </div>
      <div className="rounded-lg border border-white/[0.07] bg-black/[0.08] px-3 py-2">
        <div className="text-[11px] text-text-muted">
          {t("commerceAd.fields.brandAccentColor")}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm text-text-dark">
          {isAutoAccent ? (
            <span className="rounded-full border border-border-dark/70 bg-bg-dark/80 px-2 py-1 text-xs text-text-muted">
              {t("commerceAd.agent.visualPreference.autoAccent")}
            </span>
          ) : (
            <>
              <span
                className="h-5 w-5 rounded-full border border-white/20"
                style={{ backgroundColor: accentColor }}
              />
              <span className="font-mono text-xs">{accentColor}</span>
            </>
          )}
        </div>
      </div>
      {!data.designStyle && !data.colorPalette && !data.platformVisual && !data.language ? (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t("commerceAd.nodes.visualPreferenceEmpty")}
        </div>
      ) : null}
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
    const resolvedWidth = resolveScriptNodeDimension(width, DEFAULT_WIDTH);
    const resolvedHeight = resolveScriptNodeDimension(height, DEFAULT_HEIGHT);
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
      return {
        icon: <Images className="h-4 w-4" />,
        accent: "emerald" as const,
      };
    }, [type]);

    useEffect(() => {
      updateNodeInternals(id);
    }, [data, id, resolvedHeight, resolvedWidth, type, updateNodeInternals]);

    return (
      <div className="relative h-full w-full">
        {type !== CANVAS_NODE_TYPES.commerceProduct ? (
          <CanvasHandle
            type="target"
            id="target"
            position={Position.Left}
            className="!h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-slate-400"
          />
        ) : null}
        {type !== CANVAS_NODE_TYPES.commerceResultGroup ? (
          <CanvasHandle
            type="source"
            id="source"
            position={Position.Right}
            className="!h-3 !w-3 !-right-1.5 !rounded-full !border-surface-dark !bg-slate-400"
          />
        ) : null}
        <ScriptNodeCard
          accent={stageMeta.accent}
          icon={stageMeta.icon}
          title={title}
          selected={selected}
          width={resolvedWidth}
          height={resolvedHeight}
          minHeight={260}
          isEditing={false}
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
          ) : (
            <ResultContent data={data as CommerceResultGroupNodeData} />
          )}
        </ScriptNodeCard>
        <NodeResizeHandle
          minWidth={320}
          minHeight={360}
          maxWidth={1800}
          maxHeight={1800}
          isVisible={selected}
        />
      </div>
    );
  },
);

CommerceStageNode.displayName = "CommerceStageNode";
