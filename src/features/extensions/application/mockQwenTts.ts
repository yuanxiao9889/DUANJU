interface MockQwenTtsRequest {
  text: string;
  voicePrompt: string;
  stylePreset: string;
  language: string;
  speakingRate: number;
  pitch: number;
}

const SAMPLE_RATE = 22050;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWave(samples: Int16Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, samples[index], true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function resolveBaseFrequency(stylePreset: string, language: string): number {
  const presetMap: Record<string, number> = {
    natural: 188,
    narrator: 152,
    bright: 238,
    calm: 168,
  };

  const base = presetMap[stylePreset] ?? 180;
  if (language === 'en') {
    return base + 10;
  }
  if (language === 'jp') {
    return base + 24;
  }
  return base;
}

function buildSamples(request: MockQwenTtsRequest): Int16Array {
  const trimmedText = request.text.trim();
  const normalizedRate = clamp(request.speakingRate, 0.65, 1.5);
  const normalizedPitch = clamp(request.pitch, -12, 12);
  const charCount = Math.max(trimmedText.length, 1);
  const durationSeconds = clamp(
    0.8 + (charCount / 10) * (1.12 / normalizedRate),
    1.2,
    9
  );
  const totalSamples = Math.floor(durationSeconds * SAMPLE_RATE);
  const samples = new Int16Array(totalSamples);
  const baseFrequency =
    resolveBaseFrequency(request.stylePreset, request.language) +
    normalizedPitch * 3.2;
  const phraseSeed = `${request.voicePrompt}|${request.stylePreset}|${request.language}`;
  let phase = 0;

  for (let index = 0; index < totalSamples; index += 1) {
    const time = index / SAMPLE_RATE;
    const progress = index / totalSamples;
    const characterIndex = Math.min(
      trimmedText.length - 1,
      Math.floor(progress * trimmedText.length)
    );
    const charCode =
      characterIndex >= 0 ? trimmedText.charCodeAt(characterIndex) : 97;
    const phraseCode =
      phraseSeed.charCodeAt(index % Math.max(phraseSeed.length, 1)) || 65;

    const vibrato = Math.sin(2 * Math.PI * 4.8 * time) * 2.4;
    const wobble = ((charCode % 17) - 8) * 0.9 + ((phraseCode % 11) - 5) * 0.45;
    const frequency = clamp(baseFrequency + wobble + vibrato, 110, 420);
    phase += (2 * Math.PI * frequency) / SAMPLE_RATE;

    const harmonic =
      Math.sin(phase) * 0.62 +
      Math.sin(phase * 2) * 0.24 +
      Math.sin(phase * 3) * 0.1;
    const tremolo = 0.85 + Math.sin(2 * Math.PI * 2.1 * time) * 0.08;
    const envelope =
      Math.min(1, time / 0.06) * Math.min(1, (durationSeconds - time) / 0.12);
    const punctuationShape =
      characterIndex >= 0 && /[,.!?，。！？；;：:]/.test(trimmedText[characterIndex] ?? '')
        ? 0.58
        : 1;
    const amplitude = 16000 * tremolo * envelope * punctuationShape;

    samples[index] = Math.round(harmonic * amplitude);
  }

  return samples;
}

function compactIsoTimestamp(date: Date): string {
  return date
    .toISOString()
    .split("-")
    .join("")
    .split(":")
    .join("")
    .split(".")
    .join("")
    .split("T")
    .join("")
    .split("Z")
    .join("")
    .slice(0, 14);
}

export async function createMockQwenTtsAudioFile(
  request: MockQwenTtsRequest
): Promise<File> {
  const samples = buildSamples(request);
  const waveBlob = encodeWave(samples, SAMPLE_RATE);
  const timestamp = compactIsoTimestamp(new Date());

  return new File([waveBlob], `qwen-tts-${timestamp}.wav`, {
    type: 'audio/wav',
    lastModified: Date.now(),
  });
}
