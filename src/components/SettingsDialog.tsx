import { useState, useCallback, useEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X, Eye, EyeOff, FolderOpen, Plus, Trash2, Maximize2, Minimize2, HardDrive, Circle, Keyboard, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import {
  checkDreaminaCliUpdate,
  checkDreaminaCliStatus,
  logoutDreaminaCli,
  updateDreaminaCli,
  type DreaminaCliUpdateInfoResponse,
  type DreaminaCliStatusResponse,
} from '@/commands/dreaminaCli';
import { useSettingsStore } from '@/stores/settingsStore';
import { useProjectStore } from '@/stores/projectStore';
import { usePsIntegrationStore } from '@/stores/psIntegrationStore';
import { testProviderConnection } from '@/commands/textGen';
import { 
  getStorageInfo, 
  listDatabaseBackups,
  createDatabaseBackup,
  restoreDatabaseBackup,
  migrateStorage, 
  openStorageFolder, 
  selectStorageFolder, 
  formatBytes,
  type DatabaseBackupRecord,
  type StorageInfo 
} from '@/commands/storage';
import { UiCheckbox, UiLoadingAnimation, UiModal, UiSelect } from '@/components/ui';
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion';
import { useDialogTransition } from '@/components/ui/useDialogTransition';
import { useDraggableDialog } from '@/components/ui/useDraggableDialog';
import { ProviderModelSettingsSection } from '@/components/settings/ProviderModelSettingsSection';
import {
  getCustomScriptModels,
  getCustomStoryboardModels,
  isScriptCompatibleProviderConfigured,
  isStoryboardCustomModelProviderId,
  listScriptProviders,
  resolveConfiguredScriptModel,
  resolveConfiguredStoryboardModel,
  resolveScriptModelOptions,
  SCRIPT_COMPATIBLE_PROVIDER_ID,
  resolveStoryboardCompatibleModelConfigForModel,
  resolveStoryboardNewApiModelConfigForModel,
  toStoryboardProviderModelId,
  upsertCustomScriptModelEntry,
  type CustomScriptModelEntry,
  type CustomStoryboardModelEntry,
  type ModelProviderDefinition,
  type ScriptCompatibleProviderConfig,
  listModelProviders,
  normalizeStoryboardNewApiModelConfig,
  type StoryboardNewApiModelConfig,
  upsertCustomStoryboardModelEntry,
} from '@/features/canvas/models';
import { GRSAI_CREDIT_TIERS } from '@/features/canvas/pricing/types';
import type { SettingsCategory } from '@/features/settings/settingsEvents';
import {
  DEFAULT_GROUP_NODES_SHORTCUT,
  formatShortcutForDisplay,
  getShortcutFromKeyboardEvent,
} from '@/features/settings/keyboardShortcuts';
import { openDreaminaSetupDialog } from '@/features/jimeng/dreaminaSetupDialogEvents';
import {
  RELEASE_NOTES,
  RELEASE_NOTE_SECTION_ORDER,
  type ReleaseNoteSectionKey,
} from '@/features/update/releaseNotes';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: SettingsCategory;
  onCheckUpdate?: () => Promise<'has-update' | 'up-to-date' | 'failed'>;
}

