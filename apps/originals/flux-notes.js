// ==UserScript==
// @name         Flux-Notes
// @namespace    https://github.com/JYashu/flux-suite
// @version      7.0.0
// @description  A ubiquitous, theme-aware note-taking overlay. Features Markdown formatting, an HTML5 scratchpad, and cross-browser syncing via WebDAV/Github/Dropbox/OneDrive.
// @author       JYashu
// @license      Apache-2.0
// @icon         https://logo-bits.s3.us-east-2.amazonaws.com/quill.png
// @match        *://*/*
// @match        file:///*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @grant        GM_getResourceText
// @resource     easymdeCSS https://unpkg.com/easymde/dist/easymde.min.css
// @resource     faCSS https://maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @require      https://flux-suite.vercel.app/libs/flux-kit/sync.js
// @require      https://flux-suite.vercel.app/libs/flux-kit/scratchpad.js
// @require      https://unpkg.com/easymde/dist/easymde.min.js
// @run-at       document-idle
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      graph.microsoft.com
// @connect      login.microsoftonline.com
// @connect      my.microsoftpersonalcontent.com
// @connect      *
// ==/UserScript==
/* global FluxKit, EasyMDE */

(function () {
  /*
  * Copyright 2025-2026 JYashu
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  * http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  */
 
  'use strict';

  if (window !== window.top) return;

  const {
    createLogger, getUniqueId,
    makeElementDragAndResize, trapTabFocus,
    createHTMLElement, createSVGElement,
    safeHTML, withTTPatched
  } = FluxKit.utils;

  const{
    viewer: fluxViewer,
    initContextMenu, initNotification, initTooltips,
    createContextMenu, showNotification
  } = FluxKit.ui;

  const { logMessage, logError, logWarning, logDebug } = createLogger('FluxNotes');

  const mdRenderer = (() => {
    const sandbox = document.createElement('div');
    sandbox.style.display = 'none';
    document.body.appendChild(sandbox);

    const textArea = document.createElement('textarea');
    sandbox.appendChild(textArea);

    let headlessEditor;
    withTTPatched(() => {
      headlessEditor = new EasyMDE({
        element: textArea,
        status: false,
        toolbar: false,
        spellChecker: false
      });
    });

    return (text) => headlessEditor.options.previewRender(text, headlessEditor);
  })();

  fluxViewer.registerRenderer('md', mdRenderer);

  const STORAGE_KEY = 'flux_notes_config';

  const DEFAULT_SHORTCUT_KEYS = {
    add: 'Alt+A',
    view: 'Alt+V',
    settings: 'Alt+Backquote',
    toggleTheme: 'Alt+T',
    bookmarkNote: 'Alt+B',
    quickNote: 'Alt+Q'
  };

  const DEFAULT_CUSTOM_THEME = {
    name: 'Custom Theme',
    dark: true,
    bg: '#1e1e1e',
    text: '#eeeeee',
    inputBg: '#252529',
    accent: '#007bff',
    btnTextColor: '#ffffff'
  };

  const DEFAULT_CONFIG = {
    logging: false,
    profiles: [{ provider: 'Local', name: 'Default' }],
    currentProfile: 'Default',
    shortcuts: DEFAULT_SHORTCUT_KEYS,
    theme: 'auto',
    customTheme: DEFAULT_CUSTOM_THEME,
    lastSyncTime: '',
    notes: [],
    dockPosition: '20%',
    storageLimitMB: 20,
    quickNote: {
      title: 'Quick Note',
      description: '',
      pinned: false,
      lastEdited: new Date().toISOString()
    }
  };

  let config = initializeConfig();
  window.FluxNotes = config;

  function initializeConfig() {
    try {
      const saved = GM_getValue(STORAGE_KEY);
      if (!saved) {
        logMessage('No config found, initializing default');
        GM_setValue(STORAGE_KEY, DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG, };
      }
      return { ...DEFAULT_CONFIG, ...saved };
    } catch (e) {
      logError('Failed to read config, falling back to default:', e);
      GM_setValue(STORAGE_KEY, DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig(newConfig) {
    try {
      config = newConfig;
      const safeConfig = JSON.parse(JSON.stringify(config));

      GM_setValue(STORAGE_KEY, safeConfig);
      logMessage('Config saved successfully.');
    } catch (e) {
      logError('CRITICAL ERROR: Failed to save config. Your data contains unserializable items:', e, { __v: 1 });
      showNotification('Save failed: Data corruption detected.', { icon: UI_ICONS.error });
    }
  }

  GM_registerMenuCommand('Settings', () => openSettingsModal());

  const MAX_GIST_TOTAL_SIZE = config.storageLimitMB * 1024 * 1024;
  const DELETION_RETENTION_DAYS = 30;
  const NOTES_LOADING_BATCH_SIZE = 12;
  const MODAL_IDS = {
    NOTE: 'un-note-modal',
    VIEW: 'un-view-modal',
    SETTINGS: 'un-settings-modal',
    QUICK_NOTE: 'un-quick-note'
  };
  const SYNC_FREQUENCIES = {
    'Every 30 minutes': 30 * 60 * 1000,
    'Every 1 hour': 60 * 60 * 1000,
    'Every 3 hours': 3 * 60 * 60 * 1000,
    'Every 6 hours': 6 * 60 * 60 * 1000,
    'Every 12 hours': 12 * 60 * 60 * 1000,
    'Every day': 24 * 60 * 60 * 1000,
    'Never': 0,
  };
  const UI_ICONS = FluxKit.ui.icons;
  let isShorcutUpdating = false;
  let darkMode = false, tempThemeSwitch = false;
  let renderBatch = null, index = 0, filteredNotes = [], activeTagFilters = {};

  // ------------------------
  // Local Binary Storage (IndexedDB)
  // ------------------------
  const DB_NAME = 'FluxNotesDB';
  const STORE_UPLOADS = 'upload_queue';
  const STORE_CACHE = 'preview_cache';
  const DB_VERSION = 2;

  let dbPromise = null;

  function initLocalDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_UPLOADS)) db.createObjectStore(STORE_UPLOADS);
        if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function getAttachmentCacheKey(attachmentId) {
    return `${getCurrentProfileName() || 'default'}_${attachmentId}`;
  }

  // --- UPLOAD QUEUE ---
  async function queueAttachmentForUpload(attachmentId, blob) {
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_UPLOADS, 'readwrite');
      tx.objectStore(STORE_UPLOADS).put(blob, getAttachmentCacheKey(attachmentId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getQueuedUpload(attachmentId) {
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_UPLOADS, 'readonly').objectStore(STORE_UPLOADS).get(getAttachmentCacheKey(attachmentId));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function removeQueuedUpload(attachmentId) {
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_UPLOADS, 'readwrite');
      tx.objectStore(STORE_UPLOADS).delete(getAttachmentCacheKey(attachmentId));
      tx.oncomplete = () => resolve();
    });
  }

  // --- PREVIEW CACHE ---
  async function cacheAttachmentForPreview(attachmentId, blob) {
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, 'readwrite');
      tx.objectStore(STORE_CACHE).put({ blob, timestamp: Date.now() }, getAttachmentCacheKey(attachmentId));
      tx.oncomplete = () => {
        resolve();
        prunePreviewCache();
      }
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getCachedPreview(attachmentId) {
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_CACHE, 'readonly').objectStore(STORE_CACHE).get(getAttachmentCacheKey(attachmentId));
      req.onsuccess = () => {
        if (req.result) resolve(req.result.blob);
        else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function prunePreviewCache(maxItems = 30) {
    try {
      const db = await initLocalDB();
      const tx = db.transaction(STORE_CACHE, 'readwrite');
      const store = tx.objectStore(STORE_CACHE);
      const req = store.getAllKeys();

      req.onsuccess = async () => {
        const keys = req.result;
        if (keys.length > maxItems) {
          store.clear();
          logMessage("🧹 Cleared old preview cache to free up space.");
        }
      };
    } catch (e) {
      logWarning("Cache prune failed:", e);
    }
  }

  // ------------------------
  // CSS + Theme Engine
  // ------------------------
  const STATIC_MODAL_CSS = `
    /* =========================================================
       1. BASE VARIABLES & ANIMATIONS
       ========================================================= */
    :host {
      --un-radius-lg: 20px;
      --un-radius-md: 12px;
      --un-radius-sm: 8px;
      --un-shadow-float: 0 12px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.08);
      --un-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.05);
      --un-transition: 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      --un-spacing-xs: 5px;
      --un-spacing-sm: 8px;
      --un-spacing-md: 12px;
      --un-bg-card: rgba(128,128,128,0.03);
      --un-bg-card-hover: rgba(128,128,128,0.05);
    }
    @keyframes un-fade-in { to { opacity: 1; } }

    /* =========================================================
       2. MODAL CONTAINERS & LAYOUT
       ========================================================= */
    dialog.un-modal {
      margin: 0 !important;
      border: 1px solid var(--un-border) !important;
      position: fixed !important;
      top: 15vh;
      left: 27.6vw;
      width: 30vw;
      max-width: calc(100vw - 40px);
      max-height: 80vh;
      box-sizing: border-box;
      padding: 24px;
      opacity: 0;
      transform: scale(0.96);
      transition: opacity 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
      display: flex;
      flex-direction: column;
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      &::backdrop {
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(3px);
      }
    }
    .un-modal { box-sizing: border-box; opacity: 0; transform: scale(0.96); transition: opacity 0.2s ease, transform 0.2s ease; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
    .un-modal.show { opacity: 1; transform: scale(1); }
    .un-modal-header { box-sizing: border-box; flex: 0 0 auto; font-size: 18px; font-weight: bold; margin-bottom: 15px; margin-top: 0px; width: fit-content; }
    .un-modal-content { box-sizing: border-box; flex: 1 1 auto; display: flex; flex-direction: column; position: relative; min-height: 0; overflow-y: auto; overflow-x: hidden; height: 100%; }
    .un-modal-footer { box-sizing: border-box; flex: 0 0 auto; display: flex; justify-content: end; gap: 8px; text-align: right; margin-top: 15px; }
    .un-empty-state {
      grid-column: 1 / -1;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 60px 20px; text-align: center; color: #777; opacity: 0;
      animation: un-fade-in 0.5s forwards 0.2s;
    }

    /* =========================================================
       3. FORMS, ROWS & ACCORDIONS
       ========================================================= */
    .un-form-row {
      display: grid; grid-template-columns: 150px 1fr; align-items: center;
      gap: var(--un-spacing-md); margin-bottom: var(--un-spacing-sm); margin-top: var(--un-spacing-sm); width: 100%;
    }
    .un-form-label { font-size: 14px; font-weight: 500; opacity: 0.85; white-space: nowrap; }
    .un-profile-btn-row { flex: 0 0 auto; display: flex; justify-content: end; gap: 8px; text-align: right; margin-bottom: 15px; }
    .un-profile-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; margin-bottom: var(--un-spacing-md); }
    .un-modal input:not([type="checkbox"]), .un-modal select, .un-modal button {
      height: 30px !important; margin: 0 !important; box-sizing: border-box !important;
    }

    .un-modal details { background: transparent !important; border: none !important; padding: 0 !important; margin-top: var(--un-spacing-sm); margin-bottom: var(--un-spacing-lg); }
    .un-modal summary {
      font-size: 16px !important; font-weight: 600 !important; cursor: pointer; outline: none; list-style: none;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 0 var(--un-spacing-sm) 0 !important; margin: 0 0 var(--un-spacing-md) 0 !important;
      border-bottom: 2px solid var(--un-border, rgba(128,128,128,0.15)) !important; user-select: none; transition: color 0.2s ease;
    }
    .un-modal summary::-webkit-details-marker { display: none; }
    .un-modal summary::after { content: '▼'; font-size: 11px; opacity: 0.4; transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .un-modal details[open] summary::after { transform: rotate(-180deg); }
    .un-modal details[open] summary { border-bottom: 1px solid var(--un-border, rgba(128,128,128,0.1)); margin-bottom: var(--un-spacing-sm); padding-bottom: var(--un-spacing-sm); }
    .un-modal summary:hover { opacity: 0.8; }

    /* =========================================================
       4. VIEW CONTROLS & TAGS (Static)
       ========================================================= */
    .un-view-controls { display: flex; gap: var(--un-spacing-md); margin-bottom: var(--un-spacing-sm); align-items: center; width: 100%; }
    .un-search-wrapper { flex: 1 1 auto; }
    .un-sort-wrapper { flex: 0 0 auto; display: flex; align-items: center; gap: var(--un-spacing-xs); font-size: 14px; font-weight: 500; white-space: nowrap; }
    #un-tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: var(--un-spacing-md) !important; }
    .un-tag-chip {
      background: var(--un-bg-secondary, rgba(128,128,128,0.08)) !important;
      border: 1px solid var(--un-border, rgba(128,128,128,0.15)) !important;
      color: inherit !important; padding: 4px 12px !important; border-radius: 16px !important;
      font-size: 12px !important; font-weight: 500 !important; transition: all 0.2s ease !important;
    }
    .un-tag-chip:hover {
      background: var(--un-bg-hover, rgba(128,128,128,0.15)) !important;
      border-color: var(--accentBg, #007bff) !important;
      transform: translateY(-1px) !important;
    }

    /* =========================================================
       5. NOTE CARDS & ACTIONS (Static/Legacy)
       ========================================================= */
    #un-notes-list > .note-container {
      background: var(--un-bg-card, rgba(128,128,128,0.02)) !important;
      border: 1px solid var(--un-border, rgba(128,128,128,0.15)) !important;
      border-radius: var(--un-radius-md) !important; padding: 10px !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.02) !important; display: flex; flex-direction: row; gap: 8px; top: 0;
      transition: top 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease !important;
    }
    #un-notes-list > .note-container:hover {
      top: -2px !important; box-shadow: 0 12px 24px rgba(0,0,0,0.08) !important;
      border-color: var(--accentBg, #007bff) !important; background: var(--un-bg-card-hover, rgba(128,128,128,0.05)) !important;
    }
    .note-container .note-title { font-size: 15px; font-weight: 600; line-height: 1.3; }
    .note-container > div > div:nth-child(2) { font-size: 11px !important; opacity: 0.6; margin-top: 2px; }

    .un-note-card { position: relative; overflow: hidden; }
    .un-note-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 5px; opacity: 0; transform: translateY(-10px); transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94); }
    .un-note-card:hover .un-note-actions { opacity: 1; transform: translateY(0); }
    .un-action-btn { background: rgba(255, 255, 255, 0.9); border: 1px solid #ddd; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #444; box-shadow: 0 2px 4px rgba(0,0,0,0.1); font-size: 12px; }
    .un-action-btn:hover { background: var(--accentBg, #007bff); color: #fff; border-color: transparent; }

    /* =========================================================
       6. SCREENSHOT PREVIEWS & ICONS
       ========================================================= */
    .un-icon-btn { width: 30px !important; height: 30px !important; padding: 0 !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; }
    .un-icon-btn svg { display: block; }
    .un-note-screenshot { max-width: 108px; max-height: 80px; border-radius: 6px; border: 1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: transform 0.2s ease, box-shadow 0.2s ease; margin-top: 2.91px; flex-shrink: 0; }
    .un-note-screenshot:hover { transform: scale(1.05); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    #un-screenshot-backdrop { pointer-events: auto; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 99999; }
    #un-screenshot-preview { pointer-events: auto; border-radius: 10px; box-shadow: 0 6px 30px rgba(0,0,0,0.4); width: auto; height: auto; max-width: 95vw; max-height: 90vh; object-fit: contain; cursor: auto; transition: width 0.25s ease, height 0.25s ease; }

    /* =========================================================
       7. Custom Theme Color Pickers
       ========================================================= */
    .un-modal input[type="color"].un-color-picker {
      width: 28px !important;
      height: 28px !important;
      min-height: 28px !important; /* Overrides the global 38px */
      flex: 0 0 28px !important;   /* Absolutely prevents flexbox stretching */
      padding: 0 !important;
      margin: 0 !important;
      border: 1px solid var(--un-border, rgba(128,128,128,0.2)) !important;
      border-radius: 50% !important;
      cursor: pointer;
      background: transparent !important;
      box-shadow: none !important;
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      transition: transform 0.2s ease, box-shadow 0.2s ease !important;
    }

    .un-modal input[type="color"].un-color-picker::-webkit-color-swatch-wrapper {
      padding: 0;
    }
    .un-modal input[type="color"].un-color-picker::-webkit-color-swatch {
      border: none;
      border-radius: 50%;
    }
    .un-modal input[type="color"].un-color-picker::-moz-color-swatch {
      border: none;
      border-radius: 50%;
    }

    .un-modal input[type="color"].un-color-picker:hover {
      transform: scale(1.15);
      box-shadow: var(--un-shadow-sm) !important;
    }
    #un-custom-theme-panel {
      padding: 12px 16px;
      background: var(--un-bg-card, rgba(128,128,128,0.03));
      border: 1px solid var(--un-border, rgba(128,128,128,0.1));
      border-radius: var(--un-radius-sm);
      margin-top: 12px;

      display: flex;
      flex-direction: row;
      justify-content: space-around; /* Distributes the dots evenly */
      align-items: center;
      gap: 8px;
      transition: opacity 0.3s ease;
    }

    .un-color-item {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      cursor: pointer;
    }

    .un-color-item .un-form-label {
      font-size: 12px; /* Slightly smaller for a tighter fit */
      margin: 0;
      white-space: nowrap;
    }

    .un-color-picker {
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      width: 28px !important; /* Scaled down from 38px */
      height: 28px !important;
      padding: 0 !important;
      border: 1px solid var(--un-border, rgba(128,128,128,0.2)) !important;
      border-radius: 50% !important;
      cursor: pointer;
      background: transparent;
      flex-shrink: 0;
      transition: transform 0.2s ease, box-shadow 0.2s ease !important;
    }

    .un-color-picker::-webkit-color-swatch-wrapper { padding: 0; }
    .un-color-picker::-webkit-color-swatch { border: none; border-radius: 50%; }
    .un-color-picker::-moz-color-swatch { border: none; border-radius: 50%; }

    .un-color-picker:hover {
      transform: scale(1.15);
      box-shadow: var(--un-shadow-sm);
    }
  `;

  /**
   * Darkens a color by a percentage (0-100)
   * @param {string} color - Hex or RGB color
   * @param {number} percent - Percentage to darken (e.g., 10)
   */
  const darken = FluxKit.theme.darken;
  const { isSiteDark, getSiteStyles, get: getTheme, presets: fluxPresets } = FluxKit.theme;

  const THEME_PRESETS = {
    auto: { name: 'Auto (Site Match)', dark: null },
    ...fluxPresets,
    custom: config.customTheme,
  };

  const TAG_COLORS = [
    '#f94144', '#f3722c', '#f9c74f', '#90be6d',
    '#43aa8b', '#577590', '#9d4edd', '#ff6d00'
  ];

  let activeThemeBridge = {};

  function injectDynamicModalStyles({ fontFamily, accentBg, accentText, btnTextColor, bg, text, inputBg }) {
    const glassBg = bg && bg.length === 7 ? bg + 'E6' : bg;

    const style = `
      /* =========================================================
         1. MODALS & CONTAINERS
         ========================================================= */
      #${MODAL_IDS.NOTE}, #${MODAL_IDS.VIEW}, #${MODAL_IDS.SETTINGS},
      #${MODAL_IDS.QUICK_NOTE}, #un-merge-tags-modal {
        position: fixed;
        background: ${glassBg};
        color: ${text};
        font-family: ${fontFamily};
        backdrop-filter: blur(10px) saturate(180%);
        -webkit-backdrop-filter: blur(10px) saturate(180%);
        border: 1px solid ${darkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)'} !important;
        box-shadow: ${darkMode ? '0 12px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1) inset' : '0 12px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.5) inset'} !important;
        transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
      }
      #${MODAL_IDS.NOTE}, #${MODAL_IDS.SETTINGS}, #${MODAL_IDS.QUICK_NOTE}, #un-merge-tags-modal { left: 35vw; }
      #${MODAL_IDS.SETTINGS} { overflow: visible; }
      #${MODAL_IDS.VIEW} { padding: 24px; border-radius: 12px; width: 45vw; height: 70vh; display: flex; flex-direction: column; }
      #${MODAL_IDS.NOTE} .un-modal-content { display: flex; flex-direction: column; gap: 10px; }
      .un-modal-close-btn { position: absolute !important; top: 16px !important; right: 16px !important; width: 28px !important; height: 28px !important; background: transparent !important; border: none !important; box-shadow: none !important; color: ${text} !important; opacity: 0.5; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50% !important; padding: 0 !important; z-index: 10; transition: all 0.2s ease !important; }
      .un-modal-close-btn:hover { opacity: 1 !important; transform: rotate(90deg) scale(1.1) !important; }

      /* =========================================================
         2. FORMS & INPUTS
         ========================================================= */
      /* CRITICAL FIX: Added :not(#un-tag-input) to prevent double borders inside the tag wrapper */
      #${MODAL_IDS.NOTE} input:not([type="checkbox"]):not(.CodeMirror-search-field):not(#un-tag-input),
      #${MODAL_IDS.NOTE} textarea:not(.CodeMirror textarea):not([style*="display: none"]),
      #${MODAL_IDS.NOTE} select,
      #${MODAL_IDS.SETTINGS} input:not([type="checkbox"]), #${MODAL_IDS.SETTINGS} textarea, #${MODAL_IDS.SETTINGS} select,
      #${MODAL_IDS.VIEW} input:not([type="checkbox"]), #${MODAL_IDS.VIEW} textarea, #${MODAL_IDS.VIEW} select,
      #un-merge-tags-modal input:not([type="checkbox"]), #un-merge-tags-modal textarea, #un-merge-tags-modal select,
      #${MODAL_IDS.QUICK_NOTE} input:not([type="checkbox"]), #${MODAL_IDS.QUICK_NOTE} textarea, #${MODAL_IDS.QUICK_NOTE} select {
        background: ${inputBg} !important; color: ${text} !important; border: 1px solid ${accentBg} !important;
        width: 100% !important; padding: 6px !important; margin-bottom: 8px !important;
        border-radius: 4px !important; box-sizing: border-box !important; font-family: ${fontFamily};
      }
      .un-modal input:focus, .un-modal textarea:focus, .un-modal select:focus,
      .un-tag-input-wrapper:focus-within, .EasyMDEContainer .CodeMirror.CodeMirror-focused {
        outline: none !important; box-shadow: 0 0 0 1px ${accentBg} inset !important;
      }
      #${MODAL_IDS.SETTINGS} input[type="checkbox"] { transform: scale(1.2); margin-right: 8px; accent-color: ${accentBg}; }

      /* =========================================================
         3. BUTTONS & LINKS
         ========================================================= */
      #${MODAL_IDS.NOTE} button, #${MODAL_IDS.VIEW} button, #${MODAL_IDS.SETTINGS} button,
      #${MODAL_IDS.QUICK_NOTE} button, #un-merge-tags-modal button,
      #un-notes-list > .note-container, .un-tag-chip {
        transition: background 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease; cursor: pointer; border-radius: 6px;
      }
      #${MODAL_IDS.NOTE} button, #${MODAL_IDS.VIEW} button, #${MODAL_IDS.SETTINGS} button,
      #${MODAL_IDS.QUICK_NOTE} button, #un-merge-tags-modal button {
        padding: 6px 12px; background: linear-gradient(135deg, ${accentBg}, ${darken(accentBg, 10)});
        color: ${btnTextColor}; font-family: ${fontFamily}; position: relative; overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
      #${MODAL_IDS.NOTE} button:hover, #${MODAL_IDS.VIEW} button:hover, #${MODAL_IDS.SETTINGS} button:hover,
      #${MODAL_IDS.QUICK_NOTE} button:hover, #un-merge-tags-modal button:hover {
        transform: scale(1.03); box-shadow: ${darkMode ? '0 4px 10px rgba(255,255,255,0.15)' : '0 4px 10px rgba(0,0,0,0.15)'};
      }
      #${MODAL_IDS.NOTE} button:active, #${MODAL_IDS.VIEW} button:active, #${MODAL_IDS.SETTINGS} button:active,
      #${MODAL_IDS.QUICK_NOTE} button:active, #un-merge-tags-modal button:active {
        transform: scale(0.97); box-shadow: ${darkMode ? '0 2px 6px rgba(255,255,255,0.1)' : '0 2px 6px rgba(0,0,0,0.1)'};
      }
      .un-modal a:not(.button-like):not([class*="btn"]) { color: ${accentText}; text-decoration: underline; cursor: pointer; font-family: ${fontFamily}; }
      .un-modal a:hover { opacity: 0.85; }

      /* =========================================================
         4. NOTE CARDS & ACTIONS
         ========================================================= */
      .un-notes-list-wrapper { display: block; flex-direction: column; position: relative; height: auto !important; overflow: visible !important; padding-top: 10px; }
      #un-notes-list {
        height: auto; max-height: none !important; overflow: visible !important; display: block !important; padding-bottom: var(--un-spacing-lg) !important;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); grid-auto-rows: min-content; gap: 16px; overscroll-behavior: contain; padding-right: 8px; scrollbar-width: thin; scrollbar-color: ${inputBg} ${bg};
      }
      #un-notes-list::-webkit-scrollbar { width: 8px; }
      #un-notes-list::-webkit-scrollbar-track { background: ${bg}; }
      #un-notes-list::-webkit-scrollbar-thumb { background: ${inputBg}; border-radius: 4px; border: 1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}; }

      #un-notes-list > .note-container {
        height: auto; align-self: start; justify-self: stretch; display: flex; align-items: flex-start;
        position: relative; cursor: pointer; padding: 10px; border-radius: 6px;
        border-left: 4px solid ${inputBg}; border-bottom: 1px solid ${inputBg};
        transition: background-color 0.1s ease-in-out, opacity 0.25s ease, transform 0.25s ease;
        opacity: 0; transform: translateY(6px); will-change: opacity, transform;
      }
      #un-notes-list > .note-container.show { opacity: 1; transform: translateY(0); }
      #un-notes-list > .note-container:hover { background-color: ${inputBg}; }
      #un-notes-list > .note-container:active { background-color: ${inputBg}; transform: scale(0.97); }
      #un-notes-list > .note-container.pinned { border-left: 4px solid ${accentBg} !important; background-color: ${darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)'} !important; }

      .un-note-actions-wrapper {
        position: absolute; bottom: 0px; right: 0px; display: flex; flex-direction: row; gap: 4px;
        padding: 6px 2px; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; z-index: 10; border-radius: 14px;
      }
      .un-icon-action-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; border-radius: 50%; color: ${text}; opacity: 0.6; background: transparent; transition: all 0.15s ease; }
      .un-icon-action-btn:hover { opacity: 1; background: ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}; }
      .un-icon-action-btn.pinned-active:hover { color: #e53935; }
      .un-icon-action-btn.trash-btn:hover { color: #e53935; background: rgba(229, 57, 53, 0.15); }

      /* =========================================================
         5. TAG SYSTEM
         ========================================================= */
      .un-tag-input-wrapper { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px; background: ${inputBg}; border: 1px solid ${accentBg}; border-radius: 4px; cursor: text; min-height: 36px; box-sizing: border-box; }
      .un-tag-input-wrapper input { border: none !important; background: transparent !important; width: auto !important; flex-grow: 1; min-width: 80px; margin: 0 !important; padding: 0 !important; box-shadow: none !important; color: inherit !important; }
      .un-tag-chip { background: ${bg}; color: ${text}; padding: 4px 8px; border-radius: 12px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}; width: max-content; }
      .un-tag-chip:hover { filter: brightness(1.15); transform: scale(1.05); box-shadow: 0 2px 6px rgba(0,0,0,0.1); }
      .un-tag-chip:active { transform: scale(0.97); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      .un-tag-chip mark { background: #ffe066; padding: 0; }
      .un-tag-chip.include { background: ${accentBg} !important; color: ${btnTextColor} !important; border-color: ${darken(accentBg, 15)} !important; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
      .un-tag-chip.exclude { background: transparent !important; color: ${accentBg} !important; border: 1px dashed ${accentBg} !important; text-decoration: line-through; opacity: 0.6; }

      /* =========================================================
         6. NOTIFICATIONS
         ========================================================= */
      .un-notification { background: ${bg}; color: ${text}; border: 1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'}; }
      .un-notification-action { background: ${accentBg} !important; color: ${btnTextColor} !important; border: none !important; }

      /* =========================================================
         7. EASYMDE EDITOR
         ========================================================= */
      .icon-svg-fallback { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; pointer-events: none; }
      .icon-svg-fallback svg { width: 100%; height: 100%; vector-effect: non-scaling-stroke; }
      .EasyMDEContainer .editor-toolbar {
        background: ${inputBg} !important;
        border: 1px solid ${accentBg} !important;
        border-top-left-radius: 4px !important;
        border-top-right-radius: 4px !important;
        opacity: 1 !important;
        padding: 4px 6px !important; /* Natural padding */
      }
      .EasyMDEContainer .editor-toolbar button {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        min-height: 28px;
        padding: 0 !important;
        margin: 2px !important;
      }
      .EasyMDEContainer .editor-toolbar i.separator {
        display: inline-block;
        margin: 0 4px;
        border-right: 1px solid ${darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'} !important;
        width: 0;
        text-indent: -9999px;
        height: 18px;
        vertical-align: middle;
      }

      .EasyMDEContainer .editor-toolbar button, .EasyMDEContainer .editor-toolbar button i.fa, .EasyMDEContainer .editor-toolbar button svg,
      .editor-toolbar button i, .editor-toolbar button::before {
        color: ${text} !important; background: transparent !important; border: 1px solid transparent !important;
      }
      .EasyMDEContainer .editor-toolbar button.active, .EasyMDEContainer .editor-toolbar button:hover {
        background: ${bg} !important; border-color: ${darkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'} !important;
      }
      .EasyMDEContainer .editor-toolbar button.active i.fa, .EasyMDEContainer .editor-toolbar button:hover i.fa,
      .EasyMDEContainer .editor-toolbar button.active i, .EasyMDEContainer .editor-toolbar button:hover i,
      .EasyMDEContainer .editor-toolbar button.active svg, .EasyMDEContainer .editor-toolbar button:hover svg {
        color: ${accentText} !important;
      }
      .EasyMDEContainer .editor-toolbar button.disabled-for-preview { opacity: 0.4 !important; }

      .EasyMDEContainer .CodeMirror {
        background: ${inputBg} !important;
        color: ${text} !important;
        border: 1px solid ${accentBg} !important;
        border-top: none !important;
        border-bottom-left-radius: 4px !important;
        border-bottom-right-radius: 4px !important;
        margin: 0 !important; font-family: inherit !important;
      }
      .EasyMDEContainer .CodeMirror-scroll { min-height: 200px !important; max-height: 40vh !important; }
      .EasyMDEContainer .CodeMirror-cursor { border-left: 2px solid ${text} !important; }
      .EasyMDEContainer .editor-statusbar { color: ${text} !important; opacity: 0.7; }

      .un-modal.un-fullscreen-active {
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        border-radius: 0 !important;
        padding: 0 !important;
        border: none !important;
        transform: none !important;
        box-shadow: none !important;
        background: ${bg} !important;
      }
      .un-modal.un-fullscreen-active .un-header-wrapper,
      .un-modal.un-fullscreen-active .un-modal-footer,
      .un-modal.un-fullscreen-active .un-tag-input-wrapper,
      .un-modal.un-fullscreen-active #un-note-url,
      .un-modal.un-fullscreen-active .un-modal-close-btn {
        display: none !important; /* Hide other modal elements to give editor full focus */
      }
      .un-modal.un-fullscreen-active .un-modal-content {
        padding: 0 !important;
        height: 100% !important;
        gap: 0 !important;
        overflow: hidden !important;
      }
      .un-modal.un-fullscreen-active .EasyMDEContainer {
        height: 100% !important;
      }
      .un-modal.un-fullscreen-active .CodeMirror-fullscreen,
      .un-modal.un-fullscreen-active .editor-preview-side {
        top: 50px !important; /* Offset for the toolbar height */
        height: calc(100vh - 50px) !important;
        box-sizing: border-box !important;
      }
      .un-modal.un-fullscreen-active .editor-toolbar.fullscreen {
        width: 100vw !important;
        box-sizing: border-box !important;
        padding-top: 10px !important;
      }
      .un-modal.un-fullscreen-active .CodeMirror-scroll {
        max-height: none !important;
      }

      .EasyMDEContainer .editor-preview,
      .EasyMDEContainer .editor-preview-side {
        background: ${bg} !important;
        color: ${text} !important;
        border: 1px solid ${accentBg} !important;
        box-sizing: border-box !important;
        padding: 10px 14px !important; /* Tighter container padding */
        line-height: 1.4 !important; /* Slightly condensed line height */
        font-size: 14px !important; /* Standardized base size */
      }
      .EasyMDEContainer .editor-preview {
        border-top: none !important;
      }
      .editor-preview p, .editor-preview-side p {
        margin: 0.5em 0 !important; /* Halved vertical margins */
      }

      .editor-preview h1, .editor-preview-side h1,
      .editor-preview h2, .editor-preview-side h2,
      .editor-preview h3, .editor-preview-side h3,
      .editor-preview h4, .editor-preview-side h4 {
        margin-top: 1em !important;
        margin-bottom: 0.4em !important;
        line-height: 1.2 !important;
      }
      .editor-preview h1, .editor-preview-side h1 { font-size: 1.4em !important; }
      .editor-preview h2, .editor-preview-side h2 { font-size: 1.2em !important; }
      .editor-preview h3, .editor-preview-side h3 { font-size: 1.1em !important; }
      .editor-preview h4, .editor-preview-side h4 { font-size: 1em !important; }
      .editor-preview ul, .editor-preview-side ul {
        list-style: disc outside !important;
        padding-left: 1.5em !important; /* Shallower indentation */
        margin: 0.5em 0 !important;
        display: block !important;
      }
      .editor-preview ol, .editor-preview-side ol {
        list-style: decimal outside !important;
        padding-left: 1.5em !important;
        margin: 0.5em 0 !important;
        display: block !important;
      }
      .editor-preview li, .editor-preview-side li {
        display: list-item !important;
        margin-bottom: 0.2em !important; /* Tighter spacing between items */
      }
      .editor-preview input[type="checkbox"], .editor-preview-side input[type="checkbox"] {
        appearance: checkbox !important;
        -webkit-appearance: checkbox !important;
        display: inline-block !important;
        width: auto !important;
        height: auto !important;
        margin-right: 6px !important;
        margin-left: -2px !important;
        opacity: 1 !important;
        cursor: pointer !important;
        vertical-align: baseline !important;
        position: relative !important;
        top: 1px !important;
      }

      .editor-preview a, .editor-preview-side a {
        cursor: pointer !important;
        color: ${accentText} !important;
        text-decoration: none !important;
      }
      .editor-preview a:hover, .editor-preview-side a:hover {
        text-decoration: underline !important;
      }

      /* =========================================================
         8. EDGE DOCK
         ========================================================= */
      #un-edge-dock {
        pointer-events: auto; position: fixed; right: 0; top: 50%; transform: translateY(-50%);
        width: 6px; height: 100px; background: ${accentBg.length === 7 ? accentBg + 'B3' : accentBg};
        backdrop-filter: blur(6px) saturate(150%); -webkit-backdrop-filter: blur(6px) saturate(150%);
        border: 1px solid ${darkMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)'};
        border-right: none; border-radius: 6px 0 0 6px; cursor: grab; z-index: 999999;
        transition: width 0.2s ease, opacity 0.2s ease, background 0.2s ease;
        box-shadow: -2px 0 12px rgba(0,0,0,0.25), inset 1px 0 2px rgba(255,255,255,0.2); opacity: 0.85;
      }
      #un-edge-dock:hover { width: 14px; opacity: 1; background: ${darken(accentBg, 10)}; }
      #un-edge-dock:active { cursor: grabbing; }
      #un-sync-indicator {
        position: absolute; left: -16px; top: -2px; width: 18px; height: 18px; background: ${accentBg};
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        /* Hidden state */
        opacity: 0; visibility: hidden; transform: translateY(-50%) scale(0.5);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: -2px 2px 8px rgba(0,0,0,0.3); cursor: help; color: white;
      }
      #un-sync-indicator.active { opacity: 1; visibility: visible; transform: translateY(-50%) scale(1); }
      #un-sync-indicator svg { width: 10px; height: 10px; fill: currentColor; animation: un-spin 1.5s linear infinite; }
      @keyframes un-spin { 100% { transform: rotate(360deg); } }
    `;

    let styleEl = getAppRoot().querySelector('#un-dynamic-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'un-dynamic-styles';
      getAppRoot().appendChild(styleEl);
    }
    styleEl.textContent = style;
  }

  function applyTheme(theme) {
    if (theme) {
      config.theme = theme;
      saveConfig(config);
    }

    const themeKey = config.theme || 'auto';
    let stylePayload = {};

    if (themeKey === 'auto') {
      darkMode = isSiteDark(null, false);
      const siteStyles = getSiteStyles({
        isDark: darkMode,
        ignoreSelector: '#un-shadow-host'
      });
      stylePayload = { ...siteStyles, darkMode };
    } else {
      const preset = getTheme(themeKey);
      darkMode = preset.dark;
      stylePayload = {
        ...getTheme(themeKey), darkMode, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      };
    }

    activeThemeBridge = {
      borderRadius: '6px',
      ...stylePayload
    };

    if (window.activeUnSyncWizard) {
      window.activeUnSyncWizard.updateTheme(activeThemeBridge);
    }
    if (window.activeUnSyncEditor) {
      window.activeUnSyncEditor.updateTheme(activeThemeBridge);
    }
    if (window.activeUnPadInstance) {
       window.activeUnPadInstance.updateTheme(activeThemeBridge);
   }
    if (typeof fluxViewer !== 'undefined' && fluxViewer) {
      fluxViewer.updateTheme(stylePayload);
    }

    const rootElement = getAppRoot();
    initNotification({
      ...stylePayload,
      rootElement,
      position: 'top-center'
    });

    initContextMenu({
      ...stylePayload,
      rootElement,
      bg: stylePayload.bg.length > 7 ? stylePayload.bg.slice(0, -2) : stylePayload.bg,
    });

    initTooltips({
      ...stylePayload,
      rootElement,
      border: `1px solid ${stylePayload.accentBg}`,
      delay: 500
    });

    injectDynamicModalStyles(stylePayload);
  }

  function getTagColor(tag) {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
  }

  // ------------------------
  // Actions + Helpers
  // ------------------------
  function debounce(fn, delay = 300) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  }

  let unAppRoot = null;

  function getAppRoot() {
    if (unAppRoot) return unAppRoot;

    const host = document.createElement('div');
    host.id = 'un-shadow-host';

    host.style.all = 'initial';
    host.style.display = 'block';
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '100vw';
    host.style.height = '100vh';
    host.style.zIndex = '2147483647';

    host.style.pointerEvents = 'none';

    document.body.appendChild(host);

    unAppRoot = host.attachShadow({ mode: 'open' });

    const staticStyle = document.createElement('style');
    staticStyle.id = 'un-static-styles';

    staticStyle.textContent = `
      dialog { pointer-events: auto; }
      ${STATIC_MODAL_CSS}
    `;
    unAppRoot.appendChild(staticStyle);

    return unAppRoot;
  }

  fluxViewer.init({
    rootElement: getAppRoot(),
    icons: {
      close: UI_ICONS.close,
      download: UI_ICONS.import,
      file: UI_ICONS.document,
    }
  });

  const unQuery = (selector) => getAppRoot().querySelector(selector);
  const unQueryAll = (selector) => getAppRoot().querySelectorAll(selector);

  const $ = (id) => unQuery(`#${id}`);

  function waitForBody(callback, retries = 10) {
    if (document.body) {
      callback();
    } else if (retries > 0) {
      setTimeout(() => waitForBody(callback, retries - 1), 300);
    }
  }

  const generateId = () => 'note-' + getUniqueId();

  function migrateNoteFormat(notes) {
    let migrated = false;
    notes.forEach(note => {
      // Migrate old screenshot properties to the attachments array
      if ((note.hasImage || note.screenshot || note.imageFile) && !note.attachments) {
        note.attachments = [];
        if (note.imageFile || note.screenshot) {
          note.attachments.push({
            id: 'att-' + getUniqueId(),
            filename: 'screenshot.png',
            type: 'image/png',
            size: note.screenshot ? Math.round(note.screenshot.length * 0.75) : 0,
            providerStorage: 'base64',
            storagePath: null,
            thumbnailFile: note.imageFile || 'images_1.json',
            data: note.screenshot || null
          });
        }
        delete note.hasImage;
        delete note.imageFile;
        delete note.screenshot;
        migrated = true;
      }
      if (!note.attachments) {
        note.attachments = [];
        migrated = true;
      }
    });
    return migrated;
  }

  const getNotes = () => {
    const notes = config.notes || [];
    if (migrateNoteFormat(notes)) saveConfig(config);
    return notes;
  };

  function saveNote(note) {
    const notes = getNotes();
    const existingIndex = notes.findIndex(n => n.id === note.id);
    const now = new Date().toISOString();
    if (existingIndex !== -1) {
      note.updatedAt = now;
      notes[existingIndex] = { ...notes[existingIndex], ...note };
    } else {
      note.createdAt = note.createdAt || now;
      note.updatedAt = now;
      notes.push(note);
    }
    config.notes = notes;
    saveConfig(config);
    triggerBackgroundSync();
  }

  function applyMasonryLayout(container, minColumnWidth = 320, gap = 16) {
    if (!container) return;

    const items = Array.from(container.children);
    if (!items.length) return;

    const containerWidth = container.clientWidth;
    const columnCount = Math.max(1, Math.floor(containerWidth / (minColumnWidth + gap)));
    const columnHeights = Array(columnCount).fill(0);

    container.style.position = 'relative';
    container.style.height = 'auto';

    items.forEach((item) => {
      item.style.position = 'absolute';
      item.style.boxSizing = 'border-box';
      item.style.minHeight = '72px';
      item.style.width = `calc((100% - ${gap * (columnCount - 1)}px) / ${columnCount})`;

      const minCol = columnHeights.indexOf(Math.min(...columnHeights));
      const itemWidth = (container.clientWidth - gap * (columnCount - 1)) / columnCount;
      const x = minCol * (itemWidth + gap);
      const y = columnHeights[minCol];

      item.style.transform = `translate(${x}px, ${y}px)`;
      columnHeights[minCol] += item.offsetHeight + gap;
    });

    container.style.height = `${Math.max(...columnHeights)}px`;
  }

  function createBookmarkNote() {
    saveNote({
      id: generateId(),
      title: document.title || 'Untitled',
      description: window.getSelection().toString().trim(),
      url: window.location.href,
      tags: [],
      attachments: []
    });
    showNotification('Page bookmarked!');
    if ($(MODAL_IDS.VIEW)) renderNotes();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.dispatchEvent(new Event('modal-closed'));
    if (modal.parentElement && modal.parentElement.id?.includes('-container')) modal.parentElement.remove();
    else modal.remove();
    modal.removeAttribute?.('data-screenshot');
    logMessage(`Closed modal: ${modal.id}`);
  }

  const closeAllModals = () => {
    const modals = [
      $(MODAL_IDS.NOTE + '-container'),
      $(MODAL_IDS.VIEW),
      $(MODAL_IDS.SETTINGS),
    ];

    modals.forEach(modal => closeModal(modal));
  };

  // ------------------------
  // UI Elements
  // ------------------------
  function addModalCloseBtn(modalElement, closeAction) {
    const btn = createHTMLElement('button', {
      className: 'un-modal-close-btn', icon: 'close',
      eventListener: {
        click: (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeModal(modalElement);
          if (closeAction) closeAction();
        }
      }
    });
    modalElement.appendChild(btn);
  }

  function updateNoteInPlace(updatedNote) {
    const notesList = $('un-notes-list');
    if (!notesList) return;

    const existingNode = notesList.querySelector(`.note-container[data-id="${updatedNote.id}"]`);

    if (existingNode) {
      const query = $('un-search-input')?.value.toLowerCase() || '';

      const scoreMeta = computeNoteScore(updatedNote, query);
      const newNode = buildNoteElement(updatedNote, query, scoreMeta);

      newNode.classList.add('show');
      newNode.style.position = 'absolute';

      existingNode.replaceWith(newNode);

      applyMasonryLayout(notesList);
    } else {
      renderNotes();
    }
  }

  function showUndoNotification() {
    showNotification('Note trashed.', {
      duration: 6000,
      actionLabel: 'Undo',
      actionCallback: () => {
        const lastNote = getUndoBuffer();
        if (lastNote) {
          const notes = getNotes();
          notes.push(lastNote);
          config.notes = notes;
          config.trashedNotes = config.trashedNotes.filter(n => n.id !== lastNote.id);
          saveConfig(config);

          if ($(MODAL_IDS.VIEW)) renderNotes();
        }
      },
      position: 'bottom-center',
      animationType: 'fade',
      icon: UI_ICONS.trash,
    });
  }

  function updateSyncIndicatorUI() {
    const appRoot = getAppRoot();
    const indicator = appRoot.querySelector('#un-sync-indicator');
    if (!indicator) return;

    const activeSyncs = window.activeSyncs || new Set();

    if (activeSyncs.size > 0) {
      indicator.classList.add('active');
      const profiles = Array.from(activeSyncs).join(', ');
      indicator.dataset.tooltip = `Syncing profiles: ${profiles}`;
    } else {
      indicator.classList.remove('active');
      indicator.title = '';
    }
  }

  function createEdgeDock() {
    const appRoot = getAppRoot();
    if (appRoot.querySelector('#un-edge-dock')) return;

    const savedTop = config.dockPosition || '50%';
    const dock = createHTMLElement('div', {
      id: 'un-edge-dock',
      style: `top: ${savedTop};`
    });

    const syncIndicator = createHTMLElement('div', {
      id: 'un-sync-indicator',
      innerHTML: UI_ICONS.sync || '🔄'
    });
    dock.appendChild(syncIndicator);

    appRoot.appendChild(dock);

    updateSyncIndicatorUI();

    let isDragging = false;
    let startY = 0;
    let startTop = 0;

    dock.addEventListener('mousedown', (e) => {
      isDragging = false;
      startY = e.clientY;
      startTop = dock.getBoundingClientRect().top + (dock.offsetHeight / 2);

      const onMouseMove = (moveEvent) => {
        if (Math.abs(moveEvent.clientY - startY) > 5) {
          isDragging = true;
          // Close menu if open while dragging
          const existingMenu = $('flxkit-context-menu');
          if (existingMenu) existingMenu.remove();

          let newTop = startTop + (moveEvent.clientY - startY);
          newTop = Math.max(50, Math.min(window.innerHeight - 50, newTop));

          dock.style.top = `${(newTop / window.innerHeight) * 100}%`;
        }
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (isDragging) {
          config.dockPosition = dock.style.top;
          saveConfig(config);
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    dock.addEventListener('click', (e) => {
      if (!isDragging) {
        const rect = dock.getBoundingClientRect();

        const profile = getCurrentProfile();

        const isSyncReady = isProfileConfigured(profile);

        const options = [
          { label: 'Add Note', icon: UI_ICONS.edit, action: () => openNoteModal() },
          { label: 'View Notes', icon: UI_ICONS.preview, action: () => openViewModal() },
          { label: 'Quick Note', icon: UI_ICONS.pin, action: () => openQuickNoteModal() },
          { separator: true },
          { label: 'Bookmark Page', icon: UI_ICONS.bookmark, action: () => createBookmarkNote() },
          { separator: true },
          {
            label: 'Sync Notes',
            icon: UI_ICONS.sync,
            disabled: !isSyncReady,
            title: !isSyncReady ? 'Add a Gist ID and Token in Settings to enable sync.' : 'Sync notes now',
            action: async () => {
              showNotification(`Initiating sync...`, { duration: 2000, icon: UI_ICONS.sync });
              await syncNotesData();
            }
          },
          { label: 'Settings', icon: UI_ICONS.settings, action: () => openSettingsModal() },
        ];

        createContextMenu(rect.left - 180, rect.top + (rect.height / 2) - 80, options, 170);
      }
    });
  }

  let quickNoteModalInstance = null;

  function openQuickNoteModal() {
    if (quickNoteModalInstance) {
      quickNoteModalInstance.querySelector('.un-modal-header').focus();
      return;
    }

    injectEasyMdeCSS();
    let mdeInstance = null;
    const editorTextarea = createHTMLElement('textarea', { id: 'un-quick-mde-editor' });

    const modal = createHTMLElement('dialog', {
      class: 'un-modal', id: 'un-quick-note', style: { zIndex: 1 },
      children: [
        createHTMLElement('div', { class: 'un-modal-header-wrapper', children: [createHTMLElement('h3', {
          class: 'un-modal-header',
          textContent: config.quickNote.title,
        })]}),
        createHTMLElement('div', {
          class: 'un-modal-content',
          children: [ editorTextarea ]
        }),
        createHTMLElement('div', {
          class: 'un-modal-footer',
          children: [
            createHTMLElement('button', { textContent: 'Clear', eventListener: () => {
              mdeInstance.value('');
              config.quickNote.description = '';
              showNotification(`Quick note cleared`, { icon: UI_ICONS.clear });
            }}),
            createHTMLElement('button', { textContent: 'Close', eventListener: closeModal })
          ]
        })
      ]
    });

    getAppRoot().appendChild(modal);
    addModalCloseBtn(modal);
    requestAnimationFrame(() => modal.classList.add('show'));

    withTTPatched(() => {
      mdeInstance = getMDEInstance(modal, editorTextarea, config.quickNote.description);
    });

    monitorToolbarIcons(mdeInstance)

    makeElementDragAndResize(modal, modal.querySelector('div.un-modal-header-wrapper'), { minWidth: 250, minHeight: 150 });
    quickNoteModalInstance = modal;

    function saveQuickNote() {
      config.quickNote.description = mdeInstance.value();
      config.quickNote.lastEdited = new Date().toISOString();
      saveConfig(config);
    }

    function closeModal() {
      saveQuickNote();
      modal.remove();
      quickNoteModalInstance = null;
    }

    modal.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveQuickNote();
      if (e.key === 'Escape') closeModal();
    });

    modal.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
        const previewContainer = e.target.closest('.editor-preview, .editor-preview-side');
        if (previewContainer) {
          e.preventDefault();

          const checkboxes = Array.from(previewContainer.querySelectorAll('input[type="checkbox"]'));
          const clickedIndex = checkboxes.indexOf(e.target);

          if (clickedIndex > -1) {
            toggleMarkdownCheckbox(mdeInstance, clickedIndex);
          }
        }
      }
    });

    return modal;
  }

  function renderNotes() {
    index = 0;
    const notesList = $('un-notes-list');
    if (!notesList) return;
    const sortBy = $('un-sort-select')?.value || 'date';
    const query = $('un-search-input')?.value.toLowerCase() || '';
    let baseNotes = getNotes();
    const includes = Object.keys(activeTagFilters).filter(k => activeTagFilters[k] === 'include');
    const excludes = Object.keys(activeTagFilters).filter(k => activeTagFilters[k] === 'exclude');

    if (includes.length > 0 || excludes.length > 0) {
      baseNotes = baseNotes.filter(n => {
        const nTags = (n.tags || []).map(t => t.toLowerCase());
        if (n.url) {
          try {
            const domain = new URL(n.url).hostname.replace('www.', '').toLowerCase();
            if (domain && !nTags.includes(domain)) {
              nTags.push(domain);
            }
          } catch (e) {
            // Ignore malformed URLs
          }
        }

        const passesIncludes = includes.every(t => nTags.includes(t));
        const passesExcludes = excludes.every(t => !nTags.includes(t));

        return passesIncludes && passesExcludes;
      });
    }

    filteredNotes = computeScoresForNotes(baseNotes, query)
      .filter(entry => entry.scoreMeta.score > 0 || !query)
      .sort((a, b) => {
        if (a.note.pinned && !b.note.pinned) return -1;
        if (!a.note.pinned && b.note.pinned) return 1;
        if (query && b.scoreMeta.score !== a.scoreMeta.score) {
          return b.scoreMeta.score - a.scoreMeta.score;
        }
        if (sortBy === 'title') return (a.note.title || '').localeCompare(b.note.title || '');
        if (sortBy === 'url') return (a.note.url || '').localeCompare(b.note.url || '');
        return new Date(b.note.createdAt) - new Date(a.note.createdAt);
      });

    while (notesList.firstChild) {
      notesList.removeChild(notesList.firstChild);
    }

    if (filteredNotes.length === 0) {
      const isSearch = query.length > 0;
      const emptyState = createHTMLElement('div', {
        class: 'un-empty-state',
        children: [
          createHTMLElement('div', { innerHTML: safeHTML('<i class="fa fa-book" style="font-size: 48px; margin-bottom: 15px; opacity: 0.5;"></i>') }),
          createHTMLElement('h3', {
            textContent: isSearch ? 'No notes found' : 'Your vault is empty',
            style: 'margin: 0 0 8px 0; font-size: 18px; font-weight: 600;'
          }),
          createHTMLElement('p', {
            textContent: isSearch ? `We couldn't find anything matching "${query}".` : 'Hit your shortcut to create a new note anywhere on the web.',
            style: 'margin: 0; font-size: 14px;'
          })
        ]
      });
      notesList.appendChild(emptyState);
      return;
    }

    // Debounced resize handler to reapply Masonry layout
    let resizeTimeout;
    const debouncedMasonry = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => applyMasonryLayout(notesList), 100);
    };

    renderBatch = () => {
      const fragment = document.createDocumentFragment();
      const newNotes = [];
      for (let i = 0; i < NOTES_LOADING_BATCH_SIZE && index < filteredNotes.length; i++) {
        const el = buildNoteElement(filteredNotes[index].note, query, filteredNotes[index].scoreMeta);
        newNotes.push(el);
        fragment.appendChild(el);
        index++;
      }
      notesList.appendChild(fragment);
      requestAnimationFrame(() => {
        newNotes.forEach((el, i) => {
          setTimeout(() => el.classList.add('show'), i * 50);
        });
        debouncedMasonry();
        observeLastNote();
      });
    };

    // IntersectionObserver to detect when the last note is visible
    let observer;
    function observeLastNote() {
      if (observer) observer.disconnect();
      const lastNote = notesList.lastElementChild;
      if (!lastNote || index >= filteredNotes.length) return;

      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && index < filteredNotes.length) {
            renderBatch();
          }
        },
        {
          root: notesList,
          rootMargin: '100px',
          threshold: 0.1
        }
      );
      observer.observe(lastNote);
    }

    renderBatch(); // Initial batch render
    window.addEventListener('resize', debouncedMasonry);

    const modal = $(MODAL_IDS.VIEW);
    modal.addEventListener('modal-closed', () => {
      window.removeEventListener('resize', debouncedMasonry);
      if (observer) observer.disconnect();
    }, { once: true });
  }

  function buildNoteElement(note, query = '', scoreMeta = null) {
    const noteContainer = createHTMLElement('div', { class: `note-container ${note.pinned ? 'pinned' : ''}`, dataset: { id: note.id }, style: 'display: flex; align-items: flex-start; position: relative;',
      eventListener: { mouseenter: () => { actionsWrapper.style.opacity = '1'; actionsWrapper.style.pointerEvents = 'auto'; }, mouseleave: () => { actionsWrapper.style.opacity = '0'; actionsWrapper.style.pointerEvents = 'none'; } }
    });

    const firstImage = (note.attachments || []).find(a => a.type.startsWith('image/'));
    if (firstImage && firstImage.data) {
      const screenshotWrapper = createHTMLElement('div', { className: 'un-note-screenshot', style: 'margin-right: 12px;',
        children: [
          createHTMLElement('img', { src: firstImage.data, alt: 'Attachment', class: 'un-note-screenshot',
            eventListener: {
              click: async (e) => {
                e.stopPropagation();
                const imgEl = e.currentTarget;
                imgEl.style.opacity = '0.5';

                const imgData = await getAttachmentData(firstImage);

                imgEl.style.opacity = '1';
                fluxViewer.open(`${note.title}.jpg`, imgData);
              }
            }
          })
        ]
      });
      noteContainer.appendChild(screenshotWrapper);
    }

    let titleContainer;
    const contentDiv = createHTMLElement('div', { style: 'flex: 1;',
      children: [
        titleContainer = createHTMLElement('div', { className: 'note-title', innerHTML: safeHTML(scoreMeta ? highlightWithIndices(note.title || '', scoreMeta.matches.title) : escapeHtml(note.title || '')), style: 'font-weight: bold;' }),
        createHTMLElement('div', { textContent: new Date(note.createdAt).toLocaleString(), style: 'font-size: 12px; color: gray;' })
      ],
      eventListener: () => {
        const noteToEdit = getNotes().find(n => n.id === note.id);
        if (noteToEdit) {
          openNoteModal(
            noteToEdit,
            updatedNote => {
              showNotification(`Note updated!`, { icon: UI_ICONS.edit });
              updateNoteInPlace(updatedNote);
            },
            () => renderNotes()
          );
        }
      }
    });

    if (note.isConflict) {
      titleContainer.appendChild(createHTMLElement('span', { innerHTML: safeHTML('⚠️'), flxTooltip: 'This note was created because a sync conflict occurred.' }));
    }

    if (note.url) {
      let domain;
      try { domain = new URL(note.url).hostname.replace('www.', ''); }
      catch { domain = note.url; }

      contentDiv.appendChild(createHTMLElement('div', {
        children: [
          createHTMLElement('a', { href: note.url, title: note.url, innerHTML: safeHTML(scoreMeta ? highlightWithIndices(domain, scoreMeta.matches.url) : escapeHtml(domain)), target: '_blank', style: 'fontSize:13px;', eventListener: e => e.stopPropagation()})
        ]
      }));
    }

    if (note.tags?.length) {
      const tagsWrapper = createHTMLElement('div', { style: 'margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;' });

      note.tags.forEach((tag, i) => {
        const tagKey = tag.toLowerCase();
        const state = activeTagFilters[tagKey];
        const indices = scoreMeta && scoreMeta.matches.tags && scoreMeta.matches.tags[i]
          ? scoreMeta.matches.tags[i]
          : [];
        const tagEl = createHTMLElement('span', {
          innerHTML: safeHTML(highlightWithIndices(tag, indices)),
          className: `un-tag-chip ${state || ''}`,
          eventListener: {
            'click': e => {
              e.stopPropagation();

              if (!activeTagFilters[tagKey]) activeTagFilters[tagKey] = 'include';
              else if (activeTagFilters[tagKey] === 'include') activeTagFilters[tagKey] = 'exclude';
              else delete activeTagFilters[tagKey];

              renderTagList();
              renderNotes();
            },
            'contextmenu': e => {
              e.preventDefault();
              e.stopImmediatePropagation();
              const rect = e.target.getBoundingClientRect();

              createContextMenu(rect.left, rect.bottom + window.scrollY, [
                {
                  label: `${UI_ICONS.search} Filter by this tag`,
                  action: () => {
                    $('un-search-input').value = tag;
                    renderNotes();
                  }
                },
                {
                  label: `${UI_ICONS.edit} Rename tag`,
                  action: () => {
                    const newName = prompt(`Rename tag "${tag}" to:`, tag);
                    if (newName && newName.trim() !== tag) {
                      renameTag(tag, newName.trim());
                    }
                  }
                },
                {
                  label: `${UI_ICONS.trash} Delete tag`,
                  action: () => {
                    if (confirm(`Delete tag "${tag}" from all notes?`)) {
                      deleteTag(tag);
                    }
                  }
                },
                {
                  label: `${UI_ICONS.merge} Merge tag…`,
                  action: () => {
                    createMergeTagsModal(tag);
                  }
                }
              ]);
            }
        }
        });

        tagsWrapper.appendChild(tagEl);
      });


      contentDiv.appendChild(tagsWrapper);
    }

    const descSnippet = scoreMeta.matches.description && scoreMeta.matches.description.length > 0 ? makeSnippetFromIndices(note.description || '', scoreMeta.matches.description, 120) : '';
    if (descSnippet) {
      contentDiv.appendChild(
        createHTMLElement('div', {
          innerHTML: safeHTML(descSnippet),
          style: 'font-size: 12px; color: #666; margin-top: 4px;'
        })
      );
    }

    const urlSnippet = scoreMeta.matches.url && scoreMeta.matches.url.length > 0 ? makeSnippetFromIndices(note.url || '', scoreMeta.matches.url, 80) : '';
    if (urlSnippet) {
      contentDiv.appendChild(
        createHTMLElement('div', {
          innerHTML: safeHTML(urlSnippet),
          style: 'font-size: 11px; color: #888; margin-top: 2px;'
        })
      );
    }

    noteContainer.appendChild(contentDiv);

    const actionsWrapper = createHTMLElement('div', { class: 'un-note-actions-wrapper' });
    const pinBtn = createHTMLElement('span', {
      dataset: { tooltip: note.pinned ? 'Unpin Note' : 'Pin Note', id: note.id },
      className: `un-icon-action-btn ${note.pinned ? 'pinned-active' : ''}`,
      innerHTML: safeHTML(note.pinned ? UI_ICONS.pinned : UI_ICONS.pin),
      eventListener: {
        mouseenter: (e) => {
          e.currentTarget.style.background = 'rgba(211, 47, 47, 0.1)';
        },
        mouseleave: (e) => {
          e.currentTarget.style.background = 'transparent';
        },
        click: (e) => {
          e.stopPropagation();
          const id = e.currentTarget.getAttribute('data-id');
          const updated = getNotes().map(n => n.id === id ? { ...n, pinned: !n.pinned } : n);
          config.notes = updated;
          saveConfig(config); renderNotes();
        }
      }
    });

    const trashBtn = createHTMLElement('span', {
      dataset: { tooltip: 'Delete Note', id: note.id },
      className: 'un-icon-action-btn trash-btn', icon: 'trash',
      eventListener: {
        mouseenter: (e) => { e.currentTarget.style.background = 'rgba(211, 47, 47, 0.1)' },
        mouseleave: (e) => { e.currentTarget.style.background = 'transparent' },
        click: e => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const noteId = e.currentTarget.getAttribute('data-id');
          const now = new Date().toISOString();
          config.trashedNotes = config.trashedNotes || []
          const existing = config.trashedNotes.find(d => d.id === noteId);
          if (existing) {
            existing.trashedAt = now;
          } else {
            config.trashedNotes.push({ id: noteId, trashedAt: now });
          }
          const allNotes = getNotes();
          logMessage('delete', noteId);
          const trashedNote = allNotes.find(n => n.id === noteId);
          if (trashedNote) {
            saveUndoBuffer(trashedNote);
            const updated = allNotes.filter(n => n.id !== noteId);
            config.notes = updated;
            saveConfig(config);

            noteContainer.innerHTML = safeHTML('');
            noteContainer.className = 'note-container trashed-ghost show';
            noteContainer.style.display = 'flex';
            noteContainer.style.alignItems = 'center';
            noteContainer.style.justifyContent = 'center';
            noteContainer.style.background = 'transparent';
            noteContainer.style.border = `1px dashed ${darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`;
            noteContainer.style.boxShadow = 'none';
            noteContainer.style.minHeight = '72px';

            const undoBtn = createHTMLElement('button', {
              innerHTML: safeHTML(`<span style="display:flex;align-items:center;gap:6px;">${UI_ICONS.refresh} Undo Delete</span>`),
              style: 'background: transparent; color: var(--text); border: none; box-shadow: none; font-weight: 500; cursor: pointer; opacity: 0.7; transition: opacity 0.2s ease;',
              eventListener: {
                mouseenter: (ev) => { ev.currentTarget.style.opacity = '1' },
                mouseleave: (ev) => { ev.currentTarget.style.opacity = '0.7' },
                click: (ev) => {
                  ev.stopPropagation();
                  clearTimeout(removalTimer);

                  const lastNote = getUndoBuffer();
                  if (lastNote) {
                    const notes = getNotes();
                    notes.push(lastNote);
                    config.notes = notes;
                    config.trashedNotes = config.trashedNotes.filter(n => n.id !== lastNote.id);
                    saveConfig(config);

                    updateNoteInPlace(lastNote);
                  }
                }
              }
            });

            noteContainer.appendChild(undoBtn);

            const removalTimer = setTimeout(() => {
              noteContainer.style.opacity = '0';
              noteContainer.style.transform = 'scale(0.95)';

              setTimeout(() => {
                if (noteContainer.parentElement) {
                  noteContainer.remove();
                  applyMasonryLayout($('un-notes-list'));
                }
              }, 250);
            }, 6000);

            // showUndoNotification();
          }
        }
      }
    });

    actionsWrapper.appendChild(pinBtn);
    actionsWrapper.appendChild(trashBtn);
    noteContainer.appendChild(actionsWrapper);
    return noteContainer;
  }

  function openViewModal() {
    closeAllModals();
    activeTagFilters = {};
    const sortOptions = [
      { value: 'date', label: 'Date' },
      { value: 'title', label: 'Title' },
      { value: 'url', label: 'URL' },
    ];
    const modal = createHTMLElement('dialog', {
      class: 'un-modal',
      id: MODAL_IDS.VIEW,
      children: [
        createHTMLElement('div', {
          class: 'un-modal-header-wrapper',
          children: [createHTMLElement('h3', { class: 'un-modal-header', textContent: 'Notes Vault' })]
        }),
        createHTMLElement('div', {
          class: 'un-view-controls',
          children: [
            createHTMLElement('div', {
              class: 'un-search-wrapper',
              children: [
                createHTMLElement('input', {
                  id: 'un-search-input',
                  type: 'text',
                  placeholder: 'Search by title, URL, or tags...',
                  style: 'margin-bottom: 0 !important;',
                  eventListener: { 'input': () => renderNotes() }
                })
              ]
            }),
            createHTMLElement('label', {
              class: 'un-sort-wrapper',
              innerText: 'Sort by:',
              children: createHTMLElement('select', {
                id: 'un-sort-select',
                style: 'margin-bottom: 0 !important;',
                eventListener: { 'change': renderNotes },
                children: sortOptions.map(({ value, label }) => createHTMLElement('option', { value, textContent: label }))
              })
            }),
          ]
        }),
        createHTMLElement('div', { id: 'un-tag-list' }),
        createHTMLElement('div', {
          class: 'un-modal-content',
          children: [
            createHTMLElement('div', {
              class: 'un-notes-list-wrapper',
              children: [
                createHTMLElement('div', { id: 'un-notes-list' })
              ]
            }),
          ]
        }),
        createHTMLElement('div', {
          class: 'un-modal-footer',
          children: [
            createHTMLElement('button', {
              id: 'un-close-view',
              textContent: 'New',
              eventListener: () => {
                openNoteModal({
                  title: '',
                  description: window.getSelection().toString().trim(),
                  url: window.location.href,
                  tags: [],
                  screenshot: null,
                });
              }
            }),
            createHTMLElement('button', {
              id: 'un-close-view',
              textContent: 'Close',
              eventListener: () => closeModal(modal)
            }),
          ]
        })
      ]
    });

    getAppRoot().appendChild(modal);
    addModalCloseBtn(modal);
    requestAnimationFrame(() => modal.classList.add('show'));
    trapTabFocus(modal);

    makeElementDragAndResize(modal, modal.querySelector('div.un-modal-header-wrapper'), {
      onResizing: () => applyMasonryLayout(modal.querySelector('#un-notes-list')),
      onResizeEnd: () => applyMasonryLayout(modal.querySelector('#un-notes-list'))
    });

    renderTagList();
    renderNotes();
    applyTheme();

    return modal;
  }

  function createTagSuggestions(inputEl, wrapper) {
    const dropdown = createHTMLElement('div', { className: 'un-tag-suggestions' });
    Object.assign(dropdown.style, {
      position: 'absolute',
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: '4px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
      maxHeight: '150px',
      overflowY: 'auto',
      fontSize: '13px',
      display: 'none'
    });
    wrapper.style.position = 'relative';
    wrapper.appendChild(dropdown);

    dropdown.addEventListener('mousedown', e => e.preventDefault());

    inputEl.addEventListener('input', () => {
      const query = inputEl.value.toLowerCase();
      const allTags = getAllTags();
      const currentTags = [...wrapper.querySelectorAll('.un-tag-chip')].map(el => el.dataset.tag.toLowerCase());

      const matches = query
        ? allTags.filter(t => t.toLowerCase().includes(query) && !currentTags.includes(t.toLowerCase()))
        : allTags.filter(t => !currentTags.includes(t.toLowerCase()));

      if (!matches.length) {
        dropdown.style.display = 'none';
        return;
      }

      dropdown.innerHTML = safeHTML('');
      matches.forEach(tag => {
        const option = createHTMLElement('div', {
          textContent: tag,
          style: 'padding:4px 8px; cursor:pointer;',
          eventListener: () => {
            addTagChip(wrapper, tag);
            inputEl.value = '';
            dropdown.style.display = 'none';
          }
        });
        option.addEventListener('mouseenter', () => { option.style.background = '#eee'; });
        option.addEventListener('mouseleave', () => { option.style.background = ''; });
        dropdown.appendChild(option);
      });

      dropdown.style.display = 'block';
      dropdown.style.top = `${inputEl.offsetTop + inputEl.offsetHeight}px`;
      dropdown.style.left = `${inputEl.offsetLeft}px`;
      dropdown.style.width = `${inputEl.offsetWidth}px`;
    });


    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const values = inputEl.value.split(/[,]+/).map(v => v.trim()).filter(Boolean);
        values.forEach(val => addTagChip(wrapper, val));
        inputEl.value = '';
        dropdown.style.display = 'none';
      }

      if (e.key === 'Backspace' && !inputEl.value) {
        const chips = wrapper.querySelectorAll('.un-tag-chip');
        if (chips.length) chips[chips.length - 1].remove();
      }
    });

    inputEl.addEventListener('blur', () => {
      setTimeout(() => { dropdown.style.display = 'none'; }, 150);
    });
  }

  function openNoteModal(note = null, onSaveCallback = null, onCancelCallback = null) {
    const isNewNote = !note || !note.id;
    note = {
      id: note?.id || generateId(),
      title: note?.title || 'Untitled',
      description: note?.description || '',
      url: note?.url || window.location.href,
      tags: Array.isArray(note?.tags) ? note.tags : [],
      attachments: note?.attachments ? structuredClone(note.attachments) : [],
      pinned: note?.pinned || false,
    };

    let activeAttachments = note.attachments;
    const capabilities = getCapabilities();

    injectEasyMdeCSS();

    let attachmentsWrapper, noteURLInput;
    const editorContainer = createHTMLElement('div', { id: 'un-editor-wrapper' });
    const editorTextarea = createHTMLElement('textarea', { id: 'un-mde-editor' });
    editorContainer.appendChild(editorTextarea);
    let mdeInstance = null

    const scratchpadContainer = createHTMLElement('div', { id: 'un-scratchpad-wrapper', style: 'display: none;' }); // Hidden by default
    let padInstance = null;
    let isPadActive = (note && note.id && getNotes().some(n => n.id === note.id) && !note.description && activeAttachments.find(a => a._systemRef === 'scratchpad-vector'));
    
    const updateScratchpadData = async () => {
      const pngData = padInstance.getPreviewImage();
      if (pngData) {
        activeAttachments = activeAttachments.filter(a => a._systemRef !== 'scratchpad-vector' && a._systemRef !== 'scratchpad-preview');

        const baseId = 'att-' + getUniqueId();

        const jsonBlob = new Blob([padInstance.getVectorData()], { type: 'application/json' });
        await queueAttachmentForUpload(baseId + '-vec', jsonBlob);
        activeAttachments.push({ id: baseId + '-vec', _systemRef: 'scratchpad-vector', filename: 'scratchpad_vector.json', type: 'application/json', size: jsonBlob.size, providerStorage: 'native', data: null });

        const rawPngBlob = dataURLtoBlob(pngData);
        const thumb = await generateThumbnail(rawPngBlob);
        await queueAttachmentForUpload(baseId + '-png', rawPngBlob);
        activeAttachments.push({ id: baseId + '-png', _systemRef: 'scratchpad-preview', filename: 'scratchpad_preview.png', type: 'image/png', size: rawPngBlob.size, providerStorage: 'native', data: thumb });

        renderAttachmentsList();
      }
    }

    const openScratchpad = async () => {
      editorContainer.style.display = 'none';
      scratchpadContainer.style.display = 'block';

      if (!padInstance) {
        padInstance = new FluxKit.ui.Scratchpad(scratchpadContainer, { pointThreshold: 2, showExportSettings: true, theme: activeThemeBridge });
        window.activeUnPadInstance = padInstance;

        const existingVec = activeAttachments.find(a => a._systemRef === 'scratchpad-vector');
        if (existingVec) {
          const rawBlob = await getAttachmentData(existingVec);
          const jsonText = await new Blob([rawBlob]).text();
          padInstance.loadVectorData(jsonText);
        }
      }
      padInstance.refresh();
    }

    if (isPadActive) openScratchpad();

    const getIconHTML = (iconName) => {
      const rawSVG = window.FluxKit.ui.icons[iconName];
      return safeHTML(`<span style="display:flex;">${rawSVG}</span>`);
    };

    const togglePadBtn = createHTMLElement('button', {
      className: 'un-icon-btn',
      style: 'width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center;',
      icon: isPadActive ? 'textCaret' : 'scribble',
      flxTooltip: `${isPadActive ? 'Open Text Editor' : 'Open Scratchpad'}`,
      eventListener: {
        click: async (e) => {
          e.preventDefault();
          isPadActive = !isPadActive;
          if (isPadActive) {
            togglePadBtn.innerHTML = getIconHTML('textCaret');
            togglePadBtn.dataset.tooltip = 'Open Text Editor';
            await openScratchpad();
          }
          else {
            scratchpadContainer.style.display = 'none';
            editorContainer.style.display = 'block';
            togglePadBtn.innerHTML = getIconHTML('scribble');
            togglePadBtn.dataset.tooltip = 'Open Scratchpad';
            updateScratchpadData();
          }
        }
      }
    });

    const modalContent = createHTMLElement('div', { class: 'un-modal-content',
      children: [
        editorContainer,
        scratchpadContainer,
        createTagInput(note.tags),
        noteURLInput = createHTMLElement('input', { id: 'un-note-url', placeholder: 'URL', value: note.url }),
        attachmentsWrapper = createHTMLElement('div', { style: 'margin-top: 10px;' })
      ]
    })

    const modalHeader = createHTMLElement('h3', {
      class: 'un-modal-header',
      contentEditable: 'true',
      textContent: note.title,
      style: { cursor: 'text' },
      eventListener: {
        keydown: (e) => e.stopImmediatePropagation(),
        focus: (e) => {
          if (e.target.textContent === 'Untitled') {
            const range = document.createRange();
            range.selectNodeContents(e.target);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      }
    });

    const actionBtnsWrapper = createHTMLElement('div', { style: 'display: flex; align-items: center; gap: 8px;' });

    const modal = createHTMLElement('dialog', { class: `un-modal un-${note.id}`, style: { zIndex: 1 }, id: MODAL_IDS.NOTE,
      children: [
        createHTMLElement('div', { class: 'un-header-wrapper', children: [modalHeader]}),
        modalContent,
        createHTMLElement('div', { class: 'un-modal-footer',
          children: [
            actionBtnsWrapper,
            createHTMLElement('div', {
              style: 'display:flex; gap:8px;',
              children: [
                createHTMLElement('button', {
                  id: 'un-save-note',
                  textContent: 'Save',
                  style: 'min-width: 80px; transition: all 0.2s ease;',
                  eventListener: async (e) => {
                    const btn = e.target;
                    try {
                      btn.disabled = true;
                      btn.innerHTML = safeHTML(`<i class="fa fa-spinner fa-spin"></i> Saving...`);
                      btn.style.opacity = '0.8';
                      btn.style.cursor = 'not-allowed';

                      let finalDescription = mdeInstance.value();
                      if (isPadActive) await updateScratchpadData();

                      const updatedNote = {
                        id: note.id,
                        title: modalHeader.textContent.trim(),
                        description: finalDescription,
                        tags: getTagsFromWrapper(unQuery('.un-tag-input-wrapper')),
                        url: noteURLInput.value.trim(),
                        attachments: activeAttachments,
                        pinned: note.pinned || false,
                      };

                      if (!updatedNote.title) {
                        showNotification('Title is required.');
                        modal.querySelector('.un-modal-header').focus();
                        throw new Error('Title is required');
                      }

                      saveNote(updatedNote);

                      btn.style.background = '#28a745';
                      btn.style.color = '#fff';
                      btn.style.border = '1px solid #28a745';
                      btn.innerHTML = safeHTML(`<i class="fa fa-check"></i> Saved!`);

                      setTimeout(() => {
                        closeModal(modal);
                      }, 500);

                      setTimeout(() => closeModal(modal), 500);
                      if (isNewNote && $(MODAL_IDS.VIEW)) renderNotes();
                      if (onSaveCallback) await onSaveCallback(updatedNote);

                    } catch (err) {
                      btn.innerHTML = safeHTML(`<i class="fa fa-exclamation-triangle"></i> Error`);
                      btn.dataset.tooltip = err.message || 'Error';
                      btn.style.background = '#dc3545';
                      setTimeout(() => {
                        btn.dataset.tooltip = 'Save';
                        btn.disabled = false;
                        btn.innerHTML = safeHTML('Save');
                        btn.style.background = '';
                      }, 2000);
                    }
                  }
                }),
                createHTMLElement('button', {
                  id: 'un-cancel-note', textContent: 'Cancel',
                  eventListener: () => { if (onCancelCallback) onCancelCallback(); modal.parentElement.remove(); }
                })
              ]
            })
          ]
         })
      ],
     });

    ['keydown', 'keyup', 'keypress'].forEach(eventType => {
      modal.addEventListener(eventType, (e) => {
        if (['Enter', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.stopPropagation();
      }, { capture: true });
    })

    const wrapper = createHTMLElement('div', { id: `${MODAL_IDS.NOTE}-${note.id}-container`, class: 'un-modal-wrapper', children: modal });
    getAppRoot().appendChild(wrapper);
    addModalCloseBtn(modal);
    requestAnimationFrame(() => modal.classList.add('show'));

    withTTPatched(() => {
      mdeInstance = getMDEInstance(modal, editorTextarea, note.description);
    });
    monitorToolbarIcons(mdeInstance);

    function renderAttachmentsList() {
      attachmentsWrapper.innerHTML = safeHTML('');
      if (activeAttachments.length === 0) return;

      const list = createHTMLElement('div', { style: 'display: flex; gap: 8px; flex-wrap: wrap;' });

      activeAttachments.forEach(att => {
        if (att._systemRef === 'scratchpad-vector') return;
        const isSystemPreview = att._systemRef === 'scratchpad-preview';
        const displayName = isSystemPreview ? 'Scratchpad Sketch' : att.filename;
        const icon = att.data
            ? `<img src="${att.data}" style="width: 16px; height: 16px; object-fit: cover; border-radius: 2px;">`
            : `<i class="fa fa-file"></i>`;

        const chip = createHTMLElement('div', {
          style: 'display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--bg-muted); border-radius: 4px; font-size: 11px; border: 1px solid var(--border); cursor: pointer;',
          flxTooltip: 'Click to open/preview',
          children: [
            createHTMLElement('span', { innerHTML: safeHTML(icon) }),
            createHTMLElement('span', { textContent: displayName, style: 'max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' }),
            createHTMLElement('i', {
              class: 'fa fa-times',
              style: 'margin-left: 4px; opacity: 0.6;',
              flxTooltip: 'Remove',
              eventListener: {
                click: (e) => {
                  e.stopPropagation();
                  activeAttachments = activeAttachments.filter(a => a.id !== att.id);
                  if (isSystemPreview) {
                    if (!confirm('This will permanently delete your scratchpad drawing. Are you sure?')) return;
                    activeAttachments = activeAttachments.filter(a => a._systemRef !== 'scratchpad-vector' && a._systemRef !== 'scratchpad-preview');
                  } else {
                    activeAttachments = activeAttachments.filter(a => a.id !== att.id);
                  }
                  renderAttachmentsList();
                }
              }
            })
          ],
          eventListener: {
            click: async (e) => {
              e.stopPropagation();
              const chipEl = e.currentTarget;
              chipEl.style.opacity = '0.5';

              try {
                const fileData = await getAttachmentData(att);

                if (fileData) {
                  fluxViewer.open(att.filename, fileData);
                } else {
                  showNotification("Failed to load attachment data.", { icon: UI_ICONS.error });
                }
              } finally {
                chipEl.style.opacity = '1';
              }
            }
          }
        });
        list.appendChild(chip);
      });
      attachmentsWrapper.appendChild(list);
    }

    const cameraBtn = createHTMLElement('button', {
      className: 'un-icon-btn',
      style: 'width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center;', icon: 'camera',
      flxTooltip: `${!isScreenshotHelperInstalled ? 'UN Screenshot Helper extension required' : 'Capture Screenshot'}`,
      eventListener: {
        click: (e) => {
          e.preventDefault();
          if (!isScreenshotHelperInstalled) return;
          toggleShadowHostVisibility(false);
          requestNativeScreenshot(async dataUrl => {
            if (!dataUrl) {
              showNotification('Failed to capture the screenshot!', { icon: UI_ICONS.error });
              return;
            }
            const capabilities = getCapabilities();
            const id = 'att-' + getUniqueId();

            if (capabilities.requiresBatchedBase64) {
              // GIST PATH: Compression & Base64
              const compressedDataUrl = await compressImage(dataUrl);
              activeAttachments.push({
                id,
                filename: `screenshot_${Date.now()}.jpg`,
                type: 'image/jpeg',
                size: Math.round(compressedDataUrl.length * 0.75),
                providerStorage: 'base64',
                storagePath: null,
                thumbnailFile: null,
                data: compressedDataUrl
              });
            } else {
              const rawBlob = dataURLtoBlob(dataUrl);
              const thumbnailData = await generateThumbnail(rawBlob); // Tiny UI preview

              await queueAttachmentForUpload(id, rawBlob); // Save massive uncompressed file to IndexedDB

              activeAttachments.push({
                id,
                filename: `screenshot_${Date.now()}.png`,
                type: 'image/png',
                size: rawBlob.size,
                providerStorage: 'native',
                storagePath: null, // Assigned by sync engine
                thumbnailFile: null,   // Assigned by sync engine
                data: thumbnailData // Fast UI rendering
              });
            }

            showNotification(`Screenshot captured!`, { icon: UI_ICONS.camera });
            renderAttachmentsList();
          });
        }
      }
    });

    if (!isScreenshotHelperInstalled) {
      cameraBtn.disabled = true;
      cameraBtn.style.opacity = '0.5';
      cameraBtn.style.cursor = 'not-allowed';
    }
    actionBtnsWrapper.appendChild(cameraBtn);
    actionBtnsWrapper.appendChild(togglePadBtn);

    // 2. Native File Attachment Button (Only if profile allows it!)
    if (capabilities.allowsNativeFiles) {
      const fileInput = createHTMLElement('input', {
        type: 'file',
        style: 'display: none;',
        eventListener: {
          change: async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > capabilities.maxFileSize) {
              showNotification(`File too large! Max is ${capabilities.maxFileSize / 1024 / 1024}MB.`, { icon: UI_ICONS.error });
              return;
            }

            const id = 'att-' + getUniqueId();
            let thumbnailData = null;

            // Instantly show loading state
            const prevIcon = attachBtn.innerHTML;
            attachBtn.innerHTML = safeHTML('<i class="fa fa-spinner fa-spin"></i>');
            attachBtn.disabled = true;

            try {
              if (file.type.startsWith('image/')) {
                thumbnailData = await generateThumbnail(file);
              }
              // Cache the raw file natively in IndexedDB
              await queueAttachmentForUpload(id, file);

              activeAttachments.push({
                id,
                filename: file.name,
                type: file.type,
                size: file.size,
                providerStorage: 'native',
                storagePath: null, // Will be set by sync engine
                thumbnailFile: null,
                data: thumbnailData // For instant UI preview
              });

              showNotification(`Attached ${file.name}`);
              renderAttachmentsList();
            } catch (err) {
              logError(err);
              showNotification('Failed to attach file.', { icon: UI_ICONS.error });
            } finally {
              attachBtn.innerHTML = safeHTML(prevIcon);
              attachBtn.disabled = false;
              fileInput.value = ''; // Reset input
            }
          }
        }
      });

      const attachBtn = createHTMLElement('button', {
        className: 'un-icon-btn',
        style: 'width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center;',
        innerHTML: safeHTML('<i class="fa fa-paperclip"></i>'), // Fallback paperclip icon
        flxTooltip: 'Attach File',
        eventListener: {
          click: (e) => {
            e.preventDefault();
            fileInput.click();
          }
        }
      });

      actionBtnsWrapper.appendChild(fileInput);
      actionBtnsWrapper.appendChild(attachBtn);
    }

    // Initial render of attachments
    renderAttachmentsList();

    if (note && note.id && getNotes().some(n => n.id === note.id)) mdeInstance.togglePreview();

    modal.addEventListener('dblclick', (e) => {
      if (e.target.closest('.editor-preview, .editor-preview-side')) {
        window.getSelection().removeAllRanges();
        if (mdeInstance.isPreviewActive()) {
          mdeInstance.togglePreview();
          mdeInstance.codemirror.focus();
        }
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
        const previewContainer = e.target.closest('.editor-preview, .editor-preview-side');
        if (previewContainer) {
          e.preventDefault();
          const checkboxes = Array.from(previewContainer.querySelectorAll('input[type="checkbox"]'));
          const clickedIndex = checkboxes.indexOf(e.target);
          if (clickedIndex > -1) toggleMarkdownCheckbox(mdeInstance, clickedIndex);
        }
      }
    });

    trapTabFocus(modal);
    makeElementDragAndResize(modal, modal.querySelector('div.un-header-wrapper'), { minWidth: 298, minHeight: 326 });
    applyTheme();

    modal.addEventListener('modal-closed', () => {
      if (window.activeUnPadInstance) {
        window.activeUnPadInstance.destroy();
        window.activeUnPadInstance = null;
      }
      logMessage('Cleaned up FluxKit Scratchpad instance on modal close.');
    }, { once: true });
  }

  function openSettingsModal() {
    const userTheme = config.theme || 'auto';
    const profiles = getAllProfiles();
    const currentProfileName =
      getCurrentProfileName() || profiles[0]?.name || '';
    let currentProfile = profiles.find(p => p.name === currentProfileName) || {
      name: '',
      gistId: '',
      fileName: '',
      token: '',
      syncFrequency: 'Every day',
    };

    closeAllModals();

    const syncIntervalLabel = createHTMLElement('label', {
      class: 'un-form-row',
      children: [
        createHTMLElement('div', { textContent: 'Sync frequency', class: 'un-form-label' }),
        createHTMLElement('select', {
          id: 'sync-frequency-select',
          style: 'width:55%;margin:0;',
          children: Object.keys(SYNC_FREQUENCIES).map(key =>
            createHTMLElement('option', {
              value: key,
              textContent: key,
              selected: currentProfile.syncFrequency === key
            })
          )
        })
      ]
    });

    const allProfiles = config.profiles || [];
    const profileSvg = createSVGElement('svg', {
      viewBox: '0 0 24 24',
      width: '18',
      height: '18',
      fill: 'currentColor',
      children: [
        createSVGElement('path', {
          d: 'M14,2 C14.2652165,2 14.5195704,2.10535684 14.7071068,2.29289322 L19.7071068,7.29289322 C19.8946432,7.4804296 20,7.73478351 20,8 L20,9 C20,9.55228475 19.5522847,10 19,10 L13,10 C12.4871642,10 12.0644928,9.61395981 12.0067277,9.11662113 L12,9 L11.999,4 L7,4 C6.44771525,4 6,4.44771525 6,5 L6,19 C6,19.5522847 6.44771525,20 7,20 L9,20 C9.55228475,20 10,20.4477153 10,21 C10,21.5522847 9.55228475,22 9,22 L7,22 C5.34314575,22 4,20.6568542 4,19 L4,5 C4,3.34314575 5.34314575,2 7,2 L14,2 Z M17,12 C17.5522847,12 18,12.4477153 18,13 L18,16 L21,16 C21.5522847,16 22,16.4477153 22,17 C22,17.5522847 21.5522847,18 21,18 L18,18 L18,21 C18,21.5522847 17.5522847,22 17,22 C16.4477153,22 16,21.5522847 16,21 L16,18 L13,18 C12.4477153,18 12,17.5522847 12,17 C12,16.4477153 12.4477153,16 13,16 L16,16 L16,13 C16,12.4477153 16.4477153,12 17,12 Z M13.999,4.414 L14,8 L17.586,8 L13.999,4.414 Z'
        })
      ]
    });

    const deleteSvg = createSVGElement('svg', {
      viewBox: '0 0 24 24',
      width: '18',
      height: '18',
      fill: 'none',
      children: [
        createSVGElement('path', {
          d: "M13.5 3H12H8C6.34315 3 5 4.34315 5 6V18C5 19.6569 6.34315 21 8 21H11M13.5 3L19 8.625M13.5 3V7.625C13.5 8.17728 13.9477 8.625 14.5 8.625H19M19 8.625V11.8125",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "stroke-width": "2",
          stroke: "currentColor"
        }),
        createSVGElement('path', {
          d: "M15 16L17.5 18.5M20 21L17.5 18.5M17.5 18.5L20 16M17.5 18.5L15 21",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "stroke-width": "2",
          stroke: "currentColor"
        })
      ]
    });

    const profileRow = createHTMLElement('div', { class: 'un-profile-row',
      children: [
        createHTMLElement('select', { id: 'profile-select', style: 'flex-grow:1',
          children: allProfiles.map(profile => createHTMLElement('option', { value: profile.name, textContent: profile.name, selected: profile.name === currentProfileName })),
            eventListener: {
              change: (e) => {
                const selected = e.target.value;
                switchProfile(selected);
                openSettingsModal();
              }
          }
        }),
        createHTMLElement('button', { id: 'new-profile-btn', flxTooltip: 'New Profile', class: 'un-icon-btn', children: profileSvg, eventListener: async () => {
          const name = prompt('Enter new profile name:');
          if (name && !allProfiles.find(p => p.name === name)) {
            await saveProfile({ provider: 'Local', name });
            openSettingsModal();
          } else if (allProfiles.find(p => p.name === name)) alert('A profile with this name already exists.');
        }}),
        createHTMLElement('button', { id: 'delete-profile-btn', flxTooltip: 'Delete Profile', class: 'un-icon-btn', children: deleteSvg, eventListener: async () => {
          if (!confirm(`Delete the profile: ${currentProfileName}? This cannot be undone.`)) return;
          await syncNotesData(getSnapshot());
          const updated = profiles.filter(p => p.name !== currentProfileName);
          config.profiles = updated;
          config.currentProfile = updated[0]?.name || '';
          const cached = loadCachedProfileData(config.currentProfile);
          if (cached) {
            config.notes = cached.notes;
            config.trashedNotes = cached.trashedNotes;
            config.lastSyncTime = cached.lastSyncTime;
            showNotification(`Loaded "${config.currentProfile}" from local cache.`, { icon: UI_ICONS.zap });
          } else {
            config.notes = [];
            config.trashedNotes = [];
            config.lastSyncTime = null;
          }
          saveConfig(config);
          await syncNotesData(getSnapshot());
          openSettingsModal();
        }}),
      ]});

    const lastSync = config.lastSyncTime
      ? new Date(config.lastSyncTime).toLocaleString()
      : 'Never';

    const profileActionContainer = createHTMLElement('div', { id: 'un-profile-action-container' });

    const renderSetupButton = () => {
      profileActionContainer.innerHTML = safeHTML('');
      const btn = createHTMLElement('button', {
        textContent: '✨ Set up Sync Wizard',
        eventListener: () => {
          const wizardContainer = createHTMLElement('div', { id: 'un-wizard-container' });

          profileActionContainer.innerHTML = safeHTML('');
          profileActionContainer.appendChild(wizardContainer);

          const rootContainer = getAppRoot();
          const defaultSub = currentProfileName || 'Default';
          window.activeUnSyncWizard = new FluxKit.sync.Wizard(rootContainer, { namespace: 'FluxNotes', defaultSubFolder: defaultSub, theme: activeThemeBridge }, async (data) => {
            showNotification('Sync configured!');
            const newProfile = {
              name: currentProfileName || 'Default',
              provider: data.provider || 'Local',
              gistId: data.gistId || '',
              token: data.token || '',
              namespace: data.namespace || 'FluxNotes',
              subFolder: data.subFolder || defaultSub,
              url: data.url || '', // WebDAV
              username: data.username || '', // WebDAV
              password: data.password || '', // WebDAV
              appKey: data.appKey || '', // Dropbox & OneDrive
              appSecret: data.appSecret || '', // Dropbox & OneDrive
              refreshToken: data.refreshToken || '', // Dropbox & OneDrive
              tokenExpiresAt: data.tokenExpiresAt || null, // Dropbox & OneDrive
              syncFrequency: 'Every 30 minutes'
            };

            updateProfile(newProfile);

            showNotification('Sync configured successfully! Syncing notes...', { icon: UI_ICONS.save });

            try {
              await syncNotesData(getSnapshot());
              startAutoSyncScheduler();
            } catch (err) {
              logMessage('Initial sync failed:', err);
            }
            openSettingsModal();
          }).render(wizardContainer);
        }
      });
      profileActionContainer.appendChild(btn);
    };

    const profileLabel = createHTMLElement('div', {
      children: [
        createHTMLElement('div', {
          textContent: `Active Profile (Last Synced: ${lastSync})`,
          class: 'un-form-label',
          style: 'margin-bottom: 8px;'
        }),
        profileRow
      ]
    });

    const isConfigured = isProfileConfigured(currentProfile);
    if (!isConfigured) renderSetupButton();

    const profilesLayout = createHTMLElement('div', {
      style: 'display: flex; flex-direction: column; gap: 16px;'
    });
    const editorContainer = createHTMLElement('div');
    profilesLayout.appendChild(editorContainer);

    const customFields = createHTMLElement('div', {
      children: [
        syncIntervalLabel,
        createHTMLElement('div', { class: 'un-profile-btn-row',
          children: [
            createHTMLElement('button', { id: 'save-settings', textContent: 'Save', style: 'width:124px;',
              eventListener: async () => {
                const updatedProfile = window.activeUnSyncEditor.data;
                updatedProfile.syncFrequency = $('sync-frequency-select').value;
                updateProfile(updatedProfile);
                showNotification(`Profile Settings saved!`, { icon: UI_ICONS.save });
                await syncNotesData(getSnapshot());
              }
            }),
          ]
        })
      ]
    });
    window.activeUnSyncEditor = new FluxKit.sync.Editor(
      getAppRoot(),
      currentProfile,
      {
        namespace: 'FluxNotes',
        theme: activeThemeBridge,
        customElements: customFields
      },
      () => {}
    ).render(editorContainer);

    const profileDetails = createHTMLElement('details', { style: { marginTop: '12px' },
      children: [
        createHTMLElement('summary', { textContent: 'Profile Details', style: { cursor: 'pointer', fontWeight: 'bold' }}),
        profilesLayout
      ]
    });

    // Shortcuts Header
    const shortcutFields = [
      { id: 'shortcut-add-note', label: 'Add Note Shortcut:', key: 'add' },
      {
        id: 'shortcut-view-notes',
        label: 'View Notes Shortcut:',
        key: 'view',
      },
      {
        id: 'shortcut-settings',
        label: 'Settings Modal Shortcut:',
        key: 'settings',
      },
      {
        id: 'shortcut-theme-toggle',
        label: 'Toggle Theme Shortcut:',
        key: 'toggleTheme',
      },
      {
        id: 'shortcut-quick-note',
        label: 'Quick Note Shortcut:',
        key: 'quickNote',
      },
      {
        id: 'shortcut-bookmark-note',
        label: 'Bookmark Note Shortcut:',
        key: 'bookmarkNote',
      },
    ];
    const shortcutDetails = createHTMLElement('details', {
      children: [
        createHTMLElement('summary', { textContent: 'Keyboard Shortcuts' }),
        createHTMLElement('div', {
          style: 'font-size:12px; margin-bottom:16px; opacity: 0.9; line-height: 1.5;',
          innerHTML: safeHTML('Click an input to record your keys.<br><strong style="color: var(--accentBg, #007bff);">Press Enter or Escape to save</strong> your new combo.')
        }),
        ...(shortcutFields.map(({ id, label, key }) =>
          createHTMLElement('label', {
            class: 'un-form-row',
            children: [
              createHTMLElement('div', { textContent: label.replace(' Shortcut:', ''), class: 'un-form-label' }),
              createHTMLElement('input', {
                id,
                type: 'text',
                readOnly: true,
                value: getShortcutConfig(key),
                style: 'text-align: center; font-family: monospace; cursor: pointer;',
                eventListener: {
                  focus: (e) => {
                    isShorcutUpdating = true;
                    e.target.style.borderColor = 'var(--accentBg, #007bff)';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.25)';
                    e.target.value = 'Press keys... (Esc to save)';
                  },
                  blur: (e) => {
                    isShorcutUpdating = true;
                    e.target.style.borderColor = '';
                    e.target.style.boxShadow = '';
                    e.target.value = getShortcutConfig(key);
                  },
                  keydown: (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    if (e.key === 'Escape' || e.key === 'Enter') {
                      const attemptedShortcut = e.target.value;
                      const currentShortcut = getShortcutConfig(key);

                      if (attemptedShortcut === currentShortcut) {
                        e.target.blur();
                        return;
                      }
                      const duplicateField = shortcutFields.find(
                        f => getShortcutConfig(f.key) === attemptedShortcut && f.key !== key
                      );
                      if (duplicateField) {
                        e.target.value = currentShortcut;
                        e.target.blur();

                        const conflictName = duplicateField.label.replace(' Shortcut:', '');
                        showNotification(
                          `❌ Error: ${attemptedShortcut} is already used by "${conflictName}"`,
                          4000,
                          null,
                          null,
                          { animationType: 'bounce', progressGradient: '#ff4757' }
                        );
                        return;
                      }
                      updateShortcutConfig(key, attemptedShortcut);
                      showNotification(`Shortcut updated to ${attemptedShortcut}`);
                      e.target.blur();
                      return;
                    }

                    const { stored } = getShortcutFromEvent(e);
                    if (stored) {
                      e.target.value = stored;
                    }
                  }
                }
              })
            ]
          })
        ))
      ]
    });

    const { usedMB, limitMB, percent, status } = calculateStorageUsage();

    const color =
      status === 'over' ? '#e74c3c' :
      status === 'critical' ? '#f39c12' :
      status === 'warning' ? '#f1c40f' :
      '#2ecc71';

    const tooltip =
      status === 'over' ? 'Storage limit exceeded! Notes may fail to sync.' :
      status === 'critical' ? 'Critically close to storage limit. Consider cleaning up old notes.' :
      status === 'warning' ? 'Approaching storage limit — consider compressing or deleting old notes.' :
      'Storage usage within safe range.';

    const storageInfo = createHTMLElement('div', {
      id: 'storage-usage',
      style: `
        margin: 6px 0 12px 0;
        font-size: 13px;
        color: var(--text-secondary);
      `,
      flxTooltip: tooltip,
      innerHTML: safeHTML(`
        💾 Storage used: <strong>${usedMB.toFixed(2)} MB</strong> / ${limitMB} MB
        <div style="background: var(--bg-muted); height:6px; border-radius:4px; overflow:hidden; margin-top:4px;">
          <div style="
            width:${percent}%;
            height:100%;
            background:${color};
            transition: width 0.3s ease;
          "></div>
        </div>
      `)
    });

    const modal = createHTMLElement('dialog', { class: 'un-modal', id: MODAL_IDS.SETTINGS, style: { zIndex: 2 },
      children: [
        createHTMLElement('h3', { class: 'un-modal-header', textContent: 'Settings' }),
        storageInfo,
        createHTMLElement('div', { class: 'un-modal-content', children: [
          profileLabel, isProfileConfigured(currentProfile) ? profileDetails : profileActionContainer,
          createHTMLElement('label', { class: 'un-form-row',
            children: [
              createHTMLElement('div', { textContent: 'Theme', class: 'un-form-label'}),
              createHTMLElement('select', {
                id: 'theme-select',
                children: Object.entries(THEME_PRESETS).map(([key, preset]) =>
                  createHTMLElement('option', {
                    value: key,
                    textContent: preset.name,
                    selected: key === userTheme
                  })
                ),
                eventListener: { change: (e) => {
                  const selected = e.target.value;
                  tempThemeSwitch = false;
                  applyTheme(selected);

                  const customPanel = unQuery('#un-custom-theme-panel');
                  if (customPanel) {
                    customPanel.style.display = selected === 'custom' ? 'flex' : 'none';
                  }
                }}
              })

            ]
          }),
          createHTMLElement('div', {
            id: 'un-custom-theme-panel',
            style: `display: ${userTheme === 'custom' ? 'flex' : 'none'};`,
            children: [
              { key: 'bg', label: 'Main Background' },
              { key: 'inputBg', label: 'Input Background' },
              { key: 'text', label: 'Text Color' },
              { key: 'accent', label: 'Accent Color' },
              { key: 'btnTextColor', label: 'Button Text' }
            ].map(prop => createHTMLElement('input', {
              type: 'color',
              class: 'un-color-picker',
              value: config.customTheme[prop.key],
              dataset: { tooltip: prop.label, tooltipDelay: 50 },
              eventListener: {
                input: (e) => {
                  config.customTheme[prop.key] = e.target.value;
                  saveConfig(config);
                  THEME_PRESETS.custom[prop.key] = e.target.value;
                  if (userTheme === 'custom') applyTheme('custom');
                }
              }
            }))
          }),
          shortcutDetails,
        ]}),
        createHTMLElement('div', { class: 'un-modal-footer',
          children: [
            createHTMLElement('button', { style: 'width:100px;',
              innerHTML: safeHTML(`<span style="display:flex;align-items:center;justify-content:center;gap:6px;">${UI_ICONS.export} Export</span>`),
              eventListener: (e) => {
                const rect = e.target.getBoundingClientRect();
                createContextMenu(rect.left, rect.bottom, [
                  { label: 'JSON', action: () => exportNotes() },
                  { label: 'Markdown', action: () => exportNotesAsMarkdown() },
                  { label: 'CSV', action: () => exportNotesAsCSV() }
                ]);
              }
            }),
            createHTMLElement('button', { style: 'width:100px;margin-left:8px;',
              innerHTML: safeHTML(`<span style="display:flex;align-items:center;justify-content:center;gap:6px;">${UI_ICONS.import} Import</span>`),
              eventListener: (e) => {
                const rect = e.target.getBoundingClientRect();
                createContextMenu(rect.left, rect.bottom, [
                  {
                    label: 'Merge Import',
                    action: () => {
                      const input = createHTMLElement('input', { type: 'file', accept: '.json' }); // Fixed 'type' -> 'file'
                      input.onchange = (ev) => {
                        const file = ev.target.files[0];
                        if (file) importNotes(file, 'merge');
                      };
                      input.click();
                    }
                  },
                  {
                    label: 'Overwrite Import',
                    action: () => {
                      const input = createHTMLElement('input', { type: 'file', accept: '.json' }); // Fixed 'type' -> 'file'
                      input.onchange = (ev) => {
                        const file = ev.target.files[0];
                        if (file) importNotes(file, 'overwrite');
                      };
                      input.click();
                    }
                  }
                ]);
              }
            }),
            createHTMLElement('button', {
              innerHTML: safeHTML(`<span style="display:flex;align-items:center;justify-content:center;gap:6px;">${UI_ICONS.sync} Sync</span>`),
              style: 'width:100px;margin-left:8px;',
              eventListener: async () => {
                await syncNotesData(true);
              }
            })
          ]
        })
      ]});

    getAppRoot().appendChild(modal);
    addModalCloseBtn(modal);
    requestAnimationFrame(() => modal.classList.add('show'));
    trapTabFocus(modal);
    makeElementDragAndResize(modal, modal.querySelector('h3'));

    $('theme-select').value = userTheme;

    applyTheme();

    const lastSynced = config.last_synced;
    if (lastSynced) {
      const formatted = new Date(parseInt(lastSynced)).toLocaleString();
      $(
        'last-synced'
      ).textContent = `🕒 Last synced: ${formatted}`;
    }

    modal.addEventListener('modal-closed', () => {
      if (window.activeUnSyncEditor) {
        window.activeUnSyncEditor.destroy();
        window.activeUnSyncEditor = null;
      }
      if (window.activeUnSyncWizard) {
        window.activeUnSyncWizard.destroy();
        window.activeUnSyncWizard = null;
      }
      logMessage('Cleaned up FluxKit Sync instances on modal close.');
    }, { once: true });
  }

  function createMergeTagsModal(fromTag) {
    const allTags = getAllTags();
    if (allTags.length < 2) {
      alert('You need at least 2 tags to merge.');
      return;
    }

    const modal = createHTMLElement('dialog', {
      className: 'un-modal',
      id: 'un-merge-tags-modal',
      style: 'padding: 16px; max-width: 320px;',
      children: [
        createHTMLElement('h3', { class: 'un-modal-header', textContent: '🔀 Merge Tags' }),
        createHTMLElement('div', { class: 'un-modal-content',
          children: [
            createHTMLElement('label', {
              textContent: 'From:',
              children: createHTMLElement('select', {
                id: 'merge-from',
                style: 'width: 100%; margin: 6px 0;',
                children: allTags.map(t => createHTMLElement('option', { value: t, textContent: t }))
              })
            }),
            createHTMLElement('label', {
              textContent: 'To:',
              children: createHTMLElement('select', {
                id: 'merge-to',
                style: 'width: 100%; margin: 6px 0;',
                children: [
                  ...allTags.map(t => createHTMLElement('option', { value: t, textContent: t })),
                  createHTMLElement('option', { value: '__new__', textContent: '➕ New Tag…' })
                ]
              })
            }),
            createHTMLElement('input', {
              id: 'merge-new-input',
              type: 'text',
              placeholder: 'Enter new tag name',
              style: 'width: 100%; margin: 6px 0; display: none;'
            }),
          ]
        }),
        createHTMLElement('div', {
          class: 'un-modal-footer',
          style: 'margin-top: 12px; display: flex; justify-content: space-between;',
          children: [
            createHTMLElement('button', { textContent: 'Cancel', eventListener: () => modal.remove() }),
            createHTMLElement('button', {
              textContent: 'Merge',
              eventListener: () => {
                const fromTag = $('merge-from').value;
                let toTag = $('merge-to').value;
                if (toTag === '__new__') {
                  toTag = $('merge-new-input').value.trim();
                  if (!toTag) {
                    alert('Enter a name for the new tag.');
                    return;
                  }
                }
                if (fromTag === toTag) {
                  alert('Cannot merge a tag into itself.');
                  return;
                }
                mergeTags(fromTag, toTag);
                modal.remove();
              }
            })
          ]
        })
      ]
    });

    getAppRoot().appendChild(modal);
    addModalCloseBtn(modal);
    requestAnimationFrame(() => modal.classList.add('show'));
    trapTabFocus(modal);

    if (fromTag) {
      $('merge-from').value = fromTag;
    }

    $('merge-to').addEventListener('change', e => {
      const input = $('merge-new-input');
      input.style.display = e.target.value === '__new__' ? 'block' : 'none';
    });
  }

  function renderTagList() {
    const tagContainer = $('un-tag-list');
    if (!tagContainer) return;

    tagContainer.textContent = '';

    const allTags = [window.location.hostname.replace('www.', ''), ...getAllTags()];

    if (allTags.length === 0) {
      tagContainer.textContent = 'No tags yet.';
      return;
    }

    allTags.forEach(tag => {
      const tagKey = tag.toLowerCase();
      const state = activeTagFilters[tagKey];

      const tagEl = createHTMLElement('span', {
        className: `un-tag-chip ${state || ''}`,
        textContent: tag,
        eventListener: {
          'click': () => {
            // Cycle states: null -> include -> exclude -> null
            if (!activeTagFilters[tagKey]) activeTagFilters[tagKey] = 'include';
            else if (activeTagFilters[tagKey] === 'include') activeTagFilters[tagKey] = 'exclude';
            else delete activeTagFilters[tagKey];

            renderTagList();
            renderNotes();
          },
          'contextmenu': e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            const rect = e.target.getBoundingClientRect();

            createContextMenu(rect.left, rect.bottom + window.scrollY, [
              {
                label: `${UI_ICONS.search} Filter by this tag`,
                action: () => {
                  $('un-search-input').value = tag;
                  renderNotes();
                }
              },
              {
                label: `${UI_ICONS.edit} Rename tag`,
                action: () => {
                  const newName = prompt(`Rename tag "${tag}" to:`, tag);
                  if (newName && newName.trim() !== tag) {
                    renameTag(tag, newName.trim());
                  }
                }
              },
              {
                label: `${UI_ICONS.trash} Delete tag`,
                action: () => {
                  if (confirm(`Delete tag "${tag}" from all notes?`)) {
                    deleteTag(tag);
                  }
                }
              },
              {
                label: `${UI_ICONS.merge} Merge tag…`,
                action: () => {
                  createMergeTagsModal(tag);
                }
              }
            ]);
          }
        }
      });
      tagContainer.appendChild(tagEl);
    });
  }

  function createTagInput(existingTags = []) {
    const wrapper = createHTMLElement('div', {
      className: 'un-tag-input-wrapper',
    });

    const input = createHTMLElement('input', {
      type: 'text',
      id: 'un-tag-input',
      style: `
        border: none;
        outline: none;
        flex: 1;
        min-width: 80px;
        margin-bottom: 0;
      `
    });

    wrapper.addEventListener('click', () => input.focus());
    wrapper.appendChild(input);

    existingTags.forEach(tag => addTagChip(wrapper, tag));

    createTagSuggestions(input, wrapper);

    return wrapper;
  }

  function addTagChip(wrapper, tag) {
    const existing = [...wrapper.querySelectorAll('.un-tag-chip')]
      .map(el => el.dataset.tag.toLowerCase());
    if (existing.includes(tag.toLowerCase())) return;

    const chip = createHTMLElement('span', {
      className: 'un-tag-chip',
      dataset: { tag },
      textContent: tag,
    });

    const removeBtn = createHTMLElement('span', {
      textContent: '×',
      style: 'cursor:pointer; font-weight:bold;',
      eventListener: () => chip.remove()
    });

    chip.appendChild(removeBtn);
    wrapper.insertBefore(chip, wrapper.querySelector('input'));
  }

  // ------------------------
  // Shortcut keys config
  // ------------------------
  function getShortcutFromEvent(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Meta');

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        return;
    }

    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      let mainKey = e.code;

      if (mainKey.startsWith('Key')) mainKey = mainKey.replace('Key', '');
      else if (mainKey.startsWith('Digit')) mainKey = mainKey.replace('Digit', '');
      else if (mainKey === 'Backquote') mainKey = 'Backquote';
      else if (mainKey === 'Space') mainKey = 'Space';
      else mainKey = e.key.toUpperCase();

      parts.push(mainKey);
    }

    return { stored: parts.join('+') };
  }

  function updateShortcutConfig(key, newShortcut) {
    const oldShortcut = getShortcutConfig(key);

    if (!config.shortcuts) {
      config.shortcuts = {};
    }
    config.shortcuts[key] = newShortcut;
    saveConfig(config);

    if (shortcutActions[oldShortcut]) {
      shortcutActions[newShortcut] = shortcutActions[oldShortcut];
      delete shortcutActions[oldShortcut];
    }
  }

  function shortcutToDisplay(shortcut) {
    return shortcut.replace(/Key([A-Z])/, '$1').replace(/Digit(\d)/, '$1');
  }

  function getShortcutConfig(key, forDisplay = false) {
    const shortcutConfig = config.shortcuts || {};

    const stored = shortcutConfig[key] || DEFAULT_SHORTCUT_KEYS[key];
    return forDisplay ? shortcutToDisplay(stored) : stored;
  }

  // ------------------------
  // Profile Management
  // ------------------------
  function getCapabilities() {
    const profile = getCurrentProfile();
    return FluxKit.sync.getCapabilities(profile);
  }

  function isProfileConfigured(profile) { return FluxKit.sync.isConfigured(profile); }

  function getAllProfiles() {
    return config.profiles || [];
  }

  function getCurrentProfileName() {
    return config.currentProfile || getAllProfiles()[0]?.name || null;
  }

  function getCurrentProfile() {
    const profiles = getAllProfiles();
    const current = getCurrentProfileName();
    return (
      profiles.find(p => p.name === current) || { provider: 'Local', name: 'Default' } || null
    );
  }

  async function saveProfile(profile) {
    const profiles = getAllProfiles().filter(p => p.name !== profile.name);
    profiles.push(profile);
    config.profiles = profiles;
    saveConfig(config);
    await syncNotesData(getSnapshot());
    config.currentProfile = profile.name;
    config.notes = [];
    config.trashedNotes = [];
    config.lastSyncTime = null;
    saveConfig(config);
  }

  function updateProfile(profile) {
    const profiles = getAllProfiles().filter(p => p.name !== profile.name);
    profiles.push(profile);
    config.profiles = profiles;
    config.currentProfile = profile.name;
    saveConfig(config);
  }

  // ------------------------
  // Fuzzy match + scoring + highlighting
  // ------------------------
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function rangeIndices(start, len) {
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = start + i;
    return out;
  }

  /**
   * getBestFuzzyInRange(text, term, options)
   * - tries to find the best subsequence match of `term` inside `text`
   * - returns { indices: [...], type: 'exact'|'contiguous'|'fuzzy_word'|'fuzzy_global', span, maxGap }
   * - or null if no acceptable match (given options)
   */
  function getBestFuzzyInRange(text, term, options = {}) {
    if (!text || !term) return null;
    const s = text.toLowerCase();
    const q = term.toLowerCase();
    const qlen = q.length;

    const maxConsecutiveGap = options.maxConsecutiveGap ?? 6;
    const maxTotalSpan = options.maxTotalSpan ?? Math.max(50, qlen * 8);

    // 1) Exact substring - fastest and best
    const idx = s.indexOf(q);
    if (idx !== -1) {
      return {
        indices: rangeIndices(idx, qlen),
        type: 'exact',
        span: qlen - 1,
        maxGap: 1
      };
    }

    // Greedy subsequence search with evaluation of candidates:
    // try each start index where first char matches
    let best = null;
    for (let start = 0; start < s.length; start++) {
      if (s[start] !== q[0]) continue;

      const indices = [start];
      let qi = 1;
      for (let i = start + 1; i < s.length && qi < qlen; i++) {
        if (s[i] === q[qi]) {
          indices.push(i);
          qi++;
        }
      }
      if (qi !== qlen) continue;

      const span = indices[indices.length - 1] - indices[0];
      if (span > maxTotalSpan) continue;

      const gaps = indices.slice(1).map((v, i) => v - indices[i]);
      const maxGap = gaps.length ? Math.max(...gaps) : 0;
      if (maxGap > maxConsecutiveGap) continue;

      // determine if indices fall inside a single word (no whitespace in between)
      const between = s.slice(indices[0], indices[indices.length - 1] + 1);
      const sameWord = !/\s/.test(between);

      // scoring heuristic for choosing best candidate
      // prefer sameWord, tighter span, smaller maxGap
      let score = 0;
      if (sameWord) score += 10000; // very strong boost for whole-word clustering
      score += Math.max(0, 100 - span); // tighter span better
      score += Math.max(0, 100 - maxGap); // smaller gaps better

      if (!best || score > best.score) {
        best = { score, indices, span, maxGap, sameWord };
      }
    }

    if (!best) return null;

    // classify type
    const type = best.sameWord ? 'fuzzy_word' : 'fuzzy_global';
    return { indices: best.indices, type, span: best.span, maxGap: best.maxGap };
  }

  /**
   * findBestMatchForTermAcrossField(fieldText, term, options)
   * - Tries exact/word-local fuzzy/global fuzzy and returns best match or null
   * - Adds small type label for scoring externally
   */
  function findBestMatchForTermAcrossField(fieldText, term, options = {}) {
    if (!fieldText || !term) return null;

    const res = getBestFuzzyInRange(fieldText, term, options);
    if (!res) return null;

    return res; // { indices, type, span, maxGap }
  }

  /**
   * computeNoteScore(note, query, opts)
   * - main function to call from renderNotes
   * - returns { score, matches } where matches is { title: [...], description: [...], tags: [...], url: [...] }
   * - matches collects matched indices for each field so highlighting/snippet generation can use them.
   *
   * Ranking rules (tunable):
   * - type base scores: exact:1000, fuzzy_word:400, fuzzy_global:200
   * - field weights: title:5, description:3, tags:2, url:1
   * - big bonus for number of matched terms (so notes matching more terms rank higher)
   */
  function computeNoteScore(note, query, opts = {}) {
    const options = {
      maxConsecutiveGap: opts.maxConsecutiveGap ?? 6,
      maxTotalSpan: opts.maxTotalSpan ?? Math.max(50, (query || '').length * 8)
    };

    if (!query || !query.trim()) {
      return { score: 0, matches: {}, matchedTermsCount: 0 };
    }

    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return { score: 0, matches: {}, matchedTermsCount: 0 };

    const fieldWeight = {
      title: opts.titleWeight ?? 5,
      description: opts.descriptionWeight ?? 3,
      tags: opts.tagsWeight ?? 2,
      url: opts.urlWeight ?? 1
    };

    const typeBase = { exact: 1000, fuzzy_word: 400, fuzzy_global: 200 };

    // Accumulate match indices
    const matches = { title: [], description: [], tags: {}, url: [] };

    let totalScore = 0;
    let matchedTermsCount = 0;

    // Normalize field strings
    const fieldText = {
      title: (note.title || '').toString(),
      description: (note.description || '').toString(),
      tags: Array.isArray(note.tags) ? note.tags : (note.tags ? [note.tags] : []),
      url: (note.url || '').toString()
    };

    // For each search term
    for (const term of terms) {
      const fieldBest = {}; // best match per field for this term

      // Title, description, url
      for (const field of ['title', 'description', 'url']) {
        const text = fieldText[field];
        if (!text) continue;

        const res = findBestMatchForTermAcrossField(text, term, options);
        if (!res) continue;

        const type = res.type;
        const base = typeBase[type] ?? 0;
        const spanPenalty = Math.max(0, Math.floor(res.span / 2));
        const contribution = (base - spanPenalty) * (fieldWeight[field] || 1);

        if (!fieldBest[field] || contribution > fieldBest[field].contribution) {
          fieldBest[field] = { res, contribution };
        }
      }

      // Tags
      fieldText.tags.forEach((tag, idx) => {
        const res = findBestMatchForTermAcrossField(tag, term, options);
        if (!res) return;

        const type = res.type;
        const base = typeBase[type] ?? 0;
        const spanPenalty = Math.max(0, Math.floor(res.span / 2));
        const contribution = (base - spanPenalty) * (fieldWeight.tags || 1);

        const key = `tag-${idx}`;
        if (!fieldBest[key] || contribution > fieldBest[key].contribution) {
          fieldBest[key] = { res, contribution, tagIndex: idx };
        }
      });

      // Aggregate contributions for all fields this term matched
      let thisTermMatched = false;
      for (const [field, best] of Object.entries(fieldBest)) {
        thisTermMatched = true;
        totalScore += best.contribution;

        if (field.startsWith('tag-')) {
          const tIdx = best.tagIndex;
          if (!matches.tags[tIdx]) matches.tags[tIdx] = [];
          matches.tags[tIdx].push(...best.res.indices);
        } else {
          matches[field] = matches[field].concat(best.res.indices);
        }
      }

      if (thisTermMatched) matchedTermsCount++;
    }

    // Boost for multiple distinct terms
    totalScore += matchedTermsCount * 1500;

    // Deduplicate indices
    for (const f of Object.keys(matches)) {
      if (f === 'tags') continue; // handle separately
      matches[f] = Array.from(new Set(matches[f])).sort((a, b) => a - b);
    }

    if (matches.tags && typeof matches.tags === 'object') {
      for (const idx of Object.keys(matches.tags)) {
        matches.tags[idx] = Array.from(new Set(matches.tags[idx])).sort((a, b) => a - b);
      }
    }

    return { score: totalScore, matches, matchedTermsCount };
  }

  /**
   * highlightWithIndices(text, indicesArray)
   * - Wraps the provided character positions in <mark>, returns escaped HTML string
   * - indicesArray is array of integer character positions (0-based)
   */
  function highlightWithIndices(text, indicesArray = []) {
    if (!text) return '';
    const set = new Set(indicesArray || []);
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const ch = escapeHtml(text[i]);
      if (set.has(i)) out += `<mark>${ch}</mark>`;
      else out += ch;
    }
    return out;
  }

  /**
   * makeSnippetFromIndices(text, indicesArray, length = 80)
   * - Given matched char indices, cluster them and produce a short snippet per cluster,
   *   padding with `length/2` characters (but clipped).
   * - Returns HTML-escaped string with <mark> applied to matched characters.
   */
  function makeSnippetFromIndices(text, indicesArray = [], length = 80) {
    if (!text) return '';
    if (!indicesArray || indicesArray.length === 0) return escapeHtml(text.slice(0, length)) + (text.length > length ? '…' : '');
    const sorted = Array.from(new Set(indicesArray)).sort((a, b) => a - b);

    // cluster adjacent/nearby indices
    const clusters = [];
    let cluster = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] <= 6) {
        cluster.push(sorted[i]);
      } else {
        clusters.push(cluster);
        cluster = [sorted[i]];
      }
    }
    clusters.push(cluster);

    const pad = Math.floor(length / 2);
    const pieces = clusters.map(cl => {
      const first = cl[0];
      const last = cl[cl.length - 1];
      let start = Math.max(0, first - pad);
      let end = Math.min(text.length, last + pad + 1);
      // ensure window length <= length
      if (end - start > length) {
        end = start + length;
      }
      let piece = '';
      for (let i = start; i < end; i++) {
        const ch = escapeHtml(text[i]);
        piece += cl.indexOf(i) !== -1 ? `<mark>${ch}</mark>` : ch;
      }
      if (start > 0) piece = '…' + piece;
      if (end < text.length) piece = piece + '…';
      return piece;
    });

    return pieces.join(' ');
  }

  /**
   * computeScoresForNotes(notesArray, query)
   * - returns an array of { note, scoreMeta } where scoreMeta is computeNoteScore result
   */
  function computeScoresForNotes(notesArray, query, opts = {}) {
    return notesArray.map(n => ({ note: n, scoreMeta: computeNoteScore(n, query, opts) }));
  }

  // ------------------------
  // Tag Management
  // ------------------------
  function getAllTags() {
    const notes = getNotes();
    const tagSet = new Set();
    notes.forEach(note => {
      (note.tags || []).forEach(tag => tagSet.add(tag.trim()));
    });
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }

  function renameTag(oldTag, newTag) {
    const notes = getNotes().map(note => {
      if (note.tags?.includes(oldTag)) {
        note.tags = note.tags.map(t => (t === oldTag ? newTag : t));
      }
      return note;
    });
    config.notes = notes;
    saveConfig(config);
    renderNotes();
    renderTagList();
    showNotification(`Tag "${oldTag}" renamed to "${newTag}"`, { icon: UI_ICONS.refresh });
  }

  function deleteTag(tagToDelete) {
    const notes = getNotes().map(note => {
      if (note.tags?.includes(tagToDelete)) {
        note.tags = note.tags.filter(t => t !== tagToDelete);
      }
      return note;
    });
    config.notes = notes;
    saveConfig(config);
    renderNotes();
    renderTagList();
    showNotification(`Tag "${tagToDelete}" deleted from all notes`, { icon: UI_ICONS.trash });
  }

  function mergeTags(fromTag, toTag) {
    const notes = getNotes().map(note => {
      if (note.tags?.includes(fromTag)) {
        let newTags = note.tags.filter(t => t !== fromTag);
        if (!newTags.includes(toTag)) {
          newTags.push(toTag);
        }
        note.tags = newTags;
      }
      return note;
    });

    config.notes = notes;
    saveConfig(config);
    renderNotes();
    renderTagList();
    showNotification(`Merged "${fromTag}" into "${toTag}"`, { icon: UI_ICONS.merge });
  }

  // ------------------------
  // Undo Buffer
  // ------------------------
  function saveUndoBuffer(note) {
    const trashedNotesRaw = localStorage.getItem('tm_undo_note');
    const trashedNotes = trashedNotesRaw ? JSON.parse(trashedNotesRaw) : [];
    localStorage.setItem('tm_undo_note', JSON.stringify(cleanupUndoBuffer([note, ...trashedNotes])));
  }

  function getUndoBuffer() {
    const raw = localStorage.getItem('tm_undo_note');
    if (!raw) return null;

    const arr = JSON.parse(raw);
    const note = arr.shift();

    localStorage.setItem('tm_undo_note', JSON.stringify(arr));

    return note;
  }

  function cleanupUndoBuffer(trashedNotes = []) {
    if (trashedNotes.length > 20) trashedNotes = trashedNotes.slice(0, 20);
    return trashedNotes;
  }

  function getTagsFromWrapper(wrapper) {
    return [...wrapper.querySelectorAll('.un-tag-chip')].map(el => el.dataset.tag);
  }

  // ------------------------
  // MD Editor
  // ------------------------
  const EASYMDE_SVG_ICONS = {
    // Text Formatting
    'fa-bold': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
    'fa-italic': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
    'fa-strikethrough': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>',
    'fa-header': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M4 18V6"/><path d="M20 18V6"/></svg>',

    // Blocks
    'fa-code': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    'fa-quote-left': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972v11c0 1.25.75 2 2 2h2c0 1 0 2-1 3"/><path d="M13 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2h-4c-1.25 0-2 .75-2 1.972v11c0 1.25.75 2 2 2h2c0 1 0 2-1 3"/></svg>',
    'fa-eraser': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',

    // Lists
    'fa-list-ul': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    'fa-list-ol': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6H2l2.5-2.5V6"/><path d="M3 12.5h1.5A1.5 1.5 0 0 1 6 14v1.5a1.5 1.5 0 0 1-1.5 1.5H3"/><path d="M3 20h2.5"/><path d="M4 19l2-2"/></svg>',
    'fa-check-square-o': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',

    // Inserts
    'fa-link': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    'fa-picture-o': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    'fa-image': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    'fa-table': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/></svg>',
    'fa-minus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',

    // Layout & View
    'fa-eye': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    'fa-columns': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/></svg>',
    'fa-arrows-alt': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',

    // Misc
    'fa-question-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'fa-undo': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    'fa-redo': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
  };

  /**
   * Monitors the toolbar for failed FontAwesome icons and replaces them with SVGs.
   */
  function monitorToolbarIcons(mdeInstance) {
    const testEl = document.createElement('i');
    testEl.className = 'fa fa-bold';
    testEl.style.position = 'absolute';
    testEl.style.visibility = 'hidden';
    document.body.appendChild(testEl);

    setTimeout(() => {
      const isFontBroken = testEl.offsetWidth < 5;
      document.body.removeChild(testEl);

      if (isFontBroken) {
        logMessage('FontAwesome blocked. Injecting SVG fallbacks into EasyMDE...');

        const toolbar = mdeInstance.gui.toolbar;
        if (!toolbar) return;

        toolbar.querySelectorAll('i').forEach(iconElement => {
          if (iconElement.dataset.svgInjected) return;

          const className = Array.from(iconElement.classList).find(c => c.startsWith('fa-'));
          const svgHtml = EASYMDE_SVG_ICONS[className];

          if (svgHtml) {
            const span = document.createElement('span');
            span.className = 'icon-svg-fallback';
            span.innerHTML = safeHTML(svgHtml);

            iconElement.parentNode.insertBefore(span, iconElement);
            iconElement.style.display = 'none';

            iconElement.dataset.svgInjected = 'true';
          }
        });
      }
    }, 1000);
  }

  function injectEasyMdeCSS() {
    const root = getAppRoot();

    // Inject EasyMDE structural CSS
    if (!root.getElementById('easymde-stylesheet')) {
      const style = document.createElement('style');
      style.id = 'easymde-stylesheet';
      style.textContent = GM_getResourceText('easymdeCSS');
      root.appendChild(style);
    }

    // Inject FontAwesome CSS
    if (!root.getElementById('font-awesome-stylesheet')) {
      const faStyle = document.createElement('style');
      faStyle.id = 'font-awesome-stylesheet';
      faStyle.textContent = GM_getResourceText('faCSS');
      root.appendChild(faStyle);
    }
  }

  function toggleMarkdownCheckbox(mdeInstance, checkboxIndex) {
    const rawText = mdeInstance.value();
    let currentMatch = 0;

    // Regex matches: "- [ ]", "* [ ]", "+ [ ]", or "1. [ ]" (and the 'x' variants)
    const taskListRegex = /^(\s*(?:[-*+]|\d+\.)\s+\[)([\sxX])(\])/gm;

    const newText = rawText.replace(taskListRegex, (match, prefix, state, suffix) => {
      if (currentMatch === checkboxIndex) {
        const newState = (state.trim() === '') ? 'x' : ' ';
        currentMatch++;
        return `${prefix}${newState}${suffix}`;
      }
      currentMatch++;
      return match;
    });

    if (newText !== rawText) {
      // Save scroll and cursor so the editor doesn't jump
      const scrollInfo = mdeInstance.codemirror.getScrollInfo();
      const cursor = mdeInstance.codemirror.getCursor();

      mdeInstance.value(newText); // Update the text

      mdeInstance.codemirror.scrollTo(scrollInfo.left, scrollInfo.top);
      mdeInstance.codemirror.setCursor(cursor);
    }
  }

  function getMDEInstance(rootModal, editorTextarea, initialValue) {
    return new EasyMDE({
      element: editorTextarea,
      initialValue: initialValue || '',
      spellChecker: false,
      status: false,
      toolbar: ["bold", "italic", "strikethrough", "|", "heading-1", "heading-2", "heading-3", "|", "unordered-list", "ordered-list", "check-list", "|", "link", "code", "quote", "table", "|", "horizontal-rule", "|", "preview", "side-by-side", "fullscreen"],

      previewRender: function(plainText) {
        const html = this.parent.markdown(plainText);

        const template = document.createElement('template');

        template.innerHTML = safeHTML(html);

        const checkboxes = template.content.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.removeAttribute('disabled'));

        return template.innerHTML;
      },

      onToggleFullScreen: (isFullScreen) => {
        if (isFullScreen) {
          rootModal.classList.add('un-fullscreen-active');
        } else {
          rootModal.classList.remove('un-fullscreen-active');
        }
      }
    });
  }

  // ------------------------
  // Export / Import
  // ------------------------
  /**
   * This exports the lightweight notes.json structure (including base64 thumbnails).
   * Native files in WebDAV/Repo are safely preserved on the server.
   */
  function exportNotes() {
    const notes = getNotes();

    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);

    const a = createHTMLElement('a', { href, download: `notes_backup_${new Date().toISOString().split('T')[0]}.json` });
    a.click();

    URL.revokeObjectURL(href);
    showNotification(`Notes exported!`, { icon: UI_ICONS.export });
  }

  function exportNotesAsMarkdown() {
    const notes = getNotes();
    const md = notes.map(note => {
      let content = `### ${note.title || 'Untitled'}\n` +
            `- 📅 ${new Date(note.createdAt).toLocaleString()}\n` +
            (note.url ? `- 🔗 [${note.url}](${note.url})\n` : '') +
            (note.tags?.length ? `- 🏷️ ${note.tags.join(', ')}\n` : '');

      // UPDATED: Inject Attachment Roster with Relative Links
      if (note.attachments && note.attachments.length > 0) {
        content += `- 📎 Attachments:\n`;
        note.attachments.forEach(a => {
          if (a.storagePath) {
            // Check if it's an image to use the Markdown image embed syntax
            const isImg = a.filename.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
            // Links exactly to the relative asset folder (e.g., ./assets/filename.jpg)
            content += `  - ${isImg ? '!' : ''}[${a.filename}](./${a.storagePath})\n`;
          } else {
            // Fallback for base64 Gist attachments that don't have a file path
            content += `  - ${a.filename} (Embedded)\n`;
          }
        });
      }

      content += `\n${note.description || ''}\n`;
      return content;
    }).join('\n---\n\n');

    const blob = new Blob([md], { type: 'text/markdown' });
    const href = URL.createObjectURL(blob);

    const a = createHTMLElement('a', { href, download: `notes_backup_${new Date().toISOString().split('T')[0]}.md` });
    a.click();

    URL.revokeObjectURL(href);
    showNotification(`Notes exported as Markdown!`, { icon: UI_ICONS.export });
  }

  function exportNotesAsCSV() {
    const notes = getNotes();
    const rows = [
      // Added 'attachments' column
      ['id', 'title', 'description', 'url', 'tags', 'attachments', 'createdAt'],
      ...notes.map(note => {
        // Safely extract filenames
        const attNames = (note.attachments || []).map(a => a.filename).join('; ');

        return [
          note.id,
          JSON.stringify(note.title || ''),
          JSON.stringify(note.description || ''),
          note.url || '',
          (note.tags || []).join('; '),
          JSON.stringify(attNames), // Stringified to protect against commas in filenames
          note.createdAt
        ];
      })
    ];

    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const href = URL.createObjectURL(blob);

    const a = createHTMLElement('a', { href, download: `notes_backup_${new Date().toISOString().split('T')[0]}.csv` });
    a.click();

    URL.revokeObjectURL(href);
    showNotification(`Notes exported as CSV!`, { icon: UI_ICONS.export });
  }

  function importNotes(file, mode = 'merge') {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedNotes = JSON.parse(e.target.result);
        if (!Array.isArray(importedNotes)) throw new Error('Invalid file format');

        // 1. Silently upgrade V1 schemas (hasImage) to V2 (attachments)
        migrateNoteFormat(importedNotes);

        const capabilities = getCapabilities();
        let nativeDowngradeCount = 0;

        // 2. Cross-Grade Sanitation
        importedNotes.forEach(note => {
          if (note.attachments) {
            note.attachments.forEach(att => {
              // If importing into Gist from WebDAV
              if (capabilities.requiresBatchedBase64 && att.providerStorage === 'native') {
                att.providerStorage = 'base64';
                att.storagePath = null; // Strip the irrelevant server path
                nativeDowngradeCount++;
              }
            });
          }
        });

        if (mode === 'overwrite') {
          config.notes = importedNotes;
          saveConfig(config);
          renderNotes();
          showNotification(`Notes overwritten from import!`, { icon: UI_ICONS.document });
        } else {
          const allNotes = [...getNotes()];
          const merged = [...allNotes];

          importedNotes.forEach(note => {
            if (!merged.some(n => n.id === note.id)) {
              merged.push(note);
            }
          });

          config.notes = merged;
          saveConfig(config);
          renderNotes();
          showNotification(`Notes imported and merged!`, { icon: UI_ICONS.import });
        }

        // 3. Notify the user if we had to sever high-res links during migration
        if (nativeDowngradeCount > 0) {
          setTimeout(() => {
            showNotification(`Note: ${nativeDowngradeCount} native file links were converted for Gist compatibility.`, { icon: UI_ICONS.info });
          }, 2500);
        }

      } catch (err) {
        alert('Failed to import notes: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ------------------------
  // Size / Storage
  // ------------------------
  function estimateSize(obj) {
    return JSON.stringify(obj).length;
  }

  function getStorageUsage(files) {
    let totalBytes = 0;
    for (const file of Object.values(files)) {
      if (file.content) totalBytes += file.content.length;
    }
    return {
      bytes: totalBytes,
      mb: (totalBytes / 1024 / 1024).toFixed(2),
    };
  }

  function calculateStorageUsage() {
    try {
      const notes = getNotes() || [];
      const trashed = config.trashedNotes || [];
      const notesJson = JSON.stringify({ notes, trashed });
      const notesBytes = new Blob([notesJson]).size;

      const mbUsed = notesBytes / (1024 * 1024);
      const limit = config.storageLimitMB || 20;
      const percent = Math.min(100, (mbUsed / limit) * 100);

      const status =
        percent >= 100 ? 'over' :
        percent >= 90 ? 'critical' :
        percent >= 80 ? 'warning' :
        'ok';

      return { usedMB: mbUsed, limitMB: limit, percent, status };
    } catch (err) {
      logError('Storage calculation failed:', err);
      return { usedMB: 0, limitMB: config.storageLimitMB || 20, percent: 0, status: 'ok' };
    }
  }

  function checkStorageWarning() {
    const { usedMB, limitMB, status } = calculateStorageUsage();
    if (status === 'warning') {
      showNotification(`Storage nearing limit. Consider deleting older notes or images.`, { icon: UI_ICONS.warning });
    } else if (status === 'critical') {
      showNotification(`Critically low storage! Cleanup recommended.`, { icon: UI_ICONS.warning });
    } else if (status === 'over') {
      showNotification(`Storage limit exceeded! Sync may fail until space is freed.`, { icon: UI_ICONS.ban });
    }
  }

  function updateStorageUsageDisplay() {
    const el = unQuery('.un-modal #storage-usage');
    if (!el) return;
    const { usedMB, limitMB, percent } = calculateStorageUsage();
    el.innerHTML = safeHTML(`
      💾 Storage used: <strong>${usedMB.toFixed(2)} MB</strong> / ${limitMB} MB
      <div style="background: var(--bg-muted); height:6px; border-radius:4px; overflow:hidden; margin-top:4px;">
        <div style="
          width:${percent}%;
          height:100%;
          background:${percent > 90 ? '#e74c3c' : percent > 70 ? '#f39c12' : '#2ecc71'};
          transition: width 0.3s ease;
        "></div>
      </div>
    `);
  }

  // ------------------------
  // Data Sync
  // ------------------------
  FluxKit.sync.setTokenRefreshCallback((updatedProfile) => {
      updateProfile(updatedProfile);
  });

  function computeHash(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
  }

  function allocateImageToFile(attId, imageData, imageMap, meta) {
    const serialized = JSON.stringify({ [attId]: imageData });
    const size = serialized.length;
    const MAX_BATCH_SIZE = 4 * 1024 * 1024;

    // Find the file with minimum current size that fits
    const candidateFiles = Object.entries(imageMap)
      .filter(([_, data]) => JSON.stringify(data).length + size < MAX_BATCH_SIZE)
      .sort((a, b) => JSON.stringify(a[1]).length - JSON.stringify(b[1]).length);

    if (candidateFiles.length > 0) {
      const [fileName, fileData] = candidateFiles[0];
      fileData[attId] = imageData;
      return fileName;
    }

    // Create new file if none fits
    const newFile = `images_${Object.keys(imageMap).length + 1}.json`;
    imageMap[newFile] = { [attId]: imageData };
    meta.imageFiles = [...new Set([...(meta.imageFiles || []), newFile])];
    return newFile;
  }

  function purgeOrphanedImages(imageMap, activeNotes) {
    const activeIds = new Set();
    activeNotes.forEach(n => {
      activeIds.add(n.id); // Legacy mapping protection
      if (n.attachments) n.attachments.forEach(a => activeIds.add(a.id));
    });

    for (const [fileName, data] of Object.entries(imageMap)) {
      if (!data || typeof data !== 'object') continue;
      for (const id of Object.keys(data)) {
        if (!activeIds.has(id)) delete data[id];
      }
    }
  }

  function buildImageUploadPayload(localImages, remoteImages) {
    const changedFiles = {};

    const allFileNames = new Set([...Object.keys(localImages), ...Object.keys(remoteImages)]);

    for (const fileName of allFileNames) {
      const localData = localImages[fileName] || {};
      const remoteData = remoteImages[fileName] || {};

      const allKeys = new Set([...Object.keys(localData), ...Object.keys(remoteData)]);
      const changed = [...allKeys].some(id => {
        const localVal = localData[id];
        const remoteVal = remoteData[id];
        return (localVal === undefined || remoteVal === undefined || computeHash(localVal) !== computeHash(remoteVal));
      });

      if (changed) {
        if (Object.keys(localData).length === 0) changedFiles[fileName] = { content: "" };
        else changedFiles[fileName] = { content: JSON.stringify(localData, null, 2) };
      }
    }

    return changedFiles;
  }

  function cleanupTrashedNotes(trashedNotes, allNotes) {
    const now = Date.now();
    const cutoff = now - DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const activeIds = new Set(allNotes.map(n => n.id));
    return trashedNotes.filter(d => (new Date(d.trashedAt).getTime() > cutoff) || activeIds.has(d.id));
  }

  function purgeTrashedNoteImages(imageMap, trashedNotes) {
    if (!Array.isArray(trashedNotes) || trashedNotes.length === 0) return;

    const trashedIds = new Set(trashedNotes.map(d => d.id).filter(Boolean));
    if (trashedIds.size === 0) return;

    for (const data of Object.values(imageMap)) {
      if (!data || typeof data !== 'object') continue;
      for (const id of Object.keys(data)) {
        if (trashedIds.has(id)) delete data[id];
      }
    }
  }

  function cleanupEmptyImageFiles(imageMap, meta) {
    for (const [fileName, data] of Object.entries(imageMap)) {
      if (!Object.keys(data).length) {
        delete imageMap[fileName];
        meta.imageFiles = (meta.imageFiles || []).filter(f => f !== fileName);
      }
    }
  }

  function collectMetaStats(imageMap, notesFile, metaFile) {
    const totalImages = Object.values(imageMap).reduce((sum, m) => sum + Object.keys(m).length, 0);
    const totalImageFiles = Object.keys(imageMap).length;
    const totalBytes = estimateSize(imageMap) + (notesFile?.content?.length || 0) + (metaFile?.content?.length || 0);
    return { totalImages, totalImageFiles, totalBytes, usedMB: (totalBytes / 1024 / 1024).toFixed(2) };
  }

  function ensureID(note) {
    if (!note.id) note.id = generateId();
    return note.id;
  }

  async function syncNotesData(snapshot = true) {
    window.activeSyncs = window.activeSyncs || new Set();

    let hasSnapshot = null, showMessages = true, fireAndForget = false;
    if (typeof snapshot === 'object' && snapshot !== null) {
      hasSnapshot = snapshot.profile && snapshot.notes && snapshot.trashedNotes && snapshot.config;
      showMessages = snapshot.showMessages ?? true; fireAndForget = snapshot.fireAndForget ?? false;
    } else showMessages = snapshot;

    if (!hasSnapshot) snapshot = { ...getSnapshot(), showMessages, fireAndForget };

    const { profile, notes, trashedNotes, config: cfg } = snapshot;

    if (window.activeSyncs.has(profile.name)) {
      logMessage(`Sync already in progress for ${profile.name}, ignoring.`);
      return;
    }

    const executeSync = async () => {
      window.activeSyncs.add(profile.name);
      updateSyncIndicatorUI();

      const unloadWarning = (e) => {
        e.preventDefault();
        e.returnValue = `Sync in progress. Closing this tab may corrupt your files!`;
      };
      if (window.activeSyncs.size === 1) window.addEventListener('beforeunload', unloadWarning);

      try {
        if (!isProfileConfigured(profile)) {
          const isLocalProvider = profile.provider === 'Local';
          const isBlankDefault = !profile.provider && !profile.token;

          if (showMessages && !isLocalProvider && !isBlankDefault) {
            showNotification(`Storage profile "${profile.name}" not configured properly.`, { icon: UI_ICONS.warning });
          }
          return;
        }

        const syncData = await FluxKit.sync.fetch(profile);
        const files = syncData.files || {};

        let meta = {};
        try { meta = JSON.parse(files["meta.json"]?.content || "{}"); } catch {}
        const TOTAL_QUOTA = meta.totalQuota || MAX_GIST_TOTAL_SIZE;

        const remoteNotes = JSON.parse(files["notes.json"]?.content || "[]");
        migrateNoteFormat(remoteNotes);

        const remoteTrashed = meta.trashedNotes || [];
        const remoteImages = {};
        for (const fileName of meta.imageFiles || Object.keys(files).filter(f => f.startsWith("images_"))) {
          try { remoteImages[fileName] = JSON.parse(files[fileName]?.content || "{}"); }
          catch { logWarning("Invalid image file:", fileName); }
        }

        const mergedNotes = mergeNotes(notes, remoteNotes, trashedNotes, remoteTrashed, cfg.lastSyncTime);
        const mergedTrashed = mergeTrashedLists(trashedNotes, remoteTrashed);
        const cleanedTrashed = cleanupTrashedNotes(mergedTrashed, mergedNotes);

        const localImageMap = structuredClone(remoteImages);
        const nativeFilesToUpload = {};
        const blobsToClearFromDB = [];

        for (const note of mergedNotes) {
          note.id = ensureID(note);

          if (note.attachments) {
            for (const att of note.attachments) {

              // 1. Restore runtime data for UI display if missing (Thumbnails)
              if (!att.data && att.thumbnailFile && localImageMap[att.thumbnailFile]?.[att.id]) {
                att.data = localImageMap[att.thumbnailFile][att.id];
              }
              // Legacy fallback
              else if (!att.data && note.imageFile && localImageMap[note.imageFile]?.[note.id]) {
                att.data = localImageMap[note.imageFile][note.id];
              }

              // 2. Process NEW thumbnails/base64 payloads
              if (att.data && att.data.startsWith('data:image/') && !att.thumbnailFile) {
                att.thumbnailFile = allocateImageToFile(att.id, att.data, localImageMap, meta);
              }

              // 3. Process Native Blob Uploads
              if (att.providerStorage === 'native') {
                try {
                  const rawBlob = await getQueuedUpload(att.id);
                  if (rawBlob) {
                    // Prepend assets/ directory to keep file system organized!
                    att.storagePath = `assets/${att.id}_${att.filename.replace(/\s+/g, '_')}`;
                    nativeFilesToUpload[att.storagePath] = { content: rawBlob };
                    blobsToClearFromDB.push(att.id); // Queue for cleanup
                  }
                } catch (e) {
                  logWarning("Could not load local blob for", att.id);
                }
              }
            }
          }
        }

        purgeOrphanedImages(localImageMap, mergedNotes);
        purgeTrashedNoteImages(localImageMap, cleanedTrashed);
        cleanupEmptyImageFiles(localImageMap, meta);

        const newNotes = mergedNotes.map(n => {
          const clone = structuredClone(n);
          if (clone.attachments) clone.attachments.forEach(a => delete a.data);
          delete clone.screenshot; delete clone.hasImage; delete clone.imageFile;
          return clone;
        });

        const newNotesContent = JSON.stringify(newNotes, null, 2);
        const newMeta = {
          ...meta,
          version: 2,
          totalQuota: TOTAL_QUOTA,
          imageFiles: Object.keys(localImageMap),
          trashedNotes: cleanedTrashed,
          lastUpdated: new Date().toISOString(),
          imageStats: collectMetaStats(localImageMap, files["notes.json"], files["meta.json"]),
        };

        const changedImages = buildImageUploadPayload(localImageMap, remoteImages);
        const changedNotes = newNotesContent !== (files["notes.json"]?.content || "");
        const changedMeta = JSON.stringify(newMeta) !== JSON.stringify(meta);

        const filesToUpload = {};
        if (changedNotes) filesToUpload["notes.json"] = { content: newNotesContent };
        if (changedMeta) filesToUpload["meta.json"] = { content: JSON.stringify(newMeta, null, 2) };

        Object.assign(filesToUpload, changedImages);
        Object.assign(filesToUpload, nativeFilesToUpload);

        if (Object.keys(filesToUpload).length === 0) {
          if (showMessages) showNotification(`Everything already synced!`, { icon: UI_ICONS.success });

          const currentProfile = getCurrentProfile();
          if (currentProfile.name === profile.name) {
            config.notes = mergedNotes;
            config.trashedNotes = cleanedTrashed;
            config.lastSyncTime = new Date().toISOString();

            saveConfig(config);
          }
          return;
        }

        meta.imageFiles = Object.keys(localImageMap);

        try {
          await FluxKit.sync.upload(profile, filesToUpload);

          for (const id of blobsToClearFromDB) {
            await removeQueuedUpload(id);
          }
        } catch (err) {
          if (err.message.includes('QUOTA_EXCEEDED')) {
             showNotification(err.message, { icon: UI_ICONS.warning });
             return;
          }
          throw err;
        }

        const currentProfile = getCurrentProfile();
        if (currentProfile.name === profile.name) {
          config.notes = mergedNotes;
          config.trashedNotes = cleanedTrashed;
          config.lastSyncTime = new Date().toISOString();

          saveConfig(config);
        }

        cacheProfileData(profile.name, mergedNotes, cleanedTrashed, new Date().toISOString());
        prunePreviewCache();

        if (showMessages) {
          const usage = collectMetaStats(localImageMap, filesToUpload["notes.json"] || {content:""}, filesToUpload["meta.json"] || {content:""});
          showNotification(`Sync complete for ${currentProfile.name} (${usage.usedMB}MB used).`, { icon: UI_ICONS.success });
        }
      } catch (err) {
        logError("Sync error:", err);
        if (showMessages) showNotification(`Sync failed. Check Gist settings or connection.`, { icon: UI_ICONS.error });
      } finally {
        window.activeSyncs.delete(profile.name);
        if (window.activeSyncs.size === 0) {
          window.removeEventListener('beforeunload', unloadWarning);
        }
        updateSyncIndicatorUI();
      }
    };

    if (fireAndForget) executeSync();
    else await executeSync();
  }

  function mergeNotes(localNotes, remoteNotes, localTrashed = [], remoteTrashed = [], lastSyncTimeStr = 0) {
    const map = new Map();
    const lastSyncTime = new Date(lastSyncTimeStr).getTime();

    // 1. Build Trashed Map
    const trashedMap = new Map();
    [...localTrashed, ...remoteTrashed].forEach(d => {
      const existing = trashedMap.get(d.id);
      if (!existing || new Date(d.trashedAt) > new Date(existing.trashedAt)) {
        trashedMap.set(d.id, d);
      }
    });

    // 2. Map remote notes for O(1) lookup
    const remoteMap = new Map(remoteNotes.map(n => [n.id, n]));

    for (const localNote of localNotes) {
      const id = localNote.id || crypto.randomUUID();

      // Skip if deleted
      const deletion = trashedMap.get(id);
      if (deletion && new Date(deletion.trashedAt) > new Date(localNote.updatedAt || localNote.createdAt)) {
        continue;
      }

      const remoteNote = remoteMap.get(id);

      if (!remoteNote) {
        // Exists locally but not remotely (new local note)
        map.set(id, localNote);
        continue;
      }

      const localTime = new Date(localNote.updatedAt || localNote.createdAt || 0).getTime();
      const remoteTime = new Date(remoteNote.updatedAt || remoteNote.createdAt || 0).getTime();

      const localChangedSinceSync = localTime > lastSyncTime;
      const remoteChangedSinceSync = remoteTime > lastSyncTime;

      if (localChangedSinceSync && remoteChangedSinceSync && localTime !== remoteTime) {
        logMessage(`⚠️ Conflict detected for note: ${localNote.title}`);

        map.set(id, remoteNote);

        const forkedNote = structuredClone(localNote);
        forkedNote.id = generateId();
        forkedNote.title = `${forkedNote.title || 'Note'} (Conflicted copy)`;
        forkedNote.updatedAt = new Date().toISOString();
        forkedNote.isConflict = true;

        map.set(forkedNote.id, forkedNote);
      } else {
        map.set(id, remoteTime > localTime ? remoteNote : localNote);
      }

      remoteMap.delete(id);
    }

    // 3. Add remaining remote notes (new notes from other devices)
    for (const remoteNote of remoteMap.values()) {
      const deletion = trashedMap.get(remoteNote.id);
      if (deletion && new Date(deletion.trashedAt) > new Date(remoteNote.updatedAt || remoteNote.createdAt)) {
        continue;
      }
      map.set(remoteNote.id, remoteNote);
    }

    // Sort by latest update
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );
  }

  function mergeTrashedLists(localTrashed, remoteTrashd) {
    const map = new Map();
    [...localTrashed, ...remoteTrashd].forEach(d => {
      const existing = map.get(d.id);
      if (!existing || new Date(d.trashedAt) > new Date(existing.trashAt)) {
        map.set(d.id, d);
      }
    });
    return Array.from(map.values());
  }

  async function triggerBackgroundSync() {
    const profile = getCurrentProfile();

    if (!isProfileConfigured(profile) || window.isSyncing) return;

    logMessage('Pushing recent save to cloud...');

    try {
      await syncNotesData({ showMessages: false, fireAndForget: true });
    } catch (err) {
      logWarning('Background push failed:', err);
    }
  }

  async function attemptAutoSync() {
    const profile = getCurrentProfile();
    if (!isProfileConfigured(profile)) return;

    const interval =
      profile.syncFrequency
        ? SYNC_FREQUENCIES[profile.syncFrequency] ?? SYNC_FREQUENCIES['Every day']
        : SYNC_FREQUENCIES['Every day'];

    if (interval === 0) return;

    const now = Date.now();
    const lastSync = new Date(config.lastSyncTime || 0).getTime();
    const elapsed = now - lastSync;

    if (elapsed >= interval) {
      logMessage('⏳ Running auto-sync...');
      await syncNotesData(false);
    }
  }

  function startAutoSyncScheduler() {
    clearInterval(window.autoSyncTimer);
    const profile = getCurrentProfile();
    if (!isProfileConfigured(profile)) return;

    const interval =
      profile.syncFrequency
        ? SYNC_FREQUENCIES[profile.syncFrequency] ?? SYNC_FREQUENCIES['Every day']
        : SYNC_FREQUENCIES['Every day'];

    if (interval === 0) return;

    attemptAutoSync();
    window.autoSyncTimer = setInterval(attemptAutoSync, interval);
  }

  function getSnapshot() {
    return {
      profile: getCurrentProfile(),
      notes: structuredClone(getNotes().map(note => { return { ...note, id: ensureID(note) }})),
      trashedNotes: structuredClone(config.trashedNotes) || [],
      config: structuredClone(config),
      showMessages: false,
      fireAndForget: true
    };
  }

  async function switchProfile(newProfileName) {
    try {
      const oldProfileName = getCurrentProfileName();
      const currentProfile = getCurrentProfile();
      const newProfile = getAllProfiles().find(p => p.name === newProfileName);

      if (!newProfile) {
        showNotification(`Selected profile not found.`, { icon: UI_ICONS.warning });
        return;
      }

      if (oldProfileName === newProfileName) {
        showNotification("Already using this profile.");
        return;
      }

      if (isProfileConfigured(currentProfile)) {
        showNotification(`Saving "${currentProfile.name}" in background...`, { icon: UI_ICONS.save });
        try {
          const backupSnapshot = getSnapshot();

          syncNotesData({ ...backupSnapshot, fireAndForget: true, showMessages: false })
            .catch(err => logWarning("Background backup failed:", err));
        } catch (backupErr) {
          logWarning("Failed to initiate background backup...", backupErr);
        }
      }

      config.currentProfile = newProfileName;

      const cached = loadCachedProfileData(newProfileName);
      if (cached) {
        config.notes = cached.notes;
        config.trashedNotes = cached.trashedNotes;
        config.lastSyncTime = cached.lastSyncTime;
        showNotification(`Loaded "${newProfileName}" from local cache.`, { icon: UI_ICONS.zap });
      } else {
        config.notes = [];
        config.trashedNotes = [];
        config.lastSyncTime = null;
      }

      saveConfig(config);
      renderNotes();

      showNotification(`Switched to "${newProfileName}".`, { icon: UI_ICONS.success });
      try {
        await syncNotesData({ ...getSnapshot(), fireAndForget: false, showMessages: true });
        startAutoSyncScheduler();
      } catch (syncErr) {
        logWarning("Initial fetch for new profile failed.", syncErr);
        showNotification(`Switched to "${newProfileName}", but sync failed.`, { icon: UI_ICONS.warning });
      }

    } catch (err) {
      logError("Profile switch failed completely:", err);
      showNotification(`Failed to switch profile.`, { icon: UI_ICONS.error });
    }
  }

  function getProfileCacheKey(profileName) {
    return `un_profile_cache_${profileName}`;
  }

  function cacheProfileData(profileName, notes, trashedNotes, lastSyncTime) {
    try {
      const data = { notes, trashedNotes, lastSyncTime, cachedAt: Date.now() };
      GM_setValue(getProfileCacheKey(profileName), data);
    } catch (err) {
      logWarning("Failed to cache profile data:", err);
    } finally {
      cleanupOldProfileCaches();
    }
  }

  function loadCachedProfileData(profileName, maxAgeHours = 24) {
    try {
      const data = GM_getValue(getProfileCacheKey(profileName));
      if (!data) return null;

      const age = (Date.now() - (data.cachedAt || 0)) / 36e5;
      if (age > maxAgeHours) {
        logMessage(`Cache for "${profileName}" expired (${age.toFixed(1)}h old).`);
        return null;
      }
      return data;
    } catch (err) {
      logWarning("Failed to load cached profile data:", err);
      return null;
    }
  }

  async function cleanupOldProfileCaches(maxAgeDays = 7) {
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    const validProfiles = new Set(getAllProfiles().map(p => p.name));

    const keys = await GM_listValues();
    for (const key of keys) {
      if (key.startsWith("un_profile_cache_")) {
        try {
          const data = await GM_getValue(key);
          const cache = typeof data === "string" ? JSON.parse(data) : data || {};
          const age = now - (cache.cachedAt || 0);
          const profileName = key.replace("un_profile_cache_", "");

          if (age > maxAgeMs || !validProfiles.has(profileName)) {
            logMessage(`Removing old cache for "${profileName}"`);
            await GM_deleteValue(key);
          }
        } catch {
          await GM_deleteValue(key);
        }
      }
    }
  }

  // ------------------------
  // Attachments
  // ------------------------
  let isScreenshotHelperInstalled = false;

  function toggleShadowHostVisibility(visible) {
    const host = document.getElementById('un-shadow-host');
    if (host) host.style.visibility = visible ? 'visible' : 'hidden';
  }

  function injectPageListener(uniqueId) {
    const code = `
      window.addEventListener("message", function(event) {
        if (event.source !== window) return;
        if (event.data && event.data.type === "FLUX_SCREENSHOT_RESPONSE" && event.data.id === "${uniqueId}") {
          const customEvent = new CustomEvent("FLUX_SCREENSHOT_TRANSFER_${uniqueId}", {
            detail: event.data.dataUrl
          });
          document.dispatchEvent(customEvent);
        }
      });
    `;

    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    document.documentElement.appendChild(createHTMLElement('script', { src: url, eventListener: { onload: () => URL.revokeObjectURL(url) } }));
  }

  // Converts a base64 Data URL directly to a binary Blob
  function dataURLtoBlob(dataurl) {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
  }

  function openScreenshotPreview(src, onClose = null) {
    const existing = getAppRoot().querySelector('#un-screenshot-backdrop');
    if (existing) return;

    const img = createHTMLElement('img', {
      id: 'un-screenshot-preview',
      src,
      eventListener: {
        click: (e) => {
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey) {
            fetch(src)
              .then(res => res.blob())
              .then(blob => {
                const blobUrl = URL.createObjectURL(blob);
                window.open(blobUrl, '_blank');
              });
            return;
          }
        }
      }
    });

    const backdrop = createHTMLElement('div', {
      id: 'un-screenshot-backdrop',
      children: [img],
      eventListener: {
        click: () => {
          backdrop.remove();
          if (typeof onClose === 'function') onClose();
        }
      },
    });
    getAppRoot().appendChild(backdrop);
  }

  async function getAttachmentData(att) {
    if (att.providerStorage !== 'native') {
      logMessage(`Returning embedded data as provider doesn't support native files.`);
      return att.data;
    }

    try {
      const queuedBlob = await getQueuedUpload(att.id);
      logDebug(`Checking attachment in QueuedUpload DB.`);
      if (queuedBlob) return queuedBlob;

      const cachedBlob = await getCachedPreview(att.id);
      logDebug(`Checking attachment in CachedPreview DB.`);
      if (cachedBlob) return cachedBlob;

      if (!att.storagePath) {
        logDebug(`Returning embedded data as storagePath is not configured.`);
        return att.data;
      }

      logDebug(`Fetching attachment from provider storage: ${att.storagePath}`);
      const fetchRes = await FluxKit.sync.fetch(getCurrentProfile(), { filename: att.storagePath });

      if (fetchRes && fetchRes.files && fetchRes.files[att.storagePath]) {
        const fetchedData = fetchRes.files[att.storagePath].content;

        const blobToCache = fetchedData instanceof Blob
          ? fetchedData
          : new Blob([fetchedData], { type: 'text/plain' });

        await cacheAttachmentForPreview(att.id, blobToCache);
        return fetchedData;
      }
    } catch (e) {
      logError("Failed to fetch attachment data:", e);
    }

    return att.data;
  }

  /******** Thumbnail Generator ********/
  async function generateThumbnail(imageBlob, maxSize = 150) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(imageBlob);

      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        if (width > height && width > maxSize) {
          height *= maxSize / width; width = maxSize;
        } else if (height > maxSize) {
          width *= maxSize / height; height = maxSize;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to generate thumbnail'));
      };

      img.src = url;
    });
  }

  function compressImage(dataUrl, maxWidth = 1600, quality = 0.85, minQuality = 0.3) {
    return new Promise((resolve) => {
      if (dataUrl.length < 150000) {
        return resolve(dataUrl);
      }

      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const width = img.width * scale;
        const height = img.height * scale;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        quality = Math.min(1, Math.max(minQuality, quality));

        let mime = 'image/jpeg';
        const testCanvas = document.createElement('canvas');
        const testCtx = testCanvas.getContext('2d');
        if (testCtx && canvas.toDataURL('image/webp').startsWith('data:image/webp')) {
          mime = 'image/webp';
        }

        const compressed = canvas.toDataURL(mime, quality);

        const THRESHOLD = 0.90;
        if (compressed.length < dataUrl.length * THRESHOLD) {
          resolve(compressed);
        } else {
          resolve(dataUrl);
        }
      };

      img.onerror = () => {
        logWarning('Image failed to load for compression');
        resolve(dataUrl);
      };

      img.src = dataUrl;
    });
  }

  function requestNativeScreenshot(callback, retries = 3, delay = 2000) {
    logMessage('Requesting screenshot');

    const uniqueId = 'un-' + getUniqueId();

    let timeoutId;

    function handleMessage(event) {
      toggleShadowHostVisibility(true);
      clearTimeout(timeoutId);
      document.removeEventListener(`FLUX_SCREENSHOT_TRANSFER_${uniqueId}`, handleMessage);

      if (event.detail) {
        logMessage('Screenshot received');
        callback(event.detail);
      } else if (retries > 0) {
        logWarning(`Retrying screenshot... Attempts left: ${retries}`);
        setTimeout(() => requestNativeScreenshot(callback, retries - 1, delay * 2), delay);
      } else {
        logMessage(`${UI_ICONS.error} Screenshot failed after retries.`);
        showNotification(`Screenshot capture failed.`, { icon: UI_ICONS.warning });
        callback(null);
      }
    }

    timeoutId = setTimeout(() => {
      toggleShadowHostVisibility(true);
      logMessage(`${UI_ICONS.error} Failed to capture screenshot or injection was blocked.`);
      showNotification(`Screenshot request timed out`, { icon: UI_ICONS.warning });
      document.removeEventListener(
        `FLUX_SCREENSHOT_TRANSFER_${uniqueId}`,
        handleMessage
      );

      if (retries > 0) {
        logWarning(`Timeout. Retrying screenshot... Attempts left: ${retries}`);
        setTimeout(() => requestNativeScreenshot(callback, retries - 1, delay * 2), delay);
      } else {
        logMessage(`Screenshot timed out after all retries.`, { icon: UI_ICONS.error });
        showNotification(`Screenshot request timed out.`, { icon: UI_ICONS.warning });
        callback(null);
      }
    }, delay);

    injectPageListener(uniqueId);

    document.addEventListener(
      `FLUX_SCREENSHOT_TRANSFER_${uniqueId}`,
      handleMessage
    );

    toggleShadowHostVisibility(false);
    setTimeout(() => window.postMessage({ type: 'FLUX_CAPTURE_SCREENSHOT', id: uniqueId }, '*'), 500);
  }

  // ------------------------
  // Listeners
  // ------------------------
  GM_addValueChangeListener(STORAGE_KEY, (key, oldValue, newValue, remote) => {
    if (remote) {
      config = newValue;
      window.FluxNotes = config;
      logMessage('🔄 Config updated from another tab or site:', config);
      const viewModal = $(MODAL_IDS.VIEW);
      if (viewModal) {
        openViewModal();
      }
    }
  });

  let shortcutActions = {
    [getShortcutConfig('add')]: () => {
      openNoteModal({
        title: '',
        description: window.getSelection().toString().trim(),
        url: window.location.href,
        tags: [],
        screenshot: null,
      });
    },
    [getShortcutConfig('view')]: () => {
      openViewModal();
    },
    [getShortcutConfig('settings')]: () => {
      openSettingsModal();
    },
    [getShortcutConfig('toggleTheme')]: () => {
      tempThemeSwitch = true;
      applyTheme(darkMode ? 'light' : 'dark');
      logMessage('[Note Modal] Theme toggled to:', darkMode ? 'Dark' : 'Light');
    },
    [getShortcutConfig('bookmarkNote')]: () => {
      createBookmarkNote();
    },
    [getShortcutConfig('toggleTheme')]: () => {
      tempThemeSwitch = true;
      applyTheme(darkMode ? 'light' : 'dark');
      logMessage('[Note Modal] Theme toggled to:', darkMode ? 'Dark' : 'Light');
    },
    [getShortcutConfig('quickNote')]: () => {
      openQuickNoteModal();
    },
  };

  function handleShortcut(e) {
    if (window.activeUnPadInstance && window.activeUnPadInstance.claimsKey(e)) return;
    if (isShorcutUpdating || ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) {
      return;
    }

    if (e.key === 'Escape') {
      const fullscreenScreenshot = $('un-screenshot-backdrop');
      if (fullscreenScreenshot) {
        fullscreenScreenshot.remove();
        return;
      }
      const modals = [ $(MODAL_IDS.NOTE), $(MODAL_IDS.VIEW), $(MODAL_IDS.SETTINGS) ];
      modals.forEach(modal => closeModal(modal));
    }

    shortcutActions = {
      [getShortcutConfig('add')]: () => {
        openNoteModal({
          title: '',
          description: window.getSelection().toString().trim(),
          url: window.location.href,
          tags: [],
          screenshot: null,
        });
      },
      [getShortcutConfig('view')]: () => {
        openViewModal();
      },
      [getShortcutConfig('settings')]: () => {
        openSettingsModal();
      },
      [getShortcutConfig('toggleTheme')]: () => {
        tempThemeSwitch = true;
        applyTheme(darkMode ? 'light' : 'dark');
        logMessage('[Note Modal] Theme toggled to:', darkMode ? 'Dark' : 'Light');
      },
      [getShortcutConfig('bookmarkNote')]: () => {
        createBookmarkNote();
      },
      [getShortcutConfig('toggleTheme')]: () => {
        tempThemeSwitch = true;
        applyTheme(darkMode ? 'light' : 'dark');
        logMessage('[Note Modal] Theme toggled to:', darkMode ? 'Dark' : 'Light');
      },
      [getShortcutConfig('quickNote')]: () => {
        openQuickNoteModal();
      },
    };

    const { stored } = getShortcutFromEvent(e);
    if (stored && shortcutActions[stored]) {
      e.preventDefault();
      e.stopPropagation();
      shortcutActions[stored]();
    }
  }

  waitForBody(() => {
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "FLUX_HANDSHAKE_FULFILLED") {
        isScreenshotHelperInstalled = true;
        logMessage('✅ Flux Screenshot extension detected.');
      }
    });

    applyTheme();
    attemptAutoSync();
    createEdgeDock();
    window.addEventListener('focus', () => attemptAutoSync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') attemptAutoSync();
    });

    window.postMessage({ type: "FLUX_HANDSHAKE_INITIATED" }, "*");
    window.addEventListener('keydown', handleShortcut, true);
  });
})();