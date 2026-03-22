export const DEFAULT_GROUP_NODES_SHORTCUT = 'Mod+G';

type ShortcutModifier = 'Mod' | 'Ctrl' | 'Alt' | 'Shift' | 'Meta';

type ShortcutKeyboardEventLike = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'
>;

const MODIFIER_ORDER: ShortcutModifier[] = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'];

const MODIFIER_ALIASES: Record<string, ShortcutModifier> = {
  mod: 'Mod',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  super: 'Meta',
  win: 'Meta',
  windows: 'Meta',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  space: 'Space',
  spacebar: 'Space',
  del: 'Delete',
  delete: 'Delete',
  backspace: 'Backspace',
  tab: 'Tab',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

function isMacLikePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const navigatorWithUAData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  const platform =
    navigatorWithUAData.userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent ??
    '';

  return /mac|iphone|ipad|ipod/i.test(platform);
}

function normalizeKeyToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  const aliased = KEY_ALIASES[lower];
  if (aliased) {
    return aliased;
  }

  if (lower === ' ') {
    return 'Space';
  }

  if (trimmed.length === 1) {
    return trimmed.toUpperCase();
  }

  if (/^f\d{1,2}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function normalizeShortcutToken(token: string): ShortcutModifier | string | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const modifier = MODIFIER_ALIASES[trimmed.toLowerCase()];
  if (modifier) {
    return modifier;
  }

  return normalizeKeyToken(trimmed);
}

export function normalizeShortcut(
  input: string | null | undefined,
  fallback = DEFAULT_GROUP_NODES_SHORTCUT
): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    return fallback;
  }

  const modifiers = new Set<ShortcutModifier>();
  let mainKey: string | null = null;

  for (const token of trimmed.split('+')) {
    const normalized = normalizeShortcutToken(token);
    if (!normalized) {
      continue;
    }

    if (MODIFIER_ORDER.includes(normalized as ShortcutModifier)) {
      modifiers.add(normalized as ShortcutModifier);
      continue;
    }

    mainKey = normalized;
  }

  if (!mainKey) {
    return fallback;
  }

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers, mainKey].join('+');
}

export function getShortcutFromKeyboardEvent(
  event: ShortcutKeyboardEventLike,
  fallback?: string
): string | null {
  const normalizedKey = normalizeKeyToken(event.key);
  if (!normalizedKey) {
    return fallback ?? null;
  }

  if (
    normalizedKey === 'Control' ||
    normalizedKey === 'Shift' ||
    normalizedKey === 'Alt' ||
    normalizedKey === 'Meta'
  ) {
    return fallback ?? null;
  }

  const modifiers: ShortcutModifier[] = [];
  if (event.metaKey || event.ctrlKey) {
    if (event.metaKey !== event.ctrlKey) {
      modifiers.push('Mod');
    } else {
      if (event.ctrlKey) {
        modifiers.push('Ctrl');
      }
      if (event.metaKey) {
        modifiers.push('Meta');
      }
    }
  }
  if (event.altKey) {
    modifiers.push('Alt');
  }
  if (event.shiftKey) {
    modifiers.push('Shift');
  }

  return normalizeShortcut([...modifiers, normalizedKey].join('+'), fallback);
}

export function eventMatchesShortcut(
  event: ShortcutKeyboardEventLike,
  shortcut: string | null | undefined
): boolean {
  const normalizedShortcut = normalizeShortcut(shortcut);
  const tokens = normalizedShortcut.split('+');
  const key = tokens[tokens.length - 1];
  const modifiers = new Set(tokens.slice(0, -1));
  const isMac = isMacLikePlatform();

  const requiresMod = modifiers.has('Mod');
  const expectedCtrl = modifiers.has('Ctrl') || (!isMac && requiresMod);
  const expectedMeta = modifiers.has('Meta') || (isMac && requiresMod);
  const expectedAlt = modifiers.has('Alt');
  const expectedShift = modifiers.has('Shift');

  if (
    event.ctrlKey !== expectedCtrl ||
    event.metaKey !== expectedMeta ||
    event.altKey !== expectedAlt ||
    event.shiftKey !== expectedShift
  ) {
    return false;
  }

  return normalizeKeyToken(event.key) === key;
}

export function formatShortcutForDisplay(shortcut: string | null | undefined): string {
  const normalizedShortcut = normalizeShortcut(shortcut);
  const isMac = isMacLikePlatform();

  return normalizedShortcut
    .split('+')
    .map((token) => {
      if (token === 'Mod') {
        return isMac ? 'Cmd' : 'Ctrl';
      }
      if (token === 'Meta') {
        return 'Cmd';
      }
      if (token === 'Ctrl' || token === 'Alt' || token === 'Shift') {
        return token;
      }
      if (token === 'Space') {
        return 'Space';
      }
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join(' + ');
}
