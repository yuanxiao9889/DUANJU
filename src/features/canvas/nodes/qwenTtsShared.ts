import {
  CANVAS_NODE_TYPES,
  type CanvasEdge,
  type CanvasNode,
  type QwenTtsPauseConfig,
  type TtsPresetVoiceNodeData,
  type TtsVoiceDesignNodeData,
} from '@/features/canvas/domain/canvasNodes';

export type VoiceStylePreset = TtsVoiceDesignNodeData['stylePreset'];
export type VoiceLanguage = TtsVoiceDesignNodeData['language'];
export type PresetVoiceSpeaker = TtsPresetVoiceNodeData['speaker'];

export const DEFAULT_MAX_NEW_TOKENS = 2048;
export const DEFAULT_TOP_P = 0.8;
export const DEFAULT_TOP_K = 20;
export const DEFAULT_TEMPERATURE = 1;
export const DEFAULT_REPETITION_PENALTY = 1.05;

export const DEFAULT_QWEN_TTS_PAUSE_CONFIG: Required<QwenTtsPauseConfig> = {
  pauseLinebreak: 0.5,
  periodPause: 0.4,
  commaPause: 0.2,
  questionPause: 0.6,
  hyphenPause: 0.3,
};

export const STYLE_OPTIONS: Array<{
  value: VoiceStylePreset;
  labelKey: string;
  descriptionKey: string;
  activeClassName: string;
}> = [
  {
    value: 'natural',
    labelKey: 'node.qwenTts.styles.natural',
    descriptionKey: 'node.qwenTts.styleDescriptions.natural',
    activeClassName: 'border-sky-300/45 bg-sky-400/12 text-sky-100',
  },
  {
    value: 'narrator',
    labelKey: 'node.qwenTts.styles.narrator',
    descriptionKey: 'node.qwenTts.styleDescriptions.narrator',
    activeClassName: 'border-amber-300/45 bg-amber-400/12 text-amber-100',
  },
  {
    value: 'bright',
    labelKey: 'node.qwenTts.styles.bright',
    descriptionKey: 'node.qwenTts.styleDescriptions.bright',
    activeClassName: 'border-rose-300/45 bg-rose-400/12 text-rose-100',
  },
  {
    value: 'calm',
    labelKey: 'node.qwenTts.styles.calm',
    descriptionKey: 'node.qwenTts.styleDescriptions.calm',
    activeClassName: 'border-emerald-300/45 bg-emerald-400/12 text-emerald-100',
  },
];

export const PRESET_VOICE_OPTIONS: Array<{
  value: PresetVoiceSpeaker;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: 'Vivian',
    labelKey: 'node.qwenTts.presetVoice.speakers.Vivian.label',
    descriptionKey: 'node.qwenTts.presetVoice.speakers.Vivian.description',
  },
  {
    value: 'Serena',
    labelKey: 'node.qwenTts.presetVoice.speakers.Serena.label',
    descriptionKey: 'node.qwenTts.presetVoice.speakers.Serena.description',
  },
  {
    value: 'Uncle_Fu',
    labelKey: 'node.qwenTts.presetVoice.speakers.Uncle_Fu.label',
    descriptionKey: 'node.qwenTts.presetVoice.speakers.Uncle_Fu.description',
  },
  {
    value: 'Dylan',
    labelKey: 'node.qwenTts.presetVoice.speakers.Dylan.label',
    descriptionKey: 'node.qwenTts.presetVoice.speakers.Dylan.description',
  },
  {
    value: 'Eric',
    labelKey: 'node.qwenTts.presetVoice.speakers.Eric.label',
    descriptionKey: 'node.qwenTts.presetVoice.speakers.Eric.description',
  },
  {
    value: 'Ryan',
    labelKey: 'node.qwenTts.presetVoice.speakers.Ryan.label',
    descriptionKey: 'node.qwenTts.presetVoice.speakers.Ryan.description',
  },
  {
    value: 'Aiden',
    labelKey: 'node.qwenTts.presetVoice.speakers.Aiden.label',
    descriptionKey: 'node.qwenTts.presetVoice.speakers.Aiden.description',
  },
  {
    value: 'Ono_Anna',
    labelKey: 'node.qwenTts.presetVoice.speakers.Ono_Anna.label',
    descriptionKey: 'node.qwenTts.presetVoice.speakers.Ono_Anna.description',
  },
  {
    value: 'Sohee',
    labelKey: 'node.qwenTts.presetVoice.speakers.Sohee.label',
    descriptionKey: 'node.qwenTts.presetVoice.speakers.Sohee.description',
  },
];

