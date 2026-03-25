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
    '\u53c2\u8003',
    '\u56fe\u7247',
    '\u56fe\u50cf',
    '\u62d6\u62fd',
    '\u672c\u5730',
    '\u6dfb\u52a0',
    'upload',
    'image',
    'reference',
    'drag',
    'drop',
    'file',
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
    { key: 'creationType', aliasMap: CREATION_TYPE_ALIASES },
    { key: 'model', aliasMap: MODEL_ALIASES },
    { key: 'referenceMode', aliasMap: REFERENCE_MODE_ALIASES },
    { key: 'aspectRatio', aliasMap: ASPECT_RATIO_ALIASES },
    { key: 'durationSeconds', aliasMap: DURATION_ALIASES },
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
      'button, [role="button"], input[type="submit"], input[type="button"]'
    ).filter((element) => isVisible(element) && !('disabled' in element && element.disabled));
  }

  function getInspectableOptionElements() {
    return queryAllDeep(
      [
        'button',
        '[role="button"]',
        '[role="option"]',
        '[role="menuitem"]',
        '[aria-selected]',
        '[aria-checked]',
        '[data-state]',
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
    const normalizedText = normalizeText(text);
    return aliases.some((alias) => normalizedText.includes(normalizeText(alias)));
  }

  function isExactAliasMatch(text, alias) {
    return normalizeText(text) === normalizeText(alias);
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
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return null;
    }

    const matchedEntry = Object.entries(aliasMap).find(([, aliases]) =>
      aliases.some((alias) => normalizedText.includes(normalizeText(alias)))
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

    const text = getElementContextText(element);
    if (!matchesAnyAlias(text, UPLOAD_KEYWORDS)) {
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
      ...queryAllDeep('[role="group"], section, article, div'),
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
      return Date.now() >= (payload.referenceUploadReadyAt || 0);
    }

    if (payload.referenceUploadStatus === 'pending') {
      return false;
    }

    payload.referenceUploadStatus = 'pending';
    payload.referenceUploadError = null;
    payload.referenceUploadReadyAt = null;

    payload.referenceUploadPromise = startReferenceImageUpload(payload, promptInput)
      .then(() => {
        payload.referenceUploadStatus = 'ready';
        payload.referenceUploadReadyAt = Date.now() + REFERENCE_UPLOAD_SETTLE_MS;
        scheduleRetry();
      })
      .catch((error) => {
        payload.referenceUploadStatus = 'error';
        payload.referenceUploadError = String(error && error.message ? error.message : error);
        scheduleRetry();
      });

    return false;
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

  function findControlTrigger(aliasMap, promptInput) {
    const allAliases = flattenAliasMap(aliasMap);
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
      const outsideTriggerBand = rect.bottom < triggerRect.top - 4 || rect.top > triggerRect.bottom + 4;
      const centerX = rect.left + rect.width / 2;
      const horizontalDistance = Math.abs(centerX - triggerCenterX);

      let score = outsideTriggerBand ? 200 : 40;
      score += 120 - Math.min(horizontalDistance, 120);
      score += Math.min((rect.width * rect.height) / 2000, 40);

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return best;
  }

  function ensureControlValue(promptInput, aliasMap, value, options = {}) {
    if (value == null) {
      return true;
    }

    const requireTrigger = options.requireTrigger !== false;
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
        return false;
      }
    }

    const trigger = findControlTrigger(aliasMap, promptInput);
    if (!trigger) {
      return !requireTrigger;
    }

    if (primaryAlias && isExactAliasMatch(readElementText(trigger), primaryAlias)) {
      return true;
    }

    const option = findPopupOption(trigger, aliases);
    if (option) {
      clickElement(option);
      return false;
    }

    clickElement(trigger);
    return false;
  }

  function findToolbarTriggerByIndex(promptInput, controlIndex) {
    const toolbarCandidates = collectToolbarCandidates(promptInput);
    if (!Number.isInteger(controlIndex) || controlIndex < 0 || controlIndex >= toolbarCandidates.length) {
      return null;
    }

    return toolbarCandidates[controlIndex].element;
  }

  function ensureIndexedToolbarControlValue(promptInput, control) {
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
      clickElement(option);
      return false;
    }

    clickElement(trigger);
    return false;
  }

  function scoreSubmitButton(element, promptInput) {
    const text = readElementText(element);
    const matchedKeyword = SUBMIT_KEYWORDS.some((keyword) =>
      normalizeText(text).includes(normalizeText(keyword))
    );

    const rect = element.getBoundingClientRect();
    const promptRect = promptInput.getBoundingClientRect();
    const verticalDistance = Math.abs(rect.bottom - promptRect.bottom);
    const horizontalDistance = Math.abs(rect.right - promptRect.right);

    let score = matchedKeyword ? 220 : 40;
    score += 120 - Math.min(verticalDistance, 120);
    score += 120 - Math.min(horizontalDistance, 120);
    score += Math.min(rect.width / 8, 20);
    score += Math.min(rect.height / 6, 18);
    if (element.closest('header, nav, aside, [role="navigation"]')) {
      score -= 240;
    }
    if (element.closest('form')) {
      score += 30;
    }
    if (verticalDistance > 280) {
      score -= 160;
    }

    return score;
  }

  function findSubmitButton(promptInput) {
    const candidates = getClickableElements();
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

  async function tryApplySubmission(payload) {
    let promptInput = findPromptInput();
    if (!promptInput) {
      return false;
    }

    if (!(await ensureReferenceImagesApplied(payload, promptInput))) {
      return false;
    }

    const promptValue = normalizePrompt(payload.prompt);
    if (promptValue && !setPromptValue(promptInput, promptValue)) {
      return false;
    }

    for (const control of CONTROL_SEQUENCE) {
      const requireTrigger =
        control.key === 'aspectRatio' || control.key === 'durationSeconds';
      if (!ensureControlValue(promptInput, control.aliasMap, payload[control.key], { requireTrigger })) {
        return false;
      }
    }

    const extraControls = Array.isArray(payload.extraControls)
      ? [...payload.extraControls].sort((left, right) => left.controlIndex - right.controlIndex)
      : [];
    for (const control of extraControls) {
      if (!ensureIndexedToolbarControlValue(promptInput, control)) {
        return false;
      }
    }

    promptInput = findPromptInput() || promptInput;
    if (promptValue && !setPromptValue(promptInput, promptValue)) {
      return false;
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
      return false;
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

      scheduleRetry();
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
    const promptRect = promptInput.getBoundingClientRect();
    const promptRegionRect = getPromptRegionRect(promptInput);
    const submitButton = findSubmitButton(promptInput);
    const submitRect = submitButton ? submitButton.getBoundingClientRect() : null;
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
        const bandTop = Math.min(
          Math.round(promptRect.top) - 48,
          submitRect ? Math.round(submitRect.top) - 48 : Math.round(promptRect.top) - 48
        );
        const bandBottom = Math.max(
          Math.round(promptRect.bottom) + 220,
          submitRect ? Math.round(submitRect.bottom) + 160 : Math.round(promptRect.bottom) + 220
        );
        const leftBound = Math.max(
          promptRegionRect.left - 32,
          Math.round(promptRect.left) - 96
        );
        const rightBound = Math.min(
          promptRegionRect.right + 32,
          Math.max(
            Math.round(promptRect.right) + 96,
            submitRect ? Math.round(submitRect.right) + 96 : Math.round(promptRect.right) + 96
          )
        );
        const verticalInBand = rect.top >= bandTop && rect.bottom <= bandBottom;
        const horizontalInBand = rect.left >= leftBound && rect.right <= rightBound;
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
      const trigger = findControlTrigger(control.aliasMap, promptInput);
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
      referenceImages: payload && payload.referenceImages,
      referenceUploadStatus: 'idle',
      referenceUploadError: null,
      referenceUploadReadyAt: null,
      referenceUploadPromise: null,
      extraControls: payload && payload.extraControls,
      autoSubmit,
      deadline: Date.now() + MAX_WAIT_MS,
    };

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

