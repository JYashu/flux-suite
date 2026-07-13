// ==UserScript==
// @name         Flux Notes
// @namespace    https://github.com/JYashu/flux-suite
// @version      8.3.0
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
// @resource     easymdeCSS https://unpkg.com/easymde@2.21.0/dist/easymde.min.css
// @resource     faCSS https://maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @require      https://flux-suite.vercel.app/libs/flux-kit/sync.js
// @require      https://flux-suite.vercel.app/libs/flux-kit/scratchpad.js
// @require      https://unpkg.com/easymde@2.21.0/dist/easymde.min.js
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
    createLogger, getUniqueId, trapTabFocus,
    createHTMLElement, createSVGElement,
    safeHTML, withTTPatched, compressImage
  } = FluxKit.utils;

  const{
    viewer: fluxViewer,
    initContextMenu, initNotification, initTooltips,
    createContextMenu
  } = FluxKit.ui;

  const { logMessage, logError, logWarning, logDebug } = createLogger('FluxNotes');

  const makeElementDragAndResize = (element, header, opts = {}) => {
    const options = { 
      onClose: (el) => { modalCloseAction(el); return false; }, 
      minWidth: 360, minHeight: 460, ...opts, autoFocus: false,
      minimize: { iconTop: 0, iconRight: 20, iconSize: 16, color: 'var(--flxn-text)', hoverTransform: 'rotate(180deg) scale(1.1)', ...(opts.minimize || {}) }, 
      close: { iconTop: 0, iconRight: -4, iconSize: 16, color: 'var(--flxn-text)', hoverTransform: 'rotate(90deg) scale(1.1)' } 
    };
    element.destroy = FluxKit.utils.makeElementDragAndResize(element, header, options);
  }

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
    add: 'alt+a',
    view: 'alt+v',
    settings: 'alt+`',
    toggleTheme: 'alt+t',
    bookmarkNote: 'alt+b',
    quickNote: 'alt+q'
  };

  const DEFAULT_CUSTOM_THEME = FluxKit.theme.get('dark');

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
    },
    trashQueue: []
  };

  let config = initializeConfig();
  window.FluxNotes = config;
  let activeThemeBridge = {};
  let ctxNamespace = { namespace: 'flx-notes', width: 170 };
  let notifNamespace = { namespace: 'flx-notes' };
  const showNotification = (msg, config) => FluxKit.ui.showNotification(msg, { ...config, ...notifNamespace });

  function initializeConfig() {
    try {
      const saved = GM_getValue(STORAGE_KEY);
      if (!saved) {
        logMessage('No config found, initializing default');
        GM_setValue(STORAGE_KEY, DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG, };
      }
      return { 
        ...DEFAULT_CONFIG, ...saved, 
        shortcuts: { ...DEFAULT_SHORTCUT_KEYS, ...(saved.shortcuts || {}) },
        customTheme: { ...DEFAULT_CONFIG.customTheme, ...(saved.customTheme || {}) } 
      };
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
  const TOMBSTONE_RETENTION_DAYS = 30;
  const NOTES_LOADING_BATCH_SIZE = 12;
  const MODAL_IDS = {
    NOTE: 'flxn-note-modal',
    VIEW: 'flxn-view-modal',
    SETTINGS: 'flxn-settings-modal',
    QUICK_NOTE: 'flxn-quick-note',
    STORAGE: 'flxn-storage-modal',
    TAG_MERGE: 'flxn-merge-tags-modal',
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
  let isShortcutUpdating = false;
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
  
  window.flxn_active_attachments = window.flxn_active_attachments || new Set();

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

  let localUploadsPending = 0;

  async function checkPendingUploadsOnLoad() {
    try {
      await cleanOrphanedDatabases();
      const db = await initLocalDB();
      const currentProfilePrefix = `${getCurrentProfileName() || 'default'}_`;
      
      const tx = db.transaction(STORE_UPLOADS, 'readonly');
      const req = tx.objectStore(STORE_UPLOADS).getAllKeys();
      
      req.onsuccess = () => {
        const keys = req.result || [];
        localUploadsPending = keys.filter(k => k.startsWith(currentProfilePrefix)).length;
        
        const profile = getCurrentProfile();
        const isLocal = !profile || !profile.provider || profile.provider === 'Local';

        if (localUploadsPending > 0 && !isLocal) {
          logMessage(`Found ${localUploadsPending} trapped uploads for active profile. Triggering sync.`);
          triggerBackgroundSync();
        }

        cleanOrphanedDatabases();
      };
    } catch (e) {}
  }

  async function cleanOrphanedDatabases() {
    return new Promise(async (resolve) => {
      try {
        const validProfiles = new Set(getAllProfiles().map(p => p.name));
        validProfiles.add('default');
        
        const validAttachmentsPerProfile = new Map();

        const getValidAttachmentsForProfile = (pName) => {
          if (validAttachmentsPerProfile.has(pName)) return validAttachmentsPerProfile.get(pName);
          
          const validIds = new Set();
          let notesToCheck = [];
          
          if (pName === getCurrentProfileName()) {
            notesToCheck = [...(config.notes || []), ...(config.trashedNotes || [])];
          } else {
            const cached = loadCachedProfileData(pName);
            if (cached) notesToCheck = [...(cached.notes || []), ...(cached.trashedNotes || [])];
          }

          notesToCheck.forEach(n => {
            if (n.attachments) n.attachments.forEach(a => validIds.add(a.id));
          });

          validAttachmentsPerProfile.set(pName, validIds);
          return validIds;
        };
        
        const db = await initLocalDB();

        let stores = [STORE_UPLOADS, STORE_CACHE];
        let storesProcessed = 0;

        stores.forEach(storeName => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const req = store.getAllKeys();
          
          req.onsuccess = () => {
            const keys = req.result || [];
            keys.forEach(key => {
              const match = key.match(/^(.*)_(att-.*)$/);
              let pName = '', attId = '';

              if (match) {
                  pName = match[1];
                  attId = match[2];
              } else {
                const lastUnderscore = key.lastIndexOf('_');
                if (lastUnderscore !== -1) {
                  pName = key.substring(0, lastUnderscore);
                  attId = key.substring(lastUnderscore + 1);
                } else pName = key;
              }
              const isProfileOrphan = !validProfiles.has(pName);
              let isAttachmentOrphan = false;

              if (!isProfileOrphan && attId) {
                const validIds = getValidAttachmentsForProfile(pName);
                
                if (!validIds.has(attId) && !window.flxn_active_attachments.has(attId)) {
                  isAttachmentOrphan = true;
                }
              }

              if (isProfileOrphan || isAttachmentOrphan) {
                store.delete(key);
                logMessage(`🧹 Cleaned orphaned DB item: ${key}`);
              }
            });
          };
          tx.oncomplete = () => {
            storesProcessed++;
            if (storesProcessed === stores.length) resolve();
          };
          tx.onerror = () => {
            storesProcessed++;
            if (storesProcessed === stores.length) resolve();
          }
        });
      } catch(e) {
        logWarning("Failed to clean orphaned DBs", e);
      }
    });
  }

  setTimeout(checkPendingUploadsOnLoad, 1000);

  function getAttachmentCacheKey(attachmentId) {
    return `${getCurrentProfileName() || 'default'}_${attachmentId}`;
  }

  // --- UPLOAD QUEUE ---
  async function queueAttachmentForUpload(attachmentId, blob) {
    window.flxn_active_attachments.add(attachmentId);
    const db = await initLocalDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_UPLOADS, 'readwrite');
      tx.objectStore(STORE_UPLOADS).put(blob, getAttachmentCacheKey(attachmentId));
      tx.oncomplete = () => {
        localUploadsPending++;
        resolve();
      };
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
      tx.oncomplete = () => {
        localUploadsPending = Math.max(0, localUploadsPending - 1);
        resolve();
      };
    });
  }

  // --- PREVIEW CACHE ---
  async function cacheAttachmentForPreview(attachmentId, blob) {
    window.flxn_active_attachments.add(attachmentId);
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
      --flxn-radius-lg: 20px;
      --flxn-radius-md: 12px;
      --flxn-radius-sm: 8px;
      --flxn-shadow-float: 0 12px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.08);
      --flxn-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.05);
      --flxn-transition: 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      --flxn-spacing-xs: 5px;
      --flxn-spacing-sm: 8px;
      --flxn-spacing-md: 12px;
      --flxn-bg-card: rgba(128,128,128,0.03);
      --flxn-bg-card-hover: rgba(128,128,128,0.05);
    }
    @keyframes flxn-fade-in { to { opacity: 1; } }

    /* =========================================================
       2. MODAL CONTAINERS & LAYOUT
       ========================================================= */
    dialog.flxn-modal {
      margin: 0 !important;
      border: 1px solid var(--flxn-border) !important;
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
    .flxn-modal { box-sizing: border-box; opacity: 0; transform: scale(0.96); transition: opacity 0.2s ease, transform 0.2s ease; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
    .flxn-modal.show { opacity: 1; transform: scale(1); }
    .flxn-modal-header { box-sizing: border-box; flex: 0 0 auto; font-size: 18px; font-weight: bold; margin-bottom: 15px; margin-top: 0px; width: fit-content; }
    .flxn-modal-content { box-sizing: border-box; flex: 1 1 auto; display: flex; flex-direction: column; position: relative; min-height: 0; overflow-y: auto; overflow-x: hidden; height: 100%; }
    .flxn-modal-footer { box-sizing: border-box; flex: 0 0 auto; display: flex; justify-content: end; gap: 8px; text-align: right; margin-top: 15px; }
    .flxn-empty-state {
      grid-column: 1 / -1;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 60px 20px; text-align: center; color: #777; opacity: 0;
      animation: flxn-fade-in 0.5s forwards 0.2s;
    }

    /* =========================================================
       3. FORMS, ROWS & ACCORDIONS
       ========================================================= */
    .flxn-form-row {
      display: grid; grid-template-columns: 150px 1fr; align-items: center;
      gap: var(--flxn-spacing-md); margin-bottom: var(--flxn-spacing-sm); margin-top: var(--flxn-spacing-sm); width: 100%;
    }
    .flxn-form-label { font-size: 14px; font-weight: 500; opacity: 0.85; white-space: nowrap; }
    .flxn-profile-btn-row { flex: 0 0 auto; display: flex; justify-content: end; gap: 8px; text-align: right; margin-bottom: 15px; }
    .flxn-profile-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; margin-bottom: var(--flxn-spacing-md); }
    .flxn-modal input:not([type="checkbox"]), .flxn-modal select, .flxn-modal button {
      height: 30px !important; margin: 0 !important; box-sizing: border-box !important;
    }

    .flxn-modal details { background: transparent !important; border: none !important; padding: 0 !important; margin-top: var(--flxn-spacing-sm); margin-bottom: var(--flxn-spacing-lg); }
    .flxn-modal summary {
      font-size: 16px !important; font-weight: 600 !important; cursor: pointer; outline: none; list-style: none;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 0 var(--flxn-spacing-sm) 0 !important; margin: 0 0 var(--flxn-spacing-md) 0 !important;
      border-bottom: 2px solid var(--flxn-border, rgba(128,128,128,0.15)) !important; user-select: none; transition: color 0.2s ease;
    }
    .flxn-modal summary::-webkit-details-marker { display: none; }
    .flxn-modal summary::after { content: '▼'; font-size: 11px; opacity: 0.4; transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .flxn-modal details[open] summary::after { transform: rotate(-180deg); }
    .flxn-modal details[open] summary { border-bottom: 1px solid var(--flxn-border, rgba(128,128,128,0.1)); margin-bottom: var(--flxn-spacing-sm); padding-bottom: var(--flxn-spacing-sm); }
    .flxn-modal summary:hover { opacity: 0.8; }

    /* =========================================================
       4. VIEW CONTROLS & TAGS (Static)
       ========================================================= */
    .flxn-view-controls { display: flex; gap: var(--flxn-spacing-md); margin-bottom: var(--flxn-spacing-sm); align-items: center; width: 100%; }
    .flxn-search-wrapper { flex: 1 1 auto; }
    .flxn-sort-wrapper { flex: 0 0 auto; display: flex; align-items: center; gap: var(--flxn-spacing-xs); font-size: 14px; font-weight: 500; white-space: nowrap; }
    #flxn-tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: var(--flxn-spacing-md) !important; }
    .flxn-tag-chip {
      background: var(--flxn-bg-secondary, rgba(128,128,128,0.08)) !important;
      border: 1px solid var(--flxn-border, rgba(128,128,128,0.15)) !important;
      color: inherit !important; padding: 4px 12px !important; border-radius: 16px !important;
      font-size: 12px !important; font-weight: 500 !important; transition: all 0.2s ease !important;
    }
    .flxn-tag-chip:hover {
      background: var(--flxn-bg-hover, rgba(128,128,128,0.15)) !important;
      border-color: var(--flxn-accent-bg, #007bff) !important;
      transform: translateY(-1px) !important;
    }

    /* =========================================================
       5. NOTE CARDS & ACTIONS (Static/Legacy)
       ========================================================= */
    #flxn-notes-list > .note-container {
      background: var(--flxn-bg-card, rgba(128,128,128,0.02)) !important;
      border: 1px solid var(--flxn-border, rgba(128,128,128,0.15)) !important;
      border-radius: var(--flxn-radius-md) !important; padding: 10px !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.02) !important; display: flex; flex-direction: row; gap: 8px; top: 0;
      transition: top 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease !important;
    }
    #flxn-notes-list > .note-container:hover {
      top: -2px !important; box-shadow: 0 12px 24px rgba(0,0,0,0.08) !important;
      border-color: var(--flxn-accent-bg, #007bff) !important; background: var(--flxn-bg-card-hover, rgba(128,128,128,0.05)) !important;
    }
    .note-container .note-title { font-size: 15px; font-weight: 600; line-height: 1.3; }
    .note-container > div > div:nth-child(2) { font-size: 11px !important; opacity: 0.6; margin-top: 2px; }

    .flxn-note-card { position: relative; overflow: hidden; }
    .flxn-note-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 5px; opacity: 0; transform: translateY(-10px); transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94); }
    .flxn-note-card:hover .flxn-note-actions { opacity: 1; transform: translateY(0); }
    .flxn-action-btn { background: rgba(255, 255, 255, 0.9); border: 1px solid #ddd; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #444; box-shadow: 0 2px 4px rgba(0,0,0,0.1); font-size: 12px; }
    .flxn-action-btn:hover { background: var(--flxn-accent-bg, #007bff); color: #fff; border-color: transparent; }

    /* =========================================================
       6. THUMBNAIL PREVIEWS & ICONS
       ========================================================= */
    .flxn-icon-btn { width: 30px !important; height: 30px !important; padding: 0 !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; }
    .flxn-icon-btn svg { display: block; }
    .flx-note-thumbnail { max-width: 108px; max-height: 80px; border-radius: 6px; border: 1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: transform 0.2s ease, box-shadow 0.2s ease; margin-top: 2.91px; flex-shrink: 0; }
    .flx-note-thumbnail:hover { transform: scale(1.05); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }

    /* =========================================================
       7. Custom Theme Color Pickers
       ========================================================= */
    .flxn-modal input[type="color"].flxn-color-picker {
      width: 28px !important;
      height: 28px !important;
      min-height: 28px !important; /* Overrides the global 38px */
      flex: 0 0 28px !important;   /* Absolutely prevents flexbox stretching */
      padding: 0 !important;
      margin: 0 !important;
      border: 1px solid var(--flxn-border, rgba(128,128,128,0.2)) !important;
      border-radius: 50% !important;
      cursor: pointer;
      background: transparent !important;
      box-shadow: none !important;
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      transition: transform 0.2s ease, box-shadow 0.2s ease !important;
    }
    .flxn-modal input[type="color"].flxn-color-picker::-webkit-color-swatch-wrapper {
      padding: 0;
    }
    .flxn-modal input[type="color"].flxn-color-picker::-webkit-color-swatch {
      border: none;
      border-radius: 50%;
    }
    .flxn-modal input[type="color"].flxn-color-picker::-moz-color-swatch {
      border: none;
      border-radius: 50%;
    }
    .flxn-modal input[type="color"].flxn-color-picker:hover {
      transform: scale(1.15);
      box-shadow: var(--flxn-shadow-sm) !important;
    }
    #flxn-custom-theme-panel {
      padding: 12px 16px;
      background: var(--flxn-bg-card, rgba(128,128,128,0.03));
      border: 1px solid var(--flxn-border, rgba(128,128,128,0.1));
      border-radius: var(--flxn-radius-sm);
      margin-top: 12px;
      display: flex;
      flex-direction: row;
      justify-content: space-around; /* Distributes the dots evenly */
      align-items: center;
      gap: 8px;
      transition: opacity 0.3s ease;
    }
    .flxn-color-item {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      cursor: pointer;
    }
    .flxn-color-item .flxn-form-label {
      font-size: 12px; /* Slightly smaller for a tighter fit */
      margin: 0;
      white-space: nowrap;
    }
    .flxn-color-picker {
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      width: 28px !important; /* Scaled down from 38px */
      height: 28px !important;
      padding: 0 !important;
      border: 1px solid var(--flxn-border, rgba(128,128,128,0.2)) !important;
      border-radius: 50% !important;
      cursor: pointer;
      background: transparent;
      flex-shrink: 0;
      transition: transform 0.2s ease, box-shadow 0.2s ease !important;
    }
    .flxn-color-picker::-webkit-color-swatch-wrapper { padding: 0; }
    .flxn-color-picker::-webkit-color-swatch { border: none; border-radius: 50%; }
    .flxn-color-picker::-moz-color-swatch { border: none; border-radius: 50%; }
    .flxn-color-picker:hover {
      transform: scale(1.15);
      box-shadow: var(--flxn-shadow-sm);
    }

    /* =========================================================
       8. STORAGE MANAGER
       ========================================================= */
    .flxn-storage-summary { display: flex; gap: 16px; margin-bottom: 16px; padding: 16px; background: rgba(128,128,128,0.05); border-radius: var(--flxn-radius-sm); align-items: center; flex-wrap: wrap; border: 1px solid var(--flxn-border, rgba(128,128,128,0.1)); }
    .flxn-storage-stat { display: flex; flex-direction: column; align-items: flex-start; }
    .flxn-storage-stat span:first-child { font-weight: bold; font-size: 18px; line-height: 1; margin-bottom: 4px; }
    .flxn-storage-stat span:last-child { opacity: 0.6; font-size: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
    .flxn-storage-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 50vh; padding-right: 4px; }
    .flxn-storage-item { 
      background: var(--flxn-bg-card, rgba(128,128,128,0.03)); 
      border: 1px solid var(--flxn-border, rgba(128,128,128,0.15)); 
      border-radius: var(--flxn-radius-sm); padding: 10px; 
      transition: border-color 0.2s; 
    }
    .flxn-storage-item:hover { border-color: var(--flxn-accent-bg, #007bff); }
    .flxn-storage-header { display: flex; align-items: center; justify-content: space-between; user-select: none; }
    .flxn-storage-title { display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 13px; overflow: hidden; }
    .flxn-storage-title svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.7; }
    .flxn-storage-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
    .flxn-storage-path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 400px; }
    .flxn-storage-meta { display: flex; align-items: center; gap: 12px; font-size: 12px; opacity: 0.8; }
    .flxn-storage-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.2s; align-items: center; }
    .flxn-storage-header:hover .flxn-storage-actions, .flxn-storage-child:hover .flxn-storage-actions { opacity: 1; }
    .flxn-storage-bar-bg { width: 60px; height: 4px; background: rgba(128,128,128,0.2); border-radius: 2px; overflow: hidden; display: inline-block; vertical-align: middle; }
    .flxn-storage-bar-fill { height: 100%; background: var(--flxn-accent-text, #007bff); }
    .flxn-storage-children { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--flxn-border, rgba(128,128,128,0.15)); display: none; flex-direction: column; gap: 6px; }
    .flxn-storage-item.expanded .flxn-storage-children { display: flex; }
    .flxn-storage-child { display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 4px 8px; background: rgba(128,128,128,0.04); }

    /* =========================================================
       9. RESPONSIVE SETTINGS LAYOUT
       ========================================================= */
    .flxn-settings-layout { display: flex; flex-direction: column; gap: 20px; height: 100%; overflow-y: auto; padding-right: 8px; }
    .flxn-modal.flxn-wide-mode .flxn-settings-layout { flex-direction: row; overflow: hidden; }
    .flxn-settings-col { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .flxn-modal.flxn-wide-mode .flxn-settings-col { overflow-y: auto; padding-right: 12px; }
    .flxn-modal.flxn-wide-mode .flxn-settings-col:first-child { border-right: 1px solid var(--flxn-border, rgba(128,128,128,0.15)); margin-right: 12px; padding-right: 24px; }
  `;

  const DYNAMIC_MODAL_CSS = `
    /* =========================================================
      1. MODALS & CONTAINERS
      ========================================================= */
    #${MODAL_IDS.NOTE}, #${MODAL_IDS.VIEW}, #${MODAL_IDS.SETTINGS},
    #${MODAL_IDS.QUICK_NOTE}, #${MODAL_IDS.TAG_MERGE}, #${MODAL_IDS.STORAGE} {
      position: fixed;
      background: var(--flxn-glass-bg);
      color: var(--flxn-text);
      font-family: var(--flxn-font-family);
      backdrop-filter: blur(10px) saturate(180%);
      -webkit-backdrop-filter: blur(10px) saturate(180%);
      border: 1px solid var(--flxn-modal-border-color) !important;
      box-shadow: var(--flxn-modal-shadow) !important;
      transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease,
                  background-color 0.2s ease, border-color 0.2s ease;
    }
    #${MODAL_IDS.NOTE}, #${MODAL_IDS.SETTINGS}, #${MODAL_IDS.QUICK_NOTE}, #${MODAL_IDS.TAG_MERGE}, #${MODAL_IDS.STORAGE} { left: 35vw; }
    #${MODAL_IDS.SETTINGS} { overflow: visible; }
    #${MODAL_IDS.VIEW} { padding: 24px; border-radius: 12px; width: 45vw; height: 70vh; display: flex; flex-direction: column; }
    #${MODAL_IDS.NOTE} .flxn-modal-content { display: flex; flex-direction: column; gap: 10px; }
    .flxn-modal-close-btn { position: absolute !important; top: 19px !important; right: 16px !important; width: 28px !important; height: 28px !important; background: transparent !important; border: none !important; box-shadow: none !important; color: var(--flxn-text) !important; opacity: 0.5; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50% !important; padding: 0 !important; transition: all 0.2s ease !important; }
    .flxn-modal-close-btn:hover { opacity: 1 !important; transform: rotate(90deg) scale(1.1) !important; }
    .flxn-modal-settings-btn { position: absolute !important; top: 17px !important; right: 62px !important; width: 28px !important; height: 28px !important; background: transparent !important; border: none !important; box-shadow: none !important; color: var(--flxn-text) !important; opacity: 0.5; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50% !important; padding: 0 !important; transition: all 0.2s ease !important; }
    .flxn-modal-settings-btn:hover { opacity: 1 !important; transform: rotate(90deg) scale(1.1) !important; }

    /* =========================================================
      2. FORMS & INPUTS
      ========================================================= */
    #${MODAL_IDS.NOTE} input:not([type="checkbox"]):not(.CodeMirror-search-field):not(#flxn-tag-input),
    #${MODAL_IDS.NOTE} textarea:not(.CodeMirror textarea):not([style*="display: none"]),
    #${MODAL_IDS.NOTE} select,
    #${MODAL_IDS.SETTINGS} input:not([type="checkbox"]), #${MODAL_IDS.SETTINGS} textarea, #${MODAL_IDS.SETTINGS} select,
    #${MODAL_IDS.VIEW} input:not([type="checkbox"]), #${MODAL_IDS.VIEW} textarea, #${MODAL_IDS.VIEW} select,
    #${MODAL_IDS.TAG_MERGE} input:not([type="checkbox"]), #${MODAL_IDS.TAG_MERGE} textarea, #${MODAL_IDS.TAG_MERGE} select,
    #${MODAL_IDS.STORAGE} input:not([type="checkbox"]), #${MODAL_IDS.STORAGE} select,
    #${MODAL_IDS.QUICK_NOTE} input:not([type="checkbox"]), #${MODAL_IDS.QUICK_NOTE} textarea, #${MODAL_IDS.QUICK_NOTE} select {
      background: var(--flxn-input-bg) !important; color: var(--flxn-text) !important; border: 1px solid var(--flxn-accent-bg) !important;
      width: 100% !important; padding: 6px !important; margin-bottom: 8px !important;
      border-radius: 4px !important; box-sizing: border-box !important; font-family: var(--flxn-font-family);
    }
    .flxn-modal input:focus, .flxn-modal textarea:focus, .flxn-modal select:focus,
    .flxn-tag-input-wrapper:focus-within, .EasyMDEContainer .CodeMirror.CodeMirror-focused {
      outline: none !important; box-shadow: 0 0 0 1px var(--flxn-accent-bg) inset !important;
    }
    #${MODAL_IDS.SETTINGS} input[type="checkbox"] { transform: scale(1.2); margin-right: 8px; accent-color: var(--flxn-accent-bg); }

    /* =========================================================
      3. BUTTONS & LINKS
      ========================================================= */
    #${MODAL_IDS.NOTE} button, #${MODAL_IDS.VIEW} button, #${MODAL_IDS.SETTINGS} button,
    #${MODAL_IDS.QUICK_NOTE} button, #${MODAL_IDS.TAG_MERGE} button, #${MODAL_IDS.STORAGE} button,
    #flxn-notes-list > .note-container, .flxn-tag-chip {
      transition: background 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease; cursor: pointer; border-radius: 6px;
    }
    #${MODAL_IDS.NOTE} button, #${MODAL_IDS.VIEW} button, #${MODAL_IDS.SETTINGS} button,
    #${MODAL_IDS.QUICK_NOTE} button, #${MODAL_IDS.TAG_MERGE} button, #${MODAL_IDS.STORAGE} button {
      padding: 6px 12px; background: linear-gradient(135deg, var(--flxn-accent-bg), var(--flxn-accent-bg-dark));
      color: var(--flxn-btn-text-color); font-family: var(--flxn-font-family); position: relative; overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    #${MODAL_IDS.NOTE} button:hover, #${MODAL_IDS.VIEW} button:hover, #${MODAL_IDS.SETTINGS} button:hover,
    #${MODAL_IDS.QUICK_NOTE} button:hover, #${MODAL_IDS.TAG_MERGE} button:hover {
      transform: scale(1.03); box-shadow: var(--flxn-btn-hover-shadow);
    }
    #${MODAL_IDS.NOTE} button:active, #${MODAL_IDS.VIEW} button:active, #${MODAL_IDS.SETTINGS} button:active,
    #${MODAL_IDS.QUICK_NOTE} button:active, #${MODAL_IDS.TAG_MERGE} button:active {
      transform: scale(0.97); box-shadow: var(--flxn-btn-active-shadow);
    }
    .flxn-modal a:not(.button-like):not([class*="btn"]) { color: var(--flxn-accent-text); text-decoration: underline; cursor: pointer; font-family: var(--flxn-font-family); }
    .flxn-modal a:hover { opacity: 0.85; }
    #new-profile-btn, #delete-profile-btn { margin-bottom: 8px !important; }

    /* =========================================================
      4. NOTE CARDS & ACTIONS
      ========================================================= */
    flxn-notes-list-wrapper { display: flex; flex-direction: column; position: relative; height: auto !important; overflow: visible !important; padding-top: 10px; }
    #flxn-notes-list {
      height: auto; max-height: none !important; overflow: visible !important; display: grid !important; padding-bottom: var(--flxn-spacing-lg) !important;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); grid-auto-rows: min-content; gap: 16px; overscroll-behavior: contain; padding-right: 8px; scrollbar-width: thin; scrollbar-color: var(--flxn-input-bg) var(--flxn-bg);
    }
    #flxn-notes-list::-webkit-scrollbar { width: 8px; }
    #flxn-notes-list::-webkit-scrollbar-track { background: var(--flxn-bg); }
    #flxn-notes-list::-webkit-scrollbar-thumb { background: var(--flxn-input-bg); border-radius: 4px; border: 1px solid var(--flxn-scrollbar-thumb-border); }

    #flxn-notes-list > .note-container {
      height: auto; align-self: start; justify-self: stretch; display: flex; align-items: flex-start;
      position: relative; cursor: pointer; padding: 10px; border-radius: 6px;
      border-left: 4px solid var(--flxn-input-bg); border-bottom: 1px solid var(--flxn-input-bg);
      transition: background-color 0.1s ease-in-out, opacity 0.25s ease, transform 0.25s ease, border-color 0.2s ease;
      opacity: 0; transform: translateY(6px); will-change: opacity, transform;
    }
    #flxn-notes-list > .note-container.show { opacity: 1; transform: translateY(0); }
    #flxn-notes-list > .note-container:hover { background-color: var(--flxn-input-bg); }
    #flxn-notes-list > .note-container:active { background-color: var(--flxn-input-bg); transform: scale(0.97); }
    #flxn-notes-list > .note-container.pinned { border-left: 4px solid var(--flxn-accent-bg) !important; background-color: var(--flxn-note-pinned-bg) !important; }

    .flxn-note-actions-wrapper {
      position: absolute; bottom: 0px; right: 0px; display: flex; flex-direction: row; gap: 4px;
      padding: 6px 2px; opacity: 0; pointer-events: none; transition: opacity 0.2s ease; border-radius: 14px;
    }
    .flxn-icon-action-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; border-radius: 50%; color: var(--flxn-text); opacity: 0.6; background: transparent; transition: all 0.15s ease; }
    .flxn-icon-action-btn:hover { opacity: 1; background: var(--flxn-icon-hover-bg); }
    .flxn-icon-action-btn.pinned-active:hover { color: #e53935; }
    .flxn-icon-action-btn.trash-btn:hover { color: #e53935; background: rgba(229, 57, 53, 0.15); }

    /* =========================================================
      5. TAG SYSTEM
      ========================================================= */
    .flxn-tag-input-wrapper { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px; background: var(--flxn-input-bg); border: 1px solid var(--flxn-accent-bg); border-radius: 4px; cursor: text; min-height: 36px; box-sizing: border-box; }
    .flxn-tag-input-wrapper input { border: none !important; background: transparent !important; width: auto !important; flex-grow: 1; min-width: 80px; margin: 0 !important; padding: 0 !important; box-shadow: none !important; color: inherit !important; }
    .flxn-tag-chip { background: var(--flxn-bg); color: var(--flxn-text); padding: 4px 8px; border-radius: 12px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--flxn-tag-chip-border); width: max-content; }
    .flxn-tag-chip:hover { filter: brightness(1.15); transform: scale(1.05); box-shadow: 0 2px 6px rgba(0,0,0,0.1); }
    .flxn-tag-chip:active { transform: scale(0.97); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .flxn-tag-chip mark { background: #ffe066; padding: 0; }
    .flxn-tag-chip.include { background: var(--flxn-accent-bg) !important; color: var(--flxn-btn-text-color) !important; border-color: var(--flxn-accent-bg-darker) !important; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
    .flxn-tag-chip.exclude { background: transparent !important; color: var(--flxn-accent-bg) !important; border: 1px dashed var(--flxn-accent-bg) !important; text-decoration: line-through; opacity: 0.6; }

    /* =========================================================
      6. NOTIFICATIONS
      ========================================================= */
    .flxn-notification { background: var(--flxn-bg); color: var(--flxn-text); border: 1px solid var(--flxn-notification-border); }
    .flxn-notification-action { background: var(--flxn-accent-bg) !important; color: var(--flxn-btn-text-color) !important; border: none !important; }

    /* =========================================================
      7. EASYMDE EDITOR
      ========================================================= */
    .flx-icon-fallback { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; pointer-events: none; }
    .flx-icon-fallback svg { width: 100%; height: 100%; }
    .EasyMDEContainer .editor-toolbar {
      background: var(--flxn-input-bg) !important;
      border: 1px solid var(--flxn-accent-bg) !important;
      border-top-left-radius: 4px !important;
      border-top-right-radius: 4px !important;
      opacity: 1 !important;
      padding: 4px 6px !important;
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
      border-right: 1px solid var(--flxn-separator-color) !important;
      width: 0;
      text-indent: -9999px;
      height: 18px;
      vertical-align: middle;
    }

    .EasyMDEContainer .editor-toolbar button, .EasyMDEContainer .editor-toolbar button i.fa, .EasyMDEContainer .editor-toolbar button svg,
    .editor-toolbar button i, .editor-toolbar button::before {
      color: var(--flxn-text) !important; background: transparent !important; border: 1px solid transparent !important;
    }
    .EasyMDEContainer .editor-toolbar button.active, .EasyMDEContainer .editor-toolbar button:hover {
      background: var(--flxn-bg) !important; border-color: var(--flxn-toolbar-hover-border) !important;
    }
    .EasyMDEContainer .editor-toolbar button.active i.fa, .EasyMDEContainer .editor-toolbar button:hover i.fa,
    .EasyMDEContainer .editor-toolbar button.active i, .EasyMDEContainer .editor-toolbar button:hover i,
    .EasyMDEContainer .editor-toolbar button.active svg, .EasyMDEContainer .editor-toolbar button:hover svg {
      color: var(--flxn-accent-text) !important;
    }
    .EasyMDEContainer .editor-toolbar button.disabled-for-preview { opacity: 0.4 !important; }

    #flxn-editor-wrapper:not([style*="display: none"]),
    #flxn-scratchpad-wrapper:not([style*="display: none"]) { display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; min-height: 250px; height: 100%; }

    .flxn-modal .EasyMDEContainer { display: flex; flex-direction: column; height: 100%; flex: 1 1 auto; min-height: 0; }
    .flxn-modal .EasyMDEContainer .editor-toolbar:not(.fullscreen) { flex: 0 0 auto; }
    .flxn-modal .EasyMDEContainer .CodeMirror:not(.CodeMirror-fullscreen) {
      flex: 1 1 auto; height: auto !important; min-height: 150px; max-height: none !important;
      display: flex; flex-direction: column;
      background: var(--flxn-input-bg) !important; color: var(--flxn-text) !important;
      border: 1px solid var(--flxn-accent-bg) !important; border-top: none !important;
      border-bottom-left-radius: 4px !important; border-bottom-right-radius: 4px !important;
      margin: 0 !important; font-family: inherit !important;
    }
    .flxn-modal .EasyMDEContainer .CodeMirror-scroll:not(.CodeMirror-fullscreen) { flex: 1 1 auto !important; height: 100% !important; max-height: none !important; min-height: 0 !important; }
    
    .EasyMDEContainer .CodeMirror-cursor { border-left: 2px solid var(--flxn-text) !important; }
    .EasyMDEContainer .editor-statusbar { color: var(--flxn-text) !important; opacity: 0.7; flex: 0 0 auto; }

    .flxn-modal.flxn-fullscreen-active {
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
      background: var(--flxn-bg) !important;
    }
    .flxn-modal.flxn-fullscreen-active .flxn-header-wrapper,
    .flxn-modal.flxn-fullscreen-active .flxn-modal-footer,
    .flxn-modal.flxn-fullscreen-active .flxn-tag-input-wrapper,
    .flxn-modal.flxn-fullscreen-active #flxn-note-url,
    .flxn-modal.flxn-fullscreen-active .flxn-modal-close-btn {
      display: none !important;
    }
    .flxn-modal.flxn-fullscreen-active .flxn-modal-content {
      padding: 0 !important;
      height: 100% !important;
      gap: 0 !important;
      overflow: hidden !important;
    }
    .flxn-modal.flxn-fullscreen-active .EasyMDEContainer {
      height: 100% !important;
    }
    .flxn-modal.flxn-fullscreen-active .CodeMirror-fullscreen,
    .flxn-modal.flxn-fullscreen-active .editor-preview-side {
      top: 50px !important;
      height: calc(100vh - 50px) !important;
      box-sizing: border-box !important;
    }
    .flxn-modal.flxn-fullscreen-active .editor-toolbar.fullscreen {
      width: 100vw !important;
      box-sizing: border-box !important;
      padding-top: 10px !important;
    }
    .flxn-modal.flxn-fullscreen-active .CodeMirror-scroll {
      max-height: none !important;
    }

    .EasyMDEContainer .editor-preview,
    .EasyMDEContainer .editor-preview-side {
      background: var(--flxn-bg) !important;
      color: var(--flxn-text) !important;
      border: 1px solid var(--flxn-accent-bg) !important;
      box-sizing: border-box !important;
      padding: 10px 14px !important;
      line-height: 1.4 !important;
      font-size: 14px !important;
    }
    .EasyMDEContainer .editor-preview {
      border-top: none !important;
    }
    .editor-preview p, .editor-preview-side p {
      margin: 0.5em 0 !important;
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
      padding-left: 1.5em !important;
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
      margin-bottom: 0.2em !important;
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
      color: var(--flxn-accent-text) !important;
      text-decoration: none !important;
    }
    .editor-preview a:hover, .editor-preview-side a:hover {
      text-decoration: underline !important;
    }

    /* =========================================================
      8. EDGE DOCK
      ========================================================= */
    #flxn-edge-dock {
      pointer-events: auto; position: fixed; top: 50%; transform: translateY(-50%);
      width: 6px; height: 100px; background: var(--flxn-dock-bg);
      backdrop-filter: blur(6px) saturate(150%); -webkit-backdrop-filter: blur(6px) saturate(150%);
      border: 1px solid var(--flxn-dock-border);
      border-right: none; border-radius: 6px 0 0 6px; cursor: grab; z-index: 999999;
      transition: width 0.2s ease, opacity 0.2s ease, background 0.2s ease;
      box-shadow: -2px 0 12px rgba(0,0,0,0.25), inset 1px 0 2px rgba(255,255,255,0.2); opacity: 0.85;
    }
    #flxn-edge-dock:hover { width: 14px; opacity: 1; background: var(--flxn-accent-bg-dark); }
    #flxn-edge-dock:active { cursor: grabbing; }
    #flxn-sync-indicator {
      position: absolute; left: -16px; top: -2px; width: 18px; height: 18px; background: var(--flxn-accent-bg);
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      opacity: 0; visibility: hidden; transform: translateY(-50%) scale(0.5);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: -2px 2px 8px rgba(0,0,0,0.3); cursor: help; color: white;
    }
    #flxn-sync-indicator.active { opacity: 1; visibility: visible; transform: translateY(-50%) scale(1); }
    #flxn-sync-indicator svg { width: 10px; height: 10px; fill: currentColor; animation: flxn-spin 1.5s linear infinite; }
    @keyframes flxn-spin { 100% { transform: rotate(360deg); } }
  `;

  const darken = FluxKit.theme.darken;
  const { isSiteDark, getSiteStyles, presets: fluxPresets } = FluxKit.theme;

  const THEME_PRESETS = {
    auto: { name: 'Auto (Site Match)', dark: null },
    ...fluxPresets,
    custom: config.customTheme,
  };

  const TAG_COLORS = [
    '#f94144', '#f3722c', '#f9c74f', '#90be6d',
    '#43aa8b', '#577590', '#9d4edd', '#ff6d00'
  ];

  function applyThemeVars(theme) {
    const { fontFamily, accentBg, accentText, btnTextColor, bg, text, inputBg, darkMode } = theme;
  
    const root = getAppRoot();
  
    const vars = {
      '--flxn-font-family': fontFamily,
      '--flxn-bg': bg,
      '--flxn-text': text,
      '--flxn-accent-bg': accentBg,
      '--flxn-accent-text': accentText,
      '--flxn-btn-text-color': btnTextColor,
      '--flxn-input-bg': inputBg,
  
      '--flxn-glass-bg': bg && bg.length === 7 ? bg + 'E6' : bg,
      '--flxn-dock-bg': accentBg && accentBg.length === 7 ? accentBg + 'B3' : accentBg,
      '--flxn-accent-bg-dark': darken(accentBg, 10),
      '--flxn-accent-bg-darker': darken(accentBg, 15),
  
      '--flxn-modal-border-color': darkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
      '--flxn-modal-shadow': darkMode
        ? '0 12px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1) inset'
        : '0 12px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.5) inset',
      '--flxn-btn-hover-shadow': darkMode ? '0 4px 10px rgba(255,255,255,0.15)' : '0 4px 10px rgba(0,0,0,0.15)',
      '--flxn-btn-active-shadow': darkMode ? '0 2px 6px rgba(255,255,255,0.1)' : '0 2px 6px rgba(0,0,0,0.1)',
      '--flxn-note-pinned-bg': darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
      '--flxn-icon-hover-bg': darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
      '--flxn-tag-chip-border': darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      '--flxn-notification-border': darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
      '--flxn-separator-color': darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
      '--flxn-toolbar-hover-border': darkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
      '--flxn-scrollbar-thumb-border': darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      '--flxn-dock-border': darkMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)',
    };
  
    for (const [key, value] of Object.entries(vars)) {
      root.host.style.setProperty(key, value);
    }
  
    root.host.classList.toggle('flxn-dark', !!darkMode);
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
        ignoreSelector: '#flxn-shadow-host'
      });
      stylePayload = { ...siteStyles, darkMode };
    } else {
      const preset = THEME_PRESETS[themeKey];
      stylePayload = {
        ...preset, darkMode: preset.dark, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
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
    const activePadContainers = getAppRoot().querySelectorAll('#flxn-scratchpad-wrapper');
    activePadContainers.forEach(container => {
      container.dispatchEvent(new CustomEvent('flxn-theme-changed', { detail: activeThemeBridge }));
    });
    if (typeof fluxViewer !== 'undefined' && fluxViewer) {
      fluxViewer.updateTheme(stylePayload);
    }

    const rootElement = getAppRoot();
    initNotification({
      ...stylePayload,
      ...notifNamespace,
      rootElement,
      position: 'top-center'
    });

    initContextMenu({
      ...stylePayload,
      ...ctxNamespace,
      rootElement,
      bg: stylePayload.bg.length > 7 ? stylePayload.bg.slice(0, -2) : stylePayload.bg,
    });

    initTooltips({
      ...stylePayload,
      rootElement,
      attribute: 'flxNotes',
      border: `1px solid ${stylePayload.accentBg}`,
      delay: 500
    });

    applyThemeVars(stylePayload);
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

  function bringToFront(targetModal) {
    if (!targetModal) return;

    const allModals = Array.from(getAppRoot().querySelectorAll('.flxn-modal'));
    let maxZ = 0;

    allModals.forEach(m => {
      if (m !== targetModal) {
        const z = parseInt(m.style.zIndex) || 0;
        if (z > maxZ) maxZ = z;
      }
    });

    targetModal.style.zIndex = Math.max(10001, maxZ + 1).toString();
    requestAnimationFrame(() => updateActiveScratchpadState());
  }

  function applyModalCascade(newModal, oldCoords) {
    if (oldCoords) {
      newModal.style.top = oldCoords.top;
      newModal.style.left = oldCoords.left;
      newModal.style.bottom = 'auto';
      newModal.style.right = 'auto';
      return;
    }
    const allModals = Array.from(getAppRoot().querySelectorAll('.flxn-modal'))
      .filter(m => m !== newModal && m.classList.contains('show'));

    if (allModals.length === 0) return;

    let activeModal = allModals.reduce((top, current) => {
      const topZ = parseInt(top.style.zIndex || 10000);
      const currZ = parseInt(current.style.zIndex || 10000);
      return currZ > topZ ? current : top;
    }, allModals[0]);

    const rect = activeModal.getBoundingClientRect();
    const cascadeOffset = 32;

    let nextTop = rect.top + cascadeOffset;
    let nextLeft = rect.left + cascadeOffset;

    if (nextTop > window.innerHeight * 0.6) nextTop = window.innerHeight * 0.15; 
    if (nextLeft > window.innerWidth * 0.6) nextLeft = window.innerWidth * 0.25;

    newModal.style.top = `${nextTop}px`;
    newModal.style.left = `${nextLeft}px`;
    newModal.style.bottom = 'auto';
    newModal.style.right = 'auto';
  }

  function getAppRoot() {
    if (unAppRoot) return unAppRoot;

    const host = document.createElement('div');
    host.id = 'flxn-shadow-host';

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

    unAppRoot.addEventListener('mousedown', (e) => {
      const modal = e.target.closest('.flxn-modal');
      if (modal) bringToFront(modal);
    }, true);

    const staticStyle = document.createElement('style');
    staticStyle.id = 'flxn-static-styles';

    staticStyle.textContent = `
      dialog { pointer-events: auto; }
      ${STATIC_MODAL_CSS}
      ${DYNAMIC_MODAL_CSS}
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

  const confirmAction = async (message) => FluxKit.ui.confirm(message, { theme: activeThemeBridge });
  const promptUser = async (message, val) => FluxKit.ui.prompt(message, { defaultValue: val, theme: activeThemeBridge  });

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

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  const formatMB = (mb) => mb >= 1024 ? Number((mb / 1024).toFixed(2)) + ' GB' : Number(mb.toFixed(2)) + ' MB';

  const getNotes = () => config.notes || [];

  function updateActiveScratchpadState() {
    const activeModals = Array.from(getAppRoot().querySelectorAll('.flxn-modal.show'));
    if (activeModals.length === 0) return;

    const topModal = activeModals.sort((a, b) => (parseInt(b.style.zIndex) || 0) - (parseInt(a.style.zIndex) || 0))[0];
    const topZ = parseInt(topModal.style.zIndex) || 0;

    activeModals.forEach(modal => {
      const padContainer = modal.querySelector('#flxn-scratchpad-wrapper');
      if (padContainer && padContainer._fluxPadInstance) {
        const isTopmost = (modal === topModal);
        const isVisible = (padContainer.style.display === 'block');
        const isFocused = (topZ >= 10001);
        padContainer._fluxPadInstance.setIsActive(isTopmost && isVisible && isFocused);
      }
    });
  }

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

  function closeModalDialogue(modal) {
    if (!modal) return;
    modal.dispatchEvent(new Event('modal-closed'));
    if (modal.destroy) modal.destroy();
    if (modal.parentElement && modal.parentElement.id?.includes('-container')) modal.parentElement.remove();
    else modal.remove();
    modal.removeAttribute?.('data-screenshot');
    logMessage(`Closed modal: ${modal.id}`);
  }

  const modalCloseAction = (modalElement) => {
    if (typeof modalElement.requestSafeClose === 'function') {
      modalElement.requestSafeClose();
    } else {
      closeModalDialogue(modalElement);
    }
  }

  // ------------------------
  // UI Elements
  // ------------------------
  function addSettingModalBtn(modalElement) {
    const btn = createHTMLElement('button', {
      className: 'flxn-modal-settings-btn', icon: 'settings',
      eventListener: {
        click: (e) => {
          e.preventDefault();
          e.stopPropagation();
          openSettingsModal();
        }
      }
    });
    modalElement.appendChild(btn);
  }

  function updateNoteInPlace(updatedNote) {
    const notesList = $('flxn-notes-list');
    if (!notesList) return;

    const existingNode = notesList.querySelector(`.note-container[data-id="${updatedNote.id}"]`);

    if (existingNode) {
      const query = $('flxn-search-input')?.value.toLowerCase() || '';

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

  function updateSyncIndicatorUI() {
    const appRoot = getAppRoot();
    const indicator = appRoot.querySelector('#flxn-sync-indicator');
    if (!indicator) return;

    const activeSyncs = window.activeSyncs || new Set();

    if (activeSyncs.size > 0) {
      indicator.classList.add('active');
      const profiles = Array.from(activeSyncs).join(', ');
      indicator.dataset.flxNotesTooltip = `Syncing profiles: ${profiles}`;
    } else {
      indicator.classList.remove('active');
    }
  }

  function createEdgeDock() {
    const appRoot = getAppRoot();
    if (appRoot.querySelector('#flxn-edge-dock')) return;

    const savedTop = config.dockPosition || '50%';
    const getScrollbarWidth = () => window.innerWidth - document.documentElement.clientWidth;
    const dock = createHTMLElement('div', {
      id: 'flxn-edge-dock',
      style: `top: ${savedTop}; right: ${getScrollbarWidth()}px;`
    });

    const syncIndicator = createHTMLElement('div', {
      id: 'flxn-sync-indicator',
      innerHTML: UI_ICONS.sync || '🔄'
    });
    dock.appendChild(syncIndicator);

    appRoot.appendChild(dock);

    updateSyncIndicatorUI();

    window.addEventListener('resize', () => {
      if (dock && dock.isConnected) {
        dock.style.right = `${getScrollbarWidth()}px`;
      }
    });

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

          const existingMenu = $('flxkit-context-menu');
          if (existingMenu) existingMenu.remove();

          let newTop = startTop + (moveEvent.clientY - startY);
          newTop = Math.max(50, Math.min(window.innerHeight - 50, newTop));

          dock.style.top = `${(newTop / window.innerHeight) * 100}%`;
          dock.style.right = `${getScrollbarWidth()}px`;
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
          { separator: true },
          { label: 'Settings', icon: UI_ICONS.settings, action: () => openSettingsModal() },
          { label: 'Storage Manager', icon: UI_ICONS.save, action: () => openStorageManagerModal() },
        ];

        createContextMenu(rect.left - 180 - getScrollbarWidth(), rect.top + (rect.height / 2) - 80, options, ctxNamespace);
      }
    });
  }

  function openStorageManagerModal() {
    const existingModal = $('flxn-storage-modal');
    let savedCoords = null;
    if (existingModal) {
      if (existingModal.style.top) savedCoords = { top: existingModal.style.top, left: existingModal.style.left };
      closeModalDialogue(existingModal);
    }

    let currentFilter = 'all';
    let currentSort = 'size-desc';
    let currentMimeFilters = new Set();
    let currentSearchTerm = '';

    const modal = createHTMLElement('dialog', {
      class: 'flxn-modal', id: 'flxn-storage-modal', style: { width: '40vw' },
      children: [
        createHTMLElement('div', {
          class: 'flxn-modal-header-wrapper', style: { cursor: 'move' },
          children: [createHTMLElement('h3', { class: 'flxn-modal-header', textContent: 'Storage Manager' })]
        }),
        createHTMLElement('div', {
          class: 'flxn-view-controls', style: 'display:flex; flex-wrap: wrap; gap:8px; padding-top: 12px;',
          children: [
            createHTMLElement('div', {
              class: 'flxn-search-wrapper', style: 'display:flex; gap:8px;',
              children: [
                createHTMLElement('input', {
                  type: 'text', placeholder: 'Search name or path...',
                  style: 'flex-grow: 1; width: 50% !important;',
                  eventListener: { input: (e) => { currentSearchTerm = e.target.value.toLowerCase(); renderList(); } }
                }),
                createHTMLElement('select', {
                  id: 'flxn-storage-filter', style: 'width: 25% !important; padding: 6px;',
                  children: [
                    createHTMLElement('option', { value: 'all', textContent: 'View: Notes' }),
                    createHTMLElement('option', { value: 'attachments', textContent: 'View: Attachments' })
                  ],
                  eventListener: { change: (e) => { currentFilter = e.target.value; renderList(); } }
                }),
                createHTMLElement('select', {
                  id: 'flxn-storage-sort', style: 'width: 25% !important; padding: 6px;',
                  children: [
                    createHTMLElement('option', { value: 'size-desc', textContent: 'Sort: Largest First' }),
                    createHTMLElement('option', { value: 'size-asc', textContent: 'Sort: Smallest First' }),
                    createHTMLElement('option', { value: 'name', textContent: 'Sort: A-Z' })
                  ],
                  eventListener: { change: (e) => { currentSort = e.target.value; renderList(); } }
                })
              ]
            })
          ]
        }),
        createHTMLElement('div', { class: 'flxn-modal-content', id: 'flxn-storage-list-container' }),
        createHTMLElement('div', {
          class: 'flxn-modal-footer',
          children: [ createHTMLElement('button', { textContent: 'Close', eventListener: () => closeModalDialogue(modal) }) ]
        })
      ]
    });

    function getMimeCategory(mime) {
      if (!mime) return 'Other';
      if (mime.startsWith('image/')) return 'Images';
      if (mime.startsWith('audio/')) return 'Audio';
      if (mime.startsWith('video/')) return 'Video';
      if (mime.includes('pdf') || mime.includes('document') || mime.includes('text') || mime.includes('json')) return 'Docs';
      return 'Other';
    }

    function renderList() {
      const container = modal.querySelector('#flxn-storage-list-container');
      container.innerHTML = safeHTML('');

      const { maxFileMB } = calculateStorageUsage();
      const limitBytes = maxFileMB * 1024 * 1024;

      let items = [];
      let totalSize = 0;
      let noteCount = 0;
      let fileCount = 0;
      let typeStats = { Images: 0, Audio: 0, Video: 0, Docs: 0, Other: 0 };

      // 1. Calculate Absolute Stats
      getNotes().forEach(note => {
        let noteSize = new Blob([JSON.stringify(note)]).size;
        let attachments = note.attachments || [];
        
        noteCount++;
        totalSize += noteSize;

        attachments.forEach(att => {
          let aSize = att.size || 0;
          totalSize += aSize;
          fileCount++;
          typeStats[getMimeCategory(att.type)]++;
        });

        const matchSearch = (text) => text && text.toLowerCase().includes(currentSearchTerm);
        const noteMatchesSearch = !currentSearchTerm || matchSearch(note.title) || attachments.some(a => matchSearch(a.filename) || matchSearch(a.storagePath));

        if (currentFilter === 'all') {
          if (!noteMatchesSearch) return;
          
          // --- FIX: Multi-Select Filter Check ---
          // If filters are active, the note MUST contain at least one matching attachment type
          if (currentMimeFilters.size > 0 && !attachments.some(a => currentMimeFilters.has(getMimeCategory(a.type)))) return;

          // UX BONUS: Filter the children so the accordion only shows the selected file types!
          let displayedChildren = currentMimeFilters.size > 0 
            ? attachments.filter(a => currentMimeFilters.has(getMimeCategory(a.type)))
            : attachments;

          let nodeTotal = noteSize + displayedChildren.reduce((sum, a) => sum + (a.size || 0), 0);
          
          items.push({
            type: 'note', name: note.title || 'Untitled Note', noteId: note.id,
            size: nodeTotal, children: displayedChildren, rawSize: noteSize, noteObj: note,
          });
          // ---------------------------------------

        } else if (currentFilter === 'attachments') {
          attachments.forEach(att => {
            if (currentSearchTerm && !matchSearch(att.filename) && !matchSearch(att.storagePath) && !matchSearch(note.title)) return;
            
            // Multi-Select Attachment Check
            if (currentMimeFilters.size > 0 && !currentMimeFilters.has(getMimeCategory(att.type))) return;

            items.push({ type: 'attachment', name: att.filename || att.id, size: att.size || 0, parentNote: note.title, noteId: note.id, attObj: att });
          });
        }
      });

      // 2. Restore Original Summary Layout with Multi-Toggles
      const summaryContainer = createHTMLElement('div', { class: 'flxn-storage-summary' });

      summaryContainer.appendChild(createHTMLElement('div', { class: 'flxn-storage-stat', innerHTML: safeHTML(`<span>${formatBytes(totalSize)}</span><span>Used</span>`) }));
      summaryContainer.appendChild(createHTMLElement('div', { class: 'flxn-storage-stat', innerHTML: safeHTML(`<span>${noteCount}</span><span>Notes</span>`) }));
      summaryContainer.appendChild(createHTMLElement('div', { class: 'flxn-storage-stat', innerHTML: safeHTML(`<span>${fileCount}</span><span>Files</span>`) }));

      summaryContainer.appendChild(createHTMLElement('div', { style: 'flex-grow:1;' }));

      Object.entries(typeStats).filter(([k,v]) => v > 0).forEach(([k,v]) => {
        const isActive = currentMimeFilters.has(k);
        
        summaryContainer.appendChild(createHTMLElement('div', {
          class: 'flxn-storage-stat',
          flxNotesTooltip: isActive ? `Remove ${k} from filter` : `Add ${k} to filter`,
          style: `cursor: pointer; transition: all 0.2s ease; ${isActive ? 'border: 1px solid var(--flxn-accent-bg); color: var(--flxn-accent-text); border-radius: 6px; box-shadow: 0 2px 5px rgba(0,0,0,0.15);' : ''}`,
          innerHTML: safeHTML(`<span>${v}</span><span>${k}</span>`),
          eventListener: {
            click: () => {
              if (isActive) currentMimeFilters.delete(k);
              else currentMimeFilters.add(k);
              renderList();
            }
          }
        }));
      });

      container.appendChild(summaryContainer);

      const listEl = createHTMLElement('div', { class: 'flxn-storage-list' });

      items.sort((a, b) => {
        if (currentSort === 'size-desc') return b.size - a.size;
        if (currentSort === 'size-asc') return a.size - b.size;
        return a.name.localeCompare(b.name);
      });

      const preview = async (e, attObj) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.style.opacity = '0.5';
        try {
          const data = await getAttachmentData(attObj);
          if (data) fluxViewer.open(attObj.filename || attObj.id, data);
          else showNotification('Failed to load file content.', { icon: UI_ICONS.error });
        } finally { btn.style.opacity = '1'; }
      }

      const buildPreviewBtn = (attObj) => {
        return createHTMLElement('button', {
          innerHTML: safeHTML(UI_ICONS.preview || '👁'), class: 'flxn-icon-btn',
          style: 'width: 24px !important; height: 24px !important; background: transparent !important; color: var(--flxn-text) !important; border: none !important; box-shadow: none !important;',
          flxNotesTooltip: 'Preview File', eventListener: (e) => preview(e, attObj),
        });
      };

      const buildDeleteNoteBtn = (noteId) => {
        return createHTMLElement('button', {
          innerHTML: safeHTML(UI_ICONS.trash), class: 'flxn-icon-btn',
          style: 'cursor: pointer; width: 24px !important; height: 24px !important; background: transparent !important; color: #e74c3c !important; border: none !important; box-shadow: none !important;',
          flxNotesTooltip: 'Delete Entire Note',
          eventListener: {
            click: async (e) => {
              e.stopPropagation();
              if(await confirmAction('Move this note and ALL its attachments to trash?')) {
                const notes = getNotes();
                const idx = notes.findIndex(n => n.id === noteId);
                if (idx > -1) {
                  const n = notes[idx];
                  config.trashedNotes = config.trashedNotes || [];
                  config.trashedNotes.push({ id: n.id, trashedAt: new Date().toISOString() });
                  
                  // Safely invoke garbage collection for all nested assets
                  if (n.attachments) n.attachments.forEach(a => queueAssetForDeletion(a));
                  notes.splice(idx, 1);
                  
                  config.notes = notes;
                  saveConfig(config);
                  triggerBackgroundSync();
                  if ($('flxn-notes-list')) renderNotes();
                  if ($('storage-usage')) updateStorageUsageDisplay();
                  renderList();
                }
              }
            }
          }
        });
      };

      const buildDeleteAttBtn = (noteId, attObj) => {
        return createHTMLElement('button', {
          innerHTML: safeHTML(UI_ICONS.trash), class: 'flxn-icon-btn',
          style: 'cursor: pointer; width: 24px !important; height: 24px !important; background: transparent !important; color: #e74c3c !important; border: none !important; box-shadow: none !important;',
          flxNotesTooltip: 'Delete File',
          eventListener: {
            click: async (e) => {
              e.stopPropagation();
              const isPad = attObj._systemRef && attObj._systemRef.startsWith('scratchpad_');
              if (isPad && !await confirmAction('This will permanently delete your scratchpad drawing. Are you sure?')) return;
              if (!isPad && !await confirmAction(`Delete file "${attObj.filename}"?`)) return;

              const notes = getNotes();
              const n = notes.find(nx => nx.id === noteId);
              if (n) {
                if (isPad) {
                   const vec = n.attachments.find(a => a._systemRef === 'scratchpad-vector');
                   const prev = n.attachments.find(a => a._systemRef === 'scratchpad-preview');
                   if (vec) queueAssetForDeletion(vec);
                   if (prev) queueAssetForDeletion(prev);
                   n.attachments = n.attachments.filter(a => !a._systemRef || !a._systemRef.startsWith('scratchpad'));
                } else {
                   queueAssetForDeletion(attObj);
                   n.attachments = n.attachments.filter(a => a.id !== attObj.id);
                }
                config.notes = notes;
                saveConfig(config);
                triggerBackgroundSync();
                if ($('storage-usage')) updateStorageUsageDisplay();
                renderList();
              }
            }
          }
        });
      };

      if (items.length === 0) {
        listEl.appendChild(createHTMLElement('div', { textContent: 'No items found.', style: 'opacity:0.5; padding: 20px; text-align:center;' }));
      } else {
        items.forEach(item => {
          const pct = Math.min(100, (item.size / limitBytes) * 100);
          const icon = item.type === 'note' ? UI_ICONS.document : (item.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? UI_ICONS.image : UI_ICONS.zap);
          
          const titleContent = createHTMLElement('div', { 
            class: 'flxn-storage-title',
            innerHTML: safeHTML(`<span>${icon}</span> <span class="flxn-storage-name" data-flx-notes-tooltip="Click to open ${item.type === 'note' ? 'note' : 'file'}" style="cursor: pointer; transition: color 0.15s ease;">${escapeHtml(item.name)}</span> ${item.parentNote ? `<span class="flxn-storage-path" data-flx-notes-tooltip="${item.attObj.storagePath}" style="opacity:0.5; font-size:10px;">in ${escapeHtml(item.parentNote)} [${item.attObj.storagePath}]</span>` : ''}`)
          });

          const titleBtn = titleContent.querySelector('.flxn-storage-name');
          
          titleBtn.addEventListener('mouseenter', function() { 
            this.style.color = 'var(--flxn-accent-bg, #5C7CFA)'; 
            this.style.textDecoration = 'underline'; 
          });
          titleBtn.addEventListener('mouseleave', function() { 
            this.style.color = ''; 
            this.style.textDecoration = 'none'; 
          });

          titleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 

            if (item.type === 'note' && item.noteObj) openNoteModal(item.noteObj, () => openStorageManagerModal());
            else if (item.attObj) preview(e, item.attObj);
          });
          
          const actionsContainer = createHTMLElement('div', { class: 'flxn-storage-actions' });
          if (item.type === 'note') actionsContainer.appendChild(buildDeleteNoteBtn(item.noteId));
          if (item.type === 'attachment') {
            actionsContainer.appendChild(buildPreviewBtn(item.attObj));
            actionsContainer.appendChild(buildDeleteAttBtn(item.noteId, item.attObj));
          }

          const metaContent = createHTMLElement('div', { class: 'flxn-storage-meta' });
          metaContent.appendChild(actionsContainer);
          metaContent.appendChild(createHTMLElement('span', { textContent: formatBytes(item.size), style: { width: 'max-content' } }));
          metaContent.appendChild(createHTMLElement('div', { class: 'flxn-storage-bar-bg', innerHTML: safeHTML(`<div class="flxn-storage-bar-fill" style="width:${pct}%"></div>`) }));

          const header = createHTMLElement('div', {
            class: 'flxn-storage-header',
            children: [ titleContent, metaContent ]
          });

          const itemEl = createHTMLElement('div', { class: 'flxn-storage-item', children: [header] });

          if (item.type === 'note') {
            const childContainer = createHTMLElement('div', { class: 'flxn-storage-children' });
            childContainer.appendChild(createHTMLElement('div', { class: 'flxn-storage-child', innerHTML: safeHTML(`<span>📄 Note Text & Base Data</span> <span>${formatBytes(item.rawSize)}</span>`) }));
            
            item.children.forEach(child => {
              const cRow = createHTMLElement('div', { class: 'flxn-storage-child' });
              const cName = createHTMLElement('span', { textContent: `📎 ${child.filename || child.id}`, style: 'cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%;', eventListener: (e) => preview(e, child) });
              
              const cMeta = createHTMLElement('div', { style: 'display:flex; align-items:center; gap:8px;' });
              const cActions = createHTMLElement('div', { class: 'flxn-storage-actions' });
              cActions.appendChild(buildPreviewBtn(child));
              cActions.appendChild(buildDeleteAttBtn(item.noteId, child));
              cMeta.appendChild(cActions);
              cMeta.appendChild(createHTMLElement('span', { textContent: formatBytes(child.size || 0) }));

              cRow.appendChild(cName);
              cRow.appendChild(cMeta);

              childContainer.appendChild(cRow);
            });
            itemEl.appendChild(childContainer);
            
            // Accordion Toggle
            header.addEventListener('click', (e) => {
               if (!e.target.closest('.flxn-storage-actions')) itemEl.classList.toggle('expanded');
            });
            header.style.cursor = 'pointer';
          } else {
             header.style.cursor = 'default';
          }

          listEl.appendChild(itemEl);
        });
      }

      container.appendChild(listEl);
    }

    getAppRoot().appendChild(modal);

    applyModalCascade(modal, savedCoords);

    requestAnimationFrame(() => {
      modal.classList.add('show');
      renderList();
      bringToFront(modal);
      makeElementDragAndResize(modal, modal.querySelector('div.flxn-modal-header-wrapper'));
    });
    trapTabFocus(modal);
    applyTheme();
  }

  let quickNoteModalInstance = null;

  function openQuickNoteModal() {
    if (quickNoteModalInstance) {
      bringToFront(quickNoteModalInstance);
      quickNoteModalInstance.querySelector('.flxn-modal-header').focus();
      return;
    }

    injectEasyMdeCSS();
    let mdeInstance = null;
    const editorTextarea = createHTMLElement('textarea', { id: 'flxn-quick-mde-editor' });

    const modal = createHTMLElement('dialog', {
      class: 'flxn-modal', id: 'flxn-quick-note',
      children: [
        createHTMLElement('div', { class: 'flxn-modal-header-wrapper', style: { cursor: 'move' }, children: [createHTMLElement('h3', {
          class: 'flxn-modal-header',
          textContent: config.quickNote.title,
        })]}),
        createHTMLElement('div', {
          class: 'flxn-modal-content',
          children: [ editorTextarea ]
        }),
        createHTMLElement('div', {
          class: 'flxn-modal-footer',
          children: [
            createHTMLElement('button', { textContent: 'Clear', eventListener: () => {
              mdeInstance.value('');
              config.quickNote.description = '';
              showNotification(`Quick note cleared`, { icon: UI_ICONS.eraser });
            }}),
            createHTMLElement('button', { textContent: 'Close', eventListener: () => closeModalDialogue(modal) })
          ]
        })
      ]
    });

    withTTPatched(() => {
      mdeInstance = getMDEInstance(modal, editorTextarea, config.quickNote.description);
    });

    injectToolbarIcons(mdeInstance)

    quickNoteModalInstance = modal;

    function saveQuickNote() {
      config.quickNote.description = mdeInstance.value();
      config.quickNote.lastEdited = new Date().toISOString();
      saveConfig(config);
    }

    modal.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveQuickNote();
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

    getAppRoot().appendChild(modal);
    applyModalCascade(modal);
    requestAnimationFrame(() => {
      modal.classList.add('show');
      bringToFront(modal);
      makeElementDragAndResize(modal, modal.querySelector('div.flxn-modal-header-wrapper'), { minWidth: 250, minHeight: 150 });
    });
    modal.addEventListener('modal-closed', () => {
      saveQuickNote();
      quickNoteModalInstance = null;
    }, { once: true });
    return modal;
  }

  function renderNotes() {
    index = 0;
    const notesList = $('flxn-notes-list');
    if (!notesList) return;
    const sortBy = $('flxn-sort-select')?.value || 'date';
    const query = $('flxn-search-input')?.value.toLowerCase() || '';
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
        class: 'flxn-empty-state',
        children: [
          createHTMLElement('div', { innerHTML: safeHTML(`<span style="display: flex; margin-bottom: 15px; opacity: 0.5; color: inherit; font-size: 50px;">${UI_ICONS.book.replace('width="16" height="16"', 'width="48" height="48"')}</span>`) }),
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
      const screenshotWrapper = createHTMLElement('div', { className: 'flx-note-thumbnail', style: 'margin-right: 12px;',
        children: [
          createHTMLElement('img', { src: firstImage.data, alt: 'Attachment', class: 'flx-note-thumbnail',
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
      titleContainer.appendChild(createHTMLElement('span', { innerHTML: safeHTML('⚠️'), flxNotesTooltip: 'This note was created because a sync conflict occurred.' }));
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
          className: `flxn-tag-chip ${state || ''}`,
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
                    $('flxn-search-input').value = tag;
                    renderNotes();
                  }
                },
                {
                  label: `${UI_ICONS.edit} Rename tag`,
                  action: async () => {
                    const newName = await promptUser(`Rename tag "${tag}" to:`, tag);
                    if (newName && newName.trim() !== tag) {
                      renameTag(tag, newName.trim());
                    }
                  }
                },
                {
                  label: `${UI_ICONS.trash} Delete tag`,
                  action: async () => {
                    if (await confirmAction(`Delete tag "${tag}" from all notes?`)) {
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
              ], ctxNamespace);
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

    const actionsWrapper = createHTMLElement('div', { class: 'flxn-note-actions-wrapper' });
    const pinBtn = createHTMLElement('span', {
      dataset: { flxNotesTooltip: note.pinned ? 'Unpin Note' : 'Pin Note', id: note.id },
      className: `flxn-icon-action-btn ${note.pinned ? 'pinned-active' : ''}`,
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
      dataset: { flxNotesTooltip: 'Delete Note', id: note.id },
      className: 'flxn-icon-action-btn trash-btn', icon: 'trash',
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
            triggerBackgroundSync();

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
              style: 'background: transparent; color: var(--flxn-text); border: none; box-shadow: none; font-weight: 500; cursor: pointer; opacity: 0.7; transition: opacity 0.2s ease;',
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
                  applyMasonryLayout($('flxn-notes-list'));
                }
              }, 250);

              if (trashedNote && trashedNote.attachments) {
                trashedNote.attachments.forEach(att => queueAssetForDeletion(att));
              }
            }, 6000);
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
    const existingModal = $(MODAL_IDS.VIEW);
    let savedCoords = null;
    if (existingModal) {
      if (existingModal.style.top) savedCoords = { top: existingModal.style.top, left: existingModal.style.left };
      closeModalDialogue(existingModal);
    }

    activeTagFilters = {};
    const sortOptions = [
      { value: 'date', label: 'Date' },
      { value: 'title', label: 'Title' },
      { value: 'url', label: 'URL' },
    ];
    const modal = createHTMLElement('dialog', {
      class: 'flxn-modal',
      id: MODAL_IDS.VIEW,
      children: [
        createHTMLElement('div', {
          class: 'flxn-modal-header-wrapper', style: { cursor: 'move' },
          children: [createHTMLElement('h3', { class: 'flxn-modal-header', textContent: 'Notes Vault' })]
        }),
        createHTMLElement('div', {
          class: 'flxn-view-controls',
          children: [
            createHTMLElement('div', {
              class: 'flxn-search-wrapper',
              children: [
                createHTMLElement('input', {
                  id: 'flxn-search-input',
                  type: 'text',
                  placeholder: 'Search by title, URL, or tags...',
                  style: 'margin-bottom: 0 !important;',
                  eventListener: { 'input': () => renderNotes() }
                })
              ]
            }),
            createHTMLElement('label', {
              class: 'flxn-sort-wrapper',
              innerText: 'Sort by:',
              children: createHTMLElement('select', {
                id: 'flxn-sort-select',
                style: 'margin-bottom: 0 !important;',
                eventListener: { 'change': renderNotes },
                children: sortOptions.map(({ value, label }) => createHTMLElement('option', { value, textContent: label }))
              })
            }),
          ]
        }),
        createHTMLElement('div', { id: 'flxn-tag-list' }),
        createHTMLElement('div', {
          class: 'flxn-modal-content',
          children: [
            createHTMLElement('div', {
              class: 'flxn-notes-list-wrapper',
              children: [
                createHTMLElement('div', { id: 'flxn-notes-list' })
              ]
            }),
          ]
        }),
        createHTMLElement('div', {
          class: 'flxn-modal-footer',
          children: [
            createHTMLElement('button', {
              id: 'flxn-close-view',
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
              id: 'flxn-close-view',
              textContent: 'Close',
              eventListener: () => closeModalDialogue(modal)
            }),
          ]
        })
      ]
    });

    getAppRoot().appendChild(modal);
    addSettingModalBtn(modal);
    applyModalCascade(modal, savedCoords);
    requestAnimationFrame(() => { 
      modal.classList.add('show');
      bringToFront(modal);
      makeElementDragAndResize(modal, modal.querySelector('div.flxn-modal-header-wrapper'), {
        onAnyResize: () => applyMasonryLayout(modal.querySelector('#flxn-notes-list')),
        onResizing: () => applyMasonryLayout(modal.querySelector('#flxn-notes-list')),
      });
    });
    trapTabFocus(modal);

    renderTagList();
    renderNotes();
    applyTheme();

    return modal;
  }

  function createTagSuggestions(inputEl, wrapper) {
    const dropdown = createHTMLElement('div', { className: 'flxn-tag-suggestions' });
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
      const currentTags = [...wrapper.querySelectorAll('.flxn-tag-chip')].map(el => el.dataset.tag.toLowerCase());

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
        const chips = wrapper.querySelectorAll('.flxn-tag-chip');
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
    const originalAttIds = (note.attachments || []).map(a => a.id).sort().join(',');
    let isPadDirty = false;
    const capabilities = getCapabilities();

    injectEasyMdeCSS();

    let attachmentsWrapper, noteURLInput;
    const editorContainer = createHTMLElement('div', { id: 'flxn-editor-wrapper' });
    const editorTextarea = createHTMLElement('textarea', { id: 'flxn-mde-editor' });
    editorContainer.appendChild(editorTextarea);
    let mdeInstance = null

    const scratchpadContainer = createHTMLElement('div', { id: 'flxn-scratchpad-wrapper', style: 'display: none;' }); // Hidden by default
    let padInstance = null;
    let isPadActive = (note && note.id && getNotes().some(n => n.id === note.id) && !note.description && activeAttachments.find(a => a._systemRef === 'scratchpad-vector'));
    
    const updateScratchpadData = async () => {
      const oldPadFiles = activeAttachments.filter(a => a._systemRef === 'scratchpad-vector' || a._systemRef === 'scratchpad-preview');
      activeAttachments = activeAttachments.filter(a => a._systemRef !== 'scratchpad-vector' && a._systemRef !== 'scratchpad-preview');
      oldPadFiles.forEach(att => queueAssetForDeletion(att));
      const pngData = padInstance.getPreviewImage();

      if (pngData) {
        const baseId = 'att-' + getUniqueId();
        const capabilities = getCapabilities();

        const jsonText = padInstance.getVectorData();
        const jsonBlob = new Blob([jsonText], { type: 'application/json' });
        await queueAttachmentForUpload(baseId + '-vec', jsonBlob);
        const vecFilename = 'scratchpad_vector.json';
        activeAttachments.push({ 
          id: baseId + '-vec', _systemRef: 'scratchpad-vector', 
          filename: vecFilename, type: 'application/json', 
          size: jsonBlob.size, providerStorage: 'native', 
          storagePath: `assets/${generateAssetFilename(vecFilename, baseId + '-vec', note.title)}`,
          data: null,
          uploadPending: true,
          sourceOrigin: window.location.origin
        });

        const rawPngBlob = dataURLtoBlob(pngData);
        if (capabilities.requiresBatchedBase64) {
          activeAttachments.push({ 
            id: baseId + '-png', _systemRef: 'scratchpad-preview', 
            filename: 'scratchpad_preview.png', type: 'image/png', 
            size: Math.round(pngData.length * 0.75), providerStorage: 'base64', 
            storagePath: null, // Base64 doesn't need a path
            data: pngData 
          });
        } else {
          const thumb = await generateThumbnail(rawPngBlob);
          await queueAttachmentForUpload(baseId + '-png', rawPngBlob);
          const pngFilename = 'scratchpad_preview.png';
          activeAttachments.push({ 
            id: baseId + '-png', _systemRef: 'scratchpad-preview', 
            filename: pngFilename, type: 'image/png', 
            size: rawPngBlob.size, providerStorage: 'native', 
            storagePath: `assets/${generateAssetFilename(pngFilename, baseId + '-png', note.title)}`,
            data: thumb,
            uploadPending: true,
            sourceOrigin: window.location.origin
          });
        }

        renderAttachmentsList();
      }
    }

    const openScratchpad = async () => {
      const existingVec = activeAttachments.find(a => a._systemRef === 'scratchpad-vector');
      if (existingVec && existingVec.uploadPending && existingVec.sourceOrigin !== window.location.origin) {
        const host = existingVec.sourceOrigin.replace(/^https?:\/\//i, '');
        showNotification(`Cannot edit: Sketch is waiting to upload on ${host}. Open that site to sync it first!`, { icon: UI_ICONS.warning, duration: 5000 });
         
        isPadActive = false;
        togglePadBtn.innerHTML = getIconHTML('scribble');
        togglePadBtn.dataset.flxNotesTooltip = 'Open Scratchpad';
        return; 
      }

      editorContainer.style.display = 'none';
      scratchpadContainer.style.display = 'block';

      if (!padInstance) {
        const capabilities = getCapabilities();

        padInstance = new FluxKit.ui.Scratchpad(scratchpadContainer, { 
          pointThreshold: 2, showExportSettings: true, theme: activeThemeBridge,
          disableImagePaste: capabilities.requiresBatchedBase64,
          imageCompression: capabilities.requiresBatchedBase64 ? { maxWidth: 1200, quality: 0.6 } : false,
          onChange: () => { isPadDirty = true; }
        });
        isPadDirty = false;

        scratchpadContainer._fluxPadInstance = padInstance;

        const existingVec = activeAttachments.find(a => a._systemRef === 'scratchpad-vector');
        if (existingVec) {
          scratchpadContainer.style.position = 'relative';
          scratchpadContainer.style.pointerEvents = 'none';
          const loaderOverlay = createHTMLElement('div', {
            style: 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: var(--flxn-bg, rgba(255,255,255,0.7)); opacity: 0.9; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; backdrop-filter: blur(4px); border-radius: 8px; color: var(--flxn-text, #333); transition: opacity 0.2s ease;',
            innerHTML: safeHTML(`<span style="display: flex; font-size: 36px;">${UI_ICONS.loader}</span><span style="margin-top: 10px; font-weight: 500; font-size: 13px;">Loading Sketch...</span>`)
          });
          
          scratchpadContainer.appendChild(loaderOverlay);
          try {
            const rawBlob = await getAttachmentData(existingVec);
            const jsonText = await new Blob([rawBlob]).text();
            padInstance.loadVectorData(jsonText);
          } catch (err) {
            logError("Failed to load scratchpad vectors:", err);
            showNotification("Failed to load sketch data.", { icon: UI_ICONS.error });
          } finally {
            isPadDirty = false;
            loaderOverlay.style.opacity = '0';
            setTimeout(() => {
              loaderOverlay.remove();
              scratchpadContainer.style.pointerEvents = '';
            }, 200);
          }
        }
      }
      padInstance.refresh();
      scratchpadContainer.addEventListener('flxn-theme-changed', (e) => {
        if (padInstance) padInstance.updateTheme(e.detail);
      });
    }

    if (isPadActive) openScratchpad();

    const getIconHTML = (iconName) => {
      const rawIcon = window.FluxKit.ui.icons[iconName];
      return safeHTML(`<span style="display:flex;">${rawIcon}</span>`);
    };

    const togglePadBtn = createHTMLElement('button', {
      className: 'flxn-icon-btn',
      style: 'width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center;',
      icon: isPadActive ? 'textCaret' : 'scribble',
      flxNotesTooltip: `${isPadActive ? 'Open Text Editor' : 'Open Scratchpad'}`,
      eventListener: {
        click: async (e) => {
          e.preventDefault();
          isPadActive = !isPadActive;
          if (isPadActive) {
            togglePadBtn.innerHTML = getIconHTML('textCaret');
            togglePadBtn.dataset.flxNotesTooltip = 'Open Text Editor';
            await openScratchpad();
            updateActiveScratchpadState();
          }
          else {
            scratchpadContainer.style.display = 'none';
            editorContainer.style.display = 'block';
            togglePadBtn.innerHTML = getIconHTML('scribble');
            togglePadBtn.dataset.flxNotesTooltip = 'Open Scratchpad';
            updateScratchpadData();
            updateActiveScratchpadState();
          }
        }
      }
    });

    const modalContent = createHTMLElement('div', { class: 'flxn-modal-content',
      children: [
        editorContainer,
        scratchpadContainer,
        createTagInput(note.tags),
        noteURLInput = createHTMLElement('input', { id: 'flxn-note-url', placeholder: 'URL', value: note.url }),
        attachmentsWrapper = createHTMLElement('div', { style: 'margin-top: 10px;' })
      ]
    })

    const modalHeader = createHTMLElement('h3', {
      class: 'flxn-modal-header',
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

    const modal = createHTMLElement('dialog', { class: `flxn-modal flxn-${note.id}`, id: MODAL_IDS.NOTE,
      children: [
        createHTMLElement('div', { class: 'flxn-header-wrapper', children: [modalHeader]}),
        modalContent,
        createHTMLElement('div', { class: 'flxn-modal-footer',
          children: [
            actionBtnsWrapper,
            createHTMLElement('div', {
              style: 'display:flex; gap:8px;',
              children: [
                createHTMLElement('button', {
                  id: 'flxn-save-note',
                  textContent: 'Save',
                  style: 'min-width: 80px; transition: all 0.2s ease;',
                  eventListener: async (e) => {
                    const btn = e.target;
                    try {
                      btn.disabled = true;
                      btn.innerHTML = safeHTML(`<span style="display:flex;align-items:center;justify-content:center;gap:6px;">${UI_ICONS.loader} Saving...</span>`);
                      btn.style.opacity = '0.8';
                      btn.style.cursor = 'not-allowed';

                      let finalDescription = mdeInstance.value();
                      if (isPadActive) await updateScratchpadData();

                      const removedAttachments = (note.attachments || []).filter(
                        a1 => !activeAttachments.find(a2 => a2.id === a1.id)
                      );
                      removedAttachments.forEach(att => queueAssetForDeletion(att));

                      const updatedNote = {
                        id: note.id,
                        title: modalHeader.textContent.trim(),
                        description: finalDescription,
                        tags: getTagsFromWrapper(unQuery('.flxn-tag-input-wrapper')),
                        url: noteURLInput.value.trim(),
                        attachments: activeAttachments,
                        pinned: note.pinned || false,
                      };

                      if (!updatedNote.title) {
                        showNotification('Title is required.');
                        modal.querySelector('.flxn-modal-header').focus();
                        throw new Error('Title is required');
                      }

                      saveNote(updatedNote);

                      btn.style.background = '#28a745';
                      btn.style.color = '#fff';
                      btn.style.border = '1px solid #28a745';
                      btn.innerHTML = safeHTML(`<span style="display:flex;align-items:center;justify-content:center;gap:6px;">${UI_ICONS.success} Saved!</span>`);

                      setTimeout(() => {
                        closeModalDialogue(modal);
                      }, 500);

                      setTimeout(() => closeModalDialogue(modal), 500);
                      renderNotes();
                      if (onSaveCallback) await onSaveCallback(updatedNote);

                    } catch (err) {
                      btn.innerHTML = safeHTML(`<span style="display:flex;align-items:center;justify-content:center;gap:6px;">${UI_ICONS.warning} Error</span>`);
                      btn.dataset.flxNotesTooltip = err.message || 'Error';
                      btn.style.background = '#dc3545';
                      setTimeout(() => {
                        btn.dataset.flxNotesTooltip = 'Save';
                        btn.disabled = false;
                        btn.innerHTML = safeHTML('Save');
                        btn.style.background = '';
                      }, 2000);
                    }
                  }
                }),
                createHTMLElement('button', {
                  id: 'flxn-cancel-note', textContent: 'Cancel',
                  eventListener: () => { requestSafeClose(); }
                })
              ]
            })
          ]
         })
      ],
     });

    const hasUnsavedChanges = () => {
      if (modalHeader.textContent.trim() !== (note.title || 'Untitled')) return true;
      if (mdeInstance && mdeInstance.value() !== (note.description || '')) return true;
      if (noteURLInput.value.trim() !== (note.url || '')) return true;
      
      const currentTags = getTagsFromWrapper(modal.querySelector('.flxn-tag-input-wrapper')) || [];
      if (JSON.stringify(currentTags) !== JSON.stringify(note.tags || [])) return true;
      
      const currentAttIds = activeAttachments.map(a => a.id).sort().join(',');
      if (originalAttIds !== currentAttIds) return true;

      if (isPadDirty) return true;

      return false;
    };

    const requestSafeClose = async () => {
      if (hasUnsavedChanges()) {
        if (!await confirmAction('You have unsaved changes. Discard them?')) return;
      }      
      if (onCancelCallback) onCancelCallback();
      closeModalDialogue(modal);
    };

    withTTPatched(() => {
      mdeInstance = getMDEInstance(modal, editorTextarea, note.description);
    });
    injectToolbarIcons(mdeInstance);

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
          : `<span style="display: flex; align-items: center; justify-content: center; width: 16px; height: 16px;">${UI_ICONS.document}</span>`;

        let statusIndicator = '';
        const profile = getCurrentProfile();
        const isLocal = !profile || !profile.provider || profile.provider === 'Local';
        if (att.uploadPending && !isLocal) {
          if (att.sourceOrigin !== window.location.origin) {
            const host = att.sourceOrigin.replace(/^https?:\/\//i, '');
            statusIndicator = `<span style="color: #f59e0b; margin-left: 6px; display: inline-flex; align-items: center;" data-flx-notes-tooltip="Trapped on ${host}. Open that site to upload!">${UI_ICONS.warning}</span>`;
          } else {
            statusIndicator = `<span style="color: var(--flxn-accent-text); margin-left: 6px; display: inline-flex; align-items: center;" data-flx-notes-tooltip="Not uploaded to cloud yet...">${UI_ICONS.hourglassSpin}</span>`;
          }
        }

        const chip = createHTMLElement('div', {
          style: 'display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px; font-size: 11px; border: 1px solid var(--flxn-modal-border-color); cursor: pointer;',
          flxNotesTooltip: 'Click to open/preview',
          children: [
            createHTMLElement('span', { innerHTML: safeHTML(icon) }),
            createHTMLElement('span', { textContent: displayName, style: 'max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' }),
            statusIndicator ? createHTMLElement('span', { innerHTML: safeHTML(statusIndicator) }) : '',
            createHTMLElement('span', {
              innerHTML: safeHTML(UI_ICONS.close),
              style: 'margin-left: 4px; opacity: 0.6; display: inline-flex; align-items: center; justify-content: center;',
              flxNotesTooltip: 'Remove',
              eventListener: {
                click: async (e) => {
                  e.stopPropagation();
                  activeAttachments = activeAttachments.filter(a => a.id !== att.id);
                  if (isSystemPreview) {
                    if (!await confirmAction('This will permanently delete your scratchpad drawing. Are you sure?')) return;
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
      className: 'flxn-icon-btn',
      style: 'width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center;', icon: 'camera',
      flxNotesTooltip: `${!isScreenshotHelperInstalled ? 'Flux Screenshot Helper extension required' : 'Capture Screenshot'}`,
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

              await queueAttachmentForUpload(id, rawBlob);

              const filename = `screenshot_${Date.now()}.png`;
              activeAttachments.push({
                id,
                filename: filename,
                type: 'image/png',
                size: rawBlob.size,
                providerStorage: 'native',
                storagePath: `assets/${generateAssetFilename(filename, id, note.title)}`,
                thumbnailFile: null, // Assigned by sync engine
                data: thumbnailData,
                uploadPending: true,
                sourceOrigin: window.location.origin
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

    // Native File Attachment Button (Only if profile allows it!)
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

            const prevIcon = attachBtn.innerHTML;
            attachBtn.innerHTML = safeHTML(UI_ICONS.loader);
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
                storagePath: `assets/${generateAssetFilename(file.name, id, note.title)}`,
                thumbnailFile: null,
                data: thumbnailData,
                uploadPending: true,
                sourceOrigin: window.location.origin
              });

              showNotification(`Attached ${file.name}`);
              renderAttachmentsList();
            } catch (err) {
              logError(err);
              showNotification('Failed to attach file.', { icon: UI_ICONS.error });
            } finally {
              attachBtn.innerHTML = safeHTML(prevIcon);
              attachBtn.disabled = false;
              fileInput.value = '';
            }
          }
        }
      });

      const attachBtn = createHTMLElement('button', {
        className: 'flxn-icon-btn',
        style: 'width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center;',
        innerHTML: safeHTML(UI_ICONS.paperclip),
        flxNotesTooltip: 'Attach File',
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
    applyTheme();
    modal.requestSafeClose = requestSafeClose;

    const wrapper = createHTMLElement('div', { id: `${MODAL_IDS.NOTE}-${note.id}-container`, class: 'flxn-modal-wrapper', children: modal });
    getAppRoot().appendChild(wrapper);
    applyModalCascade(modal);
    requestAnimationFrame(() => {
      modal.classList.add('show');
      bringToFront(modal);
      makeElementDragAndResize(modal, modal.querySelector('div.flxn-header-wrapper'), { minWidth: 298, minHeight: 326 });
    });
    
    modal.addEventListener('modal-closed', () => {
      if (padInstance) {
        padInstance.destroy();
        logMessage(`Cleaned up FluxKit Scratchpad instance for note: ${note.id}`);
      }
    }, { once: true });
  }

  function openSettingsModal() {
    const existingModal = $(MODAL_IDS.SETTINGS);
    let savedCoords = null;
    if (existingModal) {
      if (existingModal.style.top) savedCoords = { top: existingModal.style.top, left: existingModal.style.left };
      closeModalDialogue(existingModal);
    }
    const userTheme = config.theme || 'auto';
    const profiles = getAllProfiles();
    const currentProfileName = getCurrentProfileName() || profiles[0]?.name || '';
    let currentProfile = profiles.find(p => p.name === currentProfileName) || { name: 'Default', provider: 'Local' };

    const syncIntervalLabel = createHTMLElement('label', {
      class: 'flxn-form-row',
      children: [
        createHTMLElement('div', { textContent: 'Sync frequency', class: 'flxn-form-label' }),
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

    const profileRow = createHTMLElement('div', { class: 'flxn-profile-row',
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
        createHTMLElement('button', { id: 'new-profile-btn', flxNotesTooltip: 'New Profile', class: 'flxn-icon-btn', icon: 'fileAdd', eventListener: async () => {
          const name = await promptUser('Enter new profile name:');
          if (name && !allProfiles.find(p => p.name === name)) {
            await saveProfile({ provider: 'Local', name });
            openSettingsModal();
          } else if (allProfiles.find(p => p.name === name)) alert('A profile with this name already exists.');
        }}),
        createHTMLElement('button', { id: 'delete-profile-btn', flxNotesTooltip: 'Delete Profile', class: 'flxn-icon-btn', icon: 'fileDelete', eventListener: async () => {
          const isLocal = !currentProfile.provider || currentProfile.provider === 'Local';
          const confirmMsg = isLocal 
            ? `Delete the local profile: "${currentProfileName}"?\n\n⚠️ WARNING: This profile is NOT synced to the cloud. All notes and images will be PERMANENTLY deleted and cannot be restored!`
            : `Delete the profile: "${currentProfileName}"?\n\nThis will remove it from this browser. Your notes will remain safely stored on ${currentProfile.provider}.`;

          if (!await confirmAction(confirmMsg)) return;
          await completelyDeleteProfile(currentProfileName);
          openSettingsModal();
          renderNotes();
        }}),
      ]});

    const lastSync = config.lastSyncTime
      ? new Date(config.lastSyncTime).toLocaleString()
      : 'Never';

    const profileActionContainer = createHTMLElement('div', { id: 'flxn-profile-action-container' });

    const renderSetupButton = () => {
      profileActionContainer.innerHTML = safeHTML('');
      const btn = createHTMLElement('button', {
        textContent: '✨ Set up Sync Wizard',
        eventListener: () => {
          const wizardContainer = createHTMLElement('div', { id: 'flxn-wizard-container' });

          profileActionContainer.innerHTML = safeHTML('');
          profileActionContainer.appendChild(wizardContainer);

          const rootContainer = getAppRoot();
          const defaultSub = currentProfileName || 'Default';
          window.activeUnSyncWizard = new FluxKit.sync.Wizard(rootContainer, { namespace: 'FluxNotes', defaultSubFolder: defaultSub, theme: activeThemeBridge }, async (data) => {
            const newCaps = FluxKit.sync.getCapabilities({ provider: data.provider });
            const { usedMB } = calculateStorageUsage();
            if (usedMB * 1024 * 1024 > newCaps.totalQuota) {
              showNotification(`Blocked: Your local data (${usedMB.toFixed(1)}MB) exceeds the ${data.provider} quota.`, { icon: UI_ICONS.ban, duration: 6000 });
              openSettingsModal();
              return;
            }

            const oversizeFile = getNotes().flatMap(n => n.attachments || []).find(a => (a.size || 0) > newCaps.maxFileSize);
            if (oversizeFile) {
              showNotification(`Blocked: File '${oversizeFile.filename}' exceeds ${data.provider}'s ${(newCaps.maxFileSize/1024/1024).toFixed(1)}MB limit.`, { icon: UI_ICONS.ban, duration: 6000 });
              openSettingsModal();
              return;
            }
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
          class: 'flxn-form-label',
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
        createHTMLElement('div', { class: 'flxn-profile-btn-row',
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
            
            createHTMLElement('button', { 
              textContent: 'Disconnect', 
              style: 'width:124px; background: transparent; color: #e74c3c; border: 1px solid #e74c3c;',
              eventListener: async () => {
                if (await confirmAction(`Disconnect ${currentProfile.name} from ${currentProfile.provider}? Local files will remain safe.`)) {
                  updateProfile({ name: currentProfile.name, provider: 'Local' });
                  showNotification('Profile disconnected. Reverted to Local storage.', { icon: UI_ICONS.success });
                  openSettingsModal();
                }
              }
            })
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
          innerHTML: safeHTML('Click an input to record your keys.<br><strong style="color: var(--flxn-accent-text, #007bff);">Press Enter to save</strong> your new combo.')
        }),
        ...(shortcutFields.map(({ id, label, key }) =>
          createHTMLElement('label', {
            class: 'flxn-form-row',
            children: [
              createHTMLElement('div', { textContent: label.replace(' Shortcut:', ''), class: 'flxn-form-label' }),
              createHTMLElement('input', {
                id,
                type: 'text',
                readOnly: true,
                value: FluxKit.utils.formatShortcutForDisplay(getShortcutConfig(key)),
                style: 'text-align: center; font-family: monospace; cursor: pointer;',
                eventListener: {
                  focus: (e) => {
                    isShortcutUpdating = true;
                    e.target.style.borderColor = 'var(--flxn-accent-bg, #007bff)';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.25)';
                    e.target.value = 'Press keys... (Enter to save)';
                    
                    delete e.target.dataset.tempStored;
                  },
                  blur: (e) => {
                    isShortcutUpdating = false;
                    e.target.style.borderColor = '';
                    e.target.style.boxShadow = '';
                    
                    e.target.value = FluxKit.utils.formatShortcutForDisplay(getShortcutConfig(key));
                  },
                  keydown: (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    if (e.key === 'Escape') {
                      e.target.blur();
                      return;
                    }

                    if (e.key === 'Enter') {
                      const attemptedStored = e.target.dataset.tempStored;
                      const currentStored = getShortcutConfig(key);

                      if (!attemptedStored || attemptedStored === currentStored) {
                        e.target.blur();
                        return;
                      }

                      const duplicateField = shortcutFields.find(
                        f => getShortcutConfig(f.key) === attemptedStored && f.key !== key
                      );
                      
                      if (duplicateField) {
                        e.target.blur();

                        const conflictName = duplicateField.label.replace(' Shortcut:', '');
                        const displayAttempt = FluxKit.utils.formatShortcutForDisplay(attemptedStored);
                        
                        showNotification(
                          `❌ Error: ${displayAttempt} is already used by "${conflictName}"`,
                          4000, null, null,
                          { animationType: 'bounce', progressGradient: '#ff4757' }
                        );
                        return;
                      }
                      
                      updateShortcutConfig(key, attemptedStored);
                      
                      showNotification(`Shortcut updated to ${FluxKit.utils.formatShortcutForDisplay(attemptedStored)}`);
                      e.target.blur();
                      return;
                    }

                    const { stored, display, isModifierOnly } = FluxKit.utils.getShortcutFromEvent(e);
                    
                    if (stored && !isModifierOnly) {
                      e.target.value = display;
                      e.target.dataset.tempStored = stored;
                    }
                  }
                }
              })
            ]
          })
        ))
      ]
    });

    const storageInfo = createHTMLElement('div', {
      id: 'storage-usage',
      style: `
        margin: 6px 0 12px 0;
        font-size: 13px;
      `
    });

    const themeControls = createHTMLElement('div', {
      children: [
        createHTMLElement('label', { class: 'flxn-form-row',
          children: [
            createHTMLElement('div', { textContent: 'Theme', class: 'flxn-form-label'}),
            createHTMLElement('select', {
              id: 'theme-select',
              children: Object.entries(THEME_PRESETS).map(([key, preset]) => createHTMLElement('option', { value: key, textContent: preset.name, selected: key === userTheme })),
              eventListener: { change: (e) => {
                const selected = e.target.value;
                tempThemeSwitch = false;
                applyTheme(selected);
                const customPanel = unQuery('#flxn-custom-theme-panel');
                if (customPanel) { customPanel.style.display = selected === 'custom' ? 'flex' : 'none'; }
              }}
            })
          ]
        }),
        createHTMLElement('div', {
          id: 'flxn-custom-theme-panel',
          style: `display: ${userTheme === 'custom' ? 'flex' : 'none'};`,
          children: [
            { key: 'bg', label: 'Main Background' },
            { key: 'inputBg', label: 'Input Background' },
            { key: 'text', label: 'Text Color' },
            { key: 'accentText', label: 'Accent Text' },
            { key: 'accentBg', label: 'Accent Background' },
            { key: 'btnTextColor', label: 'Button Text' }
          ].map(prop => createHTMLElement('input', {
            type: 'color',
            class: 'flxn-color-picker',
            value: config.customTheme[prop.key],
            dataset: { flxNotesTooltip: prop.label, tooltipDelay: 50 },
            eventListener: {
              input: (e) => {
                config.customTheme[prop.key] = e.target.value;
                THEME_PRESETS.custom[prop.key] = e.target.value;
                if (userTheme === 'custom') applyTheme('custom');
              }
            }
          }))
        }),
      ]
    });

    const leftColumn = createHTMLElement('div', { class: 'flxn-settings-col', children: [ profileLabel,  isProfileConfigured(currentProfile) ? profileDetails : profileActionContainer, themeControls ] });

    const rightColumn = createHTMLElement('div', { class: 'flxn-settings-col', children: shortcutDetails });

    const settingsLayoutWrapper = createHTMLElement('div', { class: 'flxn-settings-layout', children: [leftColumn, rightColumn] });

    const isSyncReady = isProfileConfigured(currentProfile);

    const modal = createHTMLElement('dialog', { class: 'flxn-modal', id: MODAL_IDS.SETTINGS,
      children: [
        createHTMLElement('div', {
          class: 'flxn-modal-header-wrapper', style: { cursor: 'move' },
          children: [createHTMLElement('h3', { class: 'flxn-modal-header', textContent: 'Settings' })]
        }),
        storageInfo,
        createHTMLElement('div', { class: 'flxn-modal-content', children: [settingsLayoutWrapper] }),
        createHTMLElement('div', { class: 'flxn-modal-footer',
          children: [
            createHTMLElement('button', { style: 'width:100px;',
              innerHTML: safeHTML(`<span style="display:flex;align-items:center;justify-content:center;gap:6px;">${UI_ICONS.export} Export</span>`),
              eventListener: (e) => {
                const rect = e.target.getBoundingClientRect();
                createContextMenu(rect.left, rect.bottom, [
                  { label: 'JSON', action: () => exportNotes() },
                  { label: 'Markdown', action: () => exportNotesAsMarkdown() },
                  { label: 'CSV', action: () => exportNotesAsCSV() }
                ], ctxNamespace);
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
                      const input = createHTMLElement('input', { type: 'file', accept: '.json' });// 
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
                      const input = createHTMLElement('input', { type: 'file', accept: '.json' });
                      input.onchange = (ev) => {
                        const file = ev.target.files[0];
                        if (file) importNotes(file, 'overwrite');
                      };
                      input.click();
                    }
                  }
                ], ctxNamespace);
              }
            }),
            createHTMLElement('button', {
              innerHTML: safeHTML(`<span style="display:flex;align-items:center;justify-content:center;gap:6px;">${UI_ICONS.sync} Sync</span>`),
              style: 'width:100px;margin-left:8px;', disabled: !isSyncReady,
              eventListener: async () => {
                await syncNotesData(true);
              }
            })
          ]
        })
      ]
    });
    const checkSettingsWidth = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 800) {
        el.classList.add('flxn-wide-mode');
        shortcutDetails.open = true;
        if (isConfigured) { profileDetails.open = true; }
      } else el.classList.remove('flxn-wide-mode');
    };

    getAppRoot().appendChild(modal);
    applyModalCascade(modal, savedCoords);
    requestAnimationFrame(() => {
      modal.classList.add('show');
      updateStorageUsageDisplay();
      bringToFront(modal);
      makeElementDragAndResize(modal, modal.querySelector('div.flxn-modal-header-wrapper'), {
        onAnyResize: checkSettingsWidth
      });
    });
    trapTabFocus(modal);

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
    const existingModal = $(MODAL_IDS.TAG_MERGE);
    let savedCoords = null;
    if (existingModal) {
      if (existingModal.style.top) savedCoords = { top: existingModal.style.top, left: existingModal.style.left };
      closeModalDialogue(existingModal);
    }
    const allTags = getAllTags();
    if (allTags.length < 2) {
      alert('You need at least 2 tags to merge.');
      return;
    }

    const modal = createHTMLElement('dialog', {
      className: 'flxn-modal',
      id: MODAL_IDS.TAG_MERGE,
      style: 'padding: 16px; max-width: 320px;',
      children: [
        createHTMLElement('div', {
          class: 'flxn-modal-header-wrapper', style: { cursor: 'move' },
          children: [createHTMLElement('h3', { class: 'flxn-modal-header', textContent: '🔀 Merge Tags' })]
        }),
        createHTMLElement('div', { class: 'flxn-modal-content',
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
          class: 'flxn-modal-footer',
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
    applyModalCascade(modal, savedCoords);
    requestAnimationFrame(() => {
      modal.classList.add('show');
      bringToFront();
    });
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
    const tagContainer = $('flxn-tag-list');
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
        className: `flxn-tag-chip ${state || ''}`,
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
                  $('flxn-search-input').value = tag;
                  renderNotes();
                }
              },
              {
                label: `${UI_ICONS.edit} Rename tag`,
                action: async () => {
                  const newName = await promptUser(`Rename tag "${tag}" to:`, tag);
                  if (newName && newName.trim() !== tag) {
                    renameTag(tag, newName.trim());
                  }
                }
              },
              {
                label: `${UI_ICONS.trash} Delete tag`,
                action: async () => {
                  if (await confirmAction(`Delete tag "${tag}" from all notes?`)) {
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
            ], ctxNamespace);
          }
        }
      });
      tagContainer.appendChild(tagEl);
    });
  }

  function createTagInput(existingTags = []) {
    const wrapper = createHTMLElement('div', {
      className: 'flxn-tag-input-wrapper',
    });

    const input = createHTMLElement('input', {
      type: 'text',
      id: 'flxn-tag-input',
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
    const existing = [...wrapper.querySelectorAll('.flxn-tag-chip')]
      .map(el => el.dataset.tag.toLowerCase());
    if (existing.includes(tag.toLowerCase())) return;

    const chip = createHTMLElement('span', {
      className: 'flxn-tag-chip',
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

  function getShortcutConfig(key, forDisplay = false) {
    const shortcutConfig = config.shortcuts || {};
    const shortcut = shortcutConfig[key] || DEFAULT_SHORTCUT_KEYS[key];
    return forDisplay ? FluxKit.utils.formatShortcutForDisplay(shortcut) : shortcut;
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

    // Exact substring
    const idx = s.indexOf(q);
    if (idx !== -1) {
      return {
        indices: rangeIndices(idx, qlen),
        type: 'exact',
        span: qlen - 1,
        maxGap: 1
      };
    }

    // Greedy subsequence search with evaluation of candidates
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

    return res;
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
    return [...wrapper.querySelectorAll('.flxn-tag-chip')].map(el => el.dataset.tag);
  }

  // ------------------------
  // MD Editor
  // ------------------------
  const EASYMDE_ICONS = {
    'fa-bold': FluxKit.ui.icons.bold, 'fa-italic': FluxKit.ui.icons.italic, 'fa-strikethrough': FluxKit.ui.icons.strikethrough, 'fa-header': FluxKit.ui.icons.heading,
    'fa-code': FluxKit.ui.icons.code, 'fa-quote-left': FluxKit.ui.icons.quote, 'fa-eraser': FluxKit.ui.icons.eraser,
    'fa-list-ul': FluxKit.ui.icons.listUl, 'fa-list-ol': FluxKit.ui.icons.listOl, 'fa-check-square-o': FluxKit.ui.icons.checkSquare,
    'fa-link': FluxKit.ui.icons.link, 'fa-picture-o': FluxKit.ui.icons.image, 'fa-image': FluxKit.ui.icons.image, 'fa-table': FluxKit.ui.icons.table, 'fa-minus': FluxKit.ui.icons.minus,
    'fa-eye': FluxKit.ui.icons.preview, 'fa-columns': FluxKit.ui.icons.columns, 'fa-arrows-alt': FluxKit.ui.icons.maximize,
    'fa-question-circle': FluxKit.ui.icons.question, 'fa-undo': FluxKit.ui.icons.undo, 'fa-redo': FluxKit.ui.icons.redo,
  };

  function injectToolbarIcons(mdeInstance) {
    const toolbar = mdeInstance.gui.toolbar;
    if (!toolbar) return;

    toolbar.querySelectorAll('i').forEach(iconElement => {
      if (iconElement.dataset.iconInjected) return;

      const className = Array.from(iconElement.classList).find(c => c.startsWith('fa-'));
      const flxIcon = EASYMDE_ICONS[className];

      if (flxIcon) {
        const span = document.createElement('span');
        span.className = 'flx-icon-fallback';
        span.innerHTML = safeHTML(flxIcon);

        iconElement.parentNode.insertBefore(span, iconElement);
        iconElement.style.display = 'none';

        iconElement.dataset.iconInjected = 'true';
      }
    });
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

      mdeInstance.value(newText);

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
          rootModal.classList.add('flxn-fullscreen-active');
        } else {
          rootModal.classList.remove('flxn-fullscreen-active');
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
  async function exportNotes() {
    showNotification('Preparing export... This might take a second.', { icon: UI_ICONS.sync });
    
    const notes = JSON.parse(JSON.stringify(getNotes()));

    for (const note of notes) {
      if (note.attachments) {
        for (const att of note.attachments) {
          if (att._systemRef === 'scratchpad-vector') {
            try {
              const data = await getAttachmentData(att);
              if (data) {
                att.data = data instanceof Blob ? await data.text() : data;
              }
            } catch (e) {
              logWarning('Failed to embed vector for export', e);
            }
          }
        }
      }
    }

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

      if (note.attachments && note.attachments.length > 0) {
        content += `- 📎 Attachments:\n`;
        note.attachments.forEach(a => {
          if (a.storagePath) {
            const isImg = a.filename.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
            content += `  - ${isImg ? '!' : ''}[${a.filename}](./${a.storagePath})\n`;
          } else {
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
      ['id', 'title', 'description', 'url', 'tags', 'attachments', 'createdAt'],
      ...notes.map(note => {
        const attNames = (note.attachments || []).map(a => a.filename).join('; ');

        return [
          note.id,
          JSON.stringify(note.title || ''),
          JSON.stringify(note.description || ''),
          note.url || '',
          (note.tags || []).join('; '),
          JSON.stringify(attNames),
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
    
    reader.onload = async (e) => {
      try {
        const importedNotes = JSON.parse(e.target.result);
        if (!Array.isArray(importedNotes)) throw new Error('Invalid file format');

        const capabilities = getCapabilities(getCurrentProfile());
        const MAX_SIZE = capabilities.maxFileSize;

        let vectorsRestored = 0;
        let vectorsSkipped = 0;
        let attachmentsSkipped = 0;
        let manualAssetsNeeded = 0;
        let oversizedCount = 0;

        for (const note of importedNotes) {
          if (note.attachments) {
            const validAttachments = [];

            for (const att of note.attachments) {
              const isVector = att._systemRef === 'scratchpad-vector';
              const isNativeBinary = att.providerStorage === 'native' && !isVector;

              if (capabilities.requiresBatchedBase64) {
                if (isVector) {
                  vectorsSkipped++;
                  continue;
                }
                if (isNativeBinary) {
                  attachmentsSkipped++;
                  continue;
                }
                
                validAttachments.push(att);
              } 
              else {
                if (isVector && att.data) {
                  const dataSize = typeof att.data === 'string' ? att.data.length : att.data.size;
                  
                  if (dataSize > MAX_SIZE) {
                    oversizedCount++;
                    continue;
                  }

                  const blob = new Blob([att.data], { type: 'application/json' });
                  await queueAttachmentForUpload(att.id, blob);

                  att.storagePath = `assets/${generateAssetFilename(att.filename, att.id, note.title)}`;
                  att.providerStorage = 'native';
                  
                  delete att.data;
                  vectorsRestored++;
                  validAttachments.push(att);
                } 
                else if (isNativeBinary && !att.data) {
                  manualAssetsNeeded++;
                  if (!att.storagePath) {
                    att.storagePath = `assets/${generateAssetFilename(att.filename, att.id, note.title)}`;
                  }
                  validAttachments.push(att);
                } 
                else {
                  validAttachments.push(att);
                }
              }
            }
            
            note.attachments = validAttachments;
          }
        }

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

        setTimeout(() => {
          if (capabilities.requiresBatchedBase64 && (vectorsSkipped > 0 || attachmentsSkipped > 0)) {
             showNotification(`⚠️ Gist sync is limited. Skipped ${vectorsSkipped} vectors & ${attachmentsSkipped} files. Upgrade to WebDAV or GitHub Repo to unlock native files!`, { icon: UI_ICONS.warning, duration: 8000 });
          } else {
            if (oversizedCount > 0) {
              showNotification(`⚠️ ${oversizedCount} vectors exceeded the ${(MAX_SIZE/1024/1024).toFixed(1)}MB limit and were skipped.`, { icon: UI_ICONS.warning, duration: 6000 });
            }
            let msg = '';
            if (vectorsRestored > 0) msg += `Restored ${vectorsRestored} scratchpad vectors. `;
            if (manualAssetsNeeded > 0) msg += `Note: ${manualAssetsNeeded} files must be manually copied to the new 'assets' folder.`;
            if (msg) showNotification(msg, { icon: UI_ICONS.info, duration: 6000 });
          }
        }, 2000);

        triggerBackgroundSync();

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

      const strippedNotes = notes.map(n => {
        const clone = { ...n };
        if (clone.attachments) {
           clone.attachments = clone.attachments.map(a => {
              const { data, ...rest } = a;
              return rest;
           });
        }
        return clone;
      });

      const notesJson = JSON.stringify({ notes: strippedNotes, trashed });
      let totalBytes = new Blob([notesJson]).size;

      notes.forEach(note => {
        if (note.attachments) {
          note.attachments.forEach(att => {
            totalBytes += (att.size || 0);
          });
        }
      });

      const usedMB = totalBytes / (1024 * 1024);
      const maxFileMB = getCapabilities(getCurrentProfile()).maxFileSize / (1024 * 1024);
      return { usedMB, maxFileMB, usedStr: formatMB(usedMB) };
      
    } catch (err) {
      logError('Storage calculation failed:', err);
      return { usedMB: 0, usedStr: '0 MB' };
    }
  }

  function collectMetaStats(mergedNotes, notesStr, metaStr) {
    let totalAttachments = 0;
    let attachmentsSize = 0;

    (mergedNotes || []).forEach(note => {
      if (note.attachments) {
        totalAttachments += note.attachments.length;
        note.attachments.forEach(att => {
          attachmentsSize += (att.size || 0);
        });
      }
    });

    const totalBytes = attachmentsSize + (notesStr?.length || 0) + (metaStr?.length || 0);
    const usedMB = totalBytes / (1024 * 1024);

    return {
      totalAttachments,
      totalBytes,
      usedMB: usedMB.toFixed(2),
      usedStr: formatMB(usedMB)
    };
  }

  function updateStorageUsageDisplay() {
    const el = unQuery('.flxn-modal #storage-usage');
    if (!el) return;
    const { usedStr } = calculateStorageUsage();

    const tooltip = 'Total storage space consumed by your notes and attachments.';

    el.innerHTML = safeHTML(`
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span data-flx-notes-tooltip="${tooltip}">💾 Storage used: <strong>${usedStr}</strong></span>
        <button id="flxn-open-storage-mgr" style="padding: 2px 8px; font-size: 11px; cursor: pointer;">Manage</button>
      </div>
    `);

    const btn = el.querySelector('#flxn-open-storage-mgr');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openStorageManagerModal();
      });
    }
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
    const MAX_BATCH_SIZE = getCapabilities(getCurrentProfile());

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
        if (Object.keys(localData).length === 0) changedFiles[fileName] = { content: "{}" };
        else changedFiles[fileName] = { content: JSON.stringify(localData, null, 2) };
      }
    }

    return changedFiles;
  }

  function cleanupTrashedNotes(trashedNotes, allNotes) {
    const now = Date.now();
    const cutoff = now - TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
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
        
        config.trashQueue = config.trashQueue || [];
        if (!config.trashQueue.find(i => i.path === fileName)) {
          config.trashQueue.push({
            path: fileName,
            profile: getCurrentProfileName()
          });
        }
      }
    }
  }

  function queueAssetForDeletion(attachment) {
    if (attachment.providerStorage === 'native') {
      removeQueuedUpload(attachment.id).catch(() => {});
      
      if (attachment.storagePath) {
        config.trashQueue = config.trashQueue || [];
        if (!config.trashQueue.find(i => i.path === attachment.storagePath)) {
          config.trashQueue.push({
            path: attachment.storagePath,
            profile: getCurrentProfileName()
          });
          saveConfig(config);
        }
      }
    }
  }

  async function processTrashQueue() {
    if (!config.trashQueue || config.trashQueue.length === 0) return;
    
    let remainingQueue = [];
    let currentProfileName = getCurrentProfileName();
    let currentProfile = getCurrentProfile();

    const itemsToProcess = config.trashQueue.filter(item => item.profile === currentProfileName);
    const itemsToSkip = config.trashQueue.filter(item => item.profile !== currentProfileName);
    
    remainingQueue.push(...itemsToSkip);

    if (itemsToProcess.length === 0) return;

    logMessage(`Processing ${itemsToProcess.length} items in Trash Queue...`);
    
    for (const item of itemsToProcess) {
      try {
        await FluxKit.sync.deleteAsset(currentProfile, item.path);
        logDebug(`Successfully trashed cloud asset: ${item.path}`);
      } catch (e) {
        logWarning(`Failed to delete asset ${item.path}, keeping in queue`, e);
        remainingQueue.push(item);
      }
    }
    
    config.trashQueue = remainingQueue;
    saveConfig(config);
  }

  function ensureID(note) {
    if (!note.id) note.id = generateId();
    return note.id;
  }

  function generateAssetFilename(originalName, assetId, noteTitle = '') {
    const cleanTitle = noteTitle ? noteTitle.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 25).replace(/_+$/, '') + '-' : '';
    
    const name = originalName.replace(/[^a-zA-Z0-9\.\-_]/g, '_');
    const lastDotIndex = name.lastIndexOf('.');

    if (lastDotIndex === -1) return `${cleanTitle}${name}_${assetId}`;
    
    const finalName = name.substring(0, lastDotIndex);
    const ext = name.substring(lastDotIndex);
    
    return `${cleanTitle}${finalName}_${assetId}${ext}`; 
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

      try {
        if (!isProfileConfigured(profile)) {
          const isLocalProvider = profile.provider === 'Local';
          const isBlankDefault = !profile.provider && !profile.token;

          if (showMessages && !isLocalProvider && !isBlankDefault) {
            showNotification(`Storage profile "${profile.name}" not configured properly.`, { icon: UI_ICONS.warning, id: `${profile.name}-sync` });
          }
          return;
        }

        await processTrashQueue();

        const syncData = await FluxKit.sync.fetch(profile);
        const files = syncData.files || {};

        let meta = {};
        try { meta = JSON.parse(files["meta.json"]?.content || "{}"); } catch {}
        const TOTAL_QUOTA = meta.totalQuota || MAX_GIST_TOTAL_SIZE;

        const remoteNotes = JSON.parse(files["notes.json"]?.content || "[]");

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

              if (!att.data && att.thumbnailFile && localImageMap[att.thumbnailFile]?.[att.id]) {
                att.data = localImageMap[att.thumbnailFile][att.id];
              }
              else if (!att.data && note.imageFile && localImageMap[note.imageFile]?.[note.id]) {
                att.data = localImageMap[note.imageFile][note.id];
              }

              if (att.data && att.data.startsWith('data:image/') && !att.thumbnailFile) {
                att.thumbnailFile = allocateImageToFile(att.id, att.data, localImageMap, meta);
              }

              if (att.providerStorage === 'native') {
                if (att.uploadPending && att.sourceOrigin !== window.location.origin) {
                  logMessage(`Skipping trapped attachment: ${att.filename} (Located on ${att.sourceOrigin})`);
                  continue; 
                }
                try {
                  const rawBlob = await getQueuedUpload(att.id);
                  if (rawBlob) {
                    if (!att.storagePath) {
                      const capabilities = getCapabilities(getCurrentProfile());
                      const folderPrefix = capabilities.requiresBatchedBase64 ? '' : 'assets/';
                      att.storagePath = `${folderPrefix}${generateAssetFilename(att.filename, att.id, note.title)}`;
                    }
                    nativeFilesToUpload[att.storagePath] = { content: rawBlob };
                    blobsToClearFromDB.push(att.id); // Queue for cleanup

                    const liveNote = getNotes().find(n => n.id === note.id);
                    if (liveNote && liveNote.attachments) {
                      const liveAtt = liveNote.attachments.find(a => a.id === att.id);
                      if (liveAtt) liveAtt.storagePath = att.storagePath;
                    }
                  } else if (att.uploadPending) {
                    logWarning(`Expected blob not found in IndexedDB for ${att.id}. Unlocking tab.`);
                    localUploadsPending = Math.max(0, localUploadsPending - 1);
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
          if (clone.attachments) {
            clone.attachments.forEach(a => {
              delete a.data;
              delete a.uploadPending;
              delete a.sourceOrigin;
            });
          };
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
          stats: collectMetaStats(mergedNotes, newNotesContent, JSON.stringify(meta)),
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
          if (showMessages) showNotification(`Everything already synced!`, { icon: UI_ICONS.success, id: `${profile.name}-sync` });

          const currentProfile = getCurrentProfile();
          if (currentProfile.name === profile.name) {
            config.notes = mergeNotes(config.notes || [], mergedNotes, config.trashedNotes || [], cleanedTrashed, cfg.lastSyncTime);
            config.trashedNotes = mergeTrashedLists(config.trashedNotes || [], cleanedTrashed);
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
            [mergedNotes, config.notes].forEach(arr => {
              (arr || []).forEach(n => {
                if (n.attachments) {
                  const a = n.attachments.find(att => att.id === id);
                  if (a) {
                    delete a.uploadPending;
                    delete a.sourceOrigin;
                  }
                }
              });
            });
          }
        } catch (err) {
          if (err.message.includes('QUOTA_EXCEEDED')) {
             showNotification(err.message, { icon: UI_ICONS.warning, id: `${profile.name}-sync` });
             return;
          }
          throw err;
        } finally {
          renderNotes();
        }

        const currentProfile = getCurrentProfile();
        if (currentProfile.name === profile.name) {
          config.notes = mergeNotes(config.notes || [], mergedNotes, config.trashedNotes || [], cleanedTrashed, cfg.lastSyncTime);
          config.trashedNotes = mergeTrashedLists(config.trashedNotes || [], cleanedTrashed);
          config.lastSyncTime = new Date().toISOString();

          saveConfig(config);
        }

        cacheProfileData(profile.name, mergedNotes, cleanedTrashed, new Date().toISOString());
        prunePreviewCache();

        if (showMessages) {
          showNotification(`Sync complete for ${profile.name} (${newMeta.stats.usedStr} used).`, { icon: UI_ICONS.success, id: `${profile.name}-sync` });
        }
      } catch (err) {
        logError("Sync error:", err);
        if (showMessages) showNotification(`Sync failed. Check profile settings or connection.`, { icon: UI_ICONS.error, id: `${profile.name}-sync` });
      } finally {
        window.activeSyncs.delete(profile.name);
        updateSyncIndicatorUI();
      }
    };

    if (fireAndForget) executeSync();
    else await executeSync();
  }

  function mergeNotes(localNotes, remoteNotes, localTrashed = [], remoteTrashed = [], lastSyncTimeStr = 0) {
    const map = new Map();
    const lastSyncTime = new Date(lastSyncTimeStr).getTime();

    const trashedMap = new Map();
    [...localTrashed, ...remoteTrashed].forEach(d => {
      const existing = trashedMap.get(d.id);
      if (!existing || new Date(d.trashedAt) > new Date(existing.trashedAt)) {
        trashedMap.set(d.id, d);
      }
    });

    const remoteMap = new Map(remoteNotes.map(n => [n.id, n]));

    for (const localNote of localNotes) {
      const id = localNote.id || crypto.randomUUID();

      const deletion = trashedMap.get(id);
      if (deletion && new Date(deletion.trashedAt) > new Date(localNote.updatedAt || localNote.createdAt)) continue;

      const remoteNote = remoteMap.get(id);

      if (!remoteNote) {
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
      } 
      else map.set(id, remoteTime > localTime ? remoteNote : localNote);

      remoteMap.delete(id);
    }

    for (const remoteNote of remoteMap.values()) {
      const deletion = trashedMap.get(remoteNote.id);
      if (deletion && new Date(deletion.trashedAt) > new Date(remoteNote.updatedAt || remoteNote.createdAt)) continue;
      map.set(remoteNote.id, remoteNote);
    }

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
        showNotification(`Saving "${currentProfile.name}" in background...`, { icon: UI_ICONS.save, id: `${newProfileName}-pswitch` });
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
        showNotification(`Loaded "${newProfileName}" from local cache.`, { icon: UI_ICONS.zap, id: `${newProfileName}-pswitch` });
      } else {
        config.notes = [];
        config.trashedNotes = [];
        config.lastSyncTime = null;
      }

      saveConfig(config);
      renderNotes();

      showNotification(`Switched to "${newProfileName}".`, { icon: UI_ICONS.success, id: `${newProfileName}-pswitch` });
      checkPendingUploadsOnLoad();
      try {
        await syncNotesData({ ...getSnapshot(), fireAndForget: false, showMessages: true });
        startAutoSyncScheduler();
      } catch (syncErr) {
        logWarning("Initial fetch for new profile failed.", syncErr);
        showNotification(`Switched to "${newProfileName}", but sync failed.`, { icon: UI_ICONS.warning, id: `${newProfileName}-pswitch` });
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

  async function completelyDeleteProfile(profileName) {
    const profileIndex = config.profiles.findIndex(p => p.name === profileName);
    if (profileIndex === -1) return;

    const profileObj = config.profiles[profileIndex];
    showNotification(`Deleting "${profileName}"... syncing final changes.`, { icon: UI_ICONS.sync });

    if (isProfileConfigured(profileObj)) {
      try {
        const notesToSync = profileName === getCurrentProfileName() ? getNotes() : (loadCachedProfileData(profileName)?.notes || []);
        const trashedToSync = profileName === getCurrentProfileName() ? config.trashedNotes : (loadCachedProfileData(profileName)?.trashedNotes || []);
        
        await syncNotesData({
          profile: profileObj,
          notes: notesToSync,
          trashedNotes: trashedToSync,
          config: config,
          showMessages: false,
          fireAndForget: false 
        });
      } catch(e) {
        logWarning(`Final sync failed for deleted profile ${profileName}`, e);
      }
    }

    config.profiles.splice(profileIndex, 1);
    
    if (getCurrentProfileName() === profileName) {
      const fallback = config.profiles[0] ? config.profiles[0].name : 'Default';
      if (!config.profiles.length) {
         config.profiles.push({ provider: 'Local', name: 'Default' });
      }
      config.currentProfile = fallback;
      
      const cached = loadCachedProfileData(fallback);
      config.notes = cached ? cached.notes : [];
      config.trashedNotes = cached ? cached.trashedNotes : [];
      config.lastSyncTime = cached ? cached.lastSyncTime : null;
    }

    saveConfig(config);

    const cacheKey = getProfileCacheKey(profileName);
    GM_deleteValue(cacheKey);

    await cleanOrphanedDatabases();
    
    checkPendingUploadsOnLoad(); 

    showNotification(`Profile "${profileName}" completely removed.`, { icon: UI_ICONS.success });
  }

  // ------------------------
  // Attachments
  // ------------------------
  let isScreenshotHelperInstalled = false;

  function toggleShadowHostVisibility(visible) {
    const host = document.getElementById('flxn-shadow-host');
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

  function requestNativeScreenshot(callback, retries = 3, delay = 2000) {
    logMessage('Requesting screenshot');

    const uniqueId = 'flxn-' + getUniqueId();

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
      renderNotes();
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

  async function handleShortcut(e) {
    if (window.activeUnPadInstance && window.activeUnPadInstance.claimsKey(e)) return;
    const activeModals = Array.from(getAppRoot().querySelectorAll('.flxn-modal.show'));
    if (activeModals.length > 0) {
      const topModal = activeModals.sort((a, b) => {
        return (parseInt(b.style.zIndex) || 0) - (parseInt(a.style.zIndex) || 0);
      })[0];
      
      const padContainer = topModal.querySelector('#flxn-scratchpad-wrapper');
      const topZ = parseInt(topModal.style.zIndex) || 0;
      if (padContainer && padContainer.style.display === 'block' && padContainer._fluxPadInstance && topZ > 10000) {
        if (padContainer._fluxPadInstance.claimsKey(e)) return; 
      }
    }

    if (isShortcutUpdating || FluxKit.utils.shouldIgnoreKeystroke(e)) return;

    if (e.key === 'Escape') {
      const openModals = Array.from(getAppRoot().querySelectorAll('.flxn-modal.show'));
      if (openModals.length > 0) {
        const sortedModals = openModals.sort((a, b) => (parseInt(b.style.zIndex) || 0) - (parseInt(a.style.zIndex) || 0));
        
        const topModal = sortedModals[0];
        if (typeof topModal.requestSafeClose === 'function') {
          await topModal.requestSafeClose();
        } else {
          closeModalDialogue(topModal);
        }
        
        const newSortedModals = openModals.sort((a, b) => (parseInt(b.style.zIndex) || 0) - (parseInt(a.style.zIndex) || 0));
        if (newSortedModals.length > 0 && newSortedModals[0] !== topModal) {
          const newTopModal = newSortedModals[0];
          requestAnimationFrame(() => bringToFront(newTopModal));
        }
      }
      return;
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

    const { stored } = FluxKit.utils.getShortcutFromEvent(e);
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
    document.addEventListener('keydown', handleShortcut, true);
    document.addEventListener('mousedown', (e) => {
      const path = e.composedPath ? e.composedPath() : [e.target];
      const isInsideApp = path.some(node => 
        node.nodeType === Node.ELEMENT_NODE && 
        (node.id === 'flxn-shadow-host' || 
        node.classList.contains('flxn-modal') || 
        node.classList.contains('flxkit-custom-tooltip') || 
        node.classList.contains('flxkit-context-menu'))
      );

      if (!isInsideApp) {
        const openModals = Array.from(getAppRoot().querySelectorAll('.flxn-modal.show'));
        if (openModals.length > 0) {
          const sortedModals = openModals.sort((a, b) => (parseInt(a.style.zIndex) - (parseInt(b.style.zIndex) || 0) || 0));
          sortedModals.forEach((m, idx) => {
            m.style.zIndex = (9900 + idx).toString(); 
          })
        }
        updateActiveScratchpadState();
      }
    }, { capture: true });
  });
})();