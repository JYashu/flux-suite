// ==UserScript==
// @name         Flux-Video-Controls
// @namespace    https://github.com/JYashu/flux-suite
// @version      1.4.3
// @description  Enhance your streaming experience. Adds an advanced video toolbox, custom AudioContext equalizers, and gesture controls.
// @icon         https://logo-bits.s3.us-east-2.amazonaws.com/video-controls.png
// @icon         https://logo-bits.s3.us-east-2.amazonaws.com/video-controls-1.png
// @author       JYashu
// @license      Apache-2.0
// @match        *://*.udemy.com/*
// @match        *://*.youtube.com/*
// @match        *://*.sonyliv.com/*
// @exclude      *://accounts.youtube.com/*
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @grant        GM_registerMenuCommand
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

  const { showNotification, createLogger, createHTMLElement, makeElementDragAndResize } = FluxKit.utils;

  const { logMessage, logError, logWarning, logDebug } = createLogger('VideoControls');

  const STORAGE_KEY = 'video_control_config';

  const DEFAULT_AUDIO_STATE = {
    active: false,
    gains: [0, 0, 0, 0, 0, 0, 0, 0],
    preset: "Flat (Default)",
    focusModeUrl: "https://video-controls.s3.us-east-2.amazonaws.com/white-noise/waves.mp3",
    monoMixMode: "Off",
    compressorEnabled: false,
    compressor: {
        threshold: -24,
        ratio: 12,
        knee: 30,
        attack: 0.003,
        release: 0.25
    },
    highPassFreq: 0,
    volumeBoostEnabled: false,
    volumeBoostGain: 1,
    panner: 0,
    voiceIsolationActive: false
  }

  const DEFAULT_CONFIG = {
    logging: false,
    downloadPreference: 2,
    mouseControls: true,
    invertWheelDirection: false,
    stickyVideoEnabled: false,
    modeIndex: 0,
    audioState: { ...DEFAULT_AUDIO_STATE },
  };

  let config = initializeConfig();
  window.VideoControls = config;

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
      playerControlsList: ['.shaka-control-bar--control-bar-container--OfnMI', '.next-and-previous--previous--dBI5b', '.next-and-previous--next--8Avih'],
      progressBar: 'div.progress-bar--progress-bar-control--vhyIz',
      nextBtn: '#go-to-next-item',
      prevBtn: '#go-to-previous-item',
      rightControls: 'div.shaka-control-bar--control-bar--gXZ1u',
      ignoreMouseEventList: 'div.shaka-control-bar--popover-area--p01Ag',
      transcript: '[data-purpose="transcript-toggle"]',
      progressSlider: '.progress-bar--slider--z064U',
      playBtn: '[data-purpose="play-button"]',
      pauseBtn: '[data-purpose="pause-button"]',
    },
    youtube: {
      video: 'video.html5-main-video',
      player: 'div.html5-video-player#movie_player',
      playerControlsList: ['.ytp-ce-element', '.ytp-chrome-top', '.ytp-chrome-bottom', '.ytp-gradient-bottom', '.branding-img-container'],
      progressBar: '.ytp-progress-bar',
      nextBtn: '.ytp-next-button',
      prevBtn: '.ytp-prev-button',
      rightControls: '.ytp-right-controls',
      transcript: ['button[aria-label*="transcript"]', 'tp-yt-paper-button[aria-label*="Transcript"]'],
      playerEl: () => document.querySelector('ytd-player')?.player_,
      miniPlayer: 'ytd-miniplayer',
    },
    sonyliv: {
      video: 'video#main_video_player_htmlPlayer5_html5_api',
      player: '#dynamicPlayer',
      playerControlsList: ['.player-footer', '.player-header', '.ReactStickyHeader_fixed', '.player-header__backdrop', '.player-footer__backdrop', '.carouselWrapper'],
      progressBar: '.seekbar-wrapper ',
      nextBtn: '.next-asset-icon',
      rightControls: '.player-footer__right-controls',
      ignoreMouseEventList: '.player-ui-main-wrapper',
      progressSlider: '.seekbar',
      skipBtn: '.skip-button',
    },
    default: {
      video: 'video',
      player: () => getPlayerRoot(getElement('video')),
      playerControlsList: ['.controls', '.control-bar', '.player-controls', '.html5-video-controls', '.vjs-control-bar'],
      progressBar: ['.progress-bar', '.seekbar', '.plyr__progress', '.ytp-progress-bar'],
      rightControls: ['.controls', '.control-bar', '.vjs-control-bar', '.ytp-right-controls'],
      transcript: ['[aria-label*="Transcript"]', 'button[title*="Transcript"]'],
      nextBtn: ['.next-button', '#nextEP'],
      prevBtn: ['.prev-button', '#prevEP'],
      ignoreMouseEventList: ['.overlay', '.ad-container']
    }
  };

  const GENERIC_PLAYER_SELECTORS = [
    '.plyr', '.jwplayer', '.video-js', '.vjs-player',
    '.shaka-video-container', '#movie_player', '.html5-video-player'
  ];

  const siteKey = (() => {
    let hostname = window.location.hostname.replace(/^www\./, '');
    const key = ELEMENTS_MAP[hostname.split('.')[0]] ? hostname.split('.')[0] : 'default';
    logMessage('SiteKey identified:', key);
    return key;
  })();

  const isYoutube = siteKey === 'youtube';
  const requireVideoElement = false; // Somesite need to pass video element instead of player as target root, configure them here.

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

  function getElementSelector(key) {
    const siteConfig = ELEMENTS_MAP[siteKey] || {};
    const defaultConfig = ELEMENTS_MAP.default || {};
    const value = siteConfig[key] ?? defaultConfig[key];
    if (!value) return '';

    const selector = key.endsWith('List') ? value.join(', ') : value;
    return selector;
  }

  function getPlayerRoot(video) {
    if (!video) video = document.querySelector("video");
    if (!video) return null;

    const known = video.closest(GENERIC_PLAYER_SELECTORS.join(','));
    if (known) return known;

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

  function initializeConfig() {
    try {
      const saved = GM_getValue(STORAGE_KEY);
      if (!saved) {
        logMessage('No config found, initializing default');
        GM_setValue(STORAGE_KEY, DEFAULT_CONFIG);
        return { ...DEFAULT_CONFIG };
      }
      return { ...DEFAULT_CONFIG, ...saved };
    } catch (e) {
      logError('Failed to read config, falling back to default:', e);
      GM_setValue(STORAGE_KEY, DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }
  }

  function persistConfig(newConfig) {
    try {
      config = { ...config, ...newConfig };
      window.VideoControls = config;
      GM_setValue(STORAGE_KEY, config);
      logMessage('Config persisted:', config);
    } catch (e) { logError('Failed to save config: ', e, { __v: 1 }); }
  }

  const SEEK_LARGE = 30;
  const SEEK_SMALL = 5;
  const SPEED_STEP = 0.25;
  const VOLUME_STEP_LARGE = 0.05;
  const VOLUME_STEP = 0.01;
  const BRIGHTNESS_STEP = 0.05;
  const GIF_DEFAULT_DURATION = 3;
  const GIF_DURATION_MAX = 10;
  const GIF_MAX_FPS = 15;
  const FALLBACK_FPS = 30;

  const LONG_CLICK_DURATION = 500;
  const SINGLE_CLICK_DELAY = 250;
  const CONTINUOUS_CLICK_DELAY = 800;

  const EQ_FREQUENCIES = [32, 64, 250, 500, 1000, 4000, 8000, 16000];
  const EQ_TITLES = [
    'Sub-bass',
    'Bass',
    'Low Mid',
    'Mid-low',
    'Mid',
    'High Mid',
    'Treble',
    'Air',
  ];
  const EQ_LABELS = [
    '32 Hz',
    '64 Hz',
    '250 Hz',
    '500 Hz',
    '1 kHz',
    '4 KHz',
    '8 kHz',
    '16 kHz',
  ];
  const EQ_PRESETS = {
    'Flat (Default)': [0, 0, 0, 0, 0, 0, 0, 0],

    // Music & Entertainment
    'Bass Boost': [8, 7, 4, 1, 0, -1, -3, -4],
    'Treble Boost': [-4, -2, 0, 1, 5, 7, 9, 7],
    'Vocal Clarity': [-2, -1, 1, 5, 8, 10, 7, 3],
    'Movies (Bass + Treble)': [7, 5, 1, 0, 2, 6, 8, 6],
    'Music (General)': [3, 5, 1, 0, 2, 4, 6, 4],
    'Concert': [5, 7, 3, 0, 4, 8, 10, 6],

    // Spoken content
    'Speech / Podcasts': [-6, -5, -1, 6, 9, 11, 7, -1],

    // Utility
    'Amplifier (Max Loudness)': [7, 9, 10, 10, 10, 9, 8, 7],
    'Night Mode': [6, 5, 1, -1, -3, -6, -8, -10],
  };
  const MONO_MIX_MODES = ['Off', 'Both', 'Left Only', 'Right Only'];

  const PLAYER_CONTROL_MODES = ['Default','Default w/ Bar','Bar','Persist Bar','Persist Default']

  // -------- Video State --------
  const cleanupRegistry = [];
  const initializedVideos = new WeakSet();
  const modifierState = { shift: false, alt: false, ctrl: false };
  let video;
  let keyboardCtrl;
  let togglePlayFired = false;
  let playerVol = parseFloat(localStorage.getItem('vc_playerVol') || 1); // 0..100 - for youtube
  let videoVol = parseFloat(localStorage.getItem('vc_videoVol') || 1); // 0..1
  let skipIntroDuration = parseFloat(localStorage.getItem('vc_skipIntroDuration') || 65); // 0..1
  let videoFilterState = { brightness: 1, contrast: 1, saturation: 1 }
  let videoTransformState = { scale: 1, originX: 0, originY: 0, rotation: 0, flipH: false, flipV: false };
  let volumeMode = null; // 'linear' | 'log' | null - for youtube
  let detachStick = null; // cleanup for sticky enforcement
  let capturingGif = false;
  let zoomPanCtrl = null;
  let loopStart = null, loopEnd = null, loopActive = false;
  let prevPlaybackRate = 1;
  let slowMoActive = false;

  // -------- Equalizer State --------
  let eqDisabled = false;
  let audioState = {
    eqWarned: false,
    ctx: null,
    source: null,
    filters: [],
    voiceIsolation: null,
    ui: null,
    voiceIsolationActive: false,
    compressorEnabled: false,
    monoMixEnabled: false,
    ...config.audioState,
  };

  // -------- Mouse Listeners State --------
  let clickTimeout = null;
  let clickHandled = false;
  let longClickTimer = null;
  let continuousStartTimer = null;
  let continuousCleanup = null;
  let undoLongClick = null;
  let hasStylesAttached = false;
  let lastKnownRect = null;

  let customProgressBar = null;

  function registerCleanup(fn) {
    cleanupRegistry.push(fn);
  }

  function runCleanup() {
    cleanupRegistry.forEach(fn => {
      try { fn(); } catch (e) { logWarning('cleanup error', e); }
    });
    cleanupRegistry.length = 0;
  }

  function showEqWarning() {
    if (audioState.eqWarned) return;
    audioState.eqWarned = true;
    showNotification("EQ unavailable: external video source");
  }

  registerCleanup(() => GLOBAL_CTRL.abort());

  function persistAudioSettings(config, audioState) {
    const saveState = {
      gains: [...audioState.gains],
      preset: audioState.preset,
      active: audioState.preset !== 'Flat (Default)',
      monoMixMode: audioState.monoMixMode || 'Off',
      compressorEnabled: audioState.compressorEnabled,
      compressor: {
        threshold: audioState.compressor.threshold.value,
        ratio: audioState.compressor.ratio.value,
        knee: audioState.compressor.knee.value,
        attack: audioState.compressor.attack.value,
        release: audioState.compressor.release.value,
      },
      highPassEnabled: audioState.highPassEnabled,
      highPassFreq: audioState.highPassFreq !== null ? audioState.highPassFreq : audioState.highPass.frequency.value,
      volumeBoostEnabled: audioState.volumeBoostEnabled || false,
      volumeBoostGain: audioState.volumeBoost ? audioState.volumeBoost.gain.value : 1,
      pannerEnabled: audioState.pannerEnabled,
      panner: audioState.panner ? audioState.panner.pan.value : 0,
      voiceIsolationActive: audioState.voiceIsolationActive || false,
      focusModeUrl: audioState.focusModeUrl,
    };

    persistConfig({ ...config, audioState: { ...config.audioState, ...saveState } });
  }

  GM_addValueChangeListener(STORAGE_KEY, (key, oldValue, newValue, remote) => {
    if (remote) {
      config = { ...config, ...newValue };
      window.VideoControls = config;
      logMessage('🔄 Config updated from another tab or site:', config);
      initMouseControls();
      const settingsModal = document.getElementById('vc-settings-modal');
      if (settingsModal) showSettingsModal(true);
    }
  });

  GM_registerMenuCommand('Reload Script', () => {
    const video = getElement('video');
    if (video) loadScript(video)
  });

  // ----------------------------------
  // UI Elements + CSS
  // ----------------------------------
  const cssUtil =
    `.vc-modal, .vc-modal * , #vc-equalizer-ui, #vc-equalizer-ui * { box-sizing: border-box; font-family: sans-serif; font-size: 14px; color: inherit; }.vc-ui, .vc-ui * { box-sizing: border-box !important; font-family: Arial, Helvetica, sans-serif !important; line-height: 1.4 !important; } .vc-modal-overlay, #vc-equalizer-ui, .vc-enhanced-toolbox { z-index: 2147483647 !important; } .vc-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee; height: 40px; transition: opacity 0.3s ease, max-height 0.3s ease; } .vc-row.hidden { opacity: 0; max-height: 0; padding: 0; overflow: hidden; } .vc-label { flex: 1; font-size: 13px; text-align: left; } .has-no-border { border-bottom: none !important; } /* Modern toggle switch */ .switch { position: relative; display: inline-block; width: 46px; height: 24px; } .switch input { opacity: 0; width: 0; height: 0; } .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .3s; border-radius: 34px; } .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; }
    input:checked + .slider { background-color: #0af; } input:checked + .slider:before { transform: translateX(22px); } .switch input:focus-visible + .slider { box-shadow: 0 0 0 3px rgba(0, 170, 255, 0.6); } .switch input:focus:not(:focus-visible) + .slider { box-shadow: none; } /* Hide scrollbar */ .hide-scroll-bar { scrollbar-width: none; -ms-overflow-style: none; } .hide-scroll-bar::-webkit-scrollbar { display: none; } .edge-scroll-cue { position: relative; flex: 1 1 auto; margin-bottom: 15px; overflow: hidden; max-height: 100%; display: flex; } .edge-scroll-cue::before, .edge-scroll-cue::after { content: ""; position: absolute; left: 0; right: 0; height: 32px; pointer-events: none; z-index: 2; opacity: 1; will-change: opacity; } .edge-scroll-cue.hide-top::before { opacity: 0; } .edge-scroll-cue.hide-bottom::after { opacity: 0; } .edge-scroll-cue::before { top: 0; background: linear-gradient(to bottom, rgba(255,255,255,1), rgba(255,255,255,0)); } .edge-scroll-cue::after { bottom: 0; background: linear-gradient(to top, rgba(255,255,255,1), rgba(255,255,255,0)); } .vc-hide { opacity: 0 !important; visibility: hidden !important; display: none !important; pointer-events: none !important; } .vc-show { opacity: 1 !important; visibility: visible !important; display: ""; pointer-events: auto !important; }`;

  const modalCss =
    `.vc-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 99999; animation: fadeIn 0.2s ease-out; width: 100vw; height: 100vh; } @keyframes fadeIn { from {opacity: 0;} to {opacity: 1;} } .vc-modal { background: #fff; border-radius: 12px; padding: 20px 24px; min-width: 450px; max-width: 50vw; min-height: 236px; max-height: 70vh; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.2); font-family: sans-serif; color: #111; animation: slideIn 0.25s ease-out; } @keyframes slideIn { from {transform: translateY(-10px); opacity:0;} to {transform: translateY(0); opacity: 1;} } .vc-modal-header { flex: 0 0 auto; font-size: 18px; font-weight: bold; margin-bottom: 15px; }
    .vc-modal-content { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; max-height: inherit; padding-right: 4px; } .vc-modal-footer { flex: 0 0 auto; display: flex; justify-content: end; gap: 8px; text-align: right; margin-top: 15px; } .vc-modal-btn { background: #3ea6ff; color: white; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 14px; transition: background 0.2s; } .vc-modal-btn:hover { background: #2196f3; } .vc-modal-input { border-radius: 4px; border: 1px solid; height: 24px; width: 124px; } .vc-modal-select { color: black !important; background: white !important; appearance: auto !important; -webkit-appearance: auto !important; display: inline-block !important; width: 124px; height: 24px; border-radius: 4px; }`;

  const equalizerCss =
    '.eq-slider { -webkit-appearance: none; appearance: none; background: transparent; width: 80px; transform: rotate(-90deg); margin-top: 46px; } .eq-slider.horizontal { transform: none; width: 60%; margin-top: 0; } /* Chrome, Edge, Safari */ .eq-slider::-webkit-slider-runnable-track { position: relative; height: 1px; background: linear-gradient(var(--filled-color, #0af), var(--filled-color, #0af)) 0/ var(--val, 50%) 8px no-repeat, /* filled part (thicker) */ linear-gradient(var(--empty-color, #666), var(--empty-color, #666)) 0/ 100% 1px no-repeat; /* base thin line */ } .eq-slider.horizontal::-webkit-slider-runnable-track { height: 8px; border-radius: 4px } .eq-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 12px; background: white; border: 1px solid #999; border-radius: 50%; cursor: pointer; margin-top: -6px; } .eq-slider.horizontal::-webkit-slider-thumb { margin-top: -2px; } /* Firefox */ .eq-slider::-moz-range-track { height: 1px; background: linear-gradient(var(--filled-color, #0af), var(--filled-color, #0af)) 0/ var(--val, 50%) 8px no-repeat, linear-gradient(var(--empty-color, #666), var(--empty-color, #666)) 0/ 100% 1px no-repeat; } .eq-slider.horizontal::-moz-range-track { height: 8px; } .eq-slider::-moz-range-progress { background-color: var(--filled-color, #0af); height: 8px; }';

  const toolBoxCss =
    '.vc-enhanced-toolbox { position: absolute; background: #111; color: white; border-radius: 8px; padding: 10px; box-shadow: 0 0 6px rgba(0,0,0,0.4); display: none; z-index: 1000000; } .vc-enhanced-toolbox-grid { display: flex; flex-wrap: wrap; gap: 6px; width: 122px; } .vc-enhanced-btn { width: 26px; height: 26px; border-radius: 4px; background: #eee; display: flex; align-items: center; justify-content: center; cursor: pointer; }';

  const animationsCss = '#vc-overlay-stack { position:absolute; inset:0; pointer-events:none; z-index:9999; } @keyframes vc-loop-pulse { 0%   { background: rgba(100, 91, 91, 0.65); } 50%  { background: rgba(100, 91, 91, 0.95); } 100% { background: rgba(100, 91, 91, 0.65); }} @keyframes vcCircleNudgeRight {0%   { transform: translate(-50%, -50%) translateX(0) scale(1,1); }20%  { transform: translate(-50%, -50%) translateX(10px) scale(1.15,0.85); }40%  { transform: translate(-50%, -50%) translateX(0) scale(1,1); }60%  { transform: translate(-50%, -50%) translateX(6px) scale(1.08,0.92); }100% { transform: translate(-50%, -50%) translateX(0) scale(1,1); }}@keyframes vcCircleNudgeLeft {0%   { transform: translate(-50%, -50%) translateX(0) scale(1,1); }20%  { transform: translate(-50%, -50%) translateX(-10px) scale(1.15,0.85); }40%  { transform: translate(-50%, -50%) translateX(0) scale(1,1); }60%  { transform: translate(-50%, -50%) translateX(-6px) scale(1.08,0.92); }100% { transform: translate(-50%, -50%) translateX(0) scale(1,1); }}@keyframes stampIn {0%   { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }15%  { transform: translate(-50%, -50%) scale(0.9); opacity: 1; }25%  { transform: translate(-50%, -50%) scale(1); opacity: 1; }40%  { transform: translate(-50%, -50%) scale(1); opacity: 1; }100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }}#vc-overlay-icon {line-height: 0;}#vc-overlay-icon svg {display: block;}';

  function loadCssStyles() {
    if (!hasStylesAttached) {
      hasStylesAttached = true;
      GM_addStyle(cssUtil); GM_addStyle(equalizerCss); GM_addStyle(modalCss); GM_addStyle(toolBoxCss); GM_addStyle(animationsCss);
    }
  }

  function createToggleRow(labelText, initialState, onChange, hasBorder = true) {
    return createHTMLElement('div', {
      class: `vc-row${hasBorder ? '' : ' has-no-border'}`,
      children: [
        createHTMLElement('div', { class: 'vc-label', textContent: labelText }),
        createHTMLElement('label', { class: 'switch', children: [
          createHTMLElement('input', { class: 'switch', type: 'checkbox', checked: initialState, eventListener: { change: e => onChange(e.target.checked) }}),
          createHTMLElement('span', { class: 'slider' })
        ]})
      ]
    });
  }

  function createSliderRow(labelText, value, min, max, step, onChange, hasBorder = true) {
    const slider = createHTMLElement('input', {
      class: 'eq-slider horizontal',
      type: 'range', min, max, step, value,
      eventListener: {
        input: e => {
          onChange(parseFloat(e.target.value));
          updateSliderFill(e.target);
          persistAudioSettings(config, audioState);
        }
      }
    });
    updateSliderFill(slider);
    return createHTMLElement('div', {
      class: `vc-row${hasBorder ? '' : ' has-no-border'}`,
      children: [
        createHTMLElement('label', { class: 'vc-label', textContent: labelText }),
        slider
      ]
    });
  }

  function updateSliderFill(slider) {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = ((slider.value - min) / (max - min)) * 100;
    slider.style.setProperty('--val', `${val < 50 ? val + 2 : val - 2}%`);
  }

  function createToggleSliderPair({ toggleParams, sliderParams, uiRefreshTimeout = null }) {
    const { label: toggleLabel, key: toggleKey } = toggleParams;
    const { label: sliderLabel, value, offValue, min, max, step, key: sliderKey, valueKey: sliderValueKey } = sliderParams;

    const toggle = createToggleRow(toggleLabel, audioState[toggleKey], checked => {
      audioState[toggleKey] = checked;
      updateUI();
      rebuildAudioChain();
      setTimeout(() => {
        const val = parseFloat(slider.querySelector('input').value);
        if (isNaN(val) || val === offValue) {
          toggle.querySelector('input').checked = false;
          audioState[toggleKey] = false;
          updateUI();
          persistAudioSettings(config, audioState);
        }
      }, 5000);
      persistAudioSettings(config, audioState);
    }, false);

    const slider = createSliderRow(sliderLabel, value, min, max, step, val => {
      if (uiRefreshTimeout) {
        clearTimeout(uiRefreshTimeout);
        uiRefreshTimeout = null;
      }
      audioState[sliderKey][sliderValueKey].value = val;
      if (val === offValue) {
        audioState[toggleKey] = false;
        uiRefreshTimeout = setTimeout(() => {
          toggle.querySelector('input').checked = false;
          updateUI();
          uiRefreshTimeout = null;
        }, 500);
      } else {
        audioState[toggleKey] = true;
      }
      rebuildAudioChain();
      persistAudioSettings(config, audioState);
    }, false);

    function updateUI() {
      const toggleVisible = !audioState[toggleKey];
      const sliderVisible = audioState[toggleKey];
      toggle.classList.toggle('hidden', !toggleVisible);
      slider.classList.toggle('hidden', !sliderVisible);
      toggle.querySelector('input').tabIndex = toggleVisible ? 0 : -1;
      slider.querySelector('input').tabIndex = sliderVisible ? 0 : -1;
    }

    updateUI();
    return createHTMLElement('div', { children: [toggle, slider] });
  }

  function createSelectRow(label, value, options, onChange, hasBorder = false) {
    const select = createHTMLElement('select', {
      class: 'vc-modal-select', value, eventListener: { change: e => onChange(e.target.value) },
      children: options.map(opt => createHTMLElement('option', { value: opt.value ?? opt, textContent: opt.label ?? opt }))
    });
    select.value = value;
    return createHTMLElement('div', {
      class: `vc-row ${!hasBorder ? 'has-no-border' : ''}`,
      children: [
        createHTMLElement('label', { class: 'vc-label', textContent: label }),
        select
      ]
    });
  }

  function createToggleSelectPair({ toggleParams, selectParams }) {
    const { label: toggleLabel, key: toggleKey } = toggleParams;
    const { label: selectLabel, offState, onState, options, key: selectKey } = selectParams;

    const toggleRow = createToggleRow(toggleLabel, audioState[toggleKey], checked => {
      audioState[toggleKey] = checked;
      const selectEl = selectRow.querySelector('select');
      if (checked) {
        selectEl.value = onState;
        audioState[selectKey] = onState;
      } else {
        selectEl.value = offState;
        audioState[selectKey] = offState;
      }
      updateUI();
      rebuildAudioChain();
      persistAudioSettings(config, audioState);
    }, false);

    const selectRow = createSelectRow(
      selectLabel,
      options.includes(audioState[selectKey]) ? audioState[selectKey] : offState,
      options,
      value => {
        audioState[selectKey] = value;
        if (value === offState) {
          audioState[toggleKey] = false;
          setTimeout(() => {
            toggleRow.querySelector('input').checked = false;
            updateUI();
          }, 500);
        } else {
          audioState[toggleKey] = true;
        }
        rebuildAudioChain();
        persistAudioSettings(config, audioState);
      }
    );
    selectRow.querySelector('select').style.setProperty('width', 'auto', 'important');

    function updateUI() {
      const toggleVisible = !audioState[toggleKey];
      const selectVisible = audioState[toggleKey];
      toggleRow.classList.toggle('hidden', !toggleVisible);
      selectRow.classList.toggle('hidden', !selectVisible);
      toggleRow.querySelector('input').tabIndex = toggleVisible ? 0 : -1;
      selectRow.querySelector('select').tabIndex = selectVisible ? 0 : -1;
    }

    updateUI();

    return createHTMLElement('div', { children: [toggleRow, selectRow] });
  }

  function getOverlayContainer() {
    let stack = document.getElementById('vc-overlay-stack');
    if (!stack) {
      const player = getElement('player') || document.body;
      player.appendChild(createHTMLElement('div', { id: 'vc-overlay-stack', className: 'vc-ui' }));
    }
    return stack;
  }

  /**
   * Unified Overlay
   * @param {Object} opts
   * @param {'corner'|'seek'|'center'} opts.type
   * @param {number} [opts.rate]
   * @param {number} [opts.seconds]
   * @param {string} [opts.text]
   * @param {'play'|'pause'|null} [opts.icon]
   */
  function showOverlay(opts) {
    const stack = getOverlayContainer();
    if (!stack) return;

    // Remove old overlay of same type
    stack.querySelector(`.vc-overlay-${opts.type}`)?.remove();

    const baseStyle = {
      position: 'absolute',
      opacity: '0',
      transition: 'opacity 0.2s ease',
      color: '#fff',
      fontWeight: 'bold',
    };

    let style = {}, children = [], duration = opts.duration || 800;

    switch (opts.type) {
      case 'corner':
        style = {
          top: '20px',
          left: '20px',
          padding: '4px 8px',
          backgroundColor: 'rgba(0,0,0,0.7)',
          fontSize: '16px',
          borderRadius: '2px',
        };
        children.push(opts.text);
        duration = opts.duration || 1000;
        break;

      case 'seek': {
        const s = opts.seconds || 0;
        const rect = (getElement('player') || document.body).getBoundingClientRect();
        style = {
          top: '50%',
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          backdropFilter: 'blur(2px)',
          backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          transform: 'translate(-50%, -50%)',
          left: s > 0 ? `${rect.width - 220}px` : '120px',
          animation: s > 0 ? 'vcCircleNudgeRight 0.5s ease' : 'vcCircleNudgeLeft 0.5s ease',
        };
        const arrows =
          Math.abs(s) > SEEK_LARGE ? (s > 0 ? '> > >' : '< < <') :
          Math.abs(s) > 5 ? (s > 0 ? '> >' : '< <') : (s > 0 ? '>' : '<');
        children.push(
          createHTMLElement('div', { textContent: arrows }),
          createHTMLElement('div', { textContent: `${Math.abs(s)}s`, style: { fontSize: '14px', fontWeight: '600' } })
        );
        duration = opts.duration || 600;
        break;
      }

      case 'center': {
        style = {
          top: '50%',
          left: '50%',
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          backdropFilter: 'blur(2px)',
          backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'translate(-50%, -50%)',
          fontSize: '14px',
          flexDirection: 'column',
          animation: 'stampIn 0.8s ease forwards',
        };
        const iconEl = createHTMLElement('div');
        if (opts.icon === 'play') {
          iconEl.innerHTML = `<svg width="64" height="64" viewBox="0 0 64 64"><path d="M20 22.711 L20 41.289 Q20 46 24.269 44.008 L44.175 34.719 Q50 32 44.175 29.281 L24.269 19.992 Q20 18 20 22.711" fill="#e0e0e0"/></svg>`;
        } else if (opts.icon === "pause") {
          iconEl.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="#e0e0e0"><rect x="6" y="4" width="3.5" height="16" rx="1.5" ry="1.5"></rect><rect x="14.5" y="4" width="3.5" height="16" rx="1.5" ry="1.5"></rect></svg>`;
        }
        children.push(iconEl);
        if (opts.text) children.push(createHTMLElement("div", { textContent: opts.text, style: { marginTop: '6px' } }));
        break;
      }
    }

    const overlay = createHTMLElement('div', { className: `vc-overlay-${opts.type}`, style: { ...baseStyle, ...style }, children });

    stack.appendChild(overlay);
    requestAnimationFrame(() => (overlay.style.opacity = '1'));

    clearTimeout(overlay._hideTimer);
    overlay._hideTimer = setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 400);
    }, duration);
  }

  function detectPresetFromGains(gains) {
    for (const [name, values] of Object.entries(EQ_PRESETS)) {
      if (values.every((v, i) => Number(v) === Number(gains[i]))) return name;
    }
    return 'Custom';
  }

  function makeButton(label, handler, opts = {}) {
    return createHTMLElement('button', { textContent: label, style: opts.style || 'background:transparent;color:white;border:none;font-size:16px;cursor:pointer;', eventListener: handler || undefined });
  }

  function makeFlexRow(children, justify = 'flex-start', gap = 0, align = 'center') {
    return createHTMLElement('div', {
      style: { display: 'flex', justifyContent: justify, alignItems: align, gap: typeof gap === 'number' ? `${gap}px` : gap },
      children: Array.isArray(children) ? children : [children]
    });
  }

  function makePresetSelect(filters) {
    const select = createHTMLElement('select', {
      style: 'width:100%;padding:4px;background:#222;color:white;border:1px solid #444;borderRadius:4px;',
      value: detectPresetFromGains(audioState.gains || [...EQ_PRESETS['Flat (Default)']])
    });
    Object.keys({ ...EQ_PRESETS, Custom: [] }).forEach(name =>
      select.appendChild(createHTMLElement('option', { value: name, textContent: name }))
    );
    return select;
  }

  function makeSliderBank(filters, presetSelect) {
    const sliders = [];
    const row = createHTMLElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } });

    filters.forEach((filter, i) => {
      const savedGain = audioState.gains?.[i] ?? 0;
      filter.gain.value = savedGain;

      const input = createHTMLElement('input', { class: 'eq-slider', type: 'range', min: -12, max: 12, value: savedGain, step: 1,
        eventListener: e => {
          const newVal = parseFloat(e.target.value);
          filter.gain.value = newVal;
          audioState.gains[i] = newVal;
          if (presetSelect) {
            presetSelect.value = detectPresetFromGains(audioState.gains);
            audioState.preset = presetSelect.value;
          }
          updateSliderFill(e.target);
          persistAudioSettings(config, audioState);
        }
      });

      updateSliderFill(input);

      const col = createHTMLElement('div', {
        title: EQ_TITLES[i], style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '32px' },
        children: [
          input,
          createHTMLElement('span', { textContent: EQ_LABELS[i], style: { marginTop: '46px', color: '#ded1d1', fontSize: '10px' } })
        ]
      });

      row.appendChild(col);
      sliders.push(input);
    });

    if (presetSelect) {
      presetSelect.addEventListener('change', () => {
        if (presetSelect.value === 'Custom') return;
        const vals = EQ_PRESETS[presetSelect.value];
        vals.forEach((gain, i) => {
          filters[i].gain.value = gain;
          sliders[i].value = gain;
          updateSliderFill(sliders[i]);
        });
        audioState.preset = presetSelect.value;
        audioState.gains = [...EQ_PRESETS[presetSelect.value]];
        persistAudioSettings(config, audioState);
      }, { signal: GLOBAL_SIGNAL });
    }

    return row;
  }

  function makeCompressorUI() {
    const compressorRow = createHTMLElement('div', { style: { display: audioState.compressorEnabled ? 'flex' : 'none', flexDirection: 'column', gap: '6px' } });

    const header = createToggleRow('Compressor', audioState.compressorEnabled, checked => {
      audioState.compressorEnabled = checked;
      compressorRow.style.display = checked ? 'flex' : 'none';
      rebuildAudioChain();
      persistAudioSettings(config, audioState);
    }, false);

    header.tabIndex = 0;
    header.addEventListener('click', () => { compressorRow.style.display = audioState.compressorEnabled ? 'flex' : 'none'; });

    compressorRow.appendChild(createSliderRow('Threshold:', audioState.compressor.threshold.value, -100, 0, 1, v => { audioState.compressor.threshold.value = v; }, false));
    compressorRow.appendChild(createSliderRow('Ratio:', audioState.compressor.ratio.value, 1, 20, 0.5, v => { audioState.compressor.ratio.value = v; }, false));
    compressorRow.appendChild(createSliderRow('Knee:', audioState.compressor.knee.value, 0, 40, 1, v => { audioState.compressor.knee.value = v; }, false));
    compressorRow.appendChild(createSliderRow('Attack:', audioState.compressor.attack.value, 0, 1, 0.01, v => { audioState.compressor.attack.value = v; }, false));
    compressorRow.appendChild(createSliderRow('Release:', audioState.compressor.release.value, 0, 1, 0.01, v => { audioState.compressor.release.value = v; }, true));

    return createHTMLElement('div', { children: [header, compressorRow] });
  }

  function createEqUI(filters) {
    const container = createHTMLElement('div', { id: 'vc-equalizer-ui', className: 'vc-ui',
      style: {
        position: 'fixed', bottom: '60px', right: '20px', background: 'rgba(0,0,0,0.85)', padding: '10px',
        borderRadius: '8px', zIndex: 1000001, display: 'flex', flexDirection: 'column',
        gap: '8px', color: 'white', fontSize: '12px', textAlign: 'center', width: '332px',
      }
    });

    const resetAudioStateToDefault = () => {
      audioState =  {
        ...DEFAULT_AUDIO_STATE, source: audioState.source, ctx: audioState.ctx,
        monoSplitter: audioState.monoSplitter, compressor: audioState.compressor, highPass: audioState.highPass,
        monoMerger: audioState.monoMerger, filters: audioState.filters, voiceIsolation: audioState.voiceIsolation,
        panner: audioState.panner, volumeBoost: audioState.volumeBoost
      };
      persistAudioSettings(config, audioState);
      rebuildAudioChain();
    }

    // 🔸 Header
    const header = makeFlexRow([
      createHTMLElement('strong', { textContent: 'Equalizer' }),
      makeFlexRow([
        makeButton('↻', resetAudioStateToDefault),
        makeButton('⇆', toggleViews),
        makeButton('✕', () => { container.remove(); audioState.ui = null; }),
      ], 4)
    ], 'space-between');
    container.appendChild(header);

    // 🔸 Views
    const basicView = createHTMLElement('div');
    const advancedView = createHTMLElement('div', { style: { display: 'none' } });
    container.appendChild(basicView);
    container.appendChild(advancedView);

    // 🔸 Advanced (Presets + Sliders + Toggles)
    const presetSelect = makePresetSelect(filters);
    advancedView.appendChild(presetSelect);
    advancedView.appendChild(makeSliderBank(filters, presetSelect));
    advancedView.appendChild(createToggleRow(
      'Voice Isolation (Experimental)', audioState.voiceIsolationActive,
      () => { audioState.voiceIsolationActive = !audioState.voiceIsolationActive; rebuildAudioChain(); }
    ));

    // 🔸 Basic (High-pass, Compressor, Mono, Pan, Volume)
    basicView.appendChild(createToggleSliderPair({
      toggleParams: { label: 'High-Pass', key: 'highPassEnabled' },
      sliderParams: { label: 'High-Pass (Hz):', value: audioState.highPass?.frequency?.value || 0,
        offValue: 0, min: 0, max: 1000, step: 10, key: 'highPass', valueKey: 'frequency' }
    }));

    basicView.appendChild(makeCompressorUI());
    basicView.appendChild(createToggleSelectPair({
      toggleParams: { label: 'Mono Mix', key: 'monoMixEnabled' },
      selectParams: { label: 'Mono Mix:', offState: 'Off', onState: 'Both',
        options: MONO_MIX_MODES, key: 'monoMixMode' }
    }));
    basicView.appendChild(createToggleSliderPair({
      toggleParams: { label: 'Pan (L/R)', key: 'pannerEnabled' },
      sliderParams: { label: 'Pan (L/R):', value: audioState.panner?.gain?.value || 0,
        offValue: 0, min: -1, max: 1, step: 0.01, key: 'panner', valueKey: 'pan' }
    }));
    basicView.appendChild(createToggleSliderPair({
      toggleParams: { label: 'Volume Boost', key: 'volumeBoostEnabled' },
      sliderParams: { label: 'Volume Boost (dB):', value: audioState.volumeBoost?.gain?.value || 1,
        offValue: 1, min: 1, max: 4, step: 0.1, key: 'volumeBoost', valueKey: 'gain' }
    }));

    document.body.appendChild(container);
    audioState.ui = container;

    // ---- Helpers ----
    function toggleViews() {
      const isBasicVisible = basicView.style.display !== 'none';
      basicView.style.display = isBasicVisible ? 'none' : 'block';
      advancedView.style.display = isBasicVisible ? 'block' : 'none';
    }
  }

  function showSettingsModal(forceRefresh = false) {
    const existing = document.getElementById('vc-settings-overlay');
    if (existing) return forceRefresh ? renderContent() : existing.remove();

    let overlay;
    overlay = createHTMLElement('div', {
      id: 'vc-settings-overlay', class: 'vc-ui vc-modal-overlay',
      eventListener: [{ type: 'click', fn: e => e.target === overlay && overlay.remove(), config: { signal: GLOBAL_SIGNAL } }],
      children: [createHTMLElement('div', { id: 'vc-settings-modal', class: 'vc-modal',
        children: [
          createHTMLElement('div', { class: 'vc-modal-header', textContent: 'VC Settings' }),
          createHTMLElement('div', { id: 'vc-settings-content-wrapper' }),
          createHTMLElement('div', { class: 'vc-modal-footer',
            children: [createHTMLElement('button', { class: 'vc-modal-btn', textContent: 'Close', eventListener: [{ type: 'click', fn: () => overlay.remove(), config: { signal: GLOBAL_SIGNAL } }] })]
          })
        ]
      })]
    });

    document.body.appendChild(overlay);
    renderContent();

    function renderContent() {
      const wrapper = document.getElementById('vc-settings-content-wrapper');
      const h = wrapper.getBoundingClientRect().height;
      wrapper.innerHTML = '';
      if (h > 0) wrapper.style.minHeight = h + 'px';

      const labels = { stickyVideoEnabled: 'Enable Sticky Video', mouseControls: 'Enable Mouse Controls' };
      if (config.mouseControls) labels.invertWheelDirection = 'Invert Wheel Direction';

      const toggles = Object.keys(labels).map(k => createToggleRow(labels[k], config[k], chk => {
        config[k] = chk; persistConfig(config);
        logMessage('Config updated:', k, chk ? 'enabled' : 'disabled');
        if (k === 'mouseControls' || k === 'invertWheelDirection') initMouseControls();
        if (k === 'mouseControls') renderContent();
        if (k === 'stickyVideoEnabled') config[k] ? ACTIONS.toggleStickyVideo.enable() : ACTIONS.toggleStickyVideo.disable();
      }));

      const skipIntro = createHTMLElement('div', {
        class: 'vc-row',
        children: [
          createHTMLElement('div', { class: 'vc-label', textContent: 'Intro Skip Duration (seconds)' }),
          createHTMLElement('input', {
            class: 'vc-modal-input', type: 'number', min: 1, value: skipIntroDuration,
            eventListener: [{ type: 'change', fn: e => {
              let d = parseFloat(e.target.value); if (isNaN(d) || d <= 0) d = 60;
              skipIntroDuration = d; localStorage.setItem('vc_skipIntroDuration', skipIntroDuration);
            }, config: { signal: GLOBAL_SIGNAL } }]
          })
        ]
      });

      const downloadPref = isYoutube ? createSelectRow(
        'Download Preference', config.downloadPreference,
        [
          { value: '1', label: 'Copy Command' },
          { value: '2', label: 'AddYouTube.com' },
          { value: '3', label: 'Y2Mate.com' }
        ],
        v => { config.downloadPreference = v; persistConfig(config); logMessage('Config updated: downloadPreference', v); },
        true
      ) : null;
      const modeSelector = createSelectRow(
        'Player Control Mode',
        PLAYER_CONTROL_MODES[config.modeIndex],
        PLAYER_CONTROL_MODES.map(m => ({ value: m, label: m })),
        v => {
          const idx = PLAYER_CONTROL_MODES.indexOf(v);
          if (idx !== -1) {
            config.modeIndex = idx;
            persistConfig(config);
            ACTIONS.togglePlayerControls(idx);
          }
        },
        true
      );
      wrapper.appendChild(createHTMLElement('div', { class: 'vc-modal-content', children: [...toggles, skipIntro, downloadPref, modeSelector].filter(Boolean) }));
    }
  }

  function showControlsModal() {
    const existingModal = document.getElementById('vc-controls-modal');
    if (existingModal) { existingModal.remove(); return; }

    const header = createHTMLElement('div', { class: 'vc-modal-header', children: 'Controls' });

    const tabBtn = (name, active = false) => createHTMLElement('button', { class: 'vc-tab-btn', children: name, style: `flex:1; padding:6px 0; border:none; background:transparent; cursor:pointer; font-size:14px; border-bottom:${active ? '2px solid #3ea6ff' : '2px solid transparent'}; font-weight:${active ? 'bold' : 'normal'};`});

    const keyboardTab = tabBtn('Keyboard', true);
    const mouseTab = tabBtn('Mouse');

    const tabs = createHTMLElement('div', { class: 'vc-modal-tabs', style: 'display:flex; gap:8px; margin-bottom:12px;', children: [keyboardTab, mouseTab] });

    const content = createHTMLElement('div', { class: 'vc-modal-content hide-scroll-bar' });

    const contentWrapper = createHTMLElement('div', { class: 'vc-modal-content-wrapper edge-scroll-cue', children: content });

    const closeBtn = createHTMLElement('button', { class: 'vc-modal-btn', children: 'Close', eventListener: { click: () => overlay.remove() } });

    const footer = createHTMLElement('div', { class: 'vc-modal-footer', children: closeBtn });

    const modal = createHTMLElement('div', { class: 'vc-modal', style: 'height:70vh;', children: [header, tabs, contentWrapper, footer] });

    const overlay = createHTMLElement('div', { id: 'vc-controls-modal', class: 'vc-ui vc-modal-overlay', children: modal, eventListener: { click: e => { if (e.target === overlay) overlay.remove(); } } });

    // ----- Render Functions -----
    const renderKeyboard = () => {
      content.innerHTML = '';
      KEYBOARD_CONTROLS.forEach(({ label, hidden }, combo) => {
        if (!label || hidden) return;
        content.appendChild(createHTMLElement('div', {
          class: 'vc-row',
          children: [
            createHTMLElement('div', { class: 'vc-label', children: label === 'Skip Intro' ? `${label} (${skipIntroDuration} s)` : label }),
            createHTMLElement('div', { style: 'font-family:monospace;font-size:13px;', children: formatCombo(combo) })
          ]
        }));
      });
    };

    const renderMouse = () => {
      content.innerHTML = '';
      for (const { label, eventType, regions, hidden } of MOUSE_BINDINGS.values()) {
        if (!label || hidden) continue;
        content.appendChild(createHTMLElement('div', { class: 'vc-row',
          children: [
            createHTMLElement('div', { class: 'vc-label', children: label }),
            createHTMLElement('div', { style: 'font-family:monospace;font-size:13px;', children: formatMouseBinding(eventType, regions) })
          ]
        }));
      }
    };

    const activateTab = tab => {
      if (tab === 'keyboard') {
        keyboardTab.style.borderBottom = '2px solid #3ea6ff';
        keyboardTab.style.fontWeight = 'bold';
        mouseTab.style.borderBottom = '2px solid transparent';
        mouseTab.style.fontWeight = 'normal';
        renderKeyboard();
      } else {
        mouseTab.style.borderBottom = '2px solid #3ea6ff';
        mouseTab.style.fontWeight = 'bold';
        keyboardTab.style.borderBottom = '2px solid transparent';
        keyboardTab.style.fontWeight = 'normal';
        renderMouse();
      }
      updateCues();
    };

    const updateCues = () => {
      if (content.scrollTop <= 0) contentWrapper.classList.add('hide-top');
      else contentWrapper.classList.remove('hide-top');

      if (content.scrollHeight - content.scrollTop <= content.clientHeight + 1)
        contentWrapper.classList.add('hide-bottom');
      else
        contentWrapper.classList.remove('hide-bottom');
    };

    keyboardTab.addEventListener('click', () => activateTab('keyboard'), { signal: GLOBAL_SIGNAL });
    mouseTab.addEventListener('click', () => activateTab('mouse'), { signal: GLOBAL_SIGNAL });
    content.addEventListener('scroll', updateCues, { signal: GLOBAL_SIGNAL });

    renderKeyboard();
    updateCues();

    document.body.appendChild(overlay);
  }

  function createGIFModal(onConfirm) {
    if (document.getElementById('vc-gif-modal')) return;

    const input = createHTMLElement('input', { type: 'number', min: 1, max: GIF_DURATION_MAX, value: GIF_DEFAULT_DURATION, class: 'vc-modal-input' });

    const row = createHTMLElement('div', { class: 'vc-row', children: [ createHTMLElement('div', { class: 'vc-label', children: 'GIF Duration (seconds)' }), input ] });

    const contentChildren = [row];
    const loopCondition = loopActive && loopStart !== null && loopEnd !== null;
    if (loopCondition) {
      input.disabled = true;
      contentChildren.push(
        createHTMLElement('div', { class: 'vc-loop-info', style: 'color:#888;font-size:14px;margin-top:8px;', children: 'Loop is active – GIF will use the looped segment.' })
      );
    }

    const cancelBtn = createHTMLElement('button', { class: 'vc-modal-btn', children: 'Cancel', eventListener: { click: () => overlay.remove() } });

    const okBtn = createHTMLElement('button', { class: 'vc-modal-btn', children: 'OK',
      eventListener: {
        click: () => {
          let duration = parseFloat(input.value);
          if (isNaN(duration) || duration <= 0) duration = GIF_DEFAULT_DURATION;
          if (duration > parseInt(input.max, GIF_DURATION_MAX)) duration = parseInt(input.max, GIF_DURATION_MAX);
          overlay.remove();
          onConfirm(duration);
        }
      }
    });

    const modal = createHTMLElement('div', { class: 'vc-modal',
      children: [
        createHTMLElement('div', { class: 'vc-modal-header', children: 'Create GIF' }),
        createHTMLElement('div', { class: 'vc-modal-content', children: contentChildren }),
        createHTMLElement('div', { class: 'vc-modal-footer', children: [cancelBtn, okBtn] })
      ]
    });

    const overlay = createHTMLElement('div', { id: 'vc-gif-modal', class: 'vc-ui vc-modal-overlay vc-gif-overlay', children: [modal], eventListener: { click: e => { if (e.target === overlay) overlay.remove(); } } });

    document.body.appendChild(overlay);
  }
  // ----------------------------------
  // Actions + Helpers
  // ----------------------------------
  function debounce(fn, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), wait);
    };
  }

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

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '-:-';
    seconds = Math.max(0, Math.floor(seconds || 0));
    const s = seconds % 60, m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
    return h ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;
  };

  const safeClear = x => { if (x) clearTimeout(x) || clearInterval(x); return null; };

  const safeAbort = c => { try { c?.abort() } catch {} return null; };

  function safeDisconnect(node) {
    try {
      node.disconnect();
    } catch (e) {}
  }

  function stopEventPropagation(event, opts = {}) {
    if (!event) return;
    event.preventDefault();
    event.stopPropagation();
    if (opts.immediate) event.stopImmediatePropagation();
  }

  function detectVolumeMode() {
    if (volumeMode) return volumeMode;
    const playerEl = getElement('playerEl');
    if (!playerEl || !video || typeof playerEl.getVolume !== 'function') return 'linear';
    const pv = playerEl.getVolume();
    const vv = video.volume;
    const wasMuted = video.muted;
    try {
      video.muted = true;
      playerEl.setVolume(25);
      const v25 = video.volume;
      playerEl.setVolume(75);
      const v75 = video.volume;
      const eps = 1;
      const looksLinear = Math.abs(v25 * 100 - 25) < eps && Math.abs(v75 * 100 - 75) < eps;
      volumeMode = looksLinear ? 'linear' : 'log';
    } finally {
      playerEl.setVolume(pv);
      video.volume = vv;
      video.muted = wasMuted;
    }
    return volumeMode;
  }

  function getVideoTitle() {
    const metaSelectors = ['meta[property="og:title"]', 'meta[name="title"]'];
    for (const sel of metaSelectors) {
      const el = document.querySelector(sel);
      if (el && el.content.trim()) {
        return el.content.trim();
      }
    }
    if (document.title && document.title.trim()) {
      return document.title.trim();
    }
    if (video) {
      const heading = video.closest('figure, article, div, section');
      if (heading) {
        const h = heading.querySelector('h1, h2, h3, figcaption');
        if (h && h.innerText.trim()) {
          return h.innerText.trim();
        }
      }
    }
    return siteKey; // fallback
  }

  function applyVideoTransform() {
    if (!video) return;
    let transform = `
      translate(${videoTransformState.originX}px, ${videoTransformState.originY}px)
      rotate(${videoTransformState.rotation}deg)
      scale(${videoTransformState.scale})
      scaleX(${videoTransformState.flipH ? -1 : 1})
      scaleY(${videoTransformState.flipV ? -1 : 1})
    `;
    video.style.transform = transform;
    video.style.transformOrigin = 'center center';
  }

  function applyFilter() {
    if (!video) return;
    video.style.filter = `brightness(${videoFilterState.brightness}) contrast(${videoFilterState.contrast}) saturate(${videoFilterState.saturation})`;
  }

  function attachStickyBoost(video) {
    if (typeof detachStick === 'function') detachStick();

    const stickyBoostCtrl = new AbortController();
    const { signal } = stickyBoostCtrl;

    if (videoVol == null) {
      detachStick = null;
      return;
    }

    video.volume = videoVol;

    let t1, t2, t3;

    const enforce = () => {
      if (!video) return;
      video.volume = videoVol;
    };

    // Re-apply a few times after load
    t1 = setTimeout(enforce, 0);
    t2 = setTimeout(enforce, 250);
    t3 = setTimeout(enforce, 1000);

    // Also watch relevant events
    video.addEventListener('loadedmetadata', enforce, { signal });
    video.addEventListener('playing', enforce, { signal });
    video.addEventListener('volumechange', enforce, { signal });

    detachStick = () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      stickyBoostCtrl.abort();
      detachStick = null;
    };

    registerCleanup(detachStick);
  }

  function ensureFocusAudio(url = audioState.focusModeUrl) {
    if (!audioState.ctx || audioState.ctx.state === 'closed') {
      logWarning('EQ not initialized yet');
      return;
    }
    if (audioState.focusAudio) return;

    audioState.focusAudio = new Audio(url);
    audioState.focusAudio.loop = true;
    audioState.focusAudio.crossOrigin = 'anonymous';

    audioState.focusSource = audioState.ctx.createMediaElementSource(audioState.focusAudio);
    audioState.focusGain = audioState.ctx.createGain();
    audioState.focusGain.gain.value = 0; // start silent

    audioState.focusSource.connect(audioState.focusGain);
    audioState.focusGain.connect(audioState.filters?.[0] || audioState.ctx.destination);
  }

  function fadeFocus(to, duration = 600) {
    if (!audioState.focusGain) return;
    const now = audioState.ctx.currentTime;
    audioState.focusGain.gain.cancelScheduledValues(now);
    audioState.focusGain.gain.linearRampToValueAtTime(to, now + duration / 1000);
  }

  function canUseMediaElementSource(video) {
    if (!(video instanceof HTMLMediaElement)) return false;

    if (video.srcObject instanceof MediaStream) return true;

    const src = video.currentSrc || video.src;
    if (!src) return false;

    if (src.startsWith('blob:') || src.startsWith('data:')) return true;

    try {
      const url = new URL(src, location.href);
      if (url.origin === location.origin) return true;
      return video.crossOrigin === 'anonymous' || video.crossOrigin === 'use-credentials';
    } catch {
      return false;
    }
  }

  function attachCtxSource(initiator) {
    logDebug(`Attaching CTX source, initiated by ${initiator}`);
    if (audioState.ctx && audioState.ctx.state !== 'closed') {
      audioState.ctx.close();
    }
    audioState.ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioState.source = audioState.ctx.createMediaElementSource(video);

    // Compressor
    audioState.compressor = audioState.ctx.createDynamicsCompressor();
    audioState.compressor.threshold.value = -24;
    audioState.compressor.knee.value = 30;
    audioState.compressor.ratio.value = 12;
    audioState.compressor.attack.value = 0.003;
    audioState.compressor.release.value = 0.25;

    // New: High-Pass Filter
    audioState.highPass = audioState.ctx.createBiquadFilter();
    audioState.highPass.type = 'highpass';
    audioState.highPass.frequency.value = 0; // default off (0 means disabled)

    // New: Mono Mix (we'll enable/disable dynamically)
    audioState.monoSplitter = audioState.ctx.createChannelSplitter(2);
    audioState.monoMerger = audioState.ctx.createChannelMerger(2);

    // Equalizer Filters
    audioState.filters = EQ_FREQUENCIES.map(freq => {
      const filter = audioState.ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });

    // Voice Isolation
    audioState.voiceIsolation = audioState.ctx.createBiquadFilter();
    audioState.voiceIsolation.type = 'bandpass';
    audioState.voiceIsolation.frequency.value = 1700;
    audioState.voiceIsolation.Q.value = 1.5;

    // Stereo Panner
    audioState.panner = audioState.ctx.createStereoPanner();
    audioState.panner.pan.value = 0; // center by default

    // Volume Boost
    audioState.volumeBoost = audioState.ctx.createGain();
    audioState.volumeBoost.gain.value = audioState.volumeBoostEnabled ? (audioState.volumeBoost?.gain?.value || 1) : 1;

    // Connect initial chain
    rebuildAudioChain();
  }

  function rebuildAudioChain() {
    // Disconnect everything first
    [
      audioState.source, audioState.compressor, audioState.highPass,
      audioState.monoSplitter, audioState.monoMerger, audioState.filters,
      audioState.voiceIsolation, audioState.panner, audioState.volumeBoost
    ].forEach(node => {
      if (node) {
        if (Array.isArray(node)) {
          node.forEach(safeDisconnect);
        } else {
          safeDisconnect(node);
        }
      }
    });

    // Start with source
    let node = audioState.source;

    // If high-pass enabled (frequency > 0)
    if (audioState.highPassEnabled && audioState.highPass.frequency.value > 0) {
      node.connect(audioState.highPass);
      node = audioState.highPass;
    }

    // If mono mix enabled
    if (audioState.monoMixMode && audioState.monoMixMode !== 'Off') {
      node.connect(audioState.monoSplitter);

      if (audioState.monoMixMode === 'Both') {
        audioState.monoSplitter.connect(audioState.monoMerger, 0, 0);
        audioState.monoSplitter.connect(audioState.monoMerger, 0, 1);
        audioState.monoSplitter.connect(audioState.monoMerger, 1, 0);
        audioState.monoSplitter.connect(audioState.monoMerger, 1, 1);
      } else if (audioState.monoMixMode === 'Left Only') {
        audioState.monoSplitter.connect(audioState.monoMerger, 0, 0);
        audioState.monoSplitter.connect(audioState.monoMerger, 0, 1);
      } else if (audioState.monoMixMode === 'Right Only') {
        audioState.monoSplitter.connect(audioState.monoMerger, 1, 0);
        audioState.monoSplitter.connect(audioState.monoMerger, 1, 1);
      }
      node = audioState.monoMerger;
    }

    // If compressor enabled
    if (audioState.compressorEnabled) {
      node.connect(audioState.compressor);
      node = audioState.compressor;
    }

    // Connect EQ filters
    node.connect(audioState.filters[0]);
    for (let i = 0; i < audioState.filters.length - 1; i++) {
      audioState.filters[i].connect(audioState.filters[i + 1]);
    }
    node = audioState.filters[audioState.filters.length - 1];

    // Voice isolation check
    if (audioState.voiceIsolationActive) {
      node.connect(audioState.voiceIsolation);
      node = audioState.voiceIsolation;
    }

    // Panner
    node.connect(audioState.panner);
    node = audioState.panner;

    // Volume boost
    if (audioState.volumeBoostEnabled) {
      node.connect(audioState.volumeBoost);
      node = audioState.volumeBoost;
    }

    // Finally to destination
    node.connect(audioState.ctx.destination);
  }

  function bringVideoToFocus() {
    setTimeout(() => {
      const player = isYoutube ? getElement('player') : null;
      if (player) {
        player.focus();
      } else {
        window.focus();
      }
    }, 50);
  }

  function shouldKeydownBeIgnored(e, video = true) {
    if (!video || !e.isTrusted) return true;

    const el = document.activeElement;
    if (!el) return false;

    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;

    return false;
  }

  const ACTIONS = {
    noop: () => {},

    showSettingsModal,

    showControlsModal,

    closeModals: () => {
      const modals = document.querySelectorAll('.vc-modal-overlay, vc-gif-overlay');
      if (modals.length) {
        modals.forEach(el => el.remove());
      }
    },

    duplicateSite: () => {
      if (video) video.pause();
      window.open(window.location.origin, '_blank');
    },

    search: (e) => {
      const searchEl = getElement('search');
      if (searchEl) {
        stopEventPropagation(e);
        searchEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    },

    makeGif: () => {
      logMessage('GIF Maker started');

      if (!video) return alert('No video found');

      if (!canUseMediaElementSource(video)) {
        logWarning('GIF disabled: external video source (CORS).');
        showNotification('GIF disabled: external video source (CORS)');
        return;
      }

      const gifMakerCtrl = new AbortController();
      const { signal } = gifMakerCtrl;

      // Ensure cleanup always registered
      registerCleanup(() => gifMakerCtrl.abort());

      const paintGif = (chosenDuration) => {
        let startTime = video.currentTime;
        let endTime = startTime + chosenDuration;

        if (loopActive && loopStart !== null && loopEnd !== null) {
          const loopLength = loopEnd - loopStart;
          const maxDuration = GIF_DURATION_MAX;
          startTime = loopStart;
          endTime = startTime + Math.min(loopLength, maxDuration);
        }

        const initGif = () => {
          const gif = new GIF({
            workers: 2,
            quality: 10,
            workerScript: window.gifWorkerUrl,
          });

          const { scale, originX, originY, rotation, flipH, flipV } = videoTransformState;
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const visibleW = vw / scale;
          const visibleH = vh / scale;
          let sx = (vw - visibleW) / 2 - (originX / scale) * (vw / video.clientWidth);
          let sy = (vh - visibleH) / 2 - (originY / scale) * (vh / video.clientHeight);
          if (flipH) sx = vw - sx - visibleW;
          if (flipV) sy = vh - sy - visibleH;
          sx = Math.max(0, Math.min(vw - visibleW, sx));
          sy = Math.max(0, Math.min(vh - visibleH, sy));

          const canvas = createHTMLElement('canvas', { width: visibleW, height: visibleH });
          const ctx = canvas.getContext('2d');

          const fps = Math.min(FALLBACK_FPS, GIF_MAX_FPS);
          const frameDelay = Math.round(1000 / fps);
          let nextTime = startTime;

          const onSeeked = () => {
            if (video.currentTime >= endTime) {
              gifMakerCtrl.abort();
              gif.render();
              return;
            }

            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
            ctx.drawImage(video, sx, sy, visibleW, visibleH, -canvas.width / 2, -canvas.height / 2, visibleW, visibleH);
            ctx.restore();

            gif.addFrame(canvas, { copy: true, delay: frameDelay });
            nextTime = Math.min(nextTime + 1 / fps, endTime);
            video.currentTime = nextTime;
          };

          gif.on('finished', blob => {
            capturingGif = false;
            const url = URL.createObjectURL(blob);
            const a = createHTMLElement('a', { href: url, download: `${getVideoTitle()}.gif`.replace(/_/g, ' ') });
            a.click();
          });

          showNotification(`Capturing GIF from ${startTime.toFixed(1)}s to ${endTime.toFixed(1)}s`);

          capturingGif = true;
          video.pause();
          video.addEventListener('seeked', onSeeked, { signal });
          video.currentTime = startTime;
        };

        if (!window.gifMakerScriptLoaded) {
          const src = 'https://flux-suite.vercel.app/libs/vendors/gif.js';

          fetch(src)
            .then(r => r.text())
            .then(code => {
              const script = createHTMLElement('script', { textContent: code });
              document.body.appendChild(script);
              window.gifMakerScriptLoaded = true;
              return fetch('https://flux-suite.vercel.app/libs/vendors/gif-worker.js');
            })
            .then(r => r.text())
            .then(workerCode => {
              const blob = new Blob([workerCode], { type: 'application/javascript' });
              window.gifWorkerUrl = URL.createObjectURL(blob);
              initGif();
            });
        }

        initGif();
      }
      createGIFModal(paintGif);
    },

    takeScreenshot: () => {
      const format = "png";
      const fileSuffix = `.${format}`;
      const title = getVideoTitle();
      const videoEl = getElement("video");
      if (!videoEl) return;

      // timestamp
      const currentSec = Math.floor(videoEl.currentTime);
      const mins = Math.floor(currentSec / 60);
      const secs = currentSec % 60;
      let timestamp = `${mins}-${secs.toString().padStart(2, "0")}`;
      if (mins >= 60) {
        const hrs = Math.floor(mins / 60);
        const remMins = mins % 60;
        timestamp = `${hrs}-${remMins.toString().padStart(2, "0")}-${secs
          .toString()
          .padStart(2, "0")}`;
      }

      const { scale, originX, originY, rotation, flipH, flipV } = videoTransformState;
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      // Compute visible area in original video coordinates BEFORE transforms
      const visibleW = vw / scale;
      const visibleH = vh / scale;
      let sx = (vw - visibleW) / 2 - (originX / scale) * (vw / videoEl.clientWidth);
      let sy = (vh - visibleH) / 2 - (originY / scale) * (vh / videoEl.clientHeight);
      // Apply flips to adjust crop region
      if (flipH) sx = vw - sx - visibleW;
      if (flipV) sy = vh - sy - visibleH;
      // Clamp to bounds
      sx = Math.max(0, Math.min(vw - visibleW, sx));
      sy = Math.max(0, Math.min(vh - visibleH, sy));

      // Create canvas
      const canvas = createHTMLElement('canvas', { width: visibleW, height: visibleH });
      const ctx = canvas.getContext("2d");

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(videoEl, sx, sy, visibleW, visibleH, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
      ctx.restore();

      // Export
      canvas.toBlob((blob) => {
        if (!blob) return;
        const link = createHTMLElement("a", { href: URL.createObjectURL(blob), download: `${title} ${timestamp}${fileSuffix}`.trim().replace(/_/g, " ") });
        link.click();
        URL.revokeObjectURL(link.href);
      }, `image/${format}`);
    },

    startDownload: () => {
      try {
        // Get video ID
        let videoId = null;
        if (window.location.pathname.includes('shorts')) {
          const match = window.location.pathname.match(/^\/shorts\/([^/?#]+)/);
          videoId = match ? match[1] : null;
        } else {
          const paramsURL = new URLSearchParams(window.location.search);
          videoId = paramsURL.get('v');
        }

        if (!videoId) { logError("Couldn't extract video ID."); return; }

        const videoUrl = window.location.href;
        const pref = config.downloadPreference;

        switch (pref) {
          case '1': // yt-dlp command to clipboard
            {
              const shortUrl = `https://youtu.be/${videoId}`;
              const cmd = `yt-dlp ${shortUrl}`;
              navigator.clipboard.writeText(cmd).then(() => {
                showNotification('Copied command to clipboard!');
                logMessage('yt-dlp command copied to clipboard.');
              });
            }
            break;

          case '2': // addyoutube.com
            {
              const downloadDomains = ['addyoutube.com'];
              const randomDomain =
                downloadDomains[
                  Math.floor(Math.random() * downloadDomains.length)
                ];
              const downloadUrl = videoUrl.replace('youtube.com', randomDomain);

              window.open(
                downloadUrl,
                'popUpWindow',
                'height=800,width=1000,left=50%,top=100,resizable=no,scrollbars=yes,toolbar=no,menubar=yes,location=no,directories=yes,status=no'
              );
              logMessage('Opened addyoutube.com window.');
            }
            break;

          case '3': // y2mate.com
            {
              const downloadUrl = `https://www.y2mate.com/en/convert-youtube/${videoId}`;
              window.open(
                downloadUrl,
                'popUpWindow',
                'height=800,width=1000,left=50%,top=100,resizable=no,scrollbars=yes,toolbar=no,menubar=yes,location=no,directories=yes,status=no'
              );
              logMessage('Opened y2mate.com window.');
            }
            break;

          default:
            logError('Invalid download preference in config.');
        }
      } catch (e) {
        logError('Error in startDownload', e);
      }
    },

    startPiP: () => {
      if (!video) return;
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else video.requestPictureInPicture();
    },

    abLoop: (() => {
      let markers, start, end, range;

      const updateMarkers = () => {
        const pb = getElement('progressSlider') || getElement('progressBar'), dur = video.duration;
        if (!pb) return;

        if (!markers) {
          markers = createHTMLElement('div', {
            id: 'vc-loop-markers',
            style: { position: 'absolute', inset: 0, height: '100%', pointerEvents: 'none', zIndex: 5 },
            children: [
              range = createHTMLElement('div', { style: { position: 'absolute', top: 0, height: '100%', background: 'rgba(100,91,91,0.8)', pointerEvents: 'none' } }),
              start = createHTMLElement('div', { style: { position: 'absolute', top: 0, height: '100%', width: '2px', background: 'rgba(0,255,0,0.8)', transform: 'translateX(-1px)' } }),
              end = createHTMLElement('div', { style: { position: 'absolute', top: 0, height: '100%', width: '2px', background: 'rgba(255,0,0,0.8)', transform: 'translateX(-1px)' } }),
            ]
          });
          pb.appendChild(markers);
          if (customProgressBar) customProgressBar.appendChild(markers);
        }

        start.style.display = loopStart != null ? 'block' : 'none';
        end.style.display = loopEnd != null ? 'block' : 'none';
        range.style.display = loopEnd != null ? 'block' : 'none';

        if (loopStart != null) start.style.left = `${(loopStart / dur) * 100}%`;
        if (loopEnd != null) {
          range.style.left = `${(loopStart / dur) * 100}%`;
          range.style.width = `${((loopEnd - loopStart) / dur) * 100}%`;
          range.style.animation = `vc-loop-pulse 2s infinite ease-in-out`;
          end.style.left = `${(loopEnd / dur) * 100}%`;
        }
      };

      const onLoop = () => {
        if (!loopActive || loopStart == null || loopEnd == null || capturingGif) return;
        if (video.currentTime >= loopEnd - 0.01) { // ~10ms epsilon
          video.currentTime = loopStart;
          if (!video.paused) video.play().catch(() => {});
        }
      };

      return () => {
        const ctrl = new AbortController(), { signal } = ctrl;
        registerCleanup(() => ctrl.abort());

        if (loopStart == null) {
          loopStart = +video.currentTime.toFixed(2);
          loopEnd = null; loopActive = false;
          showOverlay({ type: 'center', text: 'Loop Start' });

        } else if (loopEnd == null) {
          loopEnd = +video.currentTime.toFixed(2);
          loopActive = true;
          video.addEventListener('timeupdate', onLoop, { signal });
          video.addEventListener('seeked', onLoop, { signal });
          showOverlay({ type: 'center', text: 'Loop On' });

        } else {
          loopStart = loopEnd = null; loopActive = false;
          ctrl.abort();
          showOverlay({ type: 'center', text: 'Loop Off' });
        }

        updateMarkers();
      };
    })(),

    rotateClockwise: () => {
      videoTransformState.rotation = (videoTransformState.rotation + 90) % 360;
      applyVideoTransform();
    },
    flipHorizontal: () => {
      videoTransformState.flipH = !videoTransformState.flipH;
      applyVideoTransform();
    },
    flipVertical: () => {
      videoTransformState.flipV = !videoTransformState.flipV;
      applyVideoTransform();
    },
    zoomPan: () => {
      if (zoomPanCtrl) {
        zoomPanCtrl.abort();
        zoomPanCtrl = null;
        return;
      }

      logMessage('Zoom & Pan mode enabled');

      if (!video) return alert('No video found');

      let scale = videoTransformState.scale;
      let isDragging = false;
      let startX, startY;

      video.style.transformOrigin = 'center center';
      video.style.transition = 'transform 0.05s linear';

      const onWheel = e => {
        stopEventPropagation(e, { immediate: true });
        scale += e.deltaY * -0.001;
        scale = Math.min(Math.max(1, scale), 4);
        videoTransformState.scale = scale;
        applyVideoTransform()
      };

      const onMouseDown = e => {
        stopEventPropagation(e);
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
      };

      const onMouseMove = event => {
        if (!isDragging) return;
        stopEventPropagation(event);
        videoTransformState.originX += (event.clientX - startX) / scale;
        videoTransformState.originY += (event.clientY - startY) / scale;
        startX = event.clientX;
        startY = event.clientY;
        applyVideoTransform()
      };

      const onMouseUp = () => { isDragging = false; }

      const targetEl = isYoutube ? video : getElement('player');

      zoomPanCtrl = new AbortController();
      const { signal } = zoomPanCtrl;

      targetEl.addEventListener('wheel', onWheel, {capture: true, passive: false, signal });
      targetEl.addEventListener('mousedown', onMouseDown, {capture: true, passive: false, signal });
      document.addEventListener('click', e => {
        if (!isVideoClickUnobstructed(e, targetEl)) return;
        stopEventPropagation(e);
      }, {capture: true, passive: false, signal });
      document.addEventListener('mousemove', onMouseMove, {capture: true, passive: false, signal });
      document.addEventListener('mouseup', onMouseUp, {capture: true, passive: false, signal });

      showNotification('Zoom with mouse wheel, pan by dragging. Reload to reset.');
      registerCleanup(() => zoomPanCtrl.abort());
    },

    randomJump: () => {
      if (video) {
        const randomTime = Math.random() * video.duration;
        video.currentTime = randomTime;
        showOverlay({ type: 'corner', text: `Jumped to ${randomTime.toFixed(2)}s` });
      }
    },

    equalizer: () => {
      if (eqDisabled) return;
      if (!video) return alert('No video found');
      if (!canUseMediaElementSource(video)) {
        eqDisabled = true;
        logWarning('EQ disabled: external video source (CORS). Leaving audio untouched.');
        showEqWarning('EQ disabled: external video source (CORS)');
        return;
      }
      if (!audioState.active) {
        logMessage('Enabling Equalizer...');
        if (!audioState.ctx) attachCtxSource('keydown');
        createEqUI(audioState.filters);
        audioState.active = true; // keeping state active locally as default preset it flat
        persistAudioSettings(config, audioState);
      } else {
        if (audioState.ui !== null) { audioState.ui.remove(); audioState.ui = null; }
        else { createEqUI(audioState.filters); }
      }
    },

    seek: (() => {
      let timeSeeked = 0, timeOut = null, prevSeekDirection = null;
      return (seconds, event) => {
        if (video) {
          if (event) stopEventPropagation(event, { immediate: true });
          video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
          const seekDirection = seconds > 0 ? 'fwd' : 'bwd';
          if (timeOut) clearTimeout(timeOut);
          if (seekDirection === prevSeekDirection) timeSeeked = timeSeeked + seconds;
          else timeSeeked = seconds;
          prevSeekDirection = seekDirection;
          showOverlay({ type: 'seek', seconds: timeSeeked })
          timeOut = setTimeout(() => { timeSeeked = 0 }, 600);
        }
      }
    })(),

    skipIntro: () => {
      const skipBtn = getElement('skipBtn');
      if (skipBtn) { skipBtn.click(); return; }
      if (video) ACTIONS.seek(skipIntroDuration)
    },

    changePlaybackSpeed: (delta, event) => {
      if (video) {
        if (event) stopEventPropagation(event);
        video.playbackRate = Math.max(0.25, Math.min(16, video.playbackRate + delta));
        showOverlay({ type: 'corner' , text: `Speed: ${video.playbackRate.toFixed(2)}x` });;
      }
    },

    fastForward: () => {
      if (!video) return;
      const originalPlayback = video.playbackRate;
      ACTIONS.changePlaybackSpeed(3);
      return () => {
        video.playbackRate = originalPlayback;
        showOverlay({ type: 'corner' , text: `Speed: ${video.playbackRate.toFixed(2)}x` });;
      };
    },

    rewind: () => {
      if (!video) return;
      video.pause();
      let interval = setInterval(() => ACTIONS.frameStep(false, 6), 50);
      return () => { clearInterval(interval); video.play(); };
    },

    resetPlayback: () => {
      video.playbackRate = 1;
      slowMoActive = false;
      showOverlay({ type: 'corner' , text: `Speed: ${video.playbackRate.toFixed(2)}x` });;
    },

    setVolume: (up, volumeStep, event) => {
      if (!video) return;
      if (event) stopEventPropagation(event);

      if (video.muted) video.muted = false;

      if (up) video.volume = Math.min(1, video.volume + volumeStep);
      else video.volume = Math.max(0, video.volume - volumeStep);

      videoVol = video.volume;
      localStorage.setItem('vc_videoVol', videoVol);
      showOverlay({ type: 'center', text: Math.round(video.volume * 100) + '%' });
    },

    toggleFullscreen: () => {
      const player = getElement('player');
      if (!document.fullscreenElement) player.requestFullscreen?.();
      else document.exitFullscreen?.();
    },

    frameStep: (forward, speedFactor = 1, event) => {
      if (!video) return;
      if (event) stopEventPropagation(event);
      if (!video.paused) video.pause();
      let fps = FALLBACK_FPS;
      const step = speedFactor / (fps);

      let newTime = video.currentTime + (forward ? 1 : -1) * step;
      if (newTime < 0) newTime = 0;
      if (newTime > video.duration) newTime = video.duration;

      video.currentTime = newTime;
    },

    nextVideo: (event) => {
      const nextBtn = getElement('nextBtn') || getEpisodeSibling(+1);
      if (nextBtn) {
        if (event) stopEventPropagation(event, { immediate: true });
        nextBtn.click();
      }
    },

    prevVideo: (event) => {
      const prevBtn = getElement('prevBtn') || getEpisodeSibling(-1);
      if (prevBtn) {
        if (event) stopEventPropagation(event, { immediate: true });
        prevBtn.click();
      }
    },

    setBrightness: (up, step = BRIGHTNESS_STEP) => {
      if (!video) return;

      if (!videoFilterState.brightness) videoFilterState.brightness = 1;
      applyFilter();

      if (up) videoFilterState.brightness = Math.min(2, videoFilterState.brightness + step); // max 200%
      else videoFilterState.brightness = Math.max(0.1, videoFilterState.brightness - step); // min 10%

      applyFilter();
    },
    setContrast: (up, step = BRIGHTNESS_STEP) => {
      if (!video) return;

      if (!videoFilterState.contrast) videoFilterState.contrast = 1;
      applyFilter();

      if (up) videoFilterState.contrast = Math.min(2, videoFilterState.contrast + step); // max 200%
      else videoFilterState.contrast = Math.max(0.1, videoFilterState.contrast - step); // min 10%

      applyFilter();
    },
    setSaturation: (up, step = BRIGHTNESS_STEP) => {
      if (!video) return;

      if (!videoFilterState.saturation) videoFilterState.saturation = 1;
      applyFilter();

      if (up) videoFilterState.saturation = Math.min(2, videoFilterState.saturation + step); // max 200%
      else videoFilterState.saturation = Math.max(0.1, videoFilterState.saturation - step); // min 10%

      applyFilter();
    },

    resetVideoFiltersAndTransforms: () => {
      videoFilterState = { brightness: 1, contrast: 1, saturation: 1 }
      videoTransformState = { scale: 1, originX: 0, originY: 0, rotation: 0, flipH: false, flipV: false };
      applyFilter();
      applyVideoTransform()
    },

    togglePlay: (e) => {
      if (!video) return;
      if (e) stopEventPropagation(e, { immediate: true });
      const playBtn = getElement('playBtn');
      const pauseBtn = getElement('pauseBtn');
      togglePlayFired = true;
      if (playBtn || pauseBtn) {
        if (pauseBtn) pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        else if (playBtn) playBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        else logWarning('Play/Pause button not found');
        return;
      }
      if (video.paused) {
        video.play();
        showOverlay({ type: 'center', icon: 'play' });
      } else {
        video.pause();
        showOverlay({ type: 'center', icon: 'pause' });
      }
      setTimeout(() => togglePlayFired = false, 200);
    },

    toggleFocusMode: (event) => {
      const video = getElement('video');
      if (!video) return;
      if (event) stopEventPropagation(event);
      audioState.focusModeEnabled = !audioState.focusModeEnabled;
      showNotification(`Focus mode ${audioState.focusModeEnabled ? 'enabled' : 'disabled'}`);

      const onVideoPause = () => { if (audioState.focusModeEnabled) fadeFocus(0.25); }

      const onVideoPlay = () => { if (audioState.focusModeEnabled) fadeFocus(0.0); }

      if (audioState.focusModeEnabled) {
        if (!audioState.ctx || audioState.ctx.state === 'closed') {
          if (canUseMediaElementSource(video)) {
            attachCtxSource('focusMode');
            audioState.active = true;
          } else {
            logWarning('Focus mode: cannot attach EQ source to this video');
            return;
          }
        }

        ensureFocusAudio();
        audioState.focusAudio.play();

        video.addEventListener('pause', onVideoPause);
        video.addEventListener('play', onVideoPlay);
      } else {
        if (audioState.focusAudio) audioState.focusAudio.pause();
        video.removeEventListener('pause', onVideoPause);
        video.removeEventListener('play', onVideoPlay);
      }
    },

    showVideoThumbnail: (() => {
      let overlay = null, expanded = false;

      const cleanup = v => {
        overlay?.remove(); overlay = null;
        document.getElementById('vc-thumb-style')?.remove();
        expanded = false;
        v?.play();
      };

      return () => {
        const video = getElement('video');
        if (!video) return;
        video.pause();

        if (overlay) return cleanup(video);

        const src = document.querySelector("meta[property='og:image']")?.content || video.poster;
        if (!src) return showNotification('No thumbnail available');

        overlay = createHTMLElement('div', {
          id: 'vc-thumb-overlay',
          innerHTML: `
            <div class="vc-thumb-backdrop"></div>
            <div class="vc-thumb-content">
              <button class="vc-thumb-close">✕</button>
              <img src="${src}" class="vc-thumb-img" />
            </div>`
        });

        const style = createHTMLElement('style', { id: 'vc-thumb-style', textContent: `
          #vc-thumb-overlay{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;}
          .vc-thumb-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.65);}
          .vc-thumb-content{position:relative;z-index:1;max-width:80%;max-height:80%;display:flex;flex-direction:column;align-items:flex-end;transition:.3s;}
          .vc-thumb-close{background:rgba(0,0,0,.7);border:none;color:#fff;font-size:20px;border-radius:50%;width:32px;height:32px;cursor:pointer;margin-bottom:4px;}
          .vc-thumb-img{max-width:100%;max-height:100%;cursor:zoom-in;border-radius:8px;transition:.3s;box-shadow:0 0 16px rgba(0,0,0,.4);}
          #vc-thumb-overlay.expanded .vc-thumb-content{width:100%;height:100%;max-width:none;max-height:none;align-items:center;justify-content:center;}
          #vc-thumb-overlay.expanded .vc-thumb-img{width:100%;height:100%;object-fit:contain;cursor:zoom-out;border-radius:0;}
        `});

        document.body.appendChild(overlay);
        document.head.appendChild(style);

        overlay.querySelector('.vc-thumb-close').onclick = () => cleanup(video);
        overlay.querySelector('.vc-thumb-backdrop').onclick = () => cleanup(video);
        overlay.querySelector('.vc-thumb-img').onclick = () => {
          expanded = !expanded;
          overlay.classList.toggle('expanded', expanded);
        };
      };
    })(),

    toggleDefaultControlsOverlay: (() => {
      let enabled = false;
      let onEnter, onLeave;

      return () => {
        const progressBar = getElement('playerControlsList');
        const playerControlsList = getElement('playerControlsList', true); // should be an array/NodeList

        if (!progressBar || !playerControlsList || !playerControlsList.forEach) return;

        if (!enabled) {
          // --- ENABLE: hide by default + add hover listeners ---
          playerControlsList.forEach(el => {
            // stash previous inline styles so we can restore later
            el.dataset.prevOpacity = el.style.opacity || '';
            el.dataset.prevPointerEvents = el.style.pointerEvents || '';
            el.dataset.prevTransition = el.style.transition || '';

            // hidden by default, but keep layout
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            if (!el.style.transition) el.style.transition = 'opacity 150ms ease';
          });

          onEnter = () => {
            playerControlsList.forEach(el => {
              el.style.opacity = '1';
              el.style.pointerEvents = 'auto';
            });
          };
          onLeave = () => {
            playerControlsList.forEach(el => {
              el.style.opacity = '0';
              el.style.pointerEvents = 'none';
            });
          };

          progressBar.addEventListener('mouseenter', onEnter);
          progressBar.addEventListener('mouseleave', onLeave);

          enabled = true;
        } else {
          // --- DISABLE: remove listeners + restore styles ---
          progressBar.removeEventListener('mouseenter', onEnter);
          progressBar.removeEventListener('mouseleave', onLeave);

          playerControlsList.forEach(el => {
            el.style.opacity = el.dataset.prevOpacity || '';
            el.style.pointerEvents = el.dataset.prevPointerEvents || '';
            el.style.transition = el.dataset.prevTransition || '';

            delete el.dataset.prevOpacity;
            delete el.dataset.prevPointerEvents;
            delete el.dataset.prevTransition;
          });

          onEnter = onLeave = undefined;
          enabled = false;
        }
      };
    })(),

    bufferVideo: (() => {
      // -------- Caching Logic State --------
      let cacheCtrl;
      let isCaching = false;
      let originalPlay = HTMLMediaElement.prototype.play;
      let playPosition = 0;
      let bufferEnd = 0;

      function checkBuffer() {
        const v = getElement('video');
        if (!v) return false;
        const buf = v.buffered;
        const lastIndex = buf.length - 1;
        if (lastIndex < 0) return false;
        bufferEnd = buf.end(lastIndex);
        return bufferEnd > v.duration - 55;
      }

      function handleCanPlayThrough() {
        if (!isCaching) return;
        const v = getElement('video');
        if (!v) return;

        if (checkBuffer()) {
          finishCaching();
        } else {
          v.currentTime = bufferEnd;
          v.pause();
        }
      }

      function disableAutoplay(video) {
        const origPlay = video.play.bind(video);
        video.play = () => {
          if (video.dataset.vcBlockPlay === 'true') {
            return new Promise(() => {}); // blocked
          }
          return origPlay();
        };
      }

      function startCaching() {
        const v = getElement('video');
        if (!v || v.duration === Infinity) {
          logWarning('No playable video or live stream detected.');
          return;
        }
        logMessage('Caching started...');
        isCaching = true;
        playPosition = v.currentTime;
        v.pause();
        disableAutoplay(v);
        video.dataset.vcBlockPlay = 'true';
        if (cacheCtrl) cacheCtrl.abort();
        cacheCtrl = new AbortController();
        const { signal } = cacheCtrl;
        v.addEventListener('canplaythrough', handleCanPlayThrough, { signal });
        registerCleanup(() => cacheCtrl.abort());
        checkBuffer();
        v.currentTime = bufferEnd;
      }

      function finishCaching() {
        const v = getElement('video');
        if (!v) return;
        logMessage('Caching stopped/finished.');
        isCaching = false;
        if (cacheCtrl) {
          cacheCtrl.abort();
          cacheCtrl = null;
        }
        HTMLMediaElement.prototype.play = originalPlay;
        v.currentTime = playPosition;
        setTimeout(() => {
          v.pause();
          video.dataset.vcBlockPlay = 'false';
          showNotification('Video Buffered!');
        }, 33);
      }

      return () => {
        isCaching ? finishCaching() : startCaching()
      }
    })(),

    startSloMo: () => {
      if (!slowMoActive) {
        prevPlaybackRate = video.playbackRate;
        video.playbackRate = 0.25;
        slowMoActive = true;
        showOverlay({ type: 'center', text: '0.25 x' });
      }
    },

    toggleZenMode: (() => {
      let isZenActive = false, isNightActive = false;
      let zenStyleEl = null, zenCtrl = null, observer = null;
      let lastFocus = null, zenCleanup = null, nightCleanup = null;
      let lastPlayerControlMode = null, wasFocusModeEnabled = null;
      const zenNodeSet = new Set(), nightNodeSet = new Set();

      function clearMarks(isZen) {
        if (isZen) {
          document.querySelectorAll('.vc-zen-keep').forEach(n => n.classList.remove('vc-zen-keep'));
          zenNodeSet.forEach(n => n.classList.remove('vc-zen-blur', 'vc-zen-focus'));
          zenNodeSet.clear(); lastFocus = null;
        } else {
          document.querySelectorAll('.vc-night-keep').forEach(n => n.classList.remove('vc-night-keep'));
          nightNodeSet.forEach(n => { n.classList.remove('vc-night-dim'); n.style.filter = n.style.transition = ''; });
          nightNodeSet.clear();
        }
      }

      function markKeepChain(root, isZen) {
        let el = root;
        while (el && el !== document.body) {
          el.classList.add(isZen ? 'vc-zen-keep' : 'vc-night-keep');
          el = el.parentElement;
        }
      }

      function computeSet(playerRoot, isZen) {
        const prevFocus = lastFocus;
        clearMarks(isZen); markKeepChain(playerRoot, isZen);

        const handle = (sib, isZen) => {
          if (isZen && !sib.classList.contains('vc-zen-keep')) { sib.classList.add('vc-zen-blur'); zenNodeSet.add(sib); }
          if (!isZen && !sib.classList.contains('vc-night-keep')) { sib.classList.add('vc-night-dim'); nightNodeSet.add(sib); }
        };

        let child = playerRoot, anc = playerRoot.parentElement;
        while (anc && anc !== document.body) {
          for (const sib of anc.children) {
            if (sib === child || (sib.id && sib.id.startsWith('vc-'))) continue;
            handle(sib, isZen);
          }
          child = anc; anc = anc.parentElement;
        }

        for (const sib of document.body.children) {
          if (sib === child || (sib.id && sib.id.startsWith('vc-'))) continue;
          handle(sib, isZen);
        }

        if (isZen && prevFocus && zenNodeSet.has(prevFocus)) {
          prevFocus.classList.add('vc-zen-focus');
          lastFocus = prevFocus;
        }
      }

      function injectCSS() {
        zenStyleEl = createHTMLElement('style', { id: 'vc-zen-style' });
        zenStyleEl.textContent = `
          html.vc-zen, body.vc-zen { --vc-zen-blur: 6px; }
          .vc-zen-blur { filter: blur(var(--vc-zen-blur)) brightness(0.9) saturate(0.95); transition: filter 1s ease; will-change: filter; }
          .vc-night-dim { filter: brightness(0.5); transition: filter 150ms ease; }
          .vc-zen-blur.vc-night-dim { filter: blur(var(--vc-zen-blur)) brightness(0.5) saturate(0.95); }
          .vc-zen-blur.vc-zen-focus { filter: none !important; }
          .vc-zen-blur.vc-zen-focus.vc-night-dim { filter: brightness(0.5) !important; }
          .vc-zen-keep { filter: none !important; }
        `;
        document.head.appendChild(zenStyleEl);
      }

      return (isZen = true) => {
        if (!video) return;
        const docClass = isZen ? 'vc-zen' : 'vc-night';
        const active = isZen ? isZenActive : isNightActive;
        const modeCleanup = isZen ? zenCleanup : nightCleanup;

        if (!active) {
          if (lastPlayerControlMode === null) { lastPlayerControlMode = config.modeIndex; ACTIONS.togglePlayerControls(2); }
          if (wasFocusModeEnabled === null) { wasFocusModeEnabled = audioState.focusModeEnabled; if (!audioState.focusModeEnabled) ACTIONS.toggleFocusMode(); }
          if (isZen) isZenActive = true; else isNightActive = true;
          const playerRoot = requireVideoElement ? video : getElement('player') || video.parentElement;
          if (!playerRoot) return;

          if (!zenStyleEl) injectCSS();
          computeSet(playerRoot, isZen);
          document.documentElement.classList.add(docClass);
          document.body.classList.add(docClass);

          if (isZen) {
            zenCtrl = new AbortController();
            const { signal } = zenCtrl;
            for (const n of zenNodeSet) {
              n.addEventListener('mouseenter', () => { if (lastFocus) lastFocus.classList.remove('vc-zen-focus'); n.classList.add('vc-zen-focus'); lastFocus = n; }, { signal });
              n.addEventListener('mouseleave', () => { n.classList.remove('vc-zen-focus'); if (lastFocus === n) lastFocus = null; }, { signal });
            }
          }

          if (!observer) {
            observer = new MutationObserver(() => {
              if (!isZenActive && !isNightActive) return;
              const root = requireVideoElement ? video : getElement('player') || video.parentElement;
              if (isZenActive) computeSet(root, true);
              if (isNightActive) computeSet(root, false);
              if (isZenActive) {
                if (zenCtrl) zenCtrl.abort();
                zenCtrl = new AbortController();
                const { signal } = zenCtrl;
                for (const n of zenNodeSet) {
                  n.addEventListener('mouseenter', () => { if (lastFocus) lastFocus.classList.remove('vc-zen-focus'); n.classList.add('vc-zen-focus'); lastFocus = n; }, { signal });
                  n.addEventListener('mouseleave', () => { n.classList.remove('vc-zen-focus'); if (lastFocus === n) lastFocus = null; }, { signal });
                }
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
          }

          const thisCleanup = () => {
            clearMarks(isZen);
            document.documentElement.classList.remove(docClass);
            document.body.classList.remove(docClass);
            if (isZen) { if (zenCtrl) zenCtrl.abort(); isZenActive = false; }
            else isNightActive = false;
            if (!isZenActive && !isNightActive) {
              if (lastPlayerControlMode !== null) ACTIONS.togglePlayerControls(lastPlayerControlMode);
              if (wasFocusModeEnabled !== null && wasFocusModeEnabled !== audioState.focusModeEnabled) ACTIONS.toggleFocusMode();
              lastPlayerControlMode = null; wasFocusModeEnabled = null;
              if (observer) { safeDisconnect(observer); observer = null; }
              if (zenStyleEl) { zenStyleEl.remove(); zenStyleEl = null; }
            }
          };

          if (isZen) zenCleanup = thisCleanup; else nightCleanup = thisCleanup;
          registerCleanup(thisCleanup);
          showNotification(isZen ? 'Zen Mode On' : 'Night Mode On', { id: 'vc-mode-notif', duration: 30000 });
        } else {
          if (modeCleanup) modeCleanup();
          if (isZen) zenCleanup = null; else nightCleanup = null;
          showNotification(isZen ? 'Zen Mode Off' : 'Night Mode Off', { id: 'vc-mode-notif', duration: 30000 });
        }
      };
    })(),

    toggleTranscript: (() => {
      let active = false, overlay = null;

      const cleanup = () => {
        overlay?.remove(); overlay = null;
        document.getElementById('vc-transcript-style')?.remove();
        active = false;
      };

      function tryNative() {
        const transcriptBtn = getElement('transcript');
        if (transcriptBtn) { transcriptBtn.click(); return true; }
        return false;
      }

      const makeOverlay = video => {
        overlay = createHTMLElement('div', { id: 'vc-transcript', innerHTML: `<div class="vc-transcript-header">Transcript <button class="vc-transcript-close">✕</button></div><div class="vc-transcript-body"></div>`});
        document.body.appendChild(overlay);
        makeElementDragAndResize(overlay, overlay.firstElementChild);

        document.head.appendChild(createHTMLElement('style', { id: 'vc-transcript-style', textContent: `
          #vc-transcript{position:fixed;right:20px;bottom:20px;width:300px;height:400px;background:rgba(0,0,0,.85);color:#fff;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;z-index:999999;box-shadow:0 0 10px rgba(0,0,0,.5);}
          .vc-transcript-header{padding:8px;background:rgba(255,255,255,.1);display:flex;justify-content:space-between;align-items:center;font-weight:bold;}
          .vc-transcript-close{background:0;border:0;color:#fff;font-size:18px;cursor:pointer;}.vc-transcript-body{flex:1;overflow-y:auto;padding:6px;font-size:14px;line-height:1.4;}
          .cue{padding:4px;border-radius:4px;cursor:pointer;}.cue.active{background:rgba(255,255,255,.2);}
        `}));

        overlay.querySelector('.vc-transcript-close').onclick = cleanup;

        const track = [...video.textTracks].find(t => /subtitles|captions/.test(t.kind));
        const body = overlay.querySelector('.vc-transcript-body');
        if (!track) { body.textContent = 'No transcript available'; return; }
        track.mode = 'hidden';

        if (!track.cues) { body.textContent = 'Transcript loading...'; return; }

        [...track.cues].forEach(cue => {
          const el = createHTMLElement('div', { className: 'cue', textContent: cue.text });
          el.dataset.start = cue.startTime;
          el.onclick = () => { video.currentTime = cue.startTime };
          body.appendChild(el);
        });

        track.addEventListener('cuechange', () => {
          [...body.children].forEach(e => e.classList.remove('active'));
          const ac = track.activeCues[0];
          if (ac) {
            const el = [...body.children].find(e => +e.dataset.start === ac.startTime);
            if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
          }
        });
      };

      return (e) => {
        if (e) stopEventPropagation(e);
        if (active) return cleanup();
        if (tryNative()) return;
        const video = getElement('video'); if (!video) return;
        makeOverlay(video); active = true;
      };
    })(),

    togglePlayerControls: (() => {
      let barCtrl=null, persistCtrl = null, observer=null, secondaryObserver=null, controlsPollId=null, forceMouseTimer=null, hideTimer=null;
      let bar, slider, barFill, barBuf, barTip, styleEl, video, player;
      let isNative = false, originalDisplay = '', desiredVisible = false;
      let nativeBar, containingControl, ancestors = [], intervened = false;
      let monitorEl,  originalParent = null, originalNextSibling = null, reparented = false;
      const MAX_NATIVE_ATTEMPTS = 10, isNativeDisabled = siteKey === 'sonyliv';
      let rAFId = null;

      function scheduleShowBar() {
        if (rAFId) cancelAnimationFrame(rAFId);
        rAFId = requestAnimationFrame(() => { rAFId = null; showBar(); });
      }

      const on = (el, ev, fn, opts={}) => el?.addEventListener(ev, fn, opts);
      const isVisible = el => { if (!el) return false; const style = getComputedStyle(el); return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetWidth > 0 && el.offsetHeight > 0; };

      function showBar() {
        if (!bar || !player || !video) return;
        if (isNative) {
          if (['Bar', 'Persist Bar', 'Default w/ Bar'].includes(PLAYER_CONTROL_MODES[config.modeIndex]) || intervened) {
            if (!reparented) {
              originalParent = bar.parentNode;
              originalNextSibling = bar.nextSibling;
              player.appendChild(bar);
              reparented = true;
            }
            let paddingBottom = 8;
            if (slider) {
              const computedStyle = getComputedStyle(slider);
              paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
              paddingBottom = 8 - paddingBottom;
            } else {
              bar.style.height = '4px';
            }
            bar.style.bottom = `${paddingBottom}px`;
            bar.style.position = 'absolute';
            bar.style.padding = '0';
            bar.style.left = '0';
            bar.style.right = '0';
            bar.style.zIndex = '99998';
            if (isYoutube) { bar.style.width = 'fit-content'; bar.style.justifySelf = 'center'; }
          }
          bar.style.display = originalDisplay || 'block';
          bar.style.opacity = '1';
          bar.style.visibility = 'visible';
          ancestors.forEach(anc => {
            anc.style.display = anc.dataset.vcOriginalDisplay || 'block';
            anc.style.opacity = '1';
            anc.style.visibility = 'visible';
          });
        } else {
          bar.classList.remove('hidden');
        }
      }

      function hideBar() {
        if (!bar) return;
        if (isNative) {
          bar.style.display = 'none';
        } else {
          bar.classList.add('hidden');
        }
      }

      function clearForceStyles() {
        if (!isNative || !bar) return;
        if (reparented && originalParent) {
          if (originalNextSibling) {
            originalParent.insertBefore(bar, originalNextSibling);
          } else {
            originalParent.appendChild(bar);
          }
          reparented = false;
        }
        // Reset all styles modified in showBar
        bar.style.display = originalDisplay || '';
        bar.style.opacity = '';
        bar.style.visibility = '';
        bar.style.position = '';
        bar.style.bottom = '';
        bar.style.top = '';
        bar.style.left = '';
        bar.style.right = '';
        bar.style.zIndex = '';
        bar.style.height = '';
        bar.style.padding = '';
        ancestors.forEach(anc => {
          anc.style.display = anc.dataset.vcOriginalDisplay || '';
          anc.style.opacity = '';
          anc.style.visibility = '';
          delete anc.dataset.vcOriginalDisplay;
        });
      }

      function hideSiblings(hide) {
        if (!isNative || !containingControl || !bar) return;
        let current = bar;
        while (current && current !== containingControl && current.parentNode) {
          let parent = current.parentNode;
          Array.from(parent.children).forEach(sib => {
            if (sib !== current) {
              sib.classList.toggle('vc-hide', hide);
            }
          });
          current = parent;
        }
      }

      function initBar() {
        if (bar) return;
        player = getElement('player'); player.style.position ||= 'relative'; video = getElement('video'); if (!player||!video) return;

        if (!styleEl) {
          styleEl = createHTMLElement('style', { id: 'vc-progress-style', textContent: `
            .vc-hide { display: none !important; }
            #vc-mini-bar { border-radius: 2px; position:absolute; left:0; right:0; bottom:8px; margin: 0 24px; height:4px; z-index:99998;
              background:rgba(20,20,20,.35); backdrop-filter:blur(2px); border-top:1px solid rgba(255,255,255,.08);
              cursor:pointer; transition:opacity .25s ease; }
            #vc-mini-bar.hidden { opacity:0; pointer-events:none }
            #vc-mini-bar .track { border-radius: 2px; position:absolute; inset:0 }
            #vc-mini-bar .buffer { border-radius: 2px; position:absolute; left:0; top:0; bottom:0; width:0%; background:rgba(255,255,255,.25) }
            #vc-mini-bar .fill { border-radius: 2px; position:absolute; left:0; top:0; bottom:0; width:0%; background:#ae1111; transition: background-color 720ms ease; }
            #vc-mini-bar.paused .fill { background:#5e676491 }
            #vc-mini-bar .tip { border-radius: 2px; position:absolute; bottom:10px; transform:translateX(-50%); padding:2px 6px; font:12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
              color:#fff; background:rgba(0,0,0,.75); border-radius:4px; pointer-events:none; opacity:0; transition:opacity .15s ease; white-space:nowrap }
            #vc-mini-bar.show-tip .tip { opacity:1 }
          `}); document.head.appendChild(styleEl);
          registerCleanup(()=>{ styleEl?.remove(); styleEl=null; });
        }

        const controls = getElement('playerControlsList', true) || [];

        const tryInitBar = (attempt = 1, maxAttempts = MAX_NATIVE_ATTEMPTS, interval = 500) => {
          nativeBar = getElement('progressBar', true);
          if (nativeBar && !isNativeDisabled) {
            bar = nativeBar;
            const sliderSelector = getElementSelector('progressSlider')
            if (sliderSelector) slider = bar.querySelector(sliderSelector);
            isNative = true;
            originalDisplay = getComputedStyle(bar).display;
            ancestors = [];
            let current = bar.parentNode;
            while (current && current !== document.body && current !== player) {
              ancestors.push(current);
              current.dataset.vcOriginalDisplay = getComputedStyle(current).display;
              current = current.parentNode;
            }
            containingControl = controls.find(c => c.contains(bar));
            monitorEl = containingControl || ancestors[ancestors.length - 1] || bar; if (desiredVisible) scheduleShowBar();
          } else if (attempt < maxAttempts) {
            setTimeout(() => tryInitBar(attempt + 1, maxAttempts, interval), interval);
          } else {
            isNative = false;
            bar=createHTMLElement('div',{id:'vc-mini-bar',innerHTML:'<div class="track"></div><div class="buffer"></div><div class="fill"></div><div class="tip"></div>'});
            player.style.position ||= 'relative'; player.appendChild(bar);
            [barFill,barBuf,barTip]=['.fill','.buffer','.tip'].map(s=>bar.querySelector(s));

            const moveTo = x => { if (!video||!video.duration) return; const r=bar.getBoundingClientRect(), pct=Math.min(1,Math.max(0,(x-r.left)/r.width)); video.currentTime=pct*video.duration; barTip.textContent=formatTime(pct*video.duration); barTip.style.left=`${pct*100}%`; };

            const onDown = e => {
              stopEventPropagation(e); bar.classList.add('show-tip'); moveTo(e.clientX??e.touches?.[0]?.clientX??0);
              const mm=ev=>moveTo(ev.clientX), tm=ev=>moveTo(ev.touches[0].clientX),
                    up=()=>{ bar.classList.remove('show-tip'); window.removeEventListener('mousemove',mm,true); window.removeEventListener('mouseup',up,true); window.removeEventListener('touchmove',tm,{capture:true}); window.removeEventListener('touchend',up,{capture:true}); };
              window.addEventListener('mousemove',mm,true); window.addEventListener('mouseup',up,true);
              window.addEventListener('touchmove',tm,{capture:true,passive:true}); window.addEventListener('touchend',up,{capture:true});
            };

            const update = () => { if (!video||!video.duration) return;
              barFill.style.width=`${(video.currentTime/video.duration)*100}%`;
              try { let end=0,b=video.buffered; for (let i=0;i<b.length;i++) end=Math.max(end,b.end(i));
                barBuf.style.width=`${(end/video.duration)*100}%`; } catch {}
            };

            barCtrl=new AbortController(); const {signal}=barCtrl;
            on(bar, 'mousedown' ,onDown ,{ capture:true, signal });
            on(bar, 'touchstart', onDown, { capture:true, passive:true, signal });
            on(video, 'pause', () => { bar.classList.toggle('paused', true) }, { capture: true, passive: true, signal });
            on(video, 'play', () => { bar.classList.toggle('paused', false) }, { capture: true, passive: true, signal });
            on(video, 'timeupdate', update , {signal, passive: true });
            on(video, 'progress', update ,{ signal, passive:true });
            on(video, 'loadedmetadata', update ,{ signal, passive: true});

            monitorEl = controls[0]; if (desiredVisible) scheduleShowBar();
            customProgressBar = bar;
          }
        }

        isNativeDisabled ? tryInitBar(MAX_NATIVE_ATTEMPTS) : tryInitBar();
        registerCleanup(()=>{ if (!isNative) { barCtrl?.abort(); if (bar) bar.remove(); } else { clearForceStyles(); ancestors.forEach(anc => delete anc.dataset.vcOriginalDisplay); } bar=null; });
      }

      const toggleSiteControls = hide => {
        const controls = getElement('playerControlsList', true) || [];
        if (!controls.length) {
          const obs = new MutationObserver(() => {
            const l = getElement('playerControlsList', true);
            if (l?.length) {
              toggleSiteControls(hide);
              safeAbort(obs);
            }
          });
          const p = getElement('player');
          if (p) {
            obs.observe(p, { childList: true, subtree: true });
            registerCleanup(() => safeAbort(obs));
          }
          return;
        }
        controls.forEach(control => {
          if (isNative && bar && control.contains(bar)) {
            control.classList.toggle('vc-hide', false); // Never hide control containing bar
            hideSiblings(hide);
          } else {
            control.classList.toggle('vc-hide', hide);
          }
        });
      };

      function attachAutoHide() {
        if (!player||!bar) return;
        barCtrl=new AbortController(); const {signal}=barCtrl; let overP=false, overB=false;
        const schedule=(time)=>{ if (!time) { time = !overP&&!overB ? 300 : 1800; } hideTimer=safeClear(hideTimer); hideTimer=setTimeout(() => { desiredVisible = false; hideBar(); },time); };
        const tgt=isYoutube||requireVideoElement?getElement('video'):getElement('player');
        on(tgt,'mousemove',()=>{ overP=true; desiredVisible = true; scheduleShowBar(); schedule(); },{capture:true,signal});
        on(tgt,'mouseleave',()=>{ overP=false; schedule(); },{capture:true,signal});
        on(bar,'mouseenter',()=>{ overB=true; desiredVisible = true; scheduleShowBar(); schedule(); },{capture:true,signal});
        on(bar,'mouseleave',()=>{ overB=false; schedule(); },{capture:true,signal});
        desiredVisible = false; hideBar(); schedule(2400);
      }

      function observeForPersist() {
        if (!bar || !player) return;
        persistCtrl = new AbortController(); const { signal } = persistCtrl;
        let overP = false, overB = false;
        let switchTimer = null, inPersistentMode = false;
        const enterDefaultMode = () => {if (inPersistentMode) { inPersistentMode = false; setMode(PLAYER_CONTROL_MODES[0], true); }};

        const enterPersistentMode = () => {if (!inPersistentMode) { inPersistentMode = true; setMode(PLAYER_CONTROL_MODES[3], true); }};

        const schedule = () => {
          switchTimer = safeClear(switchTimer);

          if (overP && overB) { enterDefaultMode(); switchTimer = setTimeout(() => enterPersistentMode(), 3000); }
          if (!overP && !overB) switchTimer = setTimeout(() => enterPersistentMode(), 320);
        };
        const tgt=isYoutube||requireVideoElement?getElement('video'):getElement('player');
        on(tgt, 'mousemove', () => { overP = true; schedule(); }, { capture: true, signal });
        on(tgt, 'mouseleave', () => { overP = false; schedule(); }, { capture: true, signal });
        on(bar, 'mouseenter', () => { overB = true; schedule(); }, { capture: true, signal });
        on(bar, 'mouseleave', () => { overB = false; schedule(); }, { capture: true, signal });
        schedule();
      }

      function cleanupObservers(softClean = false) {
        if (!softClean) persistCtrl=safeAbort(persistCtrl);
        observer=safeAbort(observer); barCtrl=safeAbort(barCtrl);
        controlsPollId=safeClear(controlsPollId); hideTimer=safeClear(hideTimer); forceMouseTimer=safeClear(forceMouseTimer);
        clearForceStyles(); hideSiblings(false); intervened = false;
        if (bar && !isNative) bar?.remove();
        bar=null;
      }

      function startForceMouse() {
        const p=getElement('player'); if (!p) return; let off=10;
        const poke=()=>{
          const r=p.getBoundingClientRect(); off=off===10?12:10;
          p.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,cancelable:true,clientX:r.left+off,clientY:r.top+off}));
        };
        poke();
        forceMouseTimer=setInterval(poke,400); registerCleanup(()=>forceMouseTimer=safeClear(forceMouseTimer));
      }

      const modeHandlers = {
        'Default':()=>{},
        'Default w/ Bar':()=>{ initBar(); observeForPersist(); },
        'Bar':()=>{ initBar(); toggleSiteControls(true); attachAutoHide(); },
        'Persist Bar':()=>{ desiredVisible = true; initBar(); toggleSiteControls(true); scheduleShowBar(); },
        'Persist Default':()=>{ toggleSiteControls(false); startForceMouse(); }
      };

      function setMode(mode, softClean = false) {
        cleanupObservers(softClean); toggleSiteControls(false);
        video=getElement('video'); player=getElement('player'); if (!video||!player) return;
        modeHandlers[mode]?.(); logMessage(`Active Player Controls Mode: ${mode.replace('-', ' ')}`);
      }

      return (i = config.modeIndex + 1) => { if ( i === PLAYER_CONTROL_MODES.length ) i = 0; config.modeIndex = i; persistConfig(config); setMode(PLAYER_CONTROL_MODES[i]); };
    })(),

    toggleStickyVideo: (() => {
      let enabled = false, persistState = false, autoMode = true, stuck = false, isTheatre = false;
      let observer = null, resizeObs = null, miniPlayerObserver = null, stickyCtrl = null;
      let videoEl = null, playerEl = null, originalParent = null, placeholder = null,
          sticky = null, header = null, prevVideoStyle = null, resizer = null, stickyAspectRatio = null;

      const isVisible = el => {
        if (!el) return false;
        const style = getComputedStyle(el);
        return (
          style.display !== 'none' && style.visibility !== 'hidden' &&
          parseFloat(style.opacity) !== 0 &&
          el.offsetWidth > 0 && el.offsetHeight > 0
        );
      };

      function updateStickySize() {
        if (!stuck || !videoEl.videoWidth || !videoEl.videoHeight) return;
        const aspectRatio = videoEl.videoWidth / videoEl.videoHeight;
        const currentWidth = parseFloat(sticky.style.width) || 320;
        sticky.style.height = `${currentWidth / aspectRatio}px`;
        if (resizer && typeof resizer.updateAspectRatio === 'function') {
          resizer.updateAspectRatio(aspectRatio);
        }
        Object.assign(videoEl.style, { width: '100%', height: '100%', display: 'block' });
      }

      function appendVideoEl(container) {
        try {
          container?.appendChild(videoEl);
        } catch (e) {
          logWarning("Failed to reattach video:", e);
          originalParent?.appendChild(videoEl);
        }
      }

      function restoreOriginalState() {
        if (prevVideoStyle) {
          Object.assign(videoEl.style, prevVideoStyle);
          prevVideoStyle = null;
        }
        if (isTheatre && stickyAspectRatio) {
          requestAnimationFrame(() => {
            const restoredHeight = videoEl.getBoundingClientRect().height;
            videoEl.style.height = restoredHeight + 'px';
            videoEl.style.width = (restoredHeight * stickyAspectRatio) + 'px';
          });
        }
      }

      function initElements() {
        originalParent = videoEl.parentNode;

        // placeholder (preserves layout)
        placeholder = createHTMLElement('div', { style: {
          display: 'none',
          width: playerEl.offsetWidth + 'px',
          height: playerEl.offsetHeight + 'px'
        } });

        // floating wrapper
        sticky = createHTMLElement('div', { style: {
          position: 'fixed', top: '8px', left: '8px',
          width: '320px', height: '180px', zIndex: 99999,
          background: '#000', display: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          borderRadius: '8px', overflow: 'hidden',
        }});

        // overlay header
        header = createHTMLElement('div', { style: {
          position: 'absolute', inset: '0', zIndex: 1,
          cursor: 'auto', background: 'black', opacity: videoEl.paused ? '0.4' : '0',
          touchAction: 'none', transition: 'opacity 0.2s ease'
        }});

        sticky.appendChild(header);
        document.body.appendChild(sticky);

        resizer = makeElementDragAndResize(sticky, header, {
          minWidth: 200, minHeight: 112, initWidth: 320, initHeight: 180, lockAspectRatio: true,
          aspectRatio: (videoEl.videoWidth && videoEl.videoHeight) ? (videoEl.videoWidth / videoEl.videoHeight) : (16 / 9),
          onClick: () => {
            if (videoEl.paused) videoEl.play().catch(() => {});
            else videoEl.pause();
          },
        });

        stickyCtrl = new AbortController();
        const { signal } = stickyCtrl;
        header.addEventListener('wheel', ev => ev.stopPropagation(), { capture: true, passive: true, signal });
        header.addEventListener('dblclick', () => {
          if (stuck) {
            unstick();
            videoEl.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, { signal: stickyCtrl.signal });
        videoEl.addEventListener('pause', () => { header.style.opacity = 0.4 }, { capture: true, passive: true, signal });
        videoEl.addEventListener('play', () => { header.style.opacity = 0 }, { capture: true, passive: true, signal });
        videoEl.addEventListener('loadedmetadata', updateStickySize, { signal });
        videoEl.addEventListener('resize', updateStickySize, { signal });
      }

      function stick() {
        if (stuck) return;
        if (isYoutube) {
          const miniPlayer = getElement('miniPlayer');
          if (miniPlayer && isVisible(miniPlayer)) return; // Don't stick if native miniplayer is active
        }
        placeholder.style.display = 'block';
        originalParent.replaceChild(placeholder, videoEl);
        sticky.insertBefore(videoEl, header);
        sticky.style.display = 'block';
        prevVideoStyle = {
          width: videoEl.style.width, height: videoEl.style.height,
          display: videoEl.style.display, pointerEvents: videoEl.style.pointerEvents || '',
          left: videoEl.style.left, top: videoEl.style.top
        };
        Object.assign(videoEl.style, { width: '100%', height: '100%', display: 'block', pointerEvents: 'none', left: '0px', top: '0px' });
        updateStickySize();
        stuck = true;
      }

      function unstick() {
        if (!stuck) return;
        stickyAspectRatio = sticky.getBoundingClientRect().width / sticky.getBoundingClientRect().height;
        sticky.style.display = 'none';

        if (isYoutube) {
          const miniPlayer = getElement('miniPlayer');
          if (miniPlayer && isVisible(miniPlayer)) {
            const videoContainer = miniPlayer.querySelector('.html5-video-container') || originalParent;
            appendVideoEl(videoContainer);
          } else {
            const mainPlayerContainer = playerEl.querySelector('.html5-video-container') || originalParent;
            appendVideoEl(mainPlayerContainer);
          }
        } else {
          originalParent.replaceChild(videoEl, placeholder);
        }

        restoreOriginalState();

        if (isYoutube) {
          window.dispatchEvent(new Event('resize'));
          videoEl.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
        }

        stuck = false;
      }

      function enable(opts = { auto: true, stick: false }) {
        if (enabled) return; playerEl = getElement('player'); videoEl = getElement('video');
        if (!playerEl || !videoEl || !isVisible(videoEl) || (!videoEl.paused && !videoEl.ended && !(videoEl.videoWidth > 0 && videoEl.videoHeight > 0))) {
          return;
        }

        autoMode = opts.auto; initElements();

        const mo = new MutationObserver(() => {
          const newVideo = getElement('video');
          if (!newVideo) return;
          if (newVideo !== videoEl) { disable(); enable({ auto: autoMode, stick: stuck }); }
        });

        mo.observe(document.body, { childList: true, subtree: true });
        stickyCtrl.signal.addEventListener('abort', () => mo.disconnect());

        resizeObs = new ResizeObserver(() => {
          if (placeholder) {
            placeholder.style.width = playerEl.offsetWidth + 'px';
            placeholder.style.height = playerEl.offsetHeight + 'px';
          }
        });
        resizeObs.observe(playerEl);
        stickyCtrl.signal.addEventListener('abort', () => resizeObs?.disconnect());

        if (isYoutube) { // Monitor YouTube mini player visibility in both auto and manual modes
          const miniPlayerContainer = getElement('miniPlayer') || document.body;
          miniPlayerObserver = new MutationObserver(() => {
            const miniPlayer = getElement('miniPlayer');
            if (miniPlayer && isVisible(miniPlayer) && stuck) unstick();
          });
          miniPlayerObserver.observe(miniPlayerContainer, { attributes: true, childList: true, subtree: true });
          stickyCtrl.signal.addEventListener('abort', () => miniPlayerObserver?.disconnect());
        }

        if (autoMode) {
          let ignoreUntil = 0;

          function setIgnore(duration = 600) { ignoreUntil = Date.now() + duration; }

          document.addEventListener("fullscreenchange", () => setIgnore());
          document.addEventListener("webkitfullscreenchange", () => setIgnore());

          if (isYoutube) {
            const attachTheatreObserver = (flexy) => {
              if (!flexy) return;
              const theatreObs = new MutationObserver(muts => {
                if (muts.some(m => m.attributeName === "theater")) setIgnore();
              });
              theatreObs.observe(flexy, { attributes: true, attributeFilter: ["theater"] });
              stickyCtrl?.signal?.addEventListener("abort", () => theatreObs.disconnect());
            };

            const flexyFinder = new MutationObserver(() => {
              const flexy = document.querySelector("ytd-watch-flexy");
              if (flexy) { isTheatre = true; attachTheatreObserver(flexy); }
              else isTheatre = false;
            });
            flexyFinder.observe(document.documentElement, { childList: true, subtree: true });
            stickyCtrl?.signal?.addEventListener("abort", () => flexyFinder.disconnect());

            attachTheatreObserver(document.querySelector("ytd-watch-flexy"));
          }

          observer = new IntersectionObserver(([entry]) => {
            if (Date.now() < ignoreUntil) { return; }
            if (entry.intersectionRatio < 0.4 && !stuck) stick();
            else if (entry.intersectionRatio >= 0.4 && stuck) unstick();
          }, { threshold: [0.4] });

          const target = (originalParent && originalParent.isConnected) ? originalParent : (playerEl || videoEl);
          if (target) { observer.observe(target); }
        } else {
          if (opts.stick) stick();
          else unstick();
        }

        enabled = true;
        if (persistState) { config.stickyVideoEnabled = true; persistConfig(config); }
        showNotification(`Sticky Video Enabled (${autoMode ? 'Auto' : 'Manual'})`);
      }

      function disable() {
        if (!enabled) return;
        observer?.disconnect(); observer = null;
        miniPlayerObserver?.disconnect(); miniPlayerObserver = null;
        resizeObs?.disconnect(); resizeObs = null;
        stickyCtrl?.abort(); stickyCtrl = null;
        unstick(); restoreOriginalState();

        placeholder?.remove(); sticky?.remove();
        placeholder = sticky = header = null;
        resizer = null;

        stuck = false; enabled = false;
        if (persistState) { config.stickyVideoEnabled = false; persistConfig(config); }
        showNotification('Sticky Video Disabled');
      }

      return Object.assign(() => { persistState = true; enabled ? disable() : enable(); }, {
        enable: (opts = { auto: true, stick: false }) => { persistState = true; enable(opts); },
        disable: () => { persistState = true; disable(); },
        unstick: () => { persistState = false; disable(); },
        stick: () => { persistState = false; disable(); enable({ auto: false, stick: true }); },
        toggle: () => {
          persistState = false;
          if (stuck) { disable(); enable({ auto: config.stickyVideoEnabled, stick: false }); }
          else { disable(); enable({ auto: false, stick: true }); }
        }
      });
    })(),

  };

  // ----------------------------------
  // Equalizer init
  // ----------------------------------
  function initAudioChannelsFromConfig() {
    if (eqDisabled) return;
    if (!config.audioState.active) return;
    const video = getElement('video');
    if (!video) return;

    if (!canUseMediaElementSource(video)) {
      eqDisabled = true;
      logWarning(
        'EQ disabled: external video source (CORS). Leaving audio untouched.'
      );
      showNotification('EQ disabled: external video source (CORS)');
      return;
    }

    if (audioState.source && audioState.source.mediaElement === video) {
      return;
    }

    attachCtxSource('initAudioChannelsFromConfig');

    if (audioState.ui) {
      audioState.ui.remove();
      audioState.ui = null;
      createEqUI(audioState.filters);
    }
  }

  // ----------------------------------
  // Toolbox Manager
  // ----------------------------------
  class IconFactory {
    _svg(viewBox, paths, width = 20, height = 20) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', viewBox);
      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      svg.setAttribute('class', 'icon');
      paths.forEach(attrs => {
        const path = document.createElementNS(ns, 'path');
        if (!attrs.hasOwnProperty('fill')) {
          path.setAttribute('fill', '#000000');
        }
        for (let key in attrs) {
          path.setAttribute(key, attrs[key]);
        }
        svg.appendChild(path);
      });
      return svg;
    }
    gear() {
      return this._svg('0 0 1024 1024', [
        {
          d: 'M449.194667 82.346667a128 128 0 0 1 125.610666 0l284.16 160a128 128 0 0 1 65.194667 111.530666v316.245334a128 128 0 0 1-65.194667 111.530666l-284.16 160a128 128 0 0 1-125.610666 0l-284.16-160a128 128 0 0 1-65.194667-111.530666V353.877333A128 128 0 0 1 165.034667 242.346667z m83.754666 74.410666a42.666667 42.666667 0 0 0-41.898666 0L206.933333 316.714667a42.666667 42.666667 0 0 0-21.76 37.162666v316.245334a42.666667 42.666667 0 0 0 21.76 37.162666l284.16 160a42.666667 42.666667 0 0 0 41.898667 0l284.16-160a42.666667 42.666667 0 0 0 21.76-37.162666V353.877333a42.666667 42.666667 0 0 0-21.76-37.162666zM512 341.333333a170.666667 170.666667 0 1 1 0 341.333334 170.666667 170.666667 0 0 1 0-341.333334z m0 85.333334a85.333333 85.333333 0 1 0 0 170.666666 85.333333 85.333333 0 0 0 0-170.666666z',
        },
      ]);
    }
    shortDownload() {
      return this._svg(
        '0 0 1024 1024',
        [
          {
            d: 'M0 0m512 0l0 0q512 0 512 512l0 0q0 512-512 512l0 0q-512 0-512-512l0 0q0-512 512-512Z',
            opacity: '0.7',
          },
          {
            d: 'M671.1552 727.2192H350.4128a95.7696 95.7696 0 0 1-96.2304-95.104v-190.2336a31.872 31.872 0 0 1 32.0768-31.7184 31.872 31.872 0 0 1 32.0768 31.7184v190.2336a31.9232 31.9232 0 0 0 32.0768 31.6928h320.7424a31.9232 31.9232 0 0 0 32.0768-31.6928v-190.2336a32.0768 32.0768 0 0 1 64.1536 0v190.2336a95.7696 95.7696 0 0 1-96.2304 95.104z',
            fill: '#FFFFFF',
          },
          {
            d: 'M499.1232 563.7376a16.5632 16.5632 0 0 0 23.3472 0l108.7744-108.8256c6.4256-6.4256 4.2496-11.6736-4.8384-11.6736h-33.0496a16.5632 16.5632 0 0 1-16.512-16.5376v-66.0992a16.5376 16.5376 0 0 0-16.512-16.512h-99.0976a16.5632 16.5632 0 0 0-16.512 16.512v66.0992a16.5632 16.5632 0 0 1-16.512 16.5376h-33.1008c-9.088 0-11.264 5.248-4.8384 11.6736z',
            fill: '#FFFFFF',
          },
          {
            d: 'M446.2336 294.5792a16.512 16.512 0 1 1 16.512 16.5376 16.5376 16.5376 0 0 1-16.512-16.5376z',
            fill: '#FFFFFF',
          },
          {
            d: 'M542.2848 294.5792a16.512 16.512 0 1 1 16.512 16.5376 16.5376 16.5376 0 0 1-16.512-16.5376z',
            fill: '#FFFFFF',
          },
          {
            d: 'M461.2352 277.9904h99.0976v33.0496h-99.0976z',
            fill: '#FFFFFF',
          },
        ],
        32,
        32
      );
    }
    camera() {
      return this._svg('0 0 1024 1024', [
        {
          d: 'M924.49999971 755.74999971h-93.74999942V287c0-52.49999971-41.24999971-93.75000029-93.75000029-93.75000029H268.25000029V99.50000029c0-22.5-15.00000029-37.50000029-37.50000029-37.50000029s-37.50000029 15.00000029-37.50000029 37.50000029v93.74999942H99.50000029c-22.5 0-37.50000029 15.00000029-37.50000029 37.50000029s15.00000029 37.50000029 37.50000029 37.50000029h93.74999942V737c0 52.49999971 41.24999971 93.75000029 93.75000029 93.75000029h468.74999971V924.49999971c0 22.5 15.00000029 37.50000029 37.50000029 37.50000029s37.50000029-15.00000029 37.50000029-37.50000029v-93.74999942H924.49999971c22.5 0 37.50000029-15.00000029 37.50000029-37.50000029s-15.00000029-37.50000029-37.50000029-37.50000029z m-187.49999971-487.49999942c11.25 0 18.74999971 7.49999971 18.74999971 18.74999971v299.99999971l-127.49999942-123.75c-15.00000029-15.00000029-37.50000029-15.00000029-52.50000058 0l-123.75 127.50000029L399.5 538.25000029c-15.00000029-15.00000029-33.75-15.00000029-48.75000029-3.75000029l-78.75 63.74999971V268.25000029H737z m-450 487.49999942c-11.25 0-18.74999971-7.49999971-18.74999971-18.74999971v-37.50000029l101.25-82.49999942 56.25 56.25c7.49999971 7.49999971 15.00000029 11.25 26.24999942 11.25s18.74999971-3.75000029 26.25000029-11.25l123.75-127.50000029 153.74999971 146.25v63.74999971H287z',
        },
        {
          d: 'M399.5 485.74999971c45 0 82.50000029-37.50000029 82.50000029-82.49999942s-37.50000029-82.50000029-82.50000029-82.50000029-82.50000029 33.75-82.50000029 78.75 37.50000029 86.24999971 82.50000029 86.24999971z m0-112.5c15.00000029 0 29.99999971 11.25 29.99999971 30.00000058s-15.00000029 26.25000029-29.99999971 26.24999942-29.99999971-15.00000029-29.99999971-29.99999971 15.00000029-26.25000029 29.99999971-26.25000029z',
        },
      ]);
    }
    pip() {
      return this._svg('0 0 24 24', [
        { d: 'M0 0h24v24H0z', fill: 'none' },
        {
          d: 'M11 19h-6a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v4',
        },
        {
          d: 'M14 14m0 1a1 1 0 0 1 1 -1h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1z',
        },
      ]);
    }
    download() {
      return this._svg('0 0 1024 1024', [
        { d: 'M32 32h960v960H32z', 'fill-opacity': '0', 'p-id': '1747' },
        {
          d: 'M852.00000031 476.54c21.07999969 0 38.35999969 16.51999969 39.9 37.5l0.09999938 3.01999969v212.80000031C891.99999969 819.42000031 820.35999969 891.99999969 732.00000031 891.99999969H291.99999969c-88.36000031 0-160.00000031-72.6-159.99999938-162.13999969v-212.80000031l0.09999938-3A40.21999969 40.21999969 0 0 1 171.99999969 476.52000031c21.07999969 0 38.35999969 16.51999969 39.9 37.5l0.10000031 3.01999969v212.80000031c0 44.77999969 35.80000031 81.07999969 79.99999969 81.07999969h440.00000062c44.20000031 0 79.99999969-36.3 79.99999969-81.07999969v-212.80000031l0.10000031-3A40.21999969 40.21999969 0 0 1 852.00000031 476.52000031zM512 132.00000031a40.00000031 40.00000031 0 0 1 40.00000031 39.99999938v342.24l99.63999938-104.13999938a45.94000031 45.94000031 0 0 1 66.46000031 0.06 50.4 50.4 0 0 1-0.06 69.6l-170.34 178.03999969a45.94000031 45.94000031 0 0 1-66.28000031 0.13999969 46.62 46.62 0 0 1-4.38-4.03999969l-170.34-178.02a50.4 50.4 0 0 1-0.06-69.6 45.94000031 45.94000031 0 0 1 64.96000031-1.57999969l1.5 1.5L471.99999969 509.55999969V171.99999969a40.00000031 40.00000031 0 0 1 40.00000031-39.99999938z',
          'p-id': '1748',
        },
      ]);
    }
    toolbox() {
      return this._svg(
        '0 0 1024 1024',
        [
          {
            d: 'M364.999 128.853H158.28c-52.383 0-95 42.617-95 95v206.719c0 52.383 42.617 95 95 95h206.719c52.383 0 95-42.617 95-95V223.853c0-52.384-42.617-95-95-95zM364.999 562.39H158.28c-52.383 0-95 42.617-95 95v206.719c0 52.383 42.617 95 95 95h206.719c52.383 0 95-42.617 95-95V657.39c0-52.383-42.617-95-95-95zM943.066 230.037L796.895 83.865c-17.943-17.943-41.8-27.825-67.175-27.825-25.376 0-49.232 9.881-67.175 27.825L516.372 230.037c-37.041 37.041-37.041 97.31 0 134.35l146.172 146.172c17.943 17.943 41.8 27.825 67.176 27.825 25.375 0 49.231-9.882 67.175-27.825l146.172-146.172c17.943-17.943 27.825-41.8 27.825-67.175s-9.882-49.233-27.826-67.175z m-21.212 113.137L775.682 489.346c-12.277 12.277-28.601 19.038-45.962 19.038-17.362 0-33.686-6.761-45.963-19.038L537.585 343.174c-25.343-25.344-25.343-66.581 0-91.924l146.173-146.172c12.276-12.277 28.6-19.038 45.962-19.038 17.361 0 33.685 6.761 45.962 19.038L921.854 251.25c12.276 12.277 19.038 28.6 19.038 45.962s-6.762 33.685-19.038 45.962zM798.887 562.39H592.168c-52.383 0-95 42.617-95 95v206.719c0 52.383 42.617 95 95 95h206.719c52.383 0 95-42.617 95-95V657.39c0-52.383-42.617-95-95-95z',
            fill: '#ffffff',
          },
        ],
        22,
        22
      );
    }
    rotateCW() {
      return this._svg('0 0 48 48', [
        {
          d: 'M4 24C4 35.0457 12.9543 44 24 44L19 39',
          stroke: 'currentColor',
          'stroke-width': '4',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
        {
          d: 'M44 24C44 12.9543 35.0457 4 24 4L29',
          stroke: 'currentColor',
          'stroke-width': '4',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
        {
          d: 'M30 41L7 18L18 7L41 30L30 41Z',
          stroke: 'currentColor',
          'stroke-width': '4',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
      ]);
    }
    flipH() {
      return this._svg('0 0 24 24', [
        {
          d: 'M2 18.114V5.886c0-1.702 0-2.553.542-2.832.543-.28 1.235.216 2.62 1.205l1.582 1.13c.616.44.924.66 1.09.982C8 6.694 8 7.073 8 7.83v8.34c0 .757 0 1.136-.166 1.459-.166.323-.474.543-1.09.983l-1.582 1.13c-1.385.988-2.077 1.483-2.62 1.204C2 20.666 2 19.816 2 18.114ZM22 18.114V5.886c0-1.702 0-2.553-.542-2.832-.543-.28-1.235.216-2.62 1.205l-1.582 1.13c-.616.44-.924.66-1.09.982C16 6.694 16 7.073 16 7.83v8.34c0 .757 0 1.136.166 1.459.166.323.474.543 1.09.983l1.581 1.13c1.386.988 2.078 1.483 2.62 1.204.543-.28.543-1.13.543-2.832Z',
          fill: '#000000',
        },
        {
          d: 'M12 1.25a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0V2a.75.75 0 0 1 .75-.75Zm0 8a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Zm0 8a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Z',
          fill: '#000000',
          'fill-rule': 'evenodd',
          'clip-rule': 'evenodd',
        },
      ]);
    }
    flipV() {
      return this._svg('0 0 24 24', [
        {
          d: 'M18.114 22H5.886c-1.702 0-2.553 0-2.832-.542-.28-.543.216-1.235 1.205-2.62l1.13-1.582c.44-.616.66-.924.982-1.09C6.694 16 7.073 16 7.83 16h8.34c.757 0 1.136 0 1.459.166.323.166.543.474.983 1.09l1.13 1.581c.988 1.386 1.483 2.078 1.204 2.62-.28.543-1.13.543-2.832.543ZM18.114 2H5.886c-1.702 0-2.553 0-2.832.542-.28.543.216 1.235 1.205 2.62l1.13 1.582c.44.616.66.924.982 1.09C6.694 8 7.073 8 7.83 8h8.34c.757 0 1.136 0 1.459-.166.323-.166.543-.474.983-1.09l1.13-1.582c.988-1.385 1.483-2.077 1.204-2.62C20.666 2 19.816 2 18.114 2Z',
          fill: '#000000',
        },
        {
          d: 'M1.25 12a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5H2a.75.75 0 0 1-.75-.75Zm8 0a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Zm8 0a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Z',
          fill: '#000000',
          'fill-rule': 'evenodd',
          'clip-rule': 'evenodd',
        },
      ]);
    }
    micOn() {
      return this._svg('0 0 24 24', [
        { d: 'M0 0h24v24H0z', fill: 'none' },
        { d: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z' },
        {
          d: 'M19 11a7 7 0 0 1-14 0',
          stroke: '#000',
          'stroke-width': '2',
          fill: 'none',
        },
        { d: 'M2 2l20 20', stroke: '#000', 'stroke-width': '2' },
      ]);
    }
    micOff() {
      return this._svg('0 0 24 24', [
        { d: 'M0 0h24v24H0z', fill: 'none' },
        { d: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z' },
        {
          d: 'M19 11a7 7 0 0 1-14 0',
          stroke: '#000',
          'stroke-width': '2',
          fill: 'none',
        },
      ]);
    }
    gif() {
      return this._svg('0 0 24 24', [
        { d: 'M0 0h24v24H0z', fill: 'none' },
        { d: 'M3 8h4v2H5v4h2v2H3V8z' }, // 'G'
        { d: 'M9 8h2v8H9z' }, // 'I'
        { d: 'M13 8h6v2h-4v2h3v2h-3v2h-2V8z' }, // 'F'
      ]);
    }
    zoom() {
      return this._svg('0 0 24 24', [
        { d: 'M0 0h24v24H0z', fill: 'none' },
        {
          d: 'M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0',
          stroke: '#000',
          'stroke-width': '2',
          fill: 'none',
        }, // Lens
        {
          d: 'M16 16l5 5',
          stroke: '#000',
          'stroke-width': '2',
          'stroke-linecap': 'round',
        }, // Handle
      ]);
    }
    hide() {
      return this._svg('0 0 24 24', [
        { d: 'M0 0h24v24H0z', fill: 'none' },
        { d: 'M3 3l18 18', stroke: '#000', 'stroke-width': '2' },
        {
          d: 'M10.585 10.585a3 3 0 0 0 4.243 4.243',
          stroke: '#000',
          'stroke-width': '2',
        },
        {
          d: 'M17.94 17.94C16.21 18.625 14.17 19 12 19c-5 0-9.27-3.11-11-7 1.088-2.47 3.1-4.49 5.566-5.575',
          stroke: '#000',
          'stroke-width': '2',
          fill: 'none',
        },
      ]);
    }
    shuffle() {
      return this._svg('0 0 24 24', [
        { d: 'M0 0h24v24H0z', fill: 'none' },
        {
          d: 'M18 4l3 3-3 3',
          stroke: '#000',
          'stroke-width': '2',
          fill: 'none',
        },
        {
          d: 'M3 17h4l4-6 4 6h6',
          stroke: '#000',
          'stroke-width': '2',
          fill: 'none',
        },
        { d: 'M3 7h4l4 6', stroke: '#000', 'stroke-width': '2', fill: 'none' },
        {
          d: 'M18 20l3-3-3-3',
          stroke: '#000',
          'stroke-width': '2',
          fill: 'none',
        },
      ]);
    }
    equalizer() {
      return this._svg('0 0 24 24', [
        { d: 'M0 0h24v24H0z', fill: 'none' },

        // left slider rail and knob
        {
          d: 'M6 4v16',
          stroke: '#000',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          fill: 'none',
        },
        { d: 'M6 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', fill: '#000' },

        // middle slider rail and knob
        {
          d: 'M12 4v16',
          stroke: '#000',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          fill: 'none',
        },
        { d: 'M12 12a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', fill: '#000' },

        // right slider rail and knob
        {
          d: 'M18 4v16',
          stroke: '#000',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          fill: 'none',
        },
        { d: 'M18 16a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', fill: '#000' },
      ]);
    }
  }

  function initToolboxManager() {
    const toolboxCtrl = new AbortController();
    const { signal } = toolboxCtrl;
    const icons = new IconFactory();

    function defineButtons() {
      const youtubeBtn = isYoutube
        ? [{ title: 'Download', icon: icons.download(), action: 'startDownload' }]
        : [];
      return [
        ...youtubeBtn,
        { title: 'Screenshot', icon: icons.camera(), action: 'takeScreenshot' },
        { title: 'PiP Mode', icon: icons.pip(), action: 'startPiP' },
        { title: 'Rotate ⟳', icon: icons.rotateCW(), action: 'rotateClockwise' },
        { title: 'Flip ↔', icon: icons.flipH(), action: 'flipHorizontal' },
        { title: 'Flip ↕', icon: icons.flipV(), action: 'flipVertical' },
        { title: 'Zoom & Pan', icon: icons.zoom(), action: 'zoomPan' },
        { title: 'Equalizer', icon: icons.equalizer(), action: 'equalizer' },
        { title: 'Random Jump', icon: icons.shuffle(), action: 'randomJump' },
        { title: 'GIF Maker', icon: icons.gif(), action: 'makeGif' },
        { title: 'Settings', icon: icons.gear(), action: 'showSettingsModal' },
      ];
    }

    function createToolboxUI() {
      return createHTMLElement('div', { class: 'vc-enhanced-toolbox', children: [
        createHTMLElement('div', { class: 'vc-enhanced-toolbox-grid', children:
          defineButtons().map(({ title, action, icon }) =>
            createHTMLElement('div', {
              class: 'vc-enhanced-btn',
              title,
              dataset: { action },
              children: [icon]
            })
          )
        })
      ], eventListener: {
        click: e => {
          const action = e.target.closest('.vc-enhanced-btn')?.dataset.action;
          if (action && ACTIONS[action]) ACTIONS[action]();
        }
      }});
    }

    function createToolboxButton() {
      const buttonId = 'vc-enhanced-toolbox-btn';
      if (document.getElementById(buttonId)) return document.getElementById(buttonId);

      return createHTMLElement('div', {
        id: buttonId,
        class: 'vcp-button',
        style: 'position:relative;display:inline-block;width:48px;height:100%;',
        children: [
          createHTMLElement('div', {
            style: 'position:absolute;width:100%;height:100%;',
            children: [
              createHTMLElement('button', {
                style: 'background-color:transparent;width:100%;height:100%;outline:none;flex:1;display:flex;align-items:center;justify-content:center;border:none;padding:0;cursor:pointer;',
                children: [icons.toolbox()]
              })
            ]
          })
        ]
      });
    }

    function attachClickToggle(triggerBtn, toolboxEl, playerEl) {
      const buttonEl = triggerBtn.querySelector('button');
      let isVisible = false;

      buttonEl.addEventListener('click', e => {
        stopEventPropagation(e, { immediate: true });
        isVisible = !isVisible;
        toolboxEl.style.display = isVisible ? 'block' : 'none';
        if (isVisible) positionToolbox(triggerBtn, toolboxEl, playerEl);
      }, { signal });

      document.addEventListener('click', e => {
        if (!toolboxEl.contains(e.target) && !triggerBtn.contains(e.target)) {
          toolboxEl.style.display = 'none';
          isVisible = false;
        }
      }, { signal });
    }

    function positionToolbox(triggerBtn, toolboxEl, playerEl) {
      const btnRect = triggerBtn.getBoundingClientRect();
      const playerRect = playerEl.getBoundingClientRect();
      toolboxEl.style.left = `${btnRect.left - playerRect.left}px`;
      toolboxEl.style.top = `${btnRect.top - playerRect.top - toolboxEl.offsetHeight - 6}px`;
    }

    const injectToolbox = () => {
      const playerEl = getElement('player');
      if (!playerEl) return false;

      const rightControls = getElement('rightControls');
      if (!rightControls || playerEl.querySelector('.vc-enhanced-toolbox')) return false;

      const toolboxEl = createToolboxUI();
      playerEl.appendChild(toolboxEl);

      const triggerBtn = createToolboxButton();
      rightControls.prepend(triggerBtn);

      attachClickToggle(triggerBtn, toolboxEl, playerEl);
      return true;
    };

    function generateShortsDownloadBtn() {
      if (!isYoutube) return;

      const insertButton = () => {
        if (!/\/shorts\//.test(window.location.href)) return;
        if (document.querySelector('#script_download_shorts')) return;

        const navDown = document.querySelector('#navigation-button-down');
        if (!navDown) return;

        const download = createHTMLElement('div', {
          id: 'script_download_shorts',
          class: 'navigation-button style-scope ytd-shorts',
          style: 'cursor:pointer;display:flex;justify-content:center;align-items:center;',
          children: [icons.shortDownload()],
          eventListener: { click: ACTIONS.startDownload }
        });
        navDown.after(download);
      };

      const observer = new MutationObserver(() => insertButton());
      observer.observe(document.body, { childList: true, subtree: true });
      insertButton();
    }

    function renderToolbox() {
      generateShortsDownloadBtn();
      if (injectToolbox()) return;
      const observer = new MutationObserver(() => {
        if (injectToolbox()) safeDisconnect(observer);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    waitForVideo(() => renderToolbox());
  }

  // ----------------------------------
  // Keyboard Controls
  // ----------------------------------
  const KEY_CODES = {
    TAB: 9,
    ENTER: 13,
    ESCAPE: 27,
    SPACE: 32,
    ARROW_LEFT: 37,
    ARROW_UP: 38,
    ARROW_RIGHT: 39,
    ARROW_DOWN: 40,
    KEY_B: 66,
    KEY_C: 67,
    KEY_D: 68,
    KEY_E: 69,
    KEY_G: 71,
    KEY_H: 72,
    KEY_N: 78,
    KEY_P: 80,
    KEY_R: 82,
    KEY_S: 83,
    KEY_T: 84,
    KEY_U: 85,
    KEY_W: 87,
    KEY_Y: 89,
    KEY_Z: 90,
    COMMA: 188,
    PERIOD: 190,
    SLASH: 191,
    BRACKET_LEFT: 219,
    BACK_SLASH: 220,
    BRACKET_RIGHT: 221,
  };

  const keyNames = Object.fromEntries(
    Object.entries(KEY_CODES).map(([name, code]) => [
      code,
      name.replace(/_/g, ' '),
    ])
  );

  function formatCombo(combo) {
    return `${combo}`
      .split('+')
      .map(part => {
        if (/^\d+$/.test(part)) {
          const code = parseInt(part, 10);
          return keyNames[code] || `KeyCode(${code})`;
        }
        return part;
      })
      .join(' + ');
  }

  function keyCombo(e) {
    return [
      e.metaKey ? 'Cmd' : '',
      e.altKey ? 'Alt' : '',
      e.ctrlKey ? 'Ctrl' : '',
      e.shiftKey ? 'Shift' : '',
      e.keyCode,
    ]
      .filter(Boolean)
      .join('+');
  }

  const DOCUMENT_KEY_BINDINGS = new Map(); // Assigned with or without video in DON
  const VIDEO_KEY_BINDINGS = new Map(); // Only assigned if video is in DOM
  const KEYBOARD_CONTROLS = new Map(); // Consolidated bindings for UI modal display

  function registerKeyboardHandler(targetMap, label, keyCombo, action) {
    targetMap.set('' + keyCombo, { label, action });
    KEYBOARD_CONTROLS.set('' + keyCombo, { label, action });
  }

  function initKeyboardControls() {
    let handledCombo = null;
    if (keyboardCtrl) {
      logMessage('Existing keyboard listeners detected.');
      safeAbort(keyboardCtrl);
    }
    keyboardCtrl = new AbortController();
    const { signal } = keyboardCtrl;
    function onKeyDown(e) {
      const startTime = performance.now();
      if (shouldKeydownBeIgnored(e, video)) return;
      const combo = keyCombo(e);
      const binding = VIDEO_KEY_BINDINGS.get(combo);
      if (binding) {
        handledCombo = combo;
        // bringVideoToFocus();
        stopEventPropagation(e, { immediate: true });
        logDebug(`Document Key binding detected, initiating action... (took ${performance.now() - startTime}ms)`, combo, binding);
        logMessage('Video Key binding detected, initiating action:', combo, binding);
        binding.action(e);
      }
    }
    function onKeyUp(e) {
      if (!handledCombo) return;

      const combo = keyCombo(e);
      if (combo !== handledCombo) return;

      stopEventPropagation(e, { immediate: true });
      handledCombo = null;
    }

    function init() {
      if (!video) return;
      window.addEventListener('keydown', onKeyDown, {
        capture: true,
        passive: false,
        signal
      });
      window.addEventListener('keyup', e => {
        onKeyUp(e);
        if (shouldKeydownBeIgnored(e, video)) return;
        if (togglePlayFired && e.code === 'Space') {
          stopEventPropagation(e, { immediate: true });
          return;
        }
        // Release Alt + S slow mo
        if (slowMoActive && e.code === 'KeyS') {
          if (video) video.playbackRate = prevPlaybackRate;
          slowMoActive = false;
          showOverlay({ type: 'center', text: `${video.playbackRate} x` });
        }
      }, {
        capture: true,
        passive: false,
        signal
      });
      registerCleanup(() => keyboardCtrl.abort());
    }

    init();
  }

  // ----------------------------------
  // Mouse Controls System
  // ----------------------------------
  const MOUSE_BUTTON_CODES = {
    LEFT_CLICK: 0,
    WHEEL_CLICK: 1,
  }

  const REGIONS = {
    LEFT_TOP: 'left_top', LEFT_BOTTOM: 'left_bottom',
    CENTER_TOP: 'center_top', CENTER_BOTTOM: 'center_bottom',
    RIGHT_TOP: 'right_top', RIGHT_BOTTOM: 'right_bottom',
    LEFT_EDGE_TOP: 'left_edge_top', LEFT_EDGE_BOTTOM: 'left_edge_bottom',
    RIGHT_EDGE_TOP: 'right_edge_top', RIGHT_EDGE_BOTTOM: 'right_edge_bottom',
    TOP_EDGE_LEFT: 'top_edge_left', TOP_EDGE_CENTER: 'top_edge_center', TOP_EDGE_RIGHT: 'top_edge_left',
    BOTTOM_EDGE_LEFT: 'bottom_edge_left', BOTTOM_EDGE_CENTER: 'bottom_edge_center', BOTTOM_EDGE_RIGHT: 'bottom_edge_left',
    TOP: 'top', BOTTOM: 'bottom',
    LEFT: 'left', CENTER: 'center', RIGHT: 'right',
    TOP_EDGE: 'top_edge', BOTTOM_EDGE: 'bottom_edge',
    LEFT_EDGE: 'left_edge', RIGHT_EDGE: 'right_edge',
    ALL: 'all'
  };

  const MOUSE_EVENTS = {
    leftClick: 'Left_Click',
    doubleLeftClick: 'Double_Left_Click',
    longLeftClick: 'Long_Left_Click',
    rightClick: 'Right_Click',
    doubleRightClick: 'Double_Right_Click',
    longRightClick: 'Long_Right_Click',
    wheelClick: 'Wheel_Click',
    doubleWheelClick: 'Double_Wheel_Click',
    longWheelClick: 'Long_Wheel_Click',
    wheelRight: 'Scroll_Right',
    ctrlWheelRight: 'Ctrl+Scroll_Right',
    ctrlWheelLeft: 'Ctrl+Scroll_Left',
    wheelLeft: 'Scroll_Left',
    wheelUp: 'Scroll_Up',
    ctrlWheelUp: 'Ctrl+Scroll_Up',
    altWheelUp: 'Alt+Scroll_Up',
    wheelDown: 'Scroll_Down',
    ctrlWheelDown: 'Ctrl+Scroll_Down',
    altWheelDown: 'Alt+Scroll_Down',
    continuousLeftClick: 'Continuous_Left_Click',
    shiftContinuousLeftClick: 'Shift+Continuous_Left_Click',
  };

  const REGION_GROUPS = {
    LEFT_EDGE: [REGIONS.LEFT_EDGE_TOP, REGIONS.LEFT_EDGE_BOTTOM],
    RIGHT_EDGE: [REGIONS.RIGHT_EDGE_TOP, REGIONS.RIGHT_EDGE_BOTTOM],
    TOP_EDGE: [REGIONS.TOP_EDGE_LEFT, REGIONS.TOP_EDGE_CENTER, REGIONS.TOP_EDGE_RIGHT],
    BOTTOM_EDGE: [REGIONS.BOTTOM_EDGE_LEFT, REGIONS.BOTTOM_EDGE_CENTER, REGIONS.BOTTOM_EDGE_RIGHT],
    CENTER: [REGIONS.CENTER_TOP, REGIONS.CENTER_BOTTOM, REGIONS.TOP_EDGE_CENTER, REGIONS.BOTTOM_EDGE_CENTER],
    LEFT: [REGIONS.LEFT_TOP, REGIONS.LEFT_BOTTOM, REGIONS.LEFT_EDGE_TOP, REGIONS.LEFT_EDGE_BOTTOM, REGIONS.TOP_EDGE_LEFT, REGIONS.BOTTOM_EDGE_LEFT],
    RIGHT: [REGIONS.RIGHT_TOP, REGIONS.RIGHT_BOTTOM, REGIONS.RIGHT_EDGE_TOP, REGIONS.RIGHT_EDGE_BOTTOM, REGIONS.TOP_EDGE_RIGHT, REGIONS.BOTTOM_EDGE_RIGHT],
    TOP: [
      REGIONS.LEFT_TOP, REGIONS.CENTER_TOP, REGIONS.RIGHT_TOP,
      REGIONS.TOP_EDGE_LEFT, REGIONS.TOP_EDGE_CENTER, REGIONS.TOP_EDGE_RIGHT,
      REGIONS.RIGHT_EDGE_TOP, REGIONS.LEFT_EDGE_TOP
    ],
    BOTTOM: [
      REGIONS.LEFT_BOTTOM, REGIONS.CENTER_BOTTOM, REGIONS.RIGHT_BOTTOM,
      REGIONS.BOTTOM_EDGE_LEFT, REGIONS.BOTTOM_EDGE_CENTER, REGIONS.BOTTOM_EDGE_RIGHT,
      REGIONS.RIGHT_EDGE_BOTTOM, REGIONS.LEFT_EDGE_BOTTOM
    ],
    ALL: [
      REGIONS.LEFT_TOP, REGIONS.CENTER_TOP, REGIONS.RIGHT_TOP,
      REGIONS.CENTER_BOTTOM, REGIONS.LEFT_BOTTOM, REGIONS.RIGHT_BOTTOM,
      REGIONS.LEFT_EDGE_TOP, REGIONS.LEFT_EDGE_BOTTOM, REGIONS.RIGHT_EDGE_TOP, REGIONS.RIGHT_EDGE_BOTTOM,
      REGIONS.TOP_EDGE_LEFT, REGIONS.TOP_EDGE_CENTER, REGIONS.TOP_EDGE_RIGHT,
      REGIONS.BOTTOM_EDGE_LEFT, REGIONS.BOTTOM_EDGE_CENTER, REGIONS.BOTTOM_EDGE_RIGHT
    ],
  };

  const MOUSE_BINDINGS = new Map(); // key = label + eventType

  function formatRegion(region) {
    return region.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function formatMouseBinding(eventType, region) {
    const prettyType = eventType.split('+').map(part => part.replace(/_/g, ' ')).join(' + ');
    return `${prettyType} [${formatRegion(region)}]`;
  }

  function isVideoClickUnobstructed(event, targetEl) {
    if (!event.isTrusted) return false;

    const el = event.target;
    if (!el) return false;

    logDebug('isVideoClickUnobstructed', event, targetEl, video);
    if (el === targetEl || el === video) return true;

    if (targetEl.contains(el) && !isInteractive(el)) return true;
    return false;
  }

  function isInteractive(el) {
    logDebug('Checking element and ancestors:', el);
    let current = el;
    let depth = 0;
    const maxDepth = 16; // prevent infinite loops
    if (getElement('ignoreMouseEventList').includes(el)) { logDebug('❌ Ignored because it matches ignoreMouseEvent', el); return false; }
    while (current && current !== document.body && depth < maxDepth) {
      logDebug('Checking current ancestors:', current);
      const controlElements = [ ...getElement('playerControlsList', true), customProgressBar]
      if (controlElements.includes(current)) { logDebug('✅ Found in playerControlsList', controlElements); return true; }
      else logDebug('❌ Not found in playerControlsList', controlElements);
      const style = window.getComputedStyle(current);
      if (style.pointerEvents === 'none') { logDebug('❌ pointer-events is none on'); return false; }
      else { logDebug('✅ Pointer-events is not none on'); }
      if (['BUTTON', 'INPUT', 'SELECT', 'A', 'TEXTAREA'].includes(current.tagName)) { logDebug('❌ Native interactive element:', current.tagName); return true; }
      else { logDebug('✅ Native element not interactive', current.tagName); }
      if (current.isContentEditable) { logDebug('✅ Element is contentEditable'); return true; }
      else { logDebug('❌ Element is not contentEditable', current.tagName); }
      const role = current.getAttribute('role');
      const interactiveRoles = ['button', 'link', 'checkbox', 'tab', 'menuitem'];
      if (interactiveRoles.includes(role)) { logDebug('✅ Element has interactive role:', role); return true; }
      else { logDebug('❌ Element has no interactive role', role); }
      if (current.tabIndex >= 0) { logDebug('✅ Element has tabIndex:', current.tabIndex); return true; }
      else { logDebug('❌ Element has no tabIndex', current.tabIndex); }

      const intrinsicHandlers = ['onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onpointerdown', 'onpointerup', 'onkeydown', 'onkeypress', 'onkeyup'];
      if (intrinsicHandlers.some(handler => typeof current[handler] === 'function')) { logDebug('✅ Inline handler detected'); return true; }
      else { logDebug('❌ Inline handler not detected'); }

      if (typeof getEventListeners === 'function') {
        const listeners = getEventListeners(current);
        const interactiveEvents = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'keydown', 'keypress', 'keyup'];
        if (interactiveEvents.some(event => listeners[event] && listeners[event].length > 0)) { logDebug('✅ JS event listener for click detected'); return true; }
        else { logDebug('❌ JS event listener for click not detected'); }
      }

      current = current.parentElement;
      depth++;
    }

    logDebug('❌ No interactive conditions matched in chain');
    return false;
  }

  function getTargetRegion(event, targetEl) {
    if (!targetEl) return null;
    let rect = targetEl.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      rect = lastKnownRect || rect;
    } else {
      lastKnownRect = rect;
    }

    if (!event) return;

    const { clientX: x, clientY: y } = event;

    const width = rect.width;
    const height = rect.height;

    const edgeThickness = Math.min(width, height) * 0.075; // 7.5% edge thickness
    const sideWidth = width * 0.25; // 25% for left/right
    const isTop = y < rect.top + height / 2;

    // Edges
    if (x <= rect.left + edgeThickness) {
      return y < rect.top + height / 2 ? REGIONS.LEFT_EDGE_TOP : REGIONS.LEFT_EDGE_BOTTOM;
    }
    if (x >= rect.right - edgeThickness) {
      return y < rect.top + height / 2 ? REGIONS.RIGHT_EDGE_TOP : REGIONS.RIGHT_EDGE_BOTTOM;
    }
    if (y <= rect.top + edgeThickness) {
      if (x < rect.left + sideWidth) return REGIONS.TOP_EDGE_LEFT;
      if (x > rect.right - sideWidth) return REGIONS.TOP_EDGE_RIGHT;
      return REGIONS.TOP_EDGE_CENTER;
    }
    if (y >= rect.bottom - edgeThickness) {
      if (x < rect.left + sideWidth) return REGIONS.BOTTOM_EDGE_LEFT;
      if (x > rect.right - sideWidth) return REGIONS.BOTTOM_EDGE_RIGHT;
      return REGIONS.BOTTOM_EDGE_CENTER;
    }

    // Normal regions
    if (x < rect.left + sideWidth) {
      return isTop ? REGIONS.LEFT_TOP : REGIONS.LEFT_BOTTOM;
    } else if (x > rect.right - sideWidth) {
      return isTop ? REGIONS.RIGHT_TOP : REGIONS.RIGHT_BOTTOM;
    } else {
      return isTop ? REGIONS.CENTER_TOP : REGIONS.CENTER_BOTTOM;
    }
  }

  function makeMouseKey(eventType, regions) {
    return `${eventType}:${regions}`;
  }

  function registerMouseHandler(label, eventType, regions, handler) {
    const key = makeMouseKey(eventType, regions);
    MOUSE_BINDINGS.set(key, { label, eventType, regions, handler });
  }

  function handleMouseEvent(eventType, event, targetEl) {
    if (!event.isTrusted) return;
    if (zoomPanCtrl) return; // Zoom pan is active
    if (!isVideoClickUnobstructed(event, targetEl)) return;
    const region = getTargetRegion(event, targetEl);
    if (!region) return;
    const matches = [];
    for (const { eventType: type, regions, handler } of MOUSE_BINDINGS.values()) {
      if (type !== eventType) continue;
      let regionList = REGION_GROUPS[regions.toUpperCase()] || [regions];
      if (regionList.includes(region)) {
        matches.push({ regions, handler, regionList });
      }
    }
    if (matches.length === 0) return;
    matches.sort((a, b) => a.regionList.length - b.regionList.length);
    const { handler, regions } = matches[0];
    // bringVideoToFocus();
    stopEventPropagation(event);
    if ([MOUSE_EVENTS.wheelDown, MOUSE_EVENTS.wheelUp].includes(eventType) && event.dynamicStep && event.dynamicStep < 0.01) return;
    logMessage('Mouse event handler detected, initiating action:', eventType, regions, targetEl,handler);
    return handler(event, region);
  }

  let mouseCtrl;
  function initMouseControls() {
    let clickCount = 0;
    let lastClickTime = 0;
    let pointerDown = false;
    let moved = false;
    let activePointerId = null;
    if (!config.mouseControls) {
      logMessage('Mouse controls are turned off!');
      if (mouseCtrl) {
        mouseCtrl.abort(); // cleanup old listeners
        mouseCtrl = null;
      }
      return;
    }
    if (mouseCtrl) {
      logMessage('Refreshing mouse controls!');
      mouseCtrl.abort(); // cleanup previous
      mouseCtrl = null;
    }
    mouseCtrl = new AbortController();
    const { signal } = mouseCtrl;

    const targetEl = isYoutube ? getElement('video') : getElement('player');

    getTargetRegion(null, targetEl); // to cache the rect in memory

    let lastWheelTime = 0;

    const wheelListener = e => {
      if (!e.isTrusted) return;
      const now = Date.now();
      const timeDiff = now - lastWheelTime;
      lastWheelTime = now;
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const isVerticalScroll = absY > absX;
      const isPositive = isVerticalScroll ? e.deltaY < 0 : e.deltaX < 0;
      const actualDirection = isVerticalScroll ? (config.invertWheelDirection ? !isPositive : isPositive) : isPositive;
      const speedFactor = (isVerticalScroll ? absY : absX) / 50; // normalize so 50px = 1x step
      const acceleration = timeDiff < 150 ? 1.5 : 1; // boost if rapid
      const dynamicStep = Math.max(1, Math.min(10, speedFactor * acceleration)); // cap at 10x
      e.dynamicStep = dynamicStep;
      let baseEvent;
      if (isVerticalScroll) {
        baseEvent = actualDirection ? MOUSE_EVENTS.wheelUp : MOUSE_EVENTS.wheelDown;
        if (modifierState.ctrl) {
          baseEvent = actualDirection ? MOUSE_EVENTS.ctrlWheelUp : MOUSE_EVENTS.ctrlWheelDown;
        } else if (modifierState.alt) {
          baseEvent = actualDirection ? MOUSE_EVENTS.altWheelUp : MOUSE_EVENTS.altWheelDown;
        }
      } else {
        baseEvent = actualDirection ? MOUSE_EVENTS.wheelRight : MOUSE_EVENTS.wheelLeft;
        if (modifierState.ctrl) {
          baseEvent = actualDirection ? MOUSE_EVENTS.ctrlWheelRight : MOUSE_EVENTS.ctrlWheelLeft;
        }
      }
      baseEvent && handleMouseEvent(baseEvent, e, targetEl);
    };

    const rightClickListener = e => {
      handleMouseEvent(MOUSE_EVENTS.rightClick, e, targetEl);
    };

    const keydownListener = e => {
      if (e.shiftKey) modifierState.shift = true;
      if (e.altKey) modifierState.alt = true;
      if (e.ctrlKey) modifierState.ctrl = true;
    }

    const keyupListener = e => {
      if (!e.shiftKey) modifierState.shift = false;
      if (!e.altKey) modifierState.alt = false;
      if (!e.ctrlKey) modifierState.ctrl = false;
    }

    const pointerDownListener = e => {
      if (!e.isTrusted) return;
      if (e.pointerType !== 'mouse') return;
      if (e.button !== 0 && e.button !== 1) return;

      if (!isVideoClickUnobstructed(e, targetEl)) return;

      activePointerId = e.pointerId;
      pointerDown = true;
      moved = false;

      e.target.setPointerCapture(e.pointerId);

      if (e.button === 1) {
        handleMouseEvent(MOUSE_EVENTS.wheelClick, e, targetEl);
        return;
      }

      stopEventPropagation(e, { immediate: true });

      longClickTimer = setTimeout(() => {
        clickHandled = true;
        undoLongClick = handleMouseEvent(MOUSE_EVENTS.longLeftClick, e, targetEl);

        continuousStartTimer = setTimeout(() => {
          if (undoLongClick) undoLongClick();
          undoLongClick = null;

          continuousCleanup = handleMouseEvent(
            e.shiftKey
              ? MOUSE_EVENTS.shiftContinuousLeftClick
              : MOUSE_EVENTS.continuousLeftClick,
            e,
            targetEl
          );
        }, CONTINUOUS_CLICK_DELAY);
      }, LONG_CLICK_DURATION);
    };

    const pointerMoveListener = e => {
      if (!pointerDown) return;
      if (e.pointerId !== activePointerId) return;

      if (Math.abs(e.movementX) > 2 || Math.abs(e.movementY) > 2) {
        moved = true;
      }
    };

    const pointerUpListener = e => {
      if (!e.isTrusted) return;
      if (e.pointerType !== 'mouse') return;
      if (e.pointerId !== activePointerId) return;

      stopEventPropagation(e, { immediate: true });

      e.target.releasePointerCapture(e.pointerId);

      // CLEANUP FIRST
      pointerDown = false;
      activePointerId = null;

      // Cancel long/continuous click timers if they were pending
      if (longClickTimer) clearTimeout(longClickTimer);
      if (continuousStartTimer) clearTimeout(continuousStartTimer);
      longClickTimer = null;
      continuousStartTimer = null;

      if (continuousCleanup) {
        continuousCleanup();
        continuousCleanup = null;
      }
      if (undoLongClick) {
        undoLongClick();
        undoLongClick = null;
      }

      // If long click already handled, ignore further click logic
      if (clickHandled) {
        clickHandled = false;
        return;
      }

      if (moved) return;
      if (!isVideoClickUnobstructed(e, targetEl)) return;

      const now = Date.now();
      const DOUBLE_CLICK_DELAY = 300;

      // Reset count if too much time passed
      if (now - lastClickTime > DOUBLE_CLICK_DELAY) {
        clickCount = 1;
      } else {
        clickCount++;
      }
      lastClickTime = now;

      // Clear any pending single/double click timeout
      if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
      }

      // Set new timeout to decide final action
      clickTimeout = setTimeout(() => {
        clickTimeout = null;

        if (clickCount === 1) {
          handleMouseEvent(MOUSE_EVENTS.leftClick, e, targetEl);
        } else if (clickCount === 2) {
          handleMouseEvent(MOUSE_EVENTS.doubleLeftClick, e, targetEl);
        } else if (clickCount >= 3) {
          handleMouseEvent(MOUSE_EVENTS.tripleLeftClick, e, targetEl); // optional
        }

        // Reset for next sequence
        clickCount = 0;
      }, DOUBLE_CLICK_DELAY);
    };

    const lostPointerListener = e => {
      if (e.pointerId !== activePointerId) return;

      pointerDown = false;
      activePointerId = null;

      if (longClickTimer) clearTimeout(longClickTimer);
      if (continuousStartTimer) clearTimeout(continuousStartTimer);

      longClickTimer = null;
      continuousStartTimer = null;

      if (continuousCleanup) {
        continuousCleanup();
        continuousCleanup = null;
      }

      undoLongClick = null;
      clickHandled = false;
    };

    const pointerCancelListener = e => {
      if (e.pointerId !== activePointerId) return;

      pointerDown = false;
      activePointerId = null;

      clearTimeout(longClickTimer);
      clearTimeout(continuousStartTimer);

      longClickTimer = null;
      continuousStartTimer = null;

      if (continuousCleanup) {
        continuousCleanup();
        continuousCleanup = null;
      }

      undoLongClick = null;
      clickHandled = false;
    };

    window.addEventListener('wheel', wheelListener, { passive: false, capture: true, signal });
    window.addEventListener('pointerdown', pointerDownListener, { passive: false, capture: true, signal });
    window.addEventListener('pointermove', pointerMoveListener, { passive: false, capture: true, signal });
    window.addEventListener('pointerup', pointerUpListener, { passive: false, capture: true, signal });
    window.addEventListener('pointercancel', pointerCancelListener, { passive: false, capture: true, signal });
    window.addEventListener('lostpointercapture', lostPointerListener, { passive: false, capture: true, signal });

    window.addEventListener('contextmenu', rightClickListener, { passive: false, capture: true, signal });
    window.addEventListener('keydown', keydownListener, { signal });
    window.addEventListener('keyup', keyupListener, { signal });

    const clickListener = e => {
      if (!e.isTrusted) return;
      if (!isVideoClickUnobstructed(e, targetEl)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Optional: logDebug('Blocked native click', e);
    };

    const dblclickListener = e => {
      if (!e.isTrusted) return;
      if (!isVideoClickUnobstructed(e, targetEl)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Optional: logDebug('Blocked native dblclick', e);
    };

    window.addEventListener('click', clickListener, { passive: false, capture: true, signal });
    window.addEventListener('dblclick', dblclickListener, { passive: false, capture: true, signal });

    window.addEventListener(
      'auxclick',
      e => {
        if (e.button !== 1) return;
        if (!isVideoClickUnobstructed(e, targetEl)) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        handleMouseEvent(MOUSE_EVENTS.wheelClick, e, targetEl);
      },
      { capture: true, signal }
    );

    logMessage('Mouse controls are attached to the DOM element:', targetEl);
    registerCleanup(() => mouseCtrl.abort());
  }

  // ----------------------------------
  // Controls Registration
  // ----------------------------------
  // -------- Mouse controls registry --------
  (function () {
    registerMouseHandler('Increase Volume', MOUSE_EVENTS.wheelUp, REGIONS.RIGHT_EDGE, e => ACTIONS.setVolume(true, (0.01 * e.dynamicStep || 0.01)));

    registerMouseHandler('Decrease Volume', MOUSE_EVENTS.wheelDown, REGIONS.RIGHT_EDGE, e => ACTIONS.setVolume(false, (0.01 * e.dynamicStep || 0.01)));

    registerMouseHandler('Play/Pause', MOUSE_EVENTS.leftClick, REGIONS.ALL, e => ACTIONS.togglePlay());

    registerMouseHandler('Toggle Fullscreen', MOUSE_EVENTS.doubleLeftClick, REGIONS.ALL, e => ACTIONS.toggleFullscreen());

    registerMouseHandler('Seek Forward', MOUSE_EVENTS.ctrlWheelUp, REGIONS.RIGHT_EDGE, e => ACTIONS.seek(e.dynamicStep || 1, e));

    registerMouseHandler('Seek Backward', MOUSE_EVENTS.ctrlWheelDown, REGIONS.RIGHT_EDGE, e => ACTIONS.seek(-(e.dynamicStep || 1), e));

    registerMouseHandler('Fast Forward', MOUSE_EVENTS.continuousLeftClick, REGIONS.RIGHT, e => ACTIONS.fastForward());

    registerMouseHandler('Rewind', MOUSE_EVENTS.continuousLeftClick, REGIONS.LEFT, e => ACTIONS.rewind());

    registerMouseHandler('Next Video', MOUSE_EVENTS.doubleLeftClick, REGIONS.RIGHT_EDGE, e => ACTIONS.nextVideo());

    registerMouseHandler('Previous Video', MOUSE_EVENTS.doubleLeftClick, REGIONS.LEFT_EDGE, e => ACTIONS.prevVideo());

    registerMouseHandler('Picture in Picture', MOUSE_EVENTS.rightClick, REGIONS.RIGHT_BOTTOM, e => ACTIONS.startPiP());

    registerMouseHandler('Take Screenshot', MOUSE_EVENTS.rightClick, REGIONS.LEFT_BOTTOM, e => ACTIONS.takeScreenshot());

    registerMouseHandler('Increase Brightness', MOUSE_EVENTS.wheelUp, REGIONS.LEFT_EDGE, e => ACTIONS.setBrightness(true, (0.01 * e.dynamicStep || 0.01)))

    registerMouseHandler('Decrease Brightness', MOUSE_EVENTS.wheelDown, REGIONS.LEFT_EDGE, e => ACTIONS.setBrightness(false, (0.01 * e.dynamicStep || 0.01)));

    registerMouseHandler('Increase Contrast', MOUSE_EVENTS.ctrlWheelUp, REGIONS.LEFT_EDGE, e => ACTIONS.setContrast(true, (0.01 * e.dynamicStep || 0.01)));

    registerMouseHandler('Decrease Contrast', MOUSE_EVENTS.ctrlWheelDown, REGIONS.LEFT_EDGE, e => ACTIONS.setContrast(false, (0.01 * e.dynamicStep || 0.01)));

    registerMouseHandler('Increase Saturation', MOUSE_EVENTS.altWheelUp, REGIONS.LEFT_EDGE, e => ACTIONS.setSaturation(true, (0.01 * e.dynamicStep || 0.01)))

    registerMouseHandler('Decrease Saturation', MOUSE_EVENTS.altWheelDown, REGIONS.LEFT_EDGE, e => ACTIONS.setSaturation(false, (0.01 * e.dynamicStep || 0.01)));

    registerMouseHandler('Show Thumbnail', MOUSE_EVENTS.longLeftClick, REGIONS.CENTER, e => ACTIONS.showVideoThumbnail());

    // For debugging
    // Object.values(MOUSE_EVENTS).forEach(eventType => {
    //   registerMouseHandler(`Test ${eventType}`, eventType, REGIONS.CENTER_TOP, e => showOverlay({ type: 'center', text: eventType }))
    // });
  })();

  // -------- Keyboard controls registry --------
  (function () {
    // Document-level bindings
    registerKeyboardHandler(DOCUMENT_KEY_BINDINGS, 'Open settings', KEY_CODES.KEY_S, e => ACTIONS.showSettingsModal());

    registerKeyboardHandler(DOCUMENT_KEY_BINDINGS, 'Show hotkeys help', `Shift+${KEY_CODES.KEY_H}`, () => ACTIONS.showControlsModal());

    registerKeyboardHandler(DOCUMENT_KEY_BINDINGS, 'Close modals', KEY_CODES.ESCAPE, e => ACTIONS.closeModals());

    registerKeyboardHandler(DOCUMENT_KEY_BINDINGS, 'Duplicate Site', `Shift+${KEY_CODES.KEY_D}`, e => ACTIONS.duplicateSite());

    registerKeyboardHandler(DOCUMENT_KEY_BINDINGS, 'Search', KEY_CODES.SLASH, e => ACTIONS.search(e));

    // Video-level bindings
    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Toggle fullscreen', KEY_CODES.ENTER, e => ACTIONS.toggleFullscreen());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Volume Up', KEY_CODES.ARROW_UP, e => ACTIONS.setVolume(true, VOLUME_STEP_LARGE, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Volume Down', KEY_CODES.ARROW_DOWN, e => ACTIONS.setVolume(false, VOLUME_STEP_LARGE, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Volume Up (Small Step)', `Shift+${KEY_CODES.ARROW_UP}`, e => ACTIONS.setVolume(true, VOLUME_STEP, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Volume Down (Small Step)', `Shift+${KEY_CODES.ARROW_DOWN}`, e => ACTIONS.setVolume(false, VOLUME_STEP, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Skip Intro', `Shift+${KEY_CODES.KEY_Z}`, e => ACTIONS.skipIntro());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Play / Pause', `${KEY_CODES.SPACE}`, e => ACTIONS.togglePlay(e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Seek forward (small step)', KEY_CODES.ARROW_RIGHT, e => ACTIONS.seek(SEEK_SMALL, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Seek backward (small step)', KEY_CODES.ARROW_LEFT, e => ACTIONS.seek(-SEEK_SMALL, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Seek forward (large step)', `Shift+${KEY_CODES.ARROW_RIGHT}`, e => ACTIONS.seek(SEEK_LARGE, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Seek backward (large step)', `Shift+${KEY_CODES.ARROW_LEFT}`, e => ACTIONS.seek(-SEEK_LARGE, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Increase playback speed', KEY_CODES.BRACKET_RIGHT, e => ACTIONS.changePlaybackSpeed(SPEED_STEP, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Decrease playback speed', KEY_CODES.BRACKET_LEFT, e => ACTIONS.changePlaybackSpeed(-SPEED_STEP, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Reset playback speed', KEY_CODES.BACK_SLASH, e => ACTIONS.resetPlayback());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Step forward (frame)', KEY_CODES.PERIOD, e => ACTIONS.frameStep(true, 1, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Step backward (frame)', KEY_CODES.COMMA, e => ACTIONS.frameStep(false, 1, e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Next video', `Shift+${KEY_CODES.PERIOD}`, e => ACTIONS.nextVideo(e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Previous video', `Shift+${KEY_CODES.COMMA}`, e => ACTIONS.prevVideo(e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Toggle Transcript', `Shift+${KEY_CODES.KEY_T}`, e => ACTIONS.toggleTranscript(e));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Picture-in-Picture', KEY_CODES.KEY_P, e => ACTIONS.startPiP());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Toggle Sticky Player', `Shift+${KEY_CODES.KEY_P}`, e => { stopEventPropagation(e,{ immediate: true }); ACTIONS.toggleStickyVideo.toggle(); });

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Loop section (set/unset)', KEY_CODES.KEY_B, () => ACTIONS.abLoop());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Enable slow motion', `Ctrl+${KEY_CODES.KEY_S}`, e => ACTIONS.startSloMo());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Start/finish Video Buffer', `Shift+${KEY_CODES.KEY_B}`, () => ACTIONS.bufferVideo());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Open equalizer', KEY_CODES.KEY_E, () => ACTIONS.equalizer());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Take screenshot', `Shift+${KEY_CODES.KEY_S}`, e => ACTIONS.takeScreenshot());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Make GIF', KEY_CODES.KEY_G, e => ACTIONS.makeGif());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Reset Applied Filter', KEY_CODES.KEY_R, e => ACTIONS.resetVideoFiltersAndTransforms());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Toggle Player Controls', KEY_CODES.KEY_H, () => ACTIONS.toggleDefaultControlsOverlay());

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Toggle Zen Mode', KEY_CODES.KEY_Z, () => ACTIONS.toggleZenMode(true));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Toggle Night Mode', `Ctrl+${KEY_CODES.KEY_Z}`, () => ACTIONS.toggleZenMode(false));

    registerKeyboardHandler(VIDEO_KEY_BINDINGS, 'Toggle White Noise', `${KEY_CODES.KEY_W}`, e => ACTIONS.toggleFocusMode());
  })();

  // ----------------------------------
  // Script Initialization
  // ----------------------------------
  let currentVideo = null;
  let currentVideoCtrl = null;

  function onKeyDown(e) {
    const startTime = performance.now();
    if (shouldKeydownBeIgnored(e)) return;

    const combo = keyCombo(e);

    const binding = DOCUMENT_KEY_BINDINGS.get(combo);
    if (binding) {
      logDebug(`Document Key binding detected, initiating action... (took ${performance.now() - startTime}ms)`, combo, binding);
      logMessage('Document Key binding detected, initiating action...', combo, binding);
      binding.action(e);
    }
  }

  window.addEventListener('keydown', onKeyDown, {
    capture: true,
    passive: false,
  }, { signal: GLOBAL_SIGNAL });

  /**
   * Monkey-patches the global EventTarget.prototype.addEventListener to
   * force {@code passive: false} on click, mouse, and touch events.
   * Ensures handlers can call {@code preventDefault()}, bypassing browser defaults.
   */
  (function() {
    const origAddEvent = EventTarget.prototype.addEventListener;

    EventTarget.prototype.addEventListener = function(type, listener, options) {
      // If options is an object, force passive: false for specific events
      if (typeof options === 'object' && options !== null) {
        if (options.passive !== false) {
          if (type === 'click' || type === 'mousedown' || type === 'mouseup' || type === 'touchstart' || type === 'touchmove') {
            options.passive = false;
          }
        }
      }
      return origAddEvent.call(this, type, listener, options);
    };
  })();

  function loadScript(v) {
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

    safeAbort(currentVideoCtrl);
    currentVideo = v;
    video = v;

    currentVideoCtrl = new AbortController();
    const { signal } = currentVideoCtrl;

    loadCssStyles();
    initKeyboardControls();
    applyFilter();
    initToolboxManager();
    initMouseControls();
    initAudioChannelsFromConfig();
    attachStickyBoost(video);
    ACTIONS.togglePlayerControls(config.modeIndex);
    if (config.stickyVideoEnabled) ACTIONS.toggleStickyVideo.enable();

    const observer = new MutationObserver(() => {
      if (!v.isConnected) {
        currentVideo = null;
        currentVideoCtrl?.abort();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    signal.addEventListener('abort', () => observer.disconnect());

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