interface SettingsCheckboxCardProps {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

type ProviderTab = 'script' | 'storyboard';

interface ProviderGroupConfig {
  id: string;
  labelKey: string;
  providerIds?: readonly string[];
  includeRemaining?: boolean;
  defaultCollapsed?: boolean;
}

interface ResolvedProviderGroup extends ProviderGroupConfig {
  providers: ModelProviderDefinition[];
}

const SCRIPT_PROVIDER_GROUP_CONFIGS: ProviderGroupConfig[] = [
  {
    id: 'official',
    labelKey: 'settings.providerGroupOfficial',
    providerIds: ['alibaba', 'coding', 'volcengine'],
    defaultCollapsed: false,
  },
  {
    id: 'thirdParty',
    labelKey: 'settings.providerGroupThirdParty',
    includeRemaining: true,
    defaultCollapsed: true,
  },
];

const STORYBOARD_PROVIDER_GROUP_CONFIGS: ProviderGroupConfig[] = [
  {
    id: 'preferred',
    labelKey: 'settings.providerGroupPreferred',
    providerIds: ['grsai'],
    defaultCollapsed: false,
  },
  {
    id: 'stable',
    labelKey: 'settings.providerGroupStable',
    providerIds: ['kie', 'ppio', 'fal', 'volcengine'],
    defaultCollapsed: true,
  },
  {
    id: 'cheap',
    labelKey: 'settings.providerGroupAffordable',
    providerIds: ['azemm', 'zhenzhen', 'comfly', 'bltcy', 'runninghub'],
    defaultCollapsed: true,
  },
  {
    id: 'other',
    labelKey: 'settings.providerGroupOther',
    includeRemaining: true,
    defaultCollapsed: true,
  },
];

function resolveProviderGroups(
  providers: ModelProviderDefinition[],
  configs: ProviderGroupConfig[]
): ResolvedProviderGroup[] {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const usedProviderIds = new Set<string>();

  return configs
    .map((config) => {
      const groupedProviders = config.includeRemaining
        ? providers.filter((provider) => !usedProviderIds.has(provider.id))
        : (config.providerIds ?? [])
          .map((providerId) => providerMap.get(providerId))
          .filter((provider): provider is ModelProviderDefinition => Boolean(provider));

      groupedProviders.forEach((provider) => usedProviderIds.add(provider.id));

      return {
        ...config,
        providers: groupedProviders,
      };
    })
    .filter((group) => group.providers.length > 0);
}

function buildProviderGroupCollapseKey(tab: ProviderTab, groupId: string): string {
  return `${tab}:${groupId}`;
}

function buildDefaultProviderGroupCollapseState(): Record<string, boolean> {
  const nextState: Record<string, boolean> = {};

  for (const config of SCRIPT_PROVIDER_GROUP_CONFIGS) {
    nextState[buildProviderGroupCollapseKey('script', config.id)] = Boolean(config.defaultCollapsed);
  }

  for (const config of STORYBOARD_PROVIDER_GROUP_CONFIGS) {
    nextState[buildProviderGroupCollapseKey('storyboard', config.id)] = Boolean(config.defaultCollapsed);
  }

  return nextState;
}

const DEFAULT_PROVIDER_GROUP_COLLAPSE_STATE = buildDefaultProviderGroupCollapseState();

const RELEASE_NOTE_SECTION_LABEL_KEYS: Record<ReleaseNoteSectionKey, string> = {
  added: 'settings.releaseSectionAdded',
  optimized: 'settings.releaseSectionOptimized',
  fixed: 'settings.releaseSectionFixed',
};

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

const PROVIDER_REGISTER_URLS: Record<string, string> = {
  ppio: 'https://ppio.com/user/register?invited_by=WGY0DZ',
  grsai: 'https://grsai.com',
  kie: 'https://kie.ai?ref=eef20ef0b0595cad227d45b29c635f6c',
  fal: 'https://fal.ai',
  alibaba: 'https://bailian.console.aliyun.com',
  coding: 'https://bailian.console.aliyun.com',
  azemm: 'https://api.azemm.top',
  comfly: 'https://ai.comfly.chat/register?aff=25c82943753',
  zhenzhen: 'https://ai.t8star.cn/register?aff=9d51cc44298',
  bltcy: 'https://api.bltcy.ai/register?aff=z9mi114199',
  runninghub: 'https://www.runninghub.cn/?inviteCode=zfoso01c',
};

const PROVIDER_GET_KEY_URLS: Record<string, string> = {
  ppio: 'https://ppio.com/settings/key-management',
  grsai: 'https://grsai.com/zh/dashboard/api-keys',
  kie: 'https://kie.ai/api-key',
  fal: 'https://fal.ai/dashboard/keys',
  alibaba: 'https://bailian.console.aliyun.com/cn-beijing/#/api-key',
  coding: 'https://bailian.console.aliyun.com/cn-beijing/#/api-key',
  azemm: 'https://api.azemm.top',
  comfly: 'https://ai.comfly.chat/register?aff=25c82943753',
  zhenzhen: 'https://ai.t8star.cn/register?aff=9d51cc44298',
  bltcy: 'https://api.bltcy.ai/register?aff=z9mi114199',
  runninghub: 'https://www.runninghub.cn/?inviteCode=zfoso01c',
};

const DEFAULT_PROVIDER_TEST_MODELS: Record<string, string> = {
  ppio: 'ppio/gemini-3.1-flash',
  kie: 'kie/nano-banana-2',
  fal: 'fal/nano-banana-2',
  azemm: 'azemm/gemini-3.1-flash-image-preview',
  comfly: 'comfly/gemini-3.1-flash-image-preview',
  zhenzhen: 'zhenzhen/gemini-3.1-flash-image-preview',
  bltcy: 'bltcy/gemini-3.1-flash-image-preview-4k',
};

function resolveDatabaseBackupKindLabel(
  t: (key: string) => string,
  kind: DatabaseBackupRecord['kind']
): string {
  switch (kind) {
    case 'auto':
      return t('settings.backupKindAuto');
    case 'manual':
      return t('settings.backupKindManual');
    case 'pre_restore':
      return t('settings.backupKindPreRestore');
    default:
      return kind;
  }
}

function resolveDatabaseBackupKindBadgeClass(kind: DatabaseBackupRecord['kind']): string {
  switch (kind) {
    case 'auto':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'manual':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
    case 'pre_restore':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    default:
      return 'border-border-dark bg-bg-dark text-text-muted';
  }
}

function SettingsCheckboxCard({
  title,
  description,
  checked,
  onCheckedChange,
}: SettingsCheckboxCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onCheckedChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onCheckedChange(!checked);
        }
      }}
      className="w-full rounded-lg border border-border-dark bg-bg-dark p-4 text-left transition-colors hover:border-[rgba(255,255,255,0.2)]"
    >
      <div className="flex items-start gap-3">
        <UiCheckbox
          checked={checked}
          onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
          onClick={(event) => event.stopPropagation()}
          className="mt-0.5 shrink-0"
        />
        <div>
          <h3 className="text-sm font-medium text-text-dark">{title}</h3>
          <p className="mt-1 text-xs text-text-muted">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({
  isOpen,
  onClose,
  initialCategory = 'general',
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const {
    scriptApiKeys,
    storyboardApiKeys,
    scriptProviderEnabled,
    scriptModelOverrides,
    scriptProviderCustomModels,
    scriptCompatibleProviderConfig,
    storyboardModelOverrides,
    storyboardProviderCustomModels,
    hrsaiNanoBananaProModel,
    storyboardCompatibleModelConfig,
    storyboardNewApiModelConfig,
    downloadPresetPaths,
    useUploadFilenameAsNodeTitle,
    storyboardGenKeepStyleConsistent,
    storyboardGenDisableTextInImage,
    storyboardGenAutoInferEmptyFrame,
    ignoreAtTagWhenCopyingAndGenerating,
    enableStoryboardGenGridPreviewShortcut,
    groupNodesShortcut,
    showStoryboardGenAdvancedRatioControls,
    showNodePrice,
    priceDisplayCurrencyMode,
    usdToCnyRate,
    preferDiscountedPrice,
    grsaiCreditTierId,
    uiRadiusPreset,
    themeTonePreset,
    accentColor,
    canvasEdgeRoutingMode,
    autoUpdateDreaminaCliOnLaunch,
    setScriptProviderApiKey,
    setStoryboardProviderApiKey,
    setScriptProviderEnabled,
    setScriptModelOverride,
    setScriptProviderCustomModels,
    setScriptCompatibleProviderConfig,
    setStoryboardModelOverride,
    setStoryboardProviderCustomModels,
    setGrsaiNanoBananaProModel,
    setStoryboardCompatibleModelConfig,
    setStoryboardNewApiModelConfig,
    setDownloadPresetPaths,
    setUseUploadFilenameAsNodeTitle,
    setStoryboardGenKeepStyleConsistent,
    setStoryboardGenDisableTextInImage,
    setStoryboardGenAutoInferEmptyFrame,
    setIgnoreAtTagWhenCopyingAndGenerating,
    setEnableStoryboardGenGridPreviewShortcut,
    setGroupNodesShortcut,
    setShowStoryboardGenAdvancedRatioControls,
    setShowNodePrice,
    setPriceDisplayCurrencyMode,
    setUsdToCnyRate,
    setPreferDiscountedPrice,
    setGrsaiCreditTierId,
    setUiRadiusPreset,
    setThemeTonePreset,
    setAccentColor,
    setCanvasEdgeRoutingMode,
    setAutoUpdateDreaminaCliOnLaunch,
    psIntegrationEnabled,
    psServerPort,
    psAutoStartServer,
    setPsIntegrationEnabled,
    setPsServerPort,
    setPsAutoStartServer,
  } = useSettingsStore();
  const {
    serverStatus,
    isStarting,
    isStopping,
    startServer,
    stopServer,
  } = usePsIntegrationStore();
  const providers = useMemo(() => {
    const providerOrder = [
      'kie',
      'ppio',
      'fal',
      'grsai',
      'azemm',
      'comfly',
      'zhenzhen',
      'bltcy',
      'volcengine',
      'runninghub',
      'alibaba',
      'coding',
      'compatible',
      'newapi',
    ];
    const providerIndex = new Map(providerOrder.map((id, index) => [id, index]));
    return listModelProviders().slice().sort((left, right) => {
      const leftIndex = providerIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = providerIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
  }, []);
  const scriptProviders = useMemo(() => listScriptProviders(providers), [providers]);
  const storyboardProviders = useMemo(
    () => providers.filter((p) => p.id !== 'alibaba' && p.id !== 'coding'),
    [providers]
  );
  const scriptProviderGroups = useMemo(
    () => resolveProviderGroups(scriptProviders, SCRIPT_PROVIDER_GROUP_CONFIGS),
    [scriptProviders]
  );
  const storyboardProviderGroups = useMemo(
    () => resolveProviderGroups(storyboardProviders, STORYBOARD_PROVIDER_GROUP_CONFIGS),
    [storyboardProviders]
  );
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);
  const [localProviderTab, setLocalProviderTab] = useState<ProviderTab>('script');
  const [localScriptApiKeys, setLocalScriptApiKeys] = useState<Record<string, string>>(scriptApiKeys);
  const [localStoryboardApiKeys, setLocalStoryboardApiKeys] = useState<Record<string, string>>(storyboardApiKeys);
  const [localGrsaiNanoBananaProModel, setLocalGrsaiNanoBananaProModel] = useState(
   hrsaiNanoBananaProModel
  );
  const [localScriptProviderEnabled, setLocalScriptProviderEnabled] = useState(scriptProviderEnabled);
  const [selectedScriptProvider, setSelectedScriptProvider] = useState(scriptProviderEnabled || scriptProviders[0]?.id || '');
  const [selectedStoryboardProvider, setSelectedStoryboardProvider] = useState(storyboardProviders[0]?.id || '');
  const [localScriptModelOverrides, setLocalScriptModelOverrides] =
    useState<Record<string, string>>(scriptModelOverrides);
  const [localScriptProviderCustomModels, setLocalScriptProviderCustomModels] =
    useState<Record<string, CustomScriptModelEntry[]>>(scriptProviderCustomModels);
  const [localScriptCompatibleProviderConfig, setLocalScriptCompatibleProviderConfig] =
    useState<ScriptCompatibleProviderConfig>(scriptCompatibleProviderConfig);
  const [localScriptModelIdInputs, setLocalScriptModelIdInputs] =
    useState<Record<string, string>>({});
  const [localScriptModelDisplayNameInputs, setLocalScriptModelDisplayNameInputs] =
    useState<Record<string, string>>({});
  const [localStoryboardModelOverrides, setLocalStoryboardModelOverrides] =
    useState<Record<string, string>>(storyboardModelOverrides);
  const [localStoryboardProviderCustomModels, setLocalStoryboardProviderCustomModels] =
    useState<Record<string, CustomStoryboardModelEntry[]>>(storyboardProviderCustomModels);
  const [localStoryboardModelIdInputs, setLocalStoryboardModelIdInputs] =
    useState<Record<string, string>>({});
  const [localStoryboardModelDisplayNameInputs, setLocalStoryboardModelDisplayNameInputs] =
    useState<Record<string, string>>({});
  const [localStoryboardCompatibleModelConfig, setLocalStoryboardCompatibleModelConfig] =
    useState(storyboardCompatibleModelConfig);
  const [localStoryboardNewApiModelConfig, setLocalStoryboardNewApiModelConfig] =
    useState<StoryboardNewApiModelConfig>(normalizeStoryboardNewApiModelConfig(
      storyboardNewApiModelConfig
    ));
  const [localDownloadPathInput, setLocalDownloadPathInput] = useState('');
  const [localDownloadPresetPaths, setLocalDownloadPresetPaths] = useState(downloadPresetPaths);
  const [localUseUploadFilenameAsNodeTitle, setLocalUseUploadFilenameAsNodeTitle] = useState(
    useUploadFilenameAsNodeTitle
  );
  const [localStoryboardGenKeepStyleConsistent, setLocalStoryboardGenKeepStyleConsistent] =
    useState(storyboardGenKeepStyleConsistent);
  const [localStoryboardGenDisableTextInImage, setLocalStoryboardGenDisableTextInImage] = useState(
    storyboardGenDisableTextInImage
  );
  const [localStoryboardGenAutoInferEmptyFrame, setLocalStoryboardGenAutoInferEmptyFrame] = useState(
    storyboardGenAutoInferEmptyFrame
  );
  const [localIgnoreAtTagWhenCopyingAndGenerating, setLocalIgnoreAtTagWhenCopyingAndGenerating] =
    useState(ignoreAtTagWhenCopyingAndGenerating);
  const [localEnableStoryboardGenGridPreviewShortcut, setLocalEnableStoryboardGenGridPreviewShortcut] =
    useState(enableStoryboardGenGridPreviewShortcut);
  const [localGroupNodesShortcut, setLocalGroupNodesShortcut] = useState(groupNodesShortcut);
  const [localShowStoryboardGenAdvancedRatioControls, setLocalShowStoryboardGenAdvancedRatioControls] =
    useState(showStoryboardGenAdvancedRatioControls);
  const [localShowNodePrice, setLocalShowNodePrice] = useState(showNodePrice);
  const [localPriceDisplayCurrencyMode, setLocalPriceDisplayCurrencyMode] = useState(
    priceDisplayCurrencyMode
  );
  const [localUsdToCnyRate, setLocalUsdToCnyRate] = useState(String(usdToCnyRate));
  const [localPreferDiscountedPrice, setLocalPreferDiscountedPrice] = useState(
    preferDiscountedPrice
  );
  const [localGrsaiCreditTierId, setLocalGrsaiCreditTierId] = useState(grsaiCreditTierId);
  const [localUiRadiusPreset, setLocalUiRadiusPreset] = useState(uiRadiusPreset);
  const [localThemeTonePreset, setLocalThemeTonePreset] = useState(themeTonePreset);
  const [localAccentColor, setLocalAccentColor] = useState(accentColor);
  const [localCanvasEdgeRoutingMode, setLocalCanvasEdgeRoutingMode] = useState(canvasEdgeRoutingMode);
  const [localAutoUpdateDreaminaCliOnLaunch, setLocalAutoUpdateDreaminaCliOnLaunch] = useState(
    autoUpdateDreaminaCliOnLaunch
  );
  const [localPsIntegrationEnabled, setLocalPsIntegrationEnabled] = useState(psIntegrationEnabled);
  const [localPsServerPort, setLocalPsServerPort] = useState(psServerPort);
  const [localPsAutoStartServer, setLocalPsAutoStartServer] = useState(psAutoStartServer);
  const [collapsedProviderGroups, setCollapsedProviderGroups] = useState<Record<string, boolean>>(
    () => ({ ...DEFAULT_PROVIDER_GROUP_COLLAPSE_STATE })
  );
  const [revealedApiKeys, setRevealedApiKeys] = useState<Record<string, boolean>>({});
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [isDialogExpanded, setIsDialogExpanded] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [isLoadingStorageInfo, setIsLoadingStorageInfo] = useState(false);
  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackupRecord[]>([]);
  const [isLoadingDatabaseBackups, setIsLoadingDatabaseBackups] = useState(false);
  const [isCreatingDatabaseBackup, setIsCreatingDatabaseBackup] = useState(false);
  const [isRestoringDatabaseBackup, setIsRestoringDatabaseBackup] = useState(false);
  const [databaseBackupError, setDatabaseBackupError] = useState<string | null>(null);
  const [restoreBackupTarget, setRestoreBackupTarget] = useState<DatabaseBackupRecord | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState<string>('');
  const [dreaminaStatus, setDreaminaStatus] = useState<DreaminaCliStatusResponse | null>(null);
  const [dreaminaUpdateInfo, setDreaminaUpdateInfo] = useState<DreaminaCliUpdateInfoResponse | null>(null);
  const [isCheckingDreaminaStatus, setIsCheckingDreaminaStatus] = useState(false);
  const [isCheckingDreaminaUpdate, setIsCheckingDreaminaUpdate] = useState(false);
  const [isUpdatingDreamina, setIsUpdatingDreamina] = useState(false);
  const [isLoggingOutDreamina, setIsLoggingOutDreamina] = useState(false);
  const [dreaminaActionNotice, setDreaminaActionNotice] = useState<{
    tone: 'info' | 'success' | 'error';
    message: string;
  } | null>(null);
  const [isCapturingGroupShortcut, setIsCapturingGroupShortcut] = useState(false);
  const { shouldRender, isVisible } = useDialogTransition(isOpen, UI_DIALOG_TRANSITION_MS);
  const {
    panelRef,
    overlayLayoutClassName,
    panelPositionClassName,
    panelStyle,
    dragHandleClassName,
    isDragging,
    handleDragStart,
  } = useDraggableDialog({
    isOpen,
  });
  const runtimePsPort = serverStatus.running ? serverStatus.port : null;
  const pluginPsPort = runtimePsPort ?? psServerPort;
  const normalizedRuntimeVersion = useMemo(() => normalizeVersion(runtimeVersion), [runtimeVersion]);
  const psPortAutoAdjusted =
    serverStatus.running
    && serverStatus.port !== null
    && serverStatus.port !== psServerPort;

  useEffect(() => {
    let mounted = true;

    const loadVersion = async () => {
      try {
        const version = await getVersion();
        if (mounted) {
          setRuntimeVersion(version);
        }
      } catch {
        if (mounted) {
          setRuntimeVersion('');
        }
      }
    };

    void loadVersion();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLocalScriptApiKeys(scriptApiKeys);
    setLocalStoryboardApiKeys(storyboardApiKeys);
    setLocalDownloadPresetPaths(downloadPresetPaths);
    setLocalGrsaiNanoBananaProModel(hrsaiNanoBananaProModel);
    setLocalScriptProviderEnabled(scriptProviderEnabled);
    setSelectedScriptProvider(scriptProviderEnabled || scriptProviders[0]?.id || '');
    setSelectedStoryboardProvider(storyboardProviders[0]?.id || '');
    setLocalScriptModelOverrides(scriptModelOverrides);
    setLocalScriptProviderCustomModels(scriptProviderCustomModels);
    setLocalScriptCompatibleProviderConfig(scriptCompatibleProviderConfig);
    setLocalScriptModelIdInputs({});
    setLocalScriptModelDisplayNameInputs({});
    setLocalStoryboardModelOverrides(storyboardModelOverrides);
    setLocalStoryboardProviderCustomModels(storyboardProviderCustomModels);
    setLocalStoryboardModelIdInputs({});
    setLocalStoryboardModelDisplayNameInputs({});
    setLocalStoryboardCompatibleModelConfig(storyboardCompatibleModelConfig);
    setLocalStoryboardNewApiModelConfig(
      normalizeStoryboardNewApiModelConfig(storyboardNewApiModelConfig)
    );
    setLocalUseUploadFilenameAsNodeTitle(useUploadFilenameAsNodeTitle);
    setLocalStoryboardGenKeepStyleConsistent(storyboardGenKeepStyleConsistent);
    setLocalStoryboardGenDisableTextInImage(storyboardGenDisableTextInImage);
    setLocalStoryboardGenAutoInferEmptyFrame(storyboardGenAutoInferEmptyFrame);
    setLocalIgnoreAtTagWhenCopyingAndGenerating(ignoreAtTagWhenCopyingAndGenerating);
    setLocalEnableStoryboardGenGridPreviewShortcut(enableStoryboardGenGridPreviewShortcut);
    setLocalGroupNodesShortcut(groupNodesShortcut);
    setLocalShowStoryboardGenAdvancedRatioControls(showStoryboardGenAdvancedRatioControls);
    setLocalShowNodePrice(showNodePrice);
    setLocalPriceDisplayCurrencyMode(priceDisplayCurrencyMode);
    setLocalUsdToCnyRate(String(usdToCnyRate));
    setLocalPreferDiscountedPrice(preferDiscountedPrice);
    setLocalGrsaiCreditTierId(grsaiCreditTierId);
    setLocalUiRadiusPreset(uiRadiusPreset);
    setLocalThemeTonePreset(themeTonePreset);
    setLocalAccentColor(accentColor);
    setLocalCanvasEdgeRoutingMode(canvasEdgeRoutingMode);
    setLocalAutoUpdateDreaminaCliOnLaunch(autoUpdateDreaminaCliOnLaunch);
    setLocalPsIntegrationEnabled(psIntegrationEnabled);
    setLocalPsServerPort(psServerPort);
    setLocalPsAutoStartServer(psAutoStartServer);
    setCollapsedProviderGroups({ ...DEFAULT_PROVIDER_GROUP_COLLAPSE_STATE });
    setIsCapturingGroupShortcut(false);
    setDreaminaActionNotice(null);
    setRevealedApiKeys({});
    setLocalDownloadPathInput('');
  }, [
    isOpen,
    scriptApiKeys,
    storyboardApiKeys,
    downloadPresetPaths,
    hrsaiNanoBananaProModel,
    scriptProviderEnabled,
    scriptModelOverrides,
    scriptProviderCustomModels,
    scriptCompatibleProviderConfig,
    storyboardModelOverrides,
    storyboardProviderCustomModels,
    storyboardCompatibleModelConfig,
    storyboardNewApiModelConfig,
    useUploadFilenameAsNodeTitle,
    storyboardGenKeepStyleConsistent,
    storyboardGenDisableTextInImage,
    storyboardGenAutoInferEmptyFrame,
    ignoreAtTagWhenCopyingAndGenerating,
    enableStoryboardGenGridPreviewShortcut,
    groupNodesShortcut,
    showStoryboardGenAdvancedRatioControls,
    showNodePrice,
    priceDisplayCurrencyMode,
    usdToCnyRate,
    preferDiscountedPrice,
    grsaiCreditTierId,
    uiRadiusPreset,
    themeTonePreset,
    accentColor,
    canvasEdgeRoutingMode,
    autoUpdateDreaminaCliOnLaunch,
    psIntegrationEnabled,
    psServerPort,
    psAutoStartServer,
    scriptProviders,
    storyboardProviders,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveCategory(initialCategory);
  }, [initialCategory, isOpen]);

  useEffect(() => {
    if (!scriptProviders.some((provider) => provider.id === selectedScriptProvider)) {
      setSelectedScriptProvider(scriptProviders[0]?.id || '');
    }
  }, [scriptProviders, selectedScriptProvider]);

  useEffect(() => {
    if (!storyboardProviders.some((provider) => provider.id === selectedStoryboardProvider)) {
      setSelectedStoryboardProvider(storyboardProviders[0]?.id || '');
    }
  }, [selectedStoryboardProvider, storyboardProviders]);

  useEffect(() => {
    const selectedProviderId =
      localProviderTab === 'script' ? selectedScriptProvider : selectedStoryboardProvider;
    const groups = localProviderTab === 'script' ? scriptProviderGroups : storyboardProviderGroups;
    const selectedGroup = groups.find((group) =>
      group.providers.some((provider) => provider.id === selectedProviderId)
    );

    if (!selectedGroup) {
      return;
    }

    const collapseKey = buildProviderGroupCollapseKey(localProviderTab, selectedGroup.id);
    setCollapsedProviderGroups((previous) => (
      previous[collapseKey]
        ? {
            ...previous,
            [collapseKey]: false,
          }
        : previous
    ));
  }, [
    localProviderTab,
    scriptProviderGroups,
    selectedScriptProvider,
    selectedStoryboardProvider,
    storyboardProviderGroups,
  ]);

  const refreshDreaminaStatus = useCallback(
    async (options?: { silent?: boolean }) => {
      setIsCheckingDreaminaStatus(true);
      if (!options?.silent) {
        setDreaminaActionNotice(null);
      }

      try {
        const nextStatus = await checkDreaminaCliStatus();
        setDreaminaStatus(nextStatus);
        if (!options?.silent) {
          setDreaminaActionNotice({
            tone: 'info',
            message: t('settings.dreaminaStatusRefreshed'),
          });
        }
        return nextStatus;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fallbackStatus: DreaminaCliStatusResponse = {
          ready: false,
          code: 'unknown',
          message: t('settings.dreaminaStatusLoadFailed'),
          detail: message,
        };
        setDreaminaStatus(fallbackStatus);
        if (!options?.silent) {
          setDreaminaActionNotice({
            tone: 'error',
            message,
          });
        }
        return fallbackStatus;
      } finally {
        setIsCheckingDreaminaStatus(false);
      }
    },
    [t]
  );

  const refreshDreaminaUpdateInfo = useCallback(
    async (options?: { silent?: boolean }) => {
      setIsCheckingDreaminaUpdate(true);
      if (!options?.silent) {
        setDreaminaActionNotice(null);
      }

      try {
        const nextInfo = await checkDreaminaCliUpdate();
        setDreaminaUpdateInfo(nextInfo);
        if (!options?.silent && !nextInfo.checkError) {
          setDreaminaActionNotice({
            tone: nextInfo.hasUpdate ? 'info' : 'success',
            message: nextInfo.hasUpdate
              ? t('settings.dreaminaUpdateAvailableNotice', {
                  version: nextInfo.latestVersion ?? '-',
                })
              : t('settings.dreaminaUpToDateNotice'),
          });
        }
        return nextInfo;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setDreaminaUpdateInfo((previous) => previous ?? {
          activeSource: 'bundled',
          currentVersion: null,
          bundledVersion: null,
          latestVersion: null,
          releaseDate: null,
          releaseNotes: null,
          hasUpdate: false,
          checkError: message,
        });
        if (!options?.silent) {
          setDreaminaActionNotice({
            tone: 'error',
            message,
          });
        }
        return null;
      } finally {
        setIsCheckingDreaminaUpdate(false);
      }
    },
    [t]
  );

  const handleOpenDreaminaSetup = useCallback(() => {
    onClose();
    setTimeout(() => {
      openDreaminaSetupDialog({
        initialStatus: dreaminaStatus,
      });
    }, UI_DIALOG_TRANSITION_MS);
  }, [dreaminaStatus, onClose]);

  const handleUpdateDreamina = useCallback(async () => {
    setIsUpdatingDreamina(true);
    setDreaminaActionNotice(null);

    try {
      const response = await updateDreaminaCli();
      await Promise.all([
        refreshDreaminaStatus({ silent: true }),
        refreshDreaminaUpdateInfo({ silent: true }),
      ]);
      setDreaminaActionNotice({
        tone: 'success',
        message: response.detail ?? response.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDreaminaActionNotice({
        tone: 'error',
        message,
      });
    } finally {
      setIsUpdatingDreamina(false);
    }
  }, [refreshDreaminaStatus, refreshDreaminaUpdateInfo]);

  const handleLogoutDreamina = useCallback(async () => {
    setIsLoggingOutDreamina(true);
    setDreaminaActionNotice(null);

    try {
      const response = await logoutDreaminaCli();
      await refreshDreaminaStatus({ silent: true });
      setDreaminaActionNotice({
        tone: 'success',
        message: response.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDreaminaActionNotice({
        tone: 'error',
        message,
      });
    } finally {
      setIsLoggingOutDreamina(false);
    }
  }, [refreshDreaminaStatus]);

  const loadStorageInfo = useCallback(async () => {
    setIsLoadingStorageInfo(true);
    try {
      const info = await getStorageInfo();
      setStorageInfo(info);
    } catch (error) {
      console.error('Failed to load storage info:', error);
      setStorageInfo(null);
    } finally {
      setIsLoadingStorageInfo(false);
    }
  }, []);

  const loadDatabaseBackups = useCallback(async () => {
    setIsLoadingDatabaseBackups(true);
    try {
      const backups = await listDatabaseBackups();
      setDatabaseBackups(backups);
    } catch (error) {
      console.error('Failed to load database backups:', error);
      setDatabaseBackups([]);
    } finally {
      setIsLoadingDatabaseBackups(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || activeCategory !== 'general') {
      return;
    }

    void Promise.all([
      refreshDreaminaStatus({ silent: true }),
      refreshDreaminaUpdateInfo({ silent: true }),
    ]);
    void loadStorageInfo();
    void loadDatabaseBackups();
  }, [
    activeCategory,
    isOpen,
    loadDatabaseBackups,
    loadStorageInfo,
    refreshDreaminaStatus,
    refreshDreaminaUpdateInfo,
  ]);

  const handleChangeStoragePath = useCallback(async () => {
    if (isMigrating) return;

    try {
      const newPath = await selectStorageFolder();
      if (!newPath) return;

      setMigrationError(null);
      setIsMigrating(true);

      await useProjectStore.getState().flushCurrentProjectToDisk();
      await migrateStorage(newPath, true);
      window.location.reload();
    } catch (error) {
      setMigrationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMigrating(false);
    }
  }, [isMigrating]);

  const handleOpenStorageFolder = useCallback(async () => {
    try {
      await openStorageFolder();
    } catch (error) {
      console.error('Failed to open storage folder:', error);
    }
  }, []);

  const handleCreateDatabaseBackup = useCallback(async () => {
    if (isCreatingDatabaseBackup || isRestoringDatabaseBackup) {
      return;
    }

    try {
      setDatabaseBackupError(null);
      setIsCreatingDatabaseBackup(true);
      await createDatabaseBackup();
      await Promise.all([loadStorageInfo(), loadDatabaseBackups()]);
    } catch (error) {
      setDatabaseBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreatingDatabaseBackup(false);
    }
  }, [
    isCreatingDatabaseBackup,
    isRestoringDatabaseBackup,
    loadDatabaseBackups,
    loadStorageInfo,
  ]);

  const handleConfirmRestoreDatabaseBackup = useCallback(async () => {
    if (!restoreBackupTarget || isRestoringDatabaseBackup || isMigrating) {
      return;
    }

    try {
      setDatabaseBackupError(null);
      setIsRestoringDatabaseBackup(true);
      await restoreDatabaseBackup(restoreBackupTarget.id);
      window.location.reload();
    } catch (error) {
      setDatabaseBackupError(error instanceof Error ? error.message : String(error));
      setIsRestoringDatabaseBackup(false);
      setRestoreBackupTarget(null);
    }
  }, [isMigrating, isRestoringDatabaseBackup, restoreBackupTarget]);

  const resolveLocalScriptModel = useCallback((providerId: string) => {
    return resolveConfiguredScriptModel(providerId, {
      scriptModelOverrides: localScriptModelOverrides,
      scriptProviderCustomModels: localScriptProviderCustomModels,
    });
  }, [localScriptModelOverrides, localScriptProviderCustomModels]);

  const handleSelectScriptModel = useCallback((providerId: string, nextModel: string) => {
    const previousModel = resolveLocalScriptModel(providerId);
    console.info('[TextModelActivation] switch model', {
      provider: providerId,
      from: previousModel,
      to: nextModel,
      switchedAt: Date.now(),
    });
    setLocalScriptModelOverrides((previous) => ({
      ...previous,
      [providerId]: nextModel,
    }));
  }, [resolveLocalScriptModel]);

  const handleAddCustomScriptModel = useCallback((providerId: string) => {
    const nextModelId = (localScriptModelIdInputs[providerId] ?? '').trim();
    if (!nextModelId) {
      return;
    }

    const nextDisplayName = (localScriptModelDisplayNameInputs[providerId] ?? '').trim();
    setLocalScriptProviderCustomModels((previous) => ({
      ...previous,
      [providerId]: upsertCustomScriptModelEntry(
        providerId,
        getCustomScriptModels(providerId, previous),
        nextModelId,
        nextDisplayName
      ),
    }));
    setLocalScriptModelOverrides((previous) => ({
      ...previous,
      [providerId]: nextModelId,
    }));
    setLocalScriptModelIdInputs((previous) => ({ ...previous, [providerId]: '' }));
    setLocalScriptModelDisplayNameInputs((previous) => ({ ...previous, [providerId]: '' }));
  }, [localScriptModelDisplayNameInputs, localScriptModelIdInputs]);

  const handleRemoveCustomScriptModel = useCallback((
    providerId: string,
    model: CustomScriptModelEntry
  ) => {
    setLocalScriptProviderCustomModels((previous) => ({
      ...previous,
      [providerId]: getCustomScriptModels(providerId, previous).filter(
        (entry) => entry.id !== model.id
      ),
    }));
    setLocalScriptModelOverrides((previous) => ({
      ...previous,
      [providerId]:
        (previous[providerId] ?? '').trim() === model.modelId
          ? ''
          : (previous[providerId] ?? ''),
    }));
  }, []);

  const handleAddCustomStoryboardModel = useCallback((providerId: string) => {
    const nextModelId = (localStoryboardModelIdInputs[providerId] ?? '').trim();
    if (!nextModelId) {
      return;
    }

    const nextDisplayName = (localStoryboardModelDisplayNameInputs[providerId] ?? '').trim();
    const nextEntries = upsertCustomStoryboardModelEntry(
      providerId,
      getCustomStoryboardModels(providerId, localStoryboardProviderCustomModels),
      nextModelId,
      nextDisplayName
    );
    const nextResolvedModelId = toStoryboardProviderModelId(providerId, nextModelId);

    setLocalStoryboardProviderCustomModels((previous) => ({
      ...previous,
      [providerId]: nextEntries,
    }));
    setLocalStoryboardModelOverrides((previous) => ({
      ...previous,
      [providerId]: nextResolvedModelId,
    }));
    setLocalStoryboardModelIdInputs((previous) => ({ ...previous, [providerId]: '' }));
    setLocalStoryboardModelDisplayNameInputs((previous) => ({ ...previous, [providerId]: '' }));

    if (providerId === 'compatible') {
      setLocalStoryboardCompatibleModelConfig((previous) =>
        resolveStoryboardCompatibleModelConfigForModel(
          nextResolvedModelId,
          previous,
          { ...localStoryboardProviderCustomModels, [providerId]: nextEntries }
        )
      );
    }

    if (providerId === 'newapi') {
      setLocalStoryboardNewApiModelConfig((previous) =>
        resolveStoryboardNewApiModelConfigForModel(
          nextResolvedModelId,
          previous,
          { ...localStoryboardProviderCustomModels, [providerId]: nextEntries }
        )
      );
    }
  }, [
    localStoryboardModelDisplayNameInputs,
    localStoryboardModelIdInputs,
    localStoryboardProviderCustomModels,
  ]);

  const handleRemoveCustomStoryboardModel = useCallback((
    providerId: string,
    model: CustomStoryboardModelEntry
  ) => {
    const remainingEntries = getCustomStoryboardModels(
      providerId,
      localStoryboardProviderCustomModels
    ).filter((entry) => entry.id !== model.id);
    const nextCustomModels = {
      ...localStoryboardProviderCustomModels,
      [providerId]: remainingEntries,
    };
    const removedModelId = toStoryboardProviderModelId(providerId, model.modelId);
    const nextResolvedModel = resolveConfiguredStoryboardModel(providerId, {
      storyboardModelOverrides: {
        ...localStoryboardModelOverrides,
        [providerId]:
          (localStoryboardModelOverrides[providerId] ?? '').trim().toLowerCase()
          === removedModelId.toLowerCase()
            ? ''
            : (localStoryboardModelOverrides[providerId] ?? ''),
      },
      storyboardProviderCustomModels: nextCustomModels,
      storyboardCompatibleModelConfig: localStoryboardCompatibleModelConfig,
      storyboardNewApiModelConfig: localStoryboardNewApiModelConfig,
    });

    setLocalStoryboardProviderCustomModels(nextCustomModels);
    setLocalStoryboardModelOverrides((previous) => ({
      ...previous,
      [providerId]: nextResolvedModel,
    }));

    if (providerId === 'compatible') {
      setLocalStoryboardCompatibleModelConfig((previous) =>
        resolveStoryboardCompatibleModelConfigForModel(
          nextResolvedModel,
          {
            ...previous,
            requestModel: remainingEntries[0]?.modelId ?? '',
            displayName: remainingEntries[0]?.displayName ?? '',
          },
          nextCustomModels
        )
      );
    }

    if (providerId === 'newapi') {
      setLocalStoryboardNewApiModelConfig((previous) =>
        resolveStoryboardNewApiModelConfigForModel(
          nextResolvedModel,
          {
            ...previous,
            requestModel: remainingEntries[0]?.modelId ?? '',
            displayName: remainingEntries[0]?.displayName ?? '',
          },
          nextCustomModels
        )
      );
    }
  }, [
    localStoryboardCompatibleModelConfig,
    localStoryboardModelOverrides,
    localStoryboardNewApiModelConfig,
    localStoryboardProviderCustomModels,
  ]);

  const handleSave = useCallback(() => {
    scriptProviders.forEach((provider) => {
      setScriptProviderApiKey(provider.id, localScriptApiKeys[provider.id] ?? '');
    });
    storyboardProviders.forEach((provider) => {
      setStoryboardProviderApiKey(provider.id, localStoryboardApiKeys[provider.id] ?? '');
    });
    setGrsaiNanoBananaProModel(localGrsaiNanoBananaProModel);
    setScriptProviderEnabled(localScriptProviderEnabled);
    scriptProviders.forEach((provider) => {
      setScriptModelOverride(provider.id, resolveConfiguredScriptModel(provider.id, {
        scriptModelOverrides: localScriptModelOverrides,
        scriptProviderCustomModels: localScriptProviderCustomModels,
      }));
      setScriptProviderCustomModels(
        provider.id,
        getCustomScriptModels(provider.id, localScriptProviderCustomModels)
      );
    });
    setScriptCompatibleProviderConfig(localScriptCompatibleProviderConfig);
    setStoryboardCompatibleModelConfig(localStoryboardCompatibleModelConfig);
    setStoryboardNewApiModelConfig(localStoryboardNewApiModelConfig);
    storyboardProviders.forEach((provider) => {
      if (!isStoryboardCustomModelProviderId(provider.id)) {
        return;
      }

      setStoryboardModelOverride(
        provider.id,
        resolveConfiguredStoryboardModel(provider.id, {
          storyboardModelOverrides: localStoryboardModelOverrides,
          storyboardProviderCustomModels: localStoryboardProviderCustomModels,
          storyboardCompatibleModelConfig: localStoryboardCompatibleModelConfig,
          storyboardNewApiModelConfig: localStoryboardNewApiModelConfig,
        })
      );
      setStoryboardProviderCustomModels(
        provider.id,
        getCustomStoryboardModels(provider.id, localStoryboardProviderCustomModels)
      );
    });
    setDownloadPresetPaths(localDownloadPresetPaths);
    setUseUploadFilenameAsNodeTitle(localUseUploadFilenameAsNodeTitle);
    setStoryboardGenKeepStyleConsistent(localStoryboardGenKeepStyleConsistent);
    setStoryboardGenDisableTextInImage(localStoryboardGenDisableTextInImage);
    setStoryboardGenAutoInferEmptyFrame(localStoryboardGenAutoInferEmptyFrame);
    setIgnoreAtTagWhenCopyingAndGenerating(localIgnoreAtTagWhenCopyingAndGenerating);
    setEnableStoryboardGenGridPreviewShortcut(localEnableStoryboardGenGridPreviewShortcut);
    setGroupNodesShortcut(localGroupNodesShortcut);
    setShowStoryboardGenAdvancedRatioControls(localShowStoryboardGenAdvancedRatioControls);
    setShowNodePrice(localShowNodePrice);
    setPriceDisplayCurrencyMode(localPriceDisplayCurrencyMode);
    setUsdToCnyRate(Number(localUsdToCnyRate));
    setPreferDiscountedPrice(localPreferDiscountedPrice);
    setGrsaiCreditTierId(localGrsaiCreditTierId);
    setUiRadiusPreset(localUiRadiusPreset);
    setThemeTonePreset(localThemeTonePreset);
    setAccentColor(localAccentColor);
    setCanvasEdgeRoutingMode(localCanvasEdgeRoutingMode);
    setAutoUpdateDreaminaCliOnLaunch(localAutoUpdateDreaminaCliOnLaunch);
    setPsIntegrationEnabled(localPsIntegrationEnabled);
    setPsServerPort(localPsServerPort);
    setPsAutoStartServer(localPsAutoStartServer);
    onClose();
  }, [
    localScriptApiKeys,
    localStoryboardApiKeys,
    localDownloadPresetPaths,
    localGrsaiNanoBananaProModel,
    localUseUploadFilenameAsNodeTitle,
    localStoryboardGenKeepStyleConsistent,
    localStoryboardGenDisableTextInImage,
    localStoryboardGenAutoInferEmptyFrame,
    localIgnoreAtTagWhenCopyingAndGenerating,
    localEnableStoryboardGenGridPreviewShortcut,
    localGroupNodesShortcut,
    localShowStoryboardGenAdvancedRatioControls,
    localShowNodePrice,
    localPriceDisplayCurrencyMode,
    localUsdToCnyRate,
    localPreferDiscountedPrice,
    localGrsaiCreditTierId,
    localUiRadiusPreset,
    localThemeTonePreset,
    localAccentColor,
    localCanvasEdgeRoutingMode,
    localAutoUpdateDreaminaCliOnLaunch,
    localPsIntegrationEnabled,
    localPsServerPort,
    localPsAutoStartServer,
    localScriptModelOverrides,
    localScriptProviderCustomModels,
    localScriptCompatibleProviderConfig,
    localStoryboardCompatibleModelConfig,
    localStoryboardNewApiModelConfig,
    localStoryboardModelOverrides,
    localStoryboardProviderCustomModels,
    scriptProviders,
    storyboardProviders,
    setScriptProviderApiKey,
    setStoryboardProviderApiKey,
    setGrsaiNanoBananaProModel,
    setScriptProviderEnabled,
    setScriptModelOverride,
    setScriptProviderCustomModels,
    setScriptCompatibleProviderConfig,
    setStoryboardModelOverride,
    setStoryboardProviderCustomModels,
    setStoryboardCompatibleModelConfig,
    setStoryboardNewApiModelConfig,
    setDownloadPresetPaths,
    setUseUploadFilenameAsNodeTitle,
    setStoryboardGenKeepStyleConsistent,
    setStoryboardGenDisableTextInImage,
    setStoryboardGenAutoInferEmptyFrame,
    setIgnoreAtTagWhenCopyingAndGenerating,
    setEnableStoryboardGenGridPreviewShortcut,
    setGroupNodesShortcut,
    setShowStoryboardGenAdvancedRatioControls,
    setShowNodePrice,
    setPriceDisplayCurrencyMode,
    setUsdToCnyRate,
    setPreferDiscountedPrice,
    setGrsaiCreditTierId,
    setUiRadiusPreset,
    setThemeTonePreset,
    setAccentColor,
    setCanvasEdgeRoutingMode,
    setAutoUpdateDreaminaCliOnLaunch,
    setPsIntegrationEnabled,
    setPsServerPort,
    setPsAutoStartServer,
    onClose,
    localScriptProviderEnabled,
  ]);

  const displayedGroupNodesShortcut = useMemo(
    () => formatShortcutForDisplay(localGroupNodesShortcut),
    [localGroupNodesShortcut]
  );
  const dreaminaStatusMeta = useMemo(() => {
    if (isCheckingDreaminaStatus && !dreaminaStatus) {
      return {
        label: t('settings.dreaminaStatusChecking'),
        className: 'border-border-dark bg-surface-dark text-text-muted',
      };
    }

    switch (dreaminaStatus?.code) {
      case 'ready':
        return {
          label: t('settings.dreaminaStatusReady'),
          className: 'border-green-500/30 bg-green-500/10 text-green-400',
        };
      case 'membershipRequired':
        return {
          label: t('settings.dreaminaStatusMembershipRequired'),
          className: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
        };
      case 'loginRequired':
        return {
          label: t('settings.dreaminaStatusLoginRequired'),
          className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        };
      case 'cliMissing':
        return {
          label: t('settings.dreaminaStatusCliMissing'),
          className: 'border-red-500/30 bg-red-500/10 text-red-300',
        };
      case 'gitBashMissing':
        return {
          label: t('settings.dreaminaStatusGitMissing'),
          className: 'border-red-500/30 bg-red-500/10 text-red-300',
        };
      default:
        return {
          label: t('settings.dreaminaStatusUnknown'),
          className: 'border-border-dark bg-surface-dark text-text-muted',
        };
    }
  }, [dreaminaStatus, isCheckingDreaminaStatus, t]);
  const dreaminaActiveSourceLabel = useMemo(() => {
    switch (dreaminaUpdateInfo?.activeSource) {
      case 'userInstalled':
        return t('settings.dreaminaSourceUserInstalled');
      case 'systemPath':
        return t('settings.dreaminaSourceSystemPath');
      case 'bundled':
      default:
        return t('settings.dreaminaSourceBundled');
    }
  }, [dreaminaUpdateInfo?.activeSource, t]);
  const dreaminaNoticeClassName =
    dreaminaActionNotice?.tone === 'error'
      ? 'border-red-500/30 bg-red-500/10 text-red-300'
      : dreaminaActionNotice?.tone === 'success'
        ? 'border-green-500/30 bg-green-500/10 text-green-400'
        : 'border-accent/20 bg-accent/[0.08] text-text-muted';

  const formatReleaseDate = useCallback(
    (value: string) => {
      const date = new Date(`${value}T00:00:00`);
      if (Number.isNaN(date.getTime())) {
        return value;
      }

      return new Intl.DateTimeFormat(i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date);
    },
    [i18n.language]
  );

  const handleGroupShortcutKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setIsCapturingGroupShortcut(false);
        return;
      }

      const nextShortcut = getShortcutFromKeyboardEvent(
        event.nativeEvent,
        localGroupNodesShortcut
      );
      if (!nextShortcut) {
        return;
      }

      setLocalGroupNodesShortcut(nextShortcut);
      setIsCapturingGroupShortcut(false);
    },
    [localGroupNodesShortcut]
  );

  const handlePickDownloadPath = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      setLocalDownloadPresetPaths((previous) => {
        if (previous.includes(selected)) {
          return previous;
        }
        return [...previous, selected].slice(0, 8);
      });
    } catch (error) {
      console.error('Failed to pick download path', error);
    }
  }, []);

  const handleAddDownloadPathFromInput = useCallback(() => {
    const next = localDownloadPathInput.trim();
    if (!next) {
      return;
    }
    setLocalDownloadPresetPaths((previous) => {
      if (previous.includes(next)) {
        return previous;
      }
      return [...previous, next].slice(0, 8);
    });
    setLocalDownloadPathInput('');
  }, [localDownloadPathInput]);

  const handleRemoveDownloadPath = useCallback((path: string) => {
    setLocalDownloadPresetPaths((previous) => previous.filter((value) => value !== path));
  }, []);

  if (!shouldRender) return null;

  return (
    <div className={`fixed ${UI_CONTENT_OVERLAY_INSET_CLASS} z-50 ${overlayLayoutClassName}`}>
      <div
        className={`absolute inset-0 bg-black/90 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div ref={panelRef} className={panelPositionClassName} style={panelStyle}>
        <div
          className={`relative overflow-hidden rounded-lg border border-border-dark bg-surface-dark shadow-xl ${isDragging ? 'transition-none' : 'transition-opacity duration-200'} ${isVisible ? 'opacity-100' : 'opacity-0'} flex flex-col ${isDialogExpanded ? 'w-[min(94vw,1000px)] h-[min(90vh,700px)]' : 'w-[700px] h-[500px]'}`}
        >
          <div
            className={`flex items-center justify-between border-b border-border-dark px-4 py-3 ${dragHandleClassName}`}
            onPointerDown={handleDragStart}
          >
            <div className="text-sm font-medium text-text-dark">{t('settings.title')}</div>
            <div className="flex items-center gap-1" data-ui-modal-drag-ignore="true">
              <button
                onClick={() => setIsDialogExpanded(!isDialogExpanded)}
                className="p-1 hover:bg-bg-dark rounded transition-colors"
                title={isDialogExpanded ? t('settings.dialogCollapse') : t('settings.dialogExpand')}
              >
                {isDialogExpanded ? (
                  <Minimize2 className="w-5 h-5 text-text-muted" />
                ) : (
                  <Maximize2 className="w-5 h-5 text-text-muted" />
                )}
              </button>
              <button
                onClick={onClose}
                className="p-1 hover:bg-bg-dark rounded transition-colors"
              >
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
          {/* Sidebar */}
          <div className="w-[180px] bg-bg-dark border-r border-border-dark flex flex-col">
            <div className="px-4 py-4">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                {t('settings.title')}
              </span>
            </div>

            <nav className="flex-1">
              <button
                onClick={() => setActiveCategory('general')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'general'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.general')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('providers')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'providers'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.providers')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('appearance')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'appearance'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.appearance')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('pricing')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'pricing'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.pricing')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('experimental')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'experimental'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.experimental')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('releaseNotes')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'releaseNotes'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.releaseNotes')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('psIntegration')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'psIntegration'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.psIntegration')}</span>
              </button>

              <button
                onClick={() => setActiveCategory('about')}
                className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left
                transition-colors
                ${activeCategory === 'about'
                    ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                    : 'text-text-muted hover:bg-bg-dark hover:text-text-dark'
                  }
              `}
              >
                <span className="text-sm">{t('settings.about')}</span>
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col">
            {activeCategory === 'providers' && (
              <>
                <div className="px-6 py-4 border-b border-border-dark">
                  <div className="flex gap-1">
                    <button
                      onClick={() => setLocalProviderTab('script')}
                      className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                        localProviderTab === 'script'
                          ? 'bg-surface-dark text-text-dark border-t border-l border-r border-border-dark -mb-px'
                          : 'text-text-muted hover:text-text-dark'
                      }`}
                    >
                      {t('settings.scriptApiEnabled')}
                    </button>
                    <button
                      onClick={() => setLocalProviderTab('storyboard')}
                      className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                        localProviderTab === 'storyboard'
                          ? 'bg-surface-dark text-text-dark border-t border-l border-r border-border-dark -mb-px'
                          : 'text-text-muted hover:text-text-dark'
                      }`}
                    >
                      {t('settings.storyboardApiEnabled')}
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex min-h-0">
                  <div className="w-[196px] border-r border-border-dark bg-bg-dark flex flex-col">
                    <div className="px-3 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">
                      {t('settings.providerList')}
                    </div>
                    <nav className="flex-1 overflow-y-auto ui-scrollbar">
                      {(localProviderTab === 'script'
                        ? scriptProviderGroups
                        : storyboardProviderGroups).map((group) => {
                          const isCollapsed = Boolean(
                            collapsedProviderGroups[
                              buildProviderGroupCollapseKey(localProviderTab, group.id)
                            ]
                          );

                          return (
                            <div
                              key={`${localProviderTab}-${group.id}`}
                              className="border-b border-border-dark/70 last:border-b-0"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setCollapsedProviderGroups((previous) => ({
                                    ...previous,
                                    [buildProviderGroupCollapseKey(localProviderTab, group.id)]:
                                      !isCollapsed,
                                  }))
                                }
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted transition-colors hover:bg-surface-dark hover:text-text-dark"
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span className="min-w-0 flex-1 truncate">
                                  {t(group.labelKey)}
                                </span>
                                <span className="text-[10px] text-text-muted/80">
                                  {group.providers.length}
                                </span>
                              </button>

                              {!isCollapsed && (
                                <div className="pb-1">
                                  {group.providers.map((provider) => {
                                    const providerApiKey = (
                                      localProviderTab === 'script'
                                        ? localScriptApiKeys[provider.id]
                                        : localStoryboardApiKeys[provider.id]
                                    ) ?? '';
                                    const hasKey = Boolean(providerApiKey.trim());
                                    const selectedProviderId =
                                      localProviderTab === 'script'
                                        ? selectedScriptProvider
                                        : selectedStoryboardProvider;
                                    const isSelected = selectedProviderId === provider.id;
                                    const isEnabled =
                                      localProviderTab === 'script'
                                      && localScriptProviderEnabled === provider.id
                                      && hasKey;

                                    return (
                                      <button
                                        key={provider.id}
                                        onClick={() => {
                                          if (localProviderTab === 'script') {
                                            setSelectedScriptProvider(provider.id);
                                          } else {
                                            setSelectedStoryboardProvider(provider.id);
                                          }
                                        }}
                                        className={`ml-2 flex w-[calc(100%-8px)] items-center gap-2 rounded-l-md px-3 py-2 text-left transition-colors ${
                                          isSelected
                                            ? 'border-l-2 border-accent bg-accent/10 text-text-dark'
                                            : 'text-text-muted hover:bg-surface-dark hover:text-text-dark'
                                        }`}
                                      >
                                        <span
                                          className={`h-2 w-2 shrink-0 rounded-full ${hasKey ? 'bg-green-500' : 'bg-border-dark'}`}
                                          title={hasKey ? t('settings.keyConfigured') : t('settings.keyNotConfigured')}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-xs">
                                          {i18n.language.startsWith('zh') ? provider.label : provider.name}
                                        </span>
                                        {isEnabled && (
                                          <span className="text-[10px] font-medium text-amber-500">
                                            {t('settings.providerActive')}
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </nav>
                    <nav className="hidden">
                      {false && (localProviderTab === 'script' ? scriptProviders : storyboardProviders).map((provider) => {
                        const providerApiKey = (
                          localProviderTab === 'script'
                            ? localScriptApiKeys[provider.id]
                            : localStoryboardApiKeys[provider.id]
                        ) ?? '';
                        const hasKey = Boolean(providerApiKey.trim());
                        const selectedProviderId = localProviderTab === 'script' ? selectedScriptProvider : selectedStoryboardProvider;
                        const isSelected = selectedProviderId === provider.id;
                        const isEnabled = localProviderTab === 'script' && localScriptProviderEnabled === provider.id && hasKey;
                        return (
                          <button
                            key={provider.id}
                            onClick={() => {
                              if (localProviderTab === 'script') {
                                setSelectedScriptProvider(provider.id);
                              } else {
                                setSelectedStoryboardProvider(provider.id);
                              }
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                              isSelected
                                ? 'bg-accent/10 text-text-dark border-l-2 border-accent'
                                : 'text-text-muted hover:bg-surface-dark hover:text-text-dark'
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${hasKey ? 'bg-green-500' : 'bg-border-dark'}`}
                              title={hasKey ? t('settings.keyConfigured') : t('settings.keyNotConfigured')}
                            />
                            <span className="text-xs truncate">
                              {i18n.language.startsWith('zh') ? provider.label : provider.name}
                            </span>
                            {isEnabled && (
                              <span className="ml-auto text-[10px] text-amber-500 font-medium">{t('settings.providerActive')}</span>
                            )}
                          </button>
                        );
                      })}
                    </nav>
                  </div>

                  <div className="flex-1 overflow-y-auto ui-scrollbar p-5">
                    {(() => {
                      const selectedProviderId = localProviderTab === 'script' ? selectedScriptProvider : selectedStoryboardProvider;
                      const provider = providers.find(p => p.id === selectedProviderId);
                      if (!provider) return null;
                      const displayName = i18n.language.startsWith('zh') ? provider.label : provider.name;
                      const isScriptTab = localProviderTab === 'script';
                      const revealKey = `${localProviderTab}:${provider.id}`;
                      const currentApiKey = (
                        isScriptTab
                          ? localScriptApiKeys[provider.id]
                          : localStoryboardApiKeys[provider.id]
                      ) ?? '';
                      const isRevealed = Boolean(revealedApiKeys[revealKey]);
                      const hasKey = Boolean(currentApiKey.trim());
                      const isKeyInputEmpty = currentApiKey.length === 0;
                      const clearApiKeyButtonTitle = `${t('common.delete')} ${t('settings.apiKey')}`;
                      const isEnabled = isScriptTab && localScriptProviderEnabled === provider.id && hasKey;
                      const updateCurrentApiKey = (nextValue: string) => {
                        if (isScriptTab) {
                          setLocalScriptApiKeys((previous) => ({
                            ...previous,
                            [provider.id]: nextValue,
                          }));
                          if (!nextValue.trim() && localScriptProviderEnabled === provider.id) {
                            setLocalScriptProviderEnabled('');
                          }
                          return;
                        }

                        setLocalStoryboardApiKeys((previous) => ({
                          ...previous,
                          [provider.id]: nextValue,
                        }));
                      };
                      const clearCurrentApiKey = () => {
                        updateCurrentApiKey('');
                        setRevealedApiKeys((previous) =>
                          previous[revealKey]
                            ? {
                                ...previous,
                                [revealKey]: false,
                              }
                            : previous
                        );
                      };
                      const resolvedScriptModel = isScriptTab
                        ? resolveConfiguredScriptModel(provider.id, {
                            scriptModelOverrides: localScriptModelOverrides,
                            scriptProviderCustomModels: localScriptProviderCustomModels,
                          })
                        : '';
                      const isScriptCompatibleProvider =
                        isScriptTab && provider.id === SCRIPT_COMPATIBLE_PROVIDER_ID;
                      const isScriptProviderReady =
                        isScriptTab
                        && resolvedScriptModel.trim().length > 0
                        && (
                          !isScriptCompatibleProvider
                          || isScriptCompatibleProviderConfigured(localScriptCompatibleProviderConfig)
                        );
                      const scriptModelOptions = isScriptTab
                        ? resolveScriptModelOptions(provider.id, localScriptProviderCustomModels)
                        : [];
                      const customScriptModels = isScriptTab
                        ? getCustomScriptModels(provider.id, localScriptProviderCustomModels)
                        : [];
                      const customScriptModelDisplayNameInput =
                        localScriptModelDisplayNameInputs[provider.id] ?? '';
                      const customScriptModelIdInput =
                        localScriptModelIdInputs[provider.id] ?? '';
                      const isStoryboardCustomizableProvider =
                        !isScriptTab && isStoryboardCustomModelProviderId(provider.id);
                      const customStoryboardModels = isStoryboardCustomizableProvider
                        ? getCustomStoryboardModels(provider.id, localStoryboardProviderCustomModels)
                        : [];
                      const customStoryboardModelDisplayNameInput =
                        localStoryboardModelDisplayNameInputs[provider.id] ?? '';
                      const customStoryboardModelIdInput =
                        localStoryboardModelIdInputs[provider.id] ?? '';

                      return (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span
                                className={`w-3 h-3 rounded-full ${hasKey ? 'bg-green-500' : 'bg-border-dark'}`}
                              />
                              <h3 className="text-base font-medium text-text-dark">{displayName}</h3>
                              {hasKey && (
                                <span className="text-xs text-green-500 bg-green-500/10 px-2 py-0.5 rounded">
                                  {t('settings.keyConfigured')}
                                </span>
                              )}
                              </div>
                            {isScriptTab && (
                              <button
                                type="button"
                                disabled={!hasKey || !isScriptProviderReady}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const switchedAt = Date.now();
                                  const nextProvider = isEnabled ? '' : provider.id;
                                  console.info('[TextModelActivation] switch provider', {
                                    scope: 'script',
                                    from: localScriptProviderEnabled,
                                    to: nextProvider,
                                    switchedAt,
                                  });
                                  setLocalScriptProviderEnabled(isEnabled ? '' : provider.id);
                                }}
                                className={`relative overflow-hidden px-4 py-1.5 text-xs font-medium text-transparent rounded transition-colors ${
                                  isEnabled
                                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                                    : 'bg-surface-dark text-text-dark border border-border-dark hover:bg-bg-dark disabled:opacity-50 disabled:cursor-not-allowed'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none absolute inset-0 flex items-center justify-center ${
                                    isEnabled ? 'text-white' : 'text-text-dark'
                                  }`}
                                >
                                  {isEnabled ? t('settings.providerActive') : t('settings.providerActivate')}
                                </span>
                                {isEnabled ? t('settings.providerActive') : t('settings.providerActivate')}
                              </button>
                            )}
                          </div>

                          <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                            <div className="mb-2 text-xs font-medium text-text-dark">
                              {t('settings.apiKey')}
                            </div>
                            {PROVIDER_REGISTER_URLS[provider.id] && PROVIDER_GET_KEY_URLS[provider.id] && (
                              <p className="mb-3 text-xs text-text-muted">
                                {t('settings.providerApiKeyGuidePrefix')}{' '}
                                <a
                                  href={PROVIDER_REGISTER_URLS[provider.id]}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-accent hover:underline"
                                >
                                  {t('settings.providerRegisterLink')}
                                </a>
                                {t('settings.providerApiKeyGuideMiddle')}{' '}
                                <a
                                  href={PROVIDER_GET_KEY_URLS[provider.id]}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-accent hover:underline"
                                >
                                  {t('settings.getApiKeyLink')}
                                </a>
                              </p>
                            )}
                            <div className="relative">
                              <input
                                type={isRevealed ? 'text' : 'password'}
                                value={currentApiKey}
                                onChange={(event) => {
                                  updateCurrentApiKey(event.target.value);
                                }}
                                placeholder={t('settings.enterApiKey')}
                                className="w-full rounded border border-border-dark bg-surface-dark px-3 py-2 pr-20 text-sm text-text-dark placeholder:text-text-muted"
                              />
                              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={clearCurrentApiKey}
                                  disabled={isKeyInputEmpty}
                                  title={clearApiKeyButtonTitle}
                                  aria-label={clearApiKeyButtonTitle}
                                  className="rounded p-1 hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <X className="h-4 w-4 text-text-muted" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRevealedApiKeys((previous) => ({
                                      ...previous,
                                      [revealKey]: !isRevealed,
                                    }))
                                  }
                                  className="rounded p-1 hover:bg-bg-dark"
                                >
                                  {isRevealed ? (
                                    <EyeOff className="h-4 w-4 text-text-muted" />
                                  ) : (
                                    <Eye className="h-4 w-4 text-text-muted" />
                                  )}
                                </button>
                              </div>
                            </div>
                            {!isScriptTab ? (
                              provider.id === 'compatible' ? (
                                <div className="mt-3 rounded-md border border-border-dark bg-black/10 px-3 py-2 text-xs leading-5 text-text-muted">
                                  {t('settings.storyboardCompatibleNoConnectionTest')}
                                </div>
                              ) : provider.id === 'newapi' ? (
                                <div className="mt-3 rounded-md border border-border-dark bg-black/10 px-3 py-2 text-xs leading-5 text-text-muted">
                                  {t('settings.storyboardNewApiNoConnectionTest')}
                                </div>
                              ) : null
                            ) : (
                              <div className="mt-3 space-y-2">
                                <button
                                  type="button"
                                  disabled={
                                    testingConnection === provider.id
                                    || !hasKey
                                    || (isScriptTab && !isScriptProviderReady)
                                  }
                                  onClick={async () => {
                                    setTestingConnection(provider.id);
                                    const model = isScriptTab
                                      ? resolvedScriptModel
                                      : provider.id === 'grsai'
                                        ? localGrsaiNanoBananaProModel
                                        : DEFAULT_PROVIDER_TEST_MODELS[provider.id] ?? 'gemini-2.0-flash';
                                    const result = await testProviderConnection({
                                      provider: provider.id,
                                      apiKey: currentApiKey,
                                      model,
                                      extraParams:
                                        isScriptCompatibleProvider
                                          ? {
                                            compatible_config: {
                                              api_format: 'openai-chat',
                                              endpoint_url: localScriptCompatibleProviderConfig.endpointUrl,
                                              request_model: model,
                                              display_name: model,
                                            },
                                          }
                                          : undefined,
                                    });
                                    setTestResults((prev) => ({ ...prev, [provider.id]: result }));
                                    setTestingConnection(null);
                                  }}
                                  className="rounded px-3 py-1.5 text-xs bg-surface-dark text-text-dark border border-border-dark hover:bg-bg-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                  {testingConnection === provider.id
                                    ? t('common.loading')
                                    : t('settings.testConnection')}
                                </button>
                                {testResults[provider.id] && (
                                  <div
                                    aria-live="polite"
                                    className={`max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-md border px-3 py-2 text-xs leading-5 ${
                                      testResults[provider.id].success
                                        ? 'border-green-500/30 bg-green-500/10 text-green-500'
                                        : 'border-red-500/30 bg-red-500/10 text-red-500'
                                    }`}
                                  >
                                    {testResults[provider.id].success ? '✓' : '✗'}{' '}
                                    {testResults[provider.id].message}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <ProviderModelSettingsSection
                            provider={provider}
                            isScriptTab={isScriptTab}
                            isScriptCompatibleProvider={isScriptCompatibleProvider}
                            isStoryboardCustomizableProvider={isStoryboardCustomizableProvider}
                            resolvedScriptModel={resolvedScriptModel}
                            scriptModelOptions={scriptModelOptions}
                            customScriptModels={customScriptModels}
                            customScriptModelIdInput={customScriptModelIdInput}
                            customScriptModelDisplayNameInput={customScriptModelDisplayNameInput}
                            onSelectScriptModel={(modelId) =>
                              handleSelectScriptModel(provider.id, modelId)
                            }
                            onScriptModelIdInputChange={(value) =>
                              setLocalScriptModelIdInputs((previous) => ({
                                ...previous,
                                [provider.id]: value,
                              }))
                            }
                            onScriptModelDisplayNameInputChange={(value) =>
                              setLocalScriptModelDisplayNameInputs((previous) => ({
                                ...previous,
                                [provider.id]: value,
                              }))
                            }
                            onAddCustomScriptModel={() => handleAddCustomScriptModel(provider.id)}
                            onRemoveCustomScriptModel={(model) =>
                              handleRemoveCustomScriptModel(provider.id, model)
                            }
                            scriptCompatibleProviderConfig={localScriptCompatibleProviderConfig}
                            onScriptCompatibleEndpointUrlChange={(value) =>
                              setLocalScriptCompatibleProviderConfig((previous) => ({
                                ...previous,
                                endpointUrl: value,
                              }))
                            }
                            customStoryboardModels={customStoryboardModels}
                            customStoryboardModelIdInput={customStoryboardModelIdInput}
                            customStoryboardModelDisplayNameInput={
                              customStoryboardModelDisplayNameInput
                            }
                            onStoryboardModelIdInputChange={(value) =>
                              setLocalStoryboardModelIdInputs((previous) => ({
                                ...previous,
                                [provider.id]: value,
                              }))
                            }
                            onStoryboardModelDisplayNameInputChange={(value) =>
                              setLocalStoryboardModelDisplayNameInputs((previous) => ({
                                ...previous,
                                [provider.id]: value,
                              }))
                            }
                            onAddCustomStoryboardModel={() =>
                              handleAddCustomStoryboardModel(provider.id)
                            }
                            onRemoveCustomStoryboardModel={(model) =>
                              handleRemoveCustomStoryboardModel(provider.id, model)
                            }
                            storyboardCompatibleModelConfig={localStoryboardCompatibleModelConfig}
                            onStoryboardCompatibleFormatChange={(format) =>
                              setLocalStoryboardCompatibleModelConfig((previous) => ({
                                ...previous,
                                apiFormat: format,
                              }))
                            }
                            onStoryboardCompatibleEndpointUrlChange={(value) =>
                              setLocalStoryboardCompatibleModelConfig((previous) => ({
                                ...previous,
                                endpointUrl: value,
                              }))
                            }
                            storyboardNewApiModelConfig={localStoryboardNewApiModelConfig}
                            onStoryboardNewApiFormatChange={(format) =>
                              setLocalStoryboardNewApiModelConfig((previous) => ({
                                ...previous,
                                apiFormat: format,
                              }))
                            }
                            onStoryboardNewApiEndpointUrlChange={(value) =>
                              setLocalStoryboardNewApiModelConfig((previous) => ({
                                ...previous,
                                endpointUrl: value,
                              }))
                            }
                            grsaiNanoBananaProModel={localGrsaiNanoBananaProModel}
                            onGrsaiNanoBananaProModelChange={(value) =>
                              setLocalGrsaiNanoBananaProModel(value)
                            }
                          />

                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-border-dark flex justify-end">
                  <button
                    onClick={handleSave}
                    className="px-4 py-2 text-sm font-medium bg-accent text-white rounded
                             hover:bg-accent/80 transition-colors"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'appearance' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.appearance')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.appearanceDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.radiusPreset')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.radiusPresetDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localUiRadiusPreset}
                        onChange={(event) =>
                          setLocalUiRadiusPreset(event.target.value as typeof localUiRadiusPreset)
                        }
                        className="h-9 text-sm"
                      >
                        <option value="compact">{t('settings.radiusCompact')}</option>
                        <option value="default">{t('settings.radiusDefault')}</option>
                        <option value="large">{t('settings.radiusLarge')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.themeTone')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.themeToneDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localThemeTonePreset}
                        onChange={(event) =>
                          setLocalThemeTonePreset(event.target.value as typeof localThemeTonePreset)
                        }
                        className="h-9 text-sm"
                      >
                        <option value="neutral">{t('settings.toneNeutral')}</option>
                        <option value="warm">{t('settings.toneWarm')}</option>
                        <option value="cool">{t('settings.toneCool')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.edgeRoutingMode')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.edgeRoutingModeDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localCanvasEdgeRoutingMode}
                        onChange={(event) =>
                          setLocalCanvasEdgeRoutingMode(
                            event.target.value as typeof localCanvasEdgeRoutingMode
                          )
                        }
                        className="h-9 text-sm"
                      >
                        <option value="spline">{t('settings.edgeRoutingSpline')}</option>
                        <option value="orthogonal">{t('settings.edgeRoutingOrthogonal')}</option>
                        <option value="smartOrthogonal">{t('settings.edgeRoutingSmartOrthogonal')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.accentColor')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.accentColorDesc')}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="color"
                        value={localAccentColor}
                        onChange={(event) => setLocalAccentColor(event.target.value)}
                        className="h-9 w-12 rounded border border-border-dark bg-surface-dark p-1"
                      />
                      <input
                        value={localAccentColor}
                        onChange={(event) => setLocalAccentColor(event.target.value)}
                        placeholder="#3B82F6"
                        className="h-9 flex-1 rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                      />
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={() => setLocalAccentColor('#3B82F6')}
                      >
                        {t('settings.resetAccentColor')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'pricing' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.pricing')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.pricingDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <SettingsCheckboxCard
                    checked={localShowNodePrice}
                    onCheckedChange={setLocalShowNodePrice}
                    title={t('settings.showNodePrice')}
                    description={t('settings.showNodePriceDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.priceDisplayCurrencyMode')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.priceDisplayCurrencyModeDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localPriceDisplayCurrencyMode}
                        onChange={(event) =>
                          setLocalPriceDisplayCurrencyMode(
                            event.target.value as typeof localPriceDisplayCurrencyMode
                          )
                        }
                        className="h-9 text-sm"
                      >
                        <option value="auto">{t('settings.priceCurrencyAuto')}</option>
                        <option value="cny">{t('settings.priceCurrencyCny')}</option>
                        <option value="usd">{t('settings.priceCurrencyUsd')}</option>
                      </UiSelect>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.usdToCnyRate')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.usdToCnyRateDesc')}
                    </p>
                    <div className="mt-3">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={localUsdToCnyRate}
                        onChange={(event) => setLocalUsdToCnyRate(event.target.value)}
                        className="h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                      />
                    </div>
                  </div>

                  <SettingsCheckboxCard
                    checked={localPreferDiscountedPrice}
                    onCheckedChange={setLocalPreferDiscountedPrice}
                    title={t('settings.preferDiscountedPrice')}
                    description={t('settings.preferDiscountedPriceDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.grsaiCreditTier')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.grsaiCreditTierDesc')}
                    </p>
                    <div className="mt-3">
                      <UiSelect
                        value={localGrsaiCreditTierId}
                        onChange={(event) =>
                          setLocalGrsaiCreditTierId(event.target.value as typeof localGrsaiCreditTierId)
                        }
                        className="h-9 text-sm"
                      >
                        {GRSAI_CREDIT_TIERS.map((tier) => (
                          <option key={tier.id} value={tier.id}>
                            {t('settings.grsaiCreditTierOption', {
                              price: tier.priceCny.toFixed(2),
                              credits: tier.credits.toLocaleString(i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'),
                            })}
                          </option>
                        ))}
                      </UiSelect>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'general' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.general')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.generalDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-medium text-text-dark">
                          {t('settings.dreaminaSectionTitle')}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-text-muted">
                          {t('settings.dreaminaSectionDesc')}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${dreaminaStatusMeta.className}`}
                      >
                        {dreaminaStatusMeta.label}
                      </span>
                    </div>

                    <div className="mt-3 rounded border border-border-dark bg-surface-dark p-3">
                      <div className="text-[11px] uppercase tracking-wide text-text-muted">
                        {t('settings.dreaminaStatusLabel')}
                      </div>
                      <div className="mt-1 flex items-start gap-2">
                        {isCheckingDreaminaStatus && (
                          <UiLoadingAnimation size="sm" className="mt-0.5 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm text-text-dark">
                            {dreaminaStatus?.message ?? t('settings.dreaminaStatusChecking')}
                          </div>
                          {dreaminaStatus?.detail && dreaminaStatus.code !== 'loginRequired' && (
                            <div className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-text-muted">
                              {dreaminaStatus.detail}
                            </div>
                          )}

                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded border border-border-dark bg-surface-dark p-3">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">
                          {t('settings.dreaminaCurrentVersionLabel')}
                        </div>
                        <div className="mt-1 text-sm font-medium text-text-dark">
                          {dreaminaUpdateInfo?.currentVersion
                            ? `v${dreaminaUpdateInfo.currentVersion}`
                            : t('settings.dreaminaVersionUnknown')}
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          {t('settings.dreaminaSourceLabel')}: {dreaminaActiveSourceLabel}
                        </div>
                      </div>

                      <div className="rounded border border-border-dark bg-surface-dark p-3">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">
                          {t('settings.dreaminaLatestVersionLabel')}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-sm font-medium text-text-dark">
                          {isCheckingDreaminaUpdate && !dreaminaUpdateInfo ? (
                            <>
                              <UiLoadingAnimation size="xs" />
                              {t('settings.dreaminaCheckingUpdate')}
                            </>
                          ) : dreaminaUpdateInfo?.latestVersion ? (
                            `v${dreaminaUpdateInfo.latestVersion}`
                          ) : (
                            t('settings.dreaminaVersionUnknown')
                          )}
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          {t('settings.dreaminaReleaseDateLabel')}:{' '}
                          {dreaminaUpdateInfo?.releaseDate ?? t('settings.dreaminaVersionUnknown')}
                        </div>
                      </div>
                    </div>

                    {dreaminaUpdateInfo?.releaseNotes && (
                      <div className="mt-3 rounded border border-border-dark bg-surface-dark p-3">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">
                          {t('settings.dreaminaReleaseNotesLabel')}
                        </div>
                        <div className="mt-1 text-sm text-text-dark">
                          {dreaminaUpdateInfo.releaseNotes}
                        </div>
                      </div>
                    )}

                    {dreaminaUpdateInfo?.checkError && (
                      <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
                        {t('settings.dreaminaUpdateCheckFailedLabel')}: {dreaminaUpdateInfo.checkError}
                      </div>
                    )}

                    {dreaminaActionNotice && (
                      <div
                        className={`mt-3 rounded border px-3 py-2 text-xs leading-5 ${dreaminaNoticeClassName}`}
                      >
                        {dreaminaActionNotice.message}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={
                          isCheckingDreaminaStatus || isLoggingOutDreamina || isUpdatingDreamina
                        }
                        onClick={() => {
                          void refreshDreaminaStatus();
                        }}
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isCheckingDreaminaStatus ? (
                          <>
                            <UiLoadingAnimation size="xs" className="mr-1.5" />
                            {t('settings.dreaminaStatusChecking')}
                          </>
                        ) : (
                          t('settings.dreaminaRefreshStatus')
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={isCheckingDreaminaUpdate || isUpdatingDreamina}
                        onClick={() => {
                          void refreshDreaminaUpdateInfo();
                        }}
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isCheckingDreaminaUpdate ? (
                          <>
                            <UiLoadingAnimation size="xs" className="mr-1.5" />
                            {t('settings.dreaminaCheckingUpdate')}
                          </>
                        ) : (
                          t('settings.dreaminaCheckUpdate')
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={
                          isCheckingDreaminaUpdate ||
                          isUpdatingDreamina ||
                          !dreaminaUpdateInfo?.hasUpdate
                        }
                        onClick={() => {
                          void handleUpdateDreamina();
                        }}
                        className="inline-flex h-9 items-center justify-center rounded border border-accent/30 bg-accent/10 px-3 text-xs text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isUpdatingDreamina ? (
                          <>
                            <UiLoadingAnimation size="xs" className="mr-1.5" />
                            {t('settings.dreaminaUpdating')}
                          </>
                        ) : (
                          t('settings.dreaminaUpdateNow')
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleOpenDreaminaSetup}
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                      >
                        {t('settings.dreaminaOpenSetup')}
                      </button>

                      {(isLoggingOutDreamina || dreaminaStatus?.code === 'ready') && (
                        <button
                          type="button"
                          disabled={
                            isCheckingDreaminaStatus || isLoggingOutDreamina || isUpdatingDreamina
                          }
                          onClick={() => {
                            void handleLogoutDreamina();
                          }}
                          className="inline-flex h-9 items-center justify-center rounded border border-red-500/30 bg-red-500/10 px-3 text-xs text-red-300 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isLoggingOutDreamina ? (
                            <>
                              <UiLoadingAnimation size="xs" className="mr-1.5" />
                              {t('settings.dreaminaLoggingOut')}
                            </>
                          ) : (
                            t('settings.dreaminaLogout')
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <SettingsCheckboxCard
                    checked={localAutoUpdateDreaminaCliOnLaunch}
                    onCheckedChange={setLocalAutoUpdateDreaminaCliOnLaunch}
                    title={t('settings.dreaminaAutoUpdateOnLaunch')}
                    description={t('settings.dreaminaAutoUpdateOnLaunchDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localStoryboardGenKeepStyleConsistent}
                    onCheckedChange={setLocalStoryboardGenKeepStyleConsistent}
                    title={t('settings.storyboardGenKeepStyleConsistent')}
                    description={t('settings.storyboardGenKeepStyleConsistentDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localIgnoreAtTagWhenCopyingAndGenerating}
                    onCheckedChange={setLocalIgnoreAtTagWhenCopyingAndGenerating}
                    title={t('settings.ignoreAtTagWhenCopyingAndGenerating')}
                    description={t('settings.ignoreAtTagWhenCopyingAndGeneratingDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localStoryboardGenDisableTextInImage}
                    onCheckedChange={setLocalStoryboardGenDisableTextInImage}
                    title={t('settings.storyboardGenDisableTextInImage')}
                    description={t('settings.storyboardGenDisableTextInImageDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localUseUploadFilenameAsNodeTitle}
                    onCheckedChange={setLocalUseUploadFilenameAsNodeTitle}
                    title={t('settings.useUploadFilenameAsNodeTitle')}
                    description={t('settings.useUploadFilenameAsNodeTitleDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-3">
                      <h3 className="flex items-center gap-2 text-sm font-medium text-text-dark">
                        <Keyboard className="h-4 w-4" />
                        {t('settings.groupNodesShortcut')}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.groupNodesShortcutDesc')}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsCapturingGroupShortcut(true)}
                        onKeyDown={handleGroupShortcutKeyDown}
                        onBlur={() => setIsCapturingGroupShortcut(false)}
                        className={`inline-flex h-9 min-w-[160px] items-center justify-center rounded border px-3 text-sm transition-colors ${
                          isCapturingGroupShortcut
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border-dark bg-surface-dark text-text-dark hover:bg-bg-dark'
                        }`}
                      >
                        {isCapturingGroupShortcut
                          ? t('settings.shortcutRecording')
                          : displayedGroupNodesShortcut}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setLocalGroupNodesShortcut(DEFAULT_GROUP_NODES_SHORTCUT);
                          setIsCapturingGroupShortcut(false);
                        }}
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        {t('settings.shortcutReset')}
                      </button>
                    </div>

                    <p className="mt-2 text-xs text-text-muted">
                      {isCapturingGroupShortcut
                        ? t('settings.shortcutPressNew')
                        : t('settings.shortcutCurrent', {
                            shortcut: displayedGroupNodesShortcut,
                          })}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-medium text-text-dark">
                        {t('settings.downloadPresetPaths')}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.downloadPresetPathsDesc')}
                      </p>
                    </div>

                    <div className="mb-2 flex items-center gap-2">
                      <input
                        value={localDownloadPathInput}
                        onChange={(event) => setLocalDownloadPathInput(event.target.value)}
                        placeholder={t('settings.downloadPathPlaceholder')}
                        className="h-9 flex-1 rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                      />
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={handleAddDownloadPathFromInput}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        {t('settings.addPath')}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                        onClick={() => {
                          void handlePickDownloadPath();
                        }}
                      >
                        <FolderOpen className="mr-1 h-3.5 w-3.5" />
                        {t('settings.chooseFolder')}
                      </button>
                    </div>

                    <div className="space-y-1">
                      {localDownloadPresetPaths.length > 0 ? (
                        localDownloadPresetPaths.map((path) => (
                          <div
                            key={path}
                            className="flex items-center gap-2 rounded border border-border-dark bg-surface-dark px-2 py-1.5"
                          >
                            <span className="truncate text-xs text-text-dark">{path}</span>
                            <button
                              type="button"
                              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-dark hover:text-text-dark"
                              onClick={() => handleRemoveDownloadPath(path)}
                              title={t('common.delete')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-text-muted">{t('settings.noDownloadPresetPaths')}</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-medium text-text-dark flex items-center gap-2">
                        <HardDrive className="h-4 w-4" />
                        {t('settings.projectStoragePath')}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {t('settings.projectStoragePathDesc')}
                      </p>
                    </div>

                    {isLoadingStorageInfo ? (
                      <div className="flex items-center justify-center py-4">
                        <UiLoadingAnimation size="md" />
                      </div>
                    ) : storageInfo ? (
                      <>
                        <div className="mb-3 rounded border border-border-dark bg-surface-dark p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <span className="text-xs text-text-muted">{t('settings.currentPath')}:</span>
                            <span className="flex-1 truncate text-xs text-text-dark">
                              {storageInfo.currentPath}
                            </span>
                            {storageInfo.isCustom && (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                                {t('settings.customPath')}
                              </span>
                            )}
                          </div>
                          <div className="mb-3 rounded border border-accent/20 bg-accent/[0.08] px-2.5 py-2 text-xs text-text-muted">
                            <span className="font-medium text-text-dark">
                              {t('settings.sharedDatabase')}
                            </span>
                            <span className="ml-1">
                              {t('settings.storageSharedHint')}
                            </span>
                          </div>
                          <div className="mb-3 space-y-2">
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 text-xs text-text-muted">
                                {t('settings.databaseFilePath')}:
                              </span>
                              <span className="min-w-0 break-all font-mono text-[11px] text-text-dark">
                                {storageInfo.dbPath}
                              </span>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 text-xs text-text-muted">
                                {t('settings.assetImagesPath')}:
                              </span>
                              <span className="min-w-0 break-all font-mono text-[11px] text-text-dark">
                                {storageInfo.imagesPath}
                              </span>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 text-xs text-text-muted">
                                {t('settings.backupFolderPath')}:
                              </span>
                              <span className="min-w-0 break-all font-mono text-[11px] text-text-dark">
                                {storageInfo.backupsPath}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
                            <span>
                              {t('settings.database')}: {formatBytes(storageInfo.dbSize)}
                            </span>
                            <span>
                              {t('settings.images')}: {formatBytes(storageInfo.imagesSize)}
                            </span>
                            <span>
                              {t('settings.backups')}: {formatBytes(storageInfo.backupsSize)}
                            </span>
                            <span>
                              {t('settings.total')}: {formatBytes(storageInfo.totalSize)}
                            </span>
                          </div>
                        </div>

                        {migrationError && (
                          <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
                            {migrationError}
                          </div>
                        )}

                        {databaseBackupError && (
                          <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
                            {databaseBackupError}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isMigrating}
                            onClick={() => void handleChangeStoragePath()}
                            className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                          >
                            {isMigrating ? (
                              <>
                                <UiLoadingAnimation size="xs" className="mr-1.5" />
                                {t('settings.migrating')}
                              </>
                            ) : (
                              <>
                                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                                {t('settings.changePath')}
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleOpenStorageFolder()}
                            className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                          >
                            {t('settings.openFolder')}
                          </button>
                          <button
                            type="button"
                            disabled={isCreatingDatabaseBackup || isRestoringDatabaseBackup || isMigrating}
                            onClick={() => void handleCreateDatabaseBackup()}
                            className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                          >
                            {isCreatingDatabaseBackup ? (
                              <>
                                <UiLoadingAnimation size="xs" className="mr-1.5" />
                                {t('settings.creatingBackup')}
                              </>
                            ) : (
                              <>
                                <Plus className="mr-1.5 h-3.5 w-3.5" />
                                {t('settings.createBackupNow')}
                              </>
                            )}
                          </button>
                        </div>

                        <div className="mt-4 rounded border border-border-dark bg-surface-dark p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h4 className="text-xs font-medium text-text-dark">
                                {t('settings.databaseBackupTitle')}
                              </h4>
                              <p className="mt-1 text-xs text-text-muted">
                                {t('settings.databaseBackupDesc')}
                              </p>
                            </div>
                            <div className="rounded bg-accent/[0.08] px-2 py-1 text-[11px] text-text-muted">
                              {t('settings.backupsRetention')}
                            </div>
                          </div>

                          {isLoadingDatabaseBackups ? (
                            <div className="flex items-center justify-center py-5">
                              <UiLoadingAnimation size="sm" />
                            </div>
                          ) : databaseBackups.length > 0 ? (
                            <div className="ui-scrollbar mt-3 max-h-[220px] space-y-2 overflow-y-auto pr-1">
                              {databaseBackups.map((backup) => (
                                <div
                                  key={backup.id}
                                  className="flex items-center gap-3 rounded border border-border-dark bg-bg-dark px-3 py-2.5"
                                >
                                  <span
                                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${resolveDatabaseBackupKindBadgeClass(backup.kind)}`}
                                  >
                                    {resolveDatabaseBackupKindLabel(t, backup.kind)}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs text-text-dark">
                                      {new Date(backup.createdAt).toLocaleString()}
                                    </div>
                                    <div className="mt-0.5 truncate text-[11px] text-text-muted">
                                      {formatBytes(backup.size)} - {backup.id}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={isRestoringDatabaseBackup || isMigrating}
                                    onClick={() => {
                                      setDatabaseBackupError(null);
                                      setRestoreBackupTarget(backup);
                                    }}
                                    className="inline-flex h-8 items-center justify-center rounded border border-border-dark bg-surface-dark px-2.5 text-[11px] text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
                                  >
                                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                    {t('settings.restoreBackup')}
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-3 text-xs text-text-muted">
                              {t('settings.noDatabaseBackups')}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-text-muted">{t('settings.failedToLoadStorageInfo')}</div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'experimental' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.experimental')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.experimentalDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <SettingsCheckboxCard
                    checked={localEnableStoryboardGenGridPreviewShortcut}
                    onCheckedChange={setLocalEnableStoryboardGenGridPreviewShortcut}
                    title={t('settings.enableStoryboardGenGridPreviewShortcut')}
                    description={t('settings.enableStoryboardGenGridPreviewShortcutDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localShowStoryboardGenAdvancedRatioControls}
                    onCheckedChange={setLocalShowStoryboardGenAdvancedRatioControls}
                    title={t('settings.showStoryboardGenAdvancedRatioControls')}
                    description={t('settings.showStoryboardGenAdvancedRatioControlsDesc')}
                  />

                  <SettingsCheckboxCard
                    checked={localStoryboardGenAutoInferEmptyFrame}
                    onCheckedChange={setLocalStoryboardGenAutoInferEmptyFrame}
                    title={t('settings.storyboardGenAutoInferEmptyFrame')}
                    description={t('settings.storyboardGenAutoInferEmptyFrameDesc')}
                  />
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'releaseNotes' && (
              <>
                <div className="border-b border-border-dark px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-text-dark">
                        {t('settings.releaseNotes')}
                      </h2>
                      <p className="mt-1 text-sm text-text-muted">
                        {t('settings.releaseNotesDesc')}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-right">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                        {t('settings.aboutVersionLabel')}
                      </p>
                      <p className="mt-1 text-sm font-medium text-text-dark">
                        {runtimeVersion || t('settings.aboutVersionUnknown')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  {RELEASE_NOTES.length > 0 ? (
                    RELEASE_NOTES.map((note) => {
                      const noteSections = RELEASE_NOTE_SECTION_ORDER
                        .map((sectionKey) => ({
                          sectionKey,
                          items: note.sections[sectionKey] ?? [],
                        }))
                        .filter(({ items }) => items.length > 0);
                      const isCurrentVersion =
                        normalizedRuntimeVersion.length > 0
                        && normalizeVersion(note.version) === normalizedRuntimeVersion;

                      return (
                        <section
                          key={note.version}
                          className="overflow-hidden rounded-xl border border-border-dark bg-bg-dark"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-dark px-4 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-semibold text-text-dark">
                                v{note.version}
                              </h3>
                              {isCurrentVersion && (
                                <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                                  {t('settings.currentVersionBadge')}
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-text-muted">
                              {t('settings.releaseDate')}: {formatReleaseDate(note.date)}
                            </p>
                          </div>

                          <div className="space-y-4 p-4">
                            {noteSections.map(({ sectionKey, items }) => (
                              <div key={sectionKey} className="space-y-2">
                                <h4 className="text-sm font-medium text-text-dark">
                                  {t(RELEASE_NOTE_SECTION_LABEL_KEYS[sectionKey])}
                                </h4>
                                <ul className="space-y-2">
                                  {items.map((itemKey) => (
                                    <li
                                      key={itemKey}
                                      className="flex items-start gap-2 text-sm text-text-muted"
                                    >
                                      <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/80" />
                                      <span>{t(itemKey)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })
                  ) : (
                    <div className="rounded-lg border border-dashed border-border-dark bg-bg-dark p-6 text-sm text-text-muted">
                      {t('settings.releaseNotesEmpty')}
                    </div>
                  )}
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <div className="flex gap-2">
                    <button
                      onClick={onClose}
                      className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark"
                    >
                      {t('common.close')}
                    </button>
                    <button
                      onClick={handleSave}
                      className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                    >
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeCategory === 'psIntegration' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.psIntegration')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.psIntegrationDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <SettingsCheckboxCard
                    checked={localPsIntegrationEnabled}
                    onCheckedChange={setLocalPsIntegrationEnabled}
                    title={t('settings.psIntegrationEnabled')}
                    description={t('settings.psIntegrationEnabledDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.psServerPort')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.psServerPortDesc')}
                    </p>
                    <div className="mt-3">
                      <input
                        type="number"
                        min={1024}
                        max={65535}
                        value={localPsServerPort}
                        onChange={(event) => {
                          const port = parseInt(event.target.value, 10);
                          if (!isNaN(port) && port >= 1024 && port <= 65535) {
                            setLocalPsServerPort(port);
                          }
                        }}
                        className="h-9 w-full rounded border border-border-dark bg-surface-dark px-3 text-sm text-text-dark outline-none placeholder:text-text-muted"
                      />
                    </div>
                    <div className="mt-3 space-y-1 rounded-md border border-border-dark bg-surface-dark/70 p-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-text-muted">{t('settings.psPreferredPort')}</span>
                        <span className="font-medium text-text-dark">{psServerPort}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-text-muted">{t('settings.psRuntimePort')}</span>
                        <span className="font-medium text-text-dark">
                          {runtimePsPort ?? t('settings.psServerNotRunning')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-text-muted">{t('settings.psPluginPort')}</span>
                        <span className="font-medium text-accent">{pluginPsPort}</span>
                      </div>
                    </div>
                    {psPortAutoAdjusted && runtimePsPort !== null && (
                      <p className="mt-3 text-xs text-amber-400">
                        {t('settings.psPortAutoAdjusted', {
                          actual: runtimePsPort,
                          requested: psServerPort,
                        })}
                      </p>
                    )}
                  </div>

                  <SettingsCheckboxCard
                    checked={localPsAutoStartServer}
                    onCheckedChange={setLocalPsAutoStartServer}
                    title={t('settings.psAutoStartServer')}
                    description={t('settings.psAutoStartServerDesc')}
                  />

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark mb-3">
                      {t('settings.psStatus')}
                    </h3>
                    <div className="flex items-center gap-2 mb-4">
                      <Circle
                        className={`w-2.5 h-2.5 ${
                          serverStatus.running ? 'fill-green-500 text-green-500' : 'fill-text-muted text-text-muted'
                        }`}
                      />
                      <span className="text-sm text-text-dark">
                        {serverStatus.running
                          ? t('settings.psConnected', { port: serverStatus.port })
                          : t('settings.psDisconnected')}
                      </span>
                    </div>
                    <p className="mb-4 text-xs text-text-muted">
                      {t('settings.psPluginPortDesc', { port: pluginPsPort })}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isStarting || serverStatus.running}
                        onClick={() => void startServer(localPsServerPort)}
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isStarting ? (
                          <>
                            <UiLoadingAnimation size="xs" className="mr-1.5" />
                            {t('common.loading')}
                          </>
                        ) : (
                          t('settings.startServer')
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={isStopping || !serverStatus.running}
                        onClick={() => void stopServer()}
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isStopping ? (
                          <>
                            <UiLoadingAnimation size="xs" className="mr-1.5" />
                            {t('common.loading')}
                          </>
                        ) : (
                          t('settings.stopServer')
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const { resourceDir } = await import('@tauri-apps/api/path');
                            const pluginPath = await resourceDir();
                            await openPath(pluginPath + '/ps-plugin');
                          } catch (error) {
                            console.error('Failed to open plugin directory:', error);
                          }
                        }}
                        className="inline-flex h-9 items-center justify-center rounded border border-border-dark bg-surface-dark px-3 text-xs text-text-dark transition-colors hover:bg-bg-dark"
                      >
                        <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                        {t('settings.openPluginDir')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <button
                    onClick={handleSave}
                    className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </>
            )}

            {activeCategory === 'about' && (
              <>
                <div className="px-6 py-5 border-b border-border-dark">
                  <h2 className="text-lg font-semibold text-text-dark">
                    {t('settings.about')}
                  </h2>
                  <p className="text-sm text-text-muted mt-1">
                    {t('settings.aboutDesc')}
                  </p>
                </div>

                <div className="ui-scrollbar flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <div className="flex items-start gap-4">
                      <img
                        src="/app-icon.png"
                        alt={t('settings.aboutAppName')}
                        className="h-14 w-14 rounded-lg border border-border-dark object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-base font-semibold text-text-dark">
                          {t('settings.aboutAppName')}
                        </span>
                        <p className="mt-1 text-sm text-text-muted">
                          {t('settings.aboutIntro')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4 space-y-2 text-sm">
                    <p className="text-text-dark">
                      {t('settings.aboutVersionLabel')}: <span className="text-text-muted">
                        {runtimeVersion || t('settings.aboutVersionUnknown')}
                      </span>
                    </p>
                  </div>

                  <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
                    <h3 className="text-sm font-medium text-text-dark">
                      {t('settings.aboutPsPortTitle')}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {t('settings.aboutPsPortDesc')}
                    </p>
                    <div className="mt-3 space-y-2 text-sm">
                      <p className="text-text-dark">
                        {t('settings.psRuntimePort')}: <span className="text-text-muted">
                          {runtimePsPort ?? t('settings.psServerNotRunning')}
                        </span>
                      </p>
                      <p className="text-text-dark">
                        {t('settings.psPluginPort')}: <span className="text-accent">
                          {pluginPsPort}
                        </span>
                      </p>
                      {psPortAutoAdjusted && runtimePsPort !== null && (
                        <p className="text-xs text-amber-400">
                          {t('settings.psPortAutoAdjusted', {
                            actual: runtimePsPort,
                            requested: psServerPort,
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t border-border-dark px-6 py-4">
                  <div className="flex gap-2">
                    <button
                      onClick={onClose}
                      className="rounded border border-border-dark px-4 py-2 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark"
                    >
                      {t('common.close')}
                    </button>
                    <button
                      onClick={handleSave}
                      className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
                    >
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          </div>
        </div>
      </div>
      <UiModal
        isOpen={Boolean(restoreBackupTarget)}
        title={t('settings.restoreBackupConfirmTitle')}
        onClose={() => {
          if (!isRestoringDatabaseBackup) {
            setRestoreBackupTarget(null);
          }
        }}
        footer={
          <>
            <button
              type="button"
              disabled={isRestoringDatabaseBackup}
              onClick={() => setRestoreBackupTarget(null)}
              className="inline-flex h-10 items-center justify-center rounded border border-border-dark bg-surface-dark px-3.5 text-sm font-medium text-text-dark transition-colors hover:bg-bg-dark disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={isRestoringDatabaseBackup}
              onClick={() => void handleConfirmRestoreDatabaseBackup()}
              className="inline-flex h-10 items-center justify-center rounded bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent/80 disabled:opacity-50"
            >
              {isRestoringDatabaseBackup ? (
                <>
                  <UiLoadingAnimation size="sm" className="mr-1.5" />
                  {t('settings.restoringBackup')}
                </>
              ) : (
                t('settings.restoreBackupConfirmAction')
              )}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            {t('settings.restoreBackupConfirmDesc', {
              time: restoreBackupTarget
                ? new Date(restoreBackupTarget.createdAt).toLocaleString()
                : '',
            })}
          </p>
          <div className="rounded-lg border border-border-dark bg-bg-dark px-3 py-2 text-xs text-text-muted">
            <div className="text-text-dark">{restoreBackupTarget?.id ?? ''}</div>
            <div className="mt-1">{t('settings.restoreBackupSafetyNote')}</div>
          </div>
        </div>
      </UiModal>
    </div>
  );
}
