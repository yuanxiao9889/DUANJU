(() => {
  if (window.__STORYBOARD_JIMENG__) {
    return;
  }

  const INPUT_KEYWORDS = [
    'prompt',
    '\u63d0\u793a',
    '\u63cf\u8ff0',
    '\u5185\u5bb9',
    '\u521b\u4f5c',
    '\u8f93\u5165',
  ];
  const SUBMIT_KEYWORDS = [
    '\u751f\u6210',
    '\u7acb\u5373\u751f\u6210',
    '\u5f00\u59cb\u751f\u6210',
    '\u63d0\u4ea4',
    '\u521b\u4f5c',
    'submit',
    'send',
  ];
  const UPLOAD_KEYWORDS = [
    '\u4e0a\u4f20',
    '\u62d6\u62fd',
    '\u672c\u5730',
    '\u6dfb\u52a0',
    'upload',
    'drag',
    'drop',
    'file',
  ];
  const UPLOAD_TRIGGER_KEYWORDS = [
    '\u4e0a\u4f20',
    '\u672c\u5730\u4e0a\u4f20',
    '\u4e0a\u4f20\u56fe\u7247',
    '\u4e0a\u4f20\u56fe\u50cf',
    '\u4e0a\u4f20\u53c2\u8003\u56fe',
    '\u6dfb\u52a0',
    '\u6dfb\u52a0\u56fe\u7247',
    '\u9009\u62e9\u56fe\u7247',
    '\u9009\u62e9\u6587\u4ef6',
    '\u91cd\u65b0\u4e0a\u4f20',
    'upload',
    'add',
    'choose file',
    'select file',
  ];
  const INSPECTION_MARKER = '__STORYBOARD_JIMENG_INSPECT__:';
  const MAX_WAIT_MS = 18000;
  const RETRY_DELAY_MS = 350;
  const INSPECTION_DELAY_MS = 800;
  const REFERENCE_UPLOAD_SETTLE_MS = 1200;
  const CREATION_TYPE_ALIASES = {
    image: ['\u56fe\u7247\u751f\u6210', '\u56fe\u50cf\u751f\u6210', 'image'],
    video: ['\u89c6\u9891\u751f\u6210', 'video'],
    digitalHuman: ['\u6570\u5b57\u4eba'],
    voice: ['\u914d\u97f3\u751f\u6210', '\u914d\u97f3'],
    action: ['\u52a8\u4f5c\u6a21\u4eff'],
  };
  const MODEL_ALIASES = {
    'seedance-2.0-fast': ['Seedance 2.0 Fast', 'Seedance2.0Fast'],
    'seedance-2.0': ['Seedance 2.0', 'Seedance2.0'],
    'seedance-1.5-pro': ['Seedance 1.5 Pro', 'Seedance1.5Pro'],
    'seedance-1.0': ['Seedance 1.0', 'Seedance1.0'],
    'seedance-1.0-fast': ['Seedance 1.0 Fast', 'Seedance1.0Fast'],
    'seedance-1.0-mini': ['Seedance 1.0 mini', 'Seedance1.0mini'],
  };

  const REFERENCE_MODE_ALIASES = {
    allAround: ['\u5168\u80fd\u53c2\u8003'],
    firstLastFrame: ['\u9996\u5c3e\u5e27'],
    smartFrames: ['\u667a\u80fd\u591a\u5e27'],
    subject: ['\u4e3b\u4f53\u53c2\u8003'],
  };

  const ASPECT_RATIO_ALIASES = {
    '21:9': ['21:9'],
    '16:9': ['16:9'],
    '4:3': ['4:3'],
    '1:1': ['1:1'],
    '3:4': ['3:4'],
    '9:16': ['9:16'],
  };

  const DURATION_ALIASES = {
    4: ['4s', '4\u79d2'],
    5: ['5s', '5\u79d2'],
    6: ['6s', '6\u79d2'],
    7: ['7s', '7\u79d2'],
    8: ['8s', '8\u79d2'],
    9: ['9s', '9\u79d2'],
    10: ['10s', '10\u79d2'],
    11: ['11s', '11\u79d2'],
    12: ['12s', '12\u79d2'],
    13: ['13s', '13\u79d2'],
    14: ['14s', '14\u79d2'],
    15: ['15s', '15\u79d2'],
  };

  const CONTROL_SEQUENCE = [
    { key: 'creationType', aliasMap: CREATION_TYPE_ALIASES, toolbarComboboxIndex: 0 },
    { key: 'model', aliasMap: MODEL_ALIASES, toolbarComboboxIndex: 1 },
    { key: 'referenceMode', aliasMap: REFERENCE_MODE_ALIASES, toolbarComboboxIndex: 2 },
    { key: 'aspectRatio', aliasMap: ASPECT_RATIO_ALIASES },
    { key: 'durationSeconds', aliasMap: DURATION_ALIASES, toolbarComboboxIndex: 3 },
  ];

  const state = {
    pending: null,
    retryTimer: null,
    attemptInFlight: false,
    observer: null,
    inspectionTimer: null,
    inspectionStarted: false,
    inspectionReported: false,
    inspectionStatus: 'idle',
    lastInspectionReport: null,
    lastInspectionError: null,
    lastInspectionRequestedAt: null,
    lastInspectionUpdatedAt: null,
    submissionStatus: 'idle',
    lastSubmissionError: null,
    lastSubmissionUpdatedAt: null,
    lastSubmissionStep: null,
    submissionStepHistory: [],
  };

  function collapseWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(value) {
    return collapseWhitespace(value)
      .toLowerCase()
      .replace(/["'`‘’“”]/g, '')
      .replace(/[()[\]{}<>【】「」『』（）]/g, '')
      .replace(/[.,!?/\\|·，。！？、]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function readElementText(element) {
    if (!(element instanceof HTMLElement)) {
      return '';
    }

    return collapseWhitespace(
      [
        element.getAttribute('placeholder'),
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('data-placeholder'),
        element.getAttribute('data-testid'),
        element.textContent,
      ]
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
    );
  }

  function collectQueryResults(root, selector, results, seen) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return;
    }

    root.querySelectorAll(selector).forEach((element) => {
      if (!seen.has(element)) {
        seen.add(element);
        results.push(element);
      }

      if (element.shadowRoot) {
        collectQueryResults(element.shadowRoot, selector, results, seen);
      }

      if (element instanceof HTMLIFrameElement) {
        try {
          if (element.contentDocument) {
            collectQueryResults(element.contentDocument, selector, results, seen);
          }
        } catch (_error) {
          // Ignore cross-origin iframes.
        }
      }
    });
  }

  function queryAllDeep(selector) {
    const results = [];
    const seen = new Set();

    collectQueryResults(document, selector, results, seen);
    return results;
  }

  function getClickableElements() {
    return queryAllDeep(
      'button, [role="button"], [role="combobox"], input[type="submit"], input[type="button"]'
    ).filter((element) => isVisible(element) && !('disabled' in element && element.disabled));
  }

  function getInspectableOptionElements() {
    return queryAllDeep(
      [
        'button',
        '[role="button"]',
        '[role="combobox"]',
        '[role="option"]',
        '[role="radio"]',
        '[role="menuitem"]',
        '[aria-selected]',
        '[aria-checked]',
        '[data-state]',
        'label',
        'li',
      ].join(', ')
    ).filter((element) => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) {
        return false;
      }

      if ('disabled' in element && element.disabled) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width >= 20 && rect.height >= 16;
    });
  }

  function getFileInputElements() {
    return queryAllDeep('input[type="file"]').filter((element) =>
      element instanceof HTMLInputElement && element.type === 'file' && !element.disabled
    );
  }

  function getElementContextText(element) {
    if (!(element instanceof HTMLElement)) {
      return '';
    }

    return collapseWhitespace(
      [
        readElementText(element),
        readElementText(element.closest('label, form, section, article, main, [role="dialog"]')),
      ]
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
    );
  }

  function getEffectiveElementRect(element) {
    if (!(element instanceof HTMLElement)) {
      return {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      };
    }

    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect;
    }

    const container = element.closest('label, form, section, article, main, [role="dialog"], div');
    if (container instanceof HTMLElement) {
      return container.getBoundingClientRect();
    }

    return rect;
  }

  function matchesAnyAlias(text, aliases) {
    return aliases.some((alias) => matchesAliasText(text, alias));
  }

  function isExactAliasMatch(text, alias) {
    return normalizeText(text) === normalizeText(alias);
  }

  function isAsciiTokenCharacter(character) {
    return /^[a-z0-9]$/i.test(character || '');
  }

  function matchesAliasText(text, alias) {
    const normalizedText = normalizeText(text);
    const normalizedAlias = normalizeText(alias);

    if (!normalizedText || !normalizedAlias) {
      return false;
    }

    if (normalizedText === normalizedAlias) {
      return true;
    }

    let matchIndex = normalizedText.indexOf(normalizedAlias);
    while (matchIndex !== -1) {
      const previousCharacter =
        matchIndex > 0 ? normalizedText.charAt(matchIndex - 1) : '';
      const nextCharacter = normalizedText.charAt(matchIndex + normalizedAlias.length);
      const aliasStartsWithAscii = isAsciiTokenCharacter(normalizedAlias.charAt(0));
      const aliasEndsWithAscii = isAsciiTokenCharacter(
        normalizedAlias.charAt(normalizedAlias.length - 1)
      );

      const hasAsciiPrefixCollision =
        aliasStartsWithAscii && isAsciiTokenCharacter(previousCharacter);
      const hasAsciiSuffixCollision =
        aliasEndsWithAscii && isAsciiTokenCharacter(nextCharacter);

      if (!hasAsciiPrefixCollision && !hasAsciiSuffixCollision) {
        return true;
      }

      matchIndex = normalizedText.indexOf(normalizedAlias, matchIndex + 1);
    }

    return false;
  }

  function flattenAliasMap(aliasMap) {
    return Object.values(aliasMap).flat();
  }

  function resolveAliases(aliasMap, value) {
    if (value == null) {
      return [];
    }

    return aliasMap[value] || [String(value)];
  }

  function resolveMatchedAliasValue(aliasMap, text) {
    const rawText = collapseWhitespace(text);
    if (!rawText) {
      return null;
    }

    const matchedEntry = Object.entries(aliasMap).find(([, aliases]) =>
      aliases.some((alias) => matchesAliasText(rawText, alias))
    );

    return matchedEntry ? matchedEntry[0] : null;
  }

  function resolveMatchedKnownControlKey(triggerText, options = []) {
    for (const control of CONTROL_SEQUENCE) {
      if (resolveMatchedAliasValue(control.aliasMap, triggerText)) {
        return control.key;
      }

      if (options.some((option) => resolveMatchedAliasValue(control.aliasMap, option.text))) {
        return control.key;
      }
    }

    return null;
  }

  function setInspectionPending() {
    state.inspectionStatus = 'pending';
    state.lastInspectionError = null;
    state.lastInspectionRequestedAt = Date.now();
  }

  function setInspectionReady(report) {
    state.inspectionReported = true;
    state.inspectionStatus = 'ready';
    state.lastInspectionReport = report;
    state.lastInspectionError = null;
    state.lastInspectionUpdatedAt = Date.now();
  }

  function setInspectionError(message) {
    state.inspectionStatus = 'error';
    state.lastInspectionError = collapseWhitespace(message) || 'Jimeng inspection failed';
    state.lastInspectionUpdatedAt = Date.now();
  }

  function resetInspectionState() {
    clearInspectionTimer();
    state.inspectionReported = false;
    state.inspectionStatus = 'idle';
    state.lastInspectionReport = null;
    state.lastInspectionError = null;
    state.lastInspectionRequestedAt = null;
    state.lastInspectionUpdatedAt = null;
  }

  function setSubmissionPending() {
    state.submissionStatus = 'pending';
    state.lastSubmissionError = null;
    state.lastSubmissionUpdatedAt = Date.now();
  }

  function setSubmissionReady() {
    state.submissionStatus = 'ready';
    state.lastSubmissionError = null;
    state.lastSubmissionUpdatedAt = Date.now();
  }

  function setSubmissionError(message) {
    state.submissionStatus = 'error';
    state.lastSubmissionError = collapseWhitespace(message) || 'Jimeng submission sync failed';
    state.lastSubmissionUpdatedAt = Date.now();
  }

  function recordSubmissionStep(step, detail) {
    const entry = {
      step,
      detail: collapseWhitespace(detail || ''),
      at: Date.now(),
    };
    state.lastSubmissionStep = entry;
    state.submissionStepHistory = [...state.submissionStepHistory.slice(-19), entry];
  }

  function scorePromptSubmitAffinity(promptRect) {
    return getClickableElements().reduce((bestScore, element) => {
      const text = readElementText(element);
      if (!SUBMIT_KEYWORDS.some((keyword) => normalizeText(text).includes(normalizeText(keyword)))) {
        return bestScore;
      }

      const rect = element.getBoundingClientRect();
      const verticalDistance = Math.abs(rect.top - promptRect.bottom);
      const horizontalDistance = Math.abs(
        (rect.left + rect.width / 2) - (promptRect.left + promptRect.width / 2)
      );

      let score = 0;
      if (verticalDistance <= 240) {
        score += 140 - verticalDistance;
      }
      if (horizontalDistance <= 320) {
        score += 100 - Math.min(horizontalDistance, 100);
      }

      return Math.max(bestScore, score);
    }, 0);
  }

  function findPromptInput() {
    const candidates = [
      ...queryAllDeep('textarea'),
      ...queryAllDeep('[contenteditable]:not([contenteditable="false"])'),
      ...queryAllDeep('[role="textbox"]'),
    ];

    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    candidates.forEach((candidate) => {
      if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
        return;
      }

      if ('disabled' in candidate && candidate.disabled) {
        return;
      }

      if ('readOnly' in candidate && candidate.readOnly) {
        return;
      }

      const rect = candidate.getBoundingClientRect();
      const elementText = readElementText(candidate);
      const nearbyText = readElementText(
        candidate.closest('form, section, main, article, [role="dialog"]')
      );
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const submitAffinity = scorePromptSubmitAffinity(rect);
      const role = (candidate.getAttribute('role') || '').toLowerCase();
      const isTextarea = candidate instanceof HTMLTextAreaElement;
      const isTextbox = role === 'textbox';

      let score = 0;
      if (isTextarea) {
        score += 90;
      }
      if (candidate.isContentEditable) {
        score += 80;
      }
      if (isTextbox) {
        score += 60;
      }
      if (candidate.getAttribute('aria-multiline') === 'true') {
        score += 40;
      }

      score += Math.min(rect.width / 10, 30);
      score += Math.min(rect.height / 8, 24);
      score += Math.min(submitAffinity, 180);

      if (candidate.closest('header, nav, aside, [role="navigation"]')) {
        score -= 280;
      }
      if (candidate.closest('form')) {
        score += 40;
      }
      if (rect.width < 180) {
        score -= 120;
      }
      if (rect.height < 28) {
        score -= 80;
      }
      if (rect.width < 280) {
        score -= 120;
      }
      if (rect.height < 44) {
        score -= 180;
      }
      if (rect.width >= 320) {
        score += 40;
      }
      if (rect.height >= 72) {
        score += 55;
      }
      if (!isTextarea && !candidate.isContentEditable && isTextbox) {
        score -= 60;
      }
      if (viewportHeight > 0 && rect.top <= viewportHeight * 0.12) {
        score -= 80;
      }
      if (submitAffinity <= 0) {
        score -= 80;
      }

      if (normalizeText(elementText).includes(normalizeText('\u63d0\u793a\u8bcd'))) {
        score += 120;
      }

      if (INPUT_KEYWORDS.some((keyword) => normalizeText(elementText).includes(normalizeText(keyword)))) {
        score += 70;
      }

      if (INPUT_KEYWORDS.some((keyword) => normalizeText(nearbyText).includes(normalizeText(keyword)))) {
        score += 25;
      }

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return bestScore >= 80 ? best : null;
  }

  function getPromptRegionRect(promptInput) {
    const region =
      promptInput.closest('form, section, article, [role="dialog"], main')
      || promptInput.parentElement
      || promptInput;
    const rect = region.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function findValueSetter(element) {
    const prototypes = [];
    let current = Object.getPrototypeOf(element);
    while (current) {
      prototypes.push(current);
      current = Object.getPrototypeOf(current);
    }

    for (const prototype of prototypes) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        return descriptor.set;
      }
    }

    return null;
  }

  function dispatchInputEvents(element, value) {
    const inputEvent = typeof InputEvent === 'function'
      ? new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: value,
          inputType: 'insertText',
        })
      : new Event('input', {
          bubbles: true,
          cancelable: true,
        });

    element.dispatchEvent(inputEvent);
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  function setPromptValue(element, value) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus();
      const setter = findValueSetter(element);
      if (setter) {
        setter.call(element, value);
      } else {
        element.value = value;
      }
      dispatchInputEvents(element, value);
      if (typeof element.setSelectionRange === 'function') {
        element.setSelectionRange(value.length, value.length);
      }
      return true;
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      element.focus();
      element.textContent = value;
      dispatchInputEvents(element, value);
      return true;
    }

    return false;
  }

  function clickElement(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.focus();
    if (typeof element.click === 'function') {
      try {
        element.click();
        return;
      } catch (_error) {
        // Fall back to synthetic pointer events below.
      }
    }
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((eventName) => {
      element.dispatchEvent(
        new MouseEvent(eventName, {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    });
  }

  function scoreReferenceFileInput(input, promptInput) {
    const promptRect = promptInput.getBoundingClientRect();
    const rect = getEffectiveElementRect(input);
    const text = getElementContextText(input);
    const accept = String(input.accept || '').toLowerCase();
    const verticalDistance = Math.abs(rect.top - promptRect.bottom);
    const horizontalDistance = Math.abs(
      (rect.left + rect.width / 2) - (promptRect.left + promptRect.width / 2)
    );

    let score = 160 - Math.min(verticalDistance, 160);
    score += 120 - Math.min(horizontalDistance, 120);
    score += accept.includes('image') ? 100 : 20;
    score += input.multiple ? 24 : 0;
    if (matchesAnyAlias(text, UPLOAD_KEYWORDS)) {
      score += 90;
    }
    if (input.closest('header, nav, aside, [role="navigation"]')) {
      score -= 260;
    }

    return score;
  }

  function findReferenceFileInput(promptInput) {
    const inputs = getFileInputElements();
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    inputs.forEach((input) => {
      const score = scoreReferenceFileInput(input, promptInput);
      if (score > bestScore) {
        best = input;
        bestScore = score;
      }
    });

    return bestScore > -120 ? best : null;
  }

  function scoreUploadTriggerCandidate(element, promptInput) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return Number.NEGATIVE_INFINITY;
    }

    if (
      element.matches('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"]')
      || element.closest('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"]')
    ) {
      return Number.NEGATIVE_INFINITY;
    }

    const text = getElementContextText(element);
    if (!matchesAnyAlias(text, UPLOAD_TRIGGER_KEYWORDS)) {
      return Number.NEGATIVE_INFINITY;
    }

    const rect = getEffectiveElementRect(element);
    const promptRect = promptInput.getBoundingClientRect();
    const verticalDistance = Math.abs(rect.top - promptRect.bottom);
    const horizontalDistance = Math.abs(
      (rect.left + rect.width / 2) - (promptRect.left + promptRect.width / 2)
    );

    let score = 220 - Math.min(verticalDistance, 220);
    score += 140 - Math.min(horizontalDistance, 140);
    if (element.closest('header, nav, aside, [role="navigation"]')) {
      score -= 260;
    }

    return score;
  }

  function findReferenceUploadTrigger(promptInput) {
    const candidates = [
      ...getClickableElements(),
      ...queryAllDeep('label'),
    ];
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    candidates.forEach((candidate) => {
      const score = scoreUploadTriggerCandidate(candidate, promptInput);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return bestScore > 40 ? best : null;
  }

  async function revealReferenceFileInput(promptInput) {
    const existingInput = findReferenceFileInput(promptInput);
    if (existingInput) {
      return existingInput;
    }

    const trigger = findReferenceUploadTrigger(promptInput);
    if (trigger) {
      clickElement(trigger);
      await waitForUiSettled(180);
    }

    return findReferenceFileInput(promptInput);
  }

  function sanitizeReferenceFileName(fileName, fallbackName) {
    const normalized = collapseWhitespace(fileName || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[. ]+$/g, '');

    return normalized || fallbackName;
  }

  function resolveReferenceFileExtension(referenceImage) {
    const mime = String(referenceImage && referenceImage.dataUrl || '')
      .slice(5)
      .split(';')[0]
      .toLowerCase();

    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      return 'jpg';
    }
    if (mime === 'image/webp') {
      return 'webp';
    }
    if (mime === 'image/gif') {
      return 'gif';
    }
    if (mime === 'image/bmp') {
      return 'bmp';
    }
    if (mime === 'image/avif') {
      return 'avif';
    }

    return 'png';
  }

  async function createReferenceUploadFiles(referenceImages) {
    const files = [];

    for (const [index, referenceImage] of referenceImages.entries()) {
      const response = await fetch(referenceImage.dataUrl);
      if (!response.ok) {
        throw new Error(`Failed to read reference image ${index + 1}`);
      }

      const blob = await response.blob();
      const extension = resolveReferenceFileExtension(referenceImage);
      const fallbackName = `jimeng-reference-${index + 1}.${extension}`;
      const requestedFileName = String(referenceImage.fileName || '').trim();
      const fileName = sanitizeReferenceFileName(requestedFileName, fallbackName);
      files.push(
        new File([blob], fileName, {
          type: blob.type || 'image/png',
          lastModified: Date.now(),
        })
      );
    }

    return files;
  }

  function assignFilesToInput(input, files) {
    const dataTransfer = new DataTransfer();
    files.forEach((file) => {
      dataTransfer.items.add(file);
    });

    try {
      input.files = dataTransfer.files;
    } catch (_error) {
      return false;
    }

    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    return true;
  }

  async function dispatchReferenceFilesToInput(input, files) {
    if (!(input instanceof HTMLInputElement) || files.length === 0) {
      return false;
    }

    if (input.multiple || files.length === 1) {
      return assignFilesToInput(input, files);
    }

    for (const file of files) {
      if (!assignFilesToInput(input, [file])) {
        return false;
      }
      await waitForUiSettled(180);
    }

    return true;
  }

  async function startReferenceImageUpload(payload, promptInput) {
    const fileInput = await revealReferenceFileInput(promptInput);
    if (!fileInput) {
      throw new Error('Unable to find Jimeng reference image upload control');
    }

    const files = await createReferenceUploadFiles(payload.referenceImages);
    if (files.length === 0) {
      return;
    }

    const dispatched = await dispatchReferenceFilesToInput(fileInput, files);
    if (!dispatched) {
      throw new Error('Failed to inject reference images into Jimeng upload control');
    }
  }

  async function ensureReferenceImagesApplied(payload, promptInput) {
    const referenceImages = Array.isArray(payload.referenceImages)
      ? payload.referenceImages.filter((item) =>
          item && typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:')
        )
      : [];

    if (referenceImages.length === 0) {
      return true;
    }

    if (payload.referenceUploadStatus === 'error') {
      throw new Error(payload.referenceUploadError || 'Jimeng reference image upload failed');
    }

    if (payload.referenceUploadStatus === 'ready') {
      const remainingDelay = (payload.referenceUploadReadyAt || 0) - Date.now();
      if (remainingDelay > 0) {
        await waitForDelay(remainingDelay);
      }
      return true;
    }

    if (payload.referenceUploadStatus !== 'pending') {
      payload.referenceUploadStatus = 'pending';
      payload.referenceUploadError = null;
      payload.referenceUploadReadyAt = null;

      payload.referenceUploadPromise = startReferenceImageUpload(payload, promptInput)
        .then(() => {
          payload.referenceUploadStatus = 'ready';
          payload.referenceUploadReadyAt = Date.now() + REFERENCE_UPLOAD_SETTLE_MS;
        })
        .catch((error) => {
          payload.referenceUploadStatus = 'error';
          payload.referenceUploadError = String(error && error.message ? error.message : error);
        });
    }

    if (payload.referenceUploadPromise) {
      await payload.referenceUploadPromise;
    }

    if (payload.referenceUploadStatus === 'error') {
      throw new Error(payload.referenceUploadError || 'Jimeng reference image upload failed');
    }

    const remainingDelay = (payload.referenceUploadReadyAt || 0) - Date.now();
    if (remainingDelay > 0) {
      await waitForDelay(remainingDelay);
    }

    return payload.referenceUploadStatus === 'ready';
  }

  function scoreTriggerCandidate(element, promptInput, allAliases) {
    if (!matchesAnyAlias(readElementText(element), allAliases)) {
      return Number.NEGATIVE_INFINITY;
    }

    const rect = element.getBoundingClientRect();
    const promptRect = promptInput.getBoundingClientRect();
    const verticalDistance = Math.abs(rect.bottom - promptRect.bottom);

    let score = 300 - Math.min(verticalDistance, 300);
    if (rect.top >= promptRect.top - 40 && rect.bottom <= promptRect.bottom + 180) {
      score += 120;
    }
    if (rect.left >= promptRect.left - 80 && rect.right <= promptRect.right + 180) {
      score += 40;
    }

    return score;
  }

  function getToolbarBandBounds(promptInput) {
    const promptRect = promptInput.getBoundingClientRect();
    const promptRegionRect = getPromptRegionRect(promptInput);
    const submitButton = findSubmitButton(promptInput);
    const submitRect = submitButton ? submitButton.getBoundingClientRect() : null;

    return {
      bandTop: Math.min(
        Math.round(promptRect.top) - 48,
        submitRect ? Math.round(submitRect.top) - 48 : Math.round(promptRect.top) - 48
      ),
      bandBottom: Math.max(
        Math.round(promptRect.bottom) + 220,
        submitRect ? Math.round(submitRect.bottom) + 160 : Math.round(promptRect.bottom) + 220
      ),
      leftBound: Math.max(promptRegionRect.left - 32, Math.round(promptRect.left) - 96),
      rightBound: Math.min(
        promptRegionRect.right + 32,
        Math.max(
          Math.round(promptRect.right) + 96,
          submitRect ? Math.round(submitRect.right) + 96 : Math.round(promptRect.right) + 96
        )
      ),
    };
  }

  function isElementWithinToolbarBand(element, promptInput) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const bounds = getToolbarBandBounds(promptInput);
    return (
      rect.top >= bounds.bandTop
      && rect.bottom <= bounds.bandBottom
      && rect.left >= bounds.leftBound
      && rect.right <= bounds.rightBound
    );
  }

  function collectVisibleComboboxes() {
    return queryAllDeep('[role="combobox"]')
      .filter((element) =>
        element instanceof HTMLElement
        && isVisible(element)
        && element.getBoundingClientRect().width >= 44
        && element.getBoundingClientRect().height >= 28
        && !element.closest('header, nav, aside, [role="navigation"]')
      )
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        if (Math.abs(leftRect.top - rightRect.top) > 10) {
          return leftRect.top - rightRect.top;
        }
        return leftRect.left - rightRect.left;
      });
  }

  function collectToolbarComboboxes(promptInput) {
    const bandComboboxes = queryAllDeep('[role="combobox"]')
      .filter((element) =>
        element instanceof HTMLElement
        && isElementWithinToolbarBand(element, promptInput)
        && element.getBoundingClientRect().width >= 44
        && element.getBoundingClientRect().height >= 28
      )
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        if (Math.abs(leftRect.top - rightRect.top) > 10) {
          return leftRect.top - rightRect.top;
        }
        return leftRect.left - rightRect.left;
      });

    return bandComboboxes.length > 0 ? bandComboboxes : collectVisibleComboboxes();
  }

  function findToolbarComboboxFallback(control, promptInput) {
    if (!Number.isInteger(control.toolbarComboboxIndex)) {
      return null;
    }

    const comboboxes = collectToolbarComboboxes(promptInput);
    if (comboboxes.length === 0) {
      return null;
    }

    const matchedCombobox = comboboxes.find((combobox) =>
      matchesAnyAlias(readElementText(combobox), flattenAliasMap(control.aliasMap))
    );
    if (matchedCombobox) {
      return matchedCombobox;
    }

    return comboboxes[control.toolbarComboboxIndex] || null;
  }

  function findControlTrigger(control, promptInput) {
    const fallbackTrigger = findToolbarComboboxFallback(control, promptInput);
    if (fallbackTrigger) {
      return fallbackTrigger;
    }

    const allAliases = flattenAliasMap(control.aliasMap);
    const candidates = getClickableElements();
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    candidates.forEach((candidate) => {
      const score = scoreTriggerCandidate(candidate, promptInput, allAliases);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return best;
  }

  function scoreDirectAliasCandidate(element, promptInput, aliases) {
    const text = readElementText(element);
    if (!matchesAnyAlias(text, aliases)) {
      return Number.NEGATIVE_INFINITY;
    }

    const rect = element.getBoundingClientRect();
    const promptRect = promptInput.getBoundingClientRect();
    const verticalDistance = Math.abs(rect.bottom - promptRect.bottom);
    const horizontalDistance = Math.abs(
      (rect.left + rect.width / 2) - (promptRect.left + promptRect.width / 2)
    );

    let score = 260 - Math.min(verticalDistance, 260);
    score += 120 - Math.min(horizontalDistance, 120);

    if (aliases.some((alias) => isExactAliasMatch(text, alias))) {
      score += 120;
    }
    if (rect.top >= promptRect.top - 140 && rect.bottom <= promptRect.bottom + 220) {
      score += 80;
    }
    if (element.closest('header, nav, aside, [role="navigation"]')) {
      score -= 280;
    }

    return score;
  }

  function findDirectAliasOption(promptInput, aliases) {
    const candidates = getClickableElements();
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    candidates.forEach((candidate) => {
      const score = scoreDirectAliasCandidate(candidate, promptInput, aliases);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return bestScore > 80 ? best : null;
  }

  function findPopupOption(trigger, aliases) {
    const triggerRect = trigger.getBoundingClientRect();
    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const candidates = getInspectableOptionElements().filter(
      (candidate) => candidate !== trigger && matchesAnyAlias(readElementText(candidate), aliases)
    );

    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    candidates.forEach((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const text = readElementText(candidate);
      const outsideTriggerBand = rect.bottom < triggerRect.top - 4 || rect.top > triggerRect.bottom + 4;
      const centerX = rect.left + rect.width / 2;
      const horizontalDistance = Math.abs(centerX - triggerCenterX);

      let score = outsideTriggerBand ? 200 : 40;
      score += 120 - Math.min(horizontalDistance, 120);
      score += Math.min((rect.width * rect.height) / 2000, 40);
      if (aliases.some((alias) => isExactAliasMatch(text, alias))) {
        score += 140;
      }

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return best;
  }

  function elementTextMatchesAliases(element, aliases) {
    const text = readElementText(element);
    return matchesAnyAlias(text, aliases);
  }

  function hasSelectedInspectableOption(aliases) {
    return getInspectableOptionElements().some((element) => {
      const description = describeElement(element);
      return (
        description
        && description.selected
        && matchesAnyAlias(description.text, aliases)
      );
    });
  }

  async function finalizeTriggerSelection(trigger, aliases) {
    const matched =
      elementTextMatchesAliases(trigger, aliases)
      || hasSelectedInspectableOption(aliases);

    if (matched) {
      closeOpenOverlay(trigger);
      await waitForUiSettled(60);
      return true;
    }

    return false;
  }

  function findComboboxPopupOptions(trigger, aliases = null) {
    if (!(trigger instanceof HTMLElement)) {
      return [];
    }

    const triggerRect = trigger.getBoundingClientRect();
    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const candidates = queryAllDeep('[role="option"]')
      .filter((element) =>
        element instanceof HTMLElement
        && isVisible(element)
        && (
          aliases == null
          || (Array.isArray(aliases) && aliases.length === 0)
          || matchesAnyAlias(readElementText(element), aliases)
        )
      );

    return candidates
      .map((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const text = readElementText(candidate);
        const outsideToolbarBand =
          rect.bottom < triggerRect.top - 4 || rect.top > triggerRect.bottom + 4;
        const centerX = rect.left + rect.width / 2;
        const horizontalDistance = Math.abs(centerX - triggerCenterX);
        const verticalDistance = Math.min(
          Math.abs(rect.top - triggerRect.bottom),
          Math.abs(triggerRect.top - rect.bottom)
        );

        let score = outsideToolbarBand ? 220 : 40;
        score += 120 - Math.min(horizontalDistance, 120);
        score += 100 - Math.min(verticalDistance, 100);
        if (Array.isArray(aliases) && aliases.some((alias) => isExactAliasMatch(text, alias))) {
          score += 240;
        }
        if (candidate.getAttribute('aria-selected') === 'true') {
          score += 60;
        }

        return {
          element: candidate,
          rect,
          text,
          score,
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (Math.abs(left.rect.top - right.rect.top) > 8) {
          return left.rect.top - right.rect.top;
        }
        return left.rect.left - right.rect.left;
      })
      .map((entry) => entry.element);
  }

  function findComboboxPopupOption(trigger, aliases) {
    return findComboboxPopupOptions(trigger, aliases)[0] || null;
  }

  function isComboboxOptionSelected(element) {
    return element instanceof HTMLElement && (
      element.getAttribute('aria-selected') === 'true'
      || element.getAttribute('aria-checked') === 'true'
      || element.getAttribute('data-state') === 'checked'
    );
  }

  function findComboboxPopupOptionsByVisualOrder(trigger, aliases = null) {
    if (!(trigger instanceof HTMLElement)) {
      return [];
    }

    const triggerRect = trigger.getBoundingClientRect();

    return queryAllDeep('[role="option"]')
      .filter((element) =>
        element instanceof HTMLElement
        && isVisible(element)
        && isLikelyPopupOption(triggerRect, element.getBoundingClientRect())
        && (
          aliases == null
          || (Array.isArray(aliases) && aliases.length === 0)
          || matchesAnyAlias(readElementText(element), aliases)
        )
      )
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        if (Math.abs(leftRect.top - rightRect.top) > 8) {
          return leftRect.top - rightRect.top;
        }
        return leftRect.left - rightRect.left;
      });
  }

  function hasSelectedComboboxOption(aliases) {
    return queryAllDeep('[role="option"]').some((element) => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) {
        return false;
      }

      return isComboboxOptionSelected(element) && matchesAnyAlias(readElementText(element), aliases);
    });
  }

  function hasSelectedComboboxOptionAtIndex(trigger, optionIndex) {
    if (!Number.isInteger(optionIndex) || optionIndex < 0) {
      return false;
    }

    const options = findComboboxPopupOptionsByVisualOrder(trigger);
    const selectedOption = options[optionIndex];
    return isComboboxOptionSelected(selectedOption);
  }

  function readToolbarComboboxTextByIndex(promptInput, controlIndex, fallbackTrigger = null) {
    const comboboxes = collectToolbarComboboxes(promptInput);
    const trigger = comboboxes[controlIndex] || fallbackTrigger;
    return trigger instanceof HTMLElement ? readElementText(trigger) : '';
  }

  function closeOpenOverlayIfExpanded(trigger) {
    if (!(trigger instanceof HTMLElement)) {
      return;
    }

    if (trigger.getAttribute('aria-expanded') === 'true') {
      closeOpenOverlay(trigger);
    }
  }

  function dispatchKeyToFocusedElement(fallbackTarget, key, code = key) {
    const recipient = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : fallbackTarget;
    if (!(recipient instanceof HTMLElement)) {
      return;
    }

    recipient.focus();
    recipient.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      code,
      bubbles: true,
      cancelable: true,
    }));
    recipient.dispatchEvent(new KeyboardEvent('keyup', {
      key,
      code,
      bubbles: true,
      cancelable: true,
    }));
  }

  async function ensureToolbarComboboxVisualOptionByIndex(
    promptInput,
    controlIndex,
    optionIndex,
    label,
    options = {}
  ) {
    const aliases = Array.isArray(options.aliases) ? options.aliases : [];
    const assumeSuccessAfterClick = options.assumeSuccessAfterClick === true;
    const comboboxes = collectToolbarComboboxes(promptInput);
    const trigger = comboboxes[controlIndex] || null;
    if (!(trigger instanceof HTMLElement)) {
      recordSubmissionStep('missing-combobox', `${label}:${controlIndex}`);
      return false;
    }

    const triggerText = readElementText(trigger);
    if (aliases.some((alias) => isExactAliasMatch(triggerText, alias))) {
      recordSubmissionStep('combobox-already-matched', `${label}:${triggerText}`);
      return true;
    }

    closeOpenOverlay(trigger);
    await waitForUiSettled(60);
    recordSubmissionStep('combobox-visual-open', `${label}:${triggerText}`);
    clickElement(trigger);
    await waitForUiSettled(140);

    const visualOptions = findComboboxPopupOptionsByVisualOrder(trigger);
    const option = visualOptions[optionIndex] || null;
    if (!(option instanceof HTMLElement)) {
      closeOpenOverlay(trigger);
      await waitForUiSettled(60);
      recordSubmissionStep('combobox-visual-missing-option', `${label}:${optionIndex}`);
      return false;
    }

    if (isComboboxOptionSelected(option)) {
      recordSubmissionStep('combobox-visual-already-selected', `${label}:${readElementText(option)}`);
      closeOpenOverlay(trigger);
      await waitForUiSettled(60);
      return true;
    }

    recordSubmissionStep('combobox-visual-click-option', `${label}:${readElementText(option)}`);
    clickElement(option);
    await waitForUiSettled(760);

    const refreshedPromptInput = findPromptInput() || promptInput;
    const refreshedTriggerText = readToolbarComboboxTextByIndex(
      refreshedPromptInput,
      controlIndex,
      trigger
    );

    const confirmed =
      aliases.some((alias) => isExactAliasMatch(refreshedTriggerText, alias))
      || hasSelectedComboboxOptionAtIndex(trigger, optionIndex)
      || (aliases.length > 0 && hasSelectedComboboxOption(aliases));

    if (confirmed) {
      closeOpenOverlayIfExpanded(trigger);
      await waitForUiSettled(60);
      recordSubmissionStep('combobox-visual-confirmed', `${label}:${optionIndex}`);
      return true;
    }

    if (assumeSuccessAfterClick) {
      closeOpenOverlayIfExpanded(trigger);
      await waitForUiSettled(60);
      recordSubmissionStep('combobox-visual-assumed', `${label}:${readElementText(option)}`);
      return true;
    }

    closeOpenOverlay(trigger);
    await waitForUiSettled(60);
    recordSubmissionStep('combobox-visual-failed', `${label}:${readElementText(trigger)}`);
    return false;
  }

  async function ensureFixedVideoReferenceMode(promptInput, payload) {
    const aliases = resolveAliases(REFERENCE_MODE_ALIASES, payload.referenceMode);
    const comboboxes = collectToolbarComboboxes(promptInput);
    const trigger = comboboxes[2] || null;
    if (!(trigger instanceof HTMLElement)) {
      throw new Error('Missing Jimeng reference mode combobox');
    }

    const triggerText = readElementText(trigger);
    if (aliases.some((alias) => isExactAliasMatch(triggerText, alias))) {
      payload.fixedVideoReferenceModeApplied = true;
      recordSubmissionStep('referenceMode-already-matched', triggerText);
      return true;
    }

    if (payload.referenceMode === 'allAround') {
      const visualMatched = await ensureToolbarComboboxVisualOptionByIndex(
        promptInput,
        2,
        0,
        'referenceMode',
        { aliases }
      );
      if (visualMatched) {
        payload.fixedVideoReferenceModeApplied = true;
        recordSubmissionStep('referenceMode-visual-confirmed', aliases[0] || 'allAround');
        return true;
      }
    }

    recordSubmissionStep('referenceMode-direct-start', triggerText);
    closeOpenOverlay(trigger);
    await waitForUiSettled(60);
    clickElement(trigger);
    await waitForUiSettled(140);

    const aliasOption = findComboboxPopupOptionsByVisualOrder(trigger, aliases)[0]
      || findComboboxPopupOption(trigger, aliases);
    if (aliasOption instanceof HTMLElement) {
      recordSubmissionStep('referenceMode-direct-click', readElementText(aliasOption));
      clickElement(aliasOption);
      await waitForUiSettled(820);

      const refreshedPromptInput = findPromptInput() || promptInput;
      const refreshedTrigger = collectToolbarComboboxes(refreshedPromptInput)[2] || trigger;
      const refreshedText = readElementText(refreshedTrigger);
      if (
        aliases.some((alias) => isExactAliasMatch(refreshedText, alias))
        || hasSelectedComboboxOption(aliases)
      ) {
        closeOpenOverlayIfExpanded(refreshedTrigger);
        await waitForUiSettled(60);
        payload.fixedVideoReferenceModeApplied = true;
        recordSubmissionStep('referenceMode-direct-confirmed', refreshedText || readElementText(aliasOption));
        return true;
      }
    } else {
      closeOpenOverlay(trigger);
      await waitForUiSettled(60);
    }

    const visibleOptions = findComboboxPopupOptionsByVisualOrder(trigger)
      .map((option) => readElementText(option))
      .filter(Boolean)
      .join(' | ');
    recordSubmissionStep('referenceMode-fatal', visibleOptions || triggerText);
    throw new Error(`Failed to switch Jimeng reference mode: ${visibleOptions || triggerText || 'unknown options'}`);
  }

  async function ensureToolbarComboboxValueByIndex(
    promptInput,
    controlIndex,
    aliases,
    label,
    options = {}
  ) {
    const preferredOptionIndex = Number.isInteger(options.preferredOptionIndex)
      ? options.preferredOptionIndex
      : null;
    const comboboxes = collectToolbarComboboxes(promptInput);
    const trigger = comboboxes[controlIndex] || null;
    if (!(trigger instanceof HTMLElement)) {
      recordSubmissionStep('missing-combobox', `${label}:${controlIndex}`);
      return false;
    }

    const triggerText = readElementText(trigger);
    if (aliases.some((alias) => isExactAliasMatch(triggerText, alias))) {
      recordSubmissionStep('combobox-already-matched', `${label}:${triggerText}`);
      return true;
    }

    closeOpenOverlay(trigger);
    await waitForUiSettled(60);
    recordSubmissionStep('combobox-open', `${label}:${triggerText}`);
    clickElement(trigger);
    await waitForUiSettled(140);

    let option = preferredOptionIndex == null
      ? findComboboxPopupOption(trigger, aliases)
      : (findComboboxPopupOptions(trigger)[preferredOptionIndex] || findComboboxPopupOption(trigger, aliases));
    if (option) {
      const optionDescription = describeElement(option);
      if (
        optionDescription
        && optionDescription.selected
        && (
          matchesAnyAlias(optionDescription.text, aliases)
          || (preferredOptionIndex != null && hasSelectedComboboxOptionAtIndex(trigger, preferredOptionIndex))
        )
      ) {
        recordSubmissionStep('combobox-selected-option-visible', `${label}:${optionDescription.text}`);
        closeOpenOverlay(trigger);
        await waitForUiSettled(60);
        return true;
      }

      recordSubmissionStep('combobox-click-option', `${label}:${readElementText(option)}`);
      clickElement(option);
      await waitForUiSettled(760);
      const refreshedPromptInput = findPromptInput() || promptInput;
      const refreshedTriggerText = readToolbarComboboxTextByIndex(
        refreshedPromptInput,
        controlIndex,
        trigger
      );
      if (
        aliases.some((alias) => isExactAliasMatch(refreshedTriggerText, alias))
        || hasSelectedComboboxOption(aliases)
        || (preferredOptionIndex != null && hasSelectedComboboxOptionAtIndex(trigger, preferredOptionIndex))
      ) {
        closeOpenOverlayIfExpanded(trigger);
        await waitForUiSettled(60);
        return true;
      }
    }

    option = preferredOptionIndex == null
      ? findComboboxPopupOption(trigger, aliases)
      : (findComboboxPopupOptions(trigger)[preferredOptionIndex] || findComboboxPopupOption(trigger, aliases));
    if (option) {
      recordSubmissionStep('combobox-second-click-option', `${label}:${readElementText(option)}`);
      clickElement(option);
      await waitForUiSettled(760);
      const refreshedPromptInput = findPromptInput() || promptInput;
      const refreshedTriggerText = readToolbarComboboxTextByIndex(
        refreshedPromptInput,
        controlIndex,
        trigger
      );
      if (
        aliases.some((alias) => isExactAliasMatch(refreshedTriggerText, alias))
        || hasSelectedComboboxOption(aliases)
        || (preferredOptionIndex != null && hasSelectedComboboxOptionAtIndex(trigger, preferredOptionIndex))
      ) {
        closeOpenOverlayIfExpanded(trigger);
        await waitForUiSettled(60);
        return true;
      }
    }

    closeOpenOverlay(trigger);
    await waitForUiSettled(60);
    recordSubmissionStep('combobox-failed', `${label}:${readElementText(trigger)}`);
    return false;
  }

  async function ensureControlValue(promptInput, control, value, options = {}) {
    if (value == null) {
      return true;
    }

    const requireTrigger = options.requireTrigger !== false;
    const aliasMap = control.aliasMap;
    const aliases = resolveAliases(aliasMap, value);
    const primaryAlias = aliases[0];
    const directOption = findDirectAliasOption(promptInput, aliases);
    const directDescription = directOption ? describeElement(directOption) : null;

    if (directDescription && directDescription.selected) {
      return true;
    }

    if (directOption) {
      const directText = readElementText(directOption);
      if (aliases.some((alias) => isExactAliasMatch(directText, alias))) {
        clickElement(directOption);
        await waitForUiSettled(140);
        const refreshedDirectOption = findDirectAliasOption(promptInput, aliases);
        if (refreshedDirectOption && describeElement(refreshedDirectOption)?.selected) {
          return true;
        }
        return false;
      }
    }

    const trigger = findControlTrigger(control, promptInput);
    if (!trigger) {
      return !requireTrigger;
    }

    if (primaryAlias && isExactAliasMatch(readElementText(trigger), primaryAlias)) {
      return true;
    }

    const option = findPopupOption(trigger, aliases);
    if (option) {
      const optionDescription = describeElement(option);
      if (
        optionDescription
        && optionDescription.selected
        && matchesAnyAlias(optionDescription.text, aliases)
      ) {
        closeOpenOverlay(trigger);
        await waitForUiSettled(60);
        return true;
      }
      clickElement(option);
      await waitForUiSettled(140);
      return await finalizeTriggerSelection(trigger, aliases);
    }

    clickElement(trigger);
    await waitForUiSettled(140);
    const revealedOption = findPopupOption(trigger, aliases);
    if (revealedOption) {
      clickElement(revealedOption);
      await waitForUiSettled(140);
      return await finalizeTriggerSelection(trigger, aliases);
    }
    closeOpenOverlay(trigger);
    await waitForUiSettled(60);
    return await finalizeTriggerSelection(trigger, aliases);
  }

  async function ensureTriggerValue(trigger, aliases) {
    if (!(trigger instanceof HTMLElement)) {
      return false;
    }

    const triggerText = readElementText(trigger);
    if (aliases.some((alias) => isExactAliasMatch(triggerText, alias))) {
      return true;
    }

    let option = findPopupOption(trigger, aliases);
    if (option) {
      const optionDescription = describeElement(option);
      if (
        optionDescription
        && optionDescription.selected
        && matchesAnyAlias(optionDescription.text, aliases)
      ) {
        closeOpenOverlay(trigger);
        await waitForUiSettled(60);
        return true;
      }
      clickElement(option);
      await waitForUiSettled(140);
      return await finalizeTriggerSelection(trigger, aliases);
    }

    clickElement(trigger);
    await waitForUiSettled(140);
    option = findPopupOption(trigger, aliases);
    if (option) {
      clickElement(option);
      await waitForUiSettled(140);
      return await finalizeTriggerSelection(trigger, aliases);
    }

    closeOpenOverlay(trigger);
    await waitForUiSettled(60);
    return await finalizeTriggerSelection(trigger, aliases);
  }

  function findVideoAspectRatioTrigger(promptInput) {
    const candidates = queryAllDeep('button, [role="button"]')
      .filter((element) =>
        element instanceof HTMLElement
        && isElementWithinToolbarBand(element, promptInput)
        && matchesAnyAlias(readElementText(element), flattenAliasMap(ASPECT_RATIO_ALIASES))
      )
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        if (Math.abs(leftRect.top - rightRect.top) > 10) {
          return leftRect.top - rightRect.top;
        }
        return leftRect.left - rightRect.left;
      });

    return candidates[0] || null;
  }

  function findVideoAspectRatioOption(promptInput, aliases) {
    const candidates = queryAllDeep('button, [role="button"], [role="radio"], label')
      .filter((element) =>
        element instanceof HTMLElement
        && isElementWithinToolbarBand(element, promptInput)
        && !element.closest('[role="combobox"]')
        && matchesAnyAlias(readElementText(element), aliases)
      )
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        if (Math.abs(leftRect.top - rightRect.top) > 10) {
          return leftRect.top - rightRect.top;
        }
        return leftRect.left - rightRect.left;
      });

    const exactMatch = candidates.find((candidate) => elementTextMatchesAliases(candidate, aliases));
    return exactMatch || candidates[0] || null;
  }

  async function ensureVideoAspectRatioValue(promptInput, value) {
    if (value == null) {
      return true;
    }

    const aliases = resolveAliases(ASPECT_RATIO_ALIASES, value);
    const directOption = findVideoAspectRatioOption(promptInput, aliases);
    if (directOption) {
      const initialDescription = describeElement(directOption);
      if (initialDescription && initialDescription.selected) {
        return true;
      }

      clickElement(directOption);
      await waitForUiSettled(140);

      const refreshedOption = findVideoAspectRatioOption(promptInput, aliases);
      const refreshedDescription = refreshedOption ? describeElement(refreshedOption) : null;
      if (refreshedDescription && refreshedDescription.selected) {
        return true;
      }

      // Some Jimeng ratio buttons do not expose a selected attribute.
      // For those direct button groups, clicking the exact target button is
      // the authoritative action and should not trigger endless retries.
      return Boolean(refreshedOption);
    }

    const trigger = findVideoAspectRatioTrigger(promptInput);
    return await ensureTriggerValue(trigger, aliases);
  }

  async function ensureFixedVideoToolbarControls(promptInput, payload) {
    promptInput = findPromptInput() || promptInput;
    if (!(await ensureToolbarComboboxValueByIndex(
      promptInput,
      0,
      resolveAliases(CREATION_TYPE_ALIASES, payload.creationType || 'video'),
      'creationType'
    ))) {
      return false;
    }

    const hasReferenceImages = Array.isArray(payload.referenceImages) && payload.referenceImages.length > 0;
    if (hasReferenceImages && payload.referenceMode) {
      if (payload.fixedVideoReferenceModeApplied) {
        recordSubmissionStep('referenceMode-skip-repeat', String(payload.referenceMode));
      } else {
        promptInput = findPromptInput() || promptInput;
        await ensureFixedVideoReferenceMode(promptInput, payload);
        // Jimeng will auto-adjust the model when reference mode changes.
        // Apply the dependency order that matches the real UI behavior:
        // 视频生成 -> 参考模式 -> 模型 -> 比例 -> 时长.
        recordSubmissionStep('referenceMode-settled', String(payload.referenceMode));
        await waitForUiSettled(260);
      }
    }

    if (payload.model) {
      promptInput = findPromptInput() || promptInput;
      if (!(await ensureToolbarComboboxValueByIndex(
        promptInput,
        1,
        resolveAliases(MODEL_ALIASES, payload.model),
        'model',
        payload.model === 'seedance-2.0'
          ? { preferredOptionIndex: 1 }
          : {}
      ))) {
        return false;
      }
    }

    if (payload.aspectRatio) {
      promptInput = findPromptInput() || promptInput;
      recordSubmissionStep('aspect-ratio-start', String(payload.aspectRatio));
      if (!(await ensureVideoAspectRatioValue(promptInput, payload.aspectRatio))) {
        return false;
      }
    }

    if (payload.durationSeconds != null) {
      promptInput = findPromptInput() || promptInput;
      if (!(await ensureToolbarComboboxValueByIndex(
        promptInput,
        3,
        resolveAliases(DURATION_ALIASES, payload.durationSeconds),
        'duration'
      ))) {
        return false;
      }
    }

    return true;
  }

  function findToolbarTriggerByIndex(promptInput, controlIndex) {
    const toolbarCandidates = collectToolbarCandidates(promptInput);
    if (!Number.isInteger(controlIndex) || controlIndex < 0 || controlIndex >= toolbarCandidates.length) {
      return null;
    }

    return toolbarCandidates[controlIndex].element;
  }

  async function ensureIndexedToolbarControlValue(promptInput, control) {
    if (!control || !control.optionText) {
      return true;
    }

    const trigger = findToolbarTriggerByIndex(promptInput, control.controlIndex);
    if (!trigger) {
      return false;
    }

    if (isExactAliasMatch(readElementText(trigger), control.optionText)) {
      return true;
    }

    const option = findPopupOption(trigger, [control.optionText]);
    if (option) {
      const optionDescription = describeElement(option);
      if (optionDescription && optionDescription.selected) {
        closeOpenOverlay(trigger);
        await waitForUiSettled(60);
        return true;
      }
      clickElement(option);
      await waitForUiSettled(140);
      return isExactAliasMatch(readElementText(trigger), control.optionText);
    }

    clickElement(trigger);
    await waitForUiSettled(140);
    const revealedOption = findPopupOption(trigger, [control.optionText]);
    if (revealedOption) {
      clickElement(revealedOption);
      await waitForUiSettled(140);
      return isExactAliasMatch(readElementText(trigger), control.optionText);
    }
    return isExactAliasMatch(readElementText(trigger), control.optionText);
  }

  function scoreSubmitButton(element, promptInput) {
    const text = readElementText(element);
    const className = typeof element.className === 'string' ? element.className : '';
    const matchedKeyword = SUBMIT_KEYWORDS.some((keyword) =>
      normalizeText(text).includes(normalizeText(keyword))
    );
    const isExplicitSubmitButton =
      className.includes('submit-button') || className.includes('lv-btn-primary');

    const rect = element.getBoundingClientRect();
    const promptRect = promptInput.getBoundingClientRect();
    const verticalDistance = Math.abs(rect.bottom - promptRect.bottom);
    const horizontalDistance = Math.abs(rect.right - promptRect.right);

    let score = matchedKeyword ? 220 : 40;
    score += 120 - Math.min(verticalDistance, 120);
    score += 120 - Math.min(horizontalDistance, 120);
    score += Math.min(rect.width / 8, 20);
    score += Math.min(rect.height / 6, 18);
    if (isExplicitSubmitButton) {
      score += 320;
    }
    if (element.closest('header, nav, aside, [role="navigation"]')) {
      score -= 240;
    }
    if (element.closest('form')) {
      score += 30;
    }
    if (verticalDistance > 280) {
      score -= 160;
    }
    if (!matchedKeyword && !isExplicitSubmitButton && text.length === 0) {
      score -= 120;
    }

    return score;
  }

  function findSubmitButton(promptInput) {
    const candidates = queryAllDeep(
      'button, [role="button"], input[type="submit"], input[type="button"]'
    ).filter((element) => isVisible(element) && !('disabled' in element && element.disabled));
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    candidates.forEach((candidate) => {
      const score = scoreSubmitButton(candidate, promptInput);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return best;
  }

  function clearRetryTimer() {
    if (state.retryTimer != null) {
      window.clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
  }

  function scheduleRetry() {
    if (!state.pending || state.retryTimer != null) {
      return;
    }

    state.retryTimer = window.setTimeout(() => {
      state.retryTimer = null;
      attemptPendingSubmission();
    }, RETRY_DELAY_MS);
  }

  function markCompleted() {
    state.pending = null;
    clearRetryTimer();
  }

  function detectRepeatedSubmissionLoop(minRepeats = 5) {
    const history = state.submissionStepHistory;
    if (!Array.isArray(history) || history.length < minRepeats) {
      return null;
    }

    const recentEntries = history.slice(-minRepeats);
    const firstEntry = recentEntries[0];
    if (!firstEntry || !firstEntry.step) {
      return null;
    }

    const repeated = recentEntries.every((entry) =>
      entry
      && entry.step === firstEntry.step
      && entry.detail === firstEntry.detail
    );

    return repeated ? firstEntry : null;
  }

  async function tryApplySubmission(payload) {
    const deadline = Number.isFinite(payload && payload.deadline)
      ? payload.deadline
      : (Date.now() + MAX_WAIT_MS);

    let promptInput = await waitForPromptInputUntil(deadline);
    if (!promptInput) {
      throw new Error('Timed out waiting for Jimeng editor controls');
    }

    if (!(await ensureReferenceImagesApplied(payload, promptInput))) {
      throw new Error('Failed to upload Jimeng reference images');
    }

    promptInput = await waitForPromptInputUntil(deadline);
    if (!promptInput) {
      throw new Error('Timed out waiting for Jimeng editor controls after reference image upload');
    }

    const promptValue = normalizePrompt(payload.prompt);
    if (promptValue && !setPromptValue(promptInput, promptValue)) {
      throw new Error('Failed to write Jimeng prompt');
    }

    if (!payload.skipToolbarAutomation) {
      if (payload.creationType === 'video') {
        if (!(await ensureFixedVideoToolbarControls(promptInput, payload))) {
          throw new Error('Failed to apply Jimeng fixed video toolbar controls');
        }
      } else {
        for (const control of CONTROL_SEQUENCE) {
          const requireTrigger =
            control.key === 'aspectRatio' || control.key === 'durationSeconds';
          if (!(await ensureControlValue(promptInput, control, payload[control.key], { requireTrigger }))) {
            throw new Error(`Failed to apply Jimeng control: ${control.key}`);
          }
        }
      }

      const extraControls = Array.isArray(payload.extraControls)
        ? [...payload.extraControls].sort((left, right) => left.controlIndex - right.controlIndex)
        : [];
      for (const control of extraControls) {
        if (!(await ensureIndexedToolbarControlValue(promptInput, control))) {
          throw new Error(`Failed to apply Jimeng extra control: ${control.triggerText || control.controlIndex}`);
        }
      }
    }

    promptInput = (await waitForPromptInputUntil(deadline)) || promptInput;
    if (promptValue && !setPromptValue(promptInput, promptValue)) {
      throw new Error('Failed to restore Jimeng prompt');
    }

    if (!payload.autoSubmit) {
      return true;
    }

    const form = promptInput.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit();
        return true;
      } catch (_error) {
        // Fall through to manual button click.
      }
    }

    const submitButton = findSubmitButton(promptInput);
    if (!submitButton) {
      throw new Error('Unable to find Jimeng submit button');
    }

    clickElement(submitButton);
    return true;
  }

  async function attemptPendingSubmission() {
    if (!state.pending || state.attemptInFlight) {
      return;
    }

    state.attemptInFlight = true;

    if (Date.now() > state.pending.deadline) {
      setSubmissionError('Timed out waiting for Jimeng editor controls');
      markCompleted();
      state.attemptInFlight = false;
      return;
    }

    try {
      if (await tryApplySubmission(state.pending)) {
        setSubmissionReady();
        markCompleted();
        return;
      }

      setSubmissionError('Jimeng submission did not finish in a single automation pass');
      markCompleted();
    } catch (error) {
      setSubmissionError(String(error && error.message ? error.message : error));
      markCompleted();
    } finally {
      state.attemptInFlight = false;
    }
  }

  function normalizePrompt(value) {
    return String(value || '').trim();
  }

  async function waitForPromptInputUntil(deadline) {
    while (Date.now() <= deadline) {
      const promptInput = findPromptInput();
      if (promptInput) {
        return promptInput;
      }
      await waitForDelay(RETRY_DELAY_MS);
    }

    return null;
  }

  function waitForDelay(delayMs) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  function waitForNextFrame() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  async function waitForUiSettled(delayMs = 120) {
    await waitForNextFrame();
    await waitForDelay(delayMs);
    await waitForNextFrame();
  }

  function describeElement(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const text = collapseWhitespace(readElementText(element));
    const signature = [
      normalizeText(text).slice(0, 80),
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height),
    ].join(':');

    return {
      element,
      text,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      disabled: 'disabled' in element ? Boolean(element.disabled) : false,
      selected:
        element.getAttribute('aria-selected') === 'true'
        || element.getAttribute('aria-checked') === 'true'
        || element.getAttribute('aria-pressed') === 'true'
        || element.getAttribute('data-state') === 'checked'
        || element.getAttribute('data-state') === 'open',
      signature,
    };
  }

  function sortByVisualOrder(left, right) {
    if (Math.abs(left.rect.top - right.rect.top) > 10) {
      return left.rect.top - right.rect.top;
    }

    return left.rect.left - right.rect.left;
  }

  function collectToolbarCandidates(promptInput) {
    const bounds = getToolbarBandBounds(promptInput);
    const seen = new Set();

    return getClickableElements()
      .map((element) => describeElement(element))
      .filter(Boolean)
      .filter((candidate) => candidate.text.length > 0)
      .filter((candidate) => candidate.rect.width >= 28 && candidate.rect.height >= 24)
      .filter((candidate) => !SUBMIT_KEYWORDS.some((keyword) => matchesAnyAlias(candidate.text, [keyword])))
      .filter((candidate) => !candidate.element.closest('header, nav, aside, [role="navigation"]'))
      .filter((candidate) => {
        const rect = candidate.rect;
        const verticalInBand = rect.top >= bounds.bandTop && rect.bottom <= bounds.bandBottom;
        const horizontalInBand = rect.left >= bounds.leftBound && rect.right <= bounds.rightBound;
        return verticalInBand && horizontalInBand;
      })
      .filter((candidate) => {
        if (seen.has(candidate.signature)) {
          return false;
        }
        seen.add(candidate.signature);
        return true;
      })
      .sort(sortByVisualOrder);
  }

  function collectVisibleElementSignatures() {
    const signatures = new Set();
    getInspectableOptionElements().forEach((element) => {
      const description = describeElement(element);
      if (description) {
        signatures.add(description.signature);
      }
    });
    return signatures;
  }

  function isLikelyPopupOption(triggerRect, candidateRect) {
    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const candidateCenterX = candidateRect.left + candidateRect.width / 2;
    const horizontalDistance = Math.abs(candidateCenterX - triggerCenterX);
    const belowDistance = candidateRect.top - (triggerRect.top + triggerRect.height);
    const aboveDistance = triggerRect.top - (candidateRect.top + candidateRect.height);
    const verticalDistance = Math.max(belowDistance, aboveDistance, 0);
    const sameToolbarBand = Math.abs(candidateRect.top - triggerRect.top) <= 18;

    return !sameToolbarBand && horizontalDistance <= 480 && verticalDistance <= 560;
  }

  function closeOpenOverlay(trigger) {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
    document.dispatchEvent(
      new KeyboardEvent('keyup', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );

    if (trigger instanceof HTMLElement) {
      const body = document.body;
      if (body) {
        body.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: 8,
            clientY: 8,
            view: window,
          })
        );
        body.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            clientX: 8,
            clientY: 8,
            view: window,
          })
        );
        body.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: 8,
            clientY: 8,
            view: window,
          })
        );
      }
    }
  }

  async function inspectTrigger(trigger) {
    const triggerDescription = describeElement(trigger);
    if (!triggerDescription) {
      return null;
    }

    const beforeSignatures = collectVisibleElementSignatures();
    clickElement(trigger);
    await waitForUiSettled(140);

    const triggerRect = trigger.getBoundingClientRect();
    const seen = new Set();
    const options = getInspectableOptionElements()
      .map((element) => describeElement(element))
      .filter(Boolean)
      .filter((candidate) => candidate.signature !== triggerDescription.signature)
      .filter((candidate) => candidate.text.length > 0)
      .filter((candidate) => !beforeSignatures.has(candidate.signature))
      .filter((candidate) => isLikelyPopupOption(triggerRect, candidate.rect))
      .filter((candidate) => {
        if (seen.has(candidate.signature)) {
          return false;
        }
        seen.add(candidate.signature);
        return true;
      })
      .sort(sortByVisualOrder)
      .map((candidate) => ({
        text: candidate.text,
        disabled: candidate.disabled,
        selected: candidate.selected,
      }));

    closeOpenOverlay(trigger);
    await waitForUiSettled(60);

    return {
      triggerText: triggerDescription.text,
      options,
    };
  }

  async function inspectKnownControls(promptInput) {
    const knownControls = {};

    for (const control of CONTROL_SEQUENCE) {
      const trigger = findControlTrigger(control, promptInput);
      if (!trigger) {
        continue;
      }

      const result = await inspectTrigger(trigger);
      if (result) {
        knownControls[control.key] = {
          triggerText: result.triggerText,
          matchedValue: resolveMatchedAliasValue(control.aliasMap, result.triggerText),
          options: result.options.map((option) => ({
            ...option,
            matchedValue: resolveMatchedAliasValue(control.aliasMap, option.text),
          })),
        };
      }
    }

    return knownControls;
  }

  async function collectInspectionReport(promptInput) {
    const submitButton = findSubmitButton(promptInput);
    const toolbarCandidates = collectToolbarCandidates(promptInput);
    const toolbar = [];
    for (const [controlIndex, candidate] of toolbarCandidates.entries()) {
      const inspection = await inspectTrigger(candidate.element);
      const options = inspection ? inspection.options : [];
      toolbar.push({
        controlIndex,
        triggerText: candidate.text,
        matchedKnownControlKey: resolveMatchedKnownControlKey(candidate.text, options),
        options: options.map((option) => ({
          ...option,
          matchedKnownControlKey: resolveMatchedKnownControlKey(option.text, [option]),
        })),
      });
    }

    const promptDescription = describeElement(promptInput);
    const knownControls = await inspectKnownControls(promptInput);
    const hasKnownControls = Object.keys(knownControls).length > 0;
    const hasToolbar = toolbar.length > 0;
    const hasSubmitButton = Boolean(submitButton);

    if (!hasKnownControls && !hasToolbar && !hasSubmitButton) {
      return null;
    }

    return {
      inspectedAt: new Date().toISOString(),
      locationHref: window.location.href,
      documentTitle: document.title,
      prompt: promptDescription
        ? {
            text: promptDescription.text,
            rect: promptDescription.rect,
          }
        : null,
      submitButton: submitButton
        ? {
            text: readElementText(submitButton),
          }
        : null,
      toolbar,
      knownControls,
    };
  }

  function encodeReport(report) {
    const payload = JSON.stringify(report);
    const bytes = new TextEncoder().encode(payload);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary);
  }

  function publishInspectionReport(report) {
    const previousTitle = document.title;
    document.title = `${INSPECTION_MARKER}${encodeReport(report)}`;
    window.setTimeout(() => {
      if (document.title.startsWith(INSPECTION_MARKER)) {
        document.title = previousTitle;
      }
    }, 800);
  }

  async function inspectWhenReady() {
    if (state.inspectionStarted || state.inspectionReported) {
      return false;
    }

    state.inspectionStarted = true;
    setInspectionPending();

    try {
      const deadline = Date.now() + MAX_WAIT_MS;
      while (Date.now() <= deadline) {
        const promptInput = findPromptInput();
        if (promptInput) {
          const report = await collectInspectionReport(promptInput);
          if (report) {
            setInspectionReady(report);
            publishInspectionReport(report);
            return true;
          }
        }

        await waitForDelay(RETRY_DELAY_MS);
      }
      setInspectionError('Timed out waiting for Jimeng editor controls');
    } catch (error) {
      setInspectionError(String(error && error.message ? error.message : error));
    } finally {
      state.inspectionStarted = false;
    }

    return false;
  }

  function clearInspectionTimer() {
    if (state.inspectionTimer != null) {
      window.clearTimeout(state.inspectionTimer);
      state.inspectionTimer = null;
    }
  }

  function scheduleInspection(delayMs = INSPECTION_DELAY_MS) {
    if (state.inspectionReported || state.inspectionStarted) {
      return;
    }

    if (state.inspectionStatus !== 'pending') {
      setInspectionPending();
    }

    clearInspectionTimer();
    state.inspectionTimer = window.setTimeout(() => {
      state.inspectionTimer = null;
      void inspectWhenReady();
    }, delayMs);
  }

  function requestInspection(force = true) {
    if (force) {
      resetInspectionState();
    }

    scheduleInspection(0);
    return true;
  }

  function getInspectionState() {
    return {
      status: state.inspectionStatus,
      report: state.lastInspectionReport,
      error: state.lastInspectionError,
      requestedAt: state.lastInspectionRequestedAt,
      updatedAt: state.lastInspectionUpdatedAt,
    };
  }

  function getSubmissionState() {
    return {
      status: state.submissionStatus,
      error: state.lastSubmissionError,
      updatedAt: state.lastSubmissionUpdatedAt,
      step: state.lastSubmissionStep,
      stepHistory: state.submissionStepHistory,
    };
  }

  function queueSubmission(payload, autoSubmit) {
    const prompt = normalizePrompt(payload && payload.prompt);
    if (!prompt && autoSubmit) {
      setSubmissionError('Prompt is required for Jimeng submission');
      return false;
    }

    state.pending = {
      prompt,
      creationType: payload && payload.creationType,
      model: payload && payload.model,
      referenceMode: payload && payload.referenceMode,
      aspectRatio: payload && payload.aspectRatio,
      durationSeconds: payload && payload.durationSeconds,
      skipToolbarAutomation: Boolean(payload && payload.skipToolbarAutomation),
      referenceImages: payload && payload.referenceImages,
      referenceUploadStatus: 'idle',
      referenceUploadError: null,
      referenceUploadReadyAt: null,
      referenceUploadPromise: null,
      fixedVideoReferenceModeApplied: false,
      extraControls: payload && payload.extraControls,
      autoSubmit,
      deadline: Date.now() + MAX_WAIT_MS,
    };

    state.lastSubmissionStep = null;
    state.submissionStepHistory = [];
    setSubmissionPending();
    clearRetryTimer();
    attemptPendingSubmission();
    return true;
  }

  function ensureObserver() {
    if (state.observer || !document.documentElement) {
      return;
    }

    state.observer = new MutationObserver(() => {
      if (state.pending) {
        attemptPendingSubmission();
      }

      if (!state.inspectionReported && !state.inspectionStarted) {
        scheduleInspection(600);
      }
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  }

  ensureObserver();
  window.addEventListener('load', () => {
    attemptPendingSubmission();
    scheduleInspection();
  });
  document.addEventListener('readystatechange', () => {
    attemptPendingSubmission();
    scheduleInspection();
  });
  scheduleInspection();

  window.__STORYBOARD_JIMENG__ = {
    requestInspection,
    getInspectionState,
    getSubmissionState,
    scheduleInspection,
    async inspect() {
      return await inspectWhenReady();
    },
    submit(payload) {
      return queueSubmission(payload, payload && payload.autoSubmit !== false);
    },
    syncDraft(payload) {
      return queueSubmission(payload, false);
    },
  };
})();