export const LANGUAGE_OPTIONS: Array<{ value: VoiceLanguage; labelKey: string }> = [
  { value: 'auto', labelKey: 'node.qwenTts.languages.auto' },
  { value: 'zh', labelKey: 'node.qwenTts.languages.zh' },
  { value: 'en', labelKey: 'node.qwenTts.languages.en' },
  { value: 'jp', labelKey: 'node.qwenTts.languages.jp' },
  { value: 'kr', labelKey: 'node.qwenTts.languages.kr' },
  { value: 'fr', labelKey: 'node.qwenTts.languages.fr' },
  { value: 'de', labelKey: 'node.qwenTts.languages.de' },
  { value: 'es', labelKey: 'node.qwenTts.languages.es' },
  { value: 'pt', labelKey: 'node.qwenTts.languages.pt' },
  { value: 'ru', labelKey: 'node.qwenTts.languages.ru' },
  { value: 'it', labelKey: 'node.qwenTts.languages.it' },
];

export const MAX_NEW_TOKEN_OPTIONS = [512, 1024, 1536, 2048, 3072, 4096];

export const QWEN_TTS_PAUSE_FIELDS: Array<{
  key: keyof QwenTtsPauseConfig;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    key: 'pauseLinebreak',
    labelKey: 'node.qwenTts.pauseControls.linebreak',
    descriptionKey: 'node.qwenTts.pauseDescriptions.linebreak',
  },
  {
    key: 'periodPause',
    labelKey: 'node.qwenTts.pauseControls.period',
    descriptionKey: 'node.qwenTts.pauseDescriptions.period',
  },
  {
    key: 'commaPause',
    labelKey: 'node.qwenTts.pauseControls.comma',
    descriptionKey: 'node.qwenTts.pauseDescriptions.comma',
  },
  {
    key: 'questionPause',
    labelKey: 'node.qwenTts.pauseControls.question',
    descriptionKey: 'node.qwenTts.pauseDescriptions.question',
  },
  {
    key: 'hyphenPause',
    labelKey: 'node.qwenTts.pauseControls.hyphen',
    descriptionKey: 'node.qwenTts.pauseDescriptions.hyphen',
  },
];

export function formatGeneratedTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePauseValue(
  value: number | undefined,
  fallback: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return clamp(value, 0, 5);
}

export function resolvePauseConfig(
  config: QwenTtsPauseConfig | null | undefined
): Required<QwenTtsPauseConfig> {
  return {
    pauseLinebreak: normalizePauseValue(
      config?.pauseLinebreak,
      DEFAULT_QWEN_TTS_PAUSE_CONFIG.pauseLinebreak
    ),
    periodPause: normalizePauseValue(
      config?.periodPause,
      DEFAULT_QWEN_TTS_PAUSE_CONFIG.periodPause
    ),
    commaPause: normalizePauseValue(
      config?.commaPause,
      DEFAULT_QWEN_TTS_PAUSE_CONFIG.commaPause
    ),
    questionPause: normalizePauseValue(
      config?.questionPause,
      DEFAULT_QWEN_TTS_PAUSE_CONFIG.questionPause
    ),
    hyphenPause: normalizePauseValue(
      config?.hyphenPause,
      DEFAULT_QWEN_TTS_PAUSE_CONFIG.hyphenPause
    ),
  };
}

export function resolveSpeakingRateDescriptorKey(rate: number): string {
  if (rate >= 1.15) {
    return 'node.qwenTts.rateDescriptors.fast';
  }
  if (rate <= 0.85) {
    return 'node.qwenTts.rateDescriptors.slow';
  }
  return 'node.qwenTts.rateDescriptors.natural';
}

export function resolvePitchDescriptorKey(pitch: number): string {
  if (pitch >= 3) {
    return 'node.qwenTts.pitchDescriptors.high';
  }
  if (pitch <= -3) {
    return 'node.qwenTts.pitchDescriptors.low';
  }
  return 'node.qwenTts.pitchDescriptors.neutral';
}

export function resolveRuntimeTone(
  isExtensionReady: boolean,
  isExtensionStarting: boolean
): string {
  if (isExtensionReady) {
    return 'border-emerald-400/30 bg-emerald-400/12 text-emerald-100';
  }
  if (isExtensionStarting) {
    return 'border-amber-400/30 bg-amber-400/12 text-amber-100';
  }
  return 'border-white/10 bg-white/[0.05] text-text-muted';
}

export function resolveConnectedTtsText(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): string {
  const incomingEdges = edges.filter((edge) => edge.target === nodeId);
  if (incomingEdges.length === 0) {
    return '';
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  return incomingEdges
    .map((edge) => nodeMap.get(edge.source))
    .map((node) => {
      if (!node) {
        return '';
      }

      if (
        node.type === CANVAS_NODE_TYPES.ttsText ||
        node.type === CANVAS_NODE_TYPES.textAnnotation
      ) {
        return typeof node.data.content === 'string' ? node.data.content.trim() : '';
      }

      return '';
    })
    .filter((text) => text.length > 0)
    .join('\n\n');
}
