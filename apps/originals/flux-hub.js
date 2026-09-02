// ==UserScript==
// @name         Flux Hub
// @namespace    https://github.com/JYashu/flux-suite
// @version      1.1.2
// @description  Universal Command Palette and Search Engine. Press a hotkey to calculate, translate, convert, search the web, or control other Flux scripts instantly.
// @icon         https://logo-bits.s3.us-east-2.amazonaws.com/flux-hub.svg
// @author       JYashu
// @license      Apache-2.0
// @match        *://*/*
// @match        file:///*
// @grant        unsafeWindow
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @require      https://flux-suite.vercel.app/libs/flux-kit/capture.js
// @require      https://flux-suite.vercel.app/libs/flux-kit/sync.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.11.0/math.min.js
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      graph.microsoft.com
// @connect      login.microsoftonline.com
// @connect      my.microsoftpersonalcontent.com
// @connect      proxy-alpha-ivory.vercel.app
// @connect      query1.finance.yahoo.com
// @connect      query2.finance.yahoo.com
// @connect      api.qrserver.com
// @connect      api.frankfurter.app
// @connect      api.coinbase.com
// @connect      news.ycombinator.com
// @connect      api.rss2json.com
// @connect      api.dictionaryapi.dev
// @connect      api.datamuse.com
// @connect      translate.googleapis.com
// @connect      translate.google.com
// @connect      cdn.jsdelivr.net
// @connect      api.ocr.space
// @connect      api.duckduckgo.com
// @connect      en.wikipedia.org
// @connect      geocoding-api.open-meteo.com
// @connect      api.open-meteo.com
// @connect      api-v2.soundcloud.com
// @connect      mzstatic.com
// @connect      itunes.apple.com
// @connect      audius.co
// @connect      lrclib.net
// @connect      *
// ==/UserScript==
/* global FluxKit, math */

(function () {
  /*
   * Copyright 2026 JYashu
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

  if (window.self !== window.top) return;

  const { createLogger, createHTMLElement, safeHTML } = FluxKit.utils;

  function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const { logMessage, logError, logWarning, logDebug } = createLogger('FluxHub');

  const FluxHub = { views: {}, engine: null, ui: null };

  FluxHub.cache = FluxKit.cache.register('flux-hub-lookups', { storage: 'gm', policy: 'lru', maxSize: 50 });

  FluxHub.credCache = FluxKit.cache.register('flux-hub-credentials', { storage: 'gm', policy: 'none' });

  FluxHub.lyricsCache = FluxKit.cache.register('flux-hub-lyrics', { storage: 'gm', policy: 'lru', maxSize: 100 });

  FluxHub.decodeCache = FluxKit.cache.register('music-decoded-tracks', {
    storage: 'memory', policy: 'byte',
    maxBytes: 150 * 1024 * 1024,
    maxEntryBytes: 60 * 1024 * 1024,
    sizeFn: (entry) => entry.byteSize,
    onSet: (v) => logMessage(`Current cache size: ${formatBytes(v.size)}`),
    onEvict: (key, entry) => { if (entry.wavUrl) URL.revokeObjectURL(entry.wavUrl); }
  });

  const STATE_KEYS = {
    ACTIVE_TIMER: 'hub:active_timer',
    ACTIVE_STOPWATCH: 'hub:active_stopwatch',
    ACTIVE_POMODORO: 'hub:active_pomodoro',
    ACTIVE_MEDIA: 'hub:active_media',
    MEDIA_QUEUE: 'hub:media_queue',
    QUEUE_INDEX: 'hub:queue_index',
    QUEUE_LOOP: 'hub:queue_loop',
    QUEUE_SHUFFLE: 'hub:queue_shuffle',
    ACTIVE_PLAYLIST_NAME: 'hub:active_playlist_name',
    SAVED_PLAYLISTS: 'hub:saved_playlists',
    PLAYLIST_TOMBSTONES: 'hub:playlist_tombstones',
    PENDING_ADD_TRACK: 'hub:pending_add_track',
    MUSIC_PROVIDER: 'hub:music_provider',
    DEFAULT_WEATHER_CITY: 'hub:default_weather_city',
    SEARCH_CONFIG: 'hub:config',
    SEARCH_CONFIG_UPDATED_AT: 'hub:config_updated_at',
    PINNED_WIDGETS: 'hub:pinned_widgets',
    PINNED_WIDGET_TOMBSTONES: 'hub:pinned_widget_tombstones',
    CLIP_HISTORY: 'hub:clip_history',
    CUSTOM_BANGS: 'hub:custom_bangs',
    CUSTOM_BANG_TOMBSTONES: 'hub:custom_bang_tombstones',
    CUSTOM_SAAVN_URL: 'hub:custom_saavn_url',
    SYNC_CONFIG: 'hub:sync_config',
    SYNC_BASELINE: 'hub:sync_baseline',
    SEARCH_POS: 'hub:pos',
    MEDIA_VOLUME: 'hub:media_volume',
    SYNC_LEADER: 'hub:sync_leader',
    LYRICS_MODE: 'hub:queue_lyrics_mode',
    LAST_QUERY: 'hub:last_query',
    MUSIC_STATS: 'hub:music_stats',
    MUSIC_HISTORY: 'hub:music_history',
    MUSIC_DISCOVERIES: 'hub:music_discoveries',
    RAPIDAPI_KEY: 'hub:rapid_api_key'
  };

  const FluxHubState = FluxKit.state.register('flux-hub');

  const PlaylistsState = {
    getAll() {
      return FluxHubState.get(STATE_KEYS.SAVED_PLAYLISTS, {});
    },

    getTracks(name) {
      const all = PlaylistsState.getAll();
      return all[name] ? all[name].tracks : null;
    },

    exists(name) {
      return !!PlaylistsState.getAll()[name];
    },

    save(name, tracks) {
      const all = PlaylistsState.getAll();
      all[name] = { tracks, updatedAt: Date.now() };
      FluxHubState.set(STATE_KEYS.SAVED_PLAYLISTS, all);
      if (FluxKit.sync?.auto) AutoSync.notifyLocalChange();
    },

    rename(oldName, newName) {
      const all = PlaylistsState.getAll();
      if (!all[oldName] || all[newName]) return false;
      all[newName] = { tracks: all[oldName].tracks, updatedAt: Date.now() };
      delete all[oldName];
      FluxHubState.set(STATE_KEYS.SAVED_PLAYLISTS, all);
      PlaylistsState._tombstone(oldName);
      if (FluxKit.sync?.auto) AutoSync.notifyLocalChange();
      return true;
    },

    remove(name) {
      const all = PlaylistsState.getAll();
      if (!all[name]) return false;
      delete all[name];
      FluxHubState.set(STATE_KEYS.SAVED_PLAYLISTS, all);
      PlaylistsState._tombstone(name);
      if (FluxKit.sync?.auto) AutoSync.notifyLocalChange();
      return true;
    },

    _tombstone(name) {
      const tombs = PlaylistsState.getTombstones();
      tombs[name] = Date.now();
      PlaylistsState.setTombstones(tombs);
    },

    getTombstones() {
      return FluxHubState.get(STATE_KEYS.PLAYLIST_TOMBSTONES, {});
    },

    setTombstones(t) {
      FluxHubState.set(STATE_KEYS.PLAYLIST_TOMBSTONES, t);
    },
  };

  const BangsState = {
    getAll() {
      return FluxHubState.get(STATE_KEYS.CUSTOM_BANGS, {});
    },

    save(prefix, config) {
      const all = BangsState.getAll();
      all[prefix] = { ...config, updatedAt: Date.now() };
      FluxHubState.set(STATE_KEYS.CUSTOM_BANGS, all);

      const tombs = BangsState.getTombstones();
      if (tombs[prefix]) { delete tombs[prefix]; BangsState.setTombstones(tombs); }
      if (FluxKit.sync?.auto) AutoSync.notifyLocalChange();
    },

    remove(prefix) {
      const all = BangsState.getAll();
      if (!all[prefix]) return false;
      delete all[prefix];
      FluxHubState.set(STATE_KEYS.CUSTOM_BANGS, all);
      BangsState._tombstone(prefix);
      if (FluxKit.sync?.auto) AutoSync.notifyLocalChange();
      return true;
    },

    _tombstone(prefix) {
      const tombs = BangsState.getTombstones();
      tombs[prefix] = Date.now();
      BangsState.setTombstones(tombs);
    },

    getTombstones() {
      return FluxHubState.get(STATE_KEYS.CUSTOM_BANG_TOMBSTONES, {});
    },

    setTombstones(t) {
      FluxHubState.set(STATE_KEYS.CUSTOM_BANG_TOMBSTONES, t);
    },
  };
      
  const DEFAULT_SETTINGS = { theme: 'auto', ocrMode: 'live', launcherTrigger: 'alt+space', commandTrigger: 'shift+>', musicProvider: 'itunes_hub' };

  const SettingsState = {
    getAll() {
      return { ...DEFAULT_SETTINGS, ...FluxHubState.get(STATE_KEYS.SEARCH_CONFIG, {}) };
    },
    save(patch) {
      const merged = { ...this.getAll(), ...patch };
      FluxHubState.set(STATE_KEYS.SEARCH_CONFIG, merged);
      FluxHubState.set(STATE_KEYS.SEARCH_CONFIG_UPDATED_AT, Date.now());
      if (FluxKit.sync?.auto) AutoSync.notifyLocalChange();
      return merged;
    },
  };

  const MergeEngine = (function() {
    const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // GC old tombstones after 30 days

    function mergeKeyedCollection({ baseline = {}, local = {}, remote = {}, localTombstones = {}, remoteTombstones = {} }) {
      const merged = {};
      const outTombstones = { ...localTombstones };
      const now = Date.now();

      const allKeys = new Set([
        ...Object.keys(baseline), ...Object.keys(local), ...Object.keys(remote),
        ...Object.keys(localTombstones), ...Object.keys(remoteTombstones),
      ]);

      for (const key of allKeys) {
        const inBaseline = Object.prototype.hasOwnProperty.call(baseline, key);
        const inLocal = Object.prototype.hasOwnProperty.call(local, key);
        const inRemote = Object.prototype.hasOwnProperty.call(remote, key);
        const localTombAt = localTombstones[key] || 0;
        const remoteTombAt = remoteTombstones[key] || 0;

        if (inLocal && inRemote) {
          merged[key] = (remote[key].updatedAt || 0) > (local[key].updatedAt || 0) ? remote[key] : local[key];
          delete outTombstones[key];
          continue;
        }

        if (inLocal && !inRemote) {
          if (!inBaseline || (local[key].updatedAt || 0) > remoteTombAt) {
            merged[key] = local[key];
            delete outTombstones[key];
          }
          continue; // else: respect remote's deletion, drop it
        }

        if (!inLocal && inRemote) {
          if (!inBaseline || (remote[key].updatedAt || 0) > localTombAt) {
            merged[key] = remote[key];
            delete outTombstones[key];
          }
          continue; // else: respect local's deletion, keep tombstone so it propagates
        }

        // Deleted on both sides — garbage-collect the tombstone once it's old.
        const tombAge = now - Math.max(localTombAt, remoteTombAt);
        if (tombAge < TOMBSTONE_TTL_MS) outTombstones[key] = Math.max(localTombAt, remoteTombAt);
      }

      return { merged, tombstones: outTombstones };
    }

    return { mergeKeyedCollection };
  })();

  const AutoSync = (function() {
    const DEBOUNCE_MS = 4000;
    const PERIODIC_MS = 5 * 60 * 1000;
    const LOCK_TTL_MS = 20000;
    const AUTH_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

    let debounceTimer = null;
    let lastAuthErrorNotifiedAt = 0;
    let syncInFlight = false;
    let releaseLeaderClaim = null;
    const LEADER_STALE_MS = 8000;

    function getActiveProfile() {
      const config = FluxHubState.get(STATE_KEYS.SYNC_CONFIG, { currentProfile: 'Local', syncProfiles: {} });
      if (!config.currentProfile || config.currentProfile === 'Local') return null;
      return config.syncProfiles?.[config.currentProfile] || null;
    }

    function isLeader() {
      const leader = FluxHubState.get(STATE_KEYS.SYNC_LEADER, null);
      return FluxKit.ipc.ownership.isMineOrStale(leader?.hostTab, leader?.timestamp, LEADER_STALE_MS);
    }

    function becomeLeader() {
      if (releaseLeaderClaim) return; // already leader
      releaseLeaderClaim = FluxKit.ipc.ownership.claim((now) => {
        FluxHubState.set(STATE_KEYS.SYNC_LEADER, { hostTab: FluxKit.ipc.getTabId(), timestamp: now });
      });
    }

    function requestSync(reason) {
      runSync(reason);
      FluxKit.ipc.broadcast('request-sync', { reason }, true);
    }

    async function runSync(reason) {
      const profile = getActiveProfile();
      if (!profile) return;
      if (!isLeader()) return;
      becomeLeader();
      if (syncInFlight) return;

      syncInFlight = true;
      try {
        await FluxKit.sync.performFullSync(profile);
        const syncConfig = FluxHubState.get(STATE_KEYS.SYNC_CONFIG, {});
        syncConfig.lastSyncTime = Date.now();
        FluxHubState.set(STATE_KEYS.SYNC_CONFIG, syncConfig);
        FluxKit.ipc.broadcast('sync-completed', { ts: Date.now(), reason }, true);
      } catch (err) {
        logError(`[Auto-sync failed (${reason}):`, err, { __v: 1 });
        if (err.message === 'AUTH_EXPIRED') {
          const now = Date.now();
          if (now - lastAuthErrorNotifiedAt > AUTH_NOTIFY_COOLDOWN_MS) {
            lastAuthErrorNotifiedAt = now;
            FluxKit.ui.showNotification('Cloud sync needs re-authentication — open "> sync" to reconnect.', { icon: 'warning' });
          }
        }
      } finally {
        syncInFlight = false;
      }
    }

    function notifyLocalChange() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => requestSync('local-change'), DEBOUNCE_MS);
    }

    function init() {
      FluxKit.ipc.listen('request-sync', (payload) => runSync(payload.reason || 'remote-request'), true);
      setInterval(() => runSync('periodic'), PERIODIC_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') runSync('visibility');
      });
      window.addEventListener('online', () => runSync('online'));
      setTimeout(() => runSync('startup'), 3000 + Math.random() * 4000);
    }

    return { init, notifyLocalChange, runNow: () => requestSync('manual') };
  })();

  AutoSync.init();

  /**
   * Performs a full bidirectional sync: pulls the remote snapshot, merges it
   * against local state using the last-synced baseline, writes the merged
   * result back locally, pushes it to the provider, and stores it as the
   * new baseline for the next sync.
   */
  FluxKit.sync.performFullSync = async function(profile) {
    const BACKUP_FILE = 'flux_hub_backup.json';
    const keyBy = (arr, k) => Object.fromEntries((arr || []).map(x => [x[k], x]));

    let remote = null;
    try {
      const result = await FluxKit.sync.fetch(profile, { filename: BACKUP_FILE });
      const raw = result?.files?.[BACKUP_FILE]?.content;
      if (raw) remote = JSON.parse(raw);
    } catch (e) {
      if (e.message === 'AUTH_EXPIRED' || e.message === 'SERVER_DOWN') throw e;
    }
    remote ??= { 
      playlists: {}, playlistTombstones: {}, bangs: {}, bangTombstones: {}, 
      widgets: [], widgetTombstones: {}, clipHistory: [], settings: {}, settingsUpdatedAt: 0,
      musicStats: {}, musicHistory: []
    };

    const baseline = FluxHubState.get(STATE_KEYS.SYNC_BASELINE, { playlists: {}, bangs: {}, widgets: {} });

    const localPlaylists = PlaylistsState.getAll();
    const localPlaylistTombs = PlaylistsState.getTombstones();
    const localBangs = BangsState.getAll();
    const localBangTombs = BangsState.getTombstones();
    const localWidgets = keyBy(FluxHubState.get(STATE_KEYS.PINNED_WIDGETS, []), 'id');
    const localWidgetTombs = FluxHubState.get(STATE_KEYS.PINNED_WIDGET_TOMBSTONES, {});

    const pl = MergeEngine.mergeKeyedCollection({ baseline: baseline.playlists, local: localPlaylists, remote: remote.playlists, localTombstones: localPlaylistTombs, remoteTombstones: remote.playlistTombstones });
    const bg = MergeEngine.mergeKeyedCollection({ baseline: baseline.bangs, local: localBangs, remote: remote.bangs, localTombstones: localBangTombs, remoteTombstones: remote.bangTombstones });
    const wg = MergeEngine.mergeKeyedCollection({ baseline: baseline.widgets, local: localWidgets, remote: keyBy(remote.widgets, 'id'), localTombstones: localWidgetTombs, remoteTombstones: remote.widgetTombstones });

    const localSettings = SettingsState.getAll();
    const localSettingsAt = FluxHubState.get(STATE_KEYS.SEARCH_CONFIG_UPDATED_AT, 0);
    const settingsWins = (remote.settingsUpdatedAt || 0) > localSettingsAt;
    const mergedSettings = settingsWins ? remote.settings : localSettings;
    const mergedSettingsAt = Math.max(remote.settingsUpdatedAt || 0, localSettingsAt);

    const localClips = FluxHubState.get(STATE_KEYS.CLIP_HISTORY, []);
    const mergedClips = [...new Set([...localClips, ...(remote.clipHistory || [])])].slice(0, 50);

    let finalMusicStats = FluxHubState.get(STATE_KEYS.MUSIC_STATS, {});
    let finalMusicHistory = FluxHubState.get(STATE_KEYS.MUSIC_HISTORY, []);
    let finalMusicDiscoveries = FluxHubState.get(STATE_KEYS.MUSIC_DISCOVERIES, []);

    FluxKit.musicStats.mergeSync(remote.musicStats || {}, remote.musicHistory || []);
    finalMusicStats = FluxHubState.get(STATE_KEYS.MUSIC_STATS, {});
    finalMusicHistory = FluxHubState.get(STATE_KEYS.MUSIC_HISTORY, []);
    finalMusicDiscoveries = FluxHubState.get(STATE_KEYS.MUSIC_DISCOVERIES, []);

    FluxHubState.set(STATE_KEYS.SAVED_PLAYLISTS, pl.merged);
    PlaylistsState.setTombstones(pl.tombstones);
    FluxHubState.set(STATE_KEYS.CUSTOM_BANGS, bg.merged);
    BangsState.setTombstones(bg.tombstones);
    FluxHubState.set(STATE_KEYS.PINNED_WIDGETS, Object.values(wg.merged));
    FluxHubState.set(STATE_KEYS.PINNED_WIDGET_TOMBSTONES, wg.tombstones);
    FluxHubState.set(STATE_KEYS.SEARCH_CONFIG, mergedSettings);
    FluxHubState.set(STATE_KEYS.SEARCH_CONFIG_UPDATED_AT, mergedSettingsAt);
    FluxHubState.set(STATE_KEYS.CLIP_HISTORY, mergedClips);

    const payload = {
      playlists: pl.merged, playlistTombstones: pl.tombstones,
      bangs: bg.merged, bangTombstones: bg.tombstones,
      widgets: Object.values(wg.merged), widgetTombstones: wg.tombstones,
      clipHistory: mergedClips, settings: mergedSettings, settingsUpdatedAt: mergedSettingsAt,
      musicStats: finalMusicStats, musicHistory: finalMusicHistory, musicDiscoveries: finalMusicDiscoveries
    };

    await FluxKit.sync.upload(profile, { [BACKUP_FILE]: { content: JSON.stringify(payload, null, 2) } }, BACKUP_FILE);

    FluxHubState.set(STATE_KEYS.SYNC_BASELINE, { playlists: pl.merged, bangs: bg.merged, widgets: wg.merged });

    return payload;
  };

  const safeFetch = (url, signal = null) => {
    return new Promise((resolve, reject) => {
      const request = GM_xmlhttpRequest({
        method: 'GET', url: url,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve({ ok: true, json: async () => JSON.parse(res.responseText) });
          else resolve({ ok: false });
        },
        onerror: (err) => reject(err),
        onabort: () => reject(new Error('AbortError'))
      });

      if (signal) signal.addEventListener('abort', () => { if (request && typeof request.abort === 'function') request.abort(); });
    });
  };

  const debounce = (func, wait = 200) => {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  class BaseView {
    constructor(query, context = null) { this.query = query; this.context = context; }

    static isAvailable = true;
    static groupWidgets = false;

    static commandRegistry = [];

    static matchConfidence(query) { return 0; }

    async fetchData(abortSignal) { return null; }

    renderListRow() { return createHTMLElement('div', { textContent:  `Search for "${this.query}"` }); }

    renderExpandedCard(data) { throw new Error(`[Flux Search] ${this.constructor.name} must implement renderExpandedCard()`); }

    execute() {} // Default no-op

    destroy() {} // Default no-op
  }

  class HubStage {
    constructor() {
      this.selectedIndex = -1; this.currentViews = []; this.isVisible = false; this.router = null;
      this.activeContext = null; this.host = null; this.shadow = null; this.container = null;
      this.input = null; this.resultsList = null; this.themeStyle = null;
      this.onClickAway = this.onClickAway.bind(this);
      this.onGlobalKeydown = this.onGlobalKeydown.bind(this);
    }

    getRoot() { return this.shadow }

    isTypingTarget = () => {
      const root = this.shadow, inputEl = this.input;
      const active = root && root.activeElement ? root.activeElement : document.activeElement;
      return active === inputEl;
    }

    _initTouchAndMouseTriggers() {

      const getMenuOptions = () => [
        { label: 'Search Web', icon: 'search', action: () => this.show('', null, null, false) },
        { separator: true },
        { label: 'Music Player', icon: 'play', action: () => this.show('> play ', null, null, false) },
        { label: 'Translate', icon: 'translate', action: () => this.show('> tr ', null, null, false) },
        { label: 'Dictionary', icon: 'book', action: () => this.show('> dict ', null, null, false) },
        { separator: true },
        { label: 'Close Omni', icon: 'close', action: () => this.hide() }
      ];

      document.addEventListener('contextmenu', (e) => {
        if (e.altKey) {
          e.preventDefault();
          FluxKit.ui.createContextMenu(e.clientX, e.clientY, getMenuOptions(), { namespace: 'flux-omni' });
        }
      });

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(navigator.userAgent);

      if (isMobile) {
        const fab = createHTMLElement('div', {
          id: 'flx-omni-fab', icon: 'search', fluxHubTooltip: 'Open FluxHub (Drag to move)',
          style: {
            position: 'fixed', bottom: '24px', right: '24px', width: '44px', height: '44px',
            borderRadius: '50%', background: 'var(--omni-bg)', color: 'var(--omni-text)',
            border: '1px solid var(--omni-border)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', 
            zIndex: '2147483646', opacity: '0.4', backdropFilter: 'blur(10px)',
            transition: 'opacity 0.3s ease, transform 0.2s ease',
            userSelect: 'none', touchAction: 'none'
          },
          eventListener: {
            mouseenter: (e) => { e.target.style.opacity = '1'; e.target.style.transform = 'scale(1.05)'; },
            mouseleave: (e) => { e.target.style.opacity = '0.4'; e.target.style.transform = 'scale(1)'; }
          }
        });

        let startX, startY, isDragging = false;

        fab.addEventListener('pointerdown', (e) => {
          startX = e.clientX; 
          startY = e.clientY; 
          isDragging = false;
          fab.setPointerCapture(e.pointerId);
        });

        fab.addEventListener('pointermove', (e) => {
          if (e.buttons !== 1) return;
          if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
            isDragging = true;
            fab.style.right = 'auto'; 
            fab.style.bottom = 'auto';
            fab.style.left = `${e.clientX - 22}px`;
            fab.style.top = `${e.clientY - 22}px`;
            fab.style.opacity = '0.8';
          }
        });

        fab.addEventListener('pointerup', (e) => {
          fab.releasePointerCapture(e.pointerId);
          fab.style.opacity = '1';
          if (!isDragging) {
            const rect = fab.getBoundingClientRect();
            FluxKit.ui.createContextMenu(rect.left - 140, rect.top - 200, getMenuOptions(), { namespace: 'flux-omni' });
          }
        });

        document.body.appendChild(fab);
      }
    }

    init(routerInstance) {
      this.router = routerInstance;
      this.widgetEngine = new WidgetEngine(this.router);

      this.host = createHTMLElement('div', { id: 'flx-hub-host', style: { position: 'fixed', zIndex: '2147483647', display: 'none' } });

      ['keydown', 'keyup', 'keypress'].forEach(evt => { this.host.addEventListener(evt, e => e.stopPropagation()); });

      this.shadow = this.host.attachShadow({ mode: 'open' });

      this.debouncedHandleInput = debounce((query, context) => { this.router.handleInput(query, context); }, 200);

      this.input = createHTMLElement('input', {
        class: 'flx-omni-input', type: 'text',
        placeholder: 'Search, calculate, or type a command...',
        eventListener: {
          input: e => {
            const query = e.target.value.trim();

            if (!query) {
              if (this.debouncedHandleInput.cancel) this.debouncedHandleInput.cancel();
              this.resultsList.innerHTML = safeHTML('');
              if (this.widgetEngine) this.widgetEngine.renderDashboard(this.resultsList);
              this.currentViews = [];
              this.selectedIndex = -1;
              return;
            }

            this.resultsList.style.display = 'block';
            this.resultsList.style.gap = '0';
            this.resultsList.style.padding = '0';

            if (this.widgetEngine) this.widgetEngine.destroy();

            this.debouncedHandleInput(query, this.activeContext);
          },
        },
      });

      this.resultsList = createHTMLElement('div', { class: 'flx-omni-results' });

      const dragHandle = createHTMLElement('div', { class: 'flx-omni-drag-handle', children: createHTMLElement('div', { class: 'flx-omni-drag-pill' }) });

      this.container = createHTMLElement('div', { class: 'flx-omni-container', children: [dragHandle, this.input, this.resultsList] });

      FluxKit.utils.trapTabFocus(this.container, this.input);

      this.themeStyle = createHTMLElement('style', {});
      const staticStyle = createHTMLElement('style', {
        textContent: `
          .flx-omni-container {
            width: 600px; max-width: 90vw; overflow: hidden;
            display: flex; flex-direction: column;
            border-radius: 12px; border: 1px solid var(--omni-accent);
            box-shadow:
              inset 0 1px 0 color-mix(in srgb, var(--omni-text) 8%, transparent),
              inset 0 0 0 1px color-mix(in srgb, var(--omni-accent) 12%, transparent);
            background: var(--omni-bg);
            color: var(--omni-text);
            font-family: var(--omni-font);
            backdrop-filter: blur(16px) saturate(180%);
            overscroll-behavior: contain;
          }
          .flx-omni-drag-handle {
            width: 100%; height: 16px; cursor: grab; display: flex;
            align-items: center; justify-content: center;
            background: var(--omni-input-bg);
          }
          .flx-omni-drag-handle:active { cursor: grabbing; }
          .flx-omni-drag-pill { width: 32px; height: 4px; border-radius: 2px; background: var(--omni-muted); opacity: 0.5; }
          .flx-omni-input {
            width: 100%; box-sizing: border-box; padding: 12px 20px 20px 20px;
            font-size: 20px; border: none; outline: none;
            background: var(--omni-input-bg); color: var(--omni-text);
            border-bottom: 1px solid var(--omni-separator);
          }
          .flx-omni-results {
            max-height: 400px; overflow-y: auto; display: flex; flex-direction: column; padding: 8px 0;
            overscroll-behavior: contain;
            background:
              linear-gradient(var(--omni-bg) 30%, transparent) top / 100% 24px local no-repeat,
              linear-gradient(transparent, var(--omni-bg) 70%) bottom / 100% 24px local no-repeat,
              radial-gradient(farthest-side at 50% 0, color-mix(in srgb, var(--omni-text) 18%, transparent), transparent) top / 100% 12px scroll no-repeat,
              radial-gradient(farthest-side at 50% 100%, color-mix(in srgb, var(--omni-text) 18%, transparent), transparent) bottom / 100% 12px scroll no-repeat;
          }
          .flx-omni-results:empty { display: none; }
          .flx-omni-row { display: flex; align-items: center; padding: 12px 20px; cursor: pointer; gap: 16px; }
          .flx-omni-row[data-selected="true"], .flx-omni-row:hover { background: var(--omni-hover); }
          .flx-omni-results.flx-kbd-nav .flx-omni-row:hover:not([data-selected="true"]) { background: transparent; }
          .flx-omni-icon { font-size: 20px; color: var(--omni-muted); display: flex; justify-content: center; width: 24px; }
          .flx-omni-content { flex-grow: 1; display: flex; flex-direction: column; }
          .flx-omni-title { color: var(--omni-text); font-weight: 500; font-size: 15px;}
          .flx-omni-subtitle { color: var(--omni-muted); font-size: 13px; margin-top: 2px;}
          .flx-omni-hint { color: var(--omni-muted); font-size: 12px; font-weight: bold;}
          .flx-omni-card { padding: 16px 20px; border-bottom: 1px solid var(--omni-separator); }
          .flx-omni-card-body { color: var(--omni-text); font-size: 15px; line-height: 1.5; }
          .flx-omni-card-footer {
            display: flex; gap: 8px; position: sticky; bottom: -8px;
            background: var(--omni-bg-solid); backdrop-filter: blur(16px) saturate(180%);
            padding: 16px 20px; margin: 16px -20px -16px -20px;
            border-top: 1px solid var(--omni-separator); z-index: 10;
          }
          .flx-omni-btn {
            padding: 6px 12px; border-radius: 6px; border: var(--omni-border);
            background: var(--omni-hover); color: var(--omni-muted); cursor: pointer;
            display: flex; align-items: center; gap: 6px; font-size: 13px;
          }
          .flx-omni-btn:hover { background: var(--omni-accent); color: var(--omni-btn-text); }
          .flx-omni-grid { display: flex; flex-direction: column; gap: 8px; }
          .flx-omni-grid-row { display: flex; justify-content: space-between; font-size: 14px; }
          .flx-omni-grid-label { color: var(--omni-muted); }
          .flx-omni-grid-value { color: var(--omni-text); font-weight: 500; }
          .flx-omni-widget {
            background: var(--omni-bg-light); border: 1px solid var(--omni-border); border-radius: 12px;
            padding: 16px; display: flex; flex-direction: column; justify-content: center;
            min-height: 100px; cursor: pointer; position: relative; overflow: hidden;
            box-shadow: var(--omni-shadow);
            transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
          }
          .flx-omni-widget:hover { transform: translateY(-2px); box-shadow: var(--omni-shadow); border-color: var(--omni-muted); }
          .flx-premium-slider {
            -webkit-appearance: none; appearance: none;
            width: 100%; height: 4px; border-radius: 999px; outline: none;
            cursor: pointer; transition: height 0.15s ease;
          }
          .flx-premium-slider::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 12px; height: 12px; border-radius: 50%;
            background: var(--omni-accent);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--omni-accent) 25%, transparent);
            cursor: pointer; opacity: 0; transform: scale(0.6);
            transition: opacity 0.15s ease, transform 0.15s ease;
          }
          .flx-premium-slider::-moz-range-thumb {
            width: 12px; height: 12px; border-radius: 50%; border: none;
            background: var(--omni-accent);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--omni-accent) 25%, transparent);
            cursor: pointer; opacity: 0; transform: scale(0.6);
            transition: opacity 0.15s ease, transform 0.15s ease;
          }
          .flx-seek-wrap:hover .flx-premium-slider { height: 6px; }
          .flx-seek-wrap:hover .flx-premium-slider::-webkit-slider-thumb,
          .flx-premium-slider:active::-webkit-slider-thumb,
          .flx-premium-slider:focus-visible::-webkit-slider-thumb { opacity: 1; transform: scale(1); }
          .flx-seek-wrap:hover .flx-premium-slider::-moz-range-thumb,
          .flx-premium-slider:active::-moz-range-thumb,
          .flx-premium-slider:focus-visible::-moz-range-thumb { opacity: 1; transform: scale(1); }
          .flx-vol-wrap { position: relative; display: flex; align-items: center; justify-content: flex-end; }
          .flx-vol-popover {
            position: absolute; bottom: calc(100% + 8px); right: -6px;
            background: var(--omni-bg); border: 1px solid var(--omni-border);
            border-radius: 10px; padding: 10px 8px; box-shadow: 0 8px 20px rgba(0,0,0,0.25);
            display: flex; align-items: center; width: 90px; z-index: 5;
            opacity: 0; visibility: hidden; transform: translateY(4px);
            transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s;
          }
          .flx-vol-wrap.flx-vol-active .flx-vol-popover { opacity: 1; visibility: visible; transform: translateY(0); }
          .flx-lyric-line {
            cursor: pointer; padding: 4px 8px; border-radius: 6px;
            transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
            opacity: 0.5; transform-origin: left center;
            font-size: 13px; margin: 2px 0;
          }
          .flx-lyric-line:hover { opacity: 0.8; background: var(--omni-hover); transform: scale(1.02); }
          .flx-lyric-active {
            opacity: 1; color: var(--omni-accent-text);
            font-weight: bold; transform: scale(1.05);
            background: transparent !important;
          }
          .flx-hidden-scroll { scrollbar-width: none; -ms-overflow-style: none; }
          .flx-hidden-scroll::-webkit-scrollbar { display: none; }
        `,
      });

      this.shadow.append(this.themeStyle, staticStyle, this.container);
      document.body.appendChild(this.host);
      this._initTouchAndMouseTriggers();

      FluxKit.utils.attachWindowControls(this.host, dragHandle, { resizable: false, close: false, onDragEnd: e => FluxHubState.set(STATE_KEYS.SEARCH_POS, { x: e.clientX, y: e.clientY }) });
    }

    applyTheme() {
      const config = SettingsState.getAll();

      let theme;
      if (config.theme === 'auto') theme = typeof FluxKit.theme.getSiteStyles === 'function' ? FluxKit.theme.getSiteStyles() : FluxKit.theme.get();
      else theme = FluxKit.theme.get(config.theme);

      this.themeStyle.textContent = `
        :host {
          --omni-bg: ${FluxKit.theme.createAlphaColor(theme.bg, 0.9) };
          --omni-bg-light: ${FluxKit.theme.createAlphaColor(theme.bg, 0.4)};
          --omni-bg-solid: ${FluxKit.theme.createAlphaColor(theme.bg, 1)};
          --omni-input-bg: ${theme.inputBg};
          --omni-text: ${theme.text};
          --omni-muted: ${FluxKit.theme.createAlphaColor(theme.text, 0.6)};
          --omni-border: ${theme.border};
          --omni-separator: ${theme.separator};
          --omni-hover: ${theme.hoverBg};
          --omni-font: ${theme.fontFamily};
          --omni-btn-bg: ${theme.hoverBg};
          --omni-btn-hover: ${theme.btnHoverBg};
          --omni-accent: ${theme.accentBg};
          --omni-accent-text: ${theme.accentText};
          --omni-btn-text: ${theme.btnTextColor};
          --omni-success: ${theme.success};
          --omni-danger: ${theme.danger};
          --omni-warning: ${theme.warning};
          --omni-info: ${theme.info};
          --omni-shadow: ${theme.boxShadow};
        }
      `;

      FluxKit.ui.initContextMenu({ ...theme, namespace: 'fluxHub' });

      FluxKit.ui.initTooltips({
        ...theme,
        rootElement: this.shadow,
        attribute: 'fluxHub',
        border: `1px solid ${theme.accentBg}`,
        delay: 500
      });
    }

    onGlobalKeydown(e) {
      if (!this.isVisible) return;

      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (this.input.value.length > 0) { this.setInputVal(); return; }
        return this.hide();
      }

      const target = e.composedPath ? e.composedPath()[0] : e.target;

      if (target !== this.input && FluxKit.utils.shouldIgnoreKeystroke(e, { ignoreTags: ['BUTTON'] })) return;

      const activeView = this.currentViews[this.selectedIndex];
      if (activeView && typeof activeView.handleKeydown === 'function') {
        const handled = activeView.handleKeydown(e);
        if (handled) return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.currentViews.length) return;
        this.resultsList.classList.add('flx-kbd-nav');
        this.selectedIndex = e.key === 'ArrowDown' ? (this.selectedIndex + 1) % this.currentViews.length : (this.selectedIndex - 1 + this.currentViews.length) % this.currentViews.length;
        this.updateSelectionUI();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.selectedIndex >= 0 && this.currentViews[this.selectedIndex]) this.currentViews[this.selectedIndex].execute();
      }
    }

    renderList(views) {
      this.clearResults();
      this.currentViews = views;
      this.selectedIndex = views.length > 0 ? 0 : -1;
      views.forEach((view, index) => {
        const row = view.renderListRow();
        row.dataset.index = index;
        row.addEventListener('click', () => {
          this.selectedIndex = index;
          this.updateSelectionUI();
          view.execute();
        });
        this.resultsList.appendChild(row);
      });
      this.updateSelectionUI();
    }

    expandListItem(viewInstance, data) {
      const originalIndex = this.currentViews.indexOf(viewInstance);
      if (originalIndex === -1) return;

      if (originalIndex !== 0) {
        this.currentViews.splice(originalIndex, 1);
        this.currentViews.unshift(viewInstance);
        this.selectedIndex = 0;

        this.resultsList.innerHTML = safeHTML('');
        this.currentViews.forEach((view, i) => {
          const row = view.renderListRow();
          row.dataset.index = i;
          row.addEventListener('click', () => {
            this.selectedIndex = i;
            this.updateSelectionUI();
            view.execute();
          });
          this.resultsList.appendChild(row);
        });
      } else {
        Array.from(this.resultsList.children).forEach((child, i) => {
          if (i === 0) return;
          if (child.classList.contains('flx-omni-card')) {
            const viewToCollapse = this.currentViews[i];
            const collapsedRow = viewToCollapse.renderListRow();
            collapsedRow.dataset.index = i;
            collapsedRow.addEventListener('click', () => {
              this.selectedIndex = i;
              this.updateSelectionUI();
              viewToCollapse.execute();
            });
            this.resultsList.replaceChild(collapsedRow, child);
          }
        });
      }

      const existingRow = this.resultsList.children[0];
      if (!existingRow) return;

      const expandedCard = viewInstance.renderExpandedCard(data);
      expandedCard.dataset.index = 0;

      this.resultsList.replaceChild(expandedCard, existingRow);

      this.input.focus();
      this.updateSelectionUI();
    }

    updateSelectionUI() {
      Array.from(this.resultsList.children).forEach((node, i) => {
        if (node.classList.contains('flx-omni-row')) {
          if (i === this.selectedIndex) {
            node.dataset.selected = 'true';
            node.scrollIntoView({ block: 'nearest' });
          } else {
            delete node.dataset.selected;
          }
        }
      });
    }

    clearResults() {
      this.currentViews.forEach(v => v.destroy());
      this.currentViews = [];
      this.selectedIndex = -1;
      this.resultsList.innerHTML = safeHTML('');
    }

    onClickAway(e) { if (this.isVisible && !this.host.contains(e.target)) this.hide(); }

    calculateSafeCoords(targetX, targetY) {
      const width = 600;
      const height = this.host.offsetHeight || 100;

      const padding = 20;
      const maxX = window.innerWidth - width - padding;
      const maxY = window.innerHeight - height - padding;

      return { x: Math.max(padding, Math.min(targetX, maxX)), y: Math.max(padding, Math.min(targetY, maxY)) };
    }

    show(initialQuery = '', cursorCoords = null, context = null, preSelect = true) {
      this.applyTheme();

      document.body.appendChild(this.host);

      if (!initialQuery) {
        const remembered = FluxHubState.get(STATE_KEYS.LAST_QUERY, '');
        if (remembered) initialQuery = remembered;
      }

      this.isVisible = true;
      this.host.style.display = 'block';

      let finalX = 0, finalY = 0;

      if (cursorCoords) {
        finalX = cursorCoords.x;
        finalY = cursorCoords.y + 15;
      } else {
        const savedPos = FluxHubState.get(STATE_KEYS.SEARCH_POS, null);
        if (savedPos) {
          finalX = savedPos.x;
          finalY = savedPos.y;
        } else {
          const estimatedHeight = 150;
          finalX = window.innerWidth / 2 - 300;
          finalY = window.innerHeight / 2 - estimatedHeight;
        }
      }

      const safeCoords = this.calculateSafeCoords(finalX, finalY);
      this.host.style.left = `${safeCoords.x}px`;
      this.host.style.top = `${safeCoords.y}px`;

      this.activeContext = context;

      this.input.value = initialQuery;

      setTimeout(() => { 
        this.input.focus(); 
        if (preSelect && this.input.value.length > 0) {
          this.input.select();
        } else {
          this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        }
      }, 10);

      setTimeout(() => document.addEventListener('mousedown', this.onClickAway), 10);

      document.addEventListener('keydown', this.onGlobalKeydown, true);

      this.input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    hide() {
      this.isVisible = false;
      this.host.style.display = 'none';
      FluxHubState.set(STATE_KEYS.LAST_QUERY, this.input.value);
      this.clearResults();
      this.input.value = '';
      document.removeEventListener('mousedown', this.onClickAway);
      document.removeEventListener('keydown', this.onGlobalKeydown, true);
    }

    setInputVal(val = '') {
      this.input.value = val;
      this.input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * ============================================================================
   * CLASS: CommandRouter (The Nervous System)
   * Evaluates user input against registered views and manages background API fetches.
   * ============================================================================
   */
  class CommandRouter {
    constructor() {
      this.localActions = [];
      this.localViews = [];
      this.remoteCommands = new Map();
      this.remoteWidgets = new Map();
      this.currentAbortController = null;
    }

    registerAction(actionCmd) { this.localActions.push({ acceptsArgs: false, ...actionCmd }); }

    registerViews(ViewClassList) { ViewClassList.forEach((ViewClass) => this.localViews.push(ViewClass)); }

    initIPC() {
      FluxKit.ipc.listen('register-command', pluginCmd => {
        if (!pluginCmd.prefix || !pluginCmd.id) return;
        const newPrefix = pluginCmd.prefix.trim().toLowerCase();
        const conflict = Array.from(this.remoteCommands.values()).find(cmd => cmd.prefix.trim().toLowerCase() === newPrefix && cmd.id !== pluginCmd.id);
        if (conflict) {
          logWarning(`[Flux Search] Prefix Collision: Plugin '${pluginCmd.id}' attempted to register '${newPrefix}', but it is already owned by '${conflict.id}'. Registration rejected.`, { __v: 1 });
          return;
        }
        this.remoteCommands.set(pluginCmd.id, { acceptsArgs: false, type: 'action', ...pluginCmd });
      });
      FluxKit.ipc.listen('register-widget', widgetData => {
        if (!widgetData.id || !widgetData.pluginId) return;
        this.remoteWidgets.set(widgetData.id, widgetData);
      });
      FluxKit.ipc.listen('flxhub-hide', () => { if (FluxHub.ui) FluxHub.ui.hide(); });
      FluxKit.ipc.listen('flxhub-set-input', (payload) => {
        const host = document.getElementById('flx-hub-host');
        if (!host || !host.shadowRoot) return;

        if (payload && typeof payload.value === 'string') FluxHub.ui.setInputVal(payload.value);
      });
      this.refreshPlugins();
    }

    refreshPlugins() {
      this.remoteCommands.clear(); this.remoteWidgets.clear();
      FluxKit.ipc.broadcast('search-bar-ready');
    }

    evaluateCommandConfidence(cmd, rawQuery) {
      const q = rawQuery.trim().toLowerCase();
      const prefix = (cmd.prefix || '').trim().toLowerCase();
      const title = (cmd.title || '').trim().toLowerCase();
      if (!prefix) return 0;
      if (q === prefix) return 100;
      if (q.startsWith(prefix + ' ')) return cmd.acceptsArgs ? 99 : 50;
      if (prefix.startsWith(q) && q.length > 1) return 70;
      const cleanPrefix = prefix.replace(/^[>@!]/, '').trim();
      if (cleanPrefix && cleanPrefix.length > 1) {
        if (q === cleanPrefix) return 60;
        if (q.startsWith(cleanPrefix) || cleanPrefix.startsWith(q)) return 40;
      }
      if (title && title.includes(q) && q.length > 2) return 35;
      return 0;
    }

    async handleInput(rawQuery, context = null) {
      const query = rawQuery.trim();
      if (!query) {
        FluxHub.ui.clearResults();
        for (const cmd of this.remoteCommands.values()) { cmd._cachedHTML = null };
        return;
      }

      if (this.currentAbortController) this.currentAbortController.abort();
      this.currentAbortController = new AbortController();
      const signal = this.currentAbortController.signal;

      const activeIntents = [];

      for (const ViewClass of this.localViews) {
        if (!ViewClass.isAvailable) continue;

        const confidence = ViewClass.matchConfidence(query);
        if (confidence > 0) {
          const instance = new ViewClass(query, context);
          activeIntents.push({ instance, confidence });
        }
      }

      for (const cmd of this.remoteCommands.values()) {
        const confidence = this.evaluateCommandConfidence(cmd, query);
        if (confidence > 0) activeIntents.push({ instance: this.createRemoteViewWrapper(cmd, query), confidence });
      }

      for (const cmd of this.localActions) {
        const confidence = this.evaluateCommandConfidence(cmd, query);
        if (confidence > 0) activeIntents.push({ instance: this.createRemoteViewWrapper(cmd, query), confidence });
      }

      activeIntents.sort((a, b) => b.confidence - a.confidence);

      let filteredIntents = activeIntents;
      if (activeIntents.length > 0 && activeIntents[0].confidence >= 98) {
        const topScore = activeIntents[0].confidence;
        filteredIntents = activeIntents.filter(intent => intent.confidence === topScore);
      }
      if (activeIntents.length > 0 && activeIntents[0].confidence === 100) filteredIntents = activeIntents.filter(intent => intent.confidence === 100);

      const sortedViews = filteredIntents.map(intent => intent.instance);

      FluxHub.ui.renderList(sortedViews);

      for (const view of sortedViews) {
        const intent = filteredIntents.find(i => i.instance === view);
        if (intent && intent.confidence >= 70) {
          const index = FluxHub.ui.currentViews.indexOf(view);
          const row = FluxHub.ui.resultsList.children[index];
          let ogSubtitle = '', ogIcon = '';
          if (row && row.classList.contains('flx-omni-row')) {
            const subtitle = row.querySelector('.flx-omni-subtitle');
            const iconNode = row.querySelector('.flx-omni-icon');
            if (subtitle) {
              ogSubtitle = subtitle.textContent;
              subtitle.textContent = 'Fetching...';
              subtitle.style.color = 'var(--omni-accent)';
            }
            if (iconNode) {
              ogIcon = iconNode.innerHTML;
              iconNode.innerHTML = safeHTML(FluxKit.ui.getIcon('hourglassSpin'));
            }
          }
          try {
            const data = await view.fetchData(signal);
            if (data !== null && !signal.aborted) {
              FluxHub.ui.expandListItem(view, data);
              break;
            } else if (row && !signal.aborted) {
              const subtitle = row.querySelector('.flx-omni-subtitle');
              const iconNode = row.querySelector('.flx-omni-icon');
              if (subtitle) { subtitle.textContent = ogSubtitle; subtitle.style.color = 'var(--omni-muted)'; }
              if (iconNode) iconNode.innerHTML = safeHTML(ogIcon);
            }
          } catch (error) {
            if (error.name !== 'AbortError' && (!signal || !signal.aborted)) {
              logError('[Flux Search] Background fetch failed:', error);
              const subtitle = row?.querySelector('.flx-omni-subtitle');
              const iconNode = row?.querySelector('.flx-omni-icon');
              if (subtitle) { subtitle.textContent = ogSubtitle; subtitle.style.color = 'var(--omni-muted)'; }
              if (iconNode) iconNode.innerHTML = safeHTML(ogIcon);
            }
          }
        } else { break; }
      }
    }

    createRemoteViewWrapper(cmd, rawQuery) {
      if (cmd.type === 'action') {
        return {
          destroy: () => {},
          fetchData: async () => null,
          renderListRow: () => FluxKit.ui.omni.ListRow(cmd.title, cmd.icon || 'code', `Command: ${cmd.prefix}`, 'to run'),
          renderExpandedCard: () => null,
          execute: () => {
            const queryParams = rawQuery.replace(new RegExp(`^${cmd.prefix}\\s*`, 'i'), '').trim();
            if (cmd.execute) cmd.execute(queryParams);
            else FluxKit.ipc.broadcast('execute-command', { id: cmd.id, payload: queryParams }, true);
            if (cmd.keepOpen !== true) FluxHub.ui.hide();
          },
        };
      }

      const slotId = `flx-slot-${cmd.id}`;
      const queryParams = rawQuery.replace(new RegExp(`^${cmd.prefix}\\s*`, 'i'), '').trim();

      return {
        destroy: () => {
          const existingSlot = FluxHub.ui.shadow ? FluxHub.ui.shadow.getElementById(slotId) : null;
          if (existingSlot) {
            cmd._cachedHTML = existingSlot.innerHTML;
          }
          FluxKit.ipc.broadcast('flxhub-unmount-view', { pluginId: cmd.id, targetId: slotId }, true);
        },

        fetchData: async () => ({ slotId, queryParams }),

        renderListRow: () => FluxKit.ui.omni.ListRow(cmd.title, cmd.icon || 'document', `Search Plugin: ${cmd.prefix}`, 'to view'),

        renderExpandedCard: (data) => {
          const slotContainer = createHTMLElement('div', {
            id: data.slotId,
            style: { width: '100%' }
          });

          if (cmd._cachedHTML) {
            slotContainer.innerHTML = safeHTML(cmd._cachedHTML);
          } else {
            const loadingContent = createHTMLElement('div', {
               style: { textAlign: 'center', color: 'var(--omni-muted)', fontSize: '13px', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', minHeight: '60px' },
               icon: 'hourglassSpin', textContent: `Loading ${cmd.title}...`
            });
            slotContainer.appendChild(FluxKit.ui.omni.DetailCard(loadingContent, []));
          }

          setTimeout(() => {
            FluxKit.ipc.broadcast('flxhub-mount-view', { pluginId: cmd.id, query: data.queryParams, targetId: data.slotId, themeKey: SettingsState.getAll().theme });
          }, 20);

          return slotContainer;
        },

        handleKeydown: (e) => {
          const existingSlot = FluxHub.ui.shadow ? FluxHub.ui.shadow.getElementById(slotId) : null;
          if (!existingSlot) return false;

          const remoteEvent = new CustomEvent('flx-remote-keydown', {
            detail: { key: e.key, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey },
            cancelable: true
          });

          existingSlot.dispatchEvent(remoteEvent);

          if (remoteEvent.defaultPrevented) {
            e.preventDefault(); e.stopPropagation();
            return true;
          }

          return false;
        },

        execute: () => {
          FluxKit.ipc.broadcast('flxhub-execute-view', { pluginId: cmd.id, targetId: slotId }, true);
          FluxHub.ui.hide();
        },
      };
    }
  }

  class WidgetEngine {
    constructor(router) { this.router = router; this.activeWidgets = []; }

    async renderDashboard(container) {
      container.innerHTML = safeHTML('');
      this.destroy();

      let widgetsAdded = 0;

      for (const ViewClass of this.router.localViews) {
        if (typeof ViewClass.getWidgetState === 'function' && !['WeatherView', 'StockView', 'RSSView'].includes(ViewClass.name)) {
          const state = await ViewClass.getWidgetState();
          if (state) {
            const stateArray = Array.isArray(state) ? state : [state];
            for (const s of stateArray) {
              const instance = new ViewClass('');
              this.activeWidgets.push(instance);
              const widgetEl = await instance.renderWidget(s);
              if (widgetEl) { container.appendChild(widgetEl); widgetsAdded++; }
            }
          }
        }
      }

      const persistentWidgets = FluxHubState.get(STATE_KEYS.PINNED_WIDGETS, []);

      const grouped = { clock: [], weather: [], stock: [], rss: [] };
      persistentWidgets.forEach(w => { if (grouped[w.type]) grouped[w.type].push(w.params); });

      if (grouped.clock.length > 0) {
        const instance = new TimeManagerHubView('');
        this.activeWidgets.push(instance);
        const el = await instance.renderWidget(grouped.clock);
        if (el) { container.appendChild(el); widgetsAdded++; }
      }

      for (const params of grouped.weather) {
        const instance = new WeatherView('');
        this.activeWidgets.push(instance);
        const el = await instance.renderWidget(params);
        if (el) { container.appendChild(el); widgetsAdded++; }
      }

      if (grouped.stock.length > 0) {
        const instance = new StockView('');
        this.activeWidgets.push(instance);
        const el = await instance.renderWidget(grouped.stock);
        if (el) { container.appendChild(el); widgetsAdded++; }
      }

      for (const params of grouped.rss) {
        const instance = new RSSView('');
        this.activeWidgets.push(instance);
        const el = await instance.renderWidget(params);
        if (el) {
          el.style.gridColumn = '1 / -1';
          container.appendChild(el);
          widgetsAdded++;
        }
      }

      if (this.router.remoteWidgets && this.router.remoteWidgets.size > 0) {
        for (const widget of this.router.remoteWidgets.values()) {
          const slotId = `flx-widget-${widget.id}`;

          const slotContainer = createHTMLElement('div', { id: slotId, style: { display: 'flex', flexDirection: 'column' } });
          if (widget.gridColumn) slotContainer.style.gridColumn = widget.gridColumn;

          const loadingContent = createHTMLElement('div', {
            class: 'flx-omni-widget', icon: 'hourglassSpin', textContent: `Loading ${widget.title || 'Widget'}...`,
            style: { textAlign: 'center', color: 'var(--omni-muted)', fontSize: '13px', alignItems: 'center', gap: '8px', padding: '16px' },
          });

          slotContainer.appendChild(loadingContent);
          container.appendChild(slotContainer);
          widgetsAdded++;

          setTimeout(() => {
            FluxKit.ipc.broadcast('flxhub-mount-widget', { pluginId: widget.pluginId, widgetId: widget.id, targetId: slotId });
          }, 20);
        }
      }

      if (widgetsAdded === 0) {
        container.style.display = 'none';
        container.style.padding = '0';
      } else {
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
        container.style.gridAutoFlow = 'dense';
        container.style.gap = '12px';
        container.style.padding = '8px';
      }
    }

    destroy() { this.activeWidgets.forEach(w => { if (typeof w.destroy === 'function') w.destroy(); }); this.activeWidgets = []; }
  }

  class HelpView extends BaseView {
    static isAvailable = true;
    static commandRegistry = [{ prefix: '> help', description: 'Show all available commands and plugins', icon: 'info' }];

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (q === '> help' || q === '?' || q === 'help') return 100;
      if ('> help'.startsWith(q)) return 60;
      return 0;
    }

    async fetchData() {
      const native = [];
      const plugins = [];

      FluxHub.engine.localViews.forEach(ViewClass => {
        if (ViewClass.isAvailable && ViewClass.commandRegistry) native.push(...ViewClass.commandRegistry);
      });

      FluxHub.engine.remoteCommands.forEach(cmd => {
        plugins.push({ prefix: cmd.prefix, description: cmd.title || `Plugin: ${cmd.id}`, icon: cmd.icon || 'code', isRemote: true });
      });

      const sortFn = (a, b) => a.prefix.localeCompare(b.prefix);
      
      // Return structured data instead of a flat array
      return {
        native: native.sort(sortFn),
        plugins: plugins.sort(sortFn)
      };
    }

    renderListRow() { 
      return FluxKit.ui.omni.ListRow('Command Directory', 'info', 'Explore available actions', 'to view'); 
    }

    renderExpandedCard({ native, plugins }) {
      const container = createHTMLElement('div', { 
        style: { display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '350px', overflowY: 'auto', padding: '12px' } 
      });

      const buildSection = (title, commands) => {
        if (!commands || commands.length === 0) return null;

        const section = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
        const heading = createHTMLElement('div', { 
          textContent: title, 
          style: { fontSize: '11px', fontWeight: '700', color: 'var(--omni-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', paddingLeft: '4px' } 
        });
        
        const grid = createHTMLElement('div', { 
          style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' } 
        });

        commands.forEach(cmd => {
          const row = createHTMLElement('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
              background: 'var(--omni-input-bg)', border: '1px solid var(--omni-border)',
              borderRadius: '6px', cursor: 'pointer', transition: 'background 0.15s ease',
              overflow: 'hidden' // Trap floating children
            },
            eventListener: {
              mouseenter: e => { e.currentTarget.style.background = 'var(--omni-hover)' },
              mouseleave: e => { e.currentTarget.style.background = 'var(--omni-input-bg)' },
              click: (e) => { e.stopPropagation(); FluxHub.ui.setInputVal(`${cmd.prefix} `); }
            }
          });

          const iconWrap = createHTMLElement('div', { 
            icon: cmd.icon, 
            style: { color: cmd.isRemote ? 'var(--omni-success)' : 'var(--omni-accent)', fontSize: '16px', display: 'flex', justifyContent: 'center', minWidth: '20px' }
          });

          // minWidth: '0' is structurally critical here to prevent flex children from blowing out CSS grid cells
          const textWrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', minWidth: '0' } });
          
          const titleRow = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'space-between' } });
          titleRow.appendChild(createHTMLElement('div', { 
            textContent: cmd.prefix, 
            style: { fontWeight: '600', fontSize: '13px', fontFamily: 'monospace', color: 'var(--omni-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } 
          }));
          
          if (cmd.isRemote) {
            titleRow.appendChild(createHTMLElement('div', { 
              textContent: 'PLUGIN', 
              style: { fontSize: '9px', fontWeight: 'bold', background: 'var(--omni-hover)', color: 'var(--omni-accent-text)', padding: '2px 4px', borderRadius: '4px', flexShrink: '0' }
            }));
          }
          
          textWrap.appendChild(titleRow);
          textWrap.appendChild(createHTMLElement('div', { 
            textContent: cmd.description, 
            style: { fontSize: '11px', color: 'var(--omni-muted)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } 
          }));

          row.appendChild(iconWrap);
          row.appendChild(textWrap);
          grid.appendChild(row);
        });

        section.appendChild(heading);
        section.appendChild(grid);
        return section;
      };

      const nativeSection = buildSection('Native Commands', native);
      if (nativeSection) container.appendChild(nativeSection);

      const pluginSection = buildSection('Plugins', plugins);
      if (pluginSection) container.appendChild(pluginSection);

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    async execute() { 
      const data = await this.fetchData(); 
      FluxHub.ui.expandListItem(this, data); 
    }
  }

  class WidgetManagerView extends BaseView {
    static isAvailable = true;
    static commandRegistry = [{ prefix: '> widget', description: 'Manage and pin dashboard widgets', icon: 'settings' }];

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (['> widget', '> widgets', '> wgt'].includes(q) || q.startsWith('> widget ') || q.startsWith('> wgt ')) return 100;
      if ('> widget'.startsWith(q)) return 60;
      return 0;
    }

    getPinnedWidgets() { return FluxHubState.get(STATE_KEYS.PINNED_WIDGETS, []); }

    savePinnedWidgets(widgets) { FluxHubState.set(STATE_KEYS.PINNED_WIDGETS, widgets); }

    getTombstones() { return FluxHubState.get(STATE_KEYS.PINNED_WIDGET_TOMBSTONES, {}); }

    setTombstones(tombs) { FluxHubState.set(STATE_KEYS.PINNED_WIDGET_TOMBSTONES, tombs); }

    removeWidget(id) {
      const widgets = this.getPinnedWidgets();
      const updated = widgets.filter(w => w.id !== id);
      this.savePinnedWidgets(updated);

      const tombs = this.getTombstones();
      tombs[id] = Date.now();
      this.setTombstones(tombs);
    }

    async fetchData() {
      const rawQ = this.query.trim().replace(/^>\s*(widget|widgets|wgt)\s*/i, '').trim();
      const widgets = this.getPinnedWidgets();

      if (!rawQ) return { action: 'list', widgets };

      const parts = rawQ.split(/\s+/);
      const command = parts[0].toLowerCase();

      if (command === 'add' && parts.length >= 3) {
        const type = parts[1].toLowerCase();
        const value = parts.slice(2).join(' ');

        if (['weather', 'stock', 'rss', 'clock'].includes(type)) return { action: 'confirm_add', type, value };
      }

      if ((command === 'rm' || command === 'remove') && parts[1]) {
        const idOrIndex = parts[1];
        return { action: 'confirm_remove', target: idOrIndex, widgets };
      }

      return { action: 'list', widgets, error: 'Unknown widget command. Try "> widget add weather London"' };
    }

    renderListRow() { return FluxKit.ui.omni.ListRow('Widget Command Center', 'settings', 'Manage Dashboard Cards'); }

    renderExpandedCard(data) {
      const modernFont = 'var(--omni-font)';

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', fontFamily: modernFont } });

      const applyFocusRing = (el) => {
        el.setAttribute('tabindex', '0');
        el.addEventListener('focus', () => { el.style.boxShadow = '0 0 0 2px var(--omni-muted)' });
        el.addEventListener('blur', () => { el.style.boxShadow = 'none' });
        return el;
      };

      const header = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
      header.appendChild(createHTMLElement('div', { style: { fontSize: '18px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: 'Dashboard Widgets' }));
      header.appendChild(createHTMLElement('div', { style: { fontSize: '12px', color: 'var(--omni-muted)' }, textContent: 'Use "> widget add <weather|stock|rss|clock> <value>" to add cards.' }));
      container.appendChild(header);

      const listContainer = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '160px', overflowY: 'auto' } });

      if (!data.widgets || data.widgets.length === 0) {
        listContainer.appendChild(createHTMLElement('div', { textContent: 'No persistent widgets pinned to dashboard.', style: { padding: '16px', textAlign: 'center', color: 'var(--omni-muted)', fontSize: '13px' } }));
      } else {
        data.widgets.forEach((item, index) => {
          const row = createHTMLElement('div', {
            style: {
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', borderRadius: '6px', background: 'var(--omni-hover)',
              border: '1px solid var(--omni-border)'
            }
          });

          const labelWrap = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
          const icon = item.type === 'weather' ? '☁️' : item.type === 'stock' ? '📈' : '📰';
          labelWrap.appendChild(createHTMLElement('span', { textContent: icon }));
          labelWrap.appendChild(createHTMLElement('span', { textContent: item.label, style: { fontWeight: '600', fontSize: '14px' } }));
          row.appendChild(labelWrap);

          const delBtn = applyFocusRing(createHTMLElement('button', {
            icon: 'close', textContent: 'Remove',
            style: {
              background: 'transparent', border: '1px solid var(--omni-border)',
              color: 'var(--omni-danger)', borderRadius: '4px', padding: '4px 8px',
              fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', gap: '4px'
            },
            eventListener: {
              click: (e) => {
                e.stopPropagation();
                this.removeWidget(item.id);
                if (FluxKit.sync?.auto) AutoSync.notifyLocalChange();
                this.execute();
              }
            }
          }));
          row.appendChild(delBtn);
          listContainer.appendChild(row);
        });
      }
      container.appendChild(listContainer);

      const chipContainer = createHTMLElement('div', { style: { display: 'flex', gap: '8px', borderTop: '1px solid var(--omni-separator)', paddingTop: '12px' } });

      const quickChips = [
        { label: '+ Weather (Mumbai)', cmd: '> widget add weather Mumbai' },
        { label: '+ Stock (AAPL)', cmd: '> widget add stock AAPL' },
        { label: '+ RSS (HackerNews)', cmd: '> widget add rss https://news.ycombinator.com/rss' },
        { label: '+ Clock (Mumbai)', cmd: '> widget add clock Mumbai' }
      ];

      quickChips.forEach(chip => {
        const chipEl = applyFocusRing(createHTMLElement('div', {
          textContent: chip.label,
          style: {
            padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '500',
            background: 'var(--omni-hover)', color: 'var(--omni-accent-text)', cursor: 'pointer',
            border: '1px solid var(--omni-border)'
          },
          eventListener: (e) => { e.stopPropagation(); FluxHub.ui.setInputVal(chip.cmd); }
        }));
        chipContainer.appendChild(chipEl);
      });
      container.appendChild(chipContainer);

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    async execute() {
      const rawQ = this.query.trim().replace(/^>\s*(widget|widgets|wgt)\s*/i, '').trim();
      const parts = rawQ.split(/\s+/);
      const command = parts[0] ? parts[0].toLowerCase() : '';

      if (command === 'add' && parts.length >= 3) {
        const type = parts[1].toLowerCase();
        const value = parts.slice(2).join(' ');
        const widgets = this.getPinnedWidgets();

        let newWidget = null;
        if (type === 'weather') {
          newWidget = { id: `w_weather_${Date.now()}`, type: 'weather', label: `Weather: ${value}`, params: { city: value } };
        } else if (type === 'stock') {
          newWidget = { id: `w_stock_${Date.now()}`, type: 'stock', label: `Stock: ${value.toUpperCase()}`, params: { symbol: value.toUpperCase() } };
        } else if (type === 'rss') {
          newWidget = { id: `w_rss_${Date.now()}`, type: 'rss', label: `RSS: ${value}`, params: { url: value } };
        } else if (type === 'clock') {
          newWidget = { id: `w_clock_${Date.now()}`, type: 'clock', label: `Clock: ${value}`, params: { tool: 'clock', payload: { city: value } } };
        }

        if (newWidget) {
          newWidget.updatedAt = Date.now();
          widgets.push(newWidget);
          this.savePinnedWidgets(widgets);
          if (FluxKit.sync?.auto) AutoSync.notifyLocalChange();
          FluxHub.ui.setInputVal('> widget');
          return;
        }
      }

      const data = await this.fetchData();
      FluxHub.ui.expandListItem(this, data);
    }
  }

  class CalculatorView extends BaseView {
    static isAvailable = true;
    static commandRegistry = [{ prefix: '=', description: 'Evaluate mathematical expressions natively', icon: 'calculator' }];

    static matchConfidence(query) {
      const clean = query.trim();
      if (!clean) return 0;

      const isExplicit = clean.startsWith('=');
      const expr = isExplicit ? clean.slice(1).trim() : clean;

      const hasMathChars = /^[%\d\s\+\-\*\/\(\)\.\^\,a-zA-Z]+$/.test(expr) && /\d/.test(expr);
      if (!hasMathChars) return 0;

      let isValid = false;
      try {
        if (typeof math !== 'undefined') {
          const res = math.evaluate(expr);
          isValid = typeof res === 'number' || (res && res.isComplex) || (res && res.isBigNumber);
        } else {
          const safeExpr = expr.replace(/[^0-9\+\-\*\/\(\)\.\%]/g, '');
          const res = new Function(`return (${safeExpr})`)();
          isValid = typeof res === 'number' && !isNaN(res) && isFinite(res);
        }
      } catch (e) { isValid = false; }

      if (isExplicit) return isValid ? 100 : 60;
      return isValid && /[\+\-\*\/\%\^]/.test(expr) ? 80 : 0;
    }

    async fetchData(signal) {
      let expr = this.query.replace('=', '').trim();
      if (!expr) return null;
      try {
        let resultVal, formattedResult;

        if (typeof math !== 'undefined') {
          resultVal = math.evaluate(expr);
          formattedResult = math.format(resultVal, { precision: 10 });
        } else {
          expr = expr.replace(/[^0-9\+\-\*\/\(\)\.\%]/g, '');
          const res = new Function(`return (${expr})`)();
          if (typeof res !== 'number' || isNaN(res) || !isFinite(res)) return null;
          formattedResult = String(Math.round(res * 10000) / 10000);
        }

        this.lastResult = formattedResult;
        return { expr, result: formattedResult };
      } catch (e) { return null; }
    }

    renderListRow() { return FluxKit.ui.omni.ListRow(this.lastResult !== undefined ? `= ${this.lastResult}` : 'Calculate Expression', 'calculator', this.query, 'to Copy'); }

    renderExpandedCard(data) {
      const exprNode = createHTMLElement('div', { textContent: data.expr, style: { textAlign: 'center', color: 'var(--omni-muted)', fontSize: '16px', marginBottom: '8px', fontFamily: 'monospace' } });

      const resultNode = createHTMLElement('div', { textContent: data.result, style: { fontSize: '48px', fontWeight: 'bold', textAlign: 'center', padding: '10px 0', fontFamily: 'monospace', color: 'var(--omni-text)', overflowX: 'auto', whiteSpace: 'nowrap' } });

      const copyBtn = FluxKit.ui.omni.Button('copy', 'Copy to Clipboard', (e) => { e.stopPropagation(); this.execute(); });

      copyBtn.setAttribute('tabindex', '0');
      copyBtn.addEventListener('focus', () => { copyBtn.style.boxShadow = '0 0 0 2px var(--omni-muted)' });
      copyBtn.addEventListener('blur', () => { copyBtn.style.boxShadow = 'none' });

      return FluxKit.ui.omni.DetailCard(createHTMLElement('div', { children: [exprNode, resultNode] }), [copyBtn]);
    }

    handleKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        this.execute();
        return true;
      }
      return false;
    }

    execute() { if (this.lastResult !== undefined) { navigator.clipboard.writeText(this.lastResult.toString()); FluxHub.ui.hide(); } }
  }

  class ColorView extends BaseView {
    static isAvailable = true;
    static commandRegistry = [{ prefix: '> color', description: 'Inspect HEX/RGB/HSL, pick colors, check contrast', icon: 'palette' }];

    constructor(query) {
      super(query); this.rawQuery = query.trim();
      const extracted = this.rawQuery.replace(/^>\s*color\s*/i, '').trim();
      this.colorInput = extracted || 'var(--omni-accent)';
    }

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();

      if (q === '> color') return 100;
      if (q.startsWith('> color ')) return 100;

      if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(q)) return 95;
      if (/^(rgb|hsl)a?\(/i.test(q)) return 95;

      return 0;
    }

    async fetchData() {
      try {
        const parsedColor = FluxKit.theme.parseColor(this.colorInput, FluxHub.ui.getRoot());
        if (!parsedColor) return null;
        return { parsedColor };
      } catch (e) { return null; }
    }

    renderListRow() {
      const colorName = FluxKit.theme.getColorName(this.colorInput) || 'Custom Color';
      return FluxKit.ui.omni.ListRow('Color Inspector', 'palette', `${colorName} (${this.colorInput})`, 'to copy HEX');
    }

    renderExpandedCard(data) {
      let currentParsedColor = data.parsedColor;

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px' } });

      const swatch = createHTMLElement('div', {
        style: {
          width: '100%', height: '80px', borderRadius: '8px', position: 'relative', overflow: 'hidden',
          border: '1px solid var(--omni-border)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }
      });

      const colorPicker = createHTMLElement('input', {
        type: 'color', style: { position: 'absolute', width: '200%', height: '200%', opacity: 0, cursor: 'pointer' },
        eventListener: { input: (e) => updateUI(e.target.value) }
      });
      swatch.appendChild(colorPicker);

      const swatchHint = createHTMLElement('span', { style: { color: 'rgba(255,255,255,0.7)', fontSize: '12px', fontWeight: 'bold', pointerEvents: 'none', mixBlendMode: 'difference' } });
      swatch.appendChild(swatchHint);
      container.appendChild(swatch);

      const alphaControl = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--omni-muted)' } });
      const slider = createHTMLElement('input', {
        type: 'range', min: '0', max: '100',
        style: { flex: '1', cursor: 'pointer', accentColor: 'var(--omni-accent)' },
        eventListener: {
          input: (e) => {
            currentParsedColor.a = e.target.value / 100;
            updateUI(currentParsedColor, true);
          }
        }
      });
      alphaControl.appendChild(createHTMLElement('span', { textContent: 'Opacity', style: { width: '50px' } }));
      alphaControl.appendChild(slider);
      container.appendChild(alphaControl);

      const formatsContainer = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
      const hexRow = createHTMLElement('div', { innerHTML: `<span>HEX</span> <span style="cursor:pointer; color:var(--omni-accent);"></span>` });
      const rgbRow = createHTMLElement('div', { innerHTML: `<span>RGB</span> <span style="cursor:pointer; color:var(--omni-accent);"></span>` });
      const hslRow = createHTMLElement('div', { innerHTML: `<span>HSL</span> <span style="cursor:pointer; color:var(--omni-accent);"></span>` });
      [hexRow, rgbRow, hslRow].forEach(row => {
        row.style.display = 'flex'; row.style.justifyContent = 'space-between';
        row.style.fontSize = '12px'; row.style.fontWeight = '500';
        formatsContainer.appendChild(row);
      });
      container.appendChild(formatsContainer);

      const paletteContainer = createHTMLElement('div', { style: { display: 'flex', gap: '4px', height: '30px', marginTop: '4px' } });
      const paletteSwatches = Array(5).fill(0).map(() => createHTMLElement('div', { style: { flex: 1, borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--omni-border)' } }));
      paletteSwatches.forEach(ps => paletteContainer.appendChild(ps));
      container.appendChild(paletteContainer);

      const contrastFooter = createHTMLElement('div', { style: { fontSize: '12px', color: 'var(--omni-muted)', borderTop: '1px solid var(--omni-border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' } });
      const whiteContrast = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between' } });
      const darkContrast = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between' } });
      contrastFooter.appendChild(whiteContrast);
      contrastFooter.appendChild(darkContrast);
      container.appendChild(contrastFooter);

      const updateUI = (colorInput, isAlphaChange = false) => {
        const c = typeof colorInput === 'string' ? FluxKit.theme.parseColor(colorInput, FluxHub.ui.getRoot()) : colorInput;
        if (!c) return;
        currentParsedColor = c;

        const isAlpha = c.a < 1;
        const rgbStr = isAlpha ? `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})` : `rgb(${c.r}, ${c.g}, ${c.b})`;
        const hexStr = `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}${isAlpha ? Math.round(c.a * 255).toString(16).padStart(2, '0') : ''}`;
        const hslStr = FluxKit.theme.toHsl(c);

        swatch.style.backgroundColor = rgbStr;
        if (!isAlphaChange) {
          colorPicker.value = hexStr.substring(0, 7);
          slider.value = c.a * 100;
        }

        hexRow.lastElementChild.textContent = hexStr;
        rgbRow.lastElementChild.textContent = rgbStr;
        hslRow.lastElementChild.textContent = hslStr;

        const palettes = FluxKit.theme.getPalette(c);
        const paletteValues = [palettes.complementary, palettes.analogous1, palettes.analogous2, palettes.triadic1, palettes.triadic2];
        paletteSwatches.forEach((ps, idx) => {
          ps.style.backgroundColor = paletteValues[idx];
          ps.dataset.fluxHubTooltip = paletteValues[idx];
          ps.onclick = () => navigator.clipboard.writeText(paletteValues[idx]);
        });

        const cW = FluxKit.theme.getContrastRatio(c, '#ffffff', FluxHub.ui.getRoot());
        const cD = FluxKit.theme.getContrastRatio(c, '#121212', FluxHub.ui.getRoot());
        const pW = cW >= 4.5;
        const pD = cD >= 4.5;

        whiteContrast.innerHTML = safeHTML(`<span>Contrast on White:</span> <strong style="color: var(--omni-${pW ? 'success' : 'danger'})">${cW.toFixed(2)} ${pW ? '✅ AA' : '❌ Fail'}</strong>`);
        darkContrast.innerHTML = safeHTML(`<span>Contrast on Dark:</span> <strong style="color: var(--omni-${pD ? 'success' : 'danger'})">${cD.toFixed(2)} ${pD ? '✅ AA' : '❌ Fail'}</strong>`);
      };

      updateUI(currentParsedColor);

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    execute() {
      const parsedColor = FluxKit.theme.parseColor(this.colorInput, FluxHub.ui.getRoot());
      if (parsedColor) {
        const rHex = parsedColor.r.toString(16).padStart(2, '0');
        const gHex = parsedColor.g.toString(16).padStart(2, '0');
        const bHex = parsedColor.b.toString(16).padStart(2, '0');
        navigator.clipboard.writeText(`#${rHex}${gHex}${bHex}`);
        if (FluxHub.ui) FluxHub.ui.hide();
      }
    }
  }

  /**
   * ============================================================================
   * VIEW: Generative Hub (Tier 2)
   * Consolidates all random generation and static payload creation tools.
   * ============================================================================
   */
  class GenerativeHubView extends BaseView {
    constructor(query) {
      super(query);
      this.rawQuery = query.trim();
      this.query = this.rawQuery.toLowerCase();
    }

    static isAvailable = true;

    static commandRegistry = [
      { prefix: '> pass', description: 'Generate a secure, randomized password', icon: 'lock' },
      { prefix: '> name', description: 'Generate character names (fantasy, sci-fi)', icon: 'user' },
      { prefix: '> qr', description: 'Generate QR code for URLs or text', icon: 'link' },
      { prefix: '> uuid', description: 'Generate a universally unique identifier', icon: 'code' }
    ];

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (['> pass', '> name', '> qr', '> uuid', '> share'].includes(q)) return 100;
      if (q.startsWith('> pass ') || q.startsWith('> name ') || q.startsWith('> qr ') || q.startsWith('> share ')) return 100;
      if (/^>\s*icons?\b/i.test(q)) return 100;
      return 0;
    }

    async fetchData() {
      let tool = 'unknown';
      let payload = '';

      if (this.query.startsWith('> pass')) {
        tool = 'password';
        const extracted = this.rawQuery.replace(/^>\s*pass\s*/i, '').trim();
        let initialLength = parseInt(extracted, 10) || 16;
        if (initialLength < 4) initialLength = 4;
        if (initialLength > 128) initialLength = 128;
        payload = initialLength;
      }
      else if (this.query.startsWith('> name')) {
        tool = 'name';
        payload = this.rawQuery.replace(/^>\s*name\s*/i, '').trim().toLowerCase() || 'fantasy';
      }
      else if (this.query.startsWith('> uuid')) {
        tool = 'uuid';
      }
      else if (this.query.startsWith('> qr') || this.query.startsWith('> share')) {
        tool = 'qr';
        const extracted = this.rawQuery.replace(/^>\s*(qr|share)\s*/i, '').trim();
        payload = extracted || window.location.href;
        this.result = payload;
      }
      else if (/^>\s*icons?\b/i.test(this.query)) {
        tool = 'icon';
        const searchMode = /^>\s*icons?\s+(.+)$/.exec(this.query);
        const term = searchMode ? searchMode[1].trim() : null;
        const terms = term ? term.split(/\s*,\s*/) : [];
        let results = [];

        const allKeys = Object.keys(FluxKit.ui.icons);

        if (terms.length > 0) {
          const seen = new Set();
          results = [];
          for (const key of allKeys) {
            const lowerKey = key.toLowerCase();
            if (terms.some(t => lowerKey.includes(t)) && !seen.has(key)) {
              seen.add(key);
              results.push({ name: key, svg: FluxKit.ui.icons[key] });
            }
          }
        } else {
          results = allKeys.map(k => ({ name: k, svg: FluxKit.ui.icons[k] }));
        }

        results.sort((a, b) => a.name.localeCompare(b.name));
        payload = { results, term };
      }

      this.tool = tool;
      return { tool, payload };
    }

    renderListRow() { return FluxKit.ui.omni.ListRow('Generative Tools', 'zap', 'Execute generation utility', 'to open'); }

    renderExpandedCard(data) {
      switch(data.tool) {
        case 'password': return this.renderPasswordTool(data);
        case 'name': return this.renderNameTool(data);
        case 'qr': return this.renderQRTool(data);
        case 'uuid': return this.renderUUIDTool();
        case 'icon': return this.renderIconView(data.payload);
        default: return createHTMLElement('div', { textContent: 'Unknown generation tool.' });
      }
    }

    renderPasswordTool(data) {
      const state = { length: data.payload, upper: true, lower: true, numbers: true, symbols: true, currentPassword: '' };

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '12px' } });

      const displayWrapper = createHTMLElement('div', {
        style: {
          padding: '16px', background: 'var(--omni-input-bg)', border: '1px solid var(--omni-border)',
          borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          cursor: 'pointer', transition: 'background 0.2s ease'
        },
        eventListener: {
          click: () => {
            navigator.clipboard.writeText(state.currentPassword);
            const original = passText.textContent;
            passText.textContent = 'Copied!';
            passText.style.color = 'var(--omni-success)';
            setTimeout(() => {
              passText.textContent = original;
              passText.style.color = 'var(--omni-text)';
            }, 1000);
          },
          mouseenter: (e) => { e.currentTarget.style.background = 'var(--omni-hover)' },
          mouseleave: (e) => { e.currentTarget.style.background = 'var(--omni-input-bg)' }
        }
      });

      const passText = createHTMLElement('span', { style: { fontSize: '20px', fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--omni-text)', wordBreak: 'break-all' } });

      const copyIcon = createHTMLElement('span', { icon: 'copy', style: { color: 'var(--omni-muted)', fontSize: '18px' } });

      displayWrapper.appendChild(passText);
      displayWrapper.appendChild(copyIcon);
      container.appendChild(displayWrapper);

      const meterWrapper = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
      const meterLabel = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '600' } });

      const strengthText = createHTMLElement('span', {});
      const entropyText = createHTMLElement('span', { style: { color: 'var(--omni-muted)' } });

      meterLabel.appendChild(strengthText);
      meterLabel.appendChild(entropyText);

      const barContainer = createHTMLElement('div', { style: { height: '6px', background: 'var(--omni-border)', borderRadius: '3px', overflow: 'hidden' } });
      const barFill = createHTMLElement('div', { style: { height: '100%', transition: 'width 0.3s ease, background 0.3s ease' } });

      barContainer.appendChild(barFill);
      meterWrapper.appendChild(meterLabel);
      meterWrapper.appendChild(barContainer);
      container.appendChild(meterWrapper);

      const controls = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

      const sliderRow = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', color: 'var(--omni-text)' } });
      const lengthLabel = createHTMLElement('span', { style: { minWidth: '75px', fontWeight: '500' } });
      const slider = createHTMLElement('input', {
        type: 'range', min: '4', max: '64', value: state.length,
        style: { flex: '1', accentColor: 'var(--omni-accent)', cursor: 'pointer' },
        eventListener: { input: (e) => { state.length = parseInt(e.target.value, 10); updateUI(); } }
      });

      sliderRow.appendChild(lengthLabel);
      sliderRow.appendChild(slider);
      controls.appendChild(sliderRow);

      const togglesGrid = createHTMLElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } });

      const createToggle = (label, key) => {
        const lbl = createHTMLElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--omni-muted)', cursor: 'pointer', userSelect: 'none' } });
        const cb = createHTMLElement('input', {
          type: 'checkbox', checked: state[key],
          style: { accentColor: 'var(--omni-accent)', cursor: 'pointer', width: '16px', height: '16px' },
          eventListener: { change: (e) => { state[key] = e.target.checked; updateUI(); } }
        });
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(label));
        return lbl;
      };

      togglesGrid.appendChild(createToggle('Uppercase (A-Z)', 'upper'));
      togglesGrid.appendChild(createToggle('Lowercase (a-z)', 'lower'));
      togglesGrid.appendChild(createToggle('Numbers (0-9)', 'numbers'));
      togglesGrid.appendChild(createToggle('Symbols (!@#$)', 'symbols'));
      controls.appendChild(togglesGrid);

      container.appendChild(controls);

      const generatePassword = () => {
        let charset = '';
        if (state.upper) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (state.lower) charset += 'abcdefghijklmnopqrstuvwxyz';
        if (state.numbers) charset += '0123456789';
        if (state.symbols) charset += '!@#$%^&*()_+~`|}{[]:;?><,./-=';

        if (charset === '') { charset = 'abcdefghijklmnopqrstuvwxyz'; state.lower = true; }

        let pass = '';
        const randomValues = new Uint32Array(state.length);
        window.crypto.getRandomValues(randomValues);

        for (let i = 0; i < state.length; i++) { pass += charset[randomValues[i] % charset.length]; }
        this.result = pass;
        return { pass, poolSize: charset.length };
      };

      const updateUI = () => {
        const { pass, poolSize } = generatePassword();
        state.currentPassword = pass;
        passText.textContent = pass;
        lengthLabel.textContent = `Length: ${state.length}`;

        const entropy = poolSize === 0 ? 0 : state.length * (Math.log(poolSize) / Math.log(2));
        entropyText.textContent = `~${Math.round(entropy)} bits`;

        let strengthColor, strengthLabel, fillWidth;

        if (entropy < 40) {
          strengthColor = 'var(--omni-danger, #dc2626)';
          strengthLabel = 'Weak';
          fillWidth = '25%';
        } else if (entropy < 60) {
          strengthColor = 'var(--omni-warning, #f59e0b)';
          strengthLabel = 'Good';
          fillWidth = '50%';
        } else if (entropy < 80) {
          strengthColor = 'var(--omni-success, #16a34a)';
          strengthLabel = 'Strong';
          fillWidth = '75%';
        } else {
          strengthColor = 'var(--omni-accent, #3b82f6)';
          strengthLabel = 'Unbreakable';
          fillWidth = '100%';
        }

        strengthText.textContent = strengthLabel;
        strengthText.style.color = strengthColor;
        barFill.style.width = fillWidth;
        barFill.style.background = strengthColor;
      };

      const actions = [
        FluxKit.ui.omni.Button('refresh', 'Regenerate', (e) => { e.stopPropagation(); updateUI(); }),
        FluxKit.ui.omni.Button('copy', 'Copy & Close', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(state.currentPassword);
          if (FluxHub.ui) FluxHub.ui.hide();
        })
      ];

      updateUI();

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    renderNameTool(data) {
      const namePools = {
        fantasy: {
          first: ['Aelion', 'Lyra', 'Kaelen', 'Vespera', 'Thorne', 'Isolde', 'Dorian', 'Nyx', 'Zephyr', 'Orion', 'Elysia', 'Gideon'],
          last: ['Nightshade', 'Starwhisper', 'Vance', 'Ironwood', 'Shadowmere', 'Dawnseeker', 'Blackwood', 'Silverleaf']
        },
        scifi: {
          first: ['Jax', 'Nova', 'Caleb', 'Zoe', 'Orion', 'Nyx', 'Talon', 'Vex', 'Kiran', 'Lyra', 'Axel', 'Rhea'],
          last: ['Vance', 'Stellar', 'Cross', 'Sterling', 'Kovalev', 'Nexus', 'Prime', 'Holloway']
        },
        modern: {
          first: ['Elena', 'Noah', 'Maya', 'Lucas', 'Chloe', 'Ethan', 'Zoe', 'Liam', 'Aria', 'Mason', 'Harper', 'Caleb'],
          last: ['Sinclair', 'Hayes', 'Mercer', 'Vance', 'Brooks', 'Sterling', 'Cole', 'Keller']
        }
      };

      const activeGenre = namePools[data.payload] ? data.payload : 'fantasy';
      this.genre = activeGenre;

      const container = createHTMLElement('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px' }
      });

      const navRow = createHTMLElement('div', { style: { display: 'flex', gap: '6px' } });
      ['fantasy', 'scifi', 'modern'].forEach(g => {
        const pill = createHTMLElement('button', {
          textContent: g.toUpperCase(),
          style: {
            flex: '1', padding: '6px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer',
            background: g === activeGenre ? 'var(--omni-accent)' : 'var(--omni-input-bg)',
            color: g === activeGenre ? 'var(--omni-btn-text)' : 'var(--omni-muted)',
            border: '1px solid var(--omni-border)', outline: 'none'
          },
          eventListener: () => { this.genre = g; refreshList(g); }
        });
        navRow.appendChild(pill);
      });
      container.appendChild(navRow);

      const listWrapper = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' } });
      container.appendChild(listWrapper);

      const generateBatch = (gKey) => {
        listWrapper.innerHTML = safeHTML('');
        const pool = namePools[gKey] || namePools.fantasy;

        for (let i = 0; i < 5; i++) {
          const randFirst = pool.first[Math.floor(Math.random() * pool.first.length)];
          const randLast = pool.last[Math.floor(Math.random() * pool.last.length)];
          const fullName = `${randFirst} ${randLast}`;

          const row = createHTMLElement('div', {
            style: {
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', background: 'var(--omni-input-bg)', border: '1px solid var(--omni-border)',
              borderRadius: '6px', cursor: 'pointer', transition: 'background 0.15s ease'
            },
            eventListener: {
              mouseenter: (e) => { e.currentTarget.style.background = 'var(--omni-hover)' },
              mouseleave: (e) => { e.currentTarget.style.background = 'var(--omni-input-bg)' },
              click: () => {
                navigator.clipboard.writeText(fullName);
                const original = nameSpan.textContent;
                nameSpan.textContent = `${fullName} (Copied!)`;
                nameSpan.style.color = 'var(--omni-success)';
                setTimeout(() => { nameSpan.textContent = fullName; nameSpan.style.color = 'var(--omni-text)'; }, 1000);
              }
            }
          });

          const nameSpan = createHTMLElement('span', { textContent: fullName, style: { fontWeight: '600', fontSize: '14px', color: 'var(--omni-text)', fontFamily: 'monospace' } });

          const copyHint = createHTMLElement('span', { textContent: 'Click to copy', style: { fontSize: '11px', color: 'var(--omni-muted)' } });

          row.appendChild(nameSpan);
          row.appendChild(copyHint);
          listWrapper.appendChild(row);
        }
      };

      const refreshList = (gKey) => {
        Array.from(navRow.children).forEach((btn, idx) => {
          const keys = ['fantasy', 'scifi', 'modern'];
          const matches = keys[idx] === gKey;
          btn.style.background = matches ? 'var(--omni-accent)' : 'var(--omni-input-bg)';
          btn.style.color = matches ? 'var(--omni-btn-text)' : 'var(--omni-muted)';
        });
        generateBatch(gKey);
      };

      generateBatch(activeGenre);

      const actions = [FluxKit.ui.omni.Button('refresh', 'Generate More', (e) => { e.stopPropagation(); generateBatch(this.genre); })];

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    renderQRTool(data) {
      const text = data.payload;
      const qrSize = 180;

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '16px 8px' } });

      const imgWrapper = createHTMLElement('div', { style: { background: '#fff', padding: '12px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', minWidth: `${qrSize}px`, minHeight: `${qrSize}px` } });

      const img = createHTMLElement('img', { width: qrSize, height: qrSize, style: { display: 'block', borderRadius: '4px', transition: 'opacity 0.2s ease' } });

      imgWrapper.appendChild(img);
      container.appendChild(imgWrapper);

      let currentBlobUrl = null;
      const fetchQR = (encodeText) => {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(encodeText)}&margin=0`;

        img.style.opacity = '0.3';

        GM_xmlhttpRequest({
          method: 'GET', url: qrUrl, responseType: 'blob',
          onload: (response) => {
            if (response.status === 200) {
              if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
              currentBlobUrl = URL.createObjectURL(response.response);
              img.src = currentBlobUrl;
              img.style.opacity = '1';
            }
          },
          onerror: (err) => { logError('QR Fetch Error:', err); img.style.opacity = '1'; }
        });
      };

      fetchQR(text);

      const inputWrapper = createHTMLElement('div', { style: { width: '100%', display: 'flex', gap: '8px' } });

      const textInput = createHTMLElement('input', {
        type: 'text', value: text,
        style: {
          flex: '1', padding: '10px 12px', borderRadius: '6px',
          border: '1px solid var(--omni-border)', background: 'var(--omni-input-bg)',
          color: 'var(--omni-text)', fontSize: '13px', outline: 'none'
        },
        eventListener: {
          focus: (e) => e.target.select(),
          input: (e) => {
            clearTimeout(this.debounce);
            this.debounce = setTimeout(() => { const val = e.target.value.trim() || window.location.href; fetchQR(val); }, 300);
          }
        }
      });

      inputWrapper.appendChild(textInput);
      container.appendChild(inputWrapper);

      const actions = [
        FluxKit.ui.omni.Button('copy', 'Copy Link', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(textInput.value);
          const btnText = e.currentTarget.querySelector('.flx-omni-btn-label');
          if (btnText) {
            const original = btnText.textContent;
            btnText.textContent = 'Copied!';
            setTimeout(() => { btnText.textContent = original; }, 1000);
          }
        }),

        FluxKit.ui.omni.Button('import', 'Save QR', (e) => {
          e.stopPropagation();
          if (!currentBlobUrl) return;

          const a = document.createElement('a');
          a.href = currentBlobUrl;
          a.download = 'flux-qr.png';
          a.click();
        })
      ];

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    renderUUIDTool() {
      const uuid = crypto.randomUUID();
      const output = createHTMLElement('div', { textContent: uuid, style: { padding: '16px', fontFamily: 'monospace', fontSize: '18px' }});
      const copyBtn = FluxKit.ui.omni.Button('copy', 'Copy UUID', () => { navigator.clipboard.writeText(uuid); FluxHub.ui.hide(); });
      return FluxKit.ui.omni.DetailCard(output, [copyBtn]);
    }

    renderIconView(payload) {
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', fontFamily: 'var(--omni-font)' } });

      const header = createHTMLElement('div', {
        style: { fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--omni-muted)', letterSpacing: '0.5px' },
        textContent: payload.term ? `Found ${payload.results.length} icons matching "${payload.term}"` : `Available Icons (${payload.results.length})`
      });
      container.appendChild(header);

      if (payload.results.length === 0) {
        container.appendChild(createHTMLElement('div', {
          style: { color: 'var(--omni-muted)', textAlign: 'center', padding: '20px', fontSize: '13px' },
          textContent: 'No icons found. Try a different search term or type "> icons" to see all.'
        }));
        return FluxKit.ui.omni.DetailCard(container, []);
      }

      const grid = createHTMLElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(65px, 1fr))', gap: '10px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' } });

      grid.style.cssText += '::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: var(--omni-border); border-radius: 4px; }';

      payload.results.forEach(icon => {
        const card = createHTMLElement('div', {
          fluxHubTooltip: `Click to copy FluxKit.ui.icons['${icon.name}']`,
          style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '12px 6px', background: 'var(--omni-input-bg)', border: '1px solid var(--omni-border)',
            borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s ease', gap: '8px'
          },
          eventListener: {
            mouseenter: e => {
              e.currentTarget.style.background = 'var(--omni-hover)';
              e.currentTarget.style.borderColor = 'var(--omni-accent)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            },
            mouseleave: e => {
              e.currentTarget.style.background = 'var(--omni-input-bg)';
              e.currentTarget.style.borderColor = 'var(--omni-border)';
              e.currentTarget.style.transform = 'translateY(0)';
            },
            click: e => {
              e.stopPropagation();
              const copyText = `FluxKit.ui.icons['${icon.name}']`;
              navigator.clipboard.writeText(copyText).then(() => {
                if (FluxKit.ui.showNotification) FluxKit.ui.showNotification(`Copied: ${copyText}`);
              });

              const originalBg = e.currentTarget.style.background;
              e.currentTarget.style.background = 'var(--omni-success)';
              setTimeout(() => { if (e.currentTarget.isConnected) e.currentTarget.style.background = originalBg; }, 200);
            }
          }
        });

        const svgWrap = createHTMLElement('div', { style: { width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--omni-text)' } });

        let safeSvg = icon.svg;
        if (!safeSvg.includes('width=')) safeSvg = safeSvg.replace('<svg', '<svg width="100%" height="100%"');
        if (!safeSvg.includes('fill=')) safeSvg = safeSvg.replace('<svg', '<svg fill="currentColor"');
        svgWrap.innerHTML = safeHTML(safeSvg);

        const label = createHTMLElement('div', { textContent: icon.name, style: { fontSize: '10px', color: 'var(--omni-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center', fontWeight: '500' } });

        card.appendChild(svgWrap);
        card.appendChild(label);
        grid.appendChild(card);
      });

      container.appendChild(grid);

      const footerHint = createHTMLElement('div', {
        textContent: '💡 Click any icon to copy its accessor path to your clipboard.',
        style: { fontSize: '11px', color: 'var(--omni-muted)', textAlign: 'center', marginTop: '6px' }
      });
      container.appendChild(footerHint);

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    async execute() {
      const data = await this.fetchData();
      switch(data.tool) {
        case 'password':
          navigator.clipboard.writeText(this.result);
          if (FluxHub.ui) FluxHub.ui.hide();
          break;
        case 'qr':
          navigator.clipboard.writeText(data.payload);
          if (FluxHub.ui) FluxHub.ui.hide();
          break;
        case 'name':
        case 'uuid':
        default:
          FluxHub.ui.expandListItem(this, data);
          break;
      }
    }
  }

  /**
   * ============================================================================
   * VIEW: Developer Tools Hub (Tier 2)
   * Consolidates string manipulation, formatting, and encoding utilities.
   * ============================================================================
   */
  class ToolsHubView extends BaseView {
    constructor(query) {
      super(query);
      this.rawQuery = query.trim();
      this.query = this.rawQuery.toLowerCase();
      this.debounceTimer = null;
    }

    static isAvailable = true;

    static commandRegistry = [
      { prefix: '> json', description: 'Format, validate, and minify JSON payloads', icon: 'code' },
      { prefix: '> regex', description: 'Test regular expressions in real-time', icon: 'search' },
      { prefix: '> b64', description: 'Encode or decode Base64 strings', icon: 'hash' },
      { prefix: '> ratio', description: 'Crop and resize images for social media grids', icon: 'image' }
    ];

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (['> json', '> regex', '> b64', '> base64', '> ratio', '> crop', '> resize'].includes(q)) return 100;
      if (q.startsWith('> json ') || q.startsWith('> regex ') || q.startsWith('> b64 ') || q.startsWith('> base64 ') || q.startsWith('> ratio ') || q.startsWith('> crop ') || q.startsWith('> resize ')) return 100;
      return 0;
    }

    async fetchData() {
      let tool = 'unknown';
      let payload = '';

      if (this.query.startsWith('> json')) {
        tool = 'json';
        payload = this.rawQuery.replace(/^>\s*json\s*/i, '').trim();
      }
      else if (this.query.startsWith('> regex')) {
        tool = 'regex';
        payload = this.rawQuery.replace(/^>\s*regex\s*/i, '').trim();
      }
      else if (this.query.startsWith('> b64') || this.query.startsWith('> base64')) {
        tool = 'base64';
        payload = this.rawQuery.replace(/^>\s*b(ase)?64\s*/i, '').trim();
      } else if (this.query.startsWith('> ratio') || this.query.startsWith('> crop') || this.query.startsWith('> resize')) {
        tool = 'crop';
        payload = null;
      }

      return { tool, payload };
    }

    renderListRow() {
      if (this.query.startsWith('> ratio') || this.query.startsWith('> crop') || this.query.startsWith('> resize')) {
        return FluxKit.ui.omni.ListRow('Aspect Ratio & Quick Crop', 'image', 'Crop and resize images', 'to open');
      }
      return FluxKit.ui.omni.ListRow('Developer Tools', 'code', 'JSON, Regex, Base64...', 'to open');
    }

    renderExpandedCard(data) {
      switch(data.tool) {
        case 'json': return this.renderJsonTool(data.payload);
        case 'regex': return this.renderRegexTool(data.payload);
        case 'base64': return this.renderBase64Tool(data.payload);
        case 'crop': return this.renderRatioTool();
        default: return createHTMLElement('div', { textContent: 'Unknown developer tool.' });
      }
    }

    renderJsonTool(initialPayload) {
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px' } });

      let isMinified = false;

      const inputArea = createHTMLElement('textarea', {
        placeholder: 'Paste JSON here...', value: initialPayload,
        style: { width: '100%', height: '120px', padding: '10px', background: 'var(--omni-input-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical', outline: 'none' },
        eventListener: { input: () => this.debounce(() => processJson()) }
      });

      const outputArea = createHTMLElement('pre', {
        style: { width: '100%', minHeight: '120px', maxHeight: '200px', overflowY: 'auto', padding: '10px', background: 'var(--omni-bg-light)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', margin: '0', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }
      });

      let currentParsed = null;

      const processJson = () => {
        const raw = inputArea.value.trim();
        if (!raw) {
          outputArea.textContent = '';
          outputArea.style.color = 'var(--omni-text)';
          currentParsed = null;
          return;
        }
        try {
          currentParsed = JSON.parse(raw);
          outputArea.textContent = JSON.stringify(currentParsed, null, isMinified ? 0 : 2);
          outputArea.style.color = 'var(--omni-success, #10b981)';
        } catch (err) {
          outputArea.textContent = `Invalid JSON:\n${err.message}`;
          outputArea.style.color = 'var(--omni-danger, #ef4444)';
          currentParsed = null;
        }
      };

      container.appendChild(inputArea);
      container.appendChild(outputArea);
      processJson();

      const toggleBtn = FluxKit.ui.omni.Button('code', 'Minify', (e) => {
        e.stopPropagation();
        isMinified = !isMinified;
        
        const labelSpan = toggleBtn.querySelector('.flx-omni-btn-label');
        if (labelSpan) {
          labelSpan.textContent = isMinified ? 'Beautify' : 'Minify';
        }
        
        processJson();
      });

      const copyBtn = FluxKit.ui.omni.Button('copy', 'Copy Result', (e) => {
        e.stopPropagation();
        if (outputArea.textContent) navigator.clipboard.writeText(outputArea.textContent);
        FluxHub.ui.hide();
      });

      const actions = [toggleBtn, copyBtn];

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    renderRegexTool(initialPayload) {
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px' } });

      const controlsRow = createHTMLElement('div', { style: { display: 'flex', gap: '8px' } });

      const patternInput = createHTMLElement('input', {
        type: 'text', placeholder: 'Regex pattern (e.g. [a-z]+)', value: initialPayload,
        style: { flex: '1', padding: '8px 12px', background: 'var(--omni-input-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', borderRadius: '6px', fontFamily: 'monospace', outline: 'none' },
        eventListener: {
          input: () => this.debounce(() => processRegex()),
          paste: (e) => {
            const pasted = (e.clipboardData || window.clipboardData).getData('text');
            const literalMatch = pasted.match(/^\/(.+)\/([a-z]*)$/i);
            if (literalMatch) {
              e.preventDefault();
              patternInput.value = literalMatch[1];
              if (literalMatch[2]) flagsInput.value = literalMatch[2].replace(/y/g, '');
              processRegex();
            }
          }
        }
      });

      const flagsInput = createHTMLElement('input', {
        type: 'text', placeholder: 'Flags (g, i, m)', value: 'g',
        style: { width: '80px', padding: '8px', background: 'var(--omni-input-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', borderRadius: '6px', fontFamily: 'monospace', textAlign: 'center', outline: 'none' },
        eventListener: { input: () => this.debounce(() => processRegex()) }
      });

      controlsRow.appendChild(patternInput);
      controlsRow.appendChild(flagsInput);
      container.appendChild(controlsRow);

      const testArea = createHTMLElement('textarea', {
        placeholder: 'Paste test string here...',
        style: { width: '100%', height: '80px', padding: '10px', background: 'var(--omni-input-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical', outline: 'none' },
        eventListener: { input: () => this.debounce(() => processRegex()) }
      });
      container.appendChild(testArea);

      const summaryRow = createHTMLElement('div', {
        style: { fontSize: '11px', fontWeight: '600', color: 'var(--omni-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
      });
      const matchCountLabel = createHTMLElement('span', { textContent: 'Awaiting input...' });
      summaryRow.appendChild(matchCountLabel);
      container.appendChild(summaryRow);

      const outputArea = createHTMLElement('div', {
        style: { width: '100%', minHeight: '80px', maxHeight: '150px', overflowY: 'auto', padding: '10px', background: 'var(--omni-bg-light)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }
      });
      container.appendChild(outputArea);

      let lastMatches = [];
      const processRegex = () => {
        outputArea.innerHTML = safeHTML('');
        const pattern = patternInput.value.trim();
        const text = testArea.value;
        const flags = flagsInput.value.trim().replace(/y/g, '');

        lastMatches = [];

        if (!pattern || !text) {
          outputArea.appendChild(document.createTextNode(text || 'Awaiting input...'));
          matchCountLabel.textContent = 'Awaiting input...';
          return;
        }

        try {
          const re = new RegExp(pattern, flags);
          let match;
          let lastIndex = 0;
          let matchFound = false;

          if (!re.global) {
             const singleMatch = text.match(re);
             if (singleMatch) {
              matchFound = true;
              lastMatches.push(singleMatch[0]);
              if (singleMatch.index > 0) outputArea.appendChild(document.createTextNode(text.substring(0, singleMatch.index)));

              const highlight = createHTMLElement('span', { textContent: singleMatch[0], style: { background: 'var(--omni-muted)', color: 'var(--omni-btn-text)', borderRadius: '3px', padding: '0 2px' } });
              outputArea.appendChild(highlight);

              if (singleMatch.index + singleMatch[0].length < text.length) outputArea.appendChild(document.createTextNode(text.substring(singleMatch.index + singleMatch[0].length)));
             } else { outputArea.appendChild(document.createTextNode(text)); }
          } else {
            while ((match = re.exec(text)) !== null) {
              if (match.index < lastIndex) { re.lastIndex = lastIndex; continue; }

              matchFound = true;
              lastMatches.push(match[0]);
              if (match.index > lastIndex) outputArea.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
              if (match[0].length === 0) { re.lastIndex++; continue; }

              const highlight = createHTMLElement('span', { textContent: match[0], style: { background: 'var(--omni-accent)', color: '#fff', borderRadius: '3px', padding: '0 2px' } });
              outputArea.appendChild(highlight);
              lastIndex = match.index + match[0].length;
            }
            if (lastIndex < text.length) outputArea.appendChild(document.createTextNode(text.substring(lastIndex)));
          }

          matchCountLabel.textContent = matchFound
            ? `${lastMatches.length} match${lastMatches.length === 1 ? '' : 'es'} found`
            : 'No matches';

        } catch (err) {
          outputArea.appendChild(createHTMLElement('span', { textContent: err.message, style: { color: 'var(--omni-danger, #ef4444)' } }));
          matchCountLabel.textContent = 'Invalid pattern';
        }
      };

      processRegex();
      setTimeout(() => patternInput.focus(), 10);

      const actions = [
        FluxKit.ui.omni.Button('copy', 'Copy Matches', (e) => {
          e.stopPropagation();
          if (lastMatches.length) navigator.clipboard.writeText(lastMatches.join('\n'));
          FluxHub.ui.hide();
        })
      ];

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    renderBase64Tool(initialPayload) {
      let mode = 'encode';

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px' } });

      const toggleRow = createHTMLElement('div', { style: { display: 'flex', gap: '6px' } });
      const encodeBtn = createHTMLElement('button', { textContent: 'Encode', style: { flex: '1', padding: '6px', background: 'var(--omni-accent)', color: 'var(--omni-btn-text)', border: 'none', borderRadius: '6px', cursor: 'pointer', outline: 'none' }});
      const decodeBtn = createHTMLElement('button', { textContent: 'Decode', style: { flex: '1', padding: '6px', background: 'var(--omni-input-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', borderRadius: '6px', cursor: 'pointer', outline: 'none' }});
      toggleRow.appendChild(encodeBtn);
      toggleRow.appendChild(decodeBtn);
      container.appendChild(toggleRow);

      const inputArea = createHTMLElement('textarea', {
        placeholder: 'Enter text here...', value: initialPayload,
        style: { width: '100%', height: '80px', padding: '10px', background: 'var(--omni-input-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', borderRadius: '6px', fontFamily: 'monospace', resize: 'vertical', outline: 'none' },
        eventListener: { input: () => this.debounce(() => processB64()) }
      });
      container.appendChild(inputArea);

      const outputArea = createHTMLElement('textarea', {
        readOnly: true, placeholder: 'Result...',
        style: { width: '100%', height: '80px', padding: '10px', background: 'var(--omni-bg-light)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', borderRadius: '6px', fontFamily: 'monospace', resize: 'vertical', outline: 'none' }
      });
      container.appendChild(outputArea);

      const updateToggles = () => {
        encodeBtn.style.background = mode === 'encode' ? 'var(--omni-accent)' : 'var(--omni-input-bg)';
        encodeBtn.style.color = mode === 'encode' ? 'var(--omni-btn-text)' : 'var(--omni-text)';
        encodeBtn.style.border = mode === 'encode' ? 'none' : '1px solid var(--omni-border)';

        decodeBtn.style.background = mode === 'decode' ? 'var(--omni-accent)' : 'var(--omni-input-bg)';
        decodeBtn.style.color = mode === 'decode' ? 'var(--omni-btn-text)' : 'var(--omni-text)';
        decodeBtn.style.border = mode === 'decode' ? 'none' : '1px solid var(--omni-border)';
      };

      encodeBtn.addEventListener('click', () => { mode = 'encode'; updateToggles(); processB64(); });
      decodeBtn.addEventListener('click', () => { mode = 'decode'; updateToggles(); processB64(); });

      const processB64 = () => {
        const val = inputArea.value;
        if (!val) { outputArea.value = ''; return; }
        try { outputArea.value = mode === 'encode' ? btoa(val) : atob(val); } catch (e) { outputArea.value = 'Invalid input for base64 operation.'; }
      };

      processB64();

      const actions = [
        FluxKit.ui.omni.Button('copy', 'Copy Output', (e) => {
          e.stopPropagation();
          if (outputArea.value) navigator.clipboard.writeText(outputArea.value);
          FluxHub.ui.hide();
        })
      ];

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    renderRatioTool() {
      let loadedImage = null;
      let imgNaturalW = 0, imgNaturalH = 0;
      let displayScale = 1;
      let currentRatio = { name: 'Free', w: null, h: null };
      let sel = { x: 0, y: 0, w: 0, h: 0 };
      let drag = null;

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px' } });

      const presetsRow = createHTMLElement('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
      const ratios = [
        { name: 'Free', w: null, h: null, label: 'Freeform' },
        { name: '1:1', w: 1, h: 1, label: 'Square (1:1)' },
        { name: '4:5', w: 4, h: 5, label: 'Portrait (4:5)' },
        { name: '16:9', w: 16, h: 9, label: 'Landscape (16:9)' },
        { name: '9:16', w: 9, h: 16, label: 'Story (9:16)' }
      ];

      const highlightPresets = () => {
        Array.from(presetsRow.children).forEach((b, i) => {
          const active = ratios[i].name === currentRatio.name;
          b.style.background = active ? 'var(--omni-accent)' : 'var(--omni-input-bg)';
          b.style.color = active ? 'var(--omni-btn-text)' : 'var(--omni-muted)';
        });
      };

      ratios.forEach((r) => {
        const btn = createHTMLElement('button', {
          textContent: r.name,
          style: {
            flex: '1', padding: '6px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer',
            background: 'var(--omni-input-bg)', color: 'var(--omni-muted)',
            border: '1px solid var(--omni-border)', outline: 'none'
          },
          eventListener: () => {
            currentRatio = r;
            highlightPresets();
            if (loadedImage) applyRatioToSelection();
          }
        });
        presetsRow.appendChild(btn);
      });
      highlightPresets();
      container.appendChild(presetsRow);

      const dimsLabel = createHTMLElement('div', {
        textContent: '',
        style: { fontSize: '11px', color: 'var(--omni-muted)', fontWeight: '600', textAlign: 'right', minHeight: '14px' }
      });

      const previewWrapper = createHTMLElement('div', {
        style: {
          width: '100%', height: '260px', borderRadius: '8px', background: 'var(--omni-input-bg)',
          border: '2px dashed var(--omni-border)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', cursor: 'pointer'
        }
      });

      const dropzoneText = createHTMLElement('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', color: 'var(--omni-muted)', pointerEvents: 'none' },
        innerHTML: '<span style="font-size:14px; font-weight:600; color:var(--omni-text)">Drop image here or click to upload</span><span style="font-size:11px">Supports PNG, JPG, WebP</span>'
      });
      previewWrapper.appendChild(dropzoneText);

      const fileInput = createHTMLElement('input', {
        type: 'file', accept: 'image/*',
        style: { position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: '1' },
        eventListener: { change: (e) => { const file = e.target.files[0]; if (file) loadImageFile(file); } }
      });
      previewWrapper.appendChild(fileInput);

      const imgEl = createHTMLElement('img', {
        style: { display: 'none', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none', pointerEvents: 'none' },
        draggable: false
      });
      previewWrapper.appendChild(imgEl);

      const selectionBox = createHTMLElement('div', {
        style: {
          position: 'absolute', display: 'none', border: '2px solid var(--omni-accent)',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
          cursor: 'move', boxSizing: 'border-box', zIndex: '2'
        }
      });

      const handlePositions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      const handleCursors = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };
      const handles = {};

      handlePositions.forEach(pos => {
        const h = createHTMLElement('div', {
          style: {
            position: 'absolute', width: '10px', height: '10px', background: 'var(--omni-accent)',
            border: '1px solid #fff', borderRadius: '50%', cursor: handleCursors[pos], zIndex: '3'
          },
          eventListener: { pointerdown: (e) => { e.stopPropagation(); startDrag(pos, e); } }
        });
        handles[pos] = h;
        selectionBox.appendChild(h);
      });

      selectionBox.addEventListener('pointerdown', (e) => {
        if (e.target !== selectionBox) return;
        startDrag('move', e);
      });

      previewWrapper.appendChild(selectionBox);
      container.appendChild(previewWrapper);
      container.appendChild(dimsLabel);

      const positionHandles = () => {
        const mid = (a, b) => (a + b) / 2;
        const set = (h, x, y) => { h.style.left = `${x - 5}px`; h.style.top = `${y - 5}px`; };
        set(handles.nw, sel.x, sel.y);
        set(handles.n, mid(sel.x, sel.x + sel.w), sel.y);
        set(handles.ne, sel.x + sel.w, sel.y);
        set(handles.e, sel.x + sel.w, mid(sel.y, sel.y + sel.h));
        set(handles.se, sel.x + sel.w, sel.y + sel.h);
        set(handles.s, mid(sel.x, sel.x + sel.w), sel.y + sel.h);
        set(handles.sw, sel.x, sel.y + sel.h);
        set(handles.w, sel.x, mid(sel.y, sel.y + sel.h));
      };

      const renderSelection = () => {
        selectionBox.style.left = `${sel.x}px`;
        selectionBox.style.top = `${sel.y}px`;
        selectionBox.style.width = `${sel.w}px`;
        selectionBox.style.height = `${sel.h}px`;
        positionHandles();

        const natW = Math.round(sel.w / displayScale);
        const natH = Math.round(sel.h / displayScale);
        dimsLabel.textContent = `${natW} × ${natH} px`;
      };

      const getImageRect = () => {
        const wrapperRect = previewWrapper.getBoundingClientRect();
        const imgRect = imgEl.getBoundingClientRect();
        return {
          x: imgRect.left - wrapperRect.left,
          y: imgRect.top - wrapperRect.top,
          w: imgRect.width,
          h: imgRect.height
        };
      };

      const clampSelectionToImage = () => {
        const r = getImageRect();
        sel.w = Math.min(sel.w, r.w);
        sel.h = Math.min(sel.h, r.h);
        sel.x = Math.max(r.x, Math.min(sel.x, r.x + r.w - sel.w));
        sel.y = Math.max(r.y, Math.min(sel.y, r.y + r.h - sel.h));
      };

      const applyRatioToSelection = () => {
        const r = getImageRect();
        displayScale = r.w / imgNaturalW;

        if (currentRatio.w && currentRatio.h) {
          const desiredAspect = currentRatio.w / currentRatio.h;
          const cx = sel.x + sel.w / 2;
          const cy = sel.y + sel.h / 2;

          let w = sel.w, h = sel.w / desiredAspect;
          if (h > r.h) { h = r.h; w = h * desiredAspect; }
          if (w > r.w) { w = r.w; h = w / desiredAspect; }

          sel.w = w; sel.h = h;
          sel.x = cx - w / 2; sel.y = cy - h / 2;
        }

        clampSelectionToImage();
        renderSelection();
      };

      const resetSelectionToFullImage = () => {
        const r = getImageRect();
        displayScale = r.w / imgNaturalW;

        if (currentRatio.w && currentRatio.h) {
          const desiredAspect = currentRatio.w / currentRatio.h;
          let w = r.w, h = r.w / desiredAspect;
          if (h > r.h) { h = r.h; w = h * desiredAspect; }
          sel = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
        } else {
          sel = { x: r.x, y: r.y, w: r.w, h: r.h };
        }

        renderSelection();
      };

      const startDrag = (mode, e) => {
        drag = {
          mode, startPointerX: e.clientX, startPointerY: e.clientY,
          startSel: { ...sel }
        };
        document.addEventListener('pointermove', onDragMove);
        document.addEventListener('pointerup', onDragEnd);
      };

      const onDragMove = (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.startPointerX;
        const dy = e.clientY - drag.startPointerY;
        const r = getImageRect();
        const lockedAspect = currentRatio.w && currentRatio.h ? currentRatio.w / currentRatio.h : null;

        let { x, y, w, h } = drag.startSel;

        if (drag.mode === 'move') {
          x = drag.startSel.x + dx;
          y = drag.startSel.y + dy;
        } else {
          const applyH = (side) => {
            if (side === 'w') { x = drag.startSel.x + dx; w = drag.startSel.w - dx; }
            if (side === 'e') { w = drag.startSel.w + dx; }
          };
          const applyV = (side) => {
            if (side === 'n') { y = drag.startSel.y + dy; h = drag.startSel.h - dy; }
            if (side === 's') { h = drag.startSel.h + dy; }
          };

          if (drag.mode.includes('w')) applyH('w');
          if (drag.mode.includes('e')) applyH('e');
          if (drag.mode.includes('n')) applyV('n');
          if (drag.mode.includes('s')) applyV('s');

          if (lockedAspect) {
            if (drag.mode === 'n' || drag.mode === 's') {
              w = h * lockedAspect;
              x = drag.startSel.x + (drag.startSel.w - w) / 2;
            } else if (drag.mode === 'e' || drag.mode === 'w') {
              h = w / lockedAspect;
              y = drag.startSel.y + (drag.startSel.h - h) / 2;
            } else {
              // corner handles: drive off width, keep the opposite corner anchored
              h = w / lockedAspect;
              if (drag.mode.includes('n')) y = drag.startSel.y + drag.startSel.h - h;
              if (drag.mode.includes('w')) x = drag.startSel.x + drag.startSel.w - w;
            }
          }
        }

        const MIN = 20;
        if (w < MIN) w = MIN;
        if (h < MIN) h = MIN;

        x = Math.max(r.x, Math.min(x, r.x + r.w - w));
        y = Math.max(r.y, Math.min(y, r.y + r.h - h));
        w = Math.min(w, r.x + r.w - x);
        h = Math.min(h, r.y + r.h - y);

        sel = { x, y, w, h };
        renderSelection();
      };

      const onDragEnd = () => {
        drag = null;
        document.removeEventListener('pointermove', onDragMove);
        document.removeEventListener('pointerup', onDragEnd);
      };

      const loadImageFile = (file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            loadedImage = img;
            imgNaturalW = img.naturalWidth;
            imgNaturalH = img.naturalHeight;

            dropzoneText.style.display = 'none';
            imgEl.style.display = 'block';
            imgEl.src = img.src;
            selectionBox.style.display = 'block';

            requestAnimationFrame(resetSelectionToFullImage);
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      };

      previewWrapper.addEventListener('dragover', (e) => { e.preventDefault(); previewWrapper.style.borderColor = 'var(--omni-accent)'; });
      previewWrapper.addEventListener('dragleave', () => { previewWrapper.style.borderColor = 'var(--omni-border)'; });
      previewWrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        previewWrapper.style.borderColor = 'var(--omni-border)';
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) loadImageFile(file);
      });

      const resizeObserver = new ResizeObserver(() => {
        if (loadedImage) {
          const r = getImageRect();
          if (r.w > 0) { displayScale = r.w / imgNaturalW; clampSelectionToImage(); renderSelection(); }
        }
      });
      resizeObserver.observe(previewWrapper);

      const exportCrop = () => {
        if (!loadedImage) return null;
        const r = getImageRect();

        const sx = (sel.x - r.x) / displayScale;
        const sy = (sel.y - r.y) / displayScale;
        const sw = sel.w / displayScale;
        const sh = sel.h / displayScale;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = Math.round(sw);
        outCanvas.height = Math.round(sh);
        const ctx = outCanvas.getContext('2d');
        ctx.drawImage(loadedImage, sx, sy, sw, sh, 0, 0, outCanvas.width, outCanvas.height);
        return outCanvas;
      };

      const actions = [
        FluxKit.ui.omni.Button('import', 'Download Cropped', (e) => {
          e.stopPropagation();
          const outCanvas = exportCrop();
          if (!outCanvas) return;

          const link = document.createElement('a');
          link.download = `cropped-${currentRatio.name.replace(':', '-')}.png`;
          link.href = outCanvas.toDataURL('image/png');
          link.click();
        }),
        FluxKit.ui.omni.Button('copy', 'Copy to Clipboard', async (e) => {
          e.stopPropagation();
          const outCanvas = exportCrop();
          if (!outCanvas) return;
          try {
            outCanvas.toBlob(async (blob) => {
              if (!blob) return;
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            }, 'image/png');
          } catch (err) {}
        })
      ];

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    debounce(fn, delay = 250) { clearTimeout(this.debounceTimer); this.debounceTimer = setTimeout(fn, delay); }

    async execute() {
      if (this.query.startsWith('> ratio') || this.query.startsWith('> crop') || this.query.startsWith('> resize')) {
        if (FluxHub.ui) FluxHub.ui.hide();
      }
      const data = await this.fetchData(); FluxHub.ui.expandListItem(this, data);
    }

    destroy() { clearTimeout(this.debounceTimer); }
  }

  /**
   * ============================================================================
   * VIEW: Time & Sync Hub (Tier 1)
   * Consolidates Timer, Stopwatch, Pomodoro, World Clock, and Epoch operations
   * onto a unified event loop to eliminate DOM thrashing and interval leaks.
   * ============================================================================
   */
  class TimeManagerHubView extends BaseView {
    constructor(query, context = null) {
      super(query, context);
      this.rawQuery = query.trim();
      this.query = this.rawQuery.toLowerCase();
      this.nodes = {};
      this.tickSubscribers = new Set();
      this.hubInterval = setInterval(() => {
        const now = Date.now();
        for (const fn of this.tickSubscribers) fn(now);
      }, 47); // ~20fps for smooth ms rendering
    }

    static isAvailable = true;
    static groupWidgets = true;

    static commandRegistry = [
      { prefix: '> timer', description: 'Start a cross-tab synchronized timer (e.g. > timer 5m)', icon: 'timer' },
      { prefix: '> sw', description: 'High-precision, cross-tab synchronized stopwatch', icon: 'stopwatch' },
      { prefix: '> pomo', description: 'Pomodoro Productivity Timer', icon: 'pomodoro' },
      { prefix: '> clock', description: 'Check local time in any city (e.g., > clock London)', icon: 'worldClock' },
      { prefix: '> epoch', description: 'Convert Unix timestamps to human-readable time', icon: 'clock' }
    ];

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (['> sw', '> stopwatch', '> pomo', '> pomodoro', '> pm', '> timer', '> t', '> epoch'].includes(q)) return 100;
      if (q.startsWith('> timer ') || q.startsWith('> t ') || q.startsWith('> sw ') || q.startsWith('> pomo ') || q.startsWith('> pm ') || q.startsWith('> epoch ') || q.startsWith('> clock ') || q.startsWith('> time ')) return 100;
      if (/^\d{10,13}$/.test(query.trim())) return 100; // Raw Unix timestamps
      return 0;
    }

    parseTime(input) {
      const regex = /(\d+)\s*(h|m|s)/gi;
      let match, ms = 0, found = false;
      while ((match = regex.exec(input)) !== null) {
        found = true;
        const val = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        if (unit === 'h') ms += val * 3600000;
        else if (unit === 'm') ms += val * 60000;
        else if (unit === 's') ms += val * 1000;
      }
      return found ? ms : null;
    }

    formatTimeLeft(ms) {
      if (ms <= 0) return '00:00';
      const totalSeconds = Math.ceil(ms / 1000);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;
      if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    formatStopwatchTime(ms, showMs = true) {
      if (ms <= 0) return showMs ? '00:00.00' : '00:00';
      const totalSeconds = Math.floor(ms / 1000);
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      const msPart = Math.floor((ms % 1000) / 10);
      const formattedMain = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      return showMs ? `${formattedMain}.<span style="font-size: 0.6em; opacity: 0.7;">${msPart.toString().padStart(2, '0')}</span>` : formattedMain;
    }

    async getIANATimezone(city) {
      const cacheKey = `tz_${city.toLowerCase()}`;
      const cached = await FluxHub.cache.get(cacheKey);
      if (cached) return cached;
      try {
        const res = await new Promise(resolve => {
           GM_xmlhttpRequest({
             method: 'GET', url: `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
             onload: r => resolve(JSON.parse(r.responseText)), onerror: () => resolve(null)
           });
        });
        if (res && res.results && res.results[0].timezone) {
          const tz = res.results[0].timezone;
          await FluxHub.cache.set(cacheKey, tz, 24 * 60 * 60 * 1000);
          return tz;
        }
      } catch (e) { return null; }
      return null;
    }

    getDefaultPomodoroState() {
      return {
        mode: 'focus', status: 'idle', endsAt: 0, remainingMs: 25 * 60 * 1000, completedFocusCount: 0,
        config: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakInterval: 4 }
      };
    }

    async fetchData() {
      let tool = 'unknown';
      let payload = null;

      if (this.query.startsWith('> timer ') || this.query.startsWith('> t ') || ['> timer', '> t'].includes(this.query)) {
        tool = 'timer';
        const input = this.rawQuery.replace(/^>\s*(timer|t)\s*/i, '').trim();
        const activeTimer = FluxHubState.get(STATE_KEYS.ACTIVE_TIMER, null);
        if (input) { const ms = this.parseTime(input); payload = !ms ? { error: 'Invalid format. Use "5m", "1h 30m"' } : { action: 'start', ms, label: input }; }
        else if (activeTimer) { payload = { action: 'view', timer: activeTimer }; }
        else { payload = { error: 'No active timer. Type "> timer 5m" to start.' }; }
      }
      else if (this.query.startsWith('> sw') || this.query.startsWith('> stopwatch')) {
        tool = 'stopwatch';
        payload = FluxHubState.get(STATE_KEYS.ACTIVE_STOPWATCH, { isRunning: false, startTime: 0, accumulated: 0, laps: [] });
      }
      else if (this.query.startsWith('> pomo') || this.query.startsWith('> pomodoro') || this.query.startsWith('> pm')) {
        tool = 'pomodoro';
        payload = FluxHubState.get(STATE_KEYS.ACTIVE_POMODORO, this.getDefaultPomodoroState());
      }
      else if (this.query.startsWith('> epoch') || /^\d{10,13}$/.test(this.rawQuery)) {
        tool = 'epoch';
        const arg = this.rawQuery.replace(/^>\s*epoch\s*/i, '').trim();
        const ts = arg ? Number(arg) : Date.now();
        payload = { timestamp: isNaN(ts) ? Date.now() : ts };
      }
      else if (this.query.startsWith('> clock') || this.query.startsWith('> time')) {
        tool = 'clock';
        const city = this.rawQuery.replace(/^>\s*(clock|time)\s+(in\s+)?/i, '').trim();
        if (!city) return null;
        const tz = await this.getIANATimezone(city);
        payload = !tz ? { city, error: 'Timezone not found' } : { city, tz };
      }

      this.activeTool = tool;
      return { tool, payload };
    }

    renderListRow() {
      switch(this.activeTool) {
        case 'timer': return FluxKit.ui.omni.ListRow('Global Timer', 'timer', 'Cross-Tab Synchronized Timer', 'to view/start');
        case 'stopwatch': return FluxKit.ui.omni.ListRow('Precision Stopwatch', 'stopwatch', 'Cross-Tab Synchronized Stopwatch');
        case 'pomodoro': return FluxKit.ui.omni.ListRow('Pomodoro Tracker', 'pomodoro', 'Focus Sessions & Breaks');
        case 'epoch': return FluxKit.ui.omni.ListRow('Epoch Converter', 'clock', 'Unix Epoch Tool');
        case 'clock': return FluxKit.ui.omni.ListRow('World Clock', 'worldClock', 'Check Global Time');
        default: return FluxKit.ui.omni.ListRow('Time Manager', 'clock', 'Time and Date Utilities');
      }
    }

    renderExpandedCard(data) {
      switch(data.tool) {
        case 'timer': return this.renderTimerTool(data.payload);
        case 'stopwatch': return this.renderStopwatchTool(data.payload);
        case 'pomodoro': return this.renderPomodoroTool(data.payload);
        case 'epoch': return this.renderEpochTool(data.payload);
        case 'clock': return this.renderClockTool(data.payload);
        default: return createHTMLElement('div', { textContent: 'Unknown tool.' });
      }
    }

    renderTimerTool(data) {
      if (data.action === 'start') return null;

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', fontFamily: 'var(--omni-font)' } });

      if (data.error) {
        container.appendChild(createHTMLElement('div', { style: { fontSize: '15px', color: 'var(--omni-muted)' }, textContent: data.error }));
        return FluxKit.ui.omni.DetailCard(container, []);
      }

      if (data.action === 'view') {
        const timer = data.timer;
        container.appendChild(createHTMLElement('div', { style: { fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--omni-muted)', fontWeight: '600' }, textContent: `Timer: ${timer.label}` }));

        const countdown = createHTMLElement('div', { style: { fontSize: '64px', fontWeight: 'bold', color: 'var(--omni-text)', fontVariantNumeric: 'tabular-nums' }, textContent: this.formatTimeLeft(timer.endsAt - Date.now()) });
        container.appendChild(countdown);

        const tickFn = (now) => {
          if (!countdown.isConnected) return this.tickSubscribers.delete(tickFn);
          const remaining = timer.endsAt - now;
          if (remaining <= 0) {
            this.tickSubscribers.delete(tickFn);
            countdown.textContent = '00:00';
          } else { countdown.textContent = this.formatTimeLeft(remaining); }
        };
        this.tickSubscribers.add(tickFn);

        const stopBtn = FluxKit.ui.omni.Button('close', 'Cancel Timer', e => {
          e.stopPropagation();
          FluxHubState.delete(STATE_KEYS.ACTIVE_TIMER);
          FluxHub.ui.hide();
        });
        stopBtn.style.background = 'var(--omni-danger)';
        stopBtn.style.color = 'var(--omni-btn-text)';
        return FluxKit.ui.omni.DetailCard(container, [stopBtn]);
      }

      return null;
    }

    renderStopwatchTool(state) {
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0', fontFamily: 'var(--omni-font)' } });

      const swDisplay = createHTMLElement('div', { innerHTML: this.formatStopwatchTime(state.isRunning ? (Date.now() - state.startTime + state.accumulated) : state.accumulated),
        style: { fontSize: '64px', fontWeight: 'bold', color: 'var(--omni-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: '2px', margin: '10px 0' }
      });
      this.nodes.swDisplay = swDisplay;
      container.appendChild(swDisplay);

      this.nodes.lapsContainer = createHTMLElement('div', { style: { width: '100%', maxHeight: '150px', overflowY: 'auto', marginTop: '16px', borderTop: '1px solid var(--omni-separator)', paddingTop: '8px' } });
      container.appendChild(this.nodes.lapsContainer);

      const renderLaps = () => {
        this.nodes.lapsContainer.innerHTML = safeHTML('');
        if (!state.laps) return;
        [...state.laps].reverse().forEach((lap, index) => {
          const row = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 12px', fontSize: '14px', borderBottom: '1px solid var(--omni-hover)', color: 'var(--omni-text)' } });
          row.appendChild(createHTMLElement('span', { textContent: `Lap ${state.laps.length - index}`, style: { color: 'var(--omni-muted)', fontWeight: 'bold' } }));
          const times = createHTMLElement('div', { style: { display: 'flex', gap: '16px', fontVariantNumeric: 'tabular-nums' }});
          times.appendChild(createHTMLElement('span', { innerHTML: `+${this.formatStopwatchTime(lap.lapTime, false)}`, style: { color: 'var(--omni-muted)' } }));
          times.appendChild(createHTMLElement('span', { innerHTML: this.formatStopwatchTime(lap.totalTime, false), style: { fontWeight: '600' } }));
          row.appendChild(times);
          this.nodes.lapsContainer.appendChild(row);
        });
      };
      renderLaps();

      const actions = [];
      const applyFocus = el => { el.setAttribute('tabindex', '0'); return el; };

      const isPristine = !state.isRunning && state.accumulated === 0;
      const btnSecondary = applyFocus(FluxKit.ui.omni.Button('history', state.isRunning ? 'Lap [L]' : 'Reset [R]', e => {
        e.stopPropagation();
        if (state.isRunning) {
          const currentTotal = Date.now() - state.startTime + state.accumulated;
          const prevTotal = state.laps.length > 0 ? state.laps[state.laps.length - 1].totalTime : 0;
          state.laps.push({ lapTime: currentTotal - prevTotal, totalTime: currentTotal });
          FluxHubState.set(STATE_KEYS.ACTIVE_STOPWATCH, state);
          renderLaps();
        } else {
          FluxHubState.set(STATE_KEYS.ACTIVE_STOPWATCH, { isRunning: false, startTime: 0, accumulated: 0, laps: [] });
          this.execute();
        }
      }));
      btnSecondary.style.background = 'var(--omni-hover)';
      btnSecondary.style.color = 'var(--omni-accent-text)';
      if (isPristine) btnSecondary.style.display = 'none';
      actions.push(btnSecondary);

      const btnPrimary = applyFocus(FluxKit.ui.omni.Button(state.isRunning ? 'pause' : 'play', state.isRunning ? 'Stop [Space]' : 'Start [Space]', e => {
        e.stopPropagation();
        if (state.isRunning) {
          state.accumulated += (Date.now() - state.startTime);
          state.isRunning = false;
        } else {
          state.startTime = Date.now();
          state.isRunning = true;
        }
        FluxHubState.set(STATE_KEYS.ACTIVE_STOPWATCH, state);
        this.execute();
      }));
      btnPrimary.style.background = state.isRunning ? 'var(--omni-danger)' : 'var(--omni-success)';
      btnPrimary.style.color = 'var(--omni-btn-text)';
      actions.push(btnPrimary);

      if (state.isRunning) {
        const tickFn = (now) => {
          if (!swDisplay.isConnected) return this.tickSubscribers.delete(tickFn);
          swDisplay.innerHTML = safeHTML(this.formatStopwatchTime(now - state.startTime + state.accumulated));
        };
        this.tickSubscribers.add(tickFn);
      }

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    renderPomodoroTool(data) {
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', fontFamily: 'var(--omni-font)' } });

      const phaseBadgeContainer = createHTMLElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } });
      const modes = [
        { id: 'focus', label: `🎯 Focus (${data.config.focusMin}m)` },
        { id: 'shortBreak', label: `☕ Short Break (${data.config.shortBreakMin}m)` },
        { id: 'longBreak', label: `🌴 Long Break (${data.config.longBreakMin}m)` }
      ];

      modes.forEach(m => {
        const isActive = data.mode === m.id;
        const badge = createHTMLElement('div', {
          textContent: m.label,
          style: {
            padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: '600',
            cursor: data.status === 'running' ? 'not-allowed' : 'pointer',
            background: isActive ? 'var(--omni-accent)' : 'var(--omni-hover)',
            color: isActive ? 'var(--omni-btn-text)' : 'var(--omni-muted)',
            opacity: isActive ? '1' : '0.7', transition: 'all 0.15s ease'
          },
          eventListener: (e) => {
            e.stopPropagation();
            if (data.status === 'running' || isActive) return;
            data.mode = m.id; data.status = 'idle';
            data.remainingMs = (data.mode === 'shortBreak' ? data.config.shortBreakMin : data.mode === 'longBreak' ? data.config.longBreakMin : data.config.focusMin) * 60000;
            FluxHubState.set(STATE_KEYS.ACTIVE_POMODORO, data);
            this.execute();
          }
        });
        phaseBadgeContainer.appendChild(badge);
      });
      container.appendChild(phaseBadgeContainer);

      const interval = data.config.longBreakInterval || 4;
      const completedInCycle = data.completedFocusCount % interval;
      let tomatoes = '';
      for (let i = 0; i < interval; i++) tomatoes += i < completedInCycle ? '🍅 ' : '⚪ ';

      container.appendChild(createHTMLElement('div', { style: { fontSize: '13px', color: 'var(--omni-muted)', marginBottom: '8px', fontWeight: '500' }, textContent: `Session ${completedInCycle + 1}/${interval}  (${tomatoes.trim()})` }));

      let currentRemaining = data.status === 'running' ? Math.max(0, data.endsAt - Date.now()) : data.remainingMs;

      const pomoDisplay = createHTMLElement('div', { textContent: this.formatTimeLeft(currentRemaining),
        style: { fontSize: '64px', fontWeight: 'bold', color: 'var(--omni-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: '2px', margin: '4px 0' },
      });
      this.nodes.pomoDisplay = pomoDisplay;
      container.appendChild(pomoDisplay);

      const actions = [];
      const applyFocus = el => { el.setAttribute('tabindex', '0'); return el; };

      const isPristine = data.status === 'idle' && data.completedFocusCount === 0 && data.mode === 'focus';

      const resetBtn = applyFocus(FluxKit.ui.omni.Button('refresh', 'Reset [R]', (e) => {
        e.stopPropagation();
        FluxHubState.delete(STATE_KEYS.ACTIVE_POMODORO);
        this.execute();
      }));
      resetBtn.style.background = 'var(--omni-hover)';
      resetBtn.style.color = 'var(--omni-accent-text)';
      if (!isPristine) actions.push(resetBtn);

      const skipBtn = applyFocus(FluxKit.ui.omni.Button('next', 'Skip [S]', (e) => {
        e.stopPropagation();
        if (data.mode === 'focus') {
          data.completedFocusCount += 1;
          data.mode = (data.completedFocusCount % interval === 0) ? 'longBreak' : 'shortBreak';
        } else { data.mode = 'focus'; }
        data.status = 'idle';
        data.remainingMs = (data.mode === 'shortBreak' ? data.config.shortBreakMin : data.mode === 'longBreak' ? data.config.longBreakMin : data.config.focusMin) * 60000;
        FluxHubState.set(STATE_KEYS.ACTIVE_POMODORO, data);
        this.execute();
      }));
      skipBtn.style.background = 'var(--omni-hover)';
      skipBtn.style.color = 'var(--omni-accent-text)';
      actions.push(skipBtn);

      const primaryBtn = applyFocus(FluxKit.ui.omni.Button(data.status === 'running' ? 'pause' : 'play', data.status === 'running' ? 'Pause [Space]' : 'Start [Space]', (e) => {
        e.stopPropagation();
        if (data.status === 'running') {
          data.remainingMs = Math.max(0, data.endsAt - Date.now());
          data.status = 'paused';
        } else {
          data.endsAt = Date.now() + data.remainingMs;
          data.status = 'running';
        }
        FluxHubState.set(STATE_KEYS.ACTIVE_POMODORO, data);
        this.execute();
      }));
      primaryBtn.style.background = data.status === 'running' ? 'var(--omni-warning)' : 'var(--omni-success)';
      primaryBtn.style.color = 'var(--omni-btn-text)';
      actions.push(primaryBtn);

      if (data.status === 'running') {
        const tickFn = (now) => {
          if (!pomoDisplay.isConnected) return this.tickSubscribers.delete(tickFn);
          const rem = data.endsAt - now;
          if (rem <= 0) {
            this.tickSubscribers.delete(tickFn);
            try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0.3, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8); osc.start(); osc.stop(ctx.currentTime + 0.8); } catch(e){}

            if (data.mode === 'focus') { data.completedFocusCount += 1; data.mode = (data.completedFocusCount % interval === 0) ? 'longBreak' : 'shortBreak'; }
            else data.mode = 'focus';

            data.status = 'idle';
            data.remainingMs = (data.mode === 'shortBreak' ? data.config.shortBreakMin : data.mode === 'longBreak' ? data.config.longBreakMin : data.config.focusMin) * 60000;
            FluxHubState.set(STATE_KEYS.ACTIVE_POMODORO, data);
            this.execute();
            FluxKit.ui.showNotification(data.mode === 'focus' ? '🎯 Back to Work!' : '☕ Break Time!', { duration: 4000 });
          } else { pomoDisplay.textContent = this.formatTimeLeft(rem); }
        };
        this.tickSubscribers.add(tickFn);
      }

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    renderEpochTool(data) {
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px', fontFamily: 'var(--omni-font)' } });

      const liveBox = createHTMLElement('div', { style: { background: 'var(--omni-input-bg)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--omni-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
      liveBox.appendChild(createHTMLElement('span', { textContent: 'Current Epoch (Now):', style: { fontSize: '12px', color: 'var(--omni-muted)', fontWeight: '600' } }));
      const liveEpochNum = createHTMLElement('span', { style: { fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--omni-accent)', fontSize: '14px' } });
      liveBox.appendChild(liveEpochNum);
      container.appendChild(liveBox);

      const tickFn = (now) => {
        if (!liveEpochNum.isConnected) return this.tickSubscribers.delete(tickFn);
        liveEpochNum.textContent = Math.floor(now / 1000);
      };
      this.tickSubscribers.add(tickFn);

      const inputWrapper = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
      inputWrapper.appendChild(createHTMLElement('span', { textContent: 'Timestamp (Seconds or Milliseconds)', style: { fontSize: '12px', color: 'var(--omni-muted)', fontWeight: '600' } }));
      const epochInput = createHTMLElement('input', {
        type: 'text', value: data.timestamp,
        style: { width: '100%', padding: '10px 12px', borderRadius: '6px', background: 'var(--omni-input-bg)', border: '1px solid var(--omni-border)', color: 'var(--omni-text)', fontFamily: 'monospace', fontSize: '14px', outline: 'none' },
        eventListener: { input: (e) => updateConversion(e.target.value.trim()) }
      });
      inputWrapper.appendChild(epochInput);
      container.appendChild(inputWrapper);

      const resultsGrid = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--omni-bg-light)', padding: '12px', borderRadius: '8px', border: '1px solid var(--omni-border)' } });
      const createRow = (label) => {
        const row = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', alignItems: 'center' } });
        row.appendChild(createHTMLElement('span', { textContent: label, style: { color: 'var(--omni-muted)' } }));
        const val = createHTMLElement('span', { style: { fontWeight: '500', color: 'var(--omni-accent)', fontFamily: 'monospace' } });
        row.appendChild(val);
        resultsGrid.appendChild(row);
        return val;
      };

      const utcVal = createRow('UTC Time:');
      const localVal = createRow('Local Time:');
      const isoVal = createRow('ISO 8601:');
      container.appendChild(resultsGrid);

      const updateConversion = (rawVal) => {
        let num = Number(rawVal);
        if (isNaN(num)) { utcVal.textContent = 'Invalid timestamp'; localVal.textContent = '-'; isoVal.textContent = '-'; return; }
        if (num < 1e12) num *= 1000;
        const date = new Date(num);
        if (isNaN(date.getTime())) { utcVal.textContent = 'Date out of range'; localVal.textContent = '-'; isoVal.textContent = '-'; return; }
        utcVal.textContent = date.toUTCString();
        localVal.textContent = date.toLocaleString();
        isoVal.textContent = date.toISOString();
      };
      updateConversion(epochInput.value);

      return FluxKit.ui.omni.DetailCard(container, [ FluxKit.ui.omni.Button('copy', 'Copy Current Epoch', (e) => { e.stopPropagation(); navigator.clipboard.writeText(Math.floor(Date.now() / 1000).toString()); }) ]);
    }

    renderClockTool(data) {
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0', fontFamily: 'var(--omni-font)' } });
      if (data.error) {
        container.appendChild(createHTMLElement('div', { style: { color: 'var(--omni-danger)' }, textContent: `Could not locate timezone for "${data.city}"` }));
        return FluxKit.ui.omni.DetailCard(container, []);
      }
      container.appendChild(createHTMLElement('div', { style: { fontSize: '20px', fontWeight: 'bold', color: 'var(--omni-muted)', textTransform: 'uppercase' }, textContent: data.city }));
      const timeDisplay = createHTMLElement('div', { style: { fontSize: '56px', fontWeight: 'bold', color: 'var(--omni-text)', fontVariantNumeric: 'tabular-nums', marginTop: '8px' } });
      const dateDisplay = createHTMLElement('div', { style: { fontSize: '15px', color: 'var(--omni-muted)', marginTop: '4px' } });
      container.appendChild(timeDisplay);
      container.appendChild(dateDisplay);

      const tickFn = (now) => {
        if (!timeDisplay.isConnected) return this.tickSubscribers.delete(tickFn);
        const d = new Date(now);
        timeDisplay.textContent = d.toLocaleTimeString('en-US', { timeZone: data.tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        dateDisplay.textContent = d.toLocaleDateString('en-US', { timeZone: data.tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      };
      this.tickSubscribers.add(tickFn);

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    handleKeydown(e) {
      if (e.key === 'Enter') {
        const active = e.composedPath()[0];
        if (active && active.tagName === 'BUTTON') { e.preventDefault(); e.stopPropagation(); active.click(); return true; }
      }

      if (this.activeTool === 'stopwatch' && this.nodes.swDisplay) {
        const state = FluxHubState.get(STATE_KEYS.ACTIVE_STOPWATCH, { isRunning: false, startTime: 0, accumulated: 0, laps: [] });

        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault(); e.stopPropagation(); document.activeElement.blur();
          if (state.isRunning) {
            state.accumulated += (Date.now() - state.startTime);
            state.isRunning = false;
          } else {
            state.startTime = Date.now();
            state.isRunning = true;
          }
          FluxHubState.set(STATE_KEYS.ACTIVE_STOPWATCH, state);
          this.execute();
          return true;
        }

        if ((e.key === 'l' || e.key === 'L' || e.key === 'r' || e.key === 'R') && (state.isRunning || state.accumulated > 0)) {
          e.preventDefault(); e.stopPropagation();
          if (state.isRunning) {
            const lapTime = (Date.now() - state.startTime + state.accumulated) - (state.laps.length > 0 ? state.laps[state.laps.length - 1].totalTime : 0);
            state.laps.push({ lapTime, totalTime: Date.now() - state.startTime + state.accumulated });
            FluxHubState.set(STATE_KEYS.ACTIVE_STOPWATCH, state);
            this.execute();
          } else {
            FluxHubState.set(STATE_KEYS.ACTIVE_STOPWATCH, { isRunning: false, startTime: 0, accumulated: 0, laps: [] });
            this.execute();
          }
          return true;
        }
      }

      if (this.activeTool === 'pomodoro' && this.nodes.pomoDisplay) {
        const active = e.composedPath()[0];
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return false;

        const state = FluxHubState.get(STATE_KEYS.ACTIVE_POMODORO, this.getDefaultPomodoroState());

        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault(); e.stopPropagation();
          if (state.status === 'running') { state.remainingMs = Math.max(0, state.endsAt - Date.now()); state.status = 'paused'; }
          else { state.endsAt = Date.now() + state.remainingMs; state.status = 'running'; }
          FluxHubState.set(STATE_KEYS.ACTIVE_POMODORO, state); this.execute(); return true;
        }

        if (e.key.toLowerCase() === 's') {
          e.preventDefault(); e.stopPropagation();
          const interval = state.config.longBreakInterval || 4;
          if (state.mode === 'focus') {
            state.completedFocusCount += 1;
            state.mode = (state.completedFocusCount % interval === 0) ? 'longBreak' : 'shortBreak';
          } else { state.mode = 'focus'; }
          state.status = 'idle';
          state.remainingMs = (state.mode === 'shortBreak' ? state.config.shortBreakMin : state.mode === 'longBreak' ? state.config.longBreakMin : state.config.focusMin) * 60000;
          FluxHubState.set(STATE_KEYS.ACTIVE_POMODORO, state);
          this.execute(); return true;
        }

        if (e.key.toLowerCase() === 'r') {
          e.preventDefault(); e.stopPropagation();
          FluxHubState.delete(STATE_KEYS.ACTIVE_POMODORO);
          this.execute(); return true;
        }
      }
      return false;
    }

    async execute() {
      const data = await this.fetchData();
      if (data.tool === 'timer' && data.payload && data.payload.action === 'start') {
        FluxHubState.set(STATE_KEYS.ACTIVE_TIMER, { endsAt: Date.now() + data.payload.ms, label: data.payload.label, hostTab: FluxKit.ipc.getTabId() });
        FluxHub.ui.setInputVal('> timer');
      } else { FluxHub.ui.expandListItem(this, data); }
    }

    static async getWidgetState() {
      const states = [];

      const timer = FluxHubState.get(STATE_KEYS.ACTIVE_TIMER, null);
      if (timer) states.push({ tool: 'timer', payload: timer });

      const sw = FluxHubState.get(STATE_KEYS.ACTIVE_STOPWATCH, null);
      if (sw && (sw.isRunning || sw.accumulated > 0 || (sw.laps && sw.laps.length > 0))) states.push({ tool: 'stopwatch', payload: sw });

      const pomo = FluxHubState.get(STATE_KEYS.ACTIVE_POMODORO, null);
      if (pomo && (pomo.status === 'running' || pomo.status === 'paused' || pomo.completedFocusCount > 0)) {
        if (!(pomo.mode === 'focus' && pomo.status === 'idle' && pomo.completedFocusCount === 0)) states.push({ tool: 'pomodoro', payload: pomo });
      }

      return states.length > 0 ? states : null;
    }

    async renderWidget(paramsArray) {
      if (!Array.isArray(paramsArray)) paramsArray = [paramsArray];
      if (paramsArray.length === 0) return null;

      const widgetWrapper = createHTMLElement('div', { class: 'flx-omni-widget-group', style: { display: 'flex', gap: '12px', width: '100%', flexWrap: 'wrap' } });

      for (let params of paramsArray) {
        let node = null;

        if (params.tool === 'timer') {
          node = createHTMLElement('div', { class: 'flx-omni-widget', style: { alignItems: 'center', cursor: 'pointer', flex: '1' }, eventListener: () => FluxHub.ui.setInputVal('> timer') });
          node.appendChild(createHTMLElement('div', { style: { fontSize: '11px', textTransform: 'uppercase', color: 'var(--omni-muted)', fontWeight: 'bold' }, textContent: params.payload.label || 'Timer' }));
          const display = createHTMLElement('div', { style: { fontSize: '32px', fontWeight: 'bold', color: 'var(--omni-text)', fontVariantNumeric: 'tabular-nums' } });
          node.appendChild(display);
          const i = setInterval(() => {
            if (!node.isConnected) return clearInterval(i);
            const r = params.payload.endsAt - Date.now();
            display.textContent = r <= 0 ? '00:00' : this.formatTimeLeft(r);
          }, 500);
        }
        else if (params.tool === 'stopwatch') {
          node = createHTMLElement('div', { class: 'flx-omni-widget', style: { alignItems: 'center', cursor: 'pointer', flex: '1' }, eventListener: () => FluxHub.ui.setInputVal('> sw') });
          node.appendChild(createHTMLElement('div', { style: { fontSize: '11px', textTransform: 'uppercase', color: 'var(--omni-muted)', fontWeight: 'bold' }, textContent: params.payload.isRunning ? '⏱️ Stopwatch (Run)' : '⏱️ Stopwatch (Pause)' }));
          const display = createHTMLElement('div', { style: { fontSize: '32px', fontWeight: 'bold', color: 'var(--omni-text)', fontVariantNumeric: 'tabular-nums' } });
          node.appendChild(display);
          const i = setInterval(() => {
            if (!node.isConnected) return clearInterval(i);
            display.innerHTML = safeHTML(this.formatStopwatchTime(params.payload.isRunning ? (Date.now() - params.payload.startTime + params.payload.accumulated) : params.payload.accumulated, false));
          }, 200);
        }
        else if (params.tool === 'pomodoro') {
          node = createHTMLElement('div', { class: 'flx-omni-widget', style: { alignItems: 'center', cursor: 'pointer', flex: '1' }, eventListener: () => FluxHub.ui.setInputVal('> pomo') });
          const labels = { focus: '🎯 Focus', shortBreak: '☕ Short Brk', longBreak: '🌴 Long Brk' };
          node.appendChild(createHTMLElement('div', { style: { fontSize: '11px', textTransform: 'uppercase', color: 'var(--omni-muted)', fontWeight: 'bold' }, textContent: labels[params.payload.mode] || 'Pomodoro' }));
          const display = createHTMLElement('div', { style: { fontSize: '32px', fontWeight: 'bold', color: 'var(--omni-text)', fontVariantNumeric: 'tabular-nums' } });
          node.appendChild(display);
          const i = setInterval(() => {
            if (!node.isConnected) return clearInterval(i);
            display.textContent = this.formatTimeLeft(params.payload.status === 'running' ? Math.max(0, params.payload.endsAt - Date.now()) : params.payload.remainingMs);
          }, 500);
        }
        else if (params.tool === 'clock') {
          node = createHTMLElement('div', { class: 'flx-omni-widget', style: { alignItems: 'center', cursor: 'pointer', flex: '1' }, eventListener: () => FluxHub.ui.setInputVal(`> clock ${params.payload.city}`) });
          node.appendChild(createHTMLElement('div', { style: { fontSize: '11px', textTransform: 'uppercase', color: 'var(--omni-muted)', fontWeight: 'bold' }, textContent: params.payload.city }));

          const display = createHTMLElement('div', { style: { fontSize: '26px', fontWeight: 'bold', color: 'var(--omni-text)', fontVariantNumeric: 'tabular-nums', marginTop: '4px' }, textContent: '...' });
          node.appendChild(display);

          const startClockTick = (tz) => {
            display.textContent = new Date().toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
            const i = setInterval(() => {
              if (!node.isConnected) return clearInterval(i);
              display.textContent = new Date().toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
            }, 1000);
          };

          if (params.payload.tz) {
            startClockTick(params.payload.tz);
          } else {
            this.getIANATimezone(params.payload.city).then(tz => {
              if (tz) startClockTick(tz);
              else display.textContent = 'Err';
            });
          }
        }

        if (node) widgetWrapper.appendChild(node);
      }
      return widgetWrapper;
    }

    destroy() { clearInterval(this.hubInterval); this.tickSubscribers.clear(); }
  }

  class ClipboardView extends BaseView {
    constructor(query, context = null) {
      super(query);
      this.isExpanded = false;
      this.subIndex = 0;
      this.itemNodes = [];
    }

    static isAvailable = true;

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (q === '> clip' || q === '> clipboard') return 100;
      if (/^>\s*(clip|clipboard)\s+.+$/i.test(q)) return 100;
      if ('> clipboard'.startsWith(q)) return 60;
      return 0;
    }

    getFilterTerm() {
      const match = /^>\s*(?:clip|clipboard)\s+(.+)$/i.exec(this.query.trim());
      return match ? match[1].trim() : '';
    }

    async fetchData() {
      const history = FluxHubState.get(STATE_KEYS.CLIP_HISTORY, []);
      const term = this.getFilterTerm();
      if (!term) return history;

      const lowerTerm = term.toLowerCase();
      return history.filter(text => text.toLowerCase().includes(lowerTerm));
    }

    renderListRow() {
      const term = this.getFilterTerm();
      return term
        ? FluxKit.ui.omni.ListRow('Clipboard History', 'copy', `Filtered: "${term}"`)
        : FluxKit.ui.omni.ListRow('Clipboard History', 'copy', 'View & Paste Recent Clips');
    }

    renderExpandedCard(history) {
      this.isExpanded = true; this.subIndex = 0; this.itemNodes = [];

      const modernFont = 'var(--omni-font)';

      const bodyContainer = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '340px', overflowY: 'auto', paddingRight: '4px' } });

      if (history.length === 0) {
        const term = this.getFilterTerm();
        bodyContainer.appendChild(createHTMLElement('div', {
          textContent: term ? `No clips matching "${term}".` : 'History is empty. Try copying some text first.',
          style: { padding: '16px', textAlign: 'center', color: 'var(--omni-muted)', fontSize: '13px' }
        }));
        return FluxKit.ui.omni.DetailCard(bodyContainer, []);
      }

      history.forEach((text, index) => {
        const row = createHTMLElement('div', {
          style: {
            padding: '12px 16px', background: 'var(--omni-bg-light)', borderRadius: '8px',
            border: '1px solid var(--omni-border)', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontFamily: modernFont, fontSize: '14px', color: 'var(--omni-text)',
            transition: 'border-color 0.15s ease, background 0.15s ease'
          },
          eventListener: {
            click: (e) => {
              e.stopPropagation();

              navigator.clipboard.writeText(text);

              let inserted = false;
              if (FluxHub.ui.activeContext) {
                try { inserted = FluxKit.capture.text.insertAtContext(text, FluxHub.ui.activeContext); }
                catch(err) {}
              }

              if (inserted === true) FluxHub.ui.hide();
              else {
                const lbl = e.currentTarget.querySelector('.copy-lbl');
                if (lbl) {
                  lbl.textContent = 'Copied!';
                  e.currentTarget.style.borderColor = 'var(--omni-info)';
                  setTimeout(() => FluxHub.ui.hide(), 800);
                }
              }
            },
            mouseenter: () => {
              this.subIndex = index;
              this.updateSubSelection();
            }
          }
        });

        const displayText = text.length > 80 ? text.substring(0, 80) + '...' : text;

        row.appendChild(createHTMLElement('div', { textContent: displayText, style: { opacity: '0.9', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingRight: '16px' } }));

        const lbl = createHTMLElement('div', { class: 'copy-lbl', icon: 'enter', textContent: 'Paste', style: { display: 'flex', gap: '4px', fontSize: '12px', fontWeight: 'bold', color: 'var(--omni-muted)', whiteSpace: 'nowrap' } });
        row.appendChild(lbl);

        this.itemNodes.push(row);
        bodyContainer.appendChild(row);
      });

      this.updateSubSelection();

      return FluxKit.ui.omni.DetailCard(bodyContainer, []);
    }

    updateSubSelection() {
      this.itemNodes.forEach((node, idx) => {
        if (idx === this.subIndex) {
          node.style.borderColor = 'var(--omni-muted)';
          node.style.background = 'var(--omni-hover)';
          node.scrollIntoView({ block: 'nearest' });
        } else {
          node.style.borderColor = 'var(--omni-border)';
          node.style.background = 'var(--omni-bg-light)';
        }
      });
    }

    handleKeydown(e) {
      if (!this.isExpanded || !this.itemNodes.length) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        this.subIndex = Math.min(this.subIndex + 1, this.itemNodes.length - 1);
        this.updateSubSelection();
        return true;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        this.subIndex = Math.max(this.subIndex - 1, 0);
        this.updateSubSelection();
        return true;
      }

      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (this.itemNodes[this.subIndex]) this.itemNodes[this.subIndex].click();
        return true;
      }

      return false;
    }

    async execute() {
      const data = await this.fetchData();
      if (data) FluxHub.ui.expandListItem(this, data);
      else {
        const index = FluxHub.ui.currentViews.indexOf(this);
        const row = FluxHub.ui.resultsList.children[index];
        if (row) {
          const subtitle = row.querySelector('.flx-omni-subtitle');
          if (subtitle) {
            subtitle.textContent = 'History is empty. Try copying some text first.';
            subtitle.style.color = 'var(--omni-warning)';
          }
        }
      }
    }

    destroy() { this.isExpanded = false; this.itemNodes = []; }
  }

  class UnitConverterView extends BaseView {
    static isAvailable = true;
    static commandRegistry = [{ prefix: '100 kg to lb', description: 'Convert physical units and live fiat/crypto currencies', icon: 'unit' }];

    static get units() {
      return {
        // Length (base: meter)
        m: { type: 'length', factor: 1, label: 'Meter (m)' }, 
        km: { type: 'length', factor: 1000, label: 'Kilometer (km)' }, cm: { type: 'length', factor: 0.01, label: 'Centimeter (cm)' }, 
        mm: { type: 'length', factor: 0.001, label: 'Millimeter (mm)' }, mi: { type: 'length', factor: 1609.34, label: 'Mile (mi)' }, 
        yd: { type: 'length', factor: 0.9144, label: 'Yard (yd)' }, ft: { type: 'length', factor: 0.3048, label: 'Foot (ft)' }, 
        in: { type: 'length', factor: 0.0254, label: 'Inch (in)' },
        // Area (base: m^2)
        m2: { type: 'area', factor: 1, label: 'Square Meter (m²)' },
        km2: { type: 'area', factor: 1e6, label: 'Square Kilometer (km²)' }, cm2: { type: 'area', factor: 1e-4, label: 'Square Centimeter (cm²)' },
        mm2: { type: 'area', factor: 1e-6, label: 'Square Millimeter (mm²)' }, ha: { type: 'area', factor: 1e4, label: 'Hectare (ha)' }, 
        acre: { type: 'area', factor: 4046.8564224, label: 'Acre' }, sqmi: { type: 'area', factor: 2589988.110336, label: 'Square Mile (sqmi)' }, 
        sqyd: { type: 'area', factor: 0.83612736, label: 'Square Yard (sqyd)' }, sqft: { type: 'area', factor: 0.09290304, label: 'Square Foot (sqft)' }, 
        sqin: { type: 'area', factor: 0.00064516, label: 'Square Inch (sqin)' },
        // Volume (base: m^3)
        m3: { type: 'volume', factor: 1, label: 'Cubic Meter (m³)' }, 
        cm3: { type: 'volume', factor: 1e-6, label: 'Cubic Centimeter (cm³)' }, mm3: { type: 'volume', factor: 1e-9, label: 'Cubic Millimeter (mm³)' }, 
        km3: { type: 'volume', factor: 1e9, label: 'Cubic Kilometer (km³)' }, l: { type: 'volume', factor: 0.001, label: 'Liter (L)' }, 
        ml: { type: 'volume', factor: 1e-6, label: 'Milliliter (ml)' }, ft3: { type: 'volume', factor: 0.028316846592, label: 'Cubic Foot (ft³)' }, 
        in3: { type: 'volume', factor: 0.000016387064, label: 'Cubic Inch (in³)' }, gal: { type: 'volume', factor: 0.003785411784, label: 'US Gallon (gal)' },
        qt:  { type: 'volume', factor: 0.000946352946, label: 'US Quart (qt)' }, pt:  { type: 'volume', factor: 0.000473176473, label: 'US Pint (pt)' },
        cup: { type: 'volume', factor: 0.0002365882365, label: 'US Cup' }, tbsp: { type: 'volume', factor: 0.00001478676478125, label: 'Tablespoon (tbsp)' }, 
        tsp: { type: 'volume', factor: 0.00000492892159375, label: 'Teaspoon (tsp)' }, imp_gal: { type: 'volume', factor: 0.00454609, label: 'Imperial Gallon' }, 
        imp_pt: { type: 'volume', factor: 0.00056826125, label: 'Imperial Pint' }, imp_qt: { type: 'volume', factor: 0.0011365225, label: 'Imperial Quart' }, 
        fl_oz: { type: 'volume', factor: 0.0000284130625, label: 'Fluid Ounce (fl oz)' },
        // Mass (base: gram)
        g: { type: 'mass', factor: 1, label: 'Gram (g)' }, 
        kg: { type: 'mass', factor: 1000, label: 'Kilogram (kg)' }, mg: { type: 'mass', factor: 0.001, label: 'Milligram (mg)' }, 
        lb: { type: 'mass', factor: 453.592, label: 'Pound (lb)' }, oz: { type: 'mass', factor: 28.3495, label: 'Ounce (oz)' },
        // Bytes (base: byte)
        b:  { type: 'bytes', factor: 1, label: 'Byte (B)' },
        kb: { type: 'bytes', factor: 1000, label: 'Kilobyte (KB)' }, mb: { type: 'bytes', factor: 1000 ** 2, label: 'Megabyte (MB)' },
        gb: { type: 'bytes', factor: 1000 ** 3, label: 'Gigabyte (GB)' }, tb: { type: 'bytes', factor: 1000 ** 4, label: 'Terabyte (TB)' },
        pb: { type: 'bytes', factor: 1000 ** 5, label: 'Petabyte (PB)' },
        kib: { type: 'bytes', factor: 1024, label: 'Kibibyte (KiB)' }, mib: { type: 'bytes', factor: 1024 ** 2, label: 'Mebibyte (MiB)' },
        gib: { type: 'bytes', factor: 1024 ** 3, label: 'Gibibyte (GiB)' }, tib: { type: 'bytes', factor: 1024 ** 4, label: 'Tebibyte (TiB)' },
        pib: { type: 'bytes', factor: 1024 ** 5, label: 'Pebibyte (PiB)' }
      };
    }

    static normalizeUnit(u) {
      let str = u.trim().toLowerCase().replaceAll('²', '2').replaceAll('³', '3');
      
      if (str.endsWith('s') && !['celsius', 'fps', 'bps', 'kib', 'mib', 'gib', 'tib'].includes(str)) {
        str = str.slice(0, -1);
      }

      const aliases = {
        // Length
        'meter': 'm', 'metre': 'm', 'kilometer': 'km', 'centimeter': 'cm', 'millimeter': 'mm', 
        'mile': 'mi', 'yard': 'yd', 'foot': 'ft', 'feet': 'ft', 'inch': 'in', 'inche': 'in',
        // Area
        'square meter': 'm2', 'sq meter': 'm2', 'square metre': 'm2', 'sq metre': 'm2', 'sqm': 'm2',
        'hectare': 'ha', 'yd2': 'sqyd', 'ft2': 'sqft', 'in2': 'sqin',
        // Mass 
        'lbs': 'lb', 'ounce': 'oz',
        // Volume
        'litre': 'l', 'liter': 'l', 
        'gallon': 'gal', 'us gallon': 'gal',
        'quart': 'qt', 'us quart': 'qt',
        'pint': 'pt', 'us pint': 'pt',
        'imperial gallon': 'imp_gal', 'imp gal': 'imp_gal', 'uk gallon': 'imp_gal', 'uk gal': 'imp_gal', 'imperial gal': 'imp_gal',  'imp gallon': 'imp_gal',
        'imperial pint': 'imp_pt', 'imp pint': 'imp_pt', 'uk pint': 'imp_pt', 'uk pt': 'imp_pt', 'imp pt': 'imp_pt', 'imperial pt': 'imp_pt',
        'imperial quart': 'imp_qt', 'imp quart': 'imp_qt', 'uk quart': 'imp_qt', 'uk qt': 'imp_qt', 'imp qa': 'imp_qt', 'imperial qt': 'imp_qt',
        'fluid ounce': 'fl_oz', 'fl oz': 'fl_oz',
        // Temperature
        'celsius': 'c', 'kelvin': 'k', 'fahrenheit': 'f'
      };
      
      return aliases[str] || str;
    }

    static resolveContext(from, to) {
      let f = from, t = to;
      const u = this.units;
      
      if (f === 'oz' && u[t]?.type === 'volume') f = 'fl_oz';
      if (t === 'oz' && u[f]?.type === 'volume') t = 'fl_oz';
      
      return { from: f, to: t };
    }

    static parseQuery(query) {
      const q = query.trim().toLowerCase();
      const match = q.match(/^([\d\.]+)\s+([a-z0-9_\-\s]+?)\s+(?:to|in)\s+([a-z0-9_\-\s]+)$/);
      if (!match) return null;
      return { amount: parseFloat(match[1]), from: this.normalizeUnit(match[2]), to: this.normalizeUnit(match[3]) };
    }

    static matchConfidence(query) {
      const parsed = this.parseQuery(query);
      if (!parsed) return 0;

      const ctx = this.resolveContext(parsed.from, parsed.to);

      if (['c', 'f', 'k'].includes(ctx.from) && ['c', 'f', 'k'].includes(ctx.to)) return 100;

      const fromUnit = this.units[ctx.from];
      const toUnit = this.units[ctx.to];
      if (fromUnit && toUnit && fromUnit.type === toUnit.type) return 100;

      if (!fromUnit && !toUnit && ctx.from.length >= 2 && ctx.to.length >= 2) return 85;

      return 0;
    }

    async compute(amount, fromRaw, toRaw) {
      let result = 0;
      let isLive = false;
      let rateProvider = '';
      let type = 'unknown';

      const baseFrom = this.constructor.normalizeUnit(fromRaw);
      const baseTo = this.constructor.normalizeUnit(toRaw);
      
      const ctx = this.constructor.resolveContext(baseFrom, baseTo);
      const from = ctx.from;
      const to = ctx.to;

      if (['c', 'f', 'k'].includes(from) && ['c', 'f', 'k'].includes(to)) {
        type = 'temperature';
        let celsius = 0;
        if (from === 'c') celsius = amount;
        else if (from === 'f') celsius = (amount - 32) * 5/9;
        else if (from === 'k') celsius = amount - 273.15;

        if (to === 'c') result = celsius;
        else if (to === 'f') result = (celsius * 9/5) + 32;
        else if (to === 'k') result = celsius + 273.15;
      } else if (this.constructor.units[from] && this.constructor.units[to]) {
        const fromUnit = this.constructor.units[from];
        const toUnit = this.constructor.units[to];
        type = fromUnit.type;
        const baseAmount = amount * fromUnit.factor;
        result = baseAmount / toUnit.factor;
      } else {
        isLive = true;
        type = 'currency';
        const fromCode = from.toUpperCase();
        const toCode = to.toUpperCase();
        const cacheKey = `rate_${fromCode}_${toCode}`;

        let cachedRate = await FluxHub.cache.get(cacheKey);
        let rate = cachedRate ? cachedRate.val : null;
        rateProvider = cachedRate ? cachedRate.provider : '';

        if (!rate) {
          const fetchApi = (url) => new Promise(resolve => {
            GM_xmlhttpRequest({
              method: 'GET', url, timeout: 4000,
              onload: r => { try { resolve(JSON.parse(r.responseText)); } catch(e) { resolve(null); } },
              onerror: () => resolve(null), ontimeout: () => resolve(null)
            });
          });

          const cbData = await fetchApi(`https://api.coinbase.com/v2/exchange-rates?currency=${fromCode}`);
          if (cbData?.data?.rates?.[toCode]) { rate = parseFloat(cbData.data.rates[toCode]); rateProvider = 'Coinbase'; }

          if (!rate) {
            const fData = await fetchApi(`https://api.frankfurter.app/latest?from=${fromCode}&to=${toCode}`);
            if (fData?.rates?.[toCode]) { rate = fData.rates[toCode]; rateProvider = 'Frankfurter'; }
          }

          if (rate) await FluxHub.cache.set(cacheKey, { val: rate, provider: rateProvider }, 15 * 60 * 1000);
          else return null;
        }
        result = amount * rate;
      }

      let finalResult;
      if (Number.isInteger(result)) { finalResult = result; }
      else if (Math.abs(result) < 0.001 && result !== 0) { finalResult = parseFloat(result.toPrecision(4)); }
      else { finalResult = parseFloat(result.toFixed(4)); }

      return { amount, from, to, result: finalResult, isLive, rateProvider, type };
    }

    async fetchData(signal) {
      const parsed = this.constructor.parseQuery(this.query);
      if (!parsed) return null;

      const data = await this.compute(parsed.amount, parsed.from, parsed.to);
      if (!data) return null;

      this.lastResult = data.result;
      this.parsed = parsed;
      return data;
    }

    renderListRow() {
      const isLive = this.parsed && !this.constructor.units[this.parsed.from] && !['c','f','k'].includes(this.parsed.from);
      return FluxKit.ui.omni.ListRow(this.lastResult !== undefined ? `${this.lastResult} ${this.parsed.to.toUpperCase()}` : 'Convert Values', isLive ? 'currency' : 'unit', this.query, 'to Copy');
    }

    renderExpandedCard(data) {
      let currentData = { ...data };

      const displayContainer = FluxKit.utils.createHTMLElement('div', { 
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0', fontFamily: 'monospace', width: '100%' } 
      });

      const mathRow = FluxKit.utils.createHTMLElement('div', { 
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', width: '100%', transition: 'all 0.3s ease' } 
      });

      const statusText = FluxKit.utils.createHTMLElement('div', { 
        textContent: currentData.isLive ? `Live rates via ${currentData.rateProvider}` : '',
        style: { fontSize: '11px', color: 'var(--omni-muted)', marginTop: '12px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', height: '16px' }
      });

      const getOptionsForType = (type) => {
        if (type === 'temperature') return [{val: 'c', label: 'Celsius (°C)'}, {val: 'f', label: 'Fahrenheit (°F)'}, {val: 'k', label: 'Kelvin (K)'}];
        if (type === 'currency') return []; 
        const options = [];
        const seen = new Set();
        for (const [key, obj] of Object.entries(this.constructor.units)) {
          if (obj.type === type) {
            const label = obj.label || key.toUpperCase();
            if (!seen.has(label)) {
              seen.add(label);
              options.push({ val: key, label });
            }
          }
        }
        return options.sort((a,b) => a.label.localeCompare(b.label));
      };

      const createInlineSelect = (currentVal, type, isLarge, onChange) => {
        const opts = getOptionsForType(type);
        const shortText = currentVal.toUpperCase().replace('_', ' ');

        if (opts.length === 0) {
          return FluxKit.utils.createHTMLElement('div', { 
            textContent: shortText, 
            style: { fontSize: isLarge ? '42px' : '28px', fontWeight: isLarge ? 'bold' : 'normal', color: isLarge ? 'var(--omni-text)' : 'var(--omni-muted)' } 
          });
        }

        const wrap = FluxKit.utils.createHTMLElement('div', { style: { position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } });

        const display = FluxKit.utils.createHTMLElement('div', {
          textContent: shortText,
          style: { 
            fontSize: isLarge ? '42px' : '28px', fontWeight: isLarge ? 'bold' : 'normal', 
            color: isLarge ? 'var(--omni-text)' : 'var(--omni-muted)', textAlign: 'center', 
            textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '6px', textDecorationThickness: '2px',
            pointerEvents: 'none', whiteSpace: 'nowrap'
          }
        });

        const sel = FluxKit.utils.createHTMLElement('select', {
          style: { position: 'absolute', inset: '0', opacity: '0', cursor: 'pointer', width: '100%', height: '100%', appearance: 'none' },
          eventListener: { change: (e) => onChange(e.target.value) }
        });

        opts.forEach(o => {
          const isSelected = o.val === currentVal || o.val === this.constructor.normalizeUnit(currentVal);
          sel.appendChild(FluxKit.utils.createHTMLElement('option', { value: o.val, textContent: o.label, selected: isSelected, style: { fontSize: '14px', background: 'var(--omni-bg)', color: 'var(--omni-text)' } }));
        });
        
        wrap.appendChild(display);
        wrap.appendChild(sel);
        return wrap;
      };

      let leftValNode, rightValNode, swapBtnNode, leftWrap, rightWrap;

      const evaluateLayout = () => {
        const totalChars = String(currentData.amount).length + String(currentData.result).length;
        const isVertical = totalChars > 13;
        mathRow.style.flexDirection = isVertical ? 'column' : 'row';
        mathRow.style.gap = isVertical ? '12px' : '24px';
        if (swapBtnNode) swapBtnNode.style.transform = isVertical ? 'rotate(90deg)' : 'none';
      };

      const renderMathRow = () => {
        mathRow.innerHTML = '';
        
        leftWrap = FluxKit.utils.createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
        
        leftValNode = FluxKit.utils.createHTMLElement('span', { 
          textContent: currentData.amount, contentEditable: 'true', spellcheck: 'false',
          style: { fontSize: '28px', color: 'var(--omni-muted)', outline: 'none', borderBottom: '2px dashed var(--omni-separator)', minWidth: '1ch', display: 'inline-block', padding: '0 2px', transition: 'color 0.2s' },
          eventListener: {
            input: async (e) => {
              const val = parseFloat(e.target.textContent);
              if (isNaN(val)) return;
              currentData.amount = val;
              const newData = await this.compute(val, currentData.from, currentData.to);
              if (newData) {
                currentData.result = newData.result;
                this.lastResult = newData.result;
                if (rightValNode) rightValNode.textContent = newData.result;
                evaluateLayout();
              }
            },
            keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
            focus: (e) => { e.target.style.color = 'var(--omni-text)'; },
            blur: (e) => { e.target.style.color = 'var(--omni-muted)'; }
          }
        });
        
        leftWrap.appendChild(leftValNode);
        leftWrap.appendChild(createInlineSelect(currentData.from, currentData.type, false, async (newFrom) => {
           mathRow.style.opacity = '0.5';
           const newData = await this.compute(currentData.amount, newFrom, currentData.to);
           if (newData) { currentData = newData; this.lastResult = newData.result; renderMathRow(); }
           mathRow.style.opacity = '1';
        }));

        swapBtnNode = FluxKit.utils.createHTMLElement('div', {
          icon: 'swap', fluxHubTooltip: 'Swap Units',
          style: { fontSize: '20px', color: 'var(--omni-separator)', cursor: 'pointer', padding: '8px', borderRadius: '50%', transition: 'all 0.3s ease', display: 'flex' },
          eventListener: {
            click: async () => {
              mathRow.style.opacity = '0.5';
              const newData = await this.compute(currentData.amount, currentData.to, currentData.from);
              if (newData) { currentData = newData; this.lastResult = newData.result; renderMathRow(); }
              mathRow.style.opacity = '1';
            },
            mouseenter: (e) => { e.target.style.background = 'var(--omni-hover)'; e.target.style.color = 'var(--omni-text)'; },
            mouseleave: (e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--omni-separator)'; }
          }
        });

        rightWrap = FluxKit.utils.createHTMLElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } });
        
        rightValNode = FluxKit.utils.createHTMLElement('span', { 
          textContent: currentData.result, contentEditable: 'true', spellcheck: 'false',
          style: { fontSize: '42px', fontWeight: 'bold', color: 'var(--omni-text)', outline: 'none', borderBottom: '2px dashed var(--omni-separator)', minWidth: '1ch', display: 'inline-block', padding: '0 4px', transition: 'color 0.2s' },
          eventListener: {
            input: async (e) => {
              const val = parseFloat(e.target.textContent);
              if (isNaN(val)) return;
              currentData.result = val;
              this.lastResult = val; 
              const reverseData = await this.compute(val, currentData.to, currentData.from);
              if (reverseData) {
                currentData.amount = reverseData.result;
                if (leftValNode) leftValNode.textContent = reverseData.result;
                evaluateLayout();
              }
            },
            keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
            focus: (e) => { e.target.style.color = 'var(--omni-accent-text)'; },
            blur: (e) => { e.target.style.color = 'var(--omni-text)'; }
          }
        });

        rightWrap.appendChild(rightValNode);
        rightWrap.appendChild(createInlineSelect(currentData.to, currentData.type, true, async (newTo) => {
           mathRow.style.opacity = '0.5';
           const newData = await this.compute(currentData.amount, currentData.from, newTo);
           if (newData) { currentData = newData; this.lastResult = newData.result; renderMathRow(); }
           mathRow.style.opacity = '1';
        }));

        mathRow.appendChild(leftWrap);
        mathRow.appendChild(swapBtnNode);
        mathRow.appendChild(rightWrap);
        
        evaluateLayout();
      };

      renderMathRow();
      displayContainer.appendChild(mathRow);
      displayContainer.appendChild(statusText);

      const copyBtn = FluxKit.ui.omni.Button('copy', 'Copy Result', (e) => { e.stopPropagation(); this.execute(); });

      copyBtn.setAttribute('tabindex', '0');
      copyBtn.addEventListener('focus', () => { copyBtn.style.boxShadow = '0 0 0 2px var(--omni-muted)' });
      copyBtn.addEventListener('blur', () => { copyBtn.style.boxShadow = 'none' });

      return FluxKit.ui.omni.DetailCard(displayContainer, [copyBtn]);
    }

    handleKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        this.execute();
        return true;
      }
      return false;
    }

    execute() {
      if (this.lastResult !== undefined) {
        navigator.clipboard.writeText(this.lastResult.toString());
        FluxHub.ui.hide();
      }
    }
  }

  class BangView extends BaseView {
    static get bangs() {
      const defaults = {
        '@yt': { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=', base: 'https://www.youtube.com', icon: 'video' },
        '@reddit': { name: 'Reddit', url: 'https://www.reddit.com/search/?q=', base: 'https://www.reddit.com', icon: 'reddit' },
        '@maps': { name: 'Google Maps', url: 'https://www.google.com/maps/search/', base: 'https://www.google.com/maps', icon: 'location' },
        '@g': { name: 'Google', url: 'https://www.google.com/search?q=', base: 'https://www.google.com', icon: 'google' },
        '@gh': { name: 'GitHub', url: 'https://github.com/search?q=', base: 'https://github.com', icon: 'code' },
      };
      const custom = BangsState.getAll();
      return { ...defaults, ...custom };
    }

    static get isAvailable() { return typeof GM_openInTab !== 'undefined'; }

    static matchConfidence(query) {
      const clean = query.trim().toLowerCase();
      if (!clean.startsWith('@')) return 0;
      const bang = clean.split(' ')[0];
      if (this.bangs[bang]) return 100;
      const isPartial = Object.keys(this.bangs).some(b => b.startsWith(bang));
      return isPartial ? 60 : 0;
    }

    renderListRow() {
      const parts = this.query.trim().split(' ');
      const bang = parts[0].toLowerCase();
      const searchTerm = parts.slice(1).join(' ');
      const config = this.constructor.bangs[bang];

      const title = searchTerm ? `Search ${config.name} for "${searchTerm}"` : `Open ${config.name}`;
      return FluxKit.ui.omni.ListRow(title, config.icon, 'Web Search', 'to Open Tab');
    }

    execute() {
      const parts = this.query.trim().split(' ');
      const bang = parts[0].toLowerCase();
      const searchTerm = parts.slice(1).join(' ');
      const config = this.constructor.bangs[bang];

      const url = searchTerm ? config.url + encodeURIComponent(searchTerm) : config.base;

      GM_openInTab(url, { active: true, insert: true, setParent: true });
      FluxHub.ui.hide();
    }
  }

  class GoogleFallbackView extends BaseView {
    static get isAvailable() { return typeof GM_openInTab !== 'undefined'; }

    static matchConfidence(query) { return query.trim().length > 0 ? 50 : 0; }

    renderListRow() { return FluxKit.ui.omni.ListRow(`Search Google for "${this.query.trim()}"`, 'google', 'Web Search', 'to Open'); }

    execute() {
      const url = `https://www.google.com/search?q=${encodeURIComponent(this.query.trim())}`;
      GM_openInTab(url, { active: true, insert: true, setParent: true });
      FluxHub.ui.hide();
    }
  }

  class DictionaryView extends BaseView {
    static isAvailable = true;

    static matchConfidence(query) {
      const clean = query.trim();
      if (!clean) return 0;

      const lower = clean.toLowerCase();
      const isExplicit = lower.startsWith('> def ') || lower.startsWith('> define ');

      if (isExplicit) {
        const word = clean.replace(/^>\s*(def|define)\s+/i, '').trim();
        if (word && (word.includes(' ') || word.length >= 25)) return 60;
        return 100;
      }

      if (!clean.includes(' ') && clean.length < 25 && /^[a-zA-Z]+$/.test(clean)) return 80;

      return 0;
    }

    async fetchData(signal) {
      const word = this.query.trim().replace(/^>\s*(def|define)\s+/i, '').trim().toLowerCase();
      const cacheKey = `dict_en_${word}`;

      const cached = await FluxHub.cache.get(cacheKey);
      if (cached) return cached;

      try {
        const dictData = await FluxKit.api.dictionary.fetch(word, 'en', signal);
        if (!dictData) return null;
        if (signal && signal.aborted) return null;

        const synonyms = await FluxKit.api.thesaurus.fetch(word, 'syn', 5, signal);
        const antonyms = await FluxKit.api.thesaurus.fetch(word, 'ant', 5, signal);

        const finalData = { ...dictData, synonyms, antonyms };
        await FluxHub.cache.set(cacheKey, finalData);
        return finalData;
      } catch (err) { return null; }
    }

    renderListRow() {
      const word = this.query.trim().replace(/^>\s*(def|define)\s+/i, '').trim();
      return FluxKit.ui.omni.ListRow(`Define "${word}"`, 'book', 'Dictionary Lookup');
    }

    renderExpandedCard(data) {
      this.isExpanded = true;
      this.expandedData = data;

      const audioUrl = this.extractAudioUrl(data);

      const modernFont = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

      const firstMeaning = data.meanings && data.meanings[0];
      const primaryPos = firstMeaning ? firstMeaning.partOfSpeech : '';
      const primaryDef = firstMeaning && firstMeaning.definitions[0] ? firstMeaning.definitions[0].definition : 'Definition not found.';

      const createPillContainer = (synList = [], antList = []) => {
        const createPill = (text, isSyn) => {
          return createHTMLElement('span', { textContent: text,
            style: {
              background: isSyn ? 'color-mix(in srgb, var(--omni-info) 15%, transparent)' : 'color-mix(in srgb, var(--omni-danger) 15%, transparent)',
              color: isSyn ? 'var(--omni-info)' : 'var(--omni-danger)',
              padding: '4px 10px', borderRadius: '6px',
              fontSize: '13px', fontWeight: '600',
              marginRight: '6px', marginBottom: '6px',
              display: 'inline-block', fontFamily: modernFont,
            }
          });
        }

        const pills = [];
        synList.slice(0, 5).forEach(s => pills.push(createPill(s, true)));
        antList.slice(0, 5).forEach(a => pills.push(createPill(a, false)));

        return pills.length ? createHTMLElement('div', { style: { marginTop: '8px' }, children: pills }) : null;
      };

      const speakerBtn = createHTMLElement('button', {
        icon: 'speaker', fluxHubTooltip: 'Listen',
        style: {
          background: 'transparent', border: 'none', padding: '2px',
          cursor: 'pointer', color: 'var(--omni-muted)', display: 'inline-flex',
          alignItems: 'center', opacity: '0.8', transition: 'opacity 0.2s',
        },
        eventListener: e => {
          e.stopPropagation();
          FluxKit.capture.speech.speak(data.word, { lang: 'en', audioUrl: audioUrl });
        },
      });

      const headerNode = createHTMLElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', fontFamily: modernFont },
        children: [
          createHTMLElement('span', { style: { fontSize: '28px', fontWeight: 'bold' }, textContent: data.word }),
          speakerBtn,
          createHTMLElement('span', { style: { fontSize: '15px', fontWeight: '600', color: 'var(--omni-muted)' }, textContent: primaryPos }),
          data.phonetic ? createHTMLElement('span', { style: { fontSize: '15px', opacity: '0.6' }, textContent: data.phonetic }) : null,
        ],
      });

      const defNode = createHTMLElement('div', { style: { fontSize: '18px', lineHeight: '1.6', fontFamily: modernFont }, textContent: primaryDef });

      let globalSyn = data.synonyms?.length ? data.synonyms : firstMeaning?.synonyms || [];
      let globalAnt = data.antonyms?.length ? data.antonyms : firstMeaning?.antonyms || [];
      const globalPills = createPillContainer(globalSyn, globalAnt);

      const extendedChildren = [];
      if (data.meanings && data.meanings.length > 0) {
        data.meanings.forEach(meaning => {
          const defLis = meaning.definitions.slice(0, 3).map(defObj => {
            const liChildren = [document.createTextNode(defObj.definition)];

            if (defObj.example) {
              liChildren.push(
                createHTMLElement('div', { style: { opacity: '0.7', fontStyle: 'italic', marginTop: '6px', fontSize: '15px' }, textContent: `"${defObj.example}"` }),
              );
            }

            const localPills = createPillContainer(defObj.synonyms, defObj.antonyms);
            if (localPills) liChildren.push(localPills);

            return createHTMLElement('li', { style: { marginBottom: '12px' }, children: liChildren });
          });

          extendedChildren.push(
            createHTMLElement('div', { style: { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--omni-separator)', fontFamily: modernFont },
              children: [
                createHTMLElement('div', { style: { fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--omni-muted)', letterSpacing: '1px', marginBottom: '10px' }, textContent: meaning.partOfSpeech }),
                createPillContainer(meaning.synonyms, meaning.antonyms),
                createHTMLElement('ul', { style: { margin: '12px 0 0 0', paddingLeft: '20px', fontSize: '16px', lineHeight: '1.6', opacity: '0.9' }, children: defLis }),
              ],
            }),
          );
        });
      }

      const extendedView = createHTMLElement('div', { style: { display: 'none', marginTop: '12px' }, children: extendedChildren });

      const bodyContainer = createHTMLElement('div', { children: [headerNode, defNode, globalPills, extendedView] });

      const actions = [];
      if (data.meanings && data.meanings.length > 0) {
        let isExpanded = false;
        const toggleBtn = FluxKit.ui.omni.Button(
          'listUl', 'Show more definitions...',
          e => {
            e.stopPropagation();
            isExpanded = !isExpanded;
            extendedView.style.display = isExpanded ? 'block' : 'none';

            const labelSpan = toggleBtn.querySelector('.flx-omni-btn-label');
            if (labelSpan) labelSpan.textContent = isExpanded ? 'Show less' : 'Show more definitions...';

            if (!isExpanded) headerNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          },
        );

        toggleBtn.style.width = '100%';
        toggleBtn.style.justifyContent = 'center';
        toggleBtn.style.fontFamily = modernFont;
        actions.push(toggleBtn);
      }

      return FluxKit.ui.omni.DetailCard(bodyContainer, actions);
    }

    extractAudioUrl(dictData) {
      if (!dictData.phonetics || !Array.isArray(dictData.phonetics)) return null;
      const found = dictData.phonetics.find(p => p.audio && p.audio.trim() !== '');
      return found ? found.audio : null;
    }

    async execute() {
      if (this.isExpanded && this.expandedData) {
        const audioUrl = this.extractAudioUrl(this.expandedData);
        FluxKit.capture.speech.speak(this.expandedData.word, { lang: 'en', audioUrl: audioUrl });
        return;
      }

      const index = FluxHub.ui.currentViews.indexOf(this);
      const row = FluxHub.ui.resultsList.children[index];

      if (row && row.classList.contains('flx-omni-row')) {
        const subtitle = row.querySelector('.flx-omni-subtitle');
        if (subtitle) subtitle.textContent = 'Fetching...';
        row.style.opacity = '0.7';
      }

      const data = await this.fetchData();

      if (data) FluxHub.ui.expandListItem(this, data);
      else {
        if (row && row.classList.contains('flx-omni-row')) {
          const subtitle = row.querySelector('.flx-omni-subtitle');
          if (subtitle) {
            subtitle.textContent = 'No definition found. Try Translate.';
            subtitle.style.color = 'var(--omni-danger)';
          }
          row.style.opacity = '0.5';
          row.style.pointerEvents = 'none';
        }
      }
    }

    destroy() {
      this.isExpanded = false;
      this.expandedData = null;
      FluxKit.capture.speech.stop();
    }
  }

  class TranslateView extends BaseView {
    constructor(query, context = null) {
      super(query);
      this.selectionContext = context;
      this.sourceLang = 'auto'; this.targetLang = 'en';

      this.isExpanded = false; this.nodes = {};
      this.canInsert = false; this.internalData = null;
    }

    static isAvailable = true;
    static commandRegistry = [{ prefix: '> tr', description: 'Translate text...', icon: 'translate' }];

    static matchConfidence(query) {
      const clean = query.trim();
      if (!clean) return 0;
      if (clean.toLowerCase().startsWith('> tr ') || clean.toLowerCase().startsWith('> translate ')) return 100;
      if (/[^\x00-\x7F]/.test(clean)) return 74;
      return 45;
    }

    async fetchData(signal = null) {
      const text = this.query.trim().replace(/^>\s*(tr|translate)\s+/i, '').trim();
      const cacheKey = `trans_${this.sourceLang}_${this.targetLang}_${text}`;

      const cached = await FluxHub.cache.get(cacheKey);
      if (cached) return cached;

      try {
        const transData = await FluxKit.api.translate.fetch(text, this.targetLang, this.sourceLang, signal);
        if (!transData || (signal && signal.aborted)) return null;

        transData.targetLang = this.targetLang;
        await FluxHub.cache.set(cacheKey, transData);
        return transData;
      } catch (err) { return null; }
    }

    async triggerInternalUpdate() {
      if (!this.nodes.resultText) return;
      this.nodes.resultText.textContent = 'Translating...';
      this.nodes.resultText.style.opacity = '0.5';

      this.query = this.nodes.inputDiv.innerText.trim();
      if (!this.query) return;

      const newData = await this.fetchData();
      if (newData) {
        this.internalData = newData;
        this.nodes.resultText.textContent = newData.translated;
        this.nodes.resultText.style.opacity = '1';

        if (this.sourceLang === 'auto' && newData.detectedLanguage) this.nodes.sourceSelect.value = newData.detectedLanguage;
      }
    }

    renderListRow() {
      const text = this.query.trim().replace(/^>\s*(tr|translate)\s+/i, '').trim();
      return FluxKit.ui.omni.ListRow(`Translate "${text}"`, 'translate', 'Google Translate');
    }

    renderExpandedCard(data) {
      this.isExpanded = true;
      this.internalData = data;
      const modernFont = 'var(--omni-font)';

      const applyFocusRing = (el, borderRadius = '4px') => {
        el.setAttribute('tabindex', '0');
        el.style.borderRadius = borderRadius;
        el.addEventListener('focus', () => { el.style.boxShadow = '0 0 0 2px var(--omni-muted)' });
        el.addEventListener('blur', () => { el.style.boxShadow = 'none' });
        return el;
      };

      const buildOptions = selectedVal => {
        return Object.entries(FluxKit.capture.langs || { auto: 'Auto Detect', en: 'English' })
          .map(([code, name]) => {
            const isSelected = code === selectedVal || (code === 'auto' && selectedVal === 'auto') ? 'selected' : '';
            return `<option value="${code}" ${isSelected}>${name}</option>`;
          }).join('');
      };

      const selectStyle = {
        background: 'transparent', border: 'none', color: 'var(--omni-muted)',
        fontSize: '13px', fontWeight: '600', outline: 'none', cursor: 'pointer',
        maxWidth: '140px', fontFamily: modernFont, padding: '2px 4px'
      };

      this.nodes.sourceSelect = applyFocusRing(createHTMLElement('select', {
        style: selectStyle,
        innerHTML: buildOptions(data.detectedLanguage || 'auto'),
        eventListener: { change: e => { this.sourceLang = e.target.value; this.triggerInternalUpdate(); } },
      }));

      this.nodes.targetSelect = applyFocusRing(createHTMLElement('select', {
        style: selectStyle,
        innerHTML: buildOptions(data.targetLang || 'en'),
        eventListener: { change: e => { this.targetLang = e.target.value; this.triggerInternalUpdate(); } },
      }));

      const headerNode = createHTMLElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', borderBottom: '1px solid var(--omni-separator)', paddingBottom: '12px' },
        children: [
          this.nodes.sourceSelect,
          createHTMLElement('span', { style: { color: 'var(--omni-muted)', opacity: '0.5' }, textContent: '➔' }),
          this.nodes.targetSelect,
        ],
      });

      this.nodes.inputDiv = applyFocusRing(createHTMLElement('div', {
        contenteditable: true, spellcheck: false, textContent: data.original,
        style: {
          fontSize: '16px', lineHeight: '1.5', color: 'var(--omni-text)', opacity: '0.8', outline: 'none',
          padding: '4px', borderBottom: '1px dashed transparent', transition: 'border-color 0.2s ease', fontFamily: modernFont,
        },
        eventListener: {
          blur: e => { if (e.target.innerText.trim() !== this.internalData.original) this.triggerInternalUpdate(); },
          keydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } },
        },
      }));

      const sourceSpeaker = applyFocusRing(createHTMLElement('button', {
        style: { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--omni-muted)', opacity: '0.6', transition: 'opacity 0.2s', padding: '4px' },
        icon: 'speakerLow', fluxHubTooltip: 'Listen Original',
        eventListener: e => {
          e.stopPropagation();
          FluxKit.capture.speech.speak(this.nodes.inputDiv.innerText.trim(), { lang: this.nodes.sourceSelect.value });
        },
      }));

      const sourceBlock = createHTMLElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '12px' },
        children: [ createHTMLElement('div', { style: { flexGrow: '1' }, children: [this.nodes.inputDiv] }), sourceSpeaker ],
      });

      this.nodes.resultText = createHTMLElement('div', { textContent: data.translated, style: { fontSize: '20px', fontWeight: 'bold', lineHeight: '1.5', color: 'var(--omni-text)', fontFamily: modernFont, padding: '4px' } });

      const targetSpeaker = applyFocusRing(createHTMLElement('button', {
        style: { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--omni-info)', opacity: '0.8', transition: 'opacity 0.2s', padding: '4px' },
        icon: 'speaker', fluxHubTooltip: 'Listen Translation',
        eventListener: e => {
          e.stopPropagation();
          FluxKit.capture.speech.speak(this.internalData.translated, { lang: this.nodes.targetSelect.value });
        },
      }));

      const targetBlock = createHTMLElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' },
        children: [ createHTMLElement('div', { style: { flexGrow: '1' }, children: [this.nodes.resultText] }), targetSpeaker, ],
      });

      const bodyContainer = createHTMLElement('div', { children: [headerNode, sourceBlock, targetBlock] });

      const actions = [];
      const copyBtn = applyFocusRing(FluxKit.ui.omni.Button('copy', 'Copy', e => { e.stopPropagation(); this.executeCopyAction(copyBtn); }));
      actions.push(copyBtn);

      if (this.selectionContext && this.selectionContext.element) {
        const el = this.selectionContext.element;
        const isStandardInput = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /text|search|password|tel|url/i.test(el.type));
        this.canInsert = isStandardInput || el.isContentEditable;
      }

      if (this.canInsert) {
        const replaceBtn = applyFocusRing(FluxKit.ui.omni.Button('swap', 'Replace', e => { e.stopPropagation(); this.executeReplaceAction(replaceBtn); }));

        replaceBtn.style.background = 'var(--omni-muted)';
        replaceBtn.style.color = 'var(--omni-bg-light)';
        actions.push(replaceBtn);
      }

      return FluxKit.ui.omni.DetailCard(bodyContainer, actions);
    }

    executeCopyAction(btnRef = null) {
      navigator.clipboard.writeText(this.internalData.translated);
      if (btnRef) {
        const lbl = btnRef.querySelector('.flx-omni-btn-label');
        if (lbl) {
          lbl.textContent = 'Copied!';
          setTimeout(() => (lbl.textContent = 'Copy'), 2000);
        }
      } else FluxHub.ui.hide();
    }

    executeReplaceAction(btnRef = null) {
      if (FluxHub.ui.input) FluxHub.ui.input.blur();
      setTimeout(() => {
        let status = false;
        try { status = FluxKit.capture.text.insertAtContext(this.internalData.translated, this.selectionContext); }
        catch (err) { logWarning('Replace error:', err); }

        if (status === true) {
          FluxHub.ui.hide();
        } else if (btnRef) {
          navigator.clipboard.writeText(this.internalData.translated);
          const lbl = btnRef.querySelector('.flx-omni-btn-label');
          if (lbl) lbl.textContent = status === 'orphaned' ? 'Saved to Clipboard' : 'Copied (Insert Failed)';
          btnRef.style.background = 'var(--omni-warning)';
          btnRef.style.color = 'var(--omni-btn-text)';
          btnRef.style.border = 'none';
          setTimeout(() => FluxHub.ui.hide(), 1500);
        } else {
          navigator.clipboard.writeText(this.internalData.translated);
          FluxHub.ui.hide();
        }
      }, 50);
    }

    handleKeydown(e) {
      if (!this.isExpanded || !this.internalData) return false;

      const active = e.composedPath()[0];
      const tag = active ? active.tagName : '';

      if (e.key === 'Enter') {
        if (tag === 'SELECT') return true;

        if (tag === 'BUTTON' || (active && active.classList.contains('flx-omni-btn'))) {
          e.preventDefault(); e.stopPropagation();
          active.click();
          return true;
        }

        if (active && active.isContentEditable) return false;

        e.preventDefault(); e.stopPropagation();

        if (this.canInsert) this.executeReplaceAction();
        else this.executeCopyAction();
        return true;
      }

      return false;
    }

    async execute() {
      if (this.isExpanded && this.internalData) {
        if (this.canInsert) this.executeReplaceAction();
        else this.executeCopyAction();
        return;
      }

      const data = await this.fetchData();
      if (data) FluxHub.ui.expandListItem(this, data);
    }

    destroy() {
      this.isExpanded = false;
      this.internalData = null;
      FluxKit.capture.speech.stop();
    }
  }

  class SettingsView extends BaseView {
    static isAvailable = true;
    static commandRegistry = [{ prefix: '> config', description: 'Manage & view app configurations', icon: 'settings' }];

    validSubs = ['theme', 'ocr', 'saavn', 'shazam'];
    
    constructor(query, context = null) {
      super(query, context);
      this.subIndex = -1;
      this.listNodes = [];
      this.currentData = null;
      this.lastAutoExpandSub = null;
    }

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (!q.startsWith('>')) return 0;
      if (/^>\s*(config|settings|set)(\s+|$)/i.test(q)) return 100;
      if ('> settings'.startsWith(q) || '> config'.startsWith(q)) return 60;
      return 0;
    }

    _parseCommand() {
      const rawQ = this.query.trim();
      const match = rawQ.match(/^>\s*(config|settings|set)(?:\s+([^\s]+))?(?:\s+(.*))?$/i);
      if (!match) return { sub: 'default', val: '' };

      const sub = match[2]?.toLowerCase() || '';
      const val = match[3] || '';

      if (this.validSubs.includes(sub)) {
        return { sub, val };
      }

      return { sub: 'default', val: rawQ.replace(/^>\s*(config|settings|set)\s*/i, '').trim() };
    }

    _autoExpandIfExactSubCommand() {
      const { sub } = this._parseCommand();
      
      if (this.validSubs.includes(sub) && this.lastAutoExpandSub !== sub) {
        this.lastAutoExpandSub = sub;
        setTimeout(() => this.execute(), 50); // Force UI expansion without requiring the Enter key
      } else if (!this.validSubs.includes(sub)) {
        this.lastAutoExpandSub = null;
      }
    }

    async fetchData() {
      const { sub, val } = this._parseCommand();
      const stored = SettingsState.getAll();
      const config = { ...DEFAULT_SETTINGS, ...stored };

      if (sub === 'theme') {
        const allThemes = [{ key: 'auto', name: 'Auto (Site Match)' }, ...Object.values(FluxKit.theme.presets)];
        const filtered = val ? allThemes.filter(t => t.name.toLowerCase().includes(val.toLowerCase()) || t.key.toLowerCase().includes(val.toLowerCase())) : allThemes;
        return { mode: 'theme', filtered, val, config };
      }
      if (sub === 'ocr') {
        const allOcr = [{ val: 'live', text: 'Live (Fast, No Prompts)' }, { val: 'native', text: 'Native (Screenshare)' }];
        const filtered = val ? allOcr.filter(o => o.text.toLowerCase().includes(val.toLowerCase()) || o.val.toLowerCase().includes(val.toLowerCase())) : allOcr;
        return { mode: 'ocr', filtered, val, config };
      }
      if (sub === 'saavn') {
        return { mode: 'saavn', val, config };
      }
      if (sub === 'shazam') {
        return { mode: 'shazam', val, config };
      }

      return { mode: 'default', config };
    }

    renderListRow() {
      const { sub, val } = this._parseCommand();

      if (sub === 'theme') return FluxKit.ui.omni.ListRow(val ? `Search Themes: ${val}` : 'Select Theme', 'palette', 'Settings');
      if (sub === 'ocr') return FluxKit.ui.omni.ListRow(val ? `Search OCR Modes: ${val}` : 'Select OCR Mode', 'scan', 'Settings');
      if (sub === 'saavn') return FluxKit.ui.omni.ListRow(val ? `Set Saavn URL: ${val}` : 'Set Saavn URL', 'link', val || 'Paste URL to save');
      if (sub === 'shazam') return FluxKit.ui.omni.ListRow(val ? `Set RapidAPI Key: ${val}` : 'Configure Shazam API', 'note', val || 'Set RapidAPI Key for Music Recognition');

      return FluxKit.ui.omni.ListRow('Flux Settings', 'settings', 'Configure Theme & Shortcuts'); 
    }

    saveAndClose(mode, item) {
      if (mode === 'theme') {
        SettingsState.save({ theme: item.key });
        FluxHub.ui.applyTheme();
        FluxKit.ui.showNotification(`Theme set to: ${item.name}`);
      } else if (mode === 'ocr') {
        SettingsState.save({ ocrMode: item.val });
        FluxKit.ui.showNotification(`OCR Mode set to: ${item.text}`);
      } else if (mode === 'saavn') {
        FluxHubState.set(STATE_KEYS.CUSTOM_SAAVN_URL, item);
        FluxKit.ui.showNotification(`JioSaavn URL updated`);
      } else if (mode === 'shazam') {
        FluxHubState.set(STATE_KEYS.RAPIDAPI_KEY, item);
        FluxKit.ui.showNotification(`RapidAPI Key updated`);
      }
      
      this.lastAutoExpandSub = null;
      FluxHub.ui.setInputVal('> config ');
    }

    handleKeydown(e) {
      if (!this.currentData || (this.currentData.mode !== 'theme' && this.currentData.mode !== 'ocr')) return false;
      if (this.listNodes.length === 0) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        this.subIndex = Math.min(this.subIndex + 1, this.listNodes.length - 1);
        this.updateSubSelection();
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        this.subIndex = Math.max(this.subIndex - 1, 0);
        this.updateSubSelection();
        return true;
      }
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (this.listNodes[this.subIndex]) {
          const item = this.currentData.filtered[this.subIndex];
          this.saveAndClose(this.currentData.mode, item);
        }
        return true;
      }
      return false;
    }

    updateSubSelection() {
      this.listNodes.forEach((node, idx) => {
        if (idx === this.subIndex) {
          node.style.borderColor = 'var(--omni-border)';
          node.style.background = 'var(--omni-hover)';
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
          node.style.borderColor = 'transparent';
          node.style.background = 'transparent';
        }
      });
    }

    renderExpandedCard(data) {
      this.currentData = data;
      this.listNodes = [];
      this.subIndex = -1;

      const modernFont = 'var(--omni-font)';
      const config = data.config;

      const selectStyle = {
        padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--omni-border)',
        background: 'var(--omni-input-bg)', color: 'var(--omni-text)', fontSize: '13px',
        outline: 'none', cursor: 'pointer', fontFamily: modernFont
      };

      if (data.mode === 'theme' || data.mode === 'ocr') {
        const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
        
        if (data.filtered.length === 0) {
          container.appendChild(createHTMLElement('div', { textContent: 'No matches found.', style: { color: 'var(--omni-muted)', padding: '16px', textAlign: 'center', fontSize: '13px' } }));
          return FluxKit.ui.omni.DetailCard(container, []);
        }

        data.filtered.forEach((item, idx) => {
          const isSelected = data.mode === 'theme' ? config.theme === item.key : config.ocrMode === item.val;
          const title = data.mode === 'theme' ? item.name : item.text;

          const row = createHTMLElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '6px', cursor: 'pointer' },
            eventListener: {
              mouseenter: () => { this.subIndex = idx; this.updateSubSelection(); },
              click: (e) => { e.stopPropagation(); this.saveAndClose(data.mode, item); }
            }
          });

          row.appendChild(createHTMLElement('div', { textContent: title, style: { fontSize: '13px', fontWeight: isSelected ? '600' : 'normal', color: isSelected ? 'var(--omni-accent-text)' : 'var(--omni-text)' } }));
          if (isSelected) row.appendChild(createHTMLElement('div', { icon: 'success', style: { color: 'var(--omni-success)', fontSize: '14px', display: 'flex' } }));

          this.listNodes.push(row);
          container.appendChild(row);
        });

        if (this.listNodes.length > 0) { this.subIndex = 0; this.updateSubSelection(); }
        return FluxKit.ui.omni.DetailCard(container, []);
      }

      if (data.mode === 'saavn') {
        const container = createHTMLElement('div', { style: { padding: '16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' } });
        container.appendChild(createHTMLElement('div', { textContent: `JioSaavn Base URL`, style: { color: 'var(--omni-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 'bold' } }));
        
        const prevVal = FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, ''); 
        const displayVal = data.val || prevVal;
        container.appendChild(createHTMLElement('div', { textContent: displayVal || 'Not configured', style: { fontWeight: '600', fontSize: '14px', wordBreak: 'break-all', color: 'var(--omni-text)' } }));
        
        const actions = [FluxKit.ui.omni.Button('success', 'Save Custom URL', () => this.saveAndClose('saavn', displayVal))];
        return FluxKit.ui.omni.DetailCard(container, actions);
      }

      if (data.mode === 'shazam') {
        const container = createHTMLElement('div', { style: { padding: '16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' } });
        container.appendChild(createHTMLElement('div', { textContent: `RapidAPI Key (Shazam)`, style: { color: 'var(--omni-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 'bold' } }));
        
        const prevVal = FluxHubState.get(STATE_KEYS.RAPIDAPI_KEY, ''); 
        const displayVal = data.val || prevVal;
        container.appendChild(createHTMLElement('div', { textContent: displayVal ? '••••••••' + displayVal.slice(-4) : 'Not configured', style: { fontWeight: '600', fontSize: '14px', wordBreak: 'break-all', color: 'var(--omni-text)' } }));
        
        const actions = [FluxKit.ui.omni.Button('success', 'Save API Key', () => this.saveAndClose('shazam', displayVal))];
        return FluxKit.ui.omni.DetailCard(container, actions);
      }

      const saveConfig = (key, value) => { config[key] = value; SettingsState.save({ [key]: value }); };

      const createFormRow = (labelText, inputElement) => {
        return createHTMLElement('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--omni-separator)' },
          children: [ createHTMLElement('div', { style: { fontWeight: '500', fontSize: '14px', color: 'var(--omni-text)' }, textContent: labelText }), inputElement ]
        });
      };

      const themeSelect = createHTMLElement('select', {
        style: selectStyle,
        children: [{ key: 'auto', name: 'Auto (Site Match)' }, ...Object.values(FluxKit.theme.presets)].map(opt => createHTMLElement('option', { value: opt.key, textContent: opt.name, selected: config.theme === opt.key })),
        eventListener: {
          change: (e) => {
            saveConfig('theme', e.target.value);
            FluxHub.ui.applyTheme();
          }
        }
      });

      const ocrSelect = createHTMLElement('select', {
        style: selectStyle,
        children: [{ val: 'live', text: 'Live (Fast, No Prompts)' }, { val: 'native', text: 'Native (Screenshare)' }].map(opt => createHTMLElement('option', { value: opt.val, textContent: opt.text, selected: config.ocrMode === opt.val })),
        eventListener: { change: (e) => saveConfig('ocrMode', e.target.value) }
      });

      const customSaavnInput = createHTMLElement('input', {
        type: 'text', value: FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, ''), placeholder: 'https://your-api.vercel.app',
        style: { ...selectStyle, textAlign: 'left', cursor: 'text', width: '220px', fontFamily: 'monospace' },
        eventListener: { input: (e) => FluxHubState.set(STATE_KEYS.CUSTOM_SAAVN_URL, e.target.value.trim()) }
      });

      const rapidApiKeyInput = createHTMLElement('input', {
        type: 'password', value: FluxHubState.get(STATE_KEYS.RAPIDAPI_KEY, ''), placeholder: 'RapidAPI Key',
        style: { ...selectStyle, textAlign: 'left', cursor: 'text', width: '220px', fontFamily: 'monospace' },
        eventListener: { input: (e) => FluxHubState.set(STATE_KEYS.RAPIDAPI_KEY, e.target.value.trim()) }
      });

      const hotkeyInput = createHTMLElement('input', {
        type: 'text', readOnly: true, fluxHubTooltip: 'Click and press keys to rebind',
        value: FluxKit.utils.formatShortcutForDisplay ? FluxKit.utils.formatShortcutForDisplay(config.launcherTrigger) : config.launcherTrigger,
        style: { ...selectStyle, textAlign: 'center', cursor: 'text', width: '140px', fontFamily: 'monospace' },
        eventListener: {
          focus: e => {
            e.target.style.boxShadow = '0 0 0 2px var(--omni-muted)';
            e.target.value = 'Press keys...';
          },
          blur: e => {
            e.target.style.boxShadow = '';
            e.target.value = FluxKit.utils.formatShortcutForDisplay(config.launcherTrigger, { normalizeOS: true });
          },
          keydown: e => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') {
              e.target.blur();
              return;
            }
            if (e.key === 'Enter') {
              if (e.target.dataset.tempStored) saveConfig('launcherTrigger', e.target.dataset.tempStored);
              e.target.blur();
              return;
            }

            const { stored, display, isModifierOnly } = FluxKit.utils.getShortcutFromEvent(e, { normalizeOS: true });
            if (stored && !isModifierOnly) {
              e.target.value = display;
              e.target.dataset.tempStored = stored;
            }
          },
        }
      });

      const bodyContainer = createHTMLElement('div', {
        style: { fontFamily: modernFont, display: 'flex', flexDirection: 'column' },
        children: [
          createHTMLElement('div', { style: { fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }, textContent: 'Preferences' }),
          createFormRow('Theme Engine', themeSelect),
          createFormRow('OCR Capture Mode', ocrSelect),
          createFormRow('JioSaavn Base URL', customSaavnInput),
          createFormRow('RapidAPI Key (Shazam)', rapidApiKeyInput),
          createFormRow('Launcher Shortcut', hotkeyInput)
        ]
      });

      return FluxKit.ui.omni.DetailCard(bodyContainer, []);
    }

    async execute() { 
      const { sub, val } = this._parseCommand();

      if (sub === 'saavn' && val) {
        this.saveAndClose('saavn', val);
        return;
      }

      if (sub === 'shazam' && val) {
        this.saveAndClose('shazam', val);
        return;
      }

      if ((sub === 'theme' || sub === 'ocr') && val && this.currentData?.filtered?.length > 0) {
         this.saveAndClose(sub, this.currentData.filtered[0]);
         return;
      }

      const data = await this.fetchData(); 
      FluxHub.ui.expandListItem(this, data); 
    }
  }

  class SyncView extends BaseView {
    static get isAvailable() { return typeof FluxKit.sync !== 'undefined'; }

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (['> sync', '> cloud', '> backup'].includes(q) || q.startsWith('> sync ')) return 100;
      if ('> sync'.startsWith(q)) return 60;
      return 0;
    }

    async fetchData() {
      const config = FluxHubState.get(STATE_KEYS.SYNC_CONFIG, { currentProfile: 'Local', syncProfiles: {} });
      const activeProfileName = config.currentProfile;

      const caps = typeof FluxKit.sync.getCapabilities === 'function' ? FluxKit.sync.getCapabilities({ provider: activeProfileName }) : null;

      return {
        profile: activeProfileName,
        lastSync: config.lastSyncTime || null,
        capabilities: caps,
        configData: config
      };
    }

    renderListRow() { 
      return FluxKit.ui.omni.ListRow('Cloud Sync & Storage', 'cloud', 'Backup Search, Settings, & Music Stats'); 
    }

    openWizardModal() {
      const overlay = createHTMLElement('div', { id: 'flx-sync-wizard-overlay',
        style: {
          position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: '2147483647', fontFamily: 'var(--omni-font, system-ui)'
        }
      });

      const modal = createHTMLElement('div', {
        style: {
          background: 'var(--omni-bg-light, #1a1a1a)', width: '480px', maxWidth: '90vw',
          borderRadius: '12px', border: '1px solid var(--omni-border, #333)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column'
        }
      });

      const header = createHTMLElement('div', {
        style: {
          padding: '16px 20px', borderBottom: '1px solid var(--omni-border, #333)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }
      });

      header.appendChild(createHTMLElement('div', { textContent: 'Configure Sync Provider', style: { fontSize: '16px', fontWeight: 'bold', color: 'var(--omni-text, #fff)' } }));

      let activeWizard = null;

      const closeBtn = createHTMLElement('button', {
        textContent: '✕',
        style: { background: 'none', border: 'none', color: 'var(--omni-muted, #888)', cursor: 'pointer', fontSize: '16px', padding: '4px' },
        eventListener: () => {
          if (activeWizard) activeWizard.destroy();
          overlay.remove();
        }
      });
      header.appendChild(closeBtn);

      const wizardTarget = createHTMLElement('div', { style: { padding: '20px' } });

      modal.appendChild(header);
      modal.appendChild(wizardTarget);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const wizardOptions = { namespace: 'Flux/Hub', theme: { autoDark: true } };

      activeWizard = new FluxKit.sync.Wizard(wizardTarget, wizardOptions, (newProfileData) => {
        const currentConfig = FluxHubState.get(STATE_KEYS.SYNC_CONFIG, { syncProfiles: {} });

        currentConfig.currentProfile = newProfileData.provider;
        currentConfig.syncProfiles[newProfileData.provider] = newProfileData;

        FluxHubState.set(STATE_KEYS.SYNC_CONFIG, currentConfig);

        FluxKit.ui.showNotification(`Connected to ${newProfileData.provider}. Syncing...`, { icon: 'sync' });
        activeWizard.destroy();
        overlay.remove();
        FluxHub.ui.show('> sync');
        AutoSync.runNow();
      });

      activeWizard.render(wizardTarget);
    }

    renderExpandedCard(data) {
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 0', fontFamily: 'var(--omni-font)' } });

      const header = createHTMLElement('div', { textContent: 'Omnisearch Sync Dashboard', style: { fontSize: '18px', fontWeight: 'bold', color: 'var(--omni-text)' } });
      container.appendChild(header);

      const statusBlock = createHTMLElement('div', { style: { padding: '16px', background: 'var(--omni-input-bg)', borderRadius: '8px', border: '1px solid var(--omni-border)' } });

      statusBlock.appendChild(createHTMLElement('div', { textContent: 'Active Provider', style: { fontSize: '13px', color: 'var(--omni-muted)', marginBottom: '4px' } }));

      statusBlock.appendChild(createHTMLElement('div', { textContent: data.profile, style: { fontSize: '20px', fontWeight: 'bold', color: 'var(--omni-accent)' } }));

      const lastSyncText = data.lastSync ? new Date(data.lastSync).toLocaleString() : 'Never';
      statusBlock.appendChild(createHTMLElement('div', { textContent: `Last Synced: ${lastSyncText}`, style: { fontSize: '12px', color: 'var(--omni-text)', marginTop: '12px', opacity: '0.8', borderTop: '1px solid var(--omni-separator)', paddingTop: '12px' } }));

      container.appendChild(statusBlock);

      const actions = [];

      const wizardBtn = FluxKit.ui.omni.Button('settings', 'Configure Provider', (e) => {
        e.stopPropagation();
        FluxHub.ui.hide();
        this.openWizardModal();
      });
      wizardBtn.style.background = 'var(--omni-hover)';
      actions.push(wizardBtn);

      if (data.profile !== 'Local') {
        const syncNowBtn = FluxKit.ui.omni.Button('refresh', 'Sync Now', (e) => {
          e.stopPropagation();
          AutoSync.runNow();
          FluxKit.ui.showNotification('Sync started in background.', { icon: 'info' });
        });
        syncNowBtn.style.background = 'var(--omni-hover)';
        actions.push(syncNowBtn);
      }

      return FluxKit.ui.omni.DetailCard(container, actions);
    }

    async executeLocalSync(configData, btnRef) {
      const profile = configData.syncProfiles?.[configData.currentProfile];
      if (!profile || configData.currentProfile === 'Local') {
        FluxKit.ui.showNotification('Please configure a cloud provider first.', { icon: 'warning' });
        return;
      }

      const btnLabel = btnRef.querySelector('.flx-omni-btn-label');
      if (btnLabel) btnLabel.textContent = 'Syncing...';
      btnRef.style.pointerEvents = 'none';

      try {
        await FluxKit.sync.performFullSync(profile);
        configData.lastSyncTime = Date.now();
        FluxHubState.set(STATE_KEYS.SYNC_CONFIG, configData);
        FluxKit.ui.showNotification('Sync complete!', { icon: 'success' });
        this.execute();
      } catch (err) {
        logError('Sync failed:', err, { __v: 1 });
        if (btnLabel) btnLabel.textContent = 'Backup Data Now';
        btnRef.style.pointerEvents = 'auto';
        FluxKit.ui.showNotification(`Sync failed: ${err.message}`, { icon: 'error' });
      }
    }

    async execute() {
      const data = await this.fetchData();
      FluxHub.ui.expandListItem(this, data);
    }
  }

  class WikipediaView extends BaseView {
    static isAvailable = true;

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (['@w', '@wiki'].includes(q) || q.startsWith('@wiki ') || q.startsWith('@w ')) return 100;
      return 0;
    }

    async fetchData(signal) {
      const term = this.query.trim().replace(/^@w(iki)?\s+/i, '').trim();
      if (!term) return null;

      const cacheKey = `wiki_${term.toLowerCase()}`;
      const cached = await FluxHub.cache.get(cacheKey);
      if (cached) return cached;

      try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
        const response = await safeFetch(url, signal);
        if (!response.ok) return null;

        const data = await response.json();

        if (data.type === 'disambiguation' || !data.extract) return null;

        await FluxHub.cache.set(cacheKey, data);
        return data;
      } catch (err) { return null; }
    }

    renderListRow() {
      const term = this.query.trim().replace(/^@w(iki)?\s+/i, '').trim();
      
      const row = FluxKit.ui.omni.ListRow(`Wikipedia: "${term}"`, 'wikipedia', 'Wikipedia Summary', 'Fetching...');

      this.fetchData().then(data => {
        if (!row.isConnected) return;
        
        if (!data) {
          const fallbackRow = FluxKit.ui.omni.ListRow(`Search Wiki for "${term}"`, 'wikipedia', 'Web Search', 'to Open Tab');
          row.innerHTML = fallbackRow.innerHTML;
        } else {
          const hint = row.querySelector('.flx-omni-action-hint');
          if (hint) hint.textContent = '↵ to Expand';
        }
      }).catch(() => {
        if (!row.isConnected) return;
        const fallbackRow = FluxKit.ui.omni.ListRow(`Search Wiki for "${term}"`, 'wikipedia', 'Web Search', 'to Open Tab');
        row.innerHTML = fallbackRow.innerHTML;
      });

      return row;
    }

    renderExpandedCard(data) {
      this.isExpanded = true;
      this.expandedData = data;

      const modernFont = 'var(--omni-font)';

      const textContainer = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', gap: '8px', fontFamily: modernFont } });

      const titleRow = createHTMLElement('div', { textContent: data.title, style: { fontSize: '22px', fontWeight: 'bold', color: 'var(--omni-text)' } });

      if (data.description) {
        textContainer.appendChild(createHTMLElement('div', { textContent: data.description, style: { fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--omni-muted)', fontWeight: '600' } }));
      }

      textContainer.appendChild(titleRow);

      textContainer.appendChild(createHTMLElement('div', { textContent: data.extract, style: { fontSize: '15px', lineHeight: '1.6', color: 'var(--omni-text)', opacity: '0.9', marginTop: '4px' } }));

      const layoutChildren = [];

      if (data.thumbnail && data.thumbnail.source) {
        const img = createHTMLElement('img', { src: data.thumbnail.source, style: { width: '120px', height: '120px', objectFit: 'cover', borderRadius: '8px', flexShrink: '0', border: '1px solid var(--omni-border)' } });
        layoutChildren.push(img);
      }

      layoutChildren.push(textContainer);

      const bodyContainer = createHTMLElement('div', { style: { display: 'flex', gap: '20px', alignItems: 'flex-start' }, children: layoutChildren });

      const actions = [];
      if (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) {
        const openBtn = FluxKit.ui.omni.Button('externalLink', 'Read Article', (e) => {
          e.stopPropagation();
          GM_openInTab(data.content_urls.desktop.page, { active: true, insert: true });
          FluxHub.ui.hide();
        });
        actions.push(openBtn);
      }

      return FluxKit.ui.omni.DetailCard(bodyContainer, actions);
    }

    async execute() {
      if (this.isExpanded && this.expandedData && this.expandedData.content_urls?.desktop?.page) {
        GM_openInTab(this.expandedData.content_urls.desktop.page, { active: true, insert: true });
        FluxHub.ui.hide();
        return;
      }
      const data = await this.fetchData();
      if (data) FluxHub.ui.expandListItem(this, data);
      else {
        const term = this.query.trim().replace(/^@w(iki)?\s+/i, '').trim();
        const url = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(term)}`;
        GM_openInTab(url, { active: true, insert: true });
        FluxHub.ui.hide();
      }
    }

    destroy() { this.isExpanded = false; this.expandedData = null; }
  }

  class DuckDuckGoView extends BaseView {
    static isAvailable = true;

    static matchConfidence(query) {
      const clean = query.trim();
      if (!clean) return 0;
      if (clean === '@ddg' || clean.startsWith('@ddg ')) return 100;
      if (clean.startsWith('>') || clean.startsWith('@') || clean.startsWith('=')) return 20;
      return clean.length > 2 ? 75 : 0;
    }

    async fetchData(signal) {
      const term = this.query.trim().replace(/^@ddg\s+/i, '').trim();
      const cacheKey = `ddg_${term}`;

      const cached = await FluxHub.cache.get(cacheKey);
      if (cached) return cached;

      try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(term)}&format=json&no_html=1&skip_disambig=1`;
        const response = await safeFetch(url, signal);
        if (!response.ok) return null;

        const data = await response.json();

        if (!data.AbstractText && !data.Answer) return null;

        await FluxHub.cache.set(cacheKey, data);
        return data;
      } catch (err) { return null; }
    }

    renderListRow() { 
      let text = this.query.trim().replace(/^@ddg\s+/i, '').trim();
      if (text === '@ddg') { text = 'Open DuckDuckGo'}
      else {text = `Search DuckDuckGo for "${text}"`; }
      return FluxKit.ui.omni.ListRow(text, 'search', 'Web Search');
    }

    renderExpandedCard(data) {
      this.isExpanded = true;
      this.expandedData = data;

      const modernFont = 'var(--omni-font)';

      const textContainer = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', gap: '8px', fontFamily: modernFont } });

      textContainer.appendChild(createHTMLElement('div', { style: { fontSize: '20px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: data.Heading || this.query.trim() }));

      if (data.Entity) {
        textContainer.appendChild(createHTMLElement('div', { style: { fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--omni-muted)', fontWeight: '600' }, textContent: data.Entity }));
      }

      textContainer.appendChild(createHTMLElement('div', { style: { fontSize: '16px', lineHeight: '1.6', color: 'var(--omni-text)', opacity: '0.9', marginTop: '4px' }, textContent: data.AbstractText || data.Answer }));

      const layoutChildren = [];

      if (data.Image) {
        const imgUrl = data.Image.startsWith('http') ? data.Image : `https://duckduckgo.com${data.Image}`;
        const img = createHTMLElement('img', { src: imgUrl, style: { width: '80px', height: '80px', objectFit: 'contain', borderRadius: '8px', flexShrink: '0', background: 'transparent', padding: '4px' } });
        layoutChildren.push(img);
      }

      layoutChildren.push(textContainer);

      const bodyContainer = createHTMLElement('div', { style: { display: 'flex', gap: '20px', alignItems: 'flex-start' }, children: layoutChildren });

      const actions = [];
      if (data.AbstractURL) {
        const openBtn = FluxKit.ui.omni.Button('externalLink', 'Source Article', (e) => {
          e.stopPropagation();
          GM_openInTab(data.AbstractURL, { active: true, insert: true });
          FluxHub.ui.hide();
        });
        actions.push(openBtn);
      }

      return FluxKit.ui.omni.DetailCard(bodyContainer, actions);
    }

    async execute() {
      if (this.isExpanded && this.expandedData && this.expandedData.AbstractURL) {
        GM_openInTab(this.expandedData.AbstractURL, { active: true, insert: true });
        FluxHub.ui.hide();
        return;
      }

      const index = FluxHub.ui.currentViews.indexOf(this);
      const row = FluxHub.ui.resultsList.children[index];
      if (row && row.classList.contains('flx-omni-row')) row.style.opacity = '0.5';
      const data = await this.fetchData();
      if (data) FluxHub.ui.expandListItem(this, data);
      else {
        const term = this.query.trim().replace(/^@ddg\s+/i, '').trim();
        const url = `https://duckduckgo.com/?q=${encodeURIComponent(term === '@ddg' ? '' : term)}`;
        GM_openInTab(url, { active: true, insert: true });
        FluxHub.ui.hide();
      }
    }

    destroy() { this.isExpanded = false; this.expandedData = null; }
  }

  class WeatherView extends BaseView {
    static isAvailable = true;

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (q.startsWith('> weather ') || q.startsWith('> w ')) return 100;
      return 0;
    }

    async fetchData(signal) {
      const city = this.query.trim().replace(/^>\s*(weather|w)\s+/i, '').trim();
      if (!city) return null;

      const cacheKey = `weather_${city.toLowerCase()}`;
      const cached = await FluxHub.cache.get(cacheKey);

      const TTL_MS = 30 * 60 * 1000;
      if (cached && cached._timestamp) {
        if (Date.now() - cached._timestamp < TTL_MS) return cached.data;
        else {
          this.revalidateCache(city, cacheKey, signal);
          return { ...cached.data, isStale: true };
        }
      }

      return await this.fetchLive(city, cacheKey, signal);
    }

    async fetchLive(city, cacheKey, signal) {
      try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
        const geoRes = await safeFetch(geoUrl, signal);
        if (!geoRes.ok) return null;
        const geoData = await geoRes.json();
        if (!geoData.results || !geoData.results.length) return null;
        const location = geoData.results[0];

        const currentVars = 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation';
        const dailyVars = 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum';

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=${currentVars}&daily=${dailyVars}&timezone=auto`;
        const weatherRes = await safeFetch(weatherUrl, signal);
        if (!weatherRes.ok) return null;
        const weatherData = await weatherRes.json();

        const finalData = {
          name: location.name,
          country: location.country,
          timezone: weatherData.timezone,
          current: weatherData.current,
          daily: weatherData.daily
        };
        await FluxHub.cache.set(cacheKey, { _timestamp: Date.now(), data: finalData });
        return finalData;
      } catch (err) { return null; }
    }

    async revalidateCache(city, cacheKey, signal) {
      const freshData = await this.fetchLive(city, cacheKey, signal);

      if (freshData) {
        const index = FluxHub.ui.currentViews.indexOf(this);
        if (index === 0) {
          const topRow = FluxHub.ui.resultsList.children[0];
          if (topRow && topRow.classList.contains('flx-omni-card')) FluxHub.ui.expandListItem(this, freshData);
        }
      }
    }

    getWeatherCondition(code) {
      if (code === 0) return { text: 'Clear sky', icon: '☀️' };
      if (code === 1 || code === 2 || code === 3) return { text: 'Partly cloudy', icon: '⛅' };
      if (code === 45 || code === 48) return { text: 'Fog', icon: '🌫️' };
      if (code >= 51 && code <= 67) return { text: 'Rain', icon: '🌧️' };
      if (code >= 71 && code <= 77) return { text: 'Snow', icon: '❄️' };
      if (code >= 95) return { text: 'Thunderstorm', icon: '⛈️' };
      return { text: 'Unknown', icon: '🌡️' };
    }

    formatHourMinute(isoStr, timezone) {
      if (!isoStr) return '--';
      try {
        return new Date(isoStr).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
      } catch (e) { return '--'; }
    }

    formatDayLabel(dateStr, index) {
      if (index === 0) return 'Today';
      try {
        const d = new Date(dateStr + 'T00:00:00Z');
        return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
      } catch (e) { return dateStr; }
    }

    windDirectionLabel(deg) {
      if (deg === undefined || deg === null) return '';
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      return dirs[Math.round(deg / 45) % 8];
    }

    renderWidget(params) {
      const city = params?.city || 'Pune';

      const widget = createHTMLElement('div', { class: 'flx-omni-widget', style: { gridColumn: 'span 2' }, eventListener: () => FluxHub.ui.setInputVal(`> w ${city}`) });

      widget.appendChild(createHTMLElement('div', { textContent: `Fetching ${city}...`, style: { color: 'var(--omni-muted)', fontSize: '13px', textAlign: 'center' }, }));

      this._loadWidgetData(widget, city);
      return widget;
    }

    async _loadWidgetData(widget, city) {
      const cacheKey = `weather_${city.toLowerCase()}`;
      const cached = await FluxHub.cache.get(cacheKey);
      const TTL_MS = 30 * 60 * 1000;

      let dataToRender = null;
      let needsRevalidation = false;

      if (cached && cached._timestamp) {
        if (Date.now() - cached._timestamp < TTL_MS) {
          dataToRender = cached.data;
        } else {
          dataToRender = { ...cached.data, isStale: true };
          needsRevalidation = true;
        }
      } else { dataToRender = await this.fetchLive(city, cacheKey, null); }

      if (dataToRender) {
        this._buildWeatherWidgetContent(widget, dataToRender);

        if (needsRevalidation) {
          const freshData = await this.fetchLive(city, cacheKey, null);
          if (freshData && widget.isConnected) this._buildWeatherWidgetContent(widget, freshData);
        }
      } else {
        widget.innerHTML = safeHTML('');
        widget.appendChild(createHTMLElement('div', { style: { color: 'var(--omni-danger)', fontSize: '13px', textAlign: 'center' }, textContent: `City not found: ${city}` }));
      }
    }

    _buildWeatherWidgetContent(widget, data) {
      widget.innerHTML = safeHTML('');
      const condition = this.getWeatherCondition(data.current.weather_code);

      const topRow = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });

      const tempBlock = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
      tempBlock.appendChild(createHTMLElement('div', { style: { fontSize: '32px' }, textContent: condition.icon} ));

      const tempWrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column' } });
      tempWrap.appendChild(createHTMLElement('div', { style: { fontSize: '26px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: `${Math.round(data.current.temperature_2m)}°` }));
      if (data.current.apparent_temperature !== undefined) {
        tempWrap.appendChild(createHTMLElement('div', { style: { fontSize: '11px', color: 'var(--omni-muted)', fontWeight: '600' }, textContent: `Feels ${Math.round(data.current.apparent_temperature)}°` }));
      }
      tempBlock.appendChild(tempWrap);

      const hiLoBlock = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' } });
      if (data.daily && data.daily.temperature_2m_max) {
        hiLoBlock.appendChild(createHTMLElement('div', {
          textContent: `H: ${Math.round(data.daily.temperature_2m_max[0])}°`,
          style: { fontSize: '13px', color: 'var(--omni-text)', fontWeight: '600' }
        }));
        hiLoBlock.appendChild(createHTMLElement('div', {
          textContent: `L: ${Math.round(data.daily.temperature_2m_min[0])}°`,
          style: { fontSize: '13px', color: 'var(--omni-muted)', fontWeight: '600' }
        }));
      }

      topRow.appendChild(tempBlock);
      topRow.appendChild(hiLoBlock);

      const statsRow = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '10px', gap: '8px' } });
      const makeStat = (icon, value) => createHTMLElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--omni-muted)', fontWeight: '600' },
        children: [
          createHTMLElement('span', { textContent: icon, style: { fontSize: '12px' } }),
          createHTMLElement('span', { textContent: value })
        ]
      });
      if (data.current.relative_humidity_2m !== undefined) statsRow.appendChild(makeStat('💧', `${Math.round(data.current.relative_humidity_2m)}%`));
      if (data.current.wind_speed_10m !== undefined) statsRow.appendChild(makeStat('💨', `${Math.round(data.current.wind_speed_10m)} km/h`));
      if (data.daily && data.daily.uv_index_max) statsRow.appendChild(makeStat('☀️', `UV ${Math.round(data.daily.uv_index_max[0])}`));

      let weekStrip = null;
      /*if (data.daily && data.daily.time && data.daily.time.length > 1) {
        weekStrip = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--omni-separator)' } });
        const days = Math.min(3, data.daily.time.length);
        for (let i = 1; i < days + 1 && i < data.daily.time.length; i++) {
          const dayCond = this.getWeatherCondition(data.daily.weather_code ? data.daily.weather_code[i] : null);
          const dayCell = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' } });
          dayCell.appendChild(createHTMLElement('div', { textContent: this.formatDayLabel(data.daily.time[i], i), style: { fontSize: '10px', color: 'var(--omni-muted)', fontWeight: '700', textTransform: 'uppercase' } }));
          dayCell.appendChild(createHTMLElement('div', { textContent: dayCond.icon, style: { fontSize: '16px' } }));
          dayCell.appendChild(createHTMLElement('div', { textContent: `${Math.round(data.daily.temperature_2m_max[i])}°`, style: { fontSize: '12px', color: 'var(--omni-text)', fontWeight: '600' } }));
          weekStrip.appendChild(dayCell);
        }
      }*/

      const bottomRow = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '10px', alignItems: 'flex-end' } });

      bottomRow.appendChild(createHTMLElement('div', { style: { fontSize: '15px', fontWeight: '600', color: 'var(--omni-text)' }, textContent: data.name }));

      const statusBlock = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } });

      if (data.isStale) {
        statusBlock.appendChild(createHTMLElement('span', { style: { fontSize: '10px', color: 'var(--omni-warning)', fontWeight: 'bold', textTransform: 'uppercase', display: 'flex', gap: '6px' }, icon: 'loader', textContent: 'Updating' }));
      }
      statusBlock.appendChild(createHTMLElement('span', { style: { fontSize: '13px', color: 'var(--omni-muted)' }, textContent: condition.text }));

      bottomRow.appendChild(statusBlock);
      widget.appendChild(topRow);
      if (statsRow.children.length > 0) widget.appendChild(statsRow);
      if (weekStrip) widget.appendChild(weekStrip);
      widget.appendChild(bottomRow);
    }

    renderListRow() {
      const city = this.query.trim().replace(/^>\s*(weather|w)\s+/i, '').trim();
      return FluxKit.ui.omni.ListRow(`Weather in "${city}"`, 'cloud', 'Open-Meteo Forecast', 'Fetching...');
    }

    renderExpandedCard(data) {
      const modernFont = 'var(--omni-font)';
      const condition = this.getWeatherCondition(data.current.weather_code);

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', fontFamily: modernFont, padding: '4px 0' } });

      const headerRow = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });

      const tempBlock = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '16px' } });
      tempBlock.appendChild(createHTMLElement('div', { style: { fontSize: '48px' }, textContent: condition.icon }));

      const details = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column' } });
      details.appendChild(createHTMLElement('div', { style: { fontSize: '32px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: `${Math.round(data.current.temperature_2m)}°C` }));
      const conditionLine = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } });
      conditionLine.appendChild(createHTMLElement('span', { style: { fontSize: '15px', color: 'var(--omni-muted)', fontWeight: '500' }, textContent: condition.text }));
      if (data.current.apparent_temperature !== undefined) {
        conditionLine.appendChild(createHTMLElement('span', { style: { fontSize: '13px', color: 'var(--omni-muted)' }, textContent: `• Feels like ${Math.round(data.current.apparent_temperature)}°C` }));
      }
      details.appendChild(conditionLine);
      tempBlock.appendChild(details);
      headerRow.appendChild(tempBlock);

      const locationBlock = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right' } });
      locationBlock.appendChild(createHTMLElement('div', { style: { fontSize: '18px', fontWeight: '600', color: 'var(--omni-text)' }, textContent: `${data.name}, ${data.country}` }));

      if (data.daily && data.daily.temperature_2m_max) {
        const high = Math.round(data.daily.temperature_2m_max[0]);
        const low = Math.round(data.daily.temperature_2m_min[0]);
        locationBlock.appendChild(createHTMLElement('div', { style: { fontSize: '14px', color: 'var(--omni-muted)', marginTop: '4px' }, textContent: `H: ${high}°C • L: ${low}°C` }));
      }

      if (data.isStale) {
        locationBlock.appendChild(createHTMLElement('div', { style: { fontSize: '11px', color: 'var(--omni-warning)', fontWeight: '700', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', gap: '6px' }, icon: 'loader', textContent: 'Updating Live...' }));
      }
      headerRow.appendChild(locationBlock);
      container.appendChild(headerRow);

      const detailsGrid = createHTMLElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', borderTop: '1px solid var(--omni-separator)', paddingTop: '14px' } });

      const makeDetail = (label, value) => {
        const cell = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
        cell.appendChild(createHTMLElement('div', { textContent: label, style: { fontSize: '11px', color: 'var(--omni-muted)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.4px' } }));
        cell.appendChild(createHTMLElement('div', { textContent: value, style: { fontSize: '14px', color: 'var(--omni-text)', fontWeight: '600', fontVariantNumeric: 'tabular-nums' } }));
        return cell;
      };

      const c = data.current;
      if (c.relative_humidity_2m !== undefined) detailsGrid.appendChild(makeDetail('Humidity', `${Math.round(c.relative_humidity_2m)}%`));
      if (c.wind_speed_10m !== undefined) {
        const dir = this.windDirectionLabel(c.wind_direction_10m);
        detailsGrid.appendChild(makeDetail('Wind', `${Math.round(c.wind_speed_10m)} km/h${dir ? ' ' + dir : ''}`));
      }
      if (c.wind_gusts_10m !== undefined) detailsGrid.appendChild(makeDetail('Gusts', `${Math.round(c.wind_gusts_10m)} km/h`));
      if (c.precipitation !== undefined) detailsGrid.appendChild(makeDetail('Precipitation', `${c.precipitation} mm`));
      if (data.daily && data.daily.precipitation_probability_max) detailsGrid.appendChild(makeDetail('Rain Chance', `${data.daily.precipitation_probability_max[0]}%`));
      if (data.daily && data.daily.uv_index_max) detailsGrid.appendChild(makeDetail('UV Index', `${Math.round(data.daily.uv_index_max[0])}`));
      if (data.daily && data.daily.sunrise) detailsGrid.appendChild(makeDetail('Sunrise', this.formatHourMinute(data.daily.sunrise[0], data.timezone)));
      if (data.daily && data.daily.sunset) detailsGrid.appendChild(makeDetail('Sunset', this.formatHourMinute(data.daily.sunset[0], data.timezone)));

      if (detailsGrid.children.length > 0) container.appendChild(detailsGrid);

      if (data.daily && data.daily.time && data.daily.time.length > 1) {
        const weekContainer = createHTMLElement('div', { style: { borderTop: '1px solid var(--omni-separator)', paddingTop: '14px' } });
        weekContainer.appendChild(createHTMLElement('div', {
          textContent: '7-Day Forecast',
          style: { fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--omni-muted)', marginBottom: '10px' }
        }));

        const weekRow = createHTMLElement('div', { style: { display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' } });

        for (let i = 0; i < data.daily.time.length; i++) {
          const dayCond = this.getWeatherCondition(data.daily.weather_code ? data.daily.weather_code[i] : null);
          const high = data.daily.temperature_2m_max ? Math.round(data.daily.temperature_2m_max[i]) : null;
          const low = data.daily.temperature_2m_min ? Math.round(data.daily.temperature_2m_min[i]) : null;
          const rainChance = data.daily.precipitation_probability_max ? data.daily.precipitation_probability_max[i] : null;

          const dayCell = createHTMLElement('div', {
            style: {
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
              padding: '10px 8px', borderRadius: '8px', minWidth: '64px', flexShrink: '0',
              background: i === 0 ? 'var(--omni-input-bg)' : 'transparent',
              border: i === 0 ? '1px solid var(--omni-border)' : '1px solid transparent',
              cursor: 'default'
            },
            fluxHubTooltip: dayCond.text
          });

          dayCell.appendChild(createHTMLElement('div', { textContent: this.formatDayLabel(data.daily.time[i], i), style: { fontSize: '11px', fontWeight: '700', color: 'var(--omni-muted)', textTransform: 'uppercase' } }));
          dayCell.appendChild(createHTMLElement('div', { textContent: dayCond.icon, style: { fontSize: '22px' } }));
          if (high !== null) dayCell.appendChild(createHTMLElement('div', { textContent: `${high}°`, style: { fontSize: '13px', fontWeight: '700', color: 'var(--omni-text)' } }));
          if (low !== null) dayCell.appendChild(createHTMLElement('div', { textContent: `${low}°`, style: { fontSize: '12px', color: 'var(--omni-muted)' } }));
          if (rainChance !== null && rainChance > 0) {
            dayCell.appendChild(createHTMLElement('div', { textContent: `💧${rainChance}%`, style: { fontSize: '10px', color: 'var(--omni-info)', fontWeight: '600', marginTop: '2px' } }));
          }

          weekRow.appendChild(dayCell);
        }

        weekContainer.appendChild(weekRow);
        container.appendChild(weekContainer);
      }

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    async execute() {
      const index = FluxHub.ui.currentViews.indexOf(this);
      const row = FluxHub.ui.resultsList.children[index];

      if (row && row.classList.contains('flx-omni-row')) row.style.opacity = '0.5';

      const data = await this.fetchData();

      if (data) FluxHub.ui.expandListItem(this, data);
      else {
        if (row) {
          const subtitle = row.querySelector('.flx-omni-subtitle');
          const hint = row.querySelector('.flx-omni-hint');
          if (subtitle) {
            subtitle.textContent = 'City not found. Try another name.';
            subtitle.style.color = 'var(--omni-danger)';
          }
          if (hint) hint.textContent = '';
          row.style.opacity = '1';
          row.style.pointerEvents = 'none';
        }
      }
    }
  }

  class GitHubView extends BaseView {
    static isAvailable = true;

    static matchConfidence(query) {
      const clean = query.trim().toLowerCase();
      if (clean.startsWith('@gh ') && clean.includes('/')) return 100;
      return 0;
    }

    async fetchData(signal) {
      const repoPath = this.query.trim().replace(/^@gh\s+/i, '').trim();
      if (!repoPath || repoPath.split('/').length !== 2) return null;

      const cacheKey = `gh_repo_${repoPath.toLowerCase()}`;
      const cached = await FluxHub.cache.get(cacheKey);
      if (cached) return cached;

      try {
        const url = `https://api.github.com/repos/${repoPath}`;
        const response = await safeFetch(url, signal);
        if (!response.ok) return null;

        const data = await response.json();
        await FluxHub.cache.set(cacheKey, data);
        return data;
      } catch (err) { return null; }
    }

    renderListRow() { return FluxKit.ui.omni.ListRow(`Fetch ${this.query.trim().replace(/^@gh\s+/i, '').trim()}`, 'code', 'GitHub Repository', 'Fetching...'); }

    renderExpandedCard(data) {
      this.isExpanded = true;
      this.expandedData = data;

      const modernFont = 'var(--omni-font)';

      const textContainer = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', gap: '10px', fontFamily: modernFont } });

      const headerRow = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
      headerRow.appendChild(createHTMLElement('img', { src: data.owner.avatar_url, style: { width: '28px', height: '28px', borderRadius: '50%', border: '1px solid var(--omni-border)' } }));
      headerRow.appendChild(createHTMLElement('div', { style: { fontSize: '18px', fontWeight: 'bold', color: 'var(--omni-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, textContent: data.full_name }));
      textContainer.appendChild(headerRow);

      if (data.description) {
        textContainer.appendChild(createHTMLElement('div', { style: { fontSize: '14px', lineHeight: '1.4', color: 'var(--omni-text)', opacity: '0.9' }, textContent: data.description }));
      }

      if (data.topics && data.topics.length > 0) {
        const topicsRow = createHTMLElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
        data.topics.slice(0, 8).forEach(topic => {
          topicsRow.appendChild(createHTMLElement('span', {
            textContent: topic,
            style: { fontSize: '11px', padding: '2px 8px', borderRadius: '12px', background: 'var(--omni-hover)', color: 'var(--omni-accent)', border: '1px solid var(--omni-border)' }
          }));
        });
        textContainer.appendChild(topicsRow);
      }

      const statsRow = createHTMLElement('div', { style: { display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--omni-muted)', fontWeight: '500' } });
      statsRow.appendChild(createHTMLElement('span', { icon: 'shine', textContent: `${data.stargazers_count.toLocaleString()}`, style: { display: 'flex', gap: '4px' }  }));
      statsRow.appendChild(createHTMLElement('span', { textContent: `🍴 ${data.forks_count.toLocaleString()}` }));
      if (data.language) statsRow.appendChild(createHTMLElement('span', { icon: 'json', textContent: `${data.language}`, style: { display: 'flex', gap: '4px' } }));
      if (data.license && data.license.spdx_id) statsRow.appendChild(createHTMLElement('span', { textContent: `⚖️ ${data.license.spdx_id}` }));
      textContainer.appendChild(statsRow);

      if (data.clone_url) {
        const cloneRow = createHTMLElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--omni-input-bg)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--omni-border)' }
        });
        const cloneInput = createHTMLElement('input', {
          type: 'text',
          value: `git clone ${data.clone_url}`,
          readOnly: true,
          style: { flexGrow: '1', background: 'transparent', border: 'none', color: 'var(--omni-text)', fontSize: '12px', fontFamily: 'monospace', outline: 'none' },
          eventListener: { focus: (e) => e.target.select() }
        });
        const copyBtn = createHTMLElement('button', {
          icon: 'copy', fluxHubTooltip: 'Copy to clipboard',
          style: { background: 'transparent', border: 'none', color: 'var(--omni-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', fontSize: '14px' },
          eventListener: {
            click: (e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(cloneInput.value);
              copyBtn.innerHTML = safeHTML(`${FluxKit.ui.getIcon('success')}`);
              setTimeout(() => {
                copyBtn.innerHTML = safeHTML(`${FluxKit.ui.getIcon('copy')}`);
              }, 1500);
            }
          }
        });
        cloneRow.appendChild(cloneInput);
        cloneRow.appendChild(copyBtn);
        textContainer.appendChild(cloneRow);
      }

      const bodyContainer = createHTMLElement('div', { children: [textContainer] });

      const actions = [];

      if (data.homepage) {
        const homeUrl = data.homepage.startsWith('http') ? data.homepage : `https://${data.homepage}`;
        const homeBtn = FluxKit.ui.omni.Button('link', 'Homepage', e => {
          e.stopPropagation();
          GM_openInTab(homeUrl, { active: true, insert: true });
          FluxHub.ui.hide();
        });
        actions.push(homeBtn);
      }

      const openBtn = FluxKit.ui.omni.Button('externalLink', 'Open Repository', e => {
            e.stopPropagation();
            GM_openInTab(data.html_url, { active: true, insert: true });
            FluxHub.ui.hide();
        }
      );
      openBtn.style.background = 'var(--omni-accent)';
      openBtn.style.color = 'var(--omni-btn-text)';
      actions.push(openBtn);

      return FluxKit.ui.omni.DetailCard(bodyContainer, actions);
    }

    async execute() {
      if (this.isExpanded && this.expandedData && this.expandedData.html_url) {
        GM_openInTab(this.expandedData.html_url, { active: true, insert: true });
        FluxHub.ui.hide();
        return;
      }
      const data = await this.fetchData();
      if (data) FluxHub.ui.expandListItem(this, data);
      else {
        const repoPath = this.query.trim().replace(/^@gh\s+/i, '').trim();
        const url = `https://github.com/search?q=${encodeURIComponent(repoPath)}`;
        GM_openInTab(url, { active: true, insert: true });
        FluxHub.ui.hide();
      }
    }

    destroy() { this.isExpanded = false; this.expandedData = null; }
  }

  FluxKit.api = {
    ...FluxKit.api,
    gmFetch: function(url, options = {}) {
      return new Promise((resolve, reject) => {
        if (options.signal && options.signal.aborted) return reject({ name: 'AbortError' });
        const req = GM_xmlhttpRequest({
          method: options.method || 'GET',
          url: url,
          headers: options.headers || {},
          data: options.body || undefined,
          onload: (res) => {
            resolve({
              ok: res.status >= 200 && res.status < 300,
              status: res.status,
              text: async () => res.responseText,
              json: async () => JSON.parse(res.responseText)
            });
          },
          onerror: (err) => reject(err),
          onabort: () => reject({ name: 'AbortError' })
        });
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            if (req && typeof req.abort === 'function') req.abort();
          });
        }
      });
    },
    music: {
      _scAuthPromise: null,
      _proxyBase: 'https://proxy-alpha-ivory.vercel.app/api/proxy?target=',

      _resolveAudioStream: async function(trackMeta, signal = null, forceRefresh = false) {
        trackMeta.resolution ??= { whitelistId: null, whitelistSource: null, whitelistUrl: null, blacklist: [] };
        const res = trackMeta.resolution;

        if (!forceRefresh && res.whitelistSource === 'saavn' && res.whitelistUrl) {
          return res.whitelistUrl;
        }

        if (forceRefresh && res.whitelistSource === 'saavn') {
          res.whitelistUrl = null;
        }

        const cleanTitle = trackMeta.title
          .replace(/\(feat\..*?\)/gi, '')
          .replace(/\(with.*?\)/gi, '')
          .replace(/\- .*?remaster.*/gi, '')
          .replace(/\- radio edit/gi, '')
          .trim();

        const query = `${cleanTitle} ${trackMeta.artist}`.replace(/[\(\)\[\]]/g, '').trim();
        const targetDuration = trackMeta.durationMs;
        const marginOfError = 15000;

        const rankCandidates = (tracks, identifierFn) => {
          if (!tracks.length) return [];
          const notBlacklisted = tracks.filter(t => {
            const id = identifierFn(t);
            return !id || !res.blacklist.includes(id);
          });
          if (!notBlacklisted.length) return [];

          if (res.whitelistId) {
            const whitelisted = notBlacklisted.find(t => identifierFn(t) === res.whitelistId);
            if (whitelisted) return [whitelisted];
          }

          if (targetDuration <= 0) return notBlacklisted;
          const valid = notBlacklisted.filter(t => Math.abs(t.durationMs - targetDuration) <= marginOfError && t.streamUrl);
          valid.sort((a, b) => Math.abs(a.durationMs - targetDuration) - Math.abs(b.durationMs - targetDuration));
          return valid;
        };

        const saavnPromise = (async () => {
          if (res.whitelistSource && res.whitelistSource !== 'saavn' && !forceRefresh) return null;
          try {
            const saavnBase = FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, '').replace(/\/$/, '');
            if (!saavnBase) return null;

            const saavnRes = await FluxKit.api.gmFetch(`${saavnBase}/api/search/songs?query=${encodeURIComponent(query)}&limit=5`, { signal });
            if (!saavnRes.ok) return null;

            const saavnData = await saavnRes.json();
            const saavnArray = saavnData?.data?.results || saavnData?.results || [];
            const mappedSaavn = saavnArray.map(t => this._mapSaavnTrack(t)).filter(t => t !== null);
            const ranked = rankCandidates(mappedSaavn, t => t.id);

            if (!ranked.length) {
              if (forceRefresh && res.whitelistSource === 'saavn') {
                res.whitelistId = null;
                res.whitelistSource = null;
              }
              return null;
            }

            const winner = ranked[0];
            res.whitelistId = winner.id;
            res.whitelistSource = 'saavn';
            res.whitelistUrl = winner.streamUrl;
            return winner.streamUrl;
          } catch (e) { return null; }
        })();

        const scPromise = (async () => {
          if (res.whitelistSource && res.whitelistSource !== 'soundcloud' && !forceRefresh) return null;
          try {
            const clientId = await this._getSoundCloudClientId();
            const scUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=5`;

            const scRes = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(scUrl)}`, { signal });
            if (!scRes.ok) return null;

            const scData = await scRes.json();
            if (!scData.collection) return null;

            const mappedSc = scData.collection.map(item => {
              const progressive = item.media?.transcodings?.find(t => t.format && t.format.protocol === 'progressive');
              if (!progressive) return null;
              const authParam = item.track_authorization ? `&track_authorization=${encodeURIComponent(item.track_authorization)}` : '';
              return { durationMs: item.duration || 0, streamUrl: `${progressive.url}?client_id=${clientId}${authParam}`, identifier: item.id.toString() };
            }).filter(t => t !== null);

            if (!mappedSc.length) return null;

            const durationRanked = targetDuration > 0
              ? mappedSc
                  .filter(t => Math.abs(t.durationMs - targetDuration) <= marginOfError)
                  .sort((a, b) => Math.abs(a.durationMs - targetDuration) - Math.abs(b.durationMs - targetDuration))
              : mappedSc;

            if (!durationRanked.length) return null;

            let fallbackUrl = null, fallbackId = null;

            for (const candidate of durationRanked) {
              if (res.blacklist.includes(candidate.identifier)) continue;
              const resolved = await this._resolveSoundCloudStreamUrl(candidate.streamUrl, signal);
              if (!resolved) continue;

              if (!candidate.identifier) {
                if (!fallbackUrl) fallbackUrl = resolved;
                continue;
              }

              if (res.whitelistId && candidate.identifier === res.whitelistId) {
                res.whitelistSource = 'soundcloud';
                res.whitelistUrl = null;
                return resolved;
              }
              if (!fallbackUrl) { fallbackUrl = resolved; fallbackId = candidate.identifier; }
            }

            if (!fallbackUrl) return null;

            res.whitelistId = fallbackId;
            res.whitelistSource = 'soundcloud';
            res.whitelistUrl = null;
            return fallbackUrl;
          } catch (e) { return null; }
        })();

        const saavnUrl = await saavnPromise;
        if (saavnUrl) return saavnUrl;

        const scUrl = await scPromise;
        if (scUrl) return scUrl;

        throw new Error('Federated resolution failed. No matching audio found.');
      },

      _rerollTrack: async function(trackMeta, signal = null) {
        trackMeta.resolution ??= { whitelistId: null, whitelistSource: null, whitelistUrl: null, blacklist: [] };
        const res = trackMeta.resolution;

        if (res.whitelistId) {
          res.blacklist.unshift(res.whitelistId);
          if (res.blacklist.length > 8) res.blacklist.length = 8;
        }
        res.whitelistId = null;
        res.whitelistSource = null;
        res.whitelistUrl = null;

        try {
          const url = await this._resolveAudioStream(trackMeta, signal);
          return { url, wrapped: false };
        } catch (e) {
          if (!res.blacklist.length) throw e;
          res.blacklist.length = 0;
          const url = await this._resolveAudioStream(trackMeta, signal);
          return { url, wrapped: true };
        }
      },

      _resolveSoundCloudStreamUrl: async function(rawProgressiveUrl, signal = null) {
        try {
          const proxiedUrl = `${this._proxyBase}${encodeURIComponent(rawProgressiveUrl)}`;
          const res = await FluxKit.api.gmFetch(proxiedUrl, { signal });
          if (!res.ok) return null;
          const data = await res.json();
          return (data && data.url) ? data.url : null;
        } catch (e) { return null; }
      },

      _refreshSoundCloudTrackUrl: async function(trackId, signal = null) {
        try {
          const clientId = await this._getSoundCloudClientId();
          const res = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(`https://api-v2.soundcloud.com/tracks/${trackId}?client_id=${clientId}`)}`, { signal });
          if (!res.ok) return null;

          const t = await res.json();
          const progressive = t.media?.transcodings?.find(tr => tr.format && tr.format.protocol === 'progressive');
          if (!progressive) return null;

          const authParam = t.track_authorization ? `&track_authorization=${encodeURIComponent(t.track_authorization)}` : '';
          const rawUrl = `${progressive.url}?client_id=${clientId}${authParam}`;
          return this._resolveSoundCloudStreamUrl(rawUrl, signal);
        } catch (e) { return null; }
      },

      _getSoundCloudClientId: async function() {
        if (this._scAuthPromise) return this._scAuthPromise;

        this._scAuthPromise = new Promise(async (resolve) => {
          const fallbackId = 'tYMMRueXj0o6XG54pTXYwU8C94pA4J9v';
          const cached = await FluxHub.cache.get('sc_client_id');
          if (cached) return resolve(cached);

          try {
            const htmlRes = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent('https://soundcloud.com/')}`);
            if (!htmlRes.ok) throw new Error(`Status ${htmlRes.status}`);

            const html = await htmlRes.text();
            const scripts = [...html.matchAll(/src="(https:\/\/[^"]+\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);

            if (!scripts.length) throw new Error('No JS bundles found');

            const jsRes = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(scripts[scripts.length - 1])}`);
            if (!jsRes.ok) throw new Error(`Status ${jsRes.status}`);

            const js = await jsRes.text();
            const match = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/);

            if (match && match[1]) {
              FluxHub.cache.set('sc_client_id', match[1], 86400000 * 7);
              resolve(match[1]);
            } else { throw new Error('Regex failed'); }
          } catch (e) { resolve(fallbackId); }
        });

        return this._scAuthPromise;
      },

      _mapSaavnTrack: function(t) {
        if (!t) return null;
        const streamObj = t.downloadUrl || t.media_url || t.songs || [];
        const imgObj = t.image || t.image_url || [];
        const getBestUrl = (arr, qualityKeys) => {
          if (!Array.isArray(arr)) return typeof arr === 'string' ? arr : '';
          for (const q of qualityKeys) {
            const item = arr.find(x => typeof x.quality === 'string' && x.quality.includes(q));
            if (item && (item.url || item.link)) return item.url || item.link;
          }
          return arr[arr.length - 1]?.url || arr[arr.length - 1]?.link || '';
        };
        let artistList = 'Unknown Artist';
        if (t.artists?.primary && Array.isArray(t.artists.primary)) artistList = t.artists.primary.map(a => a.name).join(', ');
        else if (typeof t.primaryArtists === 'string') artistList = t.primaryArtists;
        else if (typeof t.artists === 'string') artistList = t.artists;

        const streamUrl = getBestUrl(streamObj, ['320', '160', '96']);
        if (!streamUrl) return null;

        return {
          id: t.id ? t.id.toString() : Math.random().toString(),
          title: t.name || t.song || t.title || 'Unknown Title',
          artist: artistList,
          cover: getBestUrl(imgObj, ['500', '150']),
          streamUrl: streamUrl,
          durationMs: parseInt(t.duration || 0) * 1000,
          provider: 'saavn'
        };
      },

      _mapAudiusTrack: function(t) {
        if (!t) return null;
        return {
          id: t.id ? t.id.toString() : Math.random().toString(),
          title: t.title || 'Unknown Title',
          artist: t.user?.name || 'Unknown Artist',
          cover: t.artwork ? (t.artwork['480x480'] || t.artwork['150x150']) : '',
          streamUrl: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream?app_name=FluxHub`,
          durationMs: parseInt(t.duration || 0) * 1000,
          provider: 'audius'
        };
      },

      _mapItunesTrack: function(t) {
        if (!t || !t.previewUrl) return null;
        return {
          id: t.trackId ? t.trackId.toString() : Math.random().toString(),
          title: t.trackName || 'Unknown Title',
          artist: t.artistName || 'Unknown Artist',
          cover: t.artworkUrl100 ? t.artworkUrl100.replace('100x100bb', '300x300bb') : '',
          streamUrl: t.previewUrl,
          durationMs: t.trackTimeMillis || 0,
          provider: 'itunes'
        };
      },

      _mapItunesHubTrack: function(t) {
        if (!t) return null;
        return {
          id: t.trackId ? t.trackId.toString() : Math.random().toString(),
          title: t.trackName || 'Unknown Title',
          artist: t.artistName || 'Unknown Artist',
          cover: t.artworkUrl100 ? t.artworkUrl100.replace('100x100bb', '300x300bb') : '',
          streamUrl: 'RESOLVE_JIT',
          previewUrl: t.previewUrl || null,
          durationMs: t.trackTimeMillis || 0
        };
      },

      search: async function(query, limit = 10, signal = null) {
        if (!query) return [];

        const provider = FluxHubState.get(STATE_KEYS.MUSIC_PROVIDER, 'itunes_hub');
        const cacheKey = `${provider}_search_${query.toLowerCase()}`;

        if (provider !== 'soundcloud') {
          const cached = await FluxHub.cache.get(cacheKey);
          if (cached) return cached;
        }

        return new Promise(async (resolve, reject) => {
          if (signal && signal.aborted) return reject({ name: 'AbortError' });

          if (provider === 'soundcloud') {
            try {
              const clientId = await this._getSoundCloudClientId();
              if (signal && signal.aborted) return reject({ name: 'AbortError' });

              const rawSearchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=${limit}`;

              const res = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(rawSearchUrl)}`, { signal });
              if (!res.ok) return resolve([]);

              const data = await res.json();
              if (!data.collection) return resolve([]);

              const streamPromises = data.collection.map(async (item) => {
                if (!item.media || !item.media.transcodings) return null;
                const progressive = item.media.transcodings.find(t => t.format && t.format.protocol === 'progressive');
                if (!progressive) return null;

                const authParam = item.track_authorization ? `&track_authorization=${encodeURIComponent(item.track_authorization)}` : '';
                return {
                  id: item.id.toString(), title: item.title, artist: item.user?.username || 'Unknown Artist',
                  cover: item.artwork_url ? item.artwork_url.replace('-large', '-t500x500') : '',
                  streamUrl: `${progressive.url}?client_id=${clientId}${authParam}`,
                  durationMs: item.duration || 0,
                  resolution: { whitelistId: item.id.toString(), whitelistSource: 'soundcloud', whitelistUrl: null, blacklist: [], ambiguous: false }
                };
              });

              const results = await Promise.all(streamPromises);
              resolve(results.filter(t => t !== null));
            } catch (err) { resolve([]); }
            return;
          }

          let url = '';
          const saavnBase = FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, '').replace(/\/$/, '');
          if (provider === 'saavn' && saavnBase) url = `${saavnBase}/api/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`;
          else if (provider === 'audius') url = `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=FluxHub`;
          else url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}`;

          GM_xmlhttpRequest({
            method: 'GET', url: url, timeout: 6000,
            onload: res => {
              if (res.status >= 200 && res.status < 300) {
                try {
                  const data = JSON.parse(res.responseText);
                  let tracks = [];

                  if (provider === 'saavn') {
                    const resultsArray = data?.data?.results || data?.results || (Array.isArray(data?.data) ? data.data : []);
                    tracks = resultsArray.map(t => this._mapSaavnTrack(t)).filter(t => t !== null);
                  }
                  else if (provider === 'audius' && data.data) tracks = data.data.slice(0, limit).map(t => this._mapAudiusTrack(t)).filter(t => t !== null);
                  else if (provider === 'itunes' && data.results) tracks = data.results.map(t => this._mapItunesTrack(t)).filter(t => t !== null);
                  else if (provider === 'itunes_hub' && data.results) tracks = data.results.map(t => this._mapItunesHubTrack(t)).filter(t => t !== null);

                  if (tracks.length > 0) FluxHub.cache.set(cacheKey, tracks, 86400000);
                  resolve(tracks);
                } catch (e) { resolve([]); }
              } else { resolve([]); }
            },
            onabort: () => reject({ name: 'AbortError' })
          });
        });
      },

      discover: async function(type = 'trending', limit = 15, signal = null) {
        const provider = FluxHubState.get(STATE_KEYS.MUSIC_PROVIDER, 'itunes_hub');
        const cacheKey = `${provider}_discover_${type}`;

        if (provider !== 'soundcloud') {
          const cached = await FluxHub.cache.get(cacheKey);
          if (cached) return cached;
        }

        return new Promise(async (resolve, reject) => {
          if (signal && signal.aborted) return reject({ name: 'AbortError' });
          try {
            if (provider === 'soundcloud') {
              const clientId = await this._getSoundCloudClientId();
              const res = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(`https://api-v2.soundcloud.com/charts?kind=trending&genre=soundcloud:genres:all-music&client_id=${clientId}&limit=${limit}`)}`, { signal });
              if (!res.ok) return resolve([]);
              const data = await res.json();
              if (!data.collection) return resolve([]);

              const streamPromises = data.collection.map(async (item) => {
                const t = item.track;
                if (!t || !t.media || !t.media.transcodings) return null;
                const progressive = t.media.transcodings.find(tr => tr.format && tr.format.protocol === 'progressive');
                if (!progressive) return null;
                const authParam = t.track_authorization ? `&track_authorization=${encodeURIComponent(t.track_authorization)}` : '';
                return {
                  id: t.id.toString(), title: t.title, artist: t.user?.username || 'Unknown',
                  cover: t.artwork_url ? t.artwork_url.replace('-large', '-t500x500') : '',
                  streamUrl: `${progressive.url}?client_id=${clientId}${authParam}`,
                  durationMs: t.duration || 0,
                  resolution: { whitelistId: t.id.toString(), whitelistSource: 'soundcloud', whitelistUrl: null, blacklist: [], ambiguous: false }
                };
              });
              resolve((await Promise.all(streamPromises)).filter(t => t !== null));
              return;
            }

            let url = '';
            const saavnBase = FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, '').replace(/\/$/, '');
            if (provider === 'saavn' && saavnBase) {
              const fallbackQuery = type === 'trending' ? 'top hits' : type;
              url = `${saavnBase}/api/search/songs?query=${encodeURIComponent(fallbackQuery)}&limit=${limit}`;
            }
            else if (provider === 'audius') url = `https://discoveryprovider.audius.co/v1/tracks/trending?app_name=FluxHub&limit=${limit}`;
            else url = `https://itunes.apple.com/us/rss/topsongs/limit=${limit}/json`;

            GM_xmlhttpRequest({
              method: 'GET', url, timeout: 6000,
              onload: res => {
                if (res.status === 200) {
                  try {
                    const data = JSON.parse(res.responseText);
                    let tracks = [];
                    if (provider === 'saavn') {
                      const resultsArray = data?.data?.results || data?.results || (Array.isArray(data?.data) ? data.data : []);
                      tracks = resultsArray.map(t => this._mapSaavnTrack(t)).filter(t => t !== null);
                    }
                    else if (provider === 'audius' && data.data) tracks = data.data.map(t => this._mapAudiusTrack(t)).filter(t => t !== null);
                    else if ((provider === 'itunes' || provider === 'itunes_hub') && data.feed?.entry) {
                      tracks = data.feed.entry.map(t => {
                        const link = t.link.find(l => l.attributes?.rel === 'enclosure');
                        if (provider === 'itunes' && !link) return null;
                        const img = t['im:image'] ? t['im:image'][t['im:image'].length - 1].label : '';
                        return {
                          id: t.id.attributes['im:id'], title: t['im:name'].label, artist: t['im:artist'].label,
                          cover: img.replace('170x170', '300x300'),
                          streamUrl: provider === 'itunes_hub' ? 'RESOLVE_JIT' : link.attributes.href,
                          previewUrl: link ? link.attributes.href : null,
                          durationMs: provider === 'itunes_hub' ? 0 : 30000
                        };
                      }).filter(t => t);
                    }
                    if (tracks.length > 0) FluxHub.cache.set(cacheKey, tracks, 86400000);
                    resolve(tracks);
                  } catch(e) { resolve([]); }
                } else resolve([]);
              },
              onabort: () => reject({ name: 'AbortError' })
            });
          } catch(e) { resolve([]); }
        });
      },

      searchPlaylists: async function(query, limit = 10, signal = null) {
        if (!query) return [];
        const provider = FluxHubState.get(STATE_KEYS.MUSIC_PROVIDER, 'itunes_hub');
        const cacheKey = `${provider}_search_pl_${query.toLowerCase()}`;

        const cached = await FluxHub.cache.get(cacheKey);
        if (cached) return cached;

        return new Promise(async (resolve, reject) => {
          if (signal && signal.aborted) return reject({ name: 'AbortError' });

          if (provider === 'soundcloud') {
            try {
              const clientId = await this._getSoundCloudClientId();
              const res = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(`https://api-v2.soundcloud.com/search/playlists?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=${limit}`)}`, { signal });
              if (!res.ok) {
                logWarning(`SoundCloud playlist search HTTP ${res.status}`);
                return resolve([]);
              }
              const data = await res.json();
              if (!Array.isArray(data.collection) || data.collection.length === 0) {
                logWarning('SoundCloud returned no playlist collection for query:', query, data);
                return resolve([]);
              }

              const playlists = data.collection
                .filter(p => p && p.id != null && (p.kind === 'playlist' || p.kind === 'system-playlist' || p.track_count !== undefined))
                .map(p => ({
                  id: p.id.toString(), title: p.title || 'Untitled Playlist', creator: p.user?.username || 'Unknown',
                  cover: p.artwork_url ? p.artwork_url.replace('-large', '-t500x500') : (p.user?.avatar_url || ''),
                  trackCount: p.track_count || 0, provider: 'soundcloud'
                }));

              if (!playlists.length) {
                logWarning('SoundCloud collection existed but no items passed the playlist filter:', data.collection);
              }

              FluxHub.cache.set(cacheKey, playlists, 86400000);
              resolve(playlists);
            } catch(e) {
              logError('SoundCloud playlist search threw:', e);
              resolve([]);
            }
            return;
          }

          let url = '';
          const saavnBase = FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, '').replace(/\/$/, '');
          if (provider === 'saavn' && saavnBase) url = `${saavnBase}/api/search/playlists?query=${encodeURIComponent(query)}&limit=${limit}`;
          else if (provider === 'audius') url = `https://discoveryprovider.audius.co/v1/playlists/search?query=${encodeURIComponent(query)}&app_name=FluxHub&limit=${limit}`;
          else url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=${limit}`;

          GM_xmlhttpRequest({
            method: 'GET', url, timeout: 6000,
            onload: res => {
              if (res.status === 200) {
                try {
                  const data = JSON.parse(res.responseText);
                  let pls = [];
                  if (provider === 'saavn') {
                    pls = (data?.data?.results || data?.results || []).map(p => ({
                      id: p.id, title: p.title || p.name, creator: p.subtitle || p.language || 'Unknown',
                      cover: p.image && Array.isArray(p.image) ? (p.image[p.image.length-1]?.url || p.image[p.image.length-1]?.link) : '',
                      trackCount: p.songCount || 0, provider: 'saavn'
                    }));
                  } else if (provider === 'audius' && data.data) {
                    pls = data.data.map(p => ({
                      id: p.id, title: p.playlist_name, creator: p.user?.name || 'Unknown',
                      cover: p.artwork ? (p.artwork['480x480'] || p.artwork['150x150']) : '',
                      trackCount: p.playlist_contents?.track_ids?.length || 0, provider: 'audius'
                    }));
                  } else if ((provider === 'itunes' || provider === 'itunes_hub') && data.results) {
                    pls = data.results.map(p => ({
                      id: p.collectionId, title: p.collectionName, creator: p.artistName,
                      cover: p.artworkUrl100 ? p.artworkUrl100.replace('100x100bb', '300x300bb') : '',
                      trackCount: p.trackCount || 0, provider
                    }));
                  }
                  if (pls.length > 0) FluxHub.cache.set(cacheKey, pls, 86400000);
                  resolve(pls);
                } catch(e) { resolve([]); }
              } else resolve([]);
            },
            onabort: () => reject({ name: 'AbortError' })
          });
        });
      },

      searchAlbums: async function(query, limit = 10, signal = null) {
        if (!query) return [];
        const provider = FluxHubState.get(STATE_KEYS.MUSIC_PROVIDER, 'itunes_hub');

        if (provider === 'itunes' || provider === 'itunes_hub') {
          return this.searchPlaylists(query, limit, signal);
        }

        const cacheKey = `${provider}_search_al_${query.toLowerCase()}`;
        const cached = await FluxHub.cache.get(cacheKey);
        if (cached) return cached;

        return new Promise(async (resolve, reject) => {
          if (signal && signal.aborted) return reject({ name: 'AbortError' });

          if (provider === 'soundcloud') {
            try {
              const clientId = await this._getSoundCloudClientId();
              const res = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(`https://api-v2.soundcloud.com/search/albums?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=${limit}`)}`, { signal });

              if (!res.ok) {
                logWarning(`SoundCloud album search HTTP ${res.status}`);
                return resolve([]);
              }

              const data = await res.json();
              if (!Array.isArray(data.collection) || data.collection.length === 0) {
                logWarning('SoundCloud returned no album collection for query:', query, data);
                return resolve([]);
              }

              const albums = data.collection
                .filter(p => p && p.id != null)
                .map(p => ({
                  id: p.id.toString(), title: p.title || 'Untitled Album', creator: p.user?.username || 'Unknown',
                  cover: p.artwork_url ? p.artwork_url.replace('-large', '-t500x500') : (p.user?.avatar_url || ''),
                  trackCount: p.track_count || 0, provider: 'soundcloud', collectionType: 'album'
                }));

              FluxHub.cache.set(cacheKey, albums, 86400000);
              resolve(albums);
            } catch(e) {
              logError('SoundCloud album search threw:', e);
              resolve([]);
            }
            return;
          }

          if (provider === 'saavn') {
            const saavnBase = FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, '').replace(/\/$/, '');
            if (!saavnBase) return resolve([]);

            GM_xmlhttpRequest({
              method: 'GET', url: `${saavnBase}/api/search/albums?query=${encodeURIComponent(query)}&limit=${limit}`, timeout: 6000,
              onload: res => {
                if (res.status === 200) {
                  try {
                    const data = JSON.parse(res.responseText);
                    const resultsArray = data?.data?.results || data?.results || [];
                    const albums = resultsArray.map(p => ({
                      id: p.id, title: p.title || p.name, creator: p.artist || p.subtitle || 'Unknown',
                      cover: p.image && Array.isArray(p.image) ? (p.image[p.image.length-1]?.url || p.image[p.image.length-1]?.link) : '',
                      trackCount: p.songCount || p.songs?.length || 0, provider: 'saavn', collectionType: 'album'
                    }));
                    if (albums.length > 0) FluxHub.cache.set(cacheKey, albums, 86400000);
                    resolve(albums);
                  } catch(e) { resolve([]); }
                } else resolve([]);
              },
              onabort: () => reject({ name: 'AbortError' })
            });
            return;
          }

          if (provider === 'audius') {
            try {
              const res = await FluxKit.api.gmFetch(`https://discoveryprovider.audius.co/v1/playlists/search?query=${encodeURIComponent(query)}&app_name=FluxHub`, { signal });
              if (!res.ok) return resolve([]);
              const data = await res.json();
              if (!data.data) return resolve([]);

              const albums = data.data
                .filter(p => p.is_album === true)
                .map(p => ({
                  id: p.id, title: p.playlist_name, creator: p.user?.name || 'Unknown',
                  cover: p.artwork ? (p.artwork['480x480'] || p.artwork['150x150']) : '',
                  trackCount: p.playlist_contents?.track_ids?.length || 0, provider: 'audius', collectionType: 'album'
                }));

              if (albums.length > 0) FluxHub.cache.set(cacheKey, albums, 86400000);
              resolve(albums);
            } catch(e) { resolve([]); }
            return;
          }

          resolve([]);
        });
      },

      searchArtists: async function(query, limit = 10, signal = null) {
        if (!query) return [];
        const provider = FluxHubState.get(STATE_KEYS.MUSIC_PROVIDER, 'itunes_hub');
        const cacheKey = `${provider}_search_ar_${query.toLowerCase()}`;

        const cached = await FluxHub.cache.get(cacheKey);
        if (cached) return cached;

        return new Promise(async (resolve, reject) => {
          if (signal && signal.aborted) return reject({ name: 'AbortError' });

          if (provider === 'soundcloud') {
            try {
              const clientId = await this._getSoundCloudClientId();
              const res = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(`https://api-v2.soundcloud.com/search/users?q=${encodeURIComponent(query)}&client_id=${clientId}&limit=${limit}`)}`, { signal });

              if (!res.ok) return resolve([]);
              const data = await res.json();
              if (!Array.isArray(data.collection) || data.collection.length === 0) return resolve([]);

              const artists = data.collection
                .filter(p => p && p.id != null)
                .map(p => ({
                  id: p.id.toString(), title: p.username || p.full_name || 'Unknown Artist', creator: p.full_name || 'Artist',
                  cover: p.avatar_url ? p.avatar_url.replace('-large', '-t500x500') : '',
                  trackCount: p.track_count || 0, provider: 'soundcloud', collectionType: 'artist'
                }));

              FluxHub.cache.set(cacheKey, artists, 86400000);
              resolve(artists);
            } catch(e) { resolve([]); }
            return;
          }

          let url = '';
          const saavnBase = FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, '').replace(/\/$/, '');
          
          if (provider === 'saavn' && saavnBase) url = `${saavnBase}/api/search/artists?query=${encodeURIComponent(query)}&limit=${limit}`;
          else if (provider === 'audius') url = `https://discoveryprovider.audius.co/v1/users/search?query=${encodeURIComponent(query)}&app_name=FluxHub&limit=${limit}`;
          else url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=musicArtist&limit=${limit}`;

          GM_xmlhttpRequest({
            method: 'GET', url, timeout: 6000,
            onload: res => {
              if (res.status === 200) {
                try {
                  const data = JSON.parse(res.responseText);
                  let artists = [];
                  
                  if (provider === 'saavn') {
                    const resultsArray = data?.data?.results || data?.results || [];
                    resultsArray.forEach(p => {
                      const img = p.image && Array.isArray(p.image) ? (p.image[p.image.length-1]?.url || p.image[p.image.length-1]?.link) : (typeof p.image === 'string' ? p.image : '');
                      
                      artists.push({
                        id: p.id, title: p.title || p.name, creator: 'Top Songs',
                        cover: img, trackCount: undefined, provider: 'saavn', collectionType: 'artist_top'
                      });

                      /* singles object doesn't return stream url
                        artists.push({
                          id: p.id, title: p.title || p.name, creator: 'Singles & Releases',
                          cover: img, trackCount: undefined, provider: 'saavn', collectionType: 'artist_singles'
                        });
                      */
                    });
                  } else if (provider === 'audius' && data.data) {
                    artists = data.data.map(p => ({
                      id: p.id, title: p.name, creator: '@' + p.handle,
                      cover: p.profile_picture ? (p.profile_picture['480x480'] || p.profile_picture['150x150']) : '',
                      trackCount: p.track_count || 0, provider: 'audius', collectionType: 'artist'
                    }));
                  } else if ((provider === 'itunes' || provider === 'itunes_hub') && data.results) {
                    artists = data.results.map(p => ({
                      id: p.artistId, title: p.artistName, creator: p.primaryGenreName || 'Artist',
                      cover: '',
                      trackCount: undefined, provider, collectionType: 'artist'
                    }));
                  }
                  
                  if (artists.length > 0) FluxHub.cache.set(cacheKey, artists, 86400000);
                  resolve(artists);
                } catch(e) { resolve([]); }
              } else resolve([]);
            },
            onabort: () => reject({ name: 'AbortError' })
          });
        });
      },

      getPlaylistTracks: async function(playlistId, provider, type, signal = null) {
        return new Promise(async (resolve, reject) => {
          if (provider === 'soundcloud') {
            try {
              const clientId = await this._getSoundCloudClientId();
              let fullTracks = [];
              let stubTrackIds = [];
              if (type === 'artist') {
                const res = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(`https://api-v2.soundcloud.com/users/${playlistId}/tracks?client_id=${clientId}&limit=50`)}`, { signal });
                if (!res.ok) return resolve([]);
                const data = await res.json();
                if (!data.collection || !data.collection.length) return resolve([]);
                fullTracks = data.collection.filter(t => t && t.media && t.media.transcodings);
                stubTrackIds = data.collection.filter(t => t && (!t.media || !t.media.transcodings)).map(t => t.id);
              } else {
                const res = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(`https://api-v2.soundcloud.com/playlists/${playlistId}?client_id=${clientId}`)}`, { signal });
                if (!res.ok) return resolve([]);
                const data = await res.json();
                if (!data.tracks || !data.tracks.length) return resolve([]);

                fullTracks = data.tracks.filter(t => t && t.media && t.media.transcodings);
                stubTrackIds = data.tracks.filter(t => t && (!t.media || !t.media.transcodings)).map(t => t.id);
              }

              if (stubTrackIds.length > 0) {
                const batchSize = 50;
                for (let i = 0; i < Math.min(stubTrackIds.length, 150); i += batchSize) {
                  const chunk = stubTrackIds.slice(i, i + batchSize);
                  try {
                    const tracksRes = await FluxKit.api.gmFetch(`${this._proxyBase}${encodeURIComponent(`https://api-v2.soundcloud.com/tracks?ids=${chunk.join(',')}&client_id=${clientId}`)}`, { signal });
                    if (tracksRes.ok) {
                      const fetched = await tracksRes.json();
                      if (Array.isArray(fetched)) { fullTracks = fullTracks.concat(fetched); }
                    }
                  } catch(e) {}
                }
              }

              const streamPromises = fullTracks.map(async (t) => {
                  if (!t || !t.media || !t.media.transcodings) return null;
                  const progressive = t.media.transcodings.find(tr => tr.format && tr.format.protocol === 'progressive');
                  if (!progressive) return null;
                  const authParam = t.track_authorization ? `&track_authorization=${encodeURIComponent(t.track_authorization)}` : '';
                  return {
                    id: t.id.toString(), title: t.title, artist: t.user?.username || 'Unknown Artist',
                    cover: t.artwork_url ? t.artwork_url.replace('-large', '-t500x500') : '',
                    streamUrl: `${progressive.url}?client_id=${clientId}${authParam}`,
                    durationMs: t.duration || 0,
                    resolution: { whitelistId: t.id.toString(), whitelistSource: 'soundcloud', whitelistUrl: null, blacklist: [], ambiguous: false }
                  };
              });
              resolve((await Promise.all(streamPromises)).filter(t => t !== null));
            } catch(e) { resolve([]); }
            return;
          }

          let url = '';
          const saavnBase = FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, '').replace(/\/$/, '');
          if (provider === 'saavn' && saavnBase) {
            if (type === 'album') url = `${saavnBase}/api/albums?id=${playlistId}`;
            else if (type && type.startsWith('artist')) url = `${saavnBase}/api/artists?id=${playlistId}`;
            else url = `${saavnBase}/api/playlists?id=${playlistId}&limit=100`;
          }
          else if (provider === 'audius') {
            url = type === 'artist'
              ? `https://discoveryprovider.audius.co/v1/users/${playlistId}/tracks?app_name=FluxHub`
              : `https://discoveryprovider.audius.co/v1/playlists/${playlistId}/tracks?app_name=FluxHub`;
          }
          else url = `https://itunes.apple.com/lookup?id=${playlistId}&entity=song&limit=100`;

          GM_xmlhttpRequest({
            method: 'GET', url, timeout: 8000,
            onload: res => {
              if (res.status === 200) {
                  try {
                    const data = JSON.parse(res.responseText);
                    let tracks = [];
                    if (provider === 'saavn') {
                      const targetData = data?.data || data;
                      let songList = [];
                      if (type === 'artist_singles') {
                        songList = targetData?.singles || targetData?.latest_releases || [];
                      } else {
                        songList = targetData?.topSongs || targetData?.songs || [];
                      }
                      if (!songList.length && Array.isArray(targetData)) songList = targetData;
                      tracks = songList.map(t => this._mapSaavnTrack(t)).filter(t => t !== null);
                    }
                    else if (provider === 'audius' && data.data) { tracks = data.data.map(t => this._mapAudiusTrack(t)).filter(t => t !== null); }
                    else if (provider === 'itunes' && data.results) { tracks = data.results.filter(t => t.wrapperType === 'track').map(t => this._mapItunesTrack(t)).filter(t => t !== null); }
                    else if (provider === 'itunes_hub' && data.results) { tracks = data.results.filter(t => t.wrapperType === 'track').map(t => this._mapItunesHubTrack(t)).filter(t => t !== null); }
                    resolve(tracks);
                  } catch(e) { resolve([]); }
              } else resolve([]);
            }
          });
        });
      },

      identifyAmbientAudio: async function(signal = null) {
        return new Promise(async (resolve, reject) => {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return reject({ type: 'hardware_error', message: 'Microphone access is not supported in this context.' });
          }

          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            const audioChunks = [];

            mediaRecorder.addEventListener('dataavailable', event => {
              if (event.data.size > 0) audioChunks.push(event.data);
            });

            mediaRecorder.addEventListener('stop', async () => {
              stream.getTracks().forEach(track => track.stop());
              
              const rapidApiKey = FluxHubState.get(STATE_KEYS.RAPIDAPI_KEY, '');
              if (!rapidApiKey) {
                return reject({ type: 'auth_error', message: 'RapidAPI Key missing. Please set it in settings.' });
              }

              try {
                const rawBlob = new Blob(audioChunks);
                const arrayBuffer = await rawBlob.arrayBuffer();
                const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
                const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
                
                const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, decodedBuffer.duration * 44100, 44100);
                const source = offlineCtx.createBufferSource();
                source.buffer = decodedBuffer;
                source.connect(offlineCtx.destination);
                source.start(0);
                
                const audioBuffer = await offlineCtx.startRendering();
                const channelData = audioBuffer.getChannelData(0); 
                
                const wavBuffer = new ArrayBuffer(44 + channelData.length * 2);
                const view = new DataView(wavBuffer);
                const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
                
                writeStr(0, 'RIFF'); view.setUint32(4, 36 + channelData.length * 2, true);
                writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
                view.setUint32(16, 16, true); view.setUint16(20, 1, true); 
                view.setUint16(22, 1, true); view.setUint32(24, 44100, true);
                view.setUint32(28, 44100 * 2, true); view.setUint16(32, 2, true); 
                view.setUint16(34, 16, true); writeStr(36, 'data');
                view.setUint32(40, channelData.length * 2, true);
                
                const pcm16 = new Int16Array(wavBuffer, 44);
                for (let i = 0; i < channelData.length; i++) {
                  let s = channelData[i];
                  pcm16[i] = Math.max(-32768, Math.min(32767, s * 0x8000));
                }

                const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
                const reader = new FileReader();
                
                reader.onloadend = async () => {
                  const base64Audio = reader.result.split(',')[1];

                  try {
                    const res = await FluxKit.api.gmFetch('https://shazam.p.rapidapi.com/songs/v2/detect', {
                      method: 'POST',
                      headers: {
                        'content-type': 'text/plain',
                        'x-rapidapi-host': 'shazam.p.rapidapi.com',
                        'x-rapidapi-key': rapidApiKey
                      },
                      body: base64Audio,
                      signal
                    });

                    if (res.status === 403 || res.status === 401) throw { type: 'auth_error', message: 'Invalid RapidAPI Key or Free Tier not subscribed.' };
                    if (res.status === 413 || res.status === 429) throw { type: 'quota_error', message: 'RapidAPI monthly limit exceeded (500/mo).' };
                    if (res.status === 400 || res.status === 500) throw { type: 'api_error', message: `Shazam Proxy Error (HTTP ${res.status}). Payload rejected.` };
                    if (!res.ok) throw { type: 'network_error', message: `API HTTP ${res.status}` };

                    const data = await res.json();

                    if (data && data.track) {
                      resolve({
                        title: data.track.title,
                        artist: data.track.subtitle,
                        raw: data.track
                      });
                    } else {
                      reject({ type: 'no_match', message: 'No matching song found in the captured audio.' });
                    }
                  } catch (e) {
                    reject(e.type ? e : { type: 'network_error', message: e.message || 'Recognition service request failed.' });
                  }
                };
                
                reader.onerror = () => reject({ type: 'processing_error', message: 'Failed to encode Base64 audio.' });
                reader.readAsDataURL(wavBlob);

              } catch (err) {
                reject(err.type ? err : { type: 'processing_error', message: `Local processing failed: ${err.message || 'Unknown Context Error'}` });
              }
            });

            if (signal) {
              signal.addEventListener('abort', () => {
                if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
              });
            }

            mediaRecorder.start();
            setTimeout(() => { if (mediaRecorder.state !== 'inactive') mediaRecorder.stop(); }, 4000);

          } catch (e) {
            reject({ type: 'hardware_error', message: 'Microphone permission denied or unavailable.' });
          }
        });
      },
    }
  };

  FluxKit.media ??= (function() {
    let audioCtx = null, audioBuffer = null, sourceNode = null, gainNode = null;
    let isPlaying = false, startTime = 0, pauseOffset = 0, currentTrack = null;
    let releaseHeartbeatClaim = null;
    let isLoading = false, bridgeAudioEl = null;
    let nativeObjectUrl = null;
    let silentLoopObjectUrl = null;
    let playbackMode = null;

    let truePlayTimeout = null;
    let timeTrackerStart = 0, timeTrackerTotal = 0;

    const commitTimeTracker = () => {
      if (timeTrackerStart) {
        let chunk = Date.now() - timeTrackerStart;
        if (currentTrack && currentTrack.durationMs) chunk = Math.min(chunk, currentTrack.durationMs);
        
        timeTrackerTotal += chunk;
        timeTrackerStart = 0;

        // Bank the chunk into the synced session state
        const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, {});
        if (am && currentTrack && am.track?.id === currentTrack.id) {
          am.sessionListenedMs = (am.sessionListenedMs || 0) + chunk;
          FluxHubState.set(STATE_KEYS.ACTIVE_MEDIA, am);
        }
      }
      
      if (currentTrack && timeTrackerTotal > 1000) {
        FluxKit.musicStats.recordTime(currentTrack, timeTrackerTotal);
      }
      timeTrackerTotal = 0;
    };

    const evaluateTruePlay = (targetTrackId = null) => {
      clearTimeout(truePlayTimeout);
      if (!currentTrack || !isPlaying) return;

      if (targetTrackId && currentTrack.id !== targetTrackId) return;

      const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, {});
      if (am.sessionScrobbled) return; // Already counted this session

      const durationMs = currentTrack.durationMs || 300000;
      const thresholdMs = Math.min(30000, durationMs * 0.5); 
      const currentListened = am.sessionListenedMs || 0;
      
      const currentChunk = timeTrackerStart ? (Date.now() - timeTrackerStart) : 0;
      const totalListened = currentListened + currentChunk;

      if (totalListened >= thresholdMs) {
        am.sessionScrobbled = true;
        FluxHubState.set(STATE_KEYS.ACTIVE_MEDIA, am);
        FluxKit.musicStats.recordPlay(currentTrack);
      } else {
        truePlayTimeout = setTimeout(() => evaluateTruePlay(currentTrack.id), thresholdMs - totalListened);
      }
    };

    const isGecko = navigator.userAgent.toLowerCase().includes('firefox')
      || navigator.userAgent.includes('Gecko/')
      && !navigator.userAgent.includes('like Gecko');

    let lastMediaSrcViolation = false;
    document.addEventListener('securitypolicyviolation', (e) => {
      if (e.violatedDirective === 'media-src' || e.effectiveDirective === 'media-src') {
        lastMediaSrcViolation = true;
      }
    });

    const withTimeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))
    ]);


    // ==========================================
    // 10-Second Silent WAV Generator
    // ==========================================
    const createSilentAudioBlob = () => {
      try {
        const sampleRate = 8000;
        const durationSec = 10;
        const numSamples = sampleRate * durationSec;
        const buffer = new ArrayBuffer(44 + numSamples * 2);
        const view = new DataView(buffer);
        const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

        writeStr(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true);
        writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true);
        view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
        view.setUint16(34, 16, true); writeStr(36, 'data');
        view.setUint32(40, numSamples * 2, true);

        return new Blob([buffer], { type: 'audio/wav' });
      } catch(e) { return null; }
    };

    // ==========================================
    // AudioBuffer → WAV Blob Encoder
    // ==========================================
    const audioBufferToWavBlob = (buffer) => {
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const numFrames = buffer.length;
      const blockAlign = numChannels * 2;
      const dataSize = numFrames * blockAlign;
      const arrBuf = new ArrayBuffer(44 + dataSize);
      const view = new DataView(arrBuf);
      const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

      writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true); writeStr(36, 'data'); view.setUint32(40, dataSize, true);

      // Direct Int16Array indexing, not DataView.setInt16 per sample —
      // at multi-million-frame counts the DataView call overhead alone
      // is enough to visibly block the main thread. Offset 44 is even,
      // so Int16Array alignment here is valid.
      const pcm16 = new Int16Array(arrBuf, 44);
      const channels = [];
      for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

      let idx = 0;
      for (let i = 0; i < numFrames; i++) {
        for (let c = 0; c < numChannels; c++) {
          let s = channels[c][i];
          if (s < -1) s = -1; else if (s > 1) s = 1;
          pcm16[idx++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
      }

      return new Blob([arrBuf], { type: 'audio/wav' });
    };

    let prefetchingId = null;
    const PREFETCH_DELAY = 2000;

    const prefetchNextTrack = async () => {
      const queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
      if (queue.length < 2) return;

      let index = FluxHubState.get(STATE_KEYS.QUEUE_INDEX, 0);
      const loopMode = FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off');

      index++;
      if (index >= queue.length) {
        if (loopMode === 'all') index = 0;
        else return; // End of queue
      }

      const nextTrack = queue[index];
      if (!nextTrack || prefetchingId === nextTrack.id) return;

      const cached = await FluxHub.decodeCache.get(nextTrack.id);
      if (cached) return;

      prefetchingId = nextTrack.id;
      logDebug(`[Prefetch] Background caching next track: ${nextTrack.title}`);

      try {
        let finalStreamUrl = nextTrack.streamUrl;
        if (finalStreamUrl === 'RESOLVE_JIT') {
          finalStreamUrl = await FluxKit.api.music._resolveAudioStream(nextTrack);
          const currentQueue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
          const qIdx = currentQueue.findIndex(t => t.id === nextTrack.id);
          if (qIdx !== -1) {
            currentQueue[qIdx].streamUrl = finalStreamUrl;
            FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, currentQueue);
          }
        }

        if (finalStreamUrl.includes('api-v2.soundcloud.com')) {
          const proxyBase = FluxKit.api.music._proxyBase;
          const proxiedJitUrl = `${proxyBase}${encodeURIComponent(finalStreamUrl)}`;
          const jitRes = await FluxKit.api.gmFetch(proxiedJitUrl);
          if (jitRes.ok) finalStreamUrl = (await jitRes.json()).url;
        }

        const isSoundCloud = finalStreamUrl.includes('sndcdn.com') || finalStreamUrl.includes('soundcloud');
        const requestHeaders = isSoundCloud ? {
          "Origin": "https://soundcloud.com",
          "Referer": "https://soundcloud.com/",
          "User-Agent": navigator.userAgent,
          "Accept": "audio/mpeg, audio/*;q=0.9, */*;q=0.8"
        } : {};

        GM_xmlhttpRequest({
          method: 'GET', url: finalStreamUrl, responseType: 'arraybuffer', anonymous: true, headers: requestHeaders,
          onload: async (res) => {
            if (res.status >= 200 && res.status < 300) {
              try {
                let decoded, wavBlob = null, byteSize = 0;
                if (isGecko) {
                  const rawBytes = new Uint8Array(res.response);
                  const nativeBuf = new ArrayBuffer(rawBytes.byteLength);
                  new Uint8Array(nativeBuf).set(rawBytes);

                  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
                  try {
                    decoded = await withTimeout(decodeCtx.decodeAudioData(nativeBuf), 15000, 'decodeAudioData');
                  } finally {
                    try { decodeCtx.close(); } catch(e) {}
                  }
                  
                  wavBlob = audioBufferToWavBlob(decoded);
                  byteSize = decoded.length * decoded.numberOfChannels * 4;
                } else {
                  if (!audioCtx) return; // Wait for main context
                  decoded = await withTimeout(audioCtx.decodeAudioData(res.response), 15000, 'decodeAudioData');
                  byteSize = decoded.length * decoded.numberOfChannels * 4;
                }
                
                const cache = await FluxHub.decodeCache.set(nextTrack.id, { audioBuffer: decoded, wavBlob, byteSize });
                if (cache) logDebug(`[Prefetch] Successfully cached: ${nextTrack.title}, consumed bytes: ${formatBytes(byteSize)}`);
                else logDebug(`[Prefetch] Failed to cache: ${nextTrack.title}, bytes: ${formatBytes(byteSize)}`);
              } catch (e) { logDebug('[Prefetch] Decoding failed silently', e); }
            }
            prefetchingId = null;
          },
          onerror: () => { prefetchingId = null; },
          ontimeout: () => { prefetchingId = null; }
        });
      } catch(e) {
        prefetchingId = null;
      }
    };

    // ==========================================
    // Media Session Helpers
    // ==========================================
    const updateMediaSession = () => {
      if ('mediaSession' in navigator && currentTrack) {
        const artwork = [];
        if (currentTrack.cover && currentTrack.cover.startsWith('http')) {
          artwork.push({ src: currentTrack.cover, sizes: '512x512', type: 'image/jpeg' });
        }

        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: currentTrack.title || 'Unknown Title',
            artist: currentTrack.artist || 'Unknown Artist',
            album: FluxHubState.get(STATE_KEYS.ACTIVE_PLAYLIST_NAME, 'FluxHub Queue'),
            artwork: artwork
          });
        } catch (e) {
          logWarning('MediaMetadata initialization bypassed due to strict constraints.');
        }
      }
    };

    const clearMediaSession = () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      }
    };

    const claimOwnership = () => {
      if (releaseHeartbeatClaim) return;
      releaseHeartbeatClaim = FluxKit.ipc.ownership.claim((now) => {
        const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);
        if (!am || am.hostTab !== FluxKit.ipc.getTabId()) return;

        if (currentTrack && am.track && am.track.id !== currentTrack.id) return;
        if (!currentTrack) return;

        const progress = (!sourceNode && !audioBuffer)
          ? (bridgeAudioEl ? bridgeAudioEl.currentTime : pauseOffset)
          : (isPlaying ? (audioCtx.currentTime - startTime) : pauseOffset);

        const updated = { ...am, progress, timestamp: now };

        FluxHubState.set(STATE_KEYS.ACTIVE_MEDIA, updated);
        FluxKit.ipc.broadcast('media-state', updated, true);
      });
    };

    const releaseOwnership = () => { if (releaseHeartbeatClaim) { releaseHeartbeatClaim(); releaseHeartbeatClaim = null; } };

    const initCtx = () => {
      if (isGecko && !bridgeAudioEl) {
        // GECKO ENGINE: real audible output MUST flow through the native
        // <audio> element's own decode pipeline — Gecko's macOS Now Playing
        // bridge explicitly excludes Web Audio-graph output from media
        // control eligibility, confirmed via Mozilla's MediaSession docs.
        // No AudioContext/gainNode needed on this path at all.
        bridgeAudioEl = document.createElement('audio');
        bridgeAudioEl.style.display = 'none';
        bridgeAudioEl.volume = FluxHubState.get(STATE_KEYS.MEDIA_VOLUME, 0.5);
        document.body.appendChild(bridgeAudioEl);
      } else {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          gainNode = audioCtx.createGain();
          gainNode.gain.value = FluxHubState.get(STATE_KEYS.MEDIA_VOLUME, 0.5);
          gainNode.connect(audioCtx.destination);

          if (!bridgeAudioEl) {
            bridgeAudioEl = document.createElement('audio');
            bridgeAudioEl.style.display = 'none';
            bridgeAudioEl.loop = true;
            bridgeAudioEl.volume = 1;
            document.body.appendChild(bridgeAudioEl);
          }
          try {
            if (silentLoopObjectUrl) { URL.revokeObjectURL(silentLoopObjectUrl); silentLoopObjectUrl = null; }
            const blob = createSilentAudioBlob();
            if (blob) {
              silentLoopObjectUrl = URL.createObjectURL(blob);
              bridgeAudioEl.src = silentLoopObjectUrl;
            }
          } catch(e) {
            logWarning('CSP blocked Blob creation. Natively playing audio instead.');
          }
        }
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      }

      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => FluxKit.media.resume());
        navigator.mediaSession.setActionHandler('pause', () => FluxKit.media.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => FluxKit.media.previous());
        navigator.mediaSession.setActionHandler('nexttrack', () => FluxKit.media.next());
        navigator.mediaSession.setActionHandler('seekto', (details) => FluxKit.media.seek(details.seekTime));
      }
    };

    const broadcastState = () => {
      const currentProgress = sourceNode || audioBuffer ? (isPlaying ? audioCtx.currentTime - startTime : pauseOffset) : (bridgeAudioEl ? bridgeAudioEl.currentTime : 0);
      
      if (isPlaying && !timeTrackerStart) {
        timeTrackerStart = Date.now();
      } else if (!isPlaying && timeTrackerStart) {
        let chunk = Date.now() - timeTrackerStart;
        if (currentTrack && currentTrack.durationMs) chunk = Math.min(chunk, currentTrack.durationMs);
        timeTrackerTotal += chunk;
        timeTrackerStart = 0;
      }

      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        try {
          if (audioBuffer && 'setPositionState' in navigator.mediaSession) {
            navigator.mediaSession.setPositionState({
              duration: audioBuffer.duration,
              playbackRate: isPlaying ? 1 : 0,
              position: currentProgress
            });
          }
        } catch(e) {}
      }

      const existingAm = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, {});
      const statePayload = {
        isPlaying, isLoading, track: currentTrack, hostTab: FluxKit.ipc.getTabId(),
        index: FluxHubState.get(STATE_KEYS.QUEUE_INDEX, 0),
        loop: FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off'),
        shuffle: FluxHubState.get(STATE_KEYS.QUEUE_SHUFFLE, false),
        progress: currentProgress,
        timestamp: Date.now(),
        volume: FluxHubState.get(STATE_KEYS.MEDIA_VOLUME, 0.5),
        sessionListenedMs: existingAm.sessionListenedMs || 0,
        sessionScrobbled: existingAm.sessionScrobbled || false
      };

      FluxHubState.set(STATE_KEYS.ACTIVE_MEDIA, statePayload);
      FluxKit.ipc.broadcast('media-state', statePayload, true);
    };

    const stopNodeOnly = () => {
      if (!sourceNode && !audioBuffer) {
        if (bridgeAudioEl) { bridgeAudioEl.onended = null; bridgeAudioEl.pause(); }
        return;
      }
      if (sourceNode) {
        sourceNode.onended = null;
        try { sourceNode.stop(); } catch(e) {}
        try { sourceNode.disconnect(); } catch(e) {}
        sourceNode = null;
      }
      if (bridgeAudioEl && !bridgeAudioEl.paused) bridgeAudioEl.pause();
    };

    const playGraph = (offset) => {
      if (!audioBuffer) return;
      stopNodeOnly();
      playbackMode = 'graph';

      sourceNode = audioCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(gainNode);

      sourceNode.onended = () => {
        if (isPlaying && audioCtx.currentTime - startTime >= audioBuffer.duration) {
          isPlaying = false;
          pauseOffset = 0;
          const loopMode = FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off');
          if (loopMode === 'one') FluxKit.media.loadTrack(currentTrack, currentTrack.streamUrl);
          else FluxKit.media.next();
        }
      };

      sourceNode.start(0, offset);
      startTime = audioCtx.currentTime - offset;

      if (bridgeAudioEl) {
        try {
          if (!bridgeAudioEl.srcObject) bridgeAudioEl.currentTime = 0;

          const playPromise = bridgeAudioEl.play();
          if (playPromise !== undefined) {
            playPromise.catch(e => logWarning('Anchor blocked by CSP. Audio will still play smoothly.', { __v: 1 } ));
          }
        } catch(e) {}
      }

      isPlaying = true;
      evaluateTruePlay();
      broadcastState();
    };

    let nativeLoadToken = 0;

    const playNative = (offset) => {
      if (!bridgeAudioEl) return;
      stopNodeOnly();
      playbackMode = 'native';
      bridgeAudioEl.onended = null;

      const myToken = ++nativeLoadToken;
      const targetOffset = offset || 0;
      let settled = false;

      const applySeekAndPlay = () => {
        if (myToken !== nativeLoadToken || settled) return; // superseded or already handled
        settled = true;

        try { bridgeAudioEl.currentTime = targetOffset; } catch(e) { logWarning('currentTime set failed:', e); }

        bridgeAudioEl.onended = () => {
          if (isPlaying) {
            isPlaying = false;
            pauseOffset = 0;
            const loopMode = FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off');
            if (loopMode === 'one') FluxKit.media.loadTrack(currentTrack, currentTrack.streamUrl);
            else FluxKit.media.next();
          }
        };

        const playPromise = bridgeAudioEl.play();
        if (playPromise !== undefined) {
          playPromise.then(() => logDebug('play() resolved')).catch(e => {
            if (myToken !== nativeLoadToken) return;
            logWarning('Native play blocked:', e);
            isLoading = false;
            broadcastState();
          });
        }
        isPlaying = true;
        isLoading = false;
        evaluateTruePlay();
        broadcastState();
      };

      if (bridgeAudioEl.readyState >= 1 /* HAVE_METADATA */) {
        applySeekAndPlay();
        return;
      }

      bridgeAudioEl.addEventListener('loadedmetadata', applySeekAndPlay, { once: true });

      setTimeout(() => {
        if (settled || myToken !== nativeLoadToken) return;
        if (bridgeAudioEl.readyState >= 1) {
          bridgeAudioEl.removeEventListener('loadedmetadata', applySeekAndPlay);
          applySeekAndPlay();
        }
      }, 150);

      setTimeout(() => {
        if (settled || myToken !== nativeLoadToken) return;
        settled = true;
        bridgeAudioEl.removeEventListener('loadedmetadata', applySeekAndPlay);
        logWarning('[Flux Media] loadedmetadata never fired for native playback — giving up.');
        isLoading = false;
        isPlaying = false;
        broadcastState();
      }, 4000);
    };


    window.addEventListener('beforeunload', () => {
      FluxHubState.set(STATE_KEYS.LAST_QUERY, FluxHub.ui.input.value);
      const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA);
      if (am && am.hostTab === FluxKit.ipc.getTabId()) {
        commitTimeTracker();
        FluxKit.media.pause();

        const finalState = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA);
        finalState.hostTab = null;
        FluxHubState.set(STATE_KEYS.ACTIVE_MEDIA, finalState);
        FluxKit.ipc.broadcast('media-state', finalState, true);
      }
      FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA)
    });

    return {
      persistActiveTrackMeta: function(trackMeta) {
        const queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
        const idx = queue.findIndex(t => t.id === trackMeta.id);
        if (idx !== -1) {
          queue[idx] = { ...queue[idx], resolution: trackMeta.resolution, title: trackMeta.title, artist: trackMeta.artist, metaEdited: trackMeta.metaEdited };
          FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, queue);
        }

        const plName = FluxHubState.get(STATE_KEYS.ACTIVE_PLAYLIST_NAME, null);
        if (plName) {
          const tracks = PlaylistsState.getTracks(plName);
          if (tracks) {
            const plIdx = tracks.findIndex(t => t.id === trackMeta.id);
            if (plIdx !== -1) {
              tracks[plIdx] = { ...tracks[plIdx], resolution: trackMeta.resolution, title: trackMeta.title, artist: trackMeta.artist, metaEdited: trackMeta.metaEdited };
              PlaylistsState.save(plName, tracks);
            }
          }
        }
      },

      loadTrack: async function(trackMeta, streamUrl, startPosition = 0, _isStaleRetry = false) {
        return new Promise(async (resolve, reject) => {
          initCtx();
          if (!_isStaleRetry) {
            commitTimeTracker();
            clearTimeout(truePlayTimeout);
            const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, {});
            am.sessionListenedMs = 0;
            am.sessionScrobbled = false;
            FluxHubState.set(STATE_KEYS.ACTIVE_MEDIA, am);
          }

          if (currentTrack && currentTrack.id === trackMeta.id && audioBuffer &&
            trackMeta.streamUrl === currentTrack.streamUrl && !_isStaleRetry) {
            pauseOffset = startPosition;
            if (playbackMode === 'graph') { playGraph(startPosition); }
            else if (playbackMode === 'native') { playNative(startPosition); }
            return true;
          }
          FluxKit.ipc.broadcast('media-control', { action: 'surrender' }, true);

          stopNodeOnly();
          isPlaying = false;
          pauseOffset = startPosition;
          audioBuffer = null;

          currentTrack = trackMeta;
          isLoading = true;
          claimOwnership();
          broadcastState();

          const cached = await FluxHub.decodeCache.get(trackMeta.id);
          if (cached && !_isStaleRetry) {
            if (playbackMode === 'native' && cached.wavBlob) {
              if (nativeObjectUrl) URL.revokeObjectURL(nativeObjectUrl);
              nativeObjectUrl = URL.createObjectURL(cached.wavBlob);
              bridgeAudioEl.src = nativeObjectUrl
              bridgeAudioEl.load();
              playNative(startPosition);
            } else {
              audioBuffer = cached.audioBuffer;
              isLoading = false;
              broadcastState();
              playGraph(startPosition);
            }
            resolve(true);
            setTimeout(prefetchNextTrack, PREFETCH_DELAY);
            return;
          }

          const isRetryableFailure = !_isStaleRetry && !!trackMeta.resolution;

          try {
            let finalStreamUrl = streamUrl;

            if (finalStreamUrl === 'RESOLVE_JIT') {
              finalStreamUrl = await FluxKit.api.music._resolveAudioStream(trackMeta);
              currentTrack.streamUrl = finalStreamUrl;
              this.persistActiveTrackMeta(trackMeta);
              broadcastState();
            }

            if (finalStreamUrl.includes('api-v2.soundcloud.com')) {
              const proxyBase = FluxKit.api.music._proxyBase;
              const proxiedJitUrl = `${proxyBase}${encodeURIComponent(finalStreamUrl)}`;
              const jitRes = await FluxKit.api.gmFetch(proxiedJitUrl);
              if (!jitRes.ok) throw new Error(`Proxy JIT HTTP ${jitRes.status}`);
              const streamData = await jitRes.json();
              if (streamData && streamData.url) finalStreamUrl = streamData.url;
              else throw new Error("Invalid JIT stream URL returned by proxy");
            }

            const isSoundCloud = finalStreamUrl.includes('sndcdn.com') || finalStreamUrl.includes('soundcloud');
            const requestHeaders = isSoundCloud ? {
              "Origin": "https://soundcloud.com",
              "Referer": "https://soundcloud.com/",
              "User-Agent": navigator.userAgent,
              "Accept": "audio/mpeg, audio/*;q=0.9, */*;q=0.8"
            } : {};

            GM_xmlhttpRequest({
              method: 'GET',
              url: finalStreamUrl,
              responseType: 'arraybuffer',
              anonymous: true,
              headers: requestHeaders,
              onload: async (res) => {
                if (res.status >= 200 && res.status < 300) {
                  try {
                    if (isGecko) {
                      // GM_xmlhttpRequest's response ArrayBuffer can carry a
                      // cross-compartment/Xray wrapper on some userscript
                      // managers — decodeAudioData can silently hang forever
                      // on that rather than throw. Rebuild as a plain native
                      // ArrayBuffer first, unconditionally, on every engine.
                      const rawBytes = new Uint8Array(res.response);
                      const nativeBuf = new ArrayBuffer(rawBytes.byteLength);
                      new Uint8Array(nativeBuf).set(rawBytes);

                      const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
                      let decoded;
                      try {
                        decoded = await withTimeout(decodeCtx.decodeAudioData(nativeBuf), 15000, 'decodeAudioData');
                      } finally {
                        try { decodeCtx.close(); } catch(e) {}
                      }

                      if (nativeObjectUrl) { URL.revokeObjectURL(nativeObjectUrl); nativeObjectUrl = null; }
                      lastMediaSrcViolation = false;

                      const wavBlob = audioBufferToWavBlob(decoded);
                      nativeObjectUrl = URL.createObjectURL(wavBlob);
                      const byteSize = decoded.length * decoded.numberOfChannels * 4;
                      await FluxHub.decodeCache.set(trackMeta.id, { audioBuffer: decoded, wavBlob, byteSize });

                      let nativeErrored = false;
                      const onNativeError = () => { nativeErrored = true; };
                      bridgeAudioEl.addEventListener('error', onNativeError, { once: true });

                      bridgeAudioEl.src = nativeObjectUrl;
                      bridgeAudioEl.load();
                      isLoading = false;

                      await new Promise(r => setTimeout(r, 50));
                      bridgeAudioEl.removeEventListener('error', onNativeError);

                      if (lastMediaSrcViolation || nativeErrored) {
                        logWarning('[Flux] media-src CSP blocks blob: on this site — falling back to Web Audio graph (no OS Now Playing here).');
                        if (nativeObjectUrl) { URL.revokeObjectURL(nativeObjectUrl); nativeObjectUrl = null; }
                        bridgeAudioEl.removeAttribute('src');

                        if (!audioCtx) {
                          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                          gainNode = audioCtx.createGain();
                          gainNode.gain.value = FluxHubState.get(STATE_KEYS.MEDIA_VOLUME, 0.5);
                          gainNode.connect(audioCtx.destination);
                        }
                        if (audioCtx.state === 'suspended') await audioCtx.resume();

                        audioBuffer = decoded;
                        updateMediaSession();
                        playGraph(startPosition);
                      } else {
                        updateMediaSession();
                        playNative(startPosition);
                      }
                    } else {
                      if (audioCtx.state === 'suspended') await audioCtx.resume();
                      audioBuffer = await withTimeout(audioCtx.decodeAudioData(res.response), 15000, 'decodeAudioData');
                      const byteSize = audioBuffer.length * audioBuffer.numberOfChannels * 4;
                      await FluxHub.decodeCache.set(trackMeta.id, { audioBuffer, wavBlob: null, byteSize });
                      isLoading = false;
                      updateMediaSession();
                      playGraph(startPosition);
                    }
                    resolve(true);
                    setTimeout(prefetchNextTrack, PREFETCH_DELAY);
                  } catch (e) { logError('caught in try block:', e); reject(new Error('Audio decoding failed')); }
                } else {
                  const err = new Error(`CDN fetch failed (HTTP ${res.status})`);
                  err.isStaleCandidate = isRetryableFailure;
                  reject(err);
                }
              },
              onerror: (e) => { logError('GM_xmlhttpRequest onerror:', e); const err = new Error('Network error fetching CDN stream'); err.isStaleCandidate = isRetryableFailure; reject(err); },
              ontimeout: () => logError('GM_xmlhttpRequest ontimeout')
            });
          } catch (e) {}
        }).catch(async err => {
          isLoading = false;
          if (err.isStaleCandidate && !_isStaleRetry) {
            logWarning('[Flux Media] Cached URL stale, re-resolving:', trackMeta.title);
            try {
              const res = trackMeta.resolution;
              const freshUrl = (res.whitelistSource === 'soundcloud' && res.ambiguous === false)
                ? await FluxKit.api.music._refreshSoundCloudTrackUrl(res.whitelistId, null)
                : await FluxKit.api.music._resolveAudioStream(trackMeta, null, true);

              if (!freshUrl) throw new Error('Refresh returned no URL');
              currentTrack.streamUrl = freshUrl;
              this.persistActiveTrackMeta(trackMeta);
              broadcastState();
              return this.loadTrack(trackMeta, freshUrl, startPosition, true);
            } catch (retryErr) {
              err = retryErr;
            }
          }

          logError('Track playback failed:', err);

          FluxKit.ui.showNotification(`⚠️ Failed to load track: ${trackMeta.title}`);

          const queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);

          if (queue.length > 1) {
             setTimeout(() => {
               if (FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off') === 'one') {
                  FluxHubState.set(STATE_KEYS.QUEUE_LOOP, 'all');
               }
               this.next();
             }, 1500);
          } else {
             this.stop();
          }
        });
      },

      updateTrackMetadata: function(trackId, newTitle, newArtist) {
        const title = (newTitle || '').trim();
        const artist = (newArtist || '').trim();
        if (!title && !artist) return;

        if (currentTrack && currentTrack.id === trackId) {
          const oldMeta = { title: currentTrack.title, artist: currentTrack.artist };
          if (title) currentTrack.title = title;
          if (artist) currentTrack.artist = artist;
          currentTrack.metaEdited = true;
          FluxKit.musicStats.migrateSlug(oldMeta, currentTrack);
          this.persistActiveTrackMeta(currentTrack);
          broadcastState();
          updateMediaSession();
          return;
        }

        const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);
        if (!am || !am.track || am.track.id !== trackId) return;

        const patchedTrack = { ...am.track };
        if (title) patchedTrack.title = title;
        if (artist) patchedTrack.artist = artist;
        patchedTrack.metaEdited = true;

        this.persistActiveTrackMeta(patchedTrack);

        const patchedState = { ...am, track: patchedTrack };
        FluxHubState.set(STATE_KEYS.ACTIVE_MEDIA, patchedState);
        FluxKit.ipc.broadcast('media-state', patchedState, true);
      },

      setVolume: function(level) {
        const vol = Math.max(0, Math.min(1, parseFloat(level)));
        FluxHubState.set(STATE_KEYS.MEDIA_VOLUME, vol);
        if (playbackMode === 'graph' && gainNode && audioCtx) {
          gainNode.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.05);
        } else if (bridgeAudioEl) {
          bridgeAudioEl.volume = vol;
        }

        broadcastState();
      },

      pause: function() {
        if (!isPlaying) return;
        isPlaying = false;

        clearTimeout(truePlayTimeout);

        if (playbackMode === 'graph') {
          if (!sourceNode) return;
          pauseOffset = audioCtx.currentTime - startTime;
          if (audioCtx.state === 'running') audioCtx.suspend();
          if (bridgeAudioEl && !bridgeAudioEl.paused) bridgeAudioEl.pause();
        } else if (bridgeAudioEl) {
          pauseOffset = bridgeAudioEl.currentTime;
          bridgeAudioEl.pause();
        }

        broadcastState();
      },

      resume: function() {
        if (isPlaying) return;
        initCtx();
        if (!sourceNode && !audioBuffer) {
          if (bridgeAudioEl.src) { playNative(pauseOffset); return; }
        } else {
          if (audioCtx.state === 'suspended' && sourceNode) {
            if (bridgeAudioEl && bridgeAudioEl.paused) {
              const p = bridgeAudioEl.play();
              if (p !== undefined) p.catch(() => {});
            }
            audioCtx.resume().then(() => { isPlaying = true; evaluateTruePlay(pauseOffset); broadcastState(); });
            return;
          } else if (audioBuffer) {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            playGraph(pauseOffset);
            return;
          }
        }
        const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA);
        if (am && am.track) this.loadTrack(am.track, am.track.streamUrl, am.progress || 0);
      },

      seek: function(positionSec) {
        if (playbackMode === 'graph') {
          if (!audioBuffer) return;
          if (positionSec < 0) positionSec = 0;
          if (positionSec > audioBuffer.duration) positionSec = audioBuffer.duration - 0.5;
          if (isPlaying) playGraph(positionSec);
          else {
            pauseOffset = positionSec;
            stopNodeOnly();
            if (bridgeAudioEl) {
              try { bridgeAudioEl.currentTime = positionSec; } catch(e) {}
            }
            broadcastState(); }
        } else {
          if (!bridgeAudioEl || !bridgeAudioEl.duration) return;
          positionSec = Math.max(0, Math.min(positionSec, bridgeAudioEl.duration - 0.5));
          if (isPlaying) playNative(positionSec);
          else { pauseOffset = positionSec; bridgeAudioEl.currentTime = positionSec; broadcastState(); }
        }
      },

      toggle: function() {
        if (isPlaying) this.pause();
        else this.resume();
      },

      reroll: async function() {
        if (!currentTrack || !currentTrack.resolution) return;
        const meta = currentTrack;
        await FluxHub.decodeCache.delete(meta.id);
        FluxKit.ui.showNotification('🔄 Finding alternate match...');

        try {
          const { url: newUrl, wrapped } = await FluxKit.api.music._rerollTrack(meta, null);
          this.persistActiveTrackMeta(meta);
          this.loadTrack(meta, newUrl, 0);
          if (wrapped) FluxKit.ui.showNotification('🔁 Back to the original match — no more alternates.');
        } catch (e) { FluxKit.ui.showNotification('Reroll failed — no alternate match found.', { icon: 'warning' }); }
      },

      next: function() {
        const queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
        if (!queue.length) return this.surrender();

        let index = FluxHubState.get(STATE_KEYS.QUEUE_INDEX, 0);
        const loopMode = FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off');

        index++;
        if (index >= queue.length) {
          if (loopMode === 'all') index = 0;
          else return this.surrender();
        }

        FluxHubState.set(STATE_KEYS.QUEUE_INDEX, index);
        if (queue[index]) this.loadTrack(queue[index], queue[index].streamUrl);
      },

      previous: function() {
        const queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
        if (!queue.length) return;

        const elapsed = playbackMode === 'graph'
          ? (audioCtx.currentTime - startTime)
          : (bridgeAudioEl && bridgeAudioEl.readyState >= 1 ? bridgeAudioEl.currentTime : 0);

        if (elapsed > 3) {
          commitTimeTracker(); 
          clearTimeout(truePlayTimeout);
          if (playbackMode === 'graph') return playGraph(0);
          if (playbackMode === 'native') return playNative(0);
        }

        let index = FluxHubState.get(STATE_KEYS.QUEUE_INDEX, 0);
        index--;
        if (index < 0) index = FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off') === 'all' ? queue.length - 1 : 0;

        FluxHubState.set(STATE_KEYS.QUEUE_INDEX, index);
        if (queue[index]) this.loadTrack(queue[index], queue[index].streamUrl);
      },

      jumpToIndex: function(targetIndex) {
        const queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
        if (targetIndex >= 0 && targetIndex < queue.length) {
          FluxHubState.set(STATE_KEYS.QUEUE_INDEX, targetIndex);
          this.loadTrack(queue[targetIndex], queue[targetIndex].streamUrl);
        }
      },

      toggleShuffle: function() {
        const wasShuffled = FluxHubState.get(STATE_KEYS.QUEUE_SHUFFLE, false);
        const queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
        const currentIndex = FluxHubState.get(STATE_KEYS.QUEUE_INDEX, 0);

        if (queue.length > 1) {
          const currentTrackRef = queue[currentIndex];
          const rest = queue.filter((_, i) => i !== currentIndex);

          for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
          }

          FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, [currentTrackRef, ...rest]);
          FluxHubState.set(STATE_KEYS.QUEUE_INDEX, 0);
        }
        FluxHubState.set(STATE_KEYS.QUEUE_SHUFFLE, !wasShuffled);
        broadcastState();
        setTimeout(prefetchNextTrack, 50);
      },

      toggleLoop: function() {
        const modes = ['off', 'all', 'one'];
        const nextMode = modes[(modes.indexOf(FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off')) + 1) % modes.length];
        FluxHubState.set(STATE_KEYS.QUEUE_LOOP, nextMode);
        broadcastState();
      },

      surrender: function() {
        commitTimeTracker();
        stopNodeOnly();
        isPlaying = false;
        clearTimeout(truePlayTimeout);
        if (bridgeAudioEl) bridgeAudioEl.pause();
        clearMediaSession();
      },

      stop: function() {
        commitTimeTracker();
        releaseOwnership();
        stopNodeOnly();
        isPlaying = false;
        isLoading = false;
        pauseOffset = 0;
        audioBuffer = null;
        currentTrack = null;

        clearTimeout(truePlayTimeout);

        if (bridgeAudioEl) bridgeAudioEl.pause();
        clearMediaSession();

        FluxHubState.delete(STATE_KEYS.ACTIVE_MEDIA);
        FluxKit.ipc.broadcast('media-state', { isPlaying: false, track: null }, true);
      }
    };
  })();

  FluxKit.musicStats ??= (function() {
    const getStatsDB = () => FluxHubState.get(STATE_KEYS.MUSIC_STATS, {});
    const saveStatsDB = (db) => { 
      FluxHubState.set(STATE_KEYS.MUSIC_STATS, db); 
      AutoSync.notifyLocalChange(); 
    };

    const getBaselineDB = () => FluxHubState.get('flx_music_stats_baseline', {});
    const saveBaselineDB = (db) => FluxHubState.set('flx_music_stats_baseline', db);

    const getHistoryDB = () => FluxHubState.get(STATE_KEYS.MUSIC_HISTORY, []);
    const saveHistoryDB = (db) => { 
      FluxHubState.set(STATE_KEYS.MUSIC_HISTORY, db); 
      AutoSync.notifyLocalChange(); 
    };

    const getDiscoveriesDB = () => FluxHubState.get(STATE_KEYS.MUSIC_DISCOVERIES, []);
    const saveDiscoveriesDB = (db) => { 
      FluxHubState.set(STATE_KEYS.MUSIC_DISCOVERIES, db); 
      AutoSync.notifyLocalChange(); 
    };

    const generateSlug = (rawTitle, rawArtist) => {
      let title = (rawTitle || 'unknown').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      let artist = (rawArtist || 'unknown').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      if (title.startsWith(`${artist} - `) || title.startsWith(`${artist}- `)) {
        title = title.replace(new RegExp(`^${artist}\\s*-\\s*`), '');
      }

      title = title
        .replace(/[\[\{].*?[\]\}]/g, '')
        .replace(/\([^)]*(official|lyric|video|audio|remaster|edit|version|visualizer|exclusive)[^)]*\)/gi, '')
        .replace(/[-\|]\s*(official|lyric|video|audio|remaster|edit|version|visualizer).*/gi, '')
        .replace(/\((feat|ft|prod|with|feat\.|ft\.).*?\)/gi, '')
        .replace(/\b(feat\.|ft\.|feat|ft|featuring|prod\.|prod)\b.*/gi, '');

      const cleanArtist = artist.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/(^_|_$)/g, '');
      const cleanTitle = title.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/(^_|_$)/g, '');

      return `${cleanArtist}_${cleanTitle.length > 0 ? cleanTitle : 'unknown_track'}`;
    };

    return {
      recordPlay: function(trackMeta) {
        if (!trackMeta) return;
        const slug = generateSlug(trackMeta.title, trackMeta.artist);
        const db = getStatsDB();
        const now = Date.now();

        if (!db[slug]) {
          db[slug] = { slug, title: trackMeta.title, artist: trackMeta.artist, cover: trackMeta.cover, playCount: 0, totalTimeMs: 0, firstPlayed: now, isFavorite: false };
        }

        db[slug].playCount += 1;
        db[slug].lastPlayed = now;
        db[slug].updatedAt = now;
        if (trackMeta.cover) db[slug].cover = trackMeta.cover;
        
        saveStatsDB(db);

        const history = getHistoryDB();
        history.unshift({ slug, timestamp: now, meta: trackMeta });
        if (history.length > 150) history.length = 150;
        saveHistoryDB(history);
      },

      recordTime: function(trackMeta, listenedMs) {
        if (!trackMeta || listenedMs <= 0) return;
        const slug = generateSlug(trackMeta.title, trackMeta.artist);
        const db = getStatsDB();

        if (!db[slug]) {
          db[slug] = { slug, title: trackMeta.title, artist: trackMeta.artist, cover: trackMeta.cover, playCount: 0, totalTimeMs: 0, firstPlayed: Date.now(), isFavorite: false };
        }

        db[slug].totalTimeMs += listenedMs;
        db[slug].updatedAt = Date.now();
        saveStatsDB(db);
      },

      toggleFavorite: function(trackMeta, forceState = null) {
        if (!trackMeta) return false;
        const slug = generateSlug(trackMeta.title, trackMeta.artist);
        const db = getStatsDB();
        const now = Date.now();

        if (!db[slug]) {
          db[slug] = { slug, title: trackMeta.title, artist: trackMeta.artist, cover: trackMeta.cover, playCount: 0, totalTimeMs: 0, firstPlayed: now, lastPlayed: now };
        }

        db[slug].isFavorite = forceState !== null ? forceState : !db[slug].isFavorite;
        db[slug].updatedAt = now;
        saveStatsDB(db);

        return db[slug].isFavorite;
      },

      getTrackStats: function(trackMeta) {
        if (!trackMeta) return null;
        return getStatsDB()[generateSlug(trackMeta.title, trackMeta.artist)] || null;
      },

      getFavorites: function() {
        return Object.values(getStatsDB()).filter(t => t.isFavorite).sort((a, b) => b.lastPlayed - a.lastPlayed);
      },

      getTopTracks: function(limit = 25) {
        return Object.values(getStatsDB()).sort((a, b) => b.playCount - a.playCount).slice(0, limit);
      },

      getTopArtists: function(limit = 10) {
        const db = getStatsDB();
        const artistAgg = {};

        Object.values(db).forEach(track => {
          if (!artistAgg[track.artist]) artistAgg[track.artist] = { artist: track.artist, playCount: 0, totalTimeMs: 0 };
          artistAgg[track.artist].playCount += track.playCount;
          artistAgg[track.artist].totalTimeMs += track.totalTimeMs;
        });

        return Object.values(artistAgg).sort((a, b) => b.playCount - a.playCount).slice(0, limit);
      },

      getHistory: function(limit = 50) {
        return getHistoryDB().slice(0, limit);
      },

      recordDiscovery: function(trackMeta) {
        if (!trackMeta) return;
        const slug = generateSlug(trackMeta.title, trackMeta.artist);
        const now = Date.now();
        const discoveries = getDiscoveriesDB();
        
        if (discoveries.length > 0 && discoveries[0].slug === slug) return;

        discoveries.unshift({ slug, timestamp: now, meta: trackMeta });
        if (discoveries.length > 150) discoveries.length = 150;
        saveDiscoveriesDB(discoveries);
      },

      getDiscoveries: function(limit = 50) {
        return getDiscoveriesDB().slice(0, limit);
      },

      mergeSync: function(cloudStatsDB, cloudHistoryArray, cloudDiscoveriesArray = []) {
        let localStatsUpdated = false;
        let localHistoryUpdated = false;
        let localDiscoveriesUpdated = false;

        if (cloudStatsDB && typeof cloudStatsDB === 'object') {
          const localDb = getStatsDB();
          const baselineDb = getBaselineDB();
          
          const { merged } = MergeEngine.mergeKeyedCollection({
            baseline: baselineDb, local: localDb, remote: cloudStatsDB, localTombstones: {}, remoteTombstones: {}
          });

          for (const key in merged) {
            const lNode = localDb[key] || { playCount: 0, totalTimeMs: 0 };
            const cNode = cloudStatsDB[key] || { playCount: 0, totalTimeMs: 0 };
            const bNode = baselineDb[key];

            if (!bNode) {
              merged[key].playCount = Math.max(lNode.playCount, cNode.playCount);
              merged[key].totalTimeMs = Math.max(lNode.totalTimeMs, cNode.totalTimeMs);
            } else {
              const localDeltaPlays = Math.max(0, lNode.playCount - bNode.playCount);
              const remoteDeltaPlays = Math.max(0, cNode.playCount - bNode.playCount);
              merged[key].playCount = bNode.playCount + localDeltaPlays + remoteDeltaPlays;

              const localDeltaTime = Math.max(0, lNode.totalTimeMs - bNode.totalTimeMs);
              const remoteDeltaTime = Math.max(0, cNode.totalTimeMs - bNode.totalTimeMs);
              merged[key].totalTimeMs = bNode.totalTimeMs + localDeltaTime + remoteDeltaTime;
            }
          }
          
          FluxHubState.set(STATE_KEYS.MUSIC_STATS, merged);
          saveBaselineDB(merged);
          localStatsUpdated = true;
        }

        if (Array.isArray(cloudHistoryArray) && cloudHistoryArray.length > 0) {
          const combined = [...getHistoryDB(), ...cloudHistoryArray];
          const uniqueHistory = Array.from(new Map(combined.map(item => [item.timestamp, item])).values())
                                     .sort((a, b) => b.timestamp - a.timestamp)
                                     .slice(0, 150);
          FluxHubState.set(STATE_KEYS.MUSIC_HISTORY, uniqueHistory);
          localHistoryUpdated = true;
        }

        if (Array.isArray(cloudDiscoveriesArray) && cloudDiscoveriesArray.length > 0) {
          const combined = [...getDiscoveriesDB(), ...cloudDiscoveriesArray];
          const uniqueDiscoveries = Array.from(new Map(combined.map(item => [item.timestamp, item])).values())
                                     .sort((a, b) => b.timestamp - a.timestamp)
                                     .slice(0, 150);
          FluxHubState.set(STATE_KEYS.MUSIC_DISCOVERIES, uniqueDiscoveries);
          localDiscoveriesUpdated = true;
        }

        return { statsMerged: localStatsUpdated, historyMerged: localHistoryUpdated, discoveriesMerged: localDiscoveriesUpdated };
      },

      migrateSlug: function(oldMeta, newMeta) {
        if (!oldMeta || !newMeta) return;
        const oldSlug = generateSlug(oldMeta.title, oldMeta.artist);
        const newSlug = generateSlug(newMeta.title, newMeta.artist);
        if (oldSlug === newSlug) return;

        const db = getStatsDB();
        const oldEntry = db[oldSlug];
        if (!oldEntry) return;

        if (db[newSlug]) {
          db[newSlug].playCount += oldEntry.playCount;
          db[newSlug].totalTimeMs += oldEntry.totalTimeMs;
          db[newSlug].isFavorite = db[newSlug].isFavorite || oldEntry.isFavorite;
          db[newSlug].firstPlayed = Math.min(db[newSlug].firstPlayed, oldEntry.firstPlayed);
          db[newSlug].updatedAt = Date.now();
        } else {
          db[newSlug] = { ...oldEntry, slug: newSlug, title: newMeta.title, artist: newMeta.artist, updatedAt: Date.now() };
        }
        delete db[oldSlug];
        saveStatsDB(db);

        const history = getHistoryDB();
        history.forEach(h => { if (h.slug === oldSlug) h.slug = newSlug; });
        saveHistoryDB(history);
      }
    };
  })();

  FluxKit.ipc.listen('media-control', (payload) => {
    if (payload.action === 'surrender' || payload.action === 'stop-all') {
      if (FluxKit.media) FluxKit.media.surrender();
      return;
    }

    const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA);
    if (am && FluxKit.ipc.ownership.isMineOrStale(am.hostTab, am.timestamp)) {
      if (payload.action === 'edit-meta') FluxKit.media.updateTrackMetadata(payload.id, payload.title, payload.artist);
      if (payload.action === 'pause') FluxKit.media.pause();
      if (payload.action === 'resume') FluxKit.media.resume();
      if (payload.action === 'toggle') FluxKit.media.toggle();
      if (payload.action === 'next') FluxKit.media.next();
      if (payload.action === 'previous') FluxKit.media.previous();
      if (payload.action === 'jump') FluxKit.media.jumpToIndex(payload.index);
      if (payload.action === 'seek') FluxKit.media.seek(payload.position);
      if (payload.action === 'volume') FluxKit.media.setVolume(payload.level);
      if (payload.action === 'clear') { FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, []); FluxKit.media.stop(); }
      if (payload.action === 'toggle-shuffle') FluxKit.media.toggleShuffle();
      if (payload.action === 'toggle-loop') FluxKit.media.toggleLoop();
      if (payload.action === 'reroll') FluxKit.media.reroll();
      if (payload.action === 'stop') FluxKit.media.stop();
    }
  }, true);

  const FALLBACK_COVERS = {
    _fallbackCoverTemplates: {
      waveBars: (a, b) => `
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" rx="16" fill="${a}"/>
          <g stroke="${b}" stroke-width="10" stroke-linecap="round">
            <line x1="50" y1="80" x2="50" y2="120"/>
            <line x1="75" y1="60" x2="75" y2="140"/>
            <line x1="100" y1="45" x2="100" y2="155"/>
            <line x1="125" y1="65" x2="125" y2="135"/>
            <line x1="150" y1="85" x2="150" y2="115"/>
          </g>
        </svg>`,

      concentricRings: (a, b) => `
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" rx="16" fill="${a}"/>
          <circle cx="100" cy="100" r="55" fill="none" stroke="${b}" stroke-width="8" stroke-dasharray="300 45"/>
          <circle cx="100" cy="100" r="32" fill="none" stroke="${b}" stroke-width="8" stroke-dasharray="170 30"/>
          <circle cx="100" cy="100" r="10" fill="${b}"/>
        </svg>`,

      organicBlob: (a, b) => `
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" rx="16" fill="${a}"/>
          <path d="M100 45c30 0 48 22 50 48 2 24-14 50-46 58-34 8-62-14-64-46-2-30 24-60 60-60z" fill="${b}"/>
        </svg>`,

      diagonalStripes: (a, b) => `
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <clipPath id="fc-clip"><rect width="200" height="200" rx="16"/></clipPath>
          </defs>
          <g clip-path="url(#fc-clip)">
            <rect width="200" height="200" fill="${a}"/>
            <g stroke="${b}" stroke-width="14" stroke-linecap="round" opacity="0.85">
              <line x1="-20" y1="220" x2="80" y2="-20"/>
              <line x1="40" y1="220" x2="140" y2="-20"/>
              <line x1="100" y1="220" x2="200" y2="-20"/>
              <line x1="160" y1="220" x2="260" y2="-20"/>
            </g>
          </g>
        </svg>`,

      orbitDot: (a, b) => `
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" rx="16" fill="${a}"/>
          <ellipse cx="100" cy="100" rx="65" ry="38" fill="none" stroke="${b}" stroke-width="6" transform="rotate(-24 100 100)"/>
          <circle cx="152" cy="76" r="11" fill="${b}"/>
        </svg>`,

      softGrid: (a, b) => `
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="200" rx="16" fill="${a}"/>
          <g fill="${b}">
            <circle cx="65" cy="65" r="9"/>
            <circle cx="135" cy="65" r="9"/>
            <circle cx="65" cy="135" r="9"/>
            <circle cx="135" cy="135" r="9"/>
            <circle cx="100" cy="100" r="14"/>
          </g>
        </svg>`
    },

    _getFallbackCoverPalettes: function() {
      const styles = getComputedStyle(FluxHub.ui.container || document.documentElement);
      const read = (varName, fallback) => (styles.getPropertyValue(varName) || fallback).trim() || fallback;

      const accent = read('--omni-accent', '#6366f1');
      const success = read('--omni-success', '#22c55e');
      const warning = read('--omni-warning', '#f59e0b');
      const info = read('--omni-info', '#0ea5e9');

      const mix = (base, pct) => `color-mix(in srgb, ${base} ${pct}%, white)`;
      const mixDark = (base, pct) => `color-mix(in srgb, ${base} ${pct}%, black)`;

      return [
        { a: mix(accent, 18), b: accent },
        { a: mix(success, 16), b: mixDark(success, 70) },
        { a: mix(warning, 18), b: mixDark(warning, 65) },
        { a: mix(info, 16), b: info },
        { a: mixDark(accent, 82), b: mix(accent, 55) } // inverted/darker variant for contrast variety
      ];
    },

    getRandomFallbackCover: function() {
      const templates = Object.values(FALLBACK_COVERS._fallbackCoverTemplates);
      const template = templates[Math.floor(Math.random() * templates.length)];
      const palettes = this._getFallbackCoverPalettes();
      const palette = palettes[Math.floor(Math.random() * palettes.length)];

      const svg = template(palette.a, palette.b).trim();
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
  };

  class MusicView extends BaseView {
    constructor(query, context = null) {
      super(query, context);
      this.ipcUnsubscribe = null;
      this.progressInterval = null;
      this.uiNodes = {};
      this.currentMode = null;
      this.subIndex = -1;
      this.trackNodes = [];
      this.searchResults = [];
      this.playlistItems = [];
      this._previewAudio = null;
      this._activePreviewBtn = null;

      this.STATIC_FALLBACK_COVER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjMjIyIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjgiLz48dGV4dCB4PSI1MCIgeT0iNTUiIGZvbnQtc2l6ZT0iMzAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM1NTUiPvCfjbc8L3RleHQ+PC9zdmc+';
    }

    _fallbackCover(entity = null) {
      try {
        if (!entity || !entity.id) return FALLBACK_COVERS.getRandomFallbackCover();

        MusicView._fallbackCache ??= new Map();
        const cache = MusicView._fallbackCache;

        if (cache.has(entity.id)) {
          const cover = cache.get(entity.id);
          cache.delete(entity.id);
          cache.set(entity.id, cover);
          return cover;
        }

        const cover = FALLBACK_COVERS.getRandomFallbackCover();
        cache.set(entity.id, cover);

        if (cache.size > 250) {
          cache.delete(cache.keys().next().value);
        }

        return cover;
      } catch (e) {
        return this.STATIC_FALLBACK_COVER;
      }
    }

    static get PROVIDER_META() {
      return {
        saavn: { label: 'JioSaavn', icon: 'note', accent: 'var(--omni-success)' },
        soundcloud: { label: 'SoundCloud', icon: 'cloud', accent: 'var(--omni-warning)' },
        audius: { label: 'Audius', icon: 'headphones', accent: 'var(--omni-info)' },
        itunes: { label: 'iTunes', icon: 'play', accent: 'var(--omni-muted)' }
      };
    }

    _renderProviderBadge(track) {
      if (!track) return null;

      let source = track.resolution?.whitelistSource || track.provider;

      if (!source && track.streamUrl) {
        if (track.streamUrl.includes('audius.co')) source = 'audius';
        else if (track.streamUrl.includes('apple.com')) source = 'itunes';
        else source = 'saavn';
      }

      const meta = source && MusicView.PROVIDER_META[source];
      if (!meta) return null;

      return createHTMLElement('div', {
        icon: meta.icon, textContent: meta.label,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '4px',
          fontSize: '10px', fontWeight: '700', letterSpacing: '0.3px', textTransform: 'uppercase',
          color: meta.accent, background: 'var(--omni-input-bg)', border: `1px solid ${meta.accent}`,
          borderRadius: '4px', padding: '2px 6px', width: 'fit-content'
        }
      });
    }

    static get isAvailable() { return true; }

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (/^>\s*(playlist|pl)(\s+|$)/i.test(q)) return 100;
      if (/^>\s*(queue|q)(\s+|$)/i.test(q)) return 100;
      if (/^>\s*(play|p)(\s+|$)/i.test(q)) return 100;
      if (/^>\s*(queuepl|qpl|playpl|searchpl)(\s+|$)/i.test(q)) return 100;
      if (/^>\s*(queueal|qal|playal|searchal)(\s+|$)/i.test(q)) return 100;
      if (/^>\s*(queuear|qar|playar|searchar)(\s+|$)/i.test(q)) return 100;
      if (/^>\s*(discover|lucky)\b/i.test(q)) return 100;
      return 0;
    }

    _scheduleLoaderVisibility(node, isLoading, timerKey = 'default') {
      this._loaderTimers ??= {};
      clearTimeout(this._loaderTimers[timerKey]);

      if (!isLoading) {
        if (node) node.style.display = 'none';
        return;
      }

      this._loaderTimers[timerKey] = setTimeout(() => {
        if (node && node.isConnected) node.style.display = 'flex';
      }, 150);
    }

    _purge() {
      if (this.ipcUnsubscribe) { this.ipcUnsubscribe(); this.ipcUnsubscribe = null; }
      if (this.progressInterval) { clearInterval(this.progressInterval); this.progressInterval = null; }
      clearTimeout(this._volHideTimer);
      if (this._loaderTimers) { Object.values(this._loaderTimers).forEach(clearTimeout); this._loaderTimers = {}; }
      if (this._playerObserver) { this._playerObserver.disconnect(); this._playerObserver = null; }
      this._stopPreview();
      this.trackNodes = [];
      this.playlistItems = [];
    }

    _togglePreview(track, btnNode) {
      if (this._previewAudio && this._activePreviewBtn === btnNode) { this._stopPreview(); return; }
      if (this._previewAudio) this._stopPreview();

      this._activePreviewBtn = btnNode;
      btnNode.innerHTML = safeHTML(`${FluxKit.ui.getIcon('loader')} Loading...`);

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._previewAudio = { ctx, source: null };

      GM_xmlhttpRequest({
        method: 'GET',
        url: track.previewUrl,
        responseType: 'arraybuffer',
        anonymous: true,
        timeout: 8000,
        onload: async (res) => {
          if (!this._previewAudio || this._previewAudio.ctx !== ctx) { try { ctx.close(); } catch(e) {} return; }
          if (res.status < 200 || res.status >= 300) return this._previewFail(btnNode);

          try {
            const buffer = await ctx.decodeAudioData(res.response);
            if (!this._previewAudio || this._previewAudio.ctx !== ctx) { try { ctx.close(); } catch(e) {} return; }

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.onended = () => { if (this._activePreviewBtn === btnNode) this._stopPreview(); };
            source.start(0);

            this._previewAudio.source = source;
            btnNode.innerHTML = safeHTML(`${FluxKit.ui.getIcon('pause')} Playing...`);
          } catch (e) { this._previewFail(btnNode); }
        },
        onerror: () => this._previewFail(btnNode),
        ontimeout: () => this._previewFail(btnNode)
      });
    }

    _previewFail(btnNode) { FluxKit.ui.showNotification('Preview blocked or unavailable.', { icon: 'warning' }); this._stopPreview(); }

    _stopPreview() {
      if (this._previewAudio) {
        try { if (this._previewAudio.source) { this._previewAudio.source.onended = null; this._previewAudio.source.stop(); } } catch(e) {}
        try { this._previewAudio.ctx.close(); } catch(e) {}
      }
      if (this._activePreviewBtn) this._activePreviewBtn.innerHTML = safeHTML(`${FluxKit.ui.getIcon('headphones')}`);
      this._previewAudio = null;
      this._activePreviewBtn = null;
    }

    _styleSlider(slider) {
      const value = (slider.value - slider.min) / (slider.max - slider.min) * 100;
      slider.style.background = `linear-gradient(to right, var(--omni-accent) ${value}%, var(--omni-hover) ${value}%)`;
    }

    async fetchData(signal) {
      const rawQ = this.query.trim();

      if (/^>\s*(playlist|pl)(\s+|$)/i.test(rawQ)) {
        const parts = rawQ.replace(/^>\s*(playlist|pl)\s*/i, '').trim().split(/\s+/);
        const action = parts[0] ? parts[0].toLowerCase() : '';
        const name = parts.slice(1).join(' ');
        const playlists = FluxHubState.get(STATE_KEYS.SAVED_PLAYLISTS, {});

        if ((action === 'add' || action === 'append') && name) {
          const currentQueue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
          return { mode: 'playlist_confirm', action: 'append', name, count: currentQueue.length, exists: !!playlists[name] };
        }

        if (action === 'addtrack' && name) {
          let t = FluxHubState.get(STATE_KEYS.PENDING_ADD_TRACK, null);
          if (!t) {
            const activeMedia = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);
            if (activeMedia && activeMedia.track) t = activeMedia.track;
          }
          return { mode: 'playlist_confirm', action: 'addtrack', name, track: t, exists: !!playlists[name] };
        }

        if ((action === 'delete' || action === 'del' || action === 'rm') && name) {
          return { mode: 'playlist_confirm', action: 'delete', name, exists: !!playlists[name] };
        }

        if ((action === 'rename' || action === 'edit') && name) {
          const splitTokens = name.split(/\s+to\s+/i);
          if (splitTokens.length >= 2) {
             const oldName = splitTokens[0].trim();
             const newName = splitTokens.slice(1).join(' to ').trim();
             return { mode: 'playlist_confirm', action: 'rename', oldName, newName, exists: !!playlists[oldName], targetExists: !!playlists[newName] };
          }
          return { mode: 'playlist_error', action: 'rename', error: 'To rename, use: > pl rename OldName to NewName' };
        }

        if (action === 'load' && name) {
          return { mode: 'playlist_confirm', action: 'load', name, exists: !!playlists[name] };
        }
        return { mode: 'playlist_list', playlists, trackOnly: action === 'addtrack' };
      }

      if (/^>\s*(queuepl|qpl|playpl|searchpl)\b/i.test(rawQ)) {
        const isQueueIntent = /^>\s*(queue|q)/i.test(rawQ);
        const q = rawQ.replace(/^>\s*(queuepl|qpl|playpl|searchpl)\s*/i, '').trim();
        if (q) {
           const results = await FluxKit.api.music.searchPlaylists(q, 10, signal);
           return { mode: 'search_playlists', results, query: q, collectionType: 'playlist', isQueueIntent };
        }
        return { mode: 'empty', error: 'Type a playlist name to search, e.g. "> playpl lofi beats".' };
      }

      if (/^>\s*(queueal|qal|playal|searchal)\b/i.test(rawQ)) {
        const isQueueIntent = /^>\s*(queue|q)/i.test(rawQ);
        const q = rawQ.replace(/^>\s*(queueal|qal|playal|searchal)\s*/i, '').trim();
        if (q) {
           const results = await FluxKit.api.music.searchAlbums(q, 10, signal);
           return { mode: 'search_playlists', results, query: q, collectionType: 'album', isQueueIntent };
        }
        return { mode: 'empty', error: 'Type an album name to search, e.g. "> playal after hours".' };
      }

      if (/^>\s*(queuear|qar|playar|searchar)\b/i.test(rawQ)) {
        const isQueueIntent = /^>\s*(queue|q)/i.test(rawQ);
        const q = rawQ.replace(/^>\s*(queuear|qar|playar|searchar)\s*/i, '').trim();
        if (q) {
           const results = await FluxKit.api.music.searchArtists(q, 10, signal);
           return { mode: 'search_playlists', results, query: q, collectionType: 'artist', isQueueIntent };
        }
        return { mode: 'empty', error: 'Type an artist name to search, e.g. "> playar the weeknd".' };
      }

      if (/^>\s*discover\b/i.test(rawQ)) {
        const results = await FluxKit.api.music.discover('trending', 15, signal);
        return { mode: 'search', results, query: 'Discover', isQueueIntent: false };
      }

      if (/^>\s*lucky\b/i.test(rawQ)) {
        const results = await FluxKit.api.music.discover('trending', 50, signal);
        if (results.length > 0) {
          const track = results[Math.floor(Math.random() * results.length)];
          return { mode: 'search', results: [track], query: 'Lucky', isQueueIntent: false };
        }
        return { mode: 'empty', error: 'No tracks found.' };
      }

      const isQueueIntent = /^>\s*(queue|q)\b/i.test(rawQ);
      const q = rawQ.replace(/^>\s*(play|p|queue|q)\b\s*/i, '').trim();

      if (q) {
        const results = await FluxKit.api.music.search(q, 10, signal);
        return { mode: 'search', results, query: q, isQueueIntent };
      }

      const activeMedia = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);
      if (activeMedia && activeMedia.track) {
        const queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
        const queueIndex = FluxHubState.get(STATE_KEYS.QUEUE_INDEX, 0);
        const loadedPlaylistName = FluxHubState.get(STATE_KEYS.ACTIVE_PLAYLIST_NAME, null);

        let estProgress = activeMedia.progress || 0;
        if (activeMedia.isPlaying && activeMedia.timestamp) { estProgress += (Date.now() - activeMedia.timestamp) / 1000; }
        const maxDur = (activeMedia.track.durationMs || 1000) / 1000;
        if (estProgress > maxDur) estProgress = maxDur;

        return { mode: 'playing', queue, queueIndex, loadedPlaylistName, ...activeMedia, progress: estProgress };
      }

      return { mode: 'empty', error: 'No media playing. Explore new music or play a track.' };
    }

    renderProviderChips(currentMode) {
      if (currentMode !== 'search' && currentMode !== 'empty' && currentMode !== 'search_playlists') return null;

      let activeProvider = FluxHubState.get(STATE_KEYS.MUSIC_PROVIDER, 'itunes_hub');
      const customSaavnUrl = FluxHubState.get(STATE_KEYS.CUSTOM_SAAVN_URL, '').trim();
      if (activeProvider === 'saavn' && !customSaavnUrl) {
        activeProvider = 'soundcloud';
        FluxHubState.set(STATE_KEYS.MUSIC_PROVIDER, 'soundcloud');
        FluxHubState.set(STATE_KEYS.SEARCH_CONFIG, { ...SettingsState.getAll(), musicProvider: 'soundcloud' });
      }

      const providers = [
        { id: 'itunes_hub', label: 'iTunes Hub' },
        { id: 'soundcloud', label: 'SoundCloud' },
        ...(customSaavnUrl ? [{ id: 'saavn', label: 'JioSaavn' }] : []),
        { id: 'audius', label: 'Audius' },
        { id: 'itunes', label: 'iTunes' }
      ];

      const chipContainer = createHTMLElement('div', {
        style: { display: 'flex', gap: '8px', padding: '12px', borderBottom: '1px solid var(--omni-separator)', overflowX: 'auto', alignItems: 'center' }
      });
      chipContainer.style.cssText += '::-webkit-scrollbar { display: none; }';

      const currentQueue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
      if (currentQueue.length > 0 && currentMode !== 'empty') {
        const queueChip = createHTMLElement('div', {
          icon: 'note', textContent: `Queue (${currentQueue.length})`, class: 'flx-queue-chip',
          style: {
            padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer',
            background: 'var(--omni-hover)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)',
            display: 'flex', alignItems: 'center', gap: '6px', flexShrink: '0', transition: 'background 0.2s ease'
          },
          eventListener: {
            click: (e) => { e.stopPropagation(); FluxHub.ui.setInputVal('> queue '); },
            mouseenter: (e) => { e.target.style.background = 'var(--omni-hover)' },
            mouseleave: (e) => { e.target.style.background = 'var(--omni-input-bg)' }
          }
        });
        chipContainer.appendChild(queueChip);

        const divider = createHTMLElement('div', { style: { width: '1px', height: '16px', background: 'var(--omni-separator)', margin: '0 4px', flexShrink: '0' } });
        chipContainer.appendChild(divider);
      }

      providers.forEach(prov => {
        const isActive = activeProvider === prov.id;
        const chip = createHTMLElement('div', {
          textContent: prov.label,
          style: {
            padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
            transition: 'all 0.2s ease', background: isActive ? 'var(--omni-accent)' : 'transparent',
            color: isActive ? 'var(--omni-btn-text)' : 'var(--omni-muted)', border: `1px solid ${isActive ? 'var(--omni-accent)' : 'var(--omni-border)'}`,
            flexShrink: '0'
          },
          eventListener: (e) => {
            e.stopPropagation();
            if (isActive) return;
            FluxHubState.set(STATE_KEYS.MUSIC_PROVIDER, prov.id);
            FluxHubState.set(STATE_KEYS.SEARCH_CONFIG, { ...SettingsState.getAll(), musicProvider: prov.id });
            this.execute();
          }
        });
        chipContainer.appendChild(chip);
      });

      return chipContainer;
    }

    renderListRow() {
      const rawQ = this.query.trim();
      if (/^>\s*(playpl|searchpl)\b/i.test(rawQ)) return FluxKit.ui.omni.ListRow('Search Playlists', 'playlist', 'Music Discovery');
      if (/^>\s*(playal|searchal)\b/i.test(rawQ)) return FluxKit.ui.omni.ListRow('Search Albums', 'album', 'Music Discovery');
      if (/^>\s*(playar|searchar)\b/i.test(rawQ)) return FluxKit.ui.omni.ListRow('Search Artists', 'headphones', 'Music Discovery');
      if (/^>\s*discover\b/i.test(rawQ)) return FluxKit.ui.omni.ListRow('Trending Tracks', 'trending', 'Music Discovery', 'Fetching...');
      if (/^>\s*lucky\b/i.test(rawQ)) return FluxKit.ui.omni.ListRow('Lucky', 'shine', 'Music Discovery', 'Finding a random hit...');
      if (/^>\s*(playlist|pl)\b/i.test(rawQ)) return FluxKit.ui.omni.ListRow('Playlist Manager', 'list', 'Saved Playlists');
      if (/^>\s*(queue|q)\b/i.test(rawQ)) return FluxKit.ui.omni.ListRow('Add Track to Queue', 'plus', 'Queue Control');
      return FluxKit.ui.omni.ListRow('Now Playing & Controls', 'note', 'Interactive Player');
    }

    _sendCommand = (action, payload = {}) => {
      const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA);
      if (!am || !am.hostTab || am.hostTab === FluxKit.ipc.getTabId()) {
        if (action === 'edit-meta') FluxKit.media.updateTrackMetadata(payload.id, payload.title, payload.artist);
        if (action === 'resume') FluxKit.media.resume();
        if (action === 'pause') FluxKit.media.pause();
        if (action === 'toggle') FluxKit.media.toggle();
        if (action === 'next') FluxKit.media.next();
        if (action === 'previous') FluxKit.media.previous();
        if (action === 'jump') FluxKit.media.jumpToIndex(payload.index);
        if (action === 'seek') FluxKit.media.seek(payload.position);
        if (action === 'volume') FluxKit.media.setVolume(payload.level);
        if (action === 'toggle-shuffle') FluxKit.media.toggleShuffle();
        if (action === 'toggle-loop') FluxKit.media.toggleLoop();
        if (action === 'reroll') FluxKit.media.reroll();
        return;
      }
      FluxKit.ipc.broadcast('media-control', { action, ...payload }, true);
    }

    renderExpandedCard(data) {
      this._purge();
      this.currentMode = data.mode;
      this._isMediaLoading = !!data.isLoading;
      this.subIndex = -1;
      this.searchResults = data.results || [];

      const formatTime = (secs) => {
        if (isNaN(secs) || secs < 0) secs = 0;
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
      };

      const sendCommand = (action, payload = {}) => this._sendCommand(action, payload);

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: 'var(--omni-font)' } });

      const chips = this.renderProviderChips(data.mode);
      if (chips) container.appendChild(chips);

      if (data.mode === 'empty') {
        const welcomeBlock = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px', gap: '16px' }});
        welcomeBlock.appendChild(createHTMLElement('div', { style: { color: 'var(--omni-muted)', fontSize: '14px', textAlign: 'center' }, textContent: data.error }));

        const quickActions = createHTMLElement('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }});
        const chipsData = [
          { icon: 'trending', label: 'Trending', cmd: '> discover' },
          { icon: 'shine', label: 'Lucky', cmd: '> lucky' },
          { icon: 'headphones', label: 'Artists', cmd: '> playar ' },
          { icon: 'album', label: 'Albums', cmd: '> playal ' },
          { icon: 'playlist', label: 'Playlists', cmd: '> playpl ' },
          { icon: 'note', label: 'View Queue', cmd: '> queue ' }
        ];

        chipsData.forEach(c => {
          const chip = createHTMLElement('div', { icon: c.icon, textContent: c.label,
            style: { padding: '8px 16px', display: 'flex', gap: '8px', background: 'var(--omni-hover)', borderRadius: '24px', fontSize: '13px', fontWeight: 'bold', color: 'var(--omni-text)', cursor: 'pointer', border: '1px solid var(--omni-border)' },
            eventListener: () => FluxHub.ui.setInputVal(c.cmd)
          });
          quickActions.appendChild(chip);
        });

        welcomeBlock.appendChild(quickActions);
        container.appendChild(welcomeBlock);
        return FluxKit.ui.omni.DetailCard(container, []);
      }

      if (data.mode === 'playlist_confirm' || data.mode === 'playlist_error') {
        let msg = '';
        if (data.action === 'append') msg = data.count === 0 ? `Queue is empty. Cannot create or append to playlist "${data.name}".` : (data.exists ? `Append ${data.count} tracks from queue to "${data.name}"?` : `Create new playlist "${data.name}" with ${data.count} tracks from queue?`);
        else if (data.action === 'addtrack') msg = !data.track ? `No track specified or currently playing.` : (data.exists ? `Add "${data.track.title}" to playlist "${data.name}"?` : `Create new playlist "${data.name}" with "${data.track.title}"?`);
        else if (data.action === 'delete') msg = data.exists ? `Delete playlist "${data.name}" permanently?` : `Playlist "${data.name}" does not exist.`;
        else if (data.action === 'load') msg = data.exists ? `Load playlist "${data.name}" into queue?` : `Playlist "${data.name}" not found.`;
        else if (data.action === 'rename') {
          if (data.mode === 'playlist_error') msg = data.error;
          else if (!data.exists) msg = `Playlist "${data.oldName}" does not exist.`;
          else if (data.targetExists) msg = `Playlist "${data.newName}" already exists. Please choose a different name.`;
          else msg = `Rename playlist "${data.oldName}" to "${data.newName}"?`;
        }

        container.appendChild(createHTMLElement('div', { style: { color: 'var(--omni-text)', textAlign: 'center', padding: '16px', fontWeight: '500' }, textContent: msg }));

        const actions = [];
        const isErrorState = data.mode === 'playlist_error' ||
          (data.action === 'append' && data.count === 0) ||
          (data.action === 'addtrack' && !data.track) ||
          ((data.action === 'delete' || data.action === 'load') && !data.exists) ||
          (data.action === 'rename' && (!data.exists || data.targetExists));

        if (!isErrorState) actions.push(FluxKit.ui.omni.Button('enter', 'Confirm Action', () => this.execute()));

        return FluxKit.ui.omni.DetailCard(container, actions);
      }

      if (data.mode === 'playlist_list') {
        const names = Object.keys(data.playlists).sort((a, b) => a.localeCompare(b));
        if (names.length === 0) {
          container.appendChild(createHTMLElement('div', { style: { color: 'var(--omni-muted)', textAlign: 'center', padding: '16px', fontSize: '13px' }, textContent: 'No saved playlists. Type "> pl add <name>" to save your active queue.' }));
        } else {
          names.forEach((pName, index) => {
            const pRow = createHTMLElement('div', {
              style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '6px', cursor: 'pointer' },
              eventListener: {
                mouseenter: () => { this.subIndex = index; this.updateSubSelection(); },
                click: (e) => { e.stopPropagation(); this.executePlaylistAction(pName) }
              }
            });

            const leftWrap = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
            leftWrap.appendChild(createHTMLElement('span', { icon: 'note' }));
            leftWrap.appendChild(createHTMLElement('span', { textContent: `${pName} (${data.playlists[pName].tracks.length})`, style: { fontWeight: '600', fontSize: '14px' } }));
            pRow.appendChild(leftWrap);

            const actionGroup = createHTMLElement('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } });

            const qBtn = createHTMLElement('button', {
              icon: 'plus', fluxHubTooltip: 'Append playlist to active queue',
              style: {
                background: 'var(--omni-input-bg)', border: '1px solid var(--omni-border)', color: 'var(--omni-muted)',
                padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.2s ease'
              },
              eventListener: {
                mouseenter: (e) => { e.target.style.background = 'var(--omni-hover)'; e.target.style.color = 'var(--omni-text)'; },
                mouseleave: (e) => { e.target.style.background = 'var(--omni-input-bg)'; e.target.style.color = 'var(--omni-muted)'; },
                click: (e) => {
                  e.stopPropagation();
                  this.executePlaylistLoad(pName, true);
                }
              }
            });

            const editBtn = createHTMLElement('button', { icon: 'edit',
              style: {
                background: 'var(--omni-input-bg)', border: '1px solid var(--omni-border)', color: 'var(--omni-muted)',
                padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.2s ease'
              },
              eventListener: {
                mouseenter: (e) => { e.target.style.background = 'var(--omni-hover)'; e.target.style.color = 'var(--omni-text)'; },
                mouseleave: (e) => { e.target.style.background = 'var(--omni-input-bg)'; e.target.style.color = 'var(--omni-muted)'; },
                click: (e) => {
                  e.stopPropagation();
                  FluxHub.ui.setInputVal(`> pl rename ${pName} to `);
                  setTimeout(() => FluxHub.ui.input.focus(), 10);
                }
              }
            });

            actionGroup.appendChild(qBtn);
            actionGroup.appendChild(editBtn);
            pRow.appendChild(actionGroup);

            this.playlistItems.push({ name: pName, node: pRow });
            container.appendChild(pRow);
          });
          if (this.playlistItems.length > 0) { this.subIndex = 0; this.updateSubSelection(); }
        }
        return FluxKit.ui.omni.DetailCard(container, []);
      }

      if (data.mode === 'search_playlists') {
        if (!data.results || data.results.length === 0) {
          const typeLabel = data.collectionType ? data.collectionType + 's' : 'playlists';
          container.appendChild(createHTMLElement('div', { textContent: `No ${typeLabel} found.`, style: { color: 'var(--omni-muted)', textAlign: 'center', padding: '20px' } }));
        } else {
          const isQueueIntent = data.isQueueIntent;
          data.results.forEach((pl, index) => {
            pl.collectionType = pl.collectionType || data.collectionType;
            const row = createHTMLElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px', borderRadius: '8px', cursor: 'pointer' },
              eventListener: {
                mouseenter: () => { this.subIndex = index; this.updateSubSelection(); },
                click: (e) => { e.stopPropagation(); this.executeLoadRemotePlaylist(pl, isQueueIntent); }
              }
            });

            row.appendChild(createHTMLElement('img', { src: pl.cover || this._fallbackCover(pl),
              style: { width: '44px', height: '44px', borderRadius: '4px', objectFit: 'cover' },
              eventListener: { error: (e) => { e.target.onerror = null; e.target.src = this._fallbackCover(pl); } }
            }));

            const info = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', overflow: 'hidden' } });
            info.appendChild(createHTMLElement('div', { textContent: pl.title, style: { fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }));

            const subInfo = createHTMLElement('div', { style: { display: 'flex', gap: '6px', color: 'var(--omni-muted)', fontSize: '12px', alignItems: 'center', marginTop: '2px' } });
            
            let hasAddedSub = false;
            if (pl.creator) {
              subInfo.appendChild(createHTMLElement('span', { textContent: pl.creator, style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }));
              hasAddedSub = true;
            }
            if (pl.trackCount !== undefined) {
              if (hasAddedSub) subInfo.appendChild(createHTMLElement('span', { textContent: '•', style: { opacity: '0.5' } }));
              subInfo.appendChild(createHTMLElement('span', { textContent: `${pl.trackCount} tracks`, style: { fontWeight: 'bold' } }));
              hasAddedSub = true;
            }

            if (pl.collectionType === 'album') {
              if (hasAddedSub) subInfo.appendChild(createHTMLElement('span', { textContent: '•', style: { opacity: '0.5' } }));
              subInfo.appendChild(createHTMLElement('span', { textContent: 'Album', style: { color: 'var(--omni-accent)', fontWeight: '600' } }));
            } else if (pl.collectionType && pl.collectionType.startsWith('artist')) {
              if (hasAddedSub) subInfo.appendChild(createHTMLElement('span', { textContent: '•', style: { opacity: '0.5' } }));
              subInfo.appendChild(createHTMLElement('span', { textContent: 'Artist', style: { color: 'var(--omni-accent)', fontWeight: '600' } }));
            }

            info.appendChild(subInfo);
            row.appendChild(info);

            const actions = createHTMLElement('div', { style: { display: 'flex', gap: '8px', flexShrink: '0', alignItems: 'center' } });

            const qBtn = createHTMLElement('div', {
              icon: isQueueIntent ? 'play' : 'plus', fluxHubTooltip: isQueueIntent ? 'Play all tracks' : 'Add all tracks to Queue',
              style: {
                fontSize: '11px', background: 'var(--omni-input-bg)', padding: '4px 8px',
                borderRadius: '4px', color: 'var(--omni-muted)', display: 'flex', alignItems: 'center', cursor: 'pointer'
              },
              eventListener: (e) => {
                e.stopPropagation();
                this.executeLoadRemotePlaylist(pl, !isQueueIntent, row);
              }
            });

            let hintText = isQueueIntent ? 'Add to Queue' : 'Load Playlist';
            if (!isQueueIntent) {
              if (pl.collectionType === 'album') hintText = 'Load Album';
              else if (pl.collectionType === 'artist_singles') hintText = 'Load Singles';
              else if (pl.collectionType && pl.collectionType.startsWith('artist')) hintText = 'Top Tracks';
            }

            const mainHint = createHTMLElement('div', { class: 'flx-omni-action-hint', icon: 'enter', textContent: hintText, style: { display: 'flex', gap: '4px', fontSize: '11px', fontWeight: 'bold', color: 'var(--omni-accent)', padding: '4px 0', whiteSpace: 'nowrap' } });

            actions.appendChild(qBtn);
            actions.appendChild(mainHint);
            row.appendChild(actions);

            this.trackNodes.push(row);
            container.appendChild(row);
          });
          if (this.trackNodes.length > 0) { this.subIndex = 0; this.updateSubSelection(); }
        }
        return FluxKit.ui.omni.DetailCard(container, []);
      }

      if (data.mode === 'search') {
        data.results.forEach((track, index) => {
          const row = createHTMLElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px', borderRadius: '8px', cursor: 'pointer' },
            eventListener: {
              mouseenter: () => { this.subIndex = index; this.updateSubSelection(); },
              click: (e) => { e.stopPropagation(); this.executeTrackAction(track, data.isQueueIntent, row); }
            }
          });

          row.appendChild(createHTMLElement('img', { src: track.cover || this._fallbackCover(track),
            style: { width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover' },
            eventListener: { error: (e) => { e.target.onerror = null; e.target.src = this._fallbackCover(track); } }
          }));

          const info = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', overflow: 'hidden' } });
          info.appendChild(createHTMLElement('div', { textContent: track.title, style: { fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }));

          const durationSecs = (track.durationMs || 0) / 1000;
          const isPreview = durationSecs > 0 && durationSecs <= 45;

          const subInfo = createHTMLElement('div', { style: { display: 'flex', gap: '6px', color: 'var(--omni-muted)', fontSize: '12px', alignItems: 'center', marginTop: '2px' } });
          subInfo.appendChild(createHTMLElement('span', { textContent: track.artist, style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }));

          if (durationSecs > 0) {
            subInfo.appendChild(createHTMLElement('span', { textContent: '•', style: { opacity: '0.5' } }));
            const durationBadge = createHTMLElement('span', {
              textContent: formatTime(durationSecs),
              style: {
                background: isPreview ? 'rgba(255, 165, 0, 0.15)' : 'var(--omni-hover)',
                color: isPreview ? 'var(--omni-warning)' : 'var(--omni-text)',
                padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', fontFamily: 'monospace'
              }
            });
            subInfo.appendChild(durationBadge);
          }

          info.appendChild(subInfo);
          row.appendChild(info);

          const actions = createHTMLElement('div', { style: { display: 'flex', gap: '8px', flexShrink: '0', alignItems: 'center' } });

          if (FluxHubState.get(STATE_KEYS.MUSIC_PROVIDER, 'itunes_hub') === 'itunes_hub' && track.previewUrl) {
            const verifyBtn = createHTMLElement('div', { icon: 'headphones',
              style: {
                fontSize: '11px', background: 'var(--omni-input-bg)', padding: '4px 8px',
                borderRadius: '4px', color: 'var(--omni-muted)', display: 'flex',
                alignItems: 'center', gap: '4px', cursor: 'pointer', whiteSpace: 'nowrap'
              },
              eventListener: (e) => { e.stopPropagation(); this._togglePreview(track, verifyBtn); }
            });
            actions.appendChild(verifyBtn);
          }

          const plBtn = createHTMLElement('div', {
            icon: 'playlistAdd', fluxHubTooltip: 'Add to Playlist',
            style: {
              fontSize: '11px', background: 'var(--omni-input-bg)', padding: '4px 8px',
              borderRadius: '4px', color: 'var(--omni-muted)', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center'
            },
            eventListener: (e) => {
              e.stopPropagation();
              FluxHubState.set(STATE_KEYS.PENDING_ADD_TRACK, track);
              FluxHub.ui.setInputVal(`> pl addtrack `);
            }
          });

          const hintAction = data.isQueueIntent ? 'Add to Queue' : 'Play';
          const mainHint = createHTMLElement('div', { class: 'flx-omni-action-hint', icon: 'enter', textContent: hintAction, style: { display: 'flex', gap: '4px', fontSize: '11px', fontWeight: 'bold', color: 'var(--omni-accent)', padding: '4px 0', whiteSpace: 'nowrap', minWidth: '95px', textAlign: 'right' } });

          actions.appendChild(plBtn);
          actions.appendChild(mainHint);
          row.appendChild(actions);

          this.trackNodes.push(row);
          container.appendChild(row);
        });
        if (this.trackNodes.length > 0) { this.subIndex = 0; this.updateSubSelection(); }
        return FluxKit.ui.omni.DetailCard(container, []);
      }

      if (data.mode === 'playing') {
        const track = data.track;
        const maxDurationSecs = (track.durationMs || 1000) / 1000;

        const compactWrapper = createHTMLElement('div', {
          style: {
            position: 'sticky', top: '-16px', zIndex: '50',
            height: '0', width: '100%', overflow: 'visible'
          }
        });

        const compactPanel = createHTMLElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 20px',
            margin: '15px -20px',
            background: 'var(--omni-bg-solid)', borderBottom: '1px solid var(--omni-border)',
            boxShadow: 'var(--omni-shadow)', backdropFilter: 'blur(16px)',
            opacity: '0', pointerEvents: 'none', transform: 'translateY(-100%)',
            transition: 'all 0.3s cubic-bezier(0.2, 0, 0, 1)', cursor: 'pointer'
          },
          eventListener: {
            click: () => {
              if (playerPanel) playerPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        });

        const cAmbientProgress = createHTMLElement('div', {
          style: { position: 'absolute', bottom: '0', left: '0', height: '2px', background: 'var(--omni-accent)', width: '0%', transition: 'width 0.2s linear' }
        });
        compactPanel.appendChild(cAmbientProgress);

        const cCover = createHTMLElement('img', {
          src: track.cover || this._fallbackCover(track),
          style: { width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover', border: '1px solid var(--omni-border)', flexShrink: '0' },
          eventListener: {
            error: (e) => { e.target.onerror = null; e.target.src = this._fallbackCover(track); },
            click: (e) => {
              e.stopPropagation();
              FluxHubState.set('flx_inspect_track', track);
              FluxHub.ui.setInputVal('> stats');
            }
          }
        });
        compactPanel.appendChild(cCover);

        const cTextWrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', overflow: 'hidden', whiteSpace: 'nowrap' } });
        const cTitle = createHTMLElement('div', { textContent: track.title, style: { fontSize: '13px', fontWeight: 'bold', textOverflow: 'ellipsis', overflow: 'hidden', color: 'var(--omni-text)' } });
        const cArtist = createHTMLElement('div', { textContent: track.artist, style: { fontSize: '11px', color: 'var(--omni-muted)', textOverflow: 'ellipsis', overflow: 'hidden' } });
        cTextWrap.appendChild(cTitle);
        cTextWrap.appendChild(cArtist);
        compactPanel.appendChild(cTextWrap);

        const cControls = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: '0' } });
        const cCtrlStyle = { width: '28px', height: '28px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--omni-muted)', cursor: 'pointer', borderRadius: '50%', transition: 'all 0.2s' };

        const cPrevBtn = createHTMLElement('button', {
          style: cCtrlStyle, icon: 'prev',
          eventListener: {
            click: () => sendCommand('previous'),
            mouseenter: (e) => { e.target.style.background = 'var(--omni-hover)'; e.target.style.color = 'var(--omni-text)'; },
            mouseleave: (e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--omni-muted)'; }
          }
        });

        this.uiNodes.cPlayBtn = createHTMLElement('button', {
          icon: data.isLoading ? 'loader' : data.isPlaying ? 'pause' : 'play',
          style: { width: '32px', height: '32px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--omni-text)', color: 'var(--omni-bg-light)', border: 'none', cursor: 'pointer', borderRadius: '50%', transition: 'transform 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' },
          eventListener: {
            click: () => { if (!this._isMediaLoading) sendCommand('toggle'); },
            mouseenter: (e) => { e.target.style.transform = 'scale(1.08)' },
            mouseleave: (e) => { e.target.style.transform = 'scale(1)' }
          }
        });

        const cNextBtn = createHTMLElement('button', {
          style: cCtrlStyle, icon: 'next',
          eventListener: {
            click: () => sendCommand('next'),
            mouseenter: (e) => { e.target.style.background = 'var(--omni-hover)'; e.target.style.color = 'var(--omni-text)'; },
            mouseleave: (e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--omni-muted)'; }
          }
        });

        cControls.appendChild(cPrevBtn);
        cControls.appendChild(this.uiNodes.cPlayBtn);
        cControls.appendChild(cNextBtn);
        compactPanel.appendChild(cControls);

        compactWrapper.appendChild(compactPanel);
        container.appendChild(compactWrapper);

        const playerPanel = createHTMLElement('div', {
          style: {
            display: 'flex', gap: '16px', alignItems: 'center', padding: '16px',
            background: 'var(--omni-bg-light)', borderRadius: '12px',
            border: '1px solid var(--omni-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            position: 'relative', overflow: 'hidden'
          }
        });

        setTimeout(() => {
          if (!playerPanel.isConnected) return;
          this._playerObserver = new IntersectionObserver(([entry]) => {
              if (entry.intersectionRatio < 0.2) {
                  // Show compact player
                  compactPanel.style.opacity = '1';
                  compactPanel.style.pointerEvents = 'auto';
                  compactPanel.style.transform = 'translateY(0)';
              } else {
                  // Hide compact player
                  compactPanel.style.opacity = '0';
                  compactPanel.style.pointerEvents = 'none';
                  compactPanel.style.transform = 'translateY(-100%)';
              }
          }, { root: FluxHub.ui.resultsList, threshold: [0, 0.2, 1.0] });
          this._playerObserver.observe(playerPanel);
        }, 100);

        const ambientProgress = createHTMLElement('div', {
          style: { position: 'absolute', top: '0', left: '0', height: '2px', background: 'var(--omni-accent)', width: '0%', transition: 'width 0.2s linear', opacity: '0.5' }
        });

        const coverWrap = createHTMLElement('div', { style: { position: 'relative', width: '80px', height: '80px', flexShrink: '0' } });
        const coverImg = createHTMLElement('img', {
          src: track.cover || this._fallbackCover(track),
          style: { width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover', display: 'block', border: '1px solid var(--omni-border)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' },
          eventListener: {
            error: (e) => {
              e.target.onerror = null;
              e.target.src = this._fallbackCover(track);
            },
            click: (e) => {
              e.stopPropagation();
              FluxHubState.set('flx_inspect_track', track);
              FluxHub.ui.setInputVal('> stats');
            },
            mouseenter: (e) => { e.target.style.transform = 'scale(1.05)' },
            mouseleave: (e) => { e.target.style.transform = 'scale(1)' }
          }
        });
        this.uiNodes.coverLoader = createHTMLElement('div', {
          icon: FluxKit.ui.icons.loader,
          style: {
            position: 'absolute', inset: '0', borderRadius: '8px',
            display: 'none', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)', color: 'var(--omni-accent-text)', fontSize: '22px'
          }
        });
        if (data.isLoading) this.uiNodes.coverLoader.style.display = 'flex';
        coverWrap.appendChild(coverImg);
        coverWrap.appendChild(this.uiNodes.coverLoader);
        playerPanel.appendChild(coverWrap);

        const panelRight = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', gap: '10px', minWidth: '0' } });

        const headerRow = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' } });

        const textWrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', overflow: 'hidden', flexGrow: '1', minWidth: '0' } });
        const titleLine = createHTMLElement('div', { textContent: track.title, style: { fontSize: '15px', fontWeight: 'bold', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'var(--omni-text)' } });
        const artistLine = createHTMLElement('div', { textContent: track.artist, style: { fontSize: '13px', color: 'var(--omni-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' } });
        textWrap.appendChild(titleLine);
        textWrap.appendChild(artistLine);

        const editFieldBase = { display: 'none', fontSize: '12px', padding: '4px 6px', borderRadius: '5px', border: '1px solid var(--omni-border)', background: 'var(--omni-input-bg)', color: 'var(--omni-text)', width: '100%', boxSizing: 'border-box' };
        const titleEditInput = createHTMLElement('input', { value: track.title, style: { ...editFieldBase, fontWeight: 'bold' } });
        const artistEditInput = createHTMLElement('input', { value: track.artist, style: { ...editFieldBase, marginTop: '4px' } });
        textWrap.appendChild(titleEditInput);
        textWrap.appendChild(artistEditInput);

        const metaActionsWrap = createHTMLElement('div', { style: { display: 'flex', gap: '2px', flexShrink: '0' } });
        const editMetaBtn = createHTMLElement('button', {
          icon: 'edit', fluxHubTooltip: 'Fix title / artist',
          style: { background: 'transparent', color: 'var(--omni-accent)', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', fontSize: '9px' }
        });
        const saveMetaBtn = createHTMLElement('button', { textContent: '✓', fluxHubTooltip: 'Save', style: { background: 'transparent', border: 'none', color: 'var(--omni-success)', cursor: 'pointer', padding: '4px', display: 'none', alignItems: 'center', fontWeight: 'bold' } });
        const cancelMetaBtn = createHTMLElement('button', { textContent: '✕', fluxHubTooltip: 'Cancel', style: { background: 'transparent', border: 'none', color: 'var(--omni-muted)', cursor: 'pointer', padding: '4px', display: 'none', alignItems: 'center' } });

        const setMetaEditMode = (on) => {
          titleLine.style.display = on ? 'none' : 'block';
          artistLine.style.display = on ? 'none' : 'block';
          titleEditInput.style.display = on ? 'block' : 'none';
          artistEditInput.style.display = on ? 'block' : 'none';
          editMetaBtn.style.display = on ? 'none' : 'flex';
          saveMetaBtn.style.display = on ? 'flex' : 'none';
          cancelMetaBtn.style.display = on ? 'flex' : 'none';
          if (on) { titleEditInput.value = track.title; artistEditInput.value = track.artist; titleEditInput.focus(); }
        };

        editMetaBtn.addEventListener('click', (e) => { e.stopPropagation(); setMetaEditMode(true); });
        cancelMetaBtn.addEventListener('click', (e) => { e.stopPropagation(); setMetaEditMode(false); });
        saveMetaBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const newTitle = titleEditInput.value.trim();
          const newArtist = artistEditInput.value.trim();
          if (newTitle || newArtist) sendCommand('edit-meta', { id: track.id, title: newTitle, artist: newArtist });
          setMetaEditMode(false);
        });

        metaActionsWrap.appendChild(editMetaBtn);
        metaActionsWrap.appendChild(saveMetaBtn);
        metaActionsWrap.appendChild(cancelMetaBtn);

        this.uiNodes.status = createHTMLElement('div', {
          icon: data.isPlaying ? 'play' : 'pause', textContent: data.isPlaying ? 'PLAYING' : 'PAUSED',
          style: {
            fontSize: '10px', display: 'flex', gap: '4px', fontWeight: 'bold',
            color: data.isPlaying ? 'var(--omni-success)' : 'var(--omni-warning)',
            padding: '2px 6px', background: 'var(--omni-input-bg)', borderRadius: '4px', border: '1px solid var(--omni-border)',
            flexShrink: '0'
          }
        });

        const statusWrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: '0' } });
        statusWrap.appendChild(this.uiNodes.status);
        this.uiNodes.providerBadge = this._renderProviderBadge(track);
        if (this.uiNodes.providerBadge) statusWrap.appendChild(this.uiNodes.providerBadge);

        headerRow.appendChild(textWrap);
        headerRow.appendChild(metaActionsWrap);
        headerRow.appendChild(statusWrap);
        panelRight.appendChild(headerRow);

        const seekContainer = createHTMLElement('div', { class: 'flx-seek-wrap', style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--omni-muted)', fontFamily: 'monospace' } });
        const currTimeEl = createHTMLElement('span', { textContent: formatTime(data.progress || 0), style: { minWidth: '35px', textAlign: 'right' } });

        const slider = createHTMLElement('input', {
          type: 'range', min: 0, max: maxDurationSecs, value: data.progress || 0, class: 'flx-premium-slider',
          eventListener: {
            input: () => { this.isDraggingSeekbar = true; currTimeEl.textContent = formatTime(slider.value); this._styleSlider(slider); },
            change: () => { this.isDraggingSeekbar = false; sendCommand('seek', { position: parseFloat(slider.value) }); }
          }
        });

        setTimeout(() => this._styleSlider(slider), 10);
        const totalTimeEl = createHTMLElement('span', { textContent: formatTime(maxDurationSecs), style: { minWidth: '35px' } });
        seekContainer.appendChild(currTimeEl); seekContainer.appendChild(slider); seekContainer.appendChild(totalTimeEl);
        panelRight.appendChild(seekContainer);

        const controlsRow = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' } });

        const btnStyle = { background: 'transparent', border: 'none', color: 'var(--omni-accent-text)', cursor: 'pointer', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' };
        const hoverEffect = (e) => { e.target.style.background = 'var(--omni-input-bg)' };
        const leaveEffect = (e) => { e.target.style.background = 'transparent' };

        // ==========================================
        // LEFT COLUMN (Lyrics & Reroll)
        // ==========================================
        const leftGroup = createHTMLElement('div', { style: { flex: '1', display: 'flex', justifyContent: 'flex-start', gap: '4px', alignItems: 'center' } });

        const isLyricsMode = FluxHubState.get(STATE_KEYS.LYRICS_MODE, false);

        const lyricsBtn = createHTMLElement('button', {
          class: 'flx-ctrl-btn', icon: 'lyrics', fluxHubTooltip: 'Toggle Lyrics Mode',
          style: { ...btnStyle, color: isLyricsMode ? 'var(--omni-accent-text)' : 'var(--omni-muted)' },
          eventListener: { mouseenter: hoverEffect, mouseleave: leaveEffect } // Lyrics click logic is attached further down
        });
        leftGroup.appendChild(lyricsBtn);

        if (track.resolution && track.resolution.ambiguous !== false) {
          const rerollBtn = createHTMLElement('button', { icon: 'refresh', style: btnStyle, fluxHubTooltip: 'Reroll Match',
            eventListener: {
              click: async () => {
                const msg = `You are rerolling the track, this will blacklist current instance and find a new match from available providers!<br /><br /><b>Note:</b> To get the current match back you'll have to reroll all other matches or remove and add the track again!`;
                if (await FluxKit.ui.confirm(msg, { confirmText: 'Yes, find a new match', cancelText: 'No, keep current match', title: 'Reroll Track' }))
                  this._sendCommand('reroll');
              },
              mouseenter: hoverEffect,
              mouseleave: leaveEffect
            }
          });
          leftGroup.appendChild(rerollBtn);
        }

        // ==========================================
        // CENTER COLUMN (Playback)
        // ==========================================
        const centerGroup = createHTMLElement('div', { style: { flex: '1', display: 'flex', justifyContent: 'center', gap: '8px', alignItems: 'center' } });

        const prevBtn = createHTMLElement('button', { icon: 'prev', style: btnStyle, eventListener: { click: () => sendCommand('previous'), mouseenter: hoverEffect, mouseleave: leaveEffect } });

        this.uiNodes.playBtn = createHTMLElement('button', { icon: data.isLoading ? 'loader' : data.isPlaying ? 'pause' : 'play',
          style: { ...btnStyle, background: 'var(--omni-text)', color: 'var(--omni-bg-light)', borderRadius: '50%', padding: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' },
          eventListener: {
            click: () => { if (!this._isMediaLoading) sendCommand('toggle'); },
            mouseenter: (e) => { e.target.style.transform = 'scale(1.05)' },
            mouseleave: (e) => { e.target.style.transform = 'scale(1)' }
          }
        });

        const nextBtn = createHTMLElement('button', { icon: 'next', style: btnStyle, eventListener: { click: () => sendCommand('next'), mouseenter: hoverEffect, mouseleave: leaveEffect } });

        centerGroup.appendChild(prevBtn);
        centerGroup.appendChild(this.uiNodes.playBtn);
        centerGroup.appendChild(nextBtn);

        // ==========================================
        // RIGHT COLUMN (Shuffle, Loop, & Volume)
        // ==========================================
        const rightGroup = createHTMLElement('div', { style: { flex: '1', display: 'flex', justifyContent: 'flex-end', gap: '4px', alignItems: 'center' } });

        this.uiNodes.shuffleBtn = createHTMLElement('button', {
          icon: 'shuffle', fluxHubTooltip: 'Toggle Shuffle',
          style: { ...btnStyle, color: 'var(--omni-accent-text)' },
          eventListener: { click: () => sendCommand('toggle-shuffle'), mouseenter: hoverEffect, mouseleave: leaveEffect }
        });

        const currentLoopMode = FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off');
        const getLoopIconHtml = (mode) => {
          const baseSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`;
          return mode === 'one' ? `${baseSvg}<span style="font-size:9px; position:absolute; bottom:2px; right:4px; font-weight:900;">1</span>` : baseSvg;
        };

        this.uiNodes.loopBtn = createHTMLElement('button', {
          class: 'flx-ctrl-btn', fluxHubTooltip: `Loop: ${currentLoopMode.toUpperCase()}`,
          style: { ...btnStyle, color: currentLoopMode === 'off' ? 'var(--omni-muted)' : 'var(--omni-accent-text)', position: 'relative' },
          innerHTML: getLoopIconHtml(currentLoopMode),
          eventListener: { click: () => sendCommand('toggle-loop'), mouseenter: hoverEffect, mouseleave: leaveEffect }
        });

        const initVol = data.volume !== undefined ? data.volume : FluxHubState.get(STATE_KEYS.MEDIA_VOLUME, 0.5);
        const volWrap = createHTMLElement('div', { class: 'flx-vol-wrap' });

        const volIcon = createHTMLElement('button', {
          icon: initVol === 0 ? 'speakerMute' : initVol > 0.5 ? 'speaker' : 'speakerLow',
          style: { ...btnStyle, fontSize: '14px' },
          eventListener: {
            click: (e) => { e.stopPropagation(); volWrap.classList.toggle('flx-vol-active'); },
            mouseenter: (e) => { hoverEffect(e); clearTimeout(this._volHideTimer); volWrap.classList.add('flx-vol-active'); },
            mouseleave: leaveEffect
          }
        });

        const volPopover = createHTMLElement('div', { class: 'flx-vol-popover',
          eventListener: {
            mouseenter: () => clearTimeout(this._volHideTimer),
            mouseleave: () => { this._volHideTimer = setTimeout(() => volWrap.classList.remove('flx-vol-active'), 400); }
          }
        });

        this.uiNodes.volSlider = createHTMLElement('input', {
          type: 'range', min: 0, max: 1, step: 0.01, value: initVol, class: 'flx-premium-slider', style: { width: '100%' },
          eventListener: {
            input: (e) => {
              this.isDraggingVol = true;
              volIcon.innerHTML = safeHTML(e.target.value === '0' ? `${FluxKit.ui.getIcon('speakerMute')}` : e.target.value > 0.5 ? `${FluxKit.ui.getIcon('speaker')}` : `${FluxKit.ui.getIcon('speakerLow')}`);
              this._styleSlider(e.target);
            },
            change: (e) => { this.isDraggingVol = false; sendCommand('volume', { level: parseFloat(e.target.value) }); }
          }
        });
        setTimeout(() => this._styleSlider(this.uiNodes.volSlider), 10);

        volPopover.appendChild(this.uiNodes.volSlider);
        volWrap.appendChild(volIcon);
        volWrap.appendChild(volPopover);

        rightGroup.appendChild(this.uiNodes.shuffleBtn);
        rightGroup.appendChild(this.uiNodes.loopBtn);
        rightGroup.appendChild(volWrap);

        controlsRow.appendChild(leftGroup);
        controlsRow.appendChild(centerGroup);
        controlsRow.appendChild(rightGroup);
        panelRight.appendChild(controlsRow);

        playerPanel.appendChild(panelRight);
        container.appendChild(playerPanel);

        const lyricsContainer = createHTMLElement('div', {
          style: {
            display: isLyricsMode ? 'block' : 'none',
            background: 'var(--omni-input-bg)', borderRadius: '12px',
            padding: '12px', margin: '4px 0', border: '1px solid var(--omni-border)'
          }
        });

        const lyricsHeader = createHTMLElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } });
        const artistInput = createHTMLElement('input', { value: track.artist, style: { flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--omni-border)', background: 'var(--omni-bg-light)', color: 'var(--omni-text)', fontSize: '12px' } });
        const titleInput = createHTMLElement('input', { value: track.title, style: { flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--omni-border)', background: 'var(--omni-bg-light)', color: 'var(--omni-text)', fontSize: '12px' } });
        const searchBtn = createHTMLElement('button', { icon: 'search', style: btnStyle });
        const toggleSyncBtn = createHTMLElement('button', { icon: 'swap', style: btnStyle });

        lyricsHeader.appendChild(artistInput); lyricsHeader.appendChild(titleInput); lyricsHeader.appendChild(searchBtn); lyricsHeader.appendChild(toggleSyncBtn);
        const lyricsText = createHTMLElement('div', {
          style: { maxHeight: '124px', overflowY: 'auto', lineHeight: '1.6', color: 'var(--omni-text)', position: 'relative', padding: '10px 0', overflowY: 'auto', overflowX: 'hidden', paddingRight: '16px' }
        });

        lyricsContainer.appendChild(lyricsHeader);
        lyricsContainer.appendChild(lyricsText);
        container.appendChild(lyricsContainer);

        // State variables for the Sync Engine
        let hasFetchedLyrics = false;
        let activeLyrics = null;
        let currentLyricIndex = -1;
        let fetchedSynced = null;
        let fetchedPlain = null;
        let isSyncMode = true;

        const parseLRC = (lrcStr) => {
          const lines = lrcStr.split('\n');
          const parsed = [];
          const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

          lines.forEach(line => {
            const match = line.match(timeRegex);
            if (match) {
              const min = parseInt(match[1], 10);
              const sec = parseInt(match[2], 10);
              const msStr = match[3].length === 2 ? match[3] + '0' : match[3];
              const time = (min * 60) + sec + (parseInt(msStr, 10) / 1000);
              const text = line.replace(timeRegex, '').trim();
              if (text) parsed.push({ time, text, node: null });
            }
          });
          return parsed.sort((a, b) => a.time - b.time);
        };

        const renderLyrics = () => {
          lyricsText.innerHTML = safeHTML('');
          activeLyrics = null;
          currentLyricIndex = -1;

          if (fetchedSynced && isSyncMode) {
             activeLyrics = parseLRC(fetchedSynced);
             activeLyrics.forEach((lyric) => {
                const lineEl = createHTMLElement('div', {
                  class: 'flx-lyric-line', textContent: lyric.text,
                  eventListener: { click: (e) => { e.stopPropagation(); sendCommand('seek', { position: lyric.time }); } }
                });
                lyric.node = lineEl;
                lyricsText.appendChild(lineEl);
             });
             toggleSyncBtn.style.display = fetchedPlain ? 'flex' : 'none';
             toggleSyncBtn.style.color = 'var(--omni-accent-text)';
          } else if (fetchedPlain) {
             lyricsText.innerHTML = safeHTML(`<div style="white-space: pre-wrap; padding: 0 8px; font-size: 13px;">${fetchedPlain}</div>`);
             toggleSyncBtn.style.display = fetchedSynced ? 'flex' : 'none';
             toggleSyncBtn.style.color = 'var(--omni-muted)';
          } else {
             lyricsText.innerHTML = safeHTML('<div style="color: var(--omni-muted); text-align: center; padding: 20px;">No lyrics found for this track.</div>');
             toggleSyncBtn.style.display = 'none';
          }
        };

        toggleSyncBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          isSyncMode = !isSyncMode;
          renderLyrics();
        });

        const fetchLyrics = async () => {
          const rawQuery = `${artistInput.value.trim()} ${titleInput.value.trim()}`;
          if (!rawQuery.trim()) return;

          const cacheKey = `lrc_${rawQuery.toLowerCase().replace(/\s+/g, '_')}`;

          lyricsText.innerHTML = safeHTML('<div style="color: var(--omni-muted); text-align: center; padding: 20px;">Searching for lyrics...</div>');
          fetchedSynced = null;
          fetchedPlain = null;
          isSyncMode = true;
          toggleSyncBtn.style.display = 'none';

          try {
            const cached = await FluxHub.lyricsCache.get(cacheKey);
            if (cached) {
              fetchedSynced = cached.syncedLyrics;
              fetchedPlain = cached.plainLyrics;
              renderLyrics();
              return;
            }

            const query = encodeURIComponent(rawQuery);
            const res = await FluxKit.api.gmFetch(`https://lrclib.net/api/search?q=${query}`);
            const json = await res.json();

            if (json && json.length > 0) {
              fetchedSynced = json[0].syncedLyrics;
              fetchedPlain = json[0].plainLyrics;

              FluxHub.lyricsCache.set(cacheKey, {
                syncedLyrics: fetchedSynced,
                plainLyrics: fetchedPlain
              }, 86400000 * 7);

              renderLyrics();
            } else {
              lyricsText.innerHTML = safeHTML('<div style="color: var(--omni-muted); text-align: center; padding: 20px;">No lyrics found in LRCLIB. Try simplifying the title.</div>');
            }
          } catch(err) {
            lyricsText.innerHTML = safeHTML('<div style="color: var(--omni-danger); text-align: center; padding: 20px;">Failed to connect to lyrics server.</div>');
          }
        };

        searchBtn.addEventListener('click', (e) => { e.stopPropagation(); fetchLyrics(); });

        lyricsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const willBeOn = lyricsContainer.style.display !== 'block';
          FluxHubState.set(STATE_KEYS.LYRICS_MODE, willBeOn);

          lyricsContainer.style.display = willBeOn ? 'block' : 'none';
          lyricsBtn.style.color = willBeOn ? 'var(--omni-accent-text)' : 'var(--omni-muted)';

          if (willBeOn && !hasFetchedLyrics) {
            hasFetchedLyrics = true;
            fetchLyrics();
          }
        });

        if (isLyricsMode) {
          hasFetchedLyrics = true;
          setTimeout(() => fetchLyrics(), 50);
        }

        if (data.queue && data.queue.length > 0) {
          const queueContainer = createHTMLElement('div', { style: { marginTop: '4px', borderTop: '1px solid var(--omni-separator)', paddingTop: '12px' } });
          const queueHeader = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } });

          const queueTitle = data.loadedPlaylistName
            ? `Queue [Playlist: ${data.loadedPlaylistName}] (${data.queueIndex + 1}/${data.queue.length})`
            : `Queue (${data.queueIndex + 1}/${data.queue.length})`;

          queueHeader.appendChild(createHTMLElement('div', { textContent: queueTitle, style: { fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--omni-muted)', letterSpacing: '0.5px' } }));

          const headerActions = createHTMLElement('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } });
          let activeQueueRow = null;

          headerActions.appendChild(createHTMLElement('div', {
            textContent: 'Locate', fluxHubTooltip: 'Find current track', style: { fontSize: '11px', color: 'var(--omni-accent)', cursor: 'pointer', fontWeight: '600' },
            eventListener: (e) => {
              e.stopPropagation();
              if (activeQueueRow && activeQueueRow.isConnected) {
                activeQueueRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }
          }));

          headerActions.appendChild(createHTMLElement('div', {
            textContent: 'Clear', fluxHubTooltip: 'Clear Queue', style: { fontSize: '11px', color: 'var(--omni-danger)', cursor: 'pointer', fontWeight: '600' },
            eventListener: (e) => {
              e.stopPropagation();
              FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, []);
              FluxHubState.delete(STATE_KEYS.ACTIVE_PLAYLIST_NAME);
              FluxHubState.delete(STATE_KEYS.ACTIVE_MEDIA);
              if (FluxKit.media) FluxKit.media.surrender();
              FluxKit.ipc.broadcast('media-control', { action: 'stop-all' }, true);
              FluxHub.ui.input.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }));

          queueHeader.appendChild(headerActions);
          queueContainer.appendChild(queueHeader);

          data.queue.forEach((qTrack, i) => {
            const isCurrent = i === data.queueIndex;
            const qRow = createHTMLElement('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px', borderRadius: '8px',
                background: isCurrent ? 'var(--omni-hover)' : 'transparent', cursor: 'pointer',
                border: isCurrent ? '1px solid var(--omni-border)' : '1px solid transparent',
                opacity: isCurrent ? '1' : '0.75'
              },
              eventListener: (e) => { e.stopPropagation(); sendCommand('jump', { index: i }); }
            });

            if (isCurrent) activeQueueRow = qRow;

            qRow.appendChild(createHTMLElement('div', { icon: isCurrent ? 'play' : `${i + 1}.`, style: { fontSize: '12px', color: isCurrent ? 'var(--omni-accent)' : 'var(--omni-muted)', width: '18px', fontWeight: 'bold' } }));

            qRow.appendChild(createHTMLElement('img', {
              src: qTrack.cover || this._fallbackCover(qTrack), style: { width: '28px', height: '28px', borderRadius: '4px', objectFit: 'cover', border: '1px solid var(--omni-border)' },
              eventListener: { error: (e) => { e.target.src = this._fallbackCover(qTrack); } }
            }));

            const textWrapQ = createHTMLElement('div', { style: { flexGrow: '1', overflow: 'hidden' } });
            textWrapQ.appendChild(createHTMLElement('div', { textContent: qTrack.title, style: { fontSize: '13px', fontWeight: isCurrent ? 'bold' : 'normal', color: 'var(--omni-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }));
            qRow.appendChild(textWrapQ);

            const rowActions = createHTMLElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: '0' }
            });

            const addBtn = createHTMLElement('div', {
              icon: 'playlistAdd', fluxHubTooltip: 'Add to Playlist',
              style: {
                fontSize: '12px', color: 'var(--omni-muted)', padding: '4px 6px',
                borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center'
              },
              eventListener: {
                mouseenter: (e) => { e.target.style.background = 'var(--omni-hover)'; e.target.style.color = 'var(--omni-text)'; },
                mouseleave: (e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--omni-muted)'; },
                click: (e) => {
                  e.stopPropagation();
                  FluxHubState.set(STATE_KEYS.PENDING_ADD_TRACK, qTrack);
                  FluxHub.ui.setInputVal(`> pl addtrack `);
                  setTimeout(() => FluxHub.ui.input.focus(), 10);
                }
              }
            });

            const delBtn = createHTMLElement('div', {
              icon: 'close', fluxHubTooltip: 'Remove from Queue',
              style: {
                fontSize: '12px', color: 'var(--omni-muted)', padding: '4px 6px',
                borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center'
              },
              eventListener: {
                mouseenter: (e) => { e.target.style.background = 'var(--omni-hover)'; e.target.style.color = 'var(--omni-danger)'; },
                mouseleave: (e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--omni-muted)'; },
                click: async (e) => {
                  e.stopPropagation();
                  const plName = FluxHubState.get(STATE_KEYS.ACTIVE_PLAYLIST_NAME, null);
                  let syncToPlaylist = false;

                  if (plName) {
                    syncToPlaylist = await FluxKit.ui.confirm(`You are removing <b>${qTrack.title}</b> from the queue.<br><br>Do you also want to permanently delete it from the saved playlist "<b>${plName}</b>"?`, { confirmText: 'Yes, update playlist', cancelText: 'No, queue only', title: 'Remove Track' });
                  }

                  const newQueue = data.queue.filter((_, idx) => idx !== i);

                  if (plName && syncToPlaylist) {
                    const tracks = PlaylistsState.getTracks(plName);
                    if (tracks) {
                      const targetIdx = tracks.findIndex(t => t.id === qTrack.id);
                      if (targetIdx !== -1) {
                        tracks.splice(targetIdx, 1);
                        PlaylistsState.save(plName, tracks);
                      }
                    }
                  }

                  const wasPlayingDeleted = i === data.queueIndex;

                  if (newQueue.length === 0) {
                    FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, []);
                    FluxHubState.delete(STATE_KEYS.ACTIVE_PLAYLIST_NAME);
                    FluxHubState.delete(STATE_KEYS.ACTIVE_MEDIA);
                    if (FluxKit.media) FluxKit.media.surrender();
                    FluxKit.ipc.broadcast('media-control', { action: 'stop-all' }, true);
                  } else if (wasPlayingDeleted) {
                    FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, newQueue);
                    let targetIndex = i;
                    if (targetIndex >= newQueue.length) {
                      if (FluxHubState.get(STATE_KEYS.QUEUE_LOOP, 'off') === 'all') targetIndex = 0;
                      else {
                        FluxHubState.set(STATE_KEYS.QUEUE_INDEX, Math.max(0, newQueue.length - 1));
                        if (FluxKit.media) FluxKit.media.stop();
                        this.execute();
                        return;
                      }
                    }
                    FluxHubState.set(STATE_KEYS.QUEUE_INDEX, targetIndex);
                    FluxKit.media.loadTrack(newQueue[targetIndex], newQueue[targetIndex].streamUrl);
                  } else {
                    FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, newQueue);
                    if (i < data.queueIndex) FluxHubState.set(STATE_KEYS.QUEUE_INDEX, data.queueIndex - 1);
                  }
                  this.execute();
                }
              }
            });

            rowActions.appendChild(addBtn);
            rowActions.appendChild(delBtn);
            qRow.appendChild(rowActions);
            queueContainer.appendChild(qRow);
          });
          
          container.appendChild(queueContainer);
        }

        let lastSyncState = data;
        let lastKnownShuffle = !!data.shuffle;
        this.progressInterval = setInterval(() => {
          if (!lastSyncState || !lastSyncState.isPlaying || this.isDraggingSeekbar) return;
          let estProgress = lastSyncState.progress + ((Date.now() - lastSyncState.timestamp) / 1000);
          if (estProgress > maxDurationSecs) estProgress = maxDurationSecs;

          slider.value = estProgress;
          currTimeEl.textContent = formatTime(estProgress);
          ambientProgress.style.width = `${(estProgress / maxDurationSecs) * 100}%`;
          cAmbientProgress.style.width = `${(estProgress / maxDurationSecs) * 100}%`;
          this._styleSlider(slider);

          if (activeLyrics && activeLyrics.length > 0 && lyricsContainer.style.display === 'block') {
            let newIdx = -1;
            for (let i = activeLyrics.length - 1; i >= 0; i--) {
              if (estProgress + 0.2 >= activeLyrics[i].time) {
                newIdx = i;
                break;
              }
            }

            if (newIdx !== currentLyricIndex) {
              if (currentLyricIndex !== -1 && activeLyrics[currentLyricIndex]) {
                 activeLyrics[currentLyricIndex].node.classList.remove('flx-lyric-active');
              }

              currentLyricIndex = newIdx;

              if (currentLyricIndex !== -1) {
                 const activeNode = activeLyrics[currentLyricIndex].node;
                 activeNode.classList.add('flx-lyric-active');

                 const containerHalfHeight = lyricsText.clientHeight / 2;
                 const nodeOffset = activeNode.offsetTop;
                 const nodeHalfHeight = activeNode.clientHeight / 2;

                 lyricsText.scrollTo({
                   top: nodeOffset - containerHalfHeight + nodeHalfHeight,
                   behavior: 'smooth'
                 });
              }
            }
          }
        }, 500);

        this.ipcUnsubscribe = FluxKit.ipc.listen('media-state', (payload) => {
          if (!this.uiNodes.status) return;
          if (payload.track && track && payload.track.id !== track.id) { this.execute(); return; }
          if (payload.track && track && payload.track.id === track.id &&
              (payload.track.title !== track.title ||
                payload.track.artist !== track.artist ||
                payload.track.resolution?.whitelistSource !== track.resolution?.whitelistSource)) {
            this.execute();
            return;
          }
          if (payload.shuffle !== undefined && payload.shuffle !== lastKnownShuffle) {
            lastKnownShuffle = payload.shuffle;
            this.execute();
            return;
          }
          lastSyncState = payload;

          if (!this.isDraggingSeekbar) {
             slider.value = payload.progress;
             currTimeEl.textContent = formatTime(payload.progress);
             slider.max = (payload.track?.durationMs || 1000) / 1000;
             totalTimeEl.textContent = formatTime(slider.max);
             ambientProgress.style.width = `${(payload.progress / slider.max) * 100}%`;
             cAmbientProgress.style.width = `${(payload.progress / slider.max) * 100}%`;
             this._styleSlider(slider);
          }

          if (payload.volume !== undefined && !this.isDraggingVol && this.uiNodes.volSlider) {
             this.uiNodes.volSlider.value = payload.volume;
             volIcon.innerHTML = safeHTML(payload.volume === 0 ? `${FluxKit.ui.getIcon('speakerMute')}` : payload.volume > 0.5 ? `${FluxKit.ui.getIcon('speaker')}` : `${FluxKit.ui.getIcon('speakerLow')}`);
             this._styleSlider(this.uiNodes.volSlider);
          }

          this.uiNodes.status.innerHTML = safeHTML(payload.isPlaying ? `${FluxKit.ui.getIcon('play')} PLAYING` : `${FluxKit.ui.getIcon('pause')} PAUSED`);
          this.uiNodes.status.style.color = payload.isPlaying ? 'var(--omni-success)' : 'var(--omni-warning)';

          this._isMediaLoading = !!payload.isLoading;
          const playIconState = payload.isLoading ? FluxKit.ui.getIcon('loader') : (payload.isPlaying ? FluxKit.ui.getIcon('pause') : FluxKit.ui.getIcon('play'));
          if (this.uiNodes.playBtn) {
            this.uiNodes.playBtn.innerHTML = safeHTML(payload.isLoading ? FluxKit.ui.getIcon('loader') : (payload.isPlaying ? FluxKit.ui.getIcon('pause') : FluxKit.ui.getIcon('play')));
            this.uiNodes.playBtn.style.opacity = payload.isLoading ? '0.6' : '1';
            this.uiNodes.playBtn.style.cursor = payload.isLoading ? 'default' : 'pointer';
          }
          if (this.uiNodes.cPlayBtn) {
            this.uiNodes.cPlayBtn.innerHTML = safeHTML(playIconState);
            this.uiNodes.cPlayBtn.style.opacity = payload.isLoading ? '0.6' : '1';
            this.uiNodes.cPlayBtn.style.cursor = payload.isLoading ? 'default' : 'pointer';
          }
          this._scheduleLoaderVisibility(this.uiNodes.coverLoader, payload.isLoading, 'card');

          if (payload.loop !== undefined && this.uiNodes.loopBtn) {
             this.uiNodes.loopBtn.style.color = payload.loop === 'off' ? 'var(--omni-muted)' : 'var(--omni-accent-text)';
             this.uiNodes.loopBtn.dataset.fluxHubTooltip = `Loop: ${payload.loop.toUpperCase()}`;
             this.uiNodes.loopBtn.innerHTML = safeHTML(getLoopIconHtml(payload.loop));
          }
        }, true);

        return FluxKit.ui.omni.DetailCard(container, []);
      }

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    async executeLoadRemotePlaylist(playlist, isQueueIntent = false, nodeElement = null) {
      const index = FluxHub.ui.currentViews.indexOf(this);
      const row = nodeElement || FluxHub.ui.resultsList.children[index];
      if (row) {
        const subtitle = row.querySelector('.flx-omni-subtitle');
        if (subtitle) {
          if (playlist.collectionType === 'album') subtitle.textContent = isQueueIntent ? 'Queueing Album Tracks...' : 'Loading Album Tracks...';
          else if (playlist.collectionType === 'artist_singles') subtitle.textContent = isQueueIntent ? 'Queueing Singles...' : 'Loading Singles...';
          else if (playlist.collectionType && playlist.collectionType.startsWith('artist')) subtitle.textContent = isQueueIntent ? 'Queueing Top Tracks...' : 'Loading Top Tracks...';
          else subtitle.textContent = isQueueIntent ? 'Queueing Playlist Tracks...' : 'Loading Playlist Tracks...';
        }
        const icon = row.querySelector('.flx-omni-icon');
        if (icon) icon.innerHTML = safeHTML(FluxKit.ui.icons.loader);
      }

      try {
        const tracks = await FluxKit.api.music.getPlaylistTracks(playlist.id, playlist.provider, playlist.collectionType);
        if (tracks && tracks.length > 0) {
          const currentQueue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
          const activeMedia = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);

          if (isQueueIntent && currentQueue.length > 0 && activeMedia && activeMedia.track) {
            // Append mode: Merge and deduplicate
            const existingIds = new Set(currentQueue.map(t => t.id));
            const newTracks = tracks.filter(t => !existingIds.has(t.id));
            const updatedQueue = [...currentQueue, ...newTracks];

            FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, updatedQueue);

            if (FluxKit.ui.showNotification) {
              FluxKit.ui.showNotification(`▶ Added ${newTracks.length} tracks from "${playlist.title || playlist.name}" to Queue`);
            }
            if (nodeElement) {
              const hint = nodeElement.querySelector('.flx-omni-action-hint');
              if (hint) {
                hint.textContent = `✓ Added ${newTracks.length} tracks`;
                hint.style.color = 'var(--omni-success)';
                setTimeout(() => {
                  if (hint.isConnected) {
                    hint.textContent = '↵ Add to Queue';
                    hint.style.color = 'var(--omni-accent)';
                  }
                }, 1500);
              }
            }
            FluxHub.ui.input.value = '> queue ';
          } else {
            // Overwrite mode: Reset queue and play immediately
            FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, tracks);
            FluxHubState.set(STATE_KEYS.QUEUE_INDEX, 0);
            FluxHubState.delete(STATE_KEYS.ACTIVE_PLAYLIST_NAME);
            FluxKit.media.loadTrack(tracks[0], tracks[0].streamUrl);
            FluxHub.ui.input.value = '> play ';
          }
        } else {
          if (FluxKit.ui.showNotification) FluxKit.ui.showNotification('Playlist is empty or blocked by provider.');
        }
      } catch(e) {
        if (FluxKit.ui.showNotification) FluxKit.ui.showNotification('Failed to fetch playlist tracks.');
      }
      FluxHub.ui.input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    addToPlaylist(name, trackOnly = true) {
      if (!trackOnly) {
        const currentQueue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
        if (currentQueue.length > 0) {
          const existingTracks = PlaylistsState.getTracks(name) || [];
          const existingIds = new Set(existingTracks.map(t => t.id));
          const newTracks = currentQueue.filter(t => !existingIds.has(t.id));
          PlaylistsState.save(name, [...existingTracks, ...newTracks]);
          FluxHubState.set(STATE_KEYS.ACTIVE_PLAYLIST_NAME, name);
          FluxKit.ui.showNotification(`Saved queue to "${name}"`);
          FluxHub.ui.setInputVal('> pl');
          return;
        }
      } else {
        let trackToAdd = FluxHubState.get(STATE_KEYS.PENDING_ADD_TRACK, null);
        if (!trackToAdd) {
          const activeMedia = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);
          if (activeMedia && activeMedia.track) trackToAdd = activeMedia.track;
        }

        if (trackToAdd) {
          const existingTracks = PlaylistsState.getTracks(name) || [];
          const existingIds = new Set(existingTracks.map(t => t.id));
          if (!existingIds.has(trackToAdd.id)) {
            PlaylistsState.save(name, [...existingTracks, trackToAdd]);
          }
          FluxHubState.delete(STATE_KEYS.PENDING_ADD_TRACK);
          FluxKit.ui.showNotification(`Added "${trackToAdd.title}" to "${name}"`);
          FluxHub.ui.setInputVal('> pl');
          return;
        }
      }
    }

    executePlaylistAction(pName, forceQueueIntent = false) {
      const rawQ = this.query.trim();
      let action = 'load';

      if (/^>\s*(playlist|pl)(\s+|$)/i.test(rawQ)) {
        const parts = rawQ.replace(/^>\s*(playlist|pl)\s*/i, '').trim().split(/\s+/);
        const parsedAction = parts[0] ? parts[0].toLowerCase() : '';
        if (['add', 'append', 'addtrack', 'delete', 'del', 'rm', 'edit', 'rename', 'queue'].includes(parsedAction)) {
          action = parsedAction;
        }
      }

      if (action === 'load') {
        this.executePlaylistLoad(pName, forceQueueIntent);
      } else if (action === 'queue') {
        this.executePlaylistLoad(pName, true);
      } else if (action === 'add' || action === 'append') {
        this.addToPlaylist(pName, false);
      } else if (action === 'addtrack') {
        this.addToPlaylist(pName, true);
      } else if (action === 'delete' || action === 'del' || action === 'rm') {
        if (PlaylistsState.remove(pName)) {
          if (FluxHubState.get(STATE_KEYS.ACTIVE_PLAYLIST_NAME) === pName) {
            FluxHubState.delete(STATE_KEYS.ACTIVE_PLAYLIST_NAME);
          }
          if (FluxKit.ui.showNotification) FluxKit.ui.showNotification(`Deleted playlist "${pName}"`);
          FluxHub.ui.setInputVal('> pl ');
        }
      } else if (action === 'rename' || action === 'edit') {
        FluxHub.ui.setInputVal(`> pl rename ${pName} to `);
        setTimeout(() => FluxHub.ui.input.focus(), 10);
      } else {
        FluxHub.ui.setInputVal(`> pl ${action} ${pName}`);
      }
    }

    executePlaylistLoad(name, isQueueIntent = false) {
      const tracks = PlaylistsState.getTracks(name);
      if (tracks && tracks.length > 0) {
        const currentQueue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
        const activeMedia = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);

        if (isQueueIntent && currentQueue.length > 0 && activeMedia && activeMedia.track) {
          const existingIds = new Set(currentQueue.map(t => t.id));
          const newTracks = tracks.filter(t => !existingIds.has(t.id));
          FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, [...currentQueue, ...newTracks]);
          if (FluxKit.ui.showNotification) {
            FluxKit.ui.showNotification(`▶ Added ${newTracks.length} tracks from playlist "${name}" to Queue`);
          }
          FluxHub.ui.input.value = '> queue ';
        } else {
          const loadedQueue = [...tracks];
          FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, loadedQueue);
          FluxHubState.set(STATE_KEYS.QUEUE_INDEX, 0);
          FluxHubState.set(STATE_KEYS.ACTIVE_PLAYLIST_NAME, name);
          FluxKit.media.loadTrack(loadedQueue[0], loadedQueue[0].streamUrl);
          FluxHub.ui.input.value = '> play ';
        }
        FluxHub.ui.input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    executeTrackAction(track, isQueueIntent, nodeElement) {
      const activeMedia = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);
      let queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);

      FluxHubState.delete(STATE_KEYS.ACTIVE_PLAYLIST_NAME);

      const existingIdx = queue.findIndex(t => t.id === track.id);

      if (isQueueIntent && activeMedia && activeMedia.track) {
        if (existingIdx === -1) {
          queue.push(track);
          FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, queue);
        }

        const queueChip = FluxHub.ui.resultsList.querySelector('.flx-queue-chip');
        if (queueChip) {
          const textNode = Array.from(queueChip.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
          if (textNode) textNode.textContent = `Queue (${queue.length})`;
          else queueChip.appendChild(document.createTextNode(`Queue (${queue.length})`));
        } else if (queue.length === 1 && FluxHub.ui.resultsList.querySelector('.flx-omni-card')) {
          this.execute();
          return;
        }

        if (nodeElement) {
          const hint = nodeElement.querySelector('.flx-omni-action-hint');
          if (hint) {
            hint.textContent = existingIdx === -1 ? '✓ Added' : '✓ In Queue';
            hint.style.color = 'var(--omni-success)';
            setTimeout(() => {
              if (hint.isConnected) {
                hint.textContent = '↵ Add to Queue';
                hint.style.color = 'var(--omni-accent)';
              }
            }, 1500);
          }
        }
      } else {
        if (existingIdx === -1) {
          queue.push(track);
          FluxHubState.set(STATE_KEYS.MEDIA_QUEUE, queue);
          FluxHubState.set(STATE_KEYS.QUEUE_INDEX, queue.length - 1);
        } else FluxHubState.set(STATE_KEYS.QUEUE_INDEX, existingIdx);
        FluxKit.media.loadTrack(track, track.streamUrl);
        FluxHub.ui.setInputVal('> queue ');
      }
    }

    handleKeydown(e) {
      if (this.currentMode === 'playing') {
        const { stored: key } = FluxKit.utils.getShortcutFromEvent(e, { includeModifiers: ['ctrl', 'meta', 'shift'] });
        const PLAYER_HOTKEYS = { space: 'toggle', s: 'toggle-shuffle', l: 'toggle-loop', n: 'next', p: 'prev' };
        const allowedKeys = ['up', 'down'];
        if (!allowedKeys.includes(key) && (FluxHub.ui.isTypingTarget())) return false;
        if (PLAYER_HOTKEYS[key]) {
          e.preventDefault(); e.stopPropagation();
          this._sendCommand(PLAYER_HOTKEYS[key]);
          return true;
        }

        const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);
        if (!am || !am.track) return false;

        const currentVol = am.volume !== undefined ? am.volume : FluxHubState.get(STATE_KEYS.MEDIA_VOLUME, 0.5);
        const durationSecs = (am.track.durationMs || 0) / 1000;

        let currentProgress = am.progress || 0;
        if (am.isPlaying && am.timestamp) currentProgress += (Date.now() - am.timestamp) / 1000;

        switch (key) {
          case 'right':
            e.preventDefault(); e.stopPropagation();
            if (e.shiftKey) { this._sendCommand('next'); return true; }
            this._sendCommand('seek', { position: Math.min(currentProgress + 5, durationSecs || currentProgress + 5) });
            return true;

          case 'left':
            e.preventDefault(); e.stopPropagation();
            if (e.shiftKey) { this._sendCommand('previous'); return true; }
            this._sendCommand('seek', { position: Math.max(currentProgress - 5, 0) });
            return true;

          case 'up':
            e.preventDefault(); e.stopPropagation();
            this._sendCommand('volume', { level: Math.min(1, +(currentVol + 0.05).toFixed(2)) });
            return true;

          case 'down':
            e.preventDefault(); e.stopPropagation();
            this._sendCommand('volume', { level: Math.max(0, +(currentVol - 0.05).toFixed(2)) });
            return true;

          case 'm':
            e.preventDefault(); e.stopPropagation();
            if (currentVol > 0) {
              this._preMuteVolume = currentVol;
              this._sendCommand('volume', { level: 0 });
            } else {
              this._sendCommand('volume', { level: this._preMuteVolume ?? 0.5 });
            }
            return true;

          case 'r':
            if (am.track.resolution && am.track.resolution.ambiguous !== false) {
              e.preventDefault(); e.stopPropagation();
              this._sendCommand('reroll');
              return true;
            }
            return false;

          default:
            return false;
        }
      }
      const isSearchMode = this.currentMode === 'search' && this.trackNodes.length > 0;
      const isPlaylistSearchMode = this.currentMode === 'search_playlists' && this.trackNodes.length > 0;
      const isPlaylistMode = this.currentMode === 'playlist_list' && this.playlistItems.length > 0;

      if (!isSearchMode && !isPlaylistSearchMode && !isPlaylistMode) return false;

      const itemsLength = (isSearchMode || isPlaylistSearchMode) ? this.trackNodes.length : this.playlistItems.length;

      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        this.subIndex = Math.min(this.subIndex + 1, itemsLength - 1);
        this.updateSubSelection();
        return true;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        this.subIndex = Math.max(this.subIndex - 1, 0);
        this.updateSubSelection();
        return true;
      }

      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (isSearchMode && this.searchResults[this.subIndex]) {
          const isQueueIntent = /^>\s*(queue|q)\b/i.test(this.query.trim());
          this.executeTrackAction(this.searchResults[this.subIndex], isQueueIntent, this.trackNodes[this.subIndex]);
        } else if (isPlaylistSearchMode && this.searchResults[this.subIndex]) {
          const isQueueIntent = /^>\s*(queue|q)(al|ar|pl)?\b/i.test(this.query.trim());
          this.executeLoadRemotePlaylist(this.searchResults[this.subIndex], isQueueIntent, this.trackNodes[this.subIndex]);
        } else if (isPlaylistMode && this.playlistItems[this.subIndex]) {
          this.executePlaylistAction(this.playlistItems[this.subIndex].name);
        }
        return true;
      }

      return false;
    }

    updateSubSelection() {
      const nodes = (this.currentMode === 'search' || this.currentMode === 'search_playlists') ? this.trackNodes : this.playlistItems.map(i => i.node);

      nodes.forEach((node, idx) => {
        if (idx === this.subIndex) {
          node.style.borderColor = 'var(--omni-border)';
          node.style.background = 'var(--omni-hover)';
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
          node.style.borderColor = 'transparent';
          node.style.background = 'transparent';
        }
      });
    }

    static async getWidgetState() {
      const activeMedia = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA, null);
      return activeMedia && activeMedia.track ? activeMedia : null;
    }

    async renderWidget(state) {
      this._purge();
      const track = state.track;

      const widget = createHTMLElement('div', { class: 'flx-omni-widget',
        style: { padding: '12px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px', minHeight: '80px', cursor: 'pointer', position: 'relative', overflow: 'hidden', gridColumn: 'span 2' },
        eventListener: () => {
          const queue = FluxHubState.get(STATE_KEYS.MEDIA_QUEUE, []);
          FluxHub.ui.setInputVal(queue.length > 0 ? '> queue ' : '> play ');
        }
      });

      const widgetCoverWrap = createHTMLElement('div', { style: { position: 'relative', width: '56px', height: '56px', flexShrink: '0' } });
      const widgetCoverImg = createHTMLElement('img', {
        src: track.cover || this._fallbackCover(track),
        style: { width: '56px', height: '56px', borderRadius: '6px', objectFit: 'cover', display: 'block' },
        eventListener: { error: (e) => { e.target.src = this._fallbackCover(track); } }
      });
      this.uiNodes.widgetCoverLoader = createHTMLElement('div', {
        icon: 'loader',
        style: {
          position: 'absolute', inset: '0', borderRadius: '6px', display: 'none',
          alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', color: 'var(--omni-accent-text)', fontSize: '16px'
        }
      });
      if (state.isLoading) this.uiNodes.widgetCoverLoader.style.display = 'flex';
      widgetCoverWrap.appendChild(widgetCoverImg);
      widgetCoverWrap.appendChild(this.uiNodes.widgetCoverLoader);
      widget.appendChild(widgetCoverWrap);

      const details = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', overflow: 'hidden' } });
      details.appendChild(createHTMLElement('div', { textContent: track.title, style: { fontSize: '14px', fontWeight: '600', color: 'var(--omni-text)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' } }));
      details.appendChild(createHTMLElement('div', { textContent: track.artist, style: { fontSize: '12px', color: 'var(--omni-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' } }));

      const statusIcon = createHTMLElement('div', { textContent: state.isPlaying ? '▶ PLAYING' : '⏸ PAUSED', style: { fontSize: '10px', marginTop: '4px', fontWeight: 'bold', color: state.isPlaying ? 'var(--omni-success)' : 'var(--omni-warning)' } });
      details.appendChild(statusIcon);
      widget.appendChild(details);

      const widgetControls = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', zIndex: '2' } });

      const btnStyle = { background: 'var(--omni-hover)', border: 'none', borderRadius: '50%', color: 'var(--omni-text)', fontSize: '12px', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' };

      const wPrevBtn = createHTMLElement('button', { icon: 'prev', style: btnStyle, eventListener: { click: (e) => { e.stopPropagation(); FluxKit.ipc.broadcast('media-control', { action: 'previous' }, true); } } });

      const wPlayBtn = createHTMLElement('button', {
        icon: state.isLoading ? 'loader' : (state.isPlaying ? 'pause' : 'play'),
        style: { ...btnStyle, width: '34px', height: '34px', fontSize: '14px', border: '1px solid var(--omni-border)', opacity: state.isLoading ? '0.6' : '1', cursor: state.isLoading ? 'default' : 'pointer' },
        eventListener: (e) => {
          e.stopPropagation();
          if (this._widgetIsLoading) return;
          const am = FluxHubState.get(STATE_KEYS.ACTIVE_MEDIA);
          if (!am || !am.hostTab || am.hostTab === FluxKit.ipc.getTabId()) { FluxKit.media.toggle(); }
          else { FluxKit.ipc.broadcast('media-control', { action: 'toggle' }, true); }
        }
      });
      this._widgetIsLoading = !!state.isLoading;

      const wNextBtn = createHTMLElement('button', { icon: 'next', style: btnStyle, eventListener: (e) => { e.stopPropagation(); FluxKit.ipc.broadcast('media-control', { action: 'next' }, true); } });

      widgetControls.appendChild(wPrevBtn);
      widgetControls.appendChild(wPlayBtn);
      widgetControls.appendChild(wNextBtn);
      widget.appendChild(widgetControls);

      const ambientProgress = createHTMLElement('div', {
        style: { position: 'absolute', bottom: '0', left: '0', height: '3px', background: 'var(--omni-accent)', width: '0%', transition: 'width 0.2s linear' }
      });
      widget.appendChild(ambientProgress);

      let lastSyncState = state;
      const maxDurationSecs = (track.durationMs || 1000) / 1000;

      this.progressInterval = setInterval(() => {
        if (!lastSyncState || !lastSyncState.isPlaying || !widget.isConnected) return;
        let estProgress = lastSyncState.progress + ((Date.now() - lastSyncState.timestamp) / 1000);
        if (estProgress > maxDurationSecs) estProgress = maxDurationSecs;
        ambientProgress.style.width = `${(estProgress / maxDurationSecs) * 100}%`;
      }, 500);

      this.ipcUnsubscribe = FluxKit.ipc.listen('media-state', (payload) => {
        if (!widget.isConnected) return;
        if (payload.track && payload.track.id !== track.id) {
          widget.querySelector('img').src = payload.track.cover || this._fallbackCover(payload.track);
          details.children[0].textContent = payload.track.title;
          details.children[1].textContent = payload.track.artist;
        }

        lastSyncState = payload;
        statusIcon.textContent = payload.isPlaying ? '▶ PLAYING' : '⏸ PAUSED';
        statusIcon.style.color = payload.isPlaying ? 'var(--omni-success)' : 'var(--omni-warning)';

        this._widgetIsLoading = !!payload.isLoading;
        wPlayBtn.innerHTML = safeHTML(payload.isLoading ? FluxKit.ui.getIcon('loader') : (payload.isPlaying ? FluxKit.ui.getIcon('pause') : FluxKit.ui.getIcon('play')));
        wPlayBtn.style.opacity = payload.isLoading ? '0.6' : '1';
        wPlayBtn.style.cursor = payload.isLoading ? 'default' : 'pointer';
        this._scheduleLoaderVisibility(this.uiNodes.widgetCoverLoader, payload.isLoading, 'widget');

        if (!payload.track) widget.remove();
      }, true);

      return widget;
    }

    async execute() {
      const rawQ = this.query.trim();

      if (/^>\s*(playlist|pl)(\s+|$)/i.test(rawQ)) {
        const parts = rawQ.replace(/^>\s*(playlist|pl)\s*/i, '').trim().split(/\s+/);
        const action = parts[0] ? parts[0].toLowerCase() : '';
        const name = parts.slice(1).join(' ');
        const playlists = FluxHubState.get(STATE_KEYS.SAVED_PLAYLISTS, {});

        let trackOnly = true;
        if ((action === 'add' || action === 'append') && name) {
          this.addToPlaylist(name, !trackOnly);
        }

        if (action === 'addtrack' && name) {
          this.addToPlaylist(name, trackOnly);
        }

        if ((action === 'delete' || action === 'del' || action === 'rm') && name) {
          if (PlaylistsState.remove(name)) {
            if (FluxHubState.get(STATE_KEYS.ACTIVE_PLAYLIST_NAME) === name) {
              FluxHubState.delete(STATE_KEYS.ACTIVE_PLAYLIST_NAME);
            }
            FluxHub.ui.setInputVal('> pl');
            return;
          }
        }

        if ((action === 'rename' || action === 'edit') && name) {
          const splitTokens = name.split(/\s+to\s+/i);
          if (splitTokens.length >= 2) {
            const oldName = splitTokens[0].trim();
            const newName = splitTokens.slice(1).join(' to ').trim();
            if (PlaylistsState.rename(oldName, newName)) {
              if (FluxHubState.get(STATE_KEYS.ACTIVE_PLAYLIST_NAME) === oldName) {
                FluxHubState.set(STATE_KEYS.ACTIVE_PLAYLIST_NAME, newName);
              }
              FluxHub.ui.setInputVal('> pl');
              return;
            }
          }
        }

        if (action === 'load' && name && playlists[name]) {
          this.executePlaylistLoad(name);
          return;
        }
      }

      const index = FluxHub.ui.currentViews.indexOf(this);
      const row = FluxHub.ui.resultsList.children[index];

      if (row && row.classList.contains('flx-omni-row')) {
        row.style.opacity = '0.5';
        const iconNode = row.querySelector('.flx-omni-icon');
        if (iconNode) iconNode.innerHTML = safeHTML(FluxKit.ui.icons.loader);
      }

      const data = await this.fetchData();
      if (data) FluxHub.ui.expandListItem(this, data);
    }

    destroy() { this._purge(); this.uiNodes = {}; }
  }

  class MusicStatsHubView extends BaseView {
    constructor(query, context = null) {
      super(query, context);
      this.rawQuery = query.trim();
      this.query = this.rawQuery.toLowerCase();
      this.nodes = {};
      this.activeTab = 'overview';
    }

    static get isAvailable() { return true; }
    static get groupWidgets() { return false; }

    static commandRegistry = [
      { prefix: '> stats', description: 'Dashboard of your personal music listening habits', icon: 'trending' },
      { prefix: '> top', description: 'View your most played tracks and artists', icon: 'shine' },
      { prefix: '> history', description: 'View your recently played tracks', icon: 'history' },
      { prefix: '> fav', description: 'View your favorite tracks', icon: 'heart' }
    ];

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (['> stats', '> top', '> history', '> fav', '> favorites'].includes(q)) return 100;
      if (/^>\s*(stats|top|history|fav|favorites)\b/i.test(query)) return 100;
      return 0;
    }

    formatDuration(ms) {
      const minutes = Math.floor(ms / 60000);
      if (minutes < 60) return `${minutes} min${minutes !== 1 ? 's' : ''}`;
      const hours = (minutes / 60).toFixed(1);
      return `${hours} hr${hours !== '1.0' ? 's' : ''}`;
    }

    formatTimeAgo(timestamp) {
      const diff = Date.now() - timestamp;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    }

    async fetchData() {
      const inspectTrack = FluxHubState.get('flx_inspect_track', null);
      if (inspectTrack) {
        FluxHubState.delete('flx_inspect_track');
        return { initialTab: 'inspect', inspectTrack };
      }

      let initialTab = 'overview';
      if (this.query.match(/^>\s*top/)) initialTab = 'top';
      else if (this.query.match(/^>\s*history/)) initialTab = 'history';
      else if (this.query.match(/^>\s*fav/)) initialTab = 'favorites';
      else if (this.query.match(/^>\s*artist/)) initialTab = 'artists';
      else if (this.query.match(/^>\s*(discoveries|shazam)/)) initialTab = 'discoveries'; // ADD THIS LINE

      return { initialTab };
    }

    renderListRow() {
      return FluxKit.ui.omni.ListRow('Music Stats & Analytics', 'activity', 'View top tracks, listening time, and history');
    }

    renderExpandedCard(data) {
      const container = createHTMLElement('div', {
        style: { display: 'flex', flexDirection: 'column', padding: '8px 0', fontFamily: 'var(--omni-font)', position: 'relative' }
      });

      this.nodes.viewport = createHTMLElement('div', { style: { minHeight: '300px', position: 'relative', zIndex: '2' } });

      if (data.initialTab === 'inspect') {
        this.activeTab = 'overview'; // Fallback for the back button
        this.renderTrackInspector(data.inspectTrack);
      } else {
        this.renderDashboard(data.initialTab);
      }

      container.appendChild(this.nodes.viewport);
      return FluxKit.ui.omni.DetailCard(container, []);
    }

    renderDashboard(activeTab) {
      this.nodes.viewport.innerHTML = safeHTML('');
      this.activeTab = activeTab;

      const tabBar = createHTMLElement('div', {
        style: { display: 'flex', gap: '2px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }
      });

      const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'top', label: 'Top Tracks' },
        { id: 'artists', label: 'Top Artists' },
        { id: 'history', label: 'History' },
        { id: 'discoveries', label: 'Discoveries' },
        { id: 'favorites', label: 'Favorites' }
      ];

      tabs.forEach(t => {
        const isAct = t.id === activeTab;
        const btn = createHTMLElement('button', {
          textContent: t.label,
          style: {
            padding: '6px 14px', borderRadius: '16px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap',
            background: isAct ? 'var(--omni-accent)' : 'var(--omni-input-bg)',
            color: isAct ? 'var(--omni-btn-text)' : 'var(--omni-text)',
            opacity: isAct ? '1' : '0.7', transition: 'all 0.2s'
          },
          eventListener: {
            click: () => this.renderDashboard(t.id),
            mouseenter: (e) => { if(!isAct) e.target.style.background = 'var(--omni-hover)'; },
            mouseleave: (e) => { if(!isAct) e.target.style.background = 'var(--omni-input-bg)'; }
          }
        });
        tabBar.appendChild(btn);
      });
      this.nodes.viewport.appendChild(tabBar);

      const contentArea = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });

      if (!FluxKit.musicStats) {
        contentArea.textContent = 'Stats engine not found. Ensure FluxKit.musicStats is loaded.';
        this.nodes.viewport.appendChild(contentArea);
        return;
      }

      const renderList = (items, type) => {
        if (!items || !items.length) {
          contentArea.appendChild(createHTMLElement('div', { textContent: 'No listening data found yet.', style: { color: 'var(--omni-muted)', fontSize: '13px', textAlign: 'center', padding: '30px 0' }}));
          return;
        }

        items.forEach((item, i) => {
          const track = (type === 'history' || type === 'discoveries') ? item.meta : item; // UPDATE THIS LINE
          if (!track) return;

          const row = createHTMLElement('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', borderRadius: '8px',
              background: 'transparent', cursor: 'pointer', border: '1px solid transparent', transition: 'all 0.2s'
            },
            eventListener: {
              mouseenter: (e) => { e.currentTarget.style.background = 'var(--omni-hover)' },
              mouseleave: (e) => { e.currentTarget.style.background = 'transparent' },
              click: () => {
                if (type === 'artists') FluxHub.ui.setInputVal(`> play ${item.artist}`);
                else this.renderTrackInspector(track);
              }
            }
          });

          row.appendChild(createHTMLElement('div', { textContent: `${i+1}`, style: { fontSize: '13px', color: 'var(--omni-muted)', width: '24px', fontWeight: 'bold', textAlign: 'center' }}));

          if (type !== 'artists') {
            row.appendChild(createHTMLElement('img', { src: track.cover || '', style: { width: '36px', height: '36px', borderRadius: '4px', objectFit: 'cover', background: 'var(--omni-input-bg)' } }));
          }

          const textWrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: '1', overflow: 'hidden' }});
          textWrap.appendChild(createHTMLElement('div', { textContent: type === 'artists' ? item.artist : track.title, style: { fontSize: '14px', fontWeight: '600', color: 'var(--omni-text)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}));
          if (type !== 'artists') {
            textWrap.appendChild(createHTMLElement('div', { textContent: track.artist, style: { fontSize: '12px', color: 'var(--omni-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}));
          }
          row.appendChild(textWrap);

          const statWrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: '0' }});
          let statMain = '', statSub = '';

          if (type === 'history' || type === 'discoveries') {
            statMain = this.formatTimeAgo(item.timestamp);
          } else {
            statMain = `${item.playCount} plays`;
            statSub = this.formatDuration(item.totalTimeMs);
          }

          statWrap.appendChild(createHTMLElement('div', { textContent: statMain, style: { fontSize: '13px', color: 'var(--omni-text)', fontWeight: '600' }}));
          if (statSub) statWrap.appendChild(createHTMLElement('div', { textContent: statSub, style: { fontSize: '11px', color: 'var(--omni-muted)' }}));

          row.appendChild(statWrap);
          contentArea.appendChild(row);
        });
      };

      if (activeTab === 'overview') {
         const db = FluxHubState.get(STATE_KEYS.MUSIC_STATS, {});
         const tracks = Object.values(db);
         const totalPlays = tracks.reduce((sum, t) => sum + t.playCount, 0);
         const totalTimeMs = tracks.reduce((sum, t) => sum + t.totalTimeMs, 0);

         const statsGrid = createHTMLElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' } });

         const makeCard = (lbl, val) => {
           const c = createHTMLElement('div', { style: { padding: '16px', background: 'var(--omni-input-bg)', borderRadius: '12px', border: '1px solid var(--omni-border)', display: 'flex', flexDirection: 'column', gap: '4px' } });
           c.appendChild(createHTMLElement('div', { textContent: lbl, style: { fontSize: '12px', color: 'var(--omni-muted)', textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: '0.5px' }}));
           c.appendChild(createHTMLElement('div', { textContent: val, style: { fontSize: '24px', color: 'var(--omni-accent-text)', fontWeight: 'bold' }}));
           return c;
         };

         statsGrid.appendChild(makeCard('Total Streams', totalPlays));
         statsGrid.appendChild(makeCard('Time Listened', this.formatDuration(totalTimeMs)));
         contentArea.appendChild(statsGrid);

         contentArea.appendChild(createHTMLElement('div', { textContent: 'Recently Played', style: { fontSize: '14px', fontWeight: 'bold', margin: '8px 0', paddingBottom: '6px', borderBottom: '1px solid var(--omni-separator)', color: 'var(--omni-muted)' }}));
         renderList(FluxKit.musicStats.getHistory(3), 'history');
      } else if (activeTab === 'top') {
         renderList(FluxKit.musicStats.getTopTracks(30), 'top');
      } else if (activeTab === 'artists') {
         renderList(FluxKit.musicStats.getTopArtists(30), 'artists');
      } else if (activeTab === 'history') {
         renderList(FluxKit.musicStats.getHistory(50), 'history');
      } else if (activeTab === 'discoveries') { 
         renderList(FluxKit.musicStats.getDiscoveries(50), 'discoveries');
      } else if (activeTab === 'favorites') {
         renderList(FluxKit.musicStats.getFavorites(), 'favorites');
      }

      this.nodes.viewport.appendChild(contentArea);
    }

    renderTrackInspector(trackMeta) {
      this.nodes.viewport.innerHTML = safeHTML('');

      const trackStat = FluxKit.musicStats.getTrackStats(trackMeta) || {
        playCount: 0, totalTimeMs: 0, firstPlayed: Date.now(), isFavorite: false,
        cover: trackMeta.cover, title: trackMeta.title, artist: trackMeta.artist
      };

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', paddingTop: '16px', position: 'relative' } });

      const heroBg = createHTMLElement('div', {
        style: {
           width: '100%', height: '180px', position: 'absolute', top: '-16px', left: '0',
           backgroundImage: `url(${trackStat.cover || trackMeta.cover || ''})`,
           backgroundSize: 'cover', backgroundPosition: 'center',
           filter: 'blur(30px) opacity(0.2)', zIndex: '-1', borderRadius: '12px 12px 0 0', pointerEvents: 'none'
        }
      });
      container.appendChild(heroBg);

      const backBtn = createHTMLElement('button', {
         innerHTML: safeHTML(`&larr; Back`),
         style: { position: 'absolute', top: '0', left: '0', background: 'var(--omni-input-bg)', border: '1px solid var(--omni-border)', color: 'var(--omni-text)', padding: '6px 12px', borderRadius: '16px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' },
         eventListener: { click: () => this.renderDashboard(this.activeTab) }
      });
      container.appendChild(backBtn);

      container.appendChild(createHTMLElement('img', {
        src: trackStat.cover || trackMeta.cover || '',
        style: { width: '200px', height: '200px', borderRadius: '12px', objectFit: 'cover', boxShadow: '0 16px 32px rgba(0,0,0,0.3)', border: '1px solid color-mix(in srgb, var(--omni-border) 50%, transparent)' }
      }));

      const textWrap = createHTMLElement('div', { style: { textAlign: 'center', maxWidth: '85%' }});
      textWrap.appendChild(createHTMLElement('div', { textContent: trackStat.title, style: { fontSize: '24px', fontWeight: '800', color: 'var(--omni-text)', lineHeight: '1.2' }}));
      textWrap.appendChild(createHTMLElement('div', { textContent: trackStat.artist, style: { fontSize: '15px', color: 'var(--omni-muted)', marginTop: '4px', fontWeight: '500' }}));
      container.appendChild(textWrap);

      const statsRow = createHTMLElement('div', { style: { display: 'flex', gap: '32px', background: 'var(--omni-input-bg)', padding: '16px 32px', borderRadius: '16px', border: '1px solid var(--omni-border)' } });

      const makeStat = (lbl, val) => {
        const c = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } });
        c.appendChild(createHTMLElement('div', { textContent: lbl, style: { fontSize: '11px', color: 'var(--omni-muted)', textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: '0.5px' }}));
        c.appendChild(createHTMLElement('div', { textContent: val, style: { fontSize: '18px', color: 'var(--omni-accent-text)', fontWeight: '800' }}));
        return c;
      };

      statsRow.appendChild(makeStat('Streams', trackStat.playCount));
      statsRow.appendChild(makeStat('Total Time', this.formatDuration(trackStat.totalTimeMs)));

      const d = new Date(trackStat.firstPlayed);
      statsRow.appendChild(makeStat('Discovered', `${d.toLocaleString('default', { month: 'short'})} ${d.getFullYear()}`));
      container.appendChild(statsRow);

      const actionsRow = createHTMLElement('div', { style: { display: 'flex', gap: '12px', marginTop: '8px' }});

      const btnStyle = { padding: '12px 24px', borderRadius: '24px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', transition: 'transform 0.15s, filter 0.15s' };

      const playBtn = createHTMLElement('button', {
        icon: 'play', textContent: 'Play Now',
        style: { ...btnStyle, display: 'flex', gap: '6px', background: 'var(--omni-accent)', color: 'var(--omni-btn-text)' },
        eventListener: {
          click: () => FluxHub.ui.setInputVal(`> play ${trackStat.title} ${trackStat.artist}`),
          mouseenter: e => { e.target.style.transform = 'scale(1.05)' },
          mouseleave: e => { e.target.style.transform = 'scale(1)' }
        }
      });

      const favBtn = createHTMLElement('button', {
        icon: trackStat.isFavorite ? 'heartFilled' : 'heart', textContent: trackStat.isFavorite ? 'Unfavorite' : 'Favorite',
        style: { ...btnStyle, display: 'flex', gap: '6px', background: 'var(--omni-input-bg)', color: 'var(--omni-danger)', border: '1px solid var(--omni-border)' },
        eventListener: {
          click: () => {
            const newState = FluxKit.musicStats.toggleFavorite(trackMeta);
            trackStat.isFavorite = newState;
            favBtn.innerHTML = newState ? `${FluxKit.ui.getIcon('heartFilled')}<span>Unfavorite</span>` : `${FluxKit.ui.getIcon('heart')}<span>Favorite</span>`;
          },
          mouseenter: e => { e.target.style.filter = 'brightness(1.1)' },
          mouseleave: e => { e.target.style.filter = 'none' }
        }
      });

      actionsRow.appendChild(playBtn);
      actionsRow.appendChild(favBtn);
      container.appendChild(actionsRow);

      this.nodes.viewport.appendChild(container);
    }

    handleKeydown(e) { return false; }

    async execute() { const data = await this.fetchData(); FluxHub.ui.expandListItem(this, data); }
  }

  class IdentifyMusicView extends BaseView {
    constructor(query, context = null) {
      super(query, context);
      this.isListening = false;
    }

    _fallbackCover() {
      return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjMjIyIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjgiLz48dGV4dCB4PSI1MCIgeT0iNTUiIGZvbnQtc2l6ZT0iMzAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM1NTUiPvCfjbc8L3RleHQ+PC9zdmc+';
    }

    static get isAvailable() { return true; }
    
    static get commandRegistry() {
      return [{ prefix: '> identify', description: 'Listen and identify playing music', icon: 'audio' }];
    }

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (/^>\s*(identify|shazam|song)\b/i.test(q)) return 100;
      return 0;
    }

    renderListRow() {
      return FluxKit.ui.omni.ListRow('Identify Music', 'note', 'Listen to ambient audio to find a track');
    }

    renderExpandedCard(data) {
      const container = createHTMLElement('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px', gap: '16px', fontFamily: 'var(--omni-font)', position: 'relative', overflow: 'hidden' }
      });

      if (data.mode === 'listening' || data.mode === 'resolving') {
        const pulseUi = createHTMLElement('div', {
          icon: data.mode === 'listening' ? 'mic' : 'search',
          style: {
            fontSize: '42px', color: 'var(--omni-accent)', 
            animation: 'flx-pulse 1.5s infinite ease-in-out',
            background: 'var(--omni-input-bg)', padding: '24px', borderRadius: '50%'
          }
        });
        
        container.appendChild(pulseUi);
        container.appendChild(createHTMLElement('div', {
          textContent: data.mode === 'listening' ? 'Listening to audio (approx. 4 seconds)...' : `Identified "${data.match.title}". Resolving stream...`,
          style: { color: 'var(--omni-text)', fontSize: '14px', fontWeight: 'bold', marginTop: '16px', textAlign: 'center' }
        }));
        
        if (data.mode === 'listening') {
          container.appendChild(createHTMLElement('div', {
            textContent: 'Please ensure your microphone is picking up the music.',
            style: { color: 'var(--omni-muted)', fontSize: '12px' }
          }));
        }
      } else if (data.mode === 'resolved' || data.mode === 'result_only') {
        const track = data.mode === 'resolved' ? data.track : data.ghostTrack;
        const trackStat = typeof FluxKit.musicStats !== 'undefined' ? (FluxKit.musicStats.getTrackStats(track) || {}) : {};
        let isFav = !!trackStat.isFavorite;

        const heroBg = createHTMLElement('div', {
          style: {
            width: '100%', height: '180px', position: 'absolute', top: '0', left: '0',
            backgroundImage: `url(${track.cover || ''})`,
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: 'blur(30px) opacity(0.2)', zIndex: '0', pointerEvents: 'none'
          }
        });
        container.appendChild(heroBg);

        const contentZ = createHTMLElement('div', { style: { position: 'relative', zIndex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%' } });

        contentZ.appendChild(createHTMLElement('img', {
          src: track.cover || this._fallbackCover(),
          style: { width: '200px', height: '200px', borderRadius: '12px', objectFit: 'cover', boxShadow: '0 16px 32px rgba(0,0,0,0.3)', border: '1px solid color-mix(in srgb, var(--omni-border) 50%, transparent)' },
          eventListener: { error: (e) => { e.target.onerror = null; e.target.src = this._fallbackCover(); } }
        }));

        const textWrap = createHTMLElement('div', { style: { textAlign: 'center', maxWidth: '85%' }});
        textWrap.appendChild(createHTMLElement('div', { textContent: track.title, style: { fontSize: '24px', fontWeight: '800', color: 'var(--omni-text)', lineHeight: '1.2' }}));
        textWrap.appendChild(createHTMLElement('div', { textContent: track.artist, style: { fontSize: '15px', color: 'var(--omni-muted)', marginTop: '4px', fontWeight: '500' }}));
        contentZ.appendChild(textWrap);

        if (data.mode === 'result_only') {
            contentZ.appendChild(createHTMLElement('div', { 
              textContent: data.reason === 'no_results' 
                ? `Not available on ${FluxHubState.get(STATE_KEYS.MUSIC_PROVIDER, 'itunes_hub')}.`
                : 'Active provider returned a mismatched track.', 
              style: { fontSize: '12px', color: 'var(--omni-warning)', textAlign: 'center', background: 'rgba(245, 158, 11, 0.1)', padding: '6px 12px', borderRadius: '6px' } 
            }));
        }

        const actionsRow = createHTMLElement('div', { style: { display: 'flex', gap: '12px', marginTop: '8px' }});
        const btnStyle = { padding: '12px 24px', borderRadius: '24px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', transition: 'transform 0.15s, filter 0.15s' };

        if (data.mode === 'resolved') {
          const playBtn = createHTMLElement('button', {
            icon: 'play', textContent: 'Play Now',
            style: { ...btnStyle, display: 'flex', gap: '6px', background: 'var(--omni-accent)', color: 'var(--omni-btn-text)' },
            eventListener: {
              click: () => FluxHub.ui.setInputVal(`> play ${track.title} ${track.artist}`),
              mouseenter: e => { e.target.style.transform = 'scale(1.05)' },
              mouseleave: e => { e.target.style.transform = 'scale(1)' }
            }
          });
          actionsRow.appendChild(playBtn);
        } else {
          const searchBtn = createHTMLElement('button', {
            icon: 'search', innerHTML: 'Search Everywhere',
            style: { ...btnStyle, display: 'flex', gap: '6px', background: 'var(--omni-text)', color: 'var(--omni-bg-light)' },
            eventListener: {
              click: () => FluxHub.ui.setInputVal(`> search ${track.title} ${track.artist}`),
              mouseenter: e => { e.target.style.transform = 'scale(1.05)' },
              mouseleave: e => { e.target.style.transform = 'scale(1)' }
            }
          });
          actionsRow.appendChild(searchBtn);
        }

        const favBtn = createHTMLElement('button', {
          icon: isFav ? 'heartFilled' : 'heart', innerHTML: safeHTML(`<span class="flx-fav-text">${isFav ? 'Unfavorite' : 'Favorite'}</span>`),
          style: { ...btnStyle, display: 'flex', gap: '6px', background: 'var(--omni-input-bg)', color: 'var(--omni-danger)', border: '1px solid var(--omni-border)' },
          eventListener: {
            click: (e) => {
              isFav = FluxKit.musicStats.toggleFavorite(track);
              favBtn.innerHTML = isFav ? `${FluxKit.ui.getIcon('heartFilled')}<span>Unfavorite</span>` : `${FluxKit.ui.getIcon('heart')}<span>Favorite</span>`;
            },
            mouseenter: e => { e.target.style.filter = 'brightness(1.1)' },
            mouseleave: e => { e.target.style.filter = 'none' }
          }
        });
        actionsRow.appendChild(favBtn);
        
        contentZ.appendChild(actionsRow);
        container.appendChild(contentZ);

      } else if (data.mode === 'error') {
        const errorType = data.error?.type || 'unknown';
        const icon = (errorType === 'auth_error' || errorType === 'quota_error') ? 'lock' : 'warning';
        container.appendChild(createHTMLElement('div', { icon: icon, style: { fontSize: '32px', color: 'var(--omni-danger)', marginBottom: '8px' } }));
        container.appendChild(createHTMLElement('div', { textContent: data.error?.message || 'An unknown error occurred.', style: { color: 'var(--omni-text)', fontWeight: 'bold', fontSize: '14px', textAlign: 'center' } }));
        if (errorType === 'auth_error') {
          container.appendChild(createHTMLElement('div', { textContent: 'Configure your RapidAPI Key in your settings to continue. (Requires the free Shazam API by apidojo)', style: { color: 'var(--omni-muted)', fontSize: '12px', marginTop: '4px', textAlign: 'center' } }));
        }
        const actions = createHTMLElement('div', { style: { display: 'flex', gap: '12px', marginTop: '16px' }});
        actions.appendChild(FluxKit.ui.omni.Button('refresh', 'Try Again', () => this.execute()));
        container.appendChild(actions);
      }

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    async execute() {
      if (this.isListening) return;
      this.isListening = true;

      FluxHub.ui.expandListItem(this, { mode: 'listening' });

      try {
        const match = await FluxKit.api.music.identifyAmbientAudio(this.abortController?.signal);
        
        FluxHub.ui.expandListItem(this, { mode: 'resolving', match });
        
        const cleanTitle = match.title.replace(/\(feat\..*?\)/gi, '').trim();
        const searchQuery = `${cleanTitle} ${match.artist}`.trim();
        
        const results = await FluxKit.api.music.search(searchQuery, 3, this.abortController?.signal);

        let isResolved = false;
        let finalTrack = null;

        if (results && results.length > 0) {
          const resultWords = `${results[0].title.toLowerCase()} ${results[0].artist.toLowerCase()}`;
          const matchWords = `${match.title.toLowerCase()} ${match.artist.toLowerCase()}`.split(' ');
          
          let confidence = 0;
          matchWords.forEach(word => {
            if (word.length > 2 && resultWords.includes(word)) confidence++;
          });

          if (confidence >= 1) {
            if (match.raw?.images?.coverart && (!results[0].cover || results[0].cover.includes('150x150'))) {
              results[0].cover = match.raw.images.coverart;
            }
            finalTrack = results[0];
            isResolved = true;
          }
        }

        if (!isResolved) {
          finalTrack = {
            id: `ghost_${Date.now()}`,
            title: match.title,
            artist: match.artist,
            cover: match.raw?.images?.coverart || '',
            durationMs: 0,
            streamUrl: null
          };
        }

        FluxKit.musicStats.recordDiscovery(finalTrack);

        if (isResolved) {
          FluxHub.ui.expandListItem(this, { mode: 'resolved', match, track: finalTrack });
        } else {
          FluxHub.ui.expandListItem(this, { mode: 'result_only', match, ghostTrack: finalTrack, reason: results?.length > 0 ? 'mismatch' : 'no_results' });
        }
      } catch (err) {
        FluxHub.ui.expandListItem(this, { mode: 'error', error: err });
      } finally {
        this.isListening = false;
      }
    }
  }

  class StockView extends BaseView {
    constructor(query, context = null) {
      super(query, context);
      this.carouselIndex = 0;
    }

    static isAvailable = true;
    static groupWidgets = true;

    static matchConfidence(query) {
      const q = query.trim().toLowerCase();
      if (q.startsWith('> stock ') || q.startsWith('> market ')) return 100;
      return 0;
    }

    async resolveSymbol(queryTerm) {
      if (!queryTerm || typeof queryTerm !== 'string') return '';
      const cleanTerm = queryTerm.trim();
      if (!cleanTerm) return '';

      if (/^[a-z0-9\^\.=\-]+$/i.test(cleanTerm) && cleanTerm.length <= 10) return cleanTerm.toUpperCase();

      const cacheKey = `search_sym_${cleanTerm.toLowerCase()}`;
      const cached = await FluxHub.cache.get(cacheKey);
      if (cached) return cached;

      return new Promise(resolve => {
        const searchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanTerm)}&quotesCount=1`;
        GM_xmlhttpRequest({
          method: 'GET', url: searchUrl, timeout: 4000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          onload: (r) => {
            try {
              const json = JSON.parse(r.responseText);
              if (json.quotes && json.quotes.length > 0) {
                const bestSymbol = json.quotes[0].symbol;
                FluxHub.cache.set(cacheKey, bestSymbol, 60 * 60 * 1000);
                resolve(bestSymbol);
              } else { resolve(cleanTerm.toUpperCase()); }
            } catch (e) { resolve(cleanTerm.toUpperCase()); }
          },
          onerror: () => resolve(cleanTerm.toUpperCase()), ontimeout: () => resolve(cleanTerm.toUpperCase())
        });
      });
    }

    async fetchStockData(symbol) {
      if (!symbol) return null;
      const cacheKey = `stock_${symbol}`;
      const cached = await FluxHub.cache.get(cacheKey);
      if (cached && (Date.now() - cached._timestamp < 5 * 60 * 1000)) return cached.data;

      return new Promise(resolve => {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
        GM_xmlhttpRequest({
          method: 'GET', url: url, timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          onload: async (r) => {
            try {
              if (r.status !== 200) { resolve(null); return; }
              const json = JSON.parse(r.responseText);
              if (!json.chart || !json.chart.result || !json.chart.result[0]) { resolve(null); return; }

              const meta = json.chart.result[0].meta;
              const currentPrice = meta.regularMarketPrice;
              const prevClose = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPreviousClose || currentPrice;
              const change = currentPrice - prevClose;
              const percentChange = prevClose ? (change / prevClose) * 100 : 0;

              const data = {
                symbol: meta.symbol,
                shortName: meta.longName || meta.shortName || meta.symbol,
                exchange: meta.fullExchangeName || meta.exchangeName || '',
                currency: meta.currency || 'USD',
                price: currentPrice.toFixed(2),
                change: change.toFixed(2),
                percentChange: percentChange.toFixed(2),
                isUp: change >= 0,
                dayHigh: meta.regularMarketDayHigh,
                dayLow: meta.regularMarketDayLow,
                prevClose: prevClose,
                marketState: meta.marketState || ''
              };
              await FluxHub.cache.set(cacheKey, { _timestamp: Date.now(), data });
              resolve(data);
            } catch (err) { resolve(null); }
          },
          onerror: () => resolve(null), ontimeout: () => resolve(null)
        });
      });
    }

    async fetchData(signal, explicitSymbol = null) {
      let rawQuery = explicitSymbol;
      if (!rawQuery) { const q = this.query.trim(); rawQuery = q.replace(/^>\s*(stock|market)\s+/i, '').trim(); }
      if (!rawQuery) return null;
      const symbol = await this.resolveSymbol(rawQuery);
      return await this.fetchStockData(symbol);
    }

    renderListRow() { return FluxKit.ui.omni.ListRow(`Search Market for "${this.query.trim().replace(/^>\s*(stock|market)\s+/i, '').trim()}"`, 'trending', 'Market Data', 'Resolving...'); }

    renderExpandedCard(data) {
      const modernFont = 'var(--omni-font)';

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', fontFamily: modernFont, padding: '4px 0' } });

      const headerRow = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } });

      const symbolBlock = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
      symbolBlock.appendChild(createHTMLElement('div', { style: { fontSize: '22px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: data.symbol }));
      if (data.shortName && data.shortName !== data.symbol) {
        symbolBlock.appendChild(createHTMLElement('div', { style: { fontSize: '13px', color: 'var(--omni-muted)', maxWidth: '260px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, textContent: data.shortName }));
      }
      headerRow.appendChild(symbolBlock);

      if (data.exchange) {
        headerRow.appendChild(createHTMLElement('div', {
          textContent: data.exchange,
          style: { fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--omni-muted)', background: 'var(--omni-input-bg)', border: '1px solid var(--omni-border)', borderRadius: '4px', padding: '3px 8px', whiteSpace: 'nowrap' }
        }));
      }
      container.appendChild(headerRow);

      const priceRow = createHTMLElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '12px' } });

      const changeColor = data.isUp ? 'var(--omni-success)' : 'var(--omni-danger)';
      const changeSign = data.isUp ? '+' : '';

      const priceValue = createHTMLElement('div', {
        textContent: `${data.price} ${data.currency}`, fluxHubTooltip: 'Click to convert to INR',
        style: {
          fontSize: '36px', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums',
          color: 'var(--omni-text)', cursor: 'pointer', borderBottom: '1px dashed var(--omni-muted)',
          lineHeight: '1.1', transition: 'color 0.15s ease'
        },
        eventListener: {
          click: (e) => {
            e.stopPropagation();
            const fromCode = (data.currency || 'USD').toLowerCase();
            FluxHub.ui.setInputVal(`${data.price} ${fromCode} to inr`);
          },
          mouseenter: (e) => { e.currentTarget.style.color = 'var(--omni-accent)'; },
          mouseleave: (e) => { e.currentTarget.style.color = 'var(--omni-text)'; }
        }
      });
      priceRow.appendChild(priceValue);

      const changeBlock = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
      changeBlock.appendChild(createHTMLElement('div', {
        textContent: `${changeSign}${data.change} (${changeSign}${data.percentChange}%)`,
        style: { fontSize: '15px', fontWeight: '700', color: changeColor }
      }));
      if (data.marketState) {
        changeBlock.appendChild(createHTMLElement('div', {
          textContent: data.marketState === 'REGULAR' ? 'Market Open' : data.marketState === 'CLOSED' ? 'Market Closed' : data.marketState,
          style: { fontSize: '11px', color: 'var(--omni-muted)', fontWeight: '600', textTransform: 'uppercase' }
        }));
      }
      priceRow.appendChild(changeBlock);
      container.appendChild(priceRow);

      const detailsGrid = createHTMLElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px', borderTop: '1px solid var(--omni-separator)', paddingTop: '12px' } });

      const makeDetail = (label, value) => {
        const cell = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
        cell.appendChild(createHTMLElement('div', { textContent: label, style: { fontSize: '11px', color: 'var(--omni-muted)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.4px' } }));
        cell.appendChild(createHTMLElement('div', { textContent: value, style: { fontSize: '14px', color: 'var(--omni-text)', fontWeight: '600', fontVariantNumeric: 'tabular-nums' } }));
        return cell;
      };

      if (data.prevClose !== undefined && data.prevClose !== null) {
        detailsGrid.appendChild(makeDetail('Prev Close', `${Number(data.prevClose).toFixed(2)} ${data.currency}`));
      }
      if (data.dayHigh !== undefined && data.dayHigh !== null && data.dayLow !== undefined && data.dayLow !== null) {
        detailsGrid.appendChild(makeDetail('Day Range', `${Number(data.dayLow).toFixed(2)} – ${Number(data.dayHigh).toFixed(2)}`));
      }

      if (detailsGrid.children.length > 0) container.appendChild(detailsGrid);

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    async renderWidget(paramsArray) {
      if (!paramsArray || !Array.isArray(paramsArray) || paramsArray.length === 0) return null;

      const widget = createHTMLElement('div', { class: 'flx-omni-widget', style: { padding: '14px', display: 'flex', flexDirection: 'column', gridColumn: 'span 2', minHeight: '140px' } });

      const gridArea = createHTMLElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginTop: '0px' } });
      widget.appendChild(gridArea);

      const itemsPerPage = 4;
      const totalPages = Math.ceil(paramsArray.length / itemsPerPage);
      if (this.carouselIndex >= totalPages) this.carouselIndex = 0;

      let indicator = null;

      const renderPage = async (page) => {
        gridArea.innerHTML = safeHTML('');
        const start = page * itemsPerPage;
        const slice = paramsArray.slice(start, start + itemsPerPage);

        for (const params of slice) {
          if (!params || !params.symbol) continue;

          const resolvedSymbol = await this.resolveSymbol(params.symbol);
          if (!resolvedSymbol) continue;

          const itemRow = createHTMLElement('div', {
            style: {
              padding: '10px 12px', borderRadius: '8px', background: 'var(--omni-hover)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
              border: '1px solid var(--omni-border)'
            },
            eventListener: () => FluxHub.ui.setInputVal(`> market ${resolvedSymbol}`)
          });

          const leftCol = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column' } });
          leftCol.appendChild(createHTMLElement('div', { style: { fontSize: '13px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: resolvedSymbol }));

          const rightCol = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' } });

          const priceEl = createHTMLElement('div', {
            textContent: '...',
            style: {
              fontSize: '14px', fontWeight: 'bold', color: 'var(--omni-text)', fontVariantNumeric: 'tabular-nums',
              cursor: 'pointer', borderBottom: '1px dashed transparent', transition: 'color 0.15s ease, border-color 0.15s ease'
            }
          });

          const changeEl = createHTMLElement('div', { style: { fontSize: '11px', fontWeight: '600', marginTop: '2px' }, textContent: '' });

          rightCol.appendChild(priceEl);
          rightCol.appendChild(changeEl);

          itemRow.appendChild(leftCol);
          itemRow.appendChild(rightCol);
          gridArea.appendChild(itemRow);

          this.fetchStockData(resolvedSymbol).then(data => {
            if (!itemRow.isConnected) return;
            if (!data) { priceEl.textContent = 'N/A'; return; }

            const currency = data.currency || 'USD';
            priceEl.textContent = `${data.price} ${currency}`;
            priceEl.dataset.fluxHubTooltip = 'Click to convert to INR';
            priceEl.style.borderBottomColor = 'var(--omni-muted)';

            priceEl.addEventListener('mouseenter', () => { priceEl.style.color = 'var(--omni-accent)'; });
            priceEl.addEventListener('mouseleave', () => { priceEl.style.color = 'var(--omni-text)'; });
            priceEl.addEventListener('click', (e) => {
              e.stopPropagation();
              const fromCode = currency.toLowerCase();
              FluxHub.ui.setInputVal(`${data.price} ${fromCode} to inr`);
            });

            const color = data.isUp ? 'var(--omni-success)' : 'var(--omni-danger)';
            const sign = data.isUp ? '+' : '';
            changeEl.textContent = `${sign}${data.percentChange}%`;
            changeEl.style.color = color;
          });
        }
      };

      await renderPage(this.carouselIndex);

      if (totalPages > 1) {
        const footer = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 'auto', paddingTop: '10px', gap: '10px' } });

        const prevBtn = createHTMLElement('button', {
          textContent: '◀',
          style: { background: 'transparent', border: 'none', color: 'var(--omni-muted)', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', padding: '4px' },
          eventListener: {
            click: (e) => {
              e.stopPropagation();
              this.carouselIndex = (this.carouselIndex - 1 + totalPages) % totalPages;
              renderPage(this.carouselIndex);
              if (indicator) indicator.textContent = `Page ${this.carouselIndex + 1} / ${totalPages}`;
            }
          }
        });

        indicator = createHTMLElement('span', {
          textContent: `Page ${this.carouselIndex + 1} / ${totalPages}`,
          style: { fontSize: '11px', color: 'var(--omni-muted)', fontWeight: '600' }
        });

        const nextBtn = createHTMLElement('button', {
          textContent: '▶',
          style: { background: 'transparent', border: 'none', color: 'var(--omni-muted)', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', padding: '4px' },
          eventListener: (e) => {
            e.stopPropagation();
            this.carouselIndex = (this.carouselIndex + 1) % totalPages;
            renderPage(this.carouselIndex);
            if (indicator) indicator.textContent = `Page ${this.carouselIndex + 1} / ${totalPages}`;
          }
        });

        footer.appendChild(prevBtn);
        footer.appendChild(indicator);
        footer.appendChild(nextBtn);
        widget.appendChild(footer);
      }

      return widget;
    }

    async execute() { const data = await this.fetchData(); if (data) FluxHub.ui.expandListItem(this, data); }
  }

  class RSSView extends BaseView {
    static isAvailable = true;

    static matchConfidence(query) {
      if (query.trim().toLowerCase().startsWith('> rss ')) return 100;
      return 0;
    }

    async fetchData(signal, explicitUrl = null) {
      const feedUrl = explicitUrl || this.query.trim().replace(/^>\s*rss\s+/i, '').trim();
      if (!feedUrl) return null;

      const cacheKey = `rss_${feedUrl}`;
      const cached = await FluxHub.cache.get(cacheKey);
      if (cached && (Date.now() - cached._timestamp < 15 * 60 * 1000)) return cached.data; // 15 min TTL

      try {
        const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
        const response = await safeFetch(url, signal);
        if (!response.ok) return null;

        const data = await response.json();
        if (data.status !== 'ok') return null;

        await FluxHub.cache.set(cacheKey, { _timestamp: Date.now(), data });
        return data;
      } catch (err) { return null; }
    }

    renderListRow() { return FluxKit.ui.omni.ListRow('Fetch RSS Feed', 'rss', 'News & Updates', 'Fetching...'); }

    renderExpandedCard(data) {
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 0', maxHeight: '300px', overflowY: 'auto' } });

      const title = createHTMLElement('div', { style: { fontSize: '18px', fontWeight: 'bold', color: 'var(--omni-text)', borderBottom: '1px solid var(--omni-separator)', paddingBottom: '8px', marginBottom: '4px' }, textContent: data.feed.title });
      container.appendChild(title);

      data.items.slice(0, 10).forEach(item => {
        const itemRow = createHTMLElement('a', {
          href: item.link, target: '_blank',
          style: { display: 'flex', flexDirection: 'column', gap: '4px', textDecoration: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer' },
          eventListener: {
            mouseenter: e => { e.currentTarget.style.background = 'var(--omni-hover)' },
            mouseleave: e => { e.currentTarget.style.background = 'transparent' },
            click: () => FluxHub.ui.hide()
          }
        });

        itemRow.appendChild(createHTMLElement('div', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--omni-text)', lineHeight: '1.4' }, textContent: item.title }));

        const pubDate = new Date(item.pubDate).toLocaleDateString();
        itemRow.appendChild(createHTMLElement('div', { style: { fontSize: '12px', color: 'var(--omni-muted)' }, textContent: pubDate }));

        container.appendChild(itemRow);
      });

      return FluxKit.ui.omni.DetailCard(container, []);
    }

    async renderWidget(state) {
      const widget = createHTMLElement('div', { class: 'flx-omni-widget', style: { gridColumn: 'span 2', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', padding: '16px' } });

      const header = createHTMLElement('div', {
        icon: 'rss', innerHTML: '<span>Loading Feed...</span>',
        style: { fontSize: '11px', textTransform: 'uppercase', color: 'var(--omni-muted)', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' },
      });
      widget.appendChild(header);

      const content = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
      widget.appendChild(content);

      const icon = FluxKit.ui.getIcon('rss');
      this.fetchData(null, state.url).then(data => {
        if (!data || !widget.isConnected) {
          header.innerHTML = safeHTML(`${icon} <span>Feed Unavailable</span>`);
          return;
        }

        header.innerHTML = safeHTML(`${icon} <span>${escapeHTML(data.feed.title)}</span>`);

        data.items.slice(0, 3).forEach(item => {
          const row = createHTMLElement('a', {
            href: item.link, target: '_blank', textContent: `• ${item.title}`,
            style: { fontSize: '13px', fontWeight: '500', color: 'var(--omni-text)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: '0.9' },
            eventListener: {
              mouseenter: e => { e.target.style.color = 'var(--omni-accent)' },
              mouseleave: e => { e.target.style.color = 'var(--omni-text)' },
              click: () => FluxHub.ui.hide()
            }
          });
          content.appendChild(row);
        });
      });

      return widget;
    }

    async execute() { const data = await this.fetchData(); if (data) FluxHub.ui.expandListItem(this, data); }
  }

  FluxHub.BaseView = BaseView;
  FluxHub.engine = new CommandRouter();
  FluxHub.engine.initIPC();
  FluxHub.ui = new HubStage();
  FluxHub.ui.init(FluxHub.engine);

  FluxHub.engine.registerViews([
    HelpView, SettingsView, SyncView, WidgetManagerView, ClipboardView,
    CalculatorView, UnitConverterView, ColorView,
    GenerativeHubView, ToolsHubView, TimeManagerHubView,
    DictionaryView, TranslateView, WikipediaView,
    DuckDuckGoView, BangView, GoogleFallbackView, GitHubView,
    WeatherView, StockView, RSSView,
    MusicView, MusicStatsHubView, IdentifyMusicView
  ]);

  FluxHub.engine.registerAction({
    id: 'capture-snip', prefix: '> snip',
    title: 'Capture & Read Screen Region',
    icon: '✂️', type: 'action',
    execute: async () => {
      FluxHub.ui.hide();

      const config = SettingsState.getAll();
      const snip = await FluxKit.capture.screen.startSnip({ mode: config.ocrMode, interactive: true });
      if (!snip) return;

      FluxKit.ui.showNotification('Running OCR...', { icon: 'loader', duration: 2000 });

      try {
        const recognizedText = await FluxKit.capture.ocr.recognize(snip.base64, 'eng+jpn+chi_sim');
        const cleanText = recognizedText ? recognizedText.trim() : '';

        if (cleanText) {
          FluxHub.ui.show(cleanText, null, FluxHub.ui.activeContext);
        } else {
          FluxKit.ui.showNotification('No text detected in snip.', { icon: 'warning' });
        }
      } catch (err) {
        logError('OCR Pipeline failed:', err);
        FluxKit.ui.showNotification('OCR failed. Check console.', { icon: 'error' });
      }
    },
  });

  FluxHub.engine.registerAction({
    id: 'add-bang', prefix: '> addbang ',
    title: 'Add Custom Bang (e.g. > addbang @npm https://npmjs.com/search?q=)',
    icon: 'plus', acceptsArgs: true, type: 'action',
    execute: (query) => {
      const args = query.replace(/^>\s*addbang\s+/i, '').trim().split(' ');
      if (args.length >= 2 && args[0].startsWith('@')) {
        const prefix = args[0].toLowerCase();
        const url = args.slice(1).join(' ');
        BangsState.save(prefix, { name: prefix, url, base: url.split('?')[0], icon: 'externalLink' });
        FluxKit.ui.showNotification(`Added custom bang: ${prefix}`, { icon: 'success' });
      } else FluxKit.ui.showNotification('Format: > addbang @prefix url', { icon: 'warning' });
      FluxHub.ui.hide();
    },
  });

  FluxHub.engine.registerAction({
    id: 'remove-bang', prefix: '> rmbang ',
    title: 'Remove Custom Bang (e.g. > rmbang @npm)',
    icon: 'trash', acceptsArgs: true, type: 'action',
    execute: (query) => {
      const prefix = query.replace(/^>\s*rmbang\s*/i, '').trim().toLowerCase();
      if (!prefix) { FluxKit.ui.showNotification('Format: > rmbang @prefix', { icon: 'warning' }); FluxHub.ui.hide(); return; }
      if (BangsState.remove(prefix)) FluxKit.ui.showNotification(`Removed custom bang: ${prefix}`, { icon: 'success' });
      else FluxKit.ui.showNotification(`No custom bang found: ${prefix}`, { icon: 'warning' });
      FluxHub.ui.hide();
    },
  });

  /**
   * ============================================================================
   * BACKGROUND MANAGER: Timers & Alarms
   * Checks global state. Prevents multi-tab notification spam via Leader Election.
   * ============================================================================
   */
  setInterval(() => {
    const timer = FluxHubState.get(STATE_KEYS.ACTIVE_TIMER, null);
    if (!timer) return;

    const now = Date.now();
    if (now >= timer.endsAt) {
      const isHost = timer.hostTab === FluxKit.ipc.getTabId();
      const hostIsDead = now > timer.endsAt + 2000;

      if (isHost || hostIsDead) {
        FluxHubState.delete(STATE_KEYS.ACTIVE_TIMER);

        FluxKit.ui.showNotification(`Timer Complete: ${timer.label || 'Time is up!'}`, { icon: 'bell' });

        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          osc.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.5);
        } catch(e) {}
      }
    }
  }, 1000);

  /**
   * ============================================================================
   * CLIPBOARD TRACKER (Background)
   * Passively logs copied text to GM_setValue across all tabs.
   * ============================================================================
   */
  document.addEventListener('copy', () => {
    const text = window.getSelection().toString().trim();
    if (text) {
      const history = FluxHubState.get(STATE_KEYS.CLIP_HISTORY, []);
      const filtered = history.filter(item => item !== text);
      filtered.unshift(text);
      if (filtered.length > 50) filtered.pop();
      FluxHubState.set(STATE_KEYS.CLIP_HISTORY, filtered);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (FluxKit.utils.shouldIgnoreKeystroke(e, { allowModifiers: true })) return;

    const config = SettingsState.getAll();
    const { stored } = FluxKit.utils.getShortcutFromEvent(e, { normalizeOS: true });

    if (stored === config.launcherTrigger) {
      e.preventDefault(); e.stopPropagation();

      if (FluxHub.ui.isVisible) { FluxHub.ui.hide(); return; }

      const selectionContext = FluxKit.capture.text.getDeepSelectionContext();
      const selectionText = selectionContext ? selectionContext.text.trim() : window.getSelection().toString().trim();
      let coords = null;

      if (selectionText && selectionContext && selectionContext.rect) { coords = { x: selectionContext.rect.left, y: selectionContext.rect.bottom }; }

      FluxHub.ui.show(selectionText, coords, selectionContext);
    }

    if (stored === config.commandTrigger) {
      e.preventDefault(); e.stopPropagation();
      FluxHub.ui.show('> ', null, null, false);
    }
  }, true);
})();