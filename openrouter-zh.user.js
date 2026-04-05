// ==UserScript==
// @name         OpenRouter 中文化
// @namespace    https://openrouter.ai/
// @version      0.2.0
// @description  将 openrouter.ai 的界面和常见文档内容翻译为中文，支持通过本地 JSON 词库加载并兼容 SPA 动态页面。
// @author       Codex
// @license      MIT
// @match        https://openrouter.ai/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEYS = {
    enabled: "openrouter-zh-enabled",
  };

  const TRANSLATION_PATHS = [
    "file:///C:/Users/wang9/Desktop/git/openrouter-zh/translations/openrouter-zh.json",
    "file:///Users/alanwang/git/openrouter-zh/translations/openrouter-zh.json",
    "https://raw.githubusercontent.com/wang93wei/openrouter-zh/main/translations/openrouter-zh.json",
  ];

  const CONFIG = {
    mutationDebounceMs: 120,
    workerConcurrency: 4,
    attributeNames: ["placeholder", "title", "aria-label", "data-tooltip"],
    ignoredSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "canvas",
      "textarea",
      "select",
      "option",
      "pre",
      "code",
      "kbd",
      "samp",
      "var",
      "tt",
      "[contenteditable='true']",
      ".cm-editor",
      ".cm-content",
      ".cm-line",
      ".shiki",
      ".highlight",
      ".hljs",
      "[data-language]",
      "[data-radix-popper-content-wrapper]",
      "[data-sonner-toaster]",
    ].join(", "),
  };

  const state = {
    enabled: readValue(STORAGE_KEYS.enabled, true),
    translationBundle: null,
    started: false,
    observer: null,
    titleObserver: null,
    flushTimer: null,
    pendingTextNodes: new Set(),
    pendingAttrs: new Map(),
    trackedTextNodes: new Set(),
    trackedElements: new Set(),
    textStates: new WeakMap(),
    attrStates: new WeakMap(),
    elementIds: new WeakMap(),
    nextElementId: 1,
    titleState: null,
    suppressTitleMutation: false,
    suppressedTextMutations: new WeakSet(),
    suppressedAttributeMutations: new WeakMap(),
    lastUrl: location.href,
    historyHooksInstalled: false,
    originalHistoryMethods: {},
    historyChangeHandler: null,
    menus: [],
  };

  initializeTranslationBundle()
    .then(() => {
      registerMenuCommands();
      if (state.enabled) {
        start();
      }
    })
    .catch((err) => {
      console.error("[openrouter-zh] Initialization failed:", err);
      registerMenuCommands();
    });

  function start() {
    if (state.started) {
      return;
    }

    state.started = true;
    void translateDocumentTitle();
    collectTargets(document.body);
    installObservers();
    installHistoryHooks();
    scheduleFlush();
  }

  function loadTranslationFile() {
    return TRANSLATION_PATHS.reduce(
      (prev, url) =>
        prev.catch(() =>
          new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") {
              reject(new Error("GM_xmlhttpRequest not available"));
              return;
            }
            GM_xmlhttpRequest({
              method: "GET",
              url,
              responseType: "arraybuffer",
              onload: (r) => {
                try {
                  const text = new TextDecoder("utf-8").decode(new Uint8Array(r.response));
                  if (text && text.trim()) {
                    resolve(text);
                  } else {
                    reject(new Error(`Failed to load ${url}: status ${r.status}`));
                  }
                } catch (e) {
                  reject(new Error(`Decode error loading ${url}`));
                }
              },
              onerror: (e) => reject(new Error(`Network error loading ${url}`)),
            });
          })
        ),
      Promise.reject(new Error("No paths configured"))
    );
  }

  async function initializeTranslationBundle() {
    try {
      const resourceText = await loadTranslationFile();
      const payload = JSON.parse(resourceText);
      state.translationBundle = buildTranslationBundle(payload);
    } catch (error) {
      console.error("[openrouter-zh] Failed to load local translation resource:", error);
      throw error;
    }
  }

  async function reloadTranslationsAndReapply() {
    const shouldRestart = state.enabled || state.started;
    if (state.started) {
      restoreAll();
    }

    try {
      await initializeTranslationBundle();
      unregisterMenuCommands();
      registerMenuCommands();

      if (shouldRestart) {
        start();
      }
    } catch (err) {
      console.error("[openrouter-zh] Reload failed:", err);
      unregisterMenuCommands();
      registerMenuCommands();
    }
  }

  function installObservers() {
    if (!state.enabled || !state.started) {
      return;
    }

    if (document.body && !state.observer) {
      state.observer = new MutationObserver(handleMutations);
      state.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: CONFIG.attributeNames,
      });
    }

    const titleElement = document.querySelector("title");
    if (titleElement && !state.titleObserver) {
      state.titleObserver = new MutationObserver(() => {
        if (state.suppressTitleMutation) {
          state.suppressTitleMutation = false;
          return;
        }
        void translateDocumentTitle();
      });
      state.titleObserver.observe(titleElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  function installHistoryHooks() {
    if (state.historyHooksInstalled) {
      return;
    }

    state.historyHooksInstalled = true;
    state.historyChangeHandler = () => {
      onUrlMaybeChanged();
    };

    const wrapHistoryMethod = (name) => {
      const original = history[name];
      if (typeof original !== "function") {
        return;
      }

      state.originalHistoryMethods[name] = original;

      const wrapped = function (...args) {
        const result = original.apply(this, args);
        onUrlMaybeChanged();
        return result;
      };

      history[name] = wrapped;
    };

    wrapHistoryMethod("pushState");
    wrapHistoryMethod("replaceState");
    window.addEventListener("popstate", state.historyChangeHandler);
    window.addEventListener("hashchange", state.historyChangeHandler);
  }

  function uninstallHistoryHooks() {
    if (!state.historyHooksInstalled) {
      return;
    }

    if (state.originalHistoryMethods.pushState) {
      history.pushState = state.originalHistoryMethods.pushState;
    }

    if (state.originalHistoryMethods.replaceState) {
      history.replaceState = state.originalHistoryMethods.replaceState;
    }

    if (state.historyChangeHandler) {
      window.removeEventListener("popstate", state.historyChangeHandler);
      window.removeEventListener("hashchange", state.historyChangeHandler);
    }

    state.historyHooksInstalled = false;
    state.originalHistoryMethods = {};
    state.historyChangeHandler = null;
  }

  function onUrlMaybeChanged() {
    if (!state.enabled || !state.started) {
      return;
    }

    if (location.href === state.lastUrl) {
      return;
    }

    state.lastUrl = location.href;
    void translateDocumentTitle(true);
    collectTargets(document.body);
    scheduleFlush();
  }

  function handleMutations(mutations) {
    if (!state.enabled || !state.started) {
      return;
    }

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.removedNodes) {
          cleanupRemovedSubtree(node);
        }
      }

      if (mutation.type === "characterData") {
        if (consumeSuppressedTextMutation(mutation.target)) {
          continue;
        }
        queueTextNode(mutation.target);
        continue;
      }

      if (mutation.type === "attributes" && mutation.target instanceof Element) {
        if (consumeSuppressedAttributeMutation(mutation.target, mutation.attributeName)) {
          continue;
        }
        queueAttributes(mutation.target);
      }

      for (const node of mutation.addedNodes) {
        collectTargets(node);
      }
    }

    scheduleFlush();
  }

  function collectTargets(root) {
    if (!root) {
      return;
    }

    if (root.nodeType === Node.TEXT_NODE) {
      queueTextNode(root);
      return;
    }

    if (!(root instanceof Element)) {
      return;
    }

    if (shouldIgnoreElement(root)) {
      return;
    }

    queueAttributes(root);

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return shouldIgnoreElement(node)
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT;
          }

          const parent = node.parentElement;
          if (!parent || shouldIgnoreElement(parent)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let current;
    while ((current = walker.nextNode())) {
      if (current.nodeType === Node.TEXT_NODE) {
        queueTextNode(current);
      } else if (current instanceof Element) {
        queueAttributes(current);
      }
    }
  }

  function queueTextNode(node) {
    if (!(node instanceof Text)) {
      return;
    }

    if (!node.parentElement || shouldIgnoreElement(node.parentElement)) {
      return;
    }

    if (!normalizeText(node.data)) {
      return;
    }

    state.pendingTextNodes.add(node);
    state.trackedTextNodes.add(node);
  }

  function queueAttributes(element) {
    if (!(element instanceof Element) || shouldIgnoreElement(element)) {
      return;
    }

    for (const attrName of CONFIG.attributeNames) {
      const value = element.getAttribute(attrName);
      if (!value || !normalizeText(value)) {
        continue;
      }

      state.pendingAttrs.set(getAttrKey(element, attrName), { element, attrName });
      state.trackedElements.add(element);
    }
  }

  function scheduleFlush() {
    if (state.flushTimer) {
      return;
    }

    state.flushTimer = window.setTimeout(async () => {
      state.flushTimer = null;
      await flushPending();
      if (state.pendingTextNodes.size || state.pendingAttrs.size) {
        scheduleFlush();
      }
    }, CONFIG.mutationDebounceMs);
  }

  async function flushPending() {
    pruneDisconnectedTrackedReferences();

    const textNodes = Array.from(state.pendingTextNodes);
    const attrs = Array.from(state.pendingAttrs.values());

    state.pendingTextNodes.clear();
    state.pendingAttrs.clear();

    await runWithConcurrency(textNodes, CONFIG.workerConcurrency, processTextNode);
    await runWithConcurrency(attrs, CONFIG.workerConcurrency, processAttribute);
  }

  async function processTextNode(node) {
    if (!(node instanceof Text) || !node.isConnected || !node.parentElement) {
      return;
    }

    if (shouldIgnoreElement(node.parentElement)) {
      return;
    }

    const current = node.data;
    if (!normalizeText(current)) {
      return;
    }

    let nodeState = state.textStates.get(node);
    if (!nodeState || (current !== nodeState.original && current !== nodeState.lastApplied)) {
      nodeState = { original: current, lastApplied: current };
    }

    const translated = await translateText(nodeState.original);
    if (!state.enabled || !state.started || !node.isConnected) {
      return;
    }
    nodeState.lastApplied = translated;
    state.textStates.set(node, nodeState);

    if (node.data !== translated) {
      markSuppressedTextMutation(node);
      node.data = translated;
    }
  }

  async function processAttribute(item) {
    const { element, attrName } = item;
    if (!(element instanceof Element) || !element.isConnected || shouldIgnoreElement(element)) {
      return;
    }

    const current = element.getAttribute(attrName);
    if (!current || !normalizeText(current)) {
      return;
    }

    let attrStates = state.attrStates.get(element);
    if (!attrStates) {
      attrStates = {};
      state.attrStates.set(element, attrStates);
    }

    let attrState = attrStates[attrName];
    if (!attrState || (current !== attrState.original && current !== attrState.lastApplied)) {
      attrState = { original: current, lastApplied: current };
      attrStates[attrName] = attrState;
    }

    const translated = await translateText(attrState.original);
    if (!state.enabled || !state.started || !element.isConnected) {
      return;
    }
    attrState.lastApplied = translated;

    if (element.getAttribute(attrName) !== translated) {
      markSuppressedAttributeMutation(element, attrName);
      element.setAttribute(attrName, translated);
    }
  }

  async function translateDocumentTitle(forceReset = false) {
    if (!document.title) {
      return;
    }

    const current = document.title;
    if (!normalizeText(current)) {
      return;
    }

    if (
      forceReset ||
      !state.titleState ||
      (current !== state.titleState.original && current !== state.titleState.lastApplied)
    ) {
      state.titleState = {
        original: current,
        lastApplied: current,
      };
    }

    const translated = await translateText(state.titleState.original);
    if (!state.enabled || !state.started) {
      return;
    }
    state.titleState.lastApplied = translated;

    if (document.title !== translated) {
      state.suppressTitleMutation = true;
      document.title = translated;
    }
  }

  async function translateText(sourceText) {
    const normalized = normalizeText(sourceText);
    if (!normalized) {
      return sourceText;
    }

    const bundle = state.translationBundle;

    if (bundle.staticDict[normalized]) {
      return preserveEdgeWhitespace(sourceText, bundle.staticDict[normalized]);
    }

    const ruleBased = applyRegexRules(normalized, bundle.regexRules);
    if (ruleBased !== normalized) {
      return preserveEdgeWhitespace(sourceText, ruleBased);
    }

    return sourceText;
  }

  function applyRegexRules(text, rules) {
    let output = text;
    for (const { pattern, replacement } of rules) {
      output = output.replace(pattern, replacement);
    }
    return output;
  }

  function restoreAll() {
    state.started = false;
    state.pendingTextNodes.clear();
    state.pendingAttrs.clear();

    if (state.flushTimer) {
      window.clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    if (state.titleObserver) {
      state.titleObserver.disconnect();
      state.titleObserver = null;
    }

    uninstallHistoryHooks();

    for (const node of state.trackedTextNodes) {
      const nodeState = state.textStates.get(node);
      if (node instanceof Text && node.isConnected && nodeState?.original) {
        node.data = nodeState.original;
      }
    }

    for (const element of state.trackedElements) {
      const attrStates = state.attrStates.get(element);
      if (!(element instanceof Element) || !element.isConnected || !attrStates) {
        continue;
      }

      for (const [attrName, attrState] of Object.entries(attrStates)) {
        if (attrState?.original) {
          element.setAttribute(attrName, attrState.original);
        }
      }
    }

    if (state.titleState?.original) {
      document.title = state.titleState.original;
    }

    state.trackedTextNodes.clear();
    state.trackedElements.clear();
    state.suppressTitleMutation = false;
    state.suppressedTextMutations = new WeakSet();
    state.suppressedAttributeMutations = new WeakMap();
    state.titleState = null;
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }

    unregisterMenuCommands();

    state.menus.push(
      GM_registerMenuCommand(
        state.enabled ? "OpenRouter 中文化: 关闭" : "OpenRouter 中文化: 开启",
        async () => {
          state.enabled = !state.enabled;
          writeValue(STORAGE_KEYS.enabled, state.enabled);
          unregisterMenuCommands();
          registerMenuCommands();

          if (state.enabled) {
            initializeTranslationBundle()
              .then(() => start())
              .catch((err) => console.error("[openrouter-zh] Load failed:", err));
          } else {
            restoreAll();
          }
        }
      )
    );

    state.menus.push(
      GM_registerMenuCommand("OpenRouter 中文化: 重新加载本地词库并翻译当前页", async () => {
        if (!state.enabled) {
          return;
        }
        reloadTranslationsAndReapply();
      })
    );
  }

  function unregisterMenuCommands() {
    if (typeof GM_unregisterMenuCommand !== "function") {
      state.menus = [];
      return;
    }

    for (const id of state.menus) {
      try {
        GM_unregisterMenuCommand(id);
      } catch (_) {
        // Ignore incompatible managers.
      }
    }
    state.menus = [];
  }

  function readValue(key, fallbackValue) {
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallbackValue);
      }
    } catch (_) {
      // Fall through to localStorage.
    }

    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallbackValue : JSON.parse(raw);
    } catch (_) {
      return fallbackValue;
    }
  }

  function writeValue(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
        return;
      }
    } catch (_) {
      // Fall through to localStorage.
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      // Ignore persistence errors.
    }
  }

  function shouldIgnoreElement(element) {
    return !!(element && element.closest(CONFIG.ignoredSelectors));
  }

  function markSuppressedTextMutation(node) {
    state.suppressedTextMutations.add(node);
  }

  function consumeSuppressedTextMutation(node) {
    if (!state.suppressedTextMutations.has(node)) {
      return false;
    }

    state.suppressedTextMutations.delete(node);
    return true;
  }

  function markSuppressedAttributeMutation(element, attrName) {
    if (!attrName) {
      return;
    }

    let attrNames = state.suppressedAttributeMutations.get(element);
    if (!attrNames) {
      attrNames = new Set();
      state.suppressedAttributeMutations.set(element, attrNames);
    }

    attrNames.add(attrName);
  }

  function consumeSuppressedAttributeMutation(element, attrName) {
    if (!attrName) {
      return false;
    }

    const attrNames = state.suppressedAttributeMutations.get(element);
    if (!attrNames || !attrNames.has(attrName)) {
      return false;
    }

    attrNames.delete(attrName);
    if (!attrNames.size) {
      state.suppressedAttributeMutations.delete(element);
    }

    return true;
  }

  function cleanupRemovedSubtree(node) {
    if (!node) {
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      state.pendingTextNodes.delete(node);
      state.trackedTextNodes.delete(node);
      return;
    }

    if (!(node instanceof Element)) {
      return;
    }

    cleanupTrackedElement(node);

    const walker = document.createTreeWalker(
      node,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
    );

    let current;
    while ((current = walker.nextNode())) {
      if (current.nodeType === Node.TEXT_NODE) {
        state.pendingTextNodes.delete(current);
        state.trackedTextNodes.delete(current);
      } else if (current instanceof Element) {
        cleanupTrackedElement(current);
      }
    }
  }

  function cleanupTrackedElement(element) {
    state.trackedElements.delete(element);

    for (const [key, item] of state.pendingAttrs) {
      if (item.element === element) {
        state.pendingAttrs.delete(key);
      }
    }
  }

  function pruneDisconnectedTrackedReferences() {
    for (const node of state.pendingTextNodes) {
      if (!(node instanceof Text) || !node.isConnected) {
        state.pendingTextNodes.delete(node);
      }
    }

    for (const [key, item] of state.pendingAttrs) {
      if (!(item.element instanceof Element) || !item.element.isConnected) {
        state.pendingAttrs.delete(key);
      }
    }

    for (const node of state.trackedTextNodes) {
      if (!(node instanceof Text) || !node.isConnected) {
        state.trackedTextNodes.delete(node);
      }
    }

    for (const element of state.trackedElements) {
      if (!(element instanceof Element) || !element.isConnected) {
        state.trackedElements.delete(element);
      }
    }
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function preserveEdgeWhitespace(original, translated) {
    const prefix = String(original).match(/^\s*/)?.[0] || "";
    const suffix = String(original).match(/\s*$/)?.[0] || "";
    return `${prefix}${translated}${suffix}`;
  }

  function getAttrKey(element, attrName) {
    if (!state.elementIds.has(element)) {
      state.elementIds.set(element, state.nextElementId++);
    }
    return `${state.elementIds.get(element)}:${attrName}`;
  }

  function buildTranslationBundle(payload) {
    const navigation = Object.freeze(normalizeDictionary(payload?.navigation));
    const docs = Object.freeze(normalizeDictionary(payload?.docs));
    const marketing = Object.freeze(normalizeDictionary(payload?.marketing));
    const extraStatic = Object.freeze(normalizeDictionary(payload?.static));
    const staticDict = Object.freeze({
      ...navigation,
      ...docs,
      ...marketing,
      ...extraStatic,
    });
    const regexRules = Object.freeze(normalizeRegexRules(payload?.regexRules));

    return Object.freeze({
      navigation,
      docs,
      marketing,
      staticDict,
      regexRules,
    });
  }

  function normalizeDictionary(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return {};
    }

    const output = {};
    for (const [source, translated] of Object.entries(input)) {
      if (typeof source !== "string" || typeof translated !== "string") {
        continue;
      }

      const normalizedSource = normalizeText(source);
      if (!normalizedSource || !normalizeText(translated)) {
        continue;
      }

      output[normalizedSource] = translated;
    }
    return output;
  }

  function normalizeRegexRules(input) {
    if (!Array.isArray(input)) {
      return [];
    }

    const output = [];
    for (const item of input) {
      if (!item || typeof item.pattern !== "string" || typeof item.replacement !== "string") {
        continue;
      }

      try {
        output.push({
          pattern: new RegExp(item.pattern, typeof item.flags === "string" ? item.flags : ""),
          replacement: item.replacement,
        });
      } catch (error) {
        console.warn("[openrouter-zh] Invalid regex rule:", item, error);
      }
    }
    return output;
  }

  async function runWithConcurrency(items, limit, worker) {
    if (!items.length) {
      return;
    }

    let index = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index++];
        await worker(current);
      }
    });

    await Promise.all(runners);
  }
})();
