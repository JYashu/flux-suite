// ==UserScript==
// @name         Video-Enhancer
// @namespace    https://github.com/JYashu/flux-suite
// @version      1.1.0
// @description  A powerful suite of video player utilities. Features smart resume, auto-pause, dropped-frame recovery, and advanced playback metrics.
// @author       JYashu
// @license      Apache-2.0
// @match        *://*.udemy.com/*
// @match        *://*.youtube.com/*
// @match        *://*.sonyliv.com/*
// @exclude      *://accounts.youtube.com/*
// @icon         https://logo-bits.s3.us-east-2.amazonaws.com/video-utils.png
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==
/* global FluxKit, GIF */

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

  const { createLogger, createHTMLElement } = FluxKit.utils;

  const { logMessage, logWarning, logError, logDebug } = createLogger('VideoUtils');

  const STORAGE_KEY = 'video_utils_config';
  const GLOBAL_CTRL = new AbortController();
  const { signal: GLOBAL_SIGNAL } = GLOBAL_CTRL;

  /*******************************************************
   | CONFIG - change per site                            |
   |                                                     |
   |  To add support for new site:                       |
   |   1. Duplicate the Default object in ELEMENTS_MAP   |
   |   2. Customize it for the site                      |
   |   3. Update the getElement function accordingly     |
   ******************************************************/
  const ELEMENTS_MAP = {
    udemy: {
      video: 'video.video-player--video-player--HiAnq',
      player: 'div.curriculum-item-view--content--aaJOw',
      progressBar: 'div.progress-bar--progress-bar-control--vhyIz',
      play: '[data-purpose="play-button"]',
      pause: '[data-purpose="pause-button"]',
    },
    youtube: {
      video: 'video.html5-main-video',
      player: 'div.html5-video-player#movie_player',
      progressBar: '.ytp-progress-bar',
      playerEl: () => document.querySelector('ytd-player')?.player_,
      miniPlayer: 'ytd-miniplayer',
    },
    sonyliv: {
      video: 'video#main_video_player_htmlPlayer5_html5_api',
      player: '#dynamicPlayer',
      progressBar: '.seekbar-wrapper ',
    },
    default: {
      video: 'video',
      player: () => getPlayerRoot(getElement('video')),
      progressBar: ['.progress-bar', '.seekbar', '.plyr__progress', '.ytp-progress-bar'],
    }
  };

  const GENERIC_PLAYER_SELECTORS = [
    '.plyr', '.jwplayer', '.video-js', '.vjs-player',
    '.shaka-video-container', '#movie_player', '.html5-video-player'
  ];

  const siteKey =
    Object.keys(ELEMENTS_MAP).find(k =>
      location.hostname.includes(k)
    ) || 'default';

  const isYoutube = siteKey === 'youtube';

  function getElement(key, all = false) {
    const config =
      ELEMENTS_MAP[siteKey]?.[key] ??
      ELEMENTS_MAP.default?.[key];
    if (!config) return all ? [] : null;

    const resolve = (sel) => {
      if (typeof sel === 'function') {
        const res = sel();
        return Array.isArray(res) ? res : [res];
      }
      if (Array.isArray(sel)) {
        return sel.flatMap((s) => Array.from(document.querySelectorAll(s)));
      }
      return Array.from(document.querySelectorAll(sel));
    };

    const result = resolve(config).filter(Boolean);
    return all ? result : result[0] || null;
  }

  let cachedPlayerRoot = null;
  function getPlayerRoot(video) {
    if (cachedPlayerRoot) return cachedPlayerRoot;
    if (!video) video = document.querySelector("video");
    if (!video) return null;

    const known = video.closest(GENERIC_PLAYER_SELECTORS.join(','));
    if (known) {
      cachedPlayerRoot = known;
      return known;
    }

    const vRect = video.getBoundingClientRect();
    let el = video, best = video, bestArea = Number.MAX_SAFE_INTEGER;

    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.width >= vRect.width && r.height >= vRect.height) {
        const area = r.width * r.height;
        if (area < bestArea) { best = el; bestArea = area; }
      }
      el = el.parentElement;
    }
    cachedPlayerRoot = best;
    return best;
  }

  function getEpisodeButtons() {
    return Array.from(document.querySelectorAll('button'))
      .filter(btn => /\b\d+\b/.test(btn.innerText));
  }

  function getEpisodeNumber(btn) {
    const match = btn.innerText.match(/\b(\d+)\b/);
    return match ? parseInt(match[1], 10) : null;
  }

  function getEpisodeSibling(direction) {
    const active = getElement('activeEp');
    if (!active) return null;

    const buttons = getEpisodeButtons()
      .map(btn => ({ btn, num: getEpisodeNumber(btn) }))
      .filter(item => item.num !== null);

    buttons.sort((a, b) => a.num - b.num);

    const index = buttons.findIndex(item => item.btn === active);
    if (index === -1) return null;

    const newIndex = index + (direction > 0 ? 1 : -1);
    if (newIndex < 0 || newIndex >= buttons.length) return null;

    return buttons[newIndex].btn;
  }

  function stopEventPropagation(event, opts = {}) {
    if (!event) return;
    event.preventDefault();
    event.stopPropagation();
    if (opts.immediate) event.stopImmediatePropagation();
  }

  function nextVideo(event) {
    const nextBtn = getElement('nextBtn') || getEpisodeSibling(+1);
    if (nextBtn) {
      if (event) stopEventPropagation(event, { immediate: true });
      nextBtn.click();
    }
  }

  const cleanupRegistry = [];
  const initializedVideos = new WeakSet();
  const FALLBACK_FPS = 30;

  let video;
  let activeVideoCtrl = null;
  let fpsTracker = null;

  function registerCleanup(fn) {
    cleanupRegistry.push(fn);
  }

  function runCleanup() {
    cleanupRegistry.forEach(fn => {
      try { fn(); } catch (e) { logWarning('cleanup error', e); }
    });
    cleanupRegistry.length = 0;
  }
  let autoPauseState = 'ON';
  let isAutoplayEnabled = true;

  const safeClear = x => { if (x) clearTimeout(x) || clearInterval(x); return null; };

  const safeAbort = c => { try { c?.abort() } catch {} return null; };

  const safeDisconnect = n => { try { n.disconnect() } catch (e) {} };

  registerCleanup(() => safeAbort(GLOBAL_CTRL));

  function waitForVideo(callback) {
    const check = () => {
      video = getElement('video');
      if (video) { callback(video); return true; }
      return false;
    };
    if (check()) return;

    const player = getElement('player');
    const target = player || document.body;
    const obs = new MutationObserver(() => { if (check()) safeDisconnect(obs); });
    obs.observe(target, { childList: true, subtree: true });
  }

  function dispatchAutoPauseState(state) {
    autoPauseState = state;
    document.dispatchEvent(new CustomEvent('autoPauseStateChange', { detail: { state } }));
  }

  function dispatchAutoplayToggle(enabled) {
    isAutoplayEnabled = enabled;
    document.dispatchEvent(new CustomEvent('autoplayToggle', { detail: { enabled } }));
  }

  function smartResume(video, { signal }) {
    if (!video || initializedVideos.has(video)) return;
    initializedVideos.add(video);

    const EPS = 3; // seconds tolerance for 'near target'
    const STABLE_HITS = 3; // how many consecutive near-target timeupdates unlock saving
    const GUARD_MS = 5000; // how long we’ll fight non-user overrides
    const MAX_CORRECTIONS = 6; // avoid fighting forever (ads/DRM)
    const STORAGE_FLUSH_DELTA = 5; // Increased throttle for localStorage writes
    const NEAR_START = 3; // don't save super-early positions
    const NEAR_END = 3; // don't save very near the end

    let store = loadStore();
    let key = getVideoKey();
    let entry = store.find(e => e.url === key);
    let resumeTarget = entry?.time ?? null;
    let resumeLock = false; // while true, we correct & block saving
    let guardUntil = 0;
    let stableHits = 0;
    let lastTU = 0;
    let userInteracted = false;
    let userInteractTimer = 0;
    let corrections = 0;

    // Save throttle
    let lastSavedTime = -1;

    // Abort controller to clean up listeners when this video is disposed
    const ALLOW_ONCE = { passive: true, signal };

    function getVideoKey() {
      const url = new URL(location.href);
      if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
        const videoId = url.searchParams.get('v');
        const playlistId = url.searchParams.get('list');
        return playlistId ? `yt:${videoId}:${playlistId}` : `yt:${videoId}`;
      }
      return url.href;
    }

    function loadStore() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
      catch { return []; }
    }

    function saveStore(store) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function cleanupStore(store) {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      let filtered = store.filter(e => e.saved >= cutoff);
      if (filtered.length > 20) filtered = filtered.slice(filtered.length - 20);
      return filtered;
    }

    function markUserInteracted() {
      userInteracted = true;
      safeClear(userInteractTimer);
      userInteractTimer = setTimeout(() => (userInteracted = false), 2000);
      if (resumeLock) {
        resumeLock = false;
        resumeTarget = null;
        logMessage('[guard] user interaction -> unlock');
      }
    }

    window.addEventListener('pointerdown', markUserInteracted, ALLOW_ONCE);
    window.addEventListener('keydown', markUserInteracted, ALLOW_ONCE);
    window.addEventListener('touchstart', markUserInteracted, ALLOW_ONCE);

    // Resume Logic
    function clampTargetToDuration(t) {
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0) return Math.max(0, Math.min(t, Math.max(0, dur - 0.5)));
      return t;
    }

    function applyResume() {
      key = getVideoKey();
      entry = store.find(e => e.url === key);
      if (!entry) return;
      resumeTarget = entry.time;
      if (resumeTarget == null) return;

      const seekTarget = clampTargetToDuration(resumeTarget);
      logMessage('[resume] set', seekTarget);
      try {
        video.currentTime = seekTarget;
      } catch (e) {
        logWarning( '[resume] failed early, will retry on metadata/durationchange');
      }
    }

    function maybeCorrect(trigger) {
      if (!resumeLock || userInteracted || resumeTarget == null) return;
      if (corrections >= MAX_CORRECTIONS) {
        logWarning('[guard] max corrections reached -> unlock');
        resumeLock = false;
        resumeTarget = null;
        return;
      }

      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0 && resumeTarget > dur - 0.25) {
        logMessage('[guard] invalid duration detected, delaying resume...');
        return;
      }

      const diff = Math.abs(video.currentTime - resumeTarget);

      if (Date.now() > guardUntil) {
        resumeLock = false;
        resumeTarget = null;
        logMessage('[guard] guard expired near target -> unlock');
        return;
      }

      if (diff > EPS) {
        corrections += 1;
        logMessage(`[guard:${trigger}] correcting ${video.currentTime.toFixed(2)} -> ${resumeTarget}`);
        video.currentTime = resumeTarget;
        guardUntil = Date.now() + GUARD_MS;
        stableHits = 0;
      }
    }

    function observeStability() {
      if (!resumeLock || !resumeTarget) return;
      const now = Date.now();

      if (now - lastTU < 50) return; // ignore spammy bursts
      lastTU = now;

      const diff = Math.abs(video.currentTime - resumeTarget);
      if (diff <= EPS) {
        stableHits += 1;
        if (stableHits >= STABLE_HITS) {
          logMessage('[guard] stable near target; unlocking');
          resumeLock = false;
          resumeTarget = null;
        }
      } else stableHits = 0;
    }

    if (resumeTarget != null) {
      const resume = () => {
        applyResume();
        const unlockOnSeek = () => {
          resumeLock = true;
          guardUntil = Date.now() + GUARD_MS;
          video.removeEventListener('seeked', unlockOnSeek);
        };
        video.addEventListener('seeked', unlockOnSeek);
      };

      if (video.readyState >= 1) resume();
      else video.addEventListener('loadedmetadata', resume, { once: true });

      video.addEventListener('play', () => maybeCorrect('play'), { signal });
      video.addEventListener('playing', () => maybeCorrect('playing'), { signal });
      video.addEventListener('seeked', () => maybeCorrect('seeked'), { signal });
      video.addEventListener('timeupdate', () => { maybeCorrect('timeupdate'); observeStability(); }, { signal });
    }

    function handleStorageEvent(e) {
      if (e.key === STORAGE_KEY) {
        try {
          store = JSON.parse(e.newValue) || [];
        } catch (err) {
          store = [];
        }
      }
    }

    // Register the storage listener once for this video session using the per-video signal
    window.addEventListener('storage', handleStorageEvent, { signal });

    // --- Saving (blocked while resumeLock is true) ---
    let saveCount = 0;
    let lastWriteMs = 0;
    const WRITE_THROTTLE_MS = 5000; // Save max once every 5 real-time seconds

    function persistNow(reason = 'timeupdate', force = false) {
      key = getVideoKey();
      const t = video.currentTime - 3; // 3-second buffer to replay slightly before where it was left off
      if (t < NEAR_START) return;

      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0 && dur - t <= NEAR_END) return;

      const now = Date.now();

      // If not a forced save, enforce the real-time throttle
      if (!force && (now - lastWriteMs < WRITE_THROTTLE_MS)) {
        return;
      }

      const existing = store.find(e => e.url === key);
      if (existing) {
        existing.time = t;
        existing.saved = now;
      } else {
        store.push({ url: key, time: t, saved: now });
      }

      // Only cleanup occasionally to reduce array churn
      if (++saveCount % 20 === 0) {
        store = cleanupStore(store);
        saveCount = 0;
      }

      // Write synchronously
      saveStore(store);

      lastWriteMs = now;
      lastSavedTime = t;

      logMessage(`Progress saved (${reason})`);
    }

    video.addEventListener('timeupdate', () => {
        if (resumeLock || document.hidden) return; // Skip in background
        persistNow('timeupdate', false);
      }, { signal }
    );

    video.addEventListener('pause', () => { if (!resumeLock) persistNow('pause', true); }, { signal });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !resumeLock) persistNow('visibility', true); }, { signal });
    window.addEventListener('pagehide', () => { if (!resumeLock) persistNow('pagehide', true); }, { signal });
  }

  function droppedFrameRecovery(video, { signal }) {
    if (!video || typeof video.getVideoPlaybackQuality !== "function") return;

    let lastDropped = 0;
    let lastTotal = 0;
    let recovering = false;
    let cooldown = false;
    let recoveryTimer = null;

    const checkIntervalMs = 5000;
    const checkInterval = setInterval(() => {
      if (signal.aborted || document.hidden || video.paused) return; // Skip if hidden or paused

      const quality = video.getVideoPlaybackQuality();
      const droppedDelta = quality.droppedVideoFrames - lastDropped;
      const totalDelta = quality.totalVideoFrames - lastTotal;

      lastDropped = quality.droppedVideoFrames;
      lastTotal = quality.totalVideoFrames;

      if (totalDelta <= 0) return; // no frames since last check

      const dropRatio = droppedDelta / totalDelta;

      if (!recovering && !cooldown && dropRatio > 0.05 && !video.paused) {
        recovering = true;
        video.dataset.recovering = "true"
        cooldown = true;
        const originalRate = video.playbackRate;
        video.playbackRate = Math.max(0.8, originalRate * 0.95);
        logMessage(
          `Dropped frames detected (${(dropRatio * 100).toFixed(1)}%), temporary slowdown to ${video.playbackRate}`
        );

        recoveryTimer = setTimeout(() => {
          video.playbackRate = originalRate;
          recovering = false;
          video.dataset.recovering = "false"
          logMessage("Playback rate restored after recovery period");
        }, 5000);

        // start cooldown
        setTimeout(() => (cooldown = false), 15000);
      }
    }, checkIntervalMs);

    signal.addEventListener("abort", () => {
      clearInterval(checkInterval);
      clearTimeout(recoveryTimer);
    });
  }

  function autoLoopDetector(video, { signal }) {
    if (!video) return;

    let lastEndedAt = 0;
    let loopCount = 0;

    const onEnded = () => {
      lastEndedAt = performance.now();
    };

    const onPlay = () => {
      const sinceEnd = performance.now() - lastEndedAt;
      if (sinceEnd < 5000 && video.currentTime < 1) {
        loopCount++;
        video.dataset.loopCount = loopCount;
        logMessage(`Loop detected (total: ${loopCount})`);
      }
    };

    video.addEventListener("ended", onEnded, { signal });
    video.addEventListener("play", onPlay, { signal });

    signal.addEventListener("abort", () => {
      delete video.dataset.loopCount;
    });
  }

  function autoPauseOnInvisibility(video, { signal }) {
    if (!video) return;

    let wasAutoPaused = false;
    let wasPlayingBeforePause = false;
    let currentTimeBeforePause = 0;
    let originalSrc = null;
    let lastVisibilityState = document.visibilityState;

    // Keyboard shortcut: Ctrl + Shift + Q
    const keyboardHandler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        const nextState = autoPauseState === 'ON' ? 'OFF' : 'ON';
        dispatchAutoPauseState(nextState);
      }
    };
    document.addEventListener('keydown', keyboardHandler, { signal });

    // Polling for visibility changes
    const pollInterval = setInterval(() => {
      if (signal.aborted || autoPauseState === 'OFF') return;

      const currentState = document.visibilityState;
      if (currentState !== lastVisibilityState) {
        lastVisibilityState = currentState;
        logMessage("[autoPause] Visibility state changed to:", currentState);

        if (currentState === "visible") {
          const rect = video.getBoundingClientRect();
          const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
          const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
          const visibleArea = visibleHeight * visibleWidth;
          const elementArea = rect.width * rect.height;
          const isInViewport = elementArea > 0 && (visibleArea / elementArea) > 0.5;
          const isReasonablySized = rect.width > 160 && rect.height > 90;

          checkPauseResume(isInViewport && isReasonablySized);
        } else {
          checkPauseResume(false);
        }
      }
    }, 500);

    function checkPauseResume(isVisibleNow) {
      if (autoPauseState === 'OFF') {
        logMessage("[autoPause] Skipped check – auto-pause is disabled");
        return;
      }

      logMessage("[autoPause] checkPauseResume – isVisibleNow:", isVisibleNow, "paused:", video.paused);

      const rect = video.getBoundingClientRect();
      if (rect.width <= 160 || rect.height <= 90) return;

      if (!isVisibleNow && !video.paused && !video.ended) {
        wasPlayingBeforePause = true;
        currentTimeBeforePause = video.currentTime - 3;
        originalSrc = video.src || video.querySelector('source')?.src || video.currentSrc;
        video.pause();
        // video.removeAttribute('src');
        // video.load();
        logMessage("[autoPause] Paused (background/tab hidden)");
        wasAutoPaused = true;
      }
      else if (isVisibleNow && wasAutoPaused && wasPlayingBeforePause) {
        // if (originalSrc) {
        //   video.src = originalSrc;
        //   video.load();
        // }
        video.currentTime = currentTimeBeforePause;
        video.play().catch(e => logError("[autoPause] Play failed:", e));
        wasAutoPaused = false;
        wasPlayingBeforePause = false;
        logMessage("[autoPause] Resumed on visible");
      }
    }

    // Initial check
    setTimeout(() => {
      if (autoPauseState === 'ON') {
        const rect = video.getBoundingClientRect();
        const isReasonablySized = rect.width > 160 && rect.height > 90;
        checkPauseResume(document.visibilityState === "visible" && isReasonablySized);
      }
    }, 1000);

    // Cleanup
    signal.addEventListener("abort", () => {
      clearInterval(pollInterval);
    });
  }

  function cleanupDOM() {
    if (!ELEMENTS_MAP[siteKey]?.useless) return;
    const observer = new MutationObserver(() => {
      const target = getElement('useless', true);
      target.forEach(t => { if (t) t.remove() })
    });
    observer.observe(document.body, { childList: true, subtree: true });

    registerCleanup(() => safeDisconnect(observer));
  }

  function networkThrottlingWatchdog(video, { signal }) {
    if (!video) return;

    let lastBufferedEnd = 0;
    let lastCheck = performance.now();
    let stableDrops = 0;
    let throttleState = "Normal"; // or "Throttled"

    const checkIntervalMs = 3000;
    const LOW_RATE_THRESHOLD = 0.1; // buffer seconds per real second
    const LOW_RATE_STREAK = 3; // how many slow intervals before flagging

    function checkNetwork() {
      if (signal.aborted || document.hidden || video.paused) return setTimeout(checkNetwork, checkIntervalMs); // Skip and reschedule

      const now = performance.now();
      const elapsed = (now - lastCheck) / 1000; // sec
      lastCheck = now;

      const buf = video.buffered;
      const bufferedEnd = buf.length ? buf.end(buf.length - 1) : 0;
      const deltaBuffered = bufferedEnd - lastBufferedEnd;
      lastBufferedEnd = bufferedEnd;

      const rate = deltaBuffered / elapsed; // s buffered per real sec

      if (rate < LOW_RATE_THRESHOLD && !video.paused && !video.ended) {
        stableDrops++;
      } else {
        stableDrops = 0;
        if (throttleState !== "Normal") {
          throttleState = "Normal";
          video.dataset.throttleState = throttleState;
          logMessage(`[network] recovered, rate=${rate.toFixed(2)}x`);
        }
      }

      if (stableDrops >= LOW_RATE_STREAK && throttleState !== "Throttled") {
        throttleState = "Throttled";
        video.dataset.throttleState = throttleState;
        logMessage(`[network] throttling detected, rate=${rate.toFixed(2)}x`);
      }
    }

    video.dataset.throttleState = throttleState;
    const networkInterval = setInterval(checkNetwork, checkIntervalMs);
    checkNetwork(); // Initial call

    signal.addEventListener("abort", () => {
      clearInterval(networkInterval);
      video.dataset.throttleState = "";
    });
  }

  let enableHeatmap = GM_getValue('enableHeatmap', true);

  function toggleBufferHeatmap() {
    enableHeatmap = !enableHeatmap;
    GM_setValue('enableHeatmap', enableHeatmap);
    logMessage(`Buffer Heatmap: ${enableHeatmap ? 'Enabled' : 'Disabled'}`);
    GM_unregisterMenuCommand('toggleBufferHeatmap');
    registerBufferHeatmapToggle();
    if (video) loadScript(video);
  }

  function registerBufferHeatmapToggle() {
    GM_registerMenuCommand(`${enableHeatmap ? 'Disable' : 'Enable'} Buffer Heatmap`, () => toggleBufferHeatmap(), { id: 'toggleBufferHeatmap' });
  }

  registerBufferHeatmapToggle();

  function bufferHeatmapOverlay(video, { signal }) {
    if (!video || !enableHeatmap) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.style.position = "absolute";
    canvas.style.bottom = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "3px";
    canvas.style.pointerEvents = "none";
    canvas.style.opacity = "0.7";
    canvas.width = video.clientWidth;
    canvas.height = 3;

    const container = video.parentElement || document.body;
    container.appendChild(canvas);

    const rebuffers = [];

    video.addEventListener("waiting", () => {
      rebuffers.push(video.currentTime);
    }, { signal });

    let lastDraw = 0;
    const drawThrottleMs = 1000;
    let rafId = null;
    let isInView = false;

    function draw(now) {
      rafId = null;
      if (signal.aborted || document.hidden || video.paused || !isInView) return;

      if (now - lastDraw < drawThrottleMs) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      lastDraw = now;

      const duration = video.duration || 0;
      if (!duration) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw base line (unbuffered)
      ctx.fillStyle = "#444";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw buffered segments
      ctx.fillStyle = "#3b82f6"; // blue
      for (let i = 0; i < video.buffered.length; i++) {
        const startX = (video.buffered.start(i) / duration) * canvas.width;
        const endX = (video.buffered.end(i) / duration) * canvas.width;
        ctx.fillRect(startX, 0, endX - startX, canvas.height);
      }

      // Draw played segment
      ctx.fillStyle = "#22c55e"; // green
      const playedWidth = (video.currentTime / duration) * canvas.width;
      ctx.fillRect(0, 0, playedWidth, canvas.height);

      // Draw rebuffer marks
      ctx.fillStyle = "#ef4444"; // red
      rebuffers.forEach(time => {
        const x = (time / duration) * canvas.width;
        ctx.fillRect(x, 0, 1, canvas.height);
      });

      rafId = requestAnimationFrame(draw);
    }

    function startDraw() {
      if (!rafId) rafId = requestAnimationFrame(draw);
    }

    function stopDraw() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }

    // IntersectionObserver for visibility
    const io = new IntersectionObserver(entries => {
      isInView = entries[0].isIntersecting;
      if (isInView) startDraw();
      else stopDraw();
    });
    io.observe(canvas);

    startDraw(); // Initial

    signal.addEventListener("abort", () => {
      stopDraw();
      io.disconnect();
      canvas.remove();
    });
  }

  function trackVideoFPS(video, onUpdate = null, fallbackFPS = FALLBACK_FPS) {
    if (!video) throw new Error("No video element provided");

    const ctrl = new AbortController();
    const { signal } = ctrl;
    const state = { fps: 0, lastObserved: 0, maxObserved: 0 };
    const updateInterval = 500;
    let lastTime = performance.now();
    let lastFrames = 0;
    let lastUpdate = performance.now();
    const rollingValues = [];

    function setFPS(latest) {
      state.lastObserved = Math.round(latest);
      if (latest < 300) {
        rollingValues.push(latest);
        if (rollingValues.length > 20) rollingValues.shift();
        const avg = rollingValues.reduce((a, b) => a + b, 0) / rollingValues.length;
        state.fps = Math.round(avg);
      }
      state.maxObserved = Math.round(Math.max(state.maxObserved, latest));
      if (onUpdate) onUpdate(state);
    }

    function updateFromQuality() {
      const quality = video.getVideoPlaybackQuality?.();
      if (!quality) return false;
      const now = performance.now();
      if (now - lastUpdate < updateInterval) return true;
      const { totalVideoFrames } = quality;
      const deltaTime = (now - lastTime) / 1000;
      const frameDelta = totalVideoFrames - lastFrames;
      if (frameDelta > 0 && deltaTime > 0) {
        const currentFPS = frameDelta / deltaTime;
        if (currentFPS > 0 && currentFPS < 300) setFPS(currentFPS);
        lastFrames = totalVideoFrames;
        lastTime = now;
      }
      lastUpdate = now;
      return true;
    }

    function updateFromFrameCallback(now, metadata) {
      if (document.hidden || video.paused || video.ended) return video.requestVideoFrameCallback(updateFromFrameCallback); // Skip if hidden/paused
      if (!video.paused && !video.ended && metadata?.expectedDisplayTime) {
        const frameDuration = (metadata.expectedDisplayTime - now) / 1000;
        if (frameDuration > 0) {
          const estFPS = 1 / frameDuration;
          if (estFPS > 0 && estFPS < 300) setFPS(estFPS);
        }
      }
      if (!signal.aborted) {
        video.requestVideoFrameCallback(updateFromFrameCallback);
      }
    }

    let rafId = null;
    function loop(now) {
      if (signal.aborted) return;
      if (!video.isConnected) { ctrl.abort(); rafId = null; return; }
      if (!document.hidden && video.isConnected && !video.paused && !video.ended) {
        const success = updateFromQuality();
        if (!success) {
          if (state.lastObserved > 0) setFPS(state.lastObserved);
          else setFPS(fallbackFPS);
        }
      } else {
        if (state.lastObserved === 0) setFPS(fallbackFPS);
      }
      rafId = requestAnimationFrame(loop);
    }

    function startLoop() { if (!rafId && !signal.aborted) rafId = requestAnimationFrame(loop); }
    function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

    video.addEventListener('play', startLoop, { signal });
    video.addEventListener('pause', stopLoop, { signal });
    video.addEventListener('ended', stopLoop, { signal });
    document.addEventListener('visibilitychange', () => document.hidden ? stopLoop() : startLoop(), { signal });
    signal.addEventListener('abort', stopLoop);

    if (!video.paused && !video.ended) startLoop();
    else if (state.lastObserved === 0) setFPS(fallbackFPS);

    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback(updateFromFrameCallback);
    }

    registerCleanup(() => ctrl.abort());

    return { state, stop: () => ctrl.abort() };
  }

  function isVisible(el) {
    if (!el) return false;

    // Walk up ancestors
    let node = el;
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  let enableStats = GM_getValue('enableStats', false);

  function toggleStatsOverlay() {
    enableStats = !enableStats;
    GM_setValue('enableStats', enableStats);
    logMessage(`Stats Overlay: ${enableStats ? 'Enabled' : 'Disabled'}`);
    GM_unregisterMenuCommand('toggleStatsOverlay');
    registerStatsOverlayToggle();
    if (video) loadScript(video);
  }

  function registerStatsOverlayToggle() {
    GM_registerMenuCommand(`${enableStats ? 'Disable' : 'Enable'} Stats Overlay`, () => toggleStatsOverlay(), { id: 'toggleStatsOverlay' });
  }

  registerStatsOverlayToggle();

  function statsOverlay(video, { signal }) {
    if (!video || !enableStats) return;

    let lastDropPct = 0;
    const overlay = createHTMLElement('div', {
      id: 'vc-stats-overlay',
      style: {
        position: 'absolute', top: 0, left: 0,
        background: 'rgba(0,0,0,0.75)', color: '#fff',
        font: '11px/1.4 monospace', padding: '6px 8px',
        borderRadius: '0 0 10px 0', zIndex: 9999,
        width: '36px', height: '36px',
        opacity: 0, transition: 'all .25s',
        pointerEvents: 'auto',
        overflow: 'hidden', whiteSpace: 'pre'
      }
    });

    const player = getElement('player') || document.body;
    if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
    player.appendChild(overlay);

    const hideIfMini = () => {
      const mini = getElement('miniPlayer');
      const inMini = isYoutube && mini && isVisible(mini);
      overlay.style.display = inMini ? 'none' : 'block';
    };
    hideIfMini();

    const mo = new MutationObserver(hideIfMini);
    mo.observe(player || document.body, { childList: true, subtree: true });

    let hideTimer = null;
    let isExpanded = false;

    overlay.innerHTML = '<span id="vc-stats-text"></span><span id="vc-stats-interactive">Auto-Pause: <span id="autoPauseToggle" style="cursor:pointer; text-decoration:underline;"></span>\nAutoplay: <span id="autoplayToggle" style="cursor:pointer; text-decoration:underline;"></span></span>';

    const textNode = overlay.querySelector('#vc-stats-text');
    const autoPauseSpan = overlay.querySelector('#autoPauseToggle');
    const playSpan = overlay.querySelector('#autoplayToggle');

    autoPauseSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextState = autoPauseState === 'ON' ? 'OFF' : 'ON';
      dispatchAutoPauseState(nextState);
    });

    playSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      const newEnabled = !isAutoplayEnabled;
      dispatchAutoplayToggle(newEnabled);
    });

    const expand = () => {
      clearTimeout(hideTimer);
      overlay.style.width = '';
      overlay.style.height = '';
      overlay.style.opacity = '1';
      isExpanded = true;
      update(true);
    };

    const shrink = () => {
      hideTimer = setTimeout(() => {
        overlay.style.opacity = '0';
        isExpanded = false;
        setTimeout(() => {
          if (!isExpanded) {
            overlay.style.width = '36px';
            overlay.style.height = '36px';
          }
        }, 250);
      }, 1200);
    };

    overlay.addEventListener('mouseenter', expand, { passive: true });
    overlay.addEventListener('mouseleave', shrink, { passive: true });

    const fmt = t => {
      if (!isFinite(t)) return '--:--';
      const h = t / 3600 | 0;
      const m = (t / 60 | 0) % 60;
      const s = (t % 60 | 0).toString().padStart(2, '0');

      return h > 0
        ? `${h}:${m.toString().padStart(2, '0')}:${s}`
        : `${m}:${s}`;
    };

    let last = {};
    let lastUpdateTime = 0;
    const updateThrottleMs = 1000;

    const update = (force = false) => {
      if (!isExpanded && !force) return;

      const now = performance.now();
      if (!force && now - lastUpdateTime < updateThrottleMs) return;
      lastUpdateTime = now;

      const q = video.getVideoPlaybackQuality?.() || {};
      const bufEnd = video.buffered.length ? video.buffered.end(video.buffered.length-1) : 0;
      const ahead = Math.max(0, bufEnd - video.currentTime);

      let dropped = 0, corrupted = 0, dropPct = "0.00";

      if (q && q.totalVideoFrames > 0) {
        const { droppedVideoFrames, totalVideoFrames, corruptedVideoFrames } = q;
        dropPct = ((droppedVideoFrames / totalVideoFrames) * 100).toFixed(2);
        if (Math.abs(dropPct - lastDropPct) > 1) {
          logMessage(`[quality] dropped frames now ${dropPct}%`);
          lastDropPct = dropPct;
        }
        corrupted = corruptedVideoFrames;
      }

      const cur = {
        time: fmt(video.currentTime),
        dur:  fmt(video.duration),
        left: fmt(video.duration - video.currentTime),
        fps:  fpsTracker.fps,
        fpsMax: fpsTracker.maxObserved,
        res:  `${video.videoWidth}x${video.videoHeight}`,
        disp: `${video.clientWidth}x${video.clientHeight}`,
        rate: video.playbackRate.toFixed(2),
        vol:  (video.volume*100|0),
        drop: `${dropped} (${dropPct}%)  Corrupted: ${corrupted}`,
        buf:  ahead|0,
        net:  ['EMPTY','IDLE','LOADING','NO_SRC'][video.networkState] || video.networkState,
        ready:['NOTHING','META','CUR','FUTURE','ENOUGH'][video.readyState] || video.readyState,
        loop: video.dataset.loopCount || '0',
        thr:  video.dataset.throttleState || "Normal",
        autoPause: autoPauseState,
        autoplay: isAutoplayEnabled ? 'ON' : 'OFF'
      };

      if (Object.keys(cur).some(k => cur[k] !== last[k])) {
        last = cur;

        // Populate text directly to text node, preserving your formatting
        textNode.textContent =
          `${cur.time} / ${cur.dur} (-${cur.left})\n` +
          `FPS: ${cur.fps} (max: ${cur.fpsMax}) ${video.dataset.recovering === "true" ? '⚠️' : ''}\n` +
          `Resolution: ${cur.res} (source) → ${cur.disp} (display)\n` +
          `Playback: ${cur.rate}x\n` +
          `Volume: ${cur.vol}%\n` +
          `Dropped: ${cur.drop}\n` +
          `Buffered: ${cur.buf}s ahead\n` +
          `Net State: ${cur.net}  Ready: ${cur.ready}\n` +
          `Loops: ${cur.loop}\n` +
          `Throttle: ${cur.thr}\n`;

        autoPauseSpan.textContent = cur.autoPause;
        if (cur.autoPause === 'ON') autoPauseSpan.style.color = '#0f0'; // Green
        else if (cur.autoPause === 'PIP') autoPauseSpan.style.color = '#0ff'; // Cyan
        else autoPauseSpan.style.color = '#f66'; // Red

        playSpan.textContent = cur.autoplay;
        playSpan.style.color = isAutoplayEnabled ? '#0f0' : '#f66';
      }
    };

    const ctrl = new AbortController();
    video.addEventListener('timeupdate', () => update(), {signal: ctrl.signal});
    video.addEventListener('loadedmetadata', () => update(true), {signal: ctrl.signal});
    video.addEventListener('ratechange', () => update(true), {signal: ctrl.signal});
    video.addEventListener('volumechange', () => update(true), {signal: ctrl.signal});

    update(true);

    document.addEventListener('autoPauseStateChange', (e) => update(true), { signal });
    document.addEventListener('autoplayToggle', (e) => update(true), { signal });

    signal.addEventListener('abort', () => {
      safeClear(hideTimer);
      safeDisconnect(mo);
      overlay.remove();
      safeAbort(ctrl);
    });
  }

  function setupAutoplay(video, { signal }) {
    if (!video) return;

    const handleEnded = () => {
      if (!isAutoplayEnabled) {
        logMessage('[autoplay] Disabled – skipping next episode');
        return;
      }

      logMessage('[autoplay] Video ended → playing next episode');
      nextVideo();
    };

    video.addEventListener('ended', handleEnded, { signal });

    const checkNearEnd = () => {
      if (
        isAutoplayEnabled &&
        !video.paused &&
        !video.ended &&
        video.duration &&
        video.currentTime >= video.duration - 1.5
      ) {
        logMessage('[autoplay] Near end detected → triggering next');
        nextVideo();
      }
    };

    video.addEventListener('timeupdate', checkNearEnd, { signal });
  }

  function registerFeatures(video, ...features) {
    const ctrl = new AbortController();
    const { signal } = ctrl;

    features.forEach(fn => fn(video, { signal }));

    const obs = new MutationObserver(() => {
      if (!video.isConnected) ctrl.abort();
    });
    const player = getElement('player');
    obs.observe(player || document.body, { childList: true, subtree: true });
    signal.addEventListener('abort', () => obs.disconnect());

    registerCleanup(() => safeAbort(ctrl));
    return ctrl;
  }

  let currentVideo = null;
  function loadScript(v) {
    cleanupDOM()
    if (!v) return;

    const duration = v.duration;
    const metadataTime = v.currentTime;

    if (!v.__videoState) {
      v.__videoState = {
        lastDuration: duration,
        lastMetadataTime: metadataTime
      };
    }

    const state = v.__videoState;

    const isSameElement = (v === currentVideo);

    const durationChanged =
      typeof duration === "number" &&
      typeof state.lastDuration === "number" &&
      duration !== state.lastDuration;

    const metadataChanged =
      typeof metadataTime === "number" &&
      typeof state.lastMetadataTime === "number" &&
      metadataTime !== state.lastMetadataTime;

    const shouldReload =
      !isSameElement ||
      durationChanged ||
      metadataChanged;

    if (!shouldReload) {
      return;
    }

    safeAbort(activeVideoCtrl);
    currentVideo = v;
    video = v;

    const features = [
      smartResume,
      autoLoopDetector,
      autoPauseOnInvisibility,
      networkThrottlingWatchdog,
      setupAutoplay
    ];

    // if (enableHeatmap) features.push(bufferHeatmapOverlay);
    if (enableStats) features.push(statsOverlay);

    const needsFPS = enableStats || false;
    if (fpsTracker) fpsTracker = null;
    if (needsFPS) {
      const fpsTrackerObj = trackVideoFPS(v, state => {
        logDebug(`FPS: ${state.fps}`);
      });
      fpsTracker = fpsTrackerObj.state;
      features.push(droppedFrameRecovery);
    }

    activeVideoCtrl = registerFeatures(v, ...features);

    state.lastDuration = duration;
    state.lastMetadataTime = metadataTime;

    if (!v.__videoHooksInstalled) {
      v.__videoHooksInstalled = true;

      v.addEventListener("loadedmetadata", () => loadScript(v));
      v.addEventListener("durationchange", () => loadScript(v));
    }
  }

  let videoObserver = null;
  function observeForVideo(onFound) {
    let debounceTimer = null;

    const obs = new MutationObserver(mutations => {
      let candidate = null;

      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          const v =
            node.matches?.("video") ? node :
            node.querySelector?.("video");

          if (v) candidate = v;
        }
      }

      if (!candidate) {
        const existing = getElement("video");
        if (!existing) return;

        if (existing !== currentVideo) {
          candidate = existing;
        }
      }

      if (!candidate) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onFound(candidate);
      }, 50);
    });

    videoObserver = obs;
    obs.observe(document.body, { childList: true, subtree: true });
    registerCleanup(() => safeDisconnect(obs));
  }

  function initScript() {
    const first = getElement('video');
    if (first) {
      setTimeout(() => loadScript(first), 500);
    }

    if (videoObserver) return;
    observeForVideo(v => {
      logMessage('[VideoUtils] Video element changed, reinitializing script…', v);
      loadScript(v);
    });
  }

  window.addEventListener("load", () => waitForVideo(() => initScript()), { once: true });
  window.addEventListener("beforeunload", runCleanup);
  window.addEventListener("pageshow", (e) => { if (e.persisted) waitForVideo(() => initScript()) }); // Only on bfcache restore
})();