import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileText, Images, PackageSearch, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  CANVAS_NODE_TYPES,
  type CommerceBatchGenerateNodeData,
  type CommerceBriefNodeData,
  type CommerceProductNodeData,
  type CommerceResultGroupNodeData,
  type CanvasNodeType,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  SCRIPT_NODE_EMPTY_HINT_CLASS,
  SCRIPT_NODE_SCROLL_AREA_CLASS,
  SCRIPT_NODE_SECTION_CARD_CLASS,
  ScriptNodeCard,
  resolveScriptNodeDimension,
} from './ScriptNodeCard';

type CommerceStageNodeData =
  | CommerceProductNodeData
  | CommerceBriefNodeData
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

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
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

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
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
  const primaryImage = data.images[0] ?? null;
  const inference = data.inference;

  return (
    <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
      {primaryImage ? (
        <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/[0.14]">
          <img
            src={resolveImageDisplayUrl(primaryImage.previewImageUrl || primaryImage.imageUrl)}
            alt={primaryImage.label}
            className="h-40 w-full object-contain"
            draggable={false}
          />
        </div>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t('commerceAd.nodes.productEmpty')}
        </div>
      )}
      <FieldRow label={t('commerceAd.fields.productName')} value={data.productName} />
      <FieldRow label={t('commerceAd.fields.brand')} value={data.brand} />
      <FieldRow label={t('commerceAd.fields.category')} value={data.category} />
      <FieldRow label={t('commerceAd.fields.userInfo')} value={data.userInfo} />
      {inference ? (
        <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
          <div className="mb-2 text-xs font-medium text-text-dark">
            {t('commerceAd.fields.inference')}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-5 text-text-dark/85">
            {inference.summary || inference.visualDescription}
          </p>
          <div className="mt-3 space-y-2">
            <ChipList items={inference.visibleSellingPoints} />
            <ChipList items={inference.followUpQuestions} />
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
          {t('commerceAd.nodes.briefEmpty')}
        </div>
      )}
      <FieldRow label={t('commerceAd.fields.platform')} value={data.platform} />
      <FieldRow label={t('commerceAd.fields.audience')} value={data.audience} />
      <FieldRow label={t('commerceAd.fields.style')} value={data.style} />
      <FieldRow label={t('commerceAd.fields.headline')} value={data.headline} />
      <ChipList items={data.sellingPoints} />
    </div>
  );
}

function BatchContent({ data }: { data: CommerceBatchGenerateNodeData }) {
  const { t } = useTranslation();
  return (
    <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label={t('commerceAd.fields.ratios')} value={data.aspectRatios.join(' / ')} />
        <FieldRow label={t('commerceAd.fields.count')} value={String(data.variantsPerRatio)} />
      </div>
      <FieldRow label={t('commerceAd.fields.model')} value={data.modelId} />
      <FieldRow label={t('commerceAd.fields.size')} value={data.size} />
      {data.corePrompt ? (
        <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
          <div className="mb-2 text-xs font-medium text-text-dark">
            {t('commerceAd.fields.corePrompt')}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-5 text-text-dark/85">
            {data.corePrompt}
          </p>
        </div>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t('commerceAd.nodes.batchEmpty')}
        </div>
      )}
    </div>
  );
}

function ResultContent({ data }: { data: CommerceResultGroupNodeData }) {
  const { t } = useTranslation();
  const activeBatch = data.batches.find((batch) => batch.id === data.activeBatchId) ?? data.batches[0] ?? null;
  const images = activeBatch?.images ?? [];

  return (
    <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
      {activeBatch ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-border-dark/45 bg-bg-dark/80 px-2 py-1 text-[11px] text-text-dark">
              {t('commerceAd.fields.batches')}: {data.batches.length}
            </span>
            <span className="rounded-full border border-border-dark/45 bg-bg-dark/80 px-2 py-1 text-[11px] text-text-dark">
              {t('commerceAd.fields.images')}: {images.length}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {images.slice(0, 8).map((image) => (
              <div
                key={image.id}
                className="min-h-[72px] rounded-lg border border-white/[0.07] bg-black/[0.1] px-2 py-2 text-xs text-text-muted"
              >
                <div className="font-medium text-text-dark">{image.aspectRatio}</div>
                <div className="mt-1">{t(`commerceAd.status.${image.status}`)}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t('commerceAd.nodes.resultsEmpty')}
        </div>
      )}
    </div>
  );
}

export const CommerceStageNode = memo(({
  id,
  type,
  data,
  selected,
  width,
  height,
}: CommerceStageNodeProps) => {
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const resolvedWidth = resolveScriptNodeDimension(width, DEFAULT_WIDTH);
  const resolvedHeight = resolveScriptNodeDimension(height, DEFAULT_HEIGHT);
  const title = useMemo(
    () => resolveNodeDisplayName(type as CanvasNodeType, data),
    [data, type]
  );

  const stageMeta = useMemo(() => {
    if (type === CANVAS_NODE_TYPES.commerceProduct) {
      return { icon: <PackageSearch className="h-4 w-4" />, accent: 'amber' as const };
    }
    if (type === CANVAS_NODE_TYPES.commerceBrief) {
      return { icon: <FileText className="h-4 w-4" />, accent: 'cyan' as const };
    }
    if (type === CANVAS_NODE_TYPES.commerceBatchGenerate) {
      return { icon: <Sparkles className="h-4 w-4" />, accent: 'violet' as const };
    }
    return { icon: <Images className="h-4 w-4" />, accent: 'emerald' as const };
  }, [type]);

  return (
    <div className="relative h-full w-full">
      {type !== CANVAS_NODE_TYPES.commerceProduct ? (
        <Handle
          type="target"
          id="target"
          position={Position.Left}
          className="!h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-slate-400"
        />
      ) : null}
      {type !== CANVAS_NODE_TYPES.commerceResultGroup ? (
        <Handle
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
        onToggleEdit={() => setSelectedNode(id)}
        onDelete={() => deleteNode(id)}
        onClick={() => setSelectedNode(id)}
      >
        {type === CANVAS_NODE_TYPES.commerceProduct ? (
          <ProductContent data={data as CommerceProductNodeData} />
        ) : type === CANVAS_NODE_TYPES.commerceBrief ? (
          <BriefContent data={data as CommerceBriefNodeData} />
        ) : type === CANVAS_NODE_TYPES.commerceBatchGenerate ? (
          <BatchContent data={data as CommerceBatchGenerateNodeData} />
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
});

CommerceStageNode.displayName = 'CommerceStageNode';
