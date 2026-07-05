// ==UserScript==
// @name         Wiki Enhancer
// @namespace    https://github.com/JYashu/flux-suite
// @version      5.0.0
// @description  Enhances wiki pages with sleek inline previews, YouTube integrations, and smart theme detection across Wikipedia, Fandom, and more.
// @author       JYashu
// @license      Apache-2.0
// @icon         https://www.google.com/s2/favicons?sz=64&domain=wikipedia.com
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @match        https://*.wikipedia.org/*
// @match        https://*.wiktionary.org/*
// @match        https://*.fandom.com/*
// @match        https://*.d-addicts.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @inspiredBy   https://greasyfork.org/en/scripts/7678-wikipedia-inline-article-viewer-adopted by joeytwiddle
// @inspiredBy   https://greasyfork.org/en/scripts/12423-wikitube-youtube-on-wikipedia-wikiwand by drhouse
// ==/UserScript==
/* global FluxKit */

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

  const {
    createLogger,
    getUniqueId,
    getRandomIcon,
    showNotification,
    makeElementDragAndResize,
    safeHTML,
  } = FluxKit.utils;

  const { logMessage, logError, logWarning, logDebug } = createLogger('WikiEnhancer');

  const STORAGE_KEY = 'wiki-enhancer-config';
  const PINNED_PREVIEW_STORAGE_KEY = 'wiki-pinned-previews';
  const BRIDGE_DELAY = 300; // ms
  const bridgeTimers = new Map();
  let currentlyHoveredLink = null;
  let isShiftDown = false;
  let isControlDown = false;
  let hoverState = new WeakMap();
  let nextZIndex = 10000;
  let allowPreviewsInPreviews = true;
  const openPreviews = [];
  const processedLinks = new Set();
  const pinnedPreviews = sessionStorage.getItem(PINNED_PREVIEW_STORAGE_KEY) ? new Map(JSON.parse(sessionStorage.getItem(PINNED_PREVIEW_STORAGE_KEY))) : new Map();
  let isResizing = false;

  const defaultConfig = {
    preview: true,
    hoverDelay: 300,
    theme: 'auto',
    trigger: 'hover',
    logging: false,
    wikiTube: true,
  };

  let config = initializeConfig();
  window.WikiEnhancer = config;

  function initializeConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        logMessage('No config found in localStorage, initializing default');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultConfig));
        return { ...defaultConfig };
      }
      return { ...defaultConfig, ...JSON.parse(saved) };
    } catch (e) {
      logError('Failed to parse localStorage, initializing default config:', e);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultConfig));
      return { ...defaultConfig };
    }
  }

  function persistConfig(newConfig) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
      logMessage('Config saved to localStorage:', newConfig);
    } catch (e) {
      logError('Failed to save config to localStorage: ', e, { __v: 1 });
    }
  }

  const outsideClickClose = settingsPanel => {
    function closeElement() {
      try {
        if (settingsPanel) {
          settingsPanel.classList.remove('show');
          setTimeout(() => settingsPanel.remove(), 250);
        }
        document.removeEventListener('click', clickListener);
      } catch (e) {
        logError('Error in closeElement:', e);
      }
    }

    function clickListener(event) {
      if (!settingsPanel.contains(event.target)) {
        closeElement();
      }
    }

    setTimeout(() => {
      document.addEventListener('click', clickListener);
    }, 0);
  };

  GM_addStyle(`
    .inline-window, .inline-window *,
    .inline-window *::before,
    .inline-window *::after,
    .inline-window .inline-header,
    .inline-window .inline-header *
    #wiki-preview-settings * {
      box-sizing: border-box !important;
    }

    .inline-window button svg {
      display: block;
      pointer-events: none;
    }

    :root, [data-theme="light"] {
      --wiki-glass-bg: rgba(255, 255, 255, 0.75);
      --wiki-glass-header: rgba(245, 245, 245, 0.5);
      --wiki-glass-border: rgba(0, 0, 0, 0.1);
      --wiki-focus-border: rgba(0, 122, 255, 0.4);
      --wiki-text-main: #222222;
      --wiki-text-muted: #666666;
      --wiki-shadow: 0 12px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.5) inset;
      --wiki-shadow-focus: 0 16px 48px rgba(0, 0, 0, 0.2), 0 0 0 1px var(--wiki-focus-border) inset;
      --wiki-btn-hover: rgba(0, 0, 0, 0.08);
      --wiki-scrollbar-thumb: rgba(0, 0, 0, 0.2);
      --wiki-input-bg: rgba(0, 0, 0, 0.05);
    }

    [data-theme="dark"] {
      --wiki-glass-bg: rgba(30, 30, 30, 0.75);
      --wiki-glass-header: rgba(40, 40, 40, 0.5);
      --wiki-glass-border: rgba(255, 255, 255, 0.15);
      --wiki-focus-border: rgba(10, 132, 255, 0.5);
      --wiki-text-main: #eeeeee;
      --wiki-text-muted: #aaaaaa;
      --wiki-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
      --wiki-shadow-focus: 0 16px 48px rgba(0, 0, 0, 0.8), 0 0 0 1px var(--wiki-focus-border) inset;
      --wiki-btn-hover: rgba(255, 255, 255, 0.15);
      --wiki-scrollbar-thumb: rgba(255, 255, 255, 0.3);
      --wiki-input-bg: rgba(255, 255, 255, 0.1);
    }

    .inline-window, #wiki-preview-settings {
      box-sizing: border-box !important;
      background-color: var(--wiki-glass-bg) !important;
      backdrop-filter: blur(6px) saturate(180%);
      -webkit-backdrop-filter: blur(6px) saturate(180%);
      border: 1px solid var(--wiki-glass-border) !important;
      border-radius: 14px !important;
      box-shadow: var(--wiki-shadow) !important;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      color: var(--wiki-text-main) !important;
      transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
    }

    /* Scrollbars */
    .inline-window ::-webkit-scrollbar, #wiki-preview-settings ::-webkit-scrollbar {
      width: 10px; height: 10px;
    }
    .inline-window ::-webkit-scrollbar-track, #wiki-preview-settings ::-webkit-scrollbar-track {
      background: transparent;
    }
    .inline-window ::-webkit-scrollbar-thumb, #wiki-preview-settings ::-webkit-scrollbar-thumb {
      background: var(--wiki-scrollbar-thumb);
      border-radius: 10px;
      border: 3px solid transparent;
      background-clip: content-box;
    }

    .wiki-preview-icon {
      display: inline-flex;
      align-items: center;
      margin-left: 4px;
      margin-bottom: -1px; /* Optically aligns with text baseline */
      color: var(--wiki-text-muted);
      opacity: 0.4; /* Barely visible by default */
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .wiki-preview-icon:hover {
      opacity: 1; /* Pops to full visibility on hover */
      color: var(--wiki-text-main);
      transform: scale(1.1);
    }

    .inline-window {
      position: fixed;
      z-index: 9999;
      min-width: 308px;
      width: 420px;
      height: 60vh;
      font-size: 14px !important;
      opacity: 0;
      transform: scale(0.5);
      resize: both;
      padding: 0;
      overflow: hidden;
      transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
    }

    .inline-window.show {
      opacity: 1;
      transform: scale(1);
    }

    /* Subtle Focus Indicator */
    .inline-window:focus, .inline-window:focus-visible {
      outline: none !important;
      box-shadow: var(--wiki-shadow-focus) !important;
    }

    .wiki-title-wrapper {
      display: flex;
      align-items: center;
      min-width: 0; /* Allows the title to truncate properly */
      flex: 1;
      margin-right: 10px;
    }

    #wiki-preview-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wiki-temp-indicator {
      display: none; /* Hidden by default (permanent state) */
      flex-shrink: 0;
      margin-left: 8px;
      color: var(--wiki-text-muted);
      opacity: 0.6;
    }

    /* Only show the icon when the window is in 'temp' state */
    .inline-window[data-state="temp"] .wiki-temp-indicator {
      display: flex;
      align-items: center;
    }

    .inline-window .inline-header {
      padding: 10px 14px;
      font-weight: 600;
      background-color: var(--wiki-glass-header) !important;
      border-bottom: 1px solid var(--wiki-glass-border) !important;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    #wiki-preview-btn-container { display: flex; gap: 4px; }

    .wiki-preview-close-btn, .wiki-preview-pin-btn, .wiki-preview-expanse-toggle, #wiki-enhancer-close-settings {
      cursor: pointer !important;
      font-size: 16px !important;
      color: var(--wiki-text-muted) !important;
      border: none !important;
      background: transparent !important;
      padding: 4px 6px !important;
      border-radius: 6px !important;
      min-width: 28px !important;
      min-height: 28px !important;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1 !important;
      transition: all 0.15s ease;
    }

    .wiki-preview-close-btn:hover, .wiki-preview-pin-btn:hover, .wiki-preview-expanse-toggle:hover, #wiki-enhancer-close-settings:hover {
      color: var(--wiki-text-main) !important;
      background-color: var(--wiki-btn-hover) !important;
    }

    .inline-content {
      padding: 14px;
      overflow-y: auto;
      line-height: 1.6;
    }

    .loading-spinner {
      animation: spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      border: 2px solid var(--wiki-glass-border);
      border-top: 2px solid var(--wiki-text-muted);
      border-radius: 50%;
      width: 20px;
      height: 20px;
      margin: 20px auto;
      display: block;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    #wiki-preview-settings {
      position: fixed;
      bottom: 80px;
      right: 20px;
      z-index: 9999;
      padding: 16px;
      width: 280px;
      font-size: 13px !important;
    }

    .wiki-enhancer-settings-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      font-weight: 600;
      font-size: 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--wiki-glass-border);
    }

    .wiki-enhancer-settings-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .wiki-setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--wiki-text-main);
    }

    /* Modernized Inputs & Dropdowns */
    .wiki-setting-row input[type="number"],
    .wiki-setting-row select {
      flex: 1;
      max-width: 100px;
      margin-left: 10px;
      padding: 6px 8px;
      border: 1px solid var(--wiki-glass-border);
      border-radius: 6px;
      background: var(--wiki-input-bg);
      color: var(--wiki-text-main);
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s ease;
    }

    .wiki-setting-row input[type="number"]:focus,
    .wiki-setting-row select:focus {
      border-color: var(--wiki-focus-border);
    }

    /* Modern Checkbox Trick */
    .wiki-setting-row input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: #007aff;
    }

    /* =========================================
       WikiTube
       ========================================= */
    #yt-inline-wrapper {
      margin: 24px 0;
      border-radius: 14px;
      background-color: var(--wiki-glass-bg) !important;
      border: 1px solid var(--wiki-glass-border) !important;
      overflow: hidden;
      color: var(--wiki-text-main);
      transition: all 0.3s ease;
    }

    #yt-header {
      cursor: pointer;
      padding: 14px 18px;
      font-size: 15px;
      font-weight: 600;
      background-color: var(--wiki-glass-header) !important;
      border-bottom: 1px solid var(--wiki-glass-border) !important;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background-color 0.2s ease;
    }

    #yt-header:hover {
      background-color: var(--wiki-btn-hover) !important;
    }

    #yt-inline-container {
      padding: 0 14px;
      display: flex;
      gap: 14px;
      overflow-x: auto;
      scroll-behavior: smooth;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.35s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease, padding 0.3s ease;
    }

    #yt-inline-container.open {
      opacity: 1;
      padding: 18px 14px;
    }

    /* Modern Scrollbar for Video Container */
    #yt-inline-container::-webkit-scrollbar { height: 10px; }
    #yt-inline-container::-webkit-scrollbar-track { background: transparent; }
    #yt-inline-container::-webkit-scrollbar-thumb {
      background: var(--wiki-scrollbar-thumb);
      border-radius: 10px;
      border: 3px solid transparent;
      background-clip: content-box;
    }

    /* YouTube Thumbnail Cards */
    .yt-video-card {
      flex: 0 0 auto;
      width: 220px;
      border-radius: 10px;
      overflow: hidden;
      text-decoration: none !important;
      background: var(--wiki-input-bg);
      border: 1px solid var(--wiki-glass-border);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      flex-direction: column;
    }

    .yt-video-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--wiki-shadow-focus);
    }

    .yt-thumbnail {
      width: 100%;
      height: 124px;
      object-fit: cover;
      position: relative;
    }

    .yt-play-overlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 44px;
      height: 44px;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      opacity: 0;
      backdrop-filter: blur(4px);
      transition: opacity 0.2s ease, background 0.2s ease;
    }

    .yt-video-card:hover .yt-play-overlay {
      opacity: 1;
      background: rgba(255, 0, 0, 0.9);
    }

    .yt-title {
      padding: 12px;
      font-size: 13px;
      color: var(--wiki-text-main);
      white-space: normal;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.4;
    }

    #yt-loading {
      padding: 14px 18px;
      font-style: italic;
      color: var(--wiki-text-muted);
    }

    /* =========================================
       Animations
       ========================================= */
    .wiki-settings-btn {
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      background: var(--wiki-glass-bg);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--wiki-glass-border);
      border-radius: 50%;
      width: 44px; height: 44px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: var(--wiki-shadow);
      color: var(--wiki-text-muted);
      transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, color 0.2s ease;
    }

    .wiki-settings-btn:hover {
      transform: scale(1.1) rotate(15deg);
      box-shadow: var(--wiki-shadow-focus);
      color: var(--wiki-text-main);
    }

    .wiki-settings-btn:active {
      transform: scale(0.95) rotate(0deg);
    }

    /* Settings Panel Animations */
    #wiki-preview-settings {
      transform-origin: bottom right; /* Always grows from the button */
      opacity: 0;
      transform: scale(0.95) translateY(10px);
      transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    #wiki-preview-settings.show {
      opacity: 1;
      transform: scale(1) translateY(0);
    }

    /* Header Icons Hovers */
    .wiki-preview-close-btn svg,
    .wiki-preview-pin-btn svg,
    .wiki-preview-expanse-toggle svg {
      transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .wiki-preview-close-btn:hover svg {
      transform: rotate(90deg) scale(1.1);
    }

    .wiki-preview-pin-btn:hover svg {
      transform: translateY(-2px) scale(1.1);
    }

    .wiki-preview-expanse-toggle:hover svg {
      transform: scale(1.1);
    }

    /* Flip the minus to a plus via rotation when collapsed */
    .inline-window.collapsed .wiki-preview-expanse-toggle svg {
      transform: rotate(180deg);
    }

    /* === The Hourglass Sand Animation === */
    .hourglass-icon {
      animation: hourglass-flip 2.5s cubic-bezier(0.45, 0, 0.55, 1) infinite;
    }
    .sand-top {
      transform-origin: center bottom;
      animation: sand-empty 2.5s linear infinite;
    }
    .sand-bottom {
      transform-origin: center bottom;
      animation: sand-fill 2.5s linear infinite;
    }
    .sand-stream {
      animation: sand-stream-fade 2.5s linear infinite;
    }

    @keyframes hourglass-flip {
      0%, 80% { transform: rotate(0deg); }
      100% { transform: rotate(180deg); }
    }
    @keyframes sand-empty {
      0% { transform: scaleY(1); }
      100% { transform: scaleY(0); }
    }
    @keyframes sand-fill {
      0% { transform: scaleY(0); }
      100% { transform: scaleY(1); }
    }
    @keyframes sand-stream-fade {
      0%, 5% { opacity: 0; }
      10%, 70% { opacity: 1; }
      75%, 100% { opacity: 0; }
    }
  `);

  function bringToFront(windowEl) {
    nextZIndex++;
    windowEl.style.zIndex = nextZIndex;
    windowEl.focus();
  }

  function getSmartPosition(linkRect, previewWidth, previewHeight) {
    const padding = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Start directly below and centered on the link
    let fixedLeft = linkRect.right - (previewWidth / 2);
    let fixedTop = linkRect.bottom + padding;

    // --- Vertical Bounds (Screen Edge Detection) ---
    if (fixedTop + previewHeight + padding > viewportHeight) {
      let topAbove = linkRect.top - previewHeight - padding;
      if (topAbove > padding) {
        fixedTop = topAbove; // Flip it perfectly above the link
      } else {
        // Pin to bottom of screen
        fixedTop = viewportHeight - previewHeight - padding;
      }
    }
    if (fixedTop < padding) {
       fixedTop = padding; // Pin to top
    }

    // --- Horizontal Bounds (Screen Edge Detection) ---
    if (fixedLeft + previewWidth + padding > viewportWidth) {
      fixedLeft = viewportWidth - previewWidth - padding;
    }
    if (fixedLeft < padding) {
      fixedLeft = padding;
    }

    // Calculate Animation Origin based on cursor/link physical position
    let originXPercent = ((linkRect.right - fixedLeft) / previewWidth) * 100;
    let originYPercent = ((linkRect.bottom - fixedTop) / previewHeight) * 100;

    originXPercent = Math.max(0, Math.min(100, originXPercent));
    originYPercent = Math.max(0, Math.min(100, originYPercent));

    return {
      left: fixedLeft,
      top: fixedTop,
      origin: `${originXPercent}% ${originYPercent}%`
    };
  }

  const previewCache = new Map();

  // === Debounce Utility ===
  function debounce(func, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => func.apply(this, args), delay);
    };
  }

  function handleInnerLinkClick(e) {
    const link = e.target.closest('a');
    if (link && isInternalWikiLink(link)) {
      e.preventDefault();
      loadPreviewContent(link.href, e.currentTarget);
    }
  }

  function loadPreviewContent(url, containerEl) {
    logMessage('Fetching preview for URL:', url);
    GM_xmlhttpRequest({
      method: 'GET',
      url: url,
      onload: function (response) {
        const html = response.responseText;
        const preview = extractRelevantPreview(html);
        containerEl.innerHTML = safeHTML(preview);
      },
      onerror: function () {
        containerEl.innerHTML = safeHTML('<em>Error loading preview</em>');
      },
    });
  }

  function extractTitleFromURL(url) {
    try {
      const parsed = new URL(url);

      if (parsed.pathname.includes('/wiki/')) {
        return decodeURIComponent(parsed.pathname.split('/wiki/')[1] || '');
      }

      if (parsed.hostname.includes('d-addicts.com')) {
        return decodeURIComponent(parsed.pathname.substring(1));
      }

      return '';
    } catch {
      return '';
    }
  }

  // === Extract Preview HTML ===
  function extractRelevantPreview(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const content = doc.querySelector('#mw-content-text');
    if (!content) {
      content = doc.querySelector('.page__main') || doc.querySelector('#content');
    }
    return content ? content.innerHTML : '<em>No preview content found</em>';
  }

  // === Main Preview Creation Function ===
  function createPreview(url, windowID, linkRect, parentID = null) {
    logMessage('Creating preview for:', url);
    const container = document.createElement('div');
    container.className = 'inline-window';
    container.setAttribute('data-theme', getResolvedTheme());
    container.id = 'inlineWindow-' + windowID;
    if (parentID) {
      container.dataset.parentId = parentID;
    }
    const isPermanent = pinnedPreviews.has(url) || isShiftDown;
    container.dataset.state = isPermanent ? 'permanent' : 'temp';
    container.tabIndex = 0;
    container.dataset.windowId = windowID;
    openPreviews.push(container);

    container.addEventListener('mousedown', () => bringToFront(container));
    container.addEventListener('focus', () => bringToFront(container));

    const svgs = {
      minus: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
      plus: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
      pinOutline: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`,
      pinFilled: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`,
      close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
      hourglass: `<svg class="hourglass-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 22h14"></path><path d="M5 2h14"></path>
        <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path>
        <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path>
        <polygon class="sand-top" points="7.5,6 16.5,6 12,11.5" fill="currentColor" stroke="none"></polygon>
        <polygon class="sand-bottom" points="12,12.5 7.5,18 16.5,18" fill="currentColor" stroke="none"></polygon>
        <line class="sand-stream" x1="12" y1="11.5" x2="12" y2="18" stroke="currentColor" stroke-width="1.5"></line>
      </svg>`
    };

    container.innerHTML = safeHTML(`
      <div class="inline-header">
        <div class="wiki-title-wrapper">
          <span id="wiki-preview-title" title="Loading Preview…">Loading Preview…</span>
          <span class="wiki-temp-indicator" title="Temporary Window (Press Shift to keep open)">
            ${svgs.hourglass}
          </span>
        </div>
        <div id="wiki-preview-btn-container">
          <button class="wiki-preview-expanse-toggle" title="Collapse">${svgs.minus}</button>
          <button class="wiki-preview-pin-btn" title="Pin Preview">${svgs.pinOutline}</button>
          <button class="wiki-preview-close-btn" title="Close Preview">${svgs.close}</button>
        </div>
      </div>
      <div class="inline-content no-focus-outline">
        <div class="loading-spinner"></div>
      </div>
    `);

    document.body.appendChild(container);

    const inlineContent = container.querySelector('.inline-content');
    const previewTitle = container.querySelector('#wiki-preview-title');
    previewTitle.style.maxWidth = '250px';
    const btnContainer = container.querySelector('#wiki-preview-btn-container');

    const expanseToggle = container.querySelector(
      '.wiki-preview-expanse-toggle'
    );
    expanseToggle.addEventListener('click', () => container.classList.contains('collapsed') ? expandPreview() : collapsePreview());

    function collapsePreview() {
      container.dataset.expandedWidth = container.offsetWidth;
      container.dataset.expandedHeight = container.offsetHeight;

      container.classList.add('collapsed');
      expanseToggle.title = 'Expand';
      expanseToggle.innerHTML = safeHTML(svgs.plus); // Update SVG

      const headerHeight = container.querySelector('.inline-header').offsetHeight;
      container.style.height = `${headerHeight}px`;
      container.style.minWidth = '0px';
      container.style.width = '240px';
      container.style.resize = 'none';
      previewTitle.style.width = '100px';
    }

    function expandPreview() {
      container.classList.add('expanding');
      container.classList.remove('collapsed');
      expanseToggle.title = 'Collapse';
      expanseToggle.innerHTML = safeHTML(svgs.minus); // Update SVG

      container.style.width = `${container.dataset.expandedWidth}px`;
      container.style.height = `${container.dataset.expandedHeight}px`;
      container.style.resize = 'both';
      container.style.minWidth = '308px';

      setTimeout(() => {
        previewTitle.style.width = 'auto';
        container.classList.remove('expanding');
        sizeScroller(); // recalculate inner scroll area
      }, 250); // Match CSS transition duration
    }

    const closeBtn = container.querySelector('.wiki-preview-close-btn');
    closeBtn.addEventListener('click', () => {
      container.classList.remove('show');

      if (pinnedPreviews.has(url)) {
        pinnedPreviews.delete(url);
        sessionStorage.setItem(PINNED_PREVIEW_STORAGE_KEY, JSON.stringify([ ...pinnedPreviews ]));
      }

      const index = openPreviews.findIndex(w => w.id === container.id);
      if (index !== -1) openPreviews.splice(index, 1);

      setTimeout(() => {
        container.remove();
      }, 250);
    });

    const pinButton = container.querySelector('.wiki-preview-pin-btn');
    if (pinnedPreviews.has(url)) {
      pinPreview();
    }
    pinButton.addEventListener('click', () => container.classList.contains('pinned') ? unpinPreview() : pinPreview())

    function pinPreview() {
      container.classList.add('pinned');
      pinButton.innerHTML = safeHTML(svgs.pinFilled);

      pinnedPreviews.set(url, windowID);
      sessionStorage.setItem(PINNED_PREVIEW_STORAGE_KEY, JSON.stringify([ ...pinnedPreviews ]));
    }

    function unpinPreview() {
      container.classList.remove('pinned');
      pinButton.innerHTML = safeHTML(svgs.pinOutline);
      pinnedPreviews.delete(url);
      sessionStorage.setItem(PINNED_PREVIEW_STORAGE_KEY, JSON.stringify([ ...pinnedPreviews ]));
    }

    requestAnimationFrame(() => {
      const width = container.offsetWidth;
      const height = container.offsetHeight;

      const { left, top, origin } = getSmartPosition(linkRect, width, height);

      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      container.style.transformOrigin = origin;

      void container.offsetWidth;
      container.classList.add('show');
      setTimeout(() => {
        bringToFront(container);
      }, 250);
    });

    if (previewCache.has(url)) {
      logMessage('Cache detected for url: ', url);
      container.querySelector('.inline-content').innerHTML = previewCache.get(url);
      const previewTitleText = extractTitleFromURL(url).replace(/_/g, ' ');
      previewTitle.textContent = previewTitleText;
    } else {
      logMessage('Fetching content for url: ', url);
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        onload: function (response) {
          const html = response.responseText;
          const previewContent =
            extractRelevantPreview(html) || '<em>No preview available</em>';
          previewCache.set(url, previewContent);
          inlineContent.innerHTML = safeHTML(previewContent);
          const previewTitleText = extractTitleFromURL(url).replace(/_/g, ' ');
          previewTitle.textContent = previewTitleText;
          previewTitle.title = previewTitleText;
          container
            .querySelector('.inline-content')
            .addEventListener('click', handleInnerLinkClick);

          // Reattach the listeners for preview links
          const contentEl = container.querySelector('.inline-content');
          contentEl.innerHTML = safeHTML(previewContent);

          // Attach listeners to new links inside the preview
          const newLinks = contentEl.querySelectorAll('a[href]');
          newLinks.forEach(innerLink => {
            processLinks(innerLink);
          });
        },
        onerror: function (error) {
          logError('GM_xmlhttpRequest error:', error);
          container.querySelector('.inline-content').innerHTML =
            '<em>Error loading preview</em>';
        },
      });
    }

    const headerEl = container.querySelector('.inline-header');
    const scroller = inlineContent;

    container.style.overflow = 'hidden';
    Object.assign(scroller.style, {
      overflow: 'auto',
      overscrollBehavior: 'contain',
      position: 'relative',
      boxSizing: 'border-box'
    });

    function sizeScroller() {
      const h = container.clientHeight - headerEl.offsetHeight;
      scroller.style.height = Math.max(0, h) + 'px';
    }
    sizeScroller();

    new ResizeObserver(sizeScroller).observe(container);

    const resizePreviewTitle = () => {
      previewTitle.style.maxWidth = '0px';
      const newWidth = container.getBoundingClientRect().width - btnContainer.getBoundingClientRect().width - 30;
      previewTitle.style.maxWidth = `${newWidth}px`;
      sizeScroller();
    }

    makeElementDragAndResize(
      container,
      container.querySelector('.inline-header'),
      {
        onResizeEnd: resizePreviewTitle,
        onResizing: resizePreviewTitle,
      }
    );

    (function attachScrollGuard(el, rootForCapture) {
      const cueTop = document.createElement('div');
      const cueBottom = document.createElement('div');
      Object.assign(cueTop.style, {
        position: 'absolute', top: 0, left: 0, right: 0, height: '12px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,.35), transparent)',
        opacity: 0, pointerEvents: 'none', transition: 'opacity 150ms ease'
      });
      Object.assign(cueBottom.style, {
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '12px',
        background: 'linear-gradient(to top, rgba(0,0,0,.35), transparent)',
        opacity: 0, pointerEvents: 'none', transition: 'opacity 150ms ease'
      });
      el.appendChild(cueTop);
      el.appendChild(cueBottom);

      const show = (node) => {
        node.style.opacity = '1';
        clearTimeout(node._t);
        node._t = setTimeout(() => { node.style.opacity = '0' }, 180);
      };

      (rootForCapture || el).addEventListener('wheel', (e) => {
        e.stopPropagation();
      }, { capture: true });

      el.addEventListener('wheel', (e) => {
        const maxY = el.scrollHeight - el.clientHeight;
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop >= (maxY - 1);

        if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
          e.preventDefault();
          show(e.deltaY < 0 ? cueTop : cueBottom);
        }
        e.stopPropagation();
      }, { passive: false });

      el.addEventListener('mouseenter', () => el.parentElement.focus?.(), { passive: true });
      el.addEventListener('mouseleave', () => el.parentElement.blur?.(), { passive: true });
    })(scroller, container);

    container.addEventListener('mouseenter', () => {
      let currentID = windowID;

      while (currentID) {
        if (bridgeTimers.has(currentID)) {
          clearTimeout(bridgeTimers.get(currentID));
          bridgeTimers.delete(currentID);
        }
        const win = document.getElementById('inlineWindow-' + currentID);
        currentID = win ? win.dataset.parentId : null;
      }
    });

    container.addEventListener('mouseleave', () => {
      if (container.dataset.state === 'temp') {
        const timer = setTimeout(() => {
          closeInlineWindows(windowID);
          bridgeTimers.delete(windowID);
        }, BRIDGE_DELAY);
        bridgeTimers.set(windowID, timer);
      }
    });

    return container;
  }

  function findParentInlineWindow(node) {
    while (node) {
      if (node.id && node.id.indexOf('inlineWindow-') == 0) return node;
      node = node.parentNode;
    }
    return null;
  }

  function closeInlineWindows(targetWindowId = null) {
    [...openPreviews].forEach(preview => {
      if (targetWindowId && preview.dataset.windowId !== targetWindowId) return;

      if (!preview.classList.contains('pinned')) {
        preview.classList.remove('show');

        const index = openPreviews.indexOf(preview);
        if (index !== -1) openPreviews.splice(index, 1);

        setTimeout(() => {
          preview.remove();
        }, 250);
      }
    });
  }

  var icon = document.createElement('span');
  icon.className = 'wiki-preview-icon';
  icon.innerHTML = safeHTML(`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`);
  icon.style.cursor = 'pointer';
  icon.style.marginLeft = '0.3em';

  function isInternalWikiLink(link) {
    if (!link || !link.hostname || !link.pathname) return false;

    const host = link.hostname;
    const path = link.pathname;

    const isStandardWiki = host.match(/(wikipedia\.org|wiktionary\.org|fandom\.com)/);
    const hasStandardPath = path.startsWith('/wiki/') || path.includes('index.php');

    const isDAddicts = host.includes('d-addicts.com') && path.length > 1;

    const isNotSpecialPage = !path.includes('Special:') && !path.includes('User:');

    return ((isStandardWiki && hasStandardPath) || isDAddicts) && isNotSpecialPage;
  }

  // === Smart Theme Detection ===
  function isPageDark() {
    try {
      const bg = window.getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g);
      if (!rgb || rgb.length < 3) return false;

      const r = parseInt(rgb[0]), g = parseInt(rgb[1]), b = parseInt(rgb[2]);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      return luminance < 0.5;
    } catch (e) {
      return false;
    }
  }

  function getResolvedTheme() {
    if (config.theme === 'auto') {
      return isPageDark() ? 'dark' : 'light';
    }
    return config.theme;
  }

  function applyTheme() {
    const resolved = getResolvedTheme();
    logMessage(`Theme resolved to: ${resolved} (Config: ${config.theme})`);

    openPreviews.forEach(preview => {
      preview.setAttribute('data-theme', resolved);
    });

    const settingsPanel = document.getElementById('wiki-preview-settings');
    if (settingsPanel) {
      settingsPanel.setAttribute('data-theme', resolved);
    }

    const ytWrapper = document.getElementById('yt-inline-wrapper');
    if (ytWrapper) {
      ytWrapper.setAttribute('data-theme', resolved);
    }
  }

  function refreshLinkListeners() {
    const links = document.querySelectorAll('a[href]');
    hoverState = new WeakMap();

    links.forEach(link => {
      if (!isInternalWikiLink(link)) return;

      // Remove any previously attached icon
      const next = link.nextSibling;
      if (
        next &&
        next.classList &&
        next.classList.contains('wiki-preview-icon')
      ) {
        next.remove();
        link.removeAttribute('preview-icon');
      }

      // Replace with a clone to remove old listeners
      const clone = link.cloneNode(true);
      link.replaceWith(clone);

      processedLinks.delete(clone);

      processLinks(clone);
    });

    closeInlineWindows();
  }

  function nudgeOpenWindow(window) {
    if (!window) return;
    window.animate(
      [
        { transform: 'translateY(0)' },
        { transform: 'translateY(-8px)' },
        { transform: 'translateY(4px)' },
        { transform: 'translateY(-3px)' },
        { transform: 'translateY(2px)' },
        { transform: 'translateY(-1px)' },
        { transform: 'translateY(1px)' },
        { transform: 'translateY(-0.5px)' },
        { transform: 'translateY(0.5px)' },
        { transform: 'translateY(0)' },
      ],
      {
        duration: 400,
        iterations: 1,
        easing: 'linear',
      }
    );
  }

  function processLinks(link = null) {
    if (!config.preview) {
      logMessage('Listeners skipped: preview is disabled');
      return;
    }
    if (link !== null) {
      attachListeners(link);
      processedLinks.add(link);
      return;
    }
    const links = document.querySelectorAll('a[href]');
    logMessage('Attaching listeners to:', links.length, 'links');
    links.forEach(link => {
      if (!isInternalWikiLink(link)) return;
      processedLinks.add(link);
      attachListeners(link);
    });
  }

  function attachListeners(link) {
    if (config.trigger === 'hover') {
      logDebug('Icon skipped: hover-only trigger');
    } else {
      attachClickPreviewIcon(link);
    }

    if (config.trigger === 'icon') {
      logDebug('Hover skipped: icon-only trigger');
    } else {
      attachHoverListeners(link);
    }
  }

  function attachHoverListeners(link) {
    link.addEventListener('mouseenter', () => {
      currentlyHoveredLink = link;

      // FIX: Use setTimeout directly so we have a reliable ID to cancel
      const timeoutId = setTimeout(() => hoverDetected(link), config.hoverDelay);
      hoverState.set(link, timeoutId);
    });

    link.addEventListener('mouseleave', () => {
      currentlyHoveredLink = null;

      // Cancel the opening timer if they move away too fast
      const timeoutId = hoverState.get(link);
      if (timeoutId) {
        clearTimeout(timeoutId);
        hoverState.delete(link);
      }

      // --- The Hover Bridge (Link Side) ---
      const windowID = link.getAttribute('inlinewindow');
      const openWindow = windowID ? document.getElementById('inlineWindow-' + windowID) : null;

      // If the window already spawned, start the kill timer
      if (openWindow && openWindow.dataset.state === 'temp') {
        const timer = setTimeout(() => {
          closeInlineWindows(windowID);
          bridgeTimers.delete(windowID);
        }, BRIDGE_DELAY);
        bridgeTimers.set(windowID, timer);
      }
    });
  }

  function attachClickPreviewIcon(link) {
    if (link.getAttribute('preview-icon') === 'true') return;

    const iconNode = icon.cloneNode(true);
    const windowID = link.getAttribute('inlinewindow') || getUniqueId();
    link.setAttribute('inlinewindow', windowID);

    iconNode.addEventListener('mouseenter', () => {
      const timeoutId = setTimeout(() => hoverDetected(link), config.hoverDelay);
      hoverState.set(iconNode, timeoutId);
    });

    iconNode.addEventListener('mouseleave', () => {
      const timeoutId = hoverState.get(iconNode);
      if (timeoutId) {
        clearTimeout(timeoutId);
        hoverState.delete(iconNode);
      }

      const openWindow = document.getElementById('inlineWindow-' + windowID);
      if (openWindow && openWindow.dataset.state === 'temp') {
        const timer = setTimeout(() => {
          closeInlineWindows(windowID);
          bridgeTimers.delete(windowID);
        }, BRIDGE_DELAY);
        bridgeTimers.set(windowID, timer);
      }
    });

    iconNode.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();

      let openWindow = document.getElementById('inlineWindow-' + windowID);

      if (!openWindow) {
        const rect = link.getBoundingClientRect();
        const parentWindow = findParentInlineWindow(link);
        const parentID = parentWindow ? parentWindow.dataset.windowId : null;

        openWindow = createPreview(link.href, windowID, rect, parentID);
      } else {
        nudgeOpenWindow(openWindow);
      }

      openWindow.dataset.state = 'permanent';

      if (bridgeTimers.has(windowID)) {
        clearTimeout(bridgeTimers.get(windowID));
        bridgeTimers.delete(windowID);
      }
    });

    link.parentNode.insertBefore(iconNode, link.nextSibling);
    link.setAttribute('preview-icon', 'true');
  }

  function hoverDetected(link) {
    currentlyHoveredLink = link;
    // Allow hover trigger if configured, regardless of Shift/Ctrl
    if (!isInternalWikiLink(link)) return;
    if (!allowPreviewsInPreviews && findParentInlineWindow(link)) return;

    const windowID = link.getAttribute('inlinewindow') || getUniqueId();
    link.setAttribute('inlinewindow', windowID);

    const openWindow = document.getElementById('inlineWindow-' + windowID);

    if (!openWindow) {
      const rect = link.getBoundingClientRect();
      const parentWindow = findParentInlineWindow(link);
      const parentID = parentWindow ? parentWindow.dataset.windowId : null;

      createPreview(link.href, windowID, rect, parentID);
    } else {
      // If window exists and mouse returns to the link, cancel the kill timer!
      if (bridgeTimers.has(windowID)) {
        clearTimeout(bridgeTimers.get(windowID));
        bridgeTimers.delete(windowID);
      }
    }
  }

  document.addEventListener('keyup', e => {
    if (e.key === 'Shift') isShiftDown = false;
    if (e.key === 'Control') isControlDown = false;
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Shift' || e.key === 'Control') {
      isShiftDown = e.key === 'Shift';
      isControlDown = e.key === 'Control';
      if (e.key === 'Control') {
        e.preventDefault();
        e.stopPropagation();
      }
      openPreviews.forEach(preview => {
        if (preview.dataset.state === 'temp') {
          preview.dataset.state = 'permanent';

          // Nuke the kill timers so it stays open
          const windowID = preview.dataset.windowId;
          if (bridgeTimers.has(windowID)) {
            clearTimeout(bridgeTimers.get(windowID));
            bridgeTimers.delete(windowID);
          }
        }
      });
      if (currentlyHoveredLink && config.trigger !== 'icon') {
        hoverDetected(currentlyHoveredLink);
      }
    }
    if (openPreviews.length === 0) return;

    const active = document.activeElement;
    const index = openPreviews.findIndex(w => w === active);

    switch (e.key) {
      case 'Escape': {
        e.preventDefault();

        if (index !== -1 && active && active.dataset.windowId) {
          closeInlineWindows(active.dataset.windowId);

          if (openPreviews.length > 0) {
            bringToFront(openPreviews[openPreviews.length - 1]);
          }
        } else {
          const unpinnedWindows = openPreviews.filter(w => !w.classList.contains('pinned'));
          if (unpinnedWindows.length > 0) {
            const lastWindow = unpinnedWindows[unpinnedWindows.length - 1];
            closeInlineWindows(lastWindow.dataset.windowId);
          }
        }
        break;
      }

      case 'ArrowRight':
      case 'Tab': {
        e.preventDefault();
        if (index !== -1) {
          const newIdx = index;
          if (isShiftDown) {
            newIdx =
              openPreviews[
                (index - 1 + openPreviews.length) % openPreviews.length
              ];
          } else {
            newIdx = openPreviews[(index + 1) % openPreviews.length];
          }
          bringToFront(newIdx);
        }
        break;
      }

      case 'ArrowLeft': {
        e.preventDefault();
        if (index !== -1) {
          const prev =
            openPreviews[
              (index - 1 + openPreviews.length) % openPreviews.length
            ];
          bringToFront(prev);
        }
        break;
      }

      case 'Enter': {
        if (active && active.dataset && active.dataset.windowId) {
          const link = document.querySelector(
            `a[inlinewindow="${active.dataset.windowId}"]`
          );
          if (link) window.open(link.href, '_blank');
        }
        break;
      }
    }
  });

  function renderPinnedPreviews() {
    let yposShift = 0;
    let xposShift = 0;
    pinnedPreviews.forEach((value, key) => {
      const mockRect = {
        top: yposShift, bottom: yposShift,
        left: window.innerWidth - 60, right: window.innerWidth - 60
      };
      createPreview(key, value, mockRect);
      yposShift += 50;
    });
  }

  window.addEventListener('load', () => {
    processLinks();
    createSettingsButton();
    renderPinnedPreviews();
  });

  //===================== WikiTube =====================//
  const DAY_MILLIS = 24 * 60 * 60 * 1000;
  const CACHE_USE_WINDOW = 2 * DAY_MILLIS;
  const CACHE_CLEANUP_MAX_AGE = 5 * DAY_MILLIS;
  const MAX_RESULTS = 6;

  GM_registerMenuCommand('Set YouTube API Key', async () => {
    const newKey = prompt('Enter your YouTube API Key:', GM_getValue('YOUTUBE_API_KEY'));
    if (newKey === null) return;
    if (newKey && newKey.trim()) {
      GM_setValue('YOUTUBE_API_KEY', newKey.trim());
      showNotification('API Key saved!');
    } else {
      GM_deleteValue('YOUTUBE_API_KEY');
      showNotification('API Key removed.');
    }
  });

  GM_registerMenuCommand('Refresh Video Cache', () => {
    const title = getArticleTitle();
    localStorage.removeItem('ytCache:' + title);
    location.reload();
  });

  const getAPIKey = () => {
    return GM_getValue('YOUTUBE_API_KEY', '');
  };

  function getCachedVideos(title) {
    try {
      const data = JSON.parse(localStorage.getItem('ytCache:' + title));
      if (data && Date.now() - data.timestamp < CACHE_USE_WINDOW) {
        return data.results;
      }
    } catch (e) {}
    return null;
  }

  function setCachedVideos(title, results) {
    const data = {
      timestamp: Date.now(),
      results: results,
    };
    localStorage.setItem('ytCache:' + title, JSON.stringify(data));
  }

  function cleanOldCache(maxAgeMs = CACHE_CLEANUP_MAX_AGE) {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key.startsWith('ytCache:')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (!data.timestamp || now - data.timestamp > maxAgeMs) {
            localStorage.removeItem(key);
          }
        } catch (e) {
          localStorage.removeItem(key); // Remove if corrupted
        }
      }
    }
  }

  function isArticlePage() {
    const host = window.location.hostname;
    const path = window.location.pathname;

    const isStandardWiki = host.match(/(wikipedia\.org|wiktionary\.org|fandom\.com)/);
    const hasStandardPath = path.startsWith('/wiki/') || path.includes('index.php');

    const isDAddicts = host.includes('d-addicts.com') && path.length > 1;

    const isNotSpecialPage = !path.includes('Special:') && !path.includes('User:');
    const isNotHomePage = !['/wiki/Main_Page', '/wiki/Wikipedia:Portada', '/'].includes(path);

    return ((isStandardWiki && hasStandardPath) || isDAddicts) && isNotSpecialPage && isNotHomePage;
  }

  function getArticleTitle() {
    let heading = document.getElementById('firstHeading');
    if (!heading) heading = document.querySelector('.page-header__title');

    if (!heading) {
      let docTitle = document.title;
      docTitle = docTitle.split(' - ')[0];
      docTitle = docTitle.replace(/Wikipedia|Fandom|Wiktionary|DramaWiki/ig, '');
      return docTitle.trim();
    }

    return heading.innerText.trim();
  }

  function getMainContentContainer() {
    return document.getElementById('mw-content-text') ||
           document.querySelector('.page__main') ||
           document.querySelector('#content');
  }

  function fetchVideos(query, apiKey, callback) {
    const apiURL = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${MAX_RESULTS}&q=${encodeURIComponent(
      query
    )}&key=${apiKey}`;

    fetch(apiURL)
      .then(res => res.json())
      .then(data => {
        if (data.items && data.items.length > 0) {
          callback(data.items);
        } else {
          logWarning('YouTube API returned no results or an error:', data);
          callback([]);
        }
      })
      .catch(error => {
        logError('YouTube fetch failed:', error);
        callback([]);
      });
  }

  function showVideos(videos) {
    const wrapper = document.createElement('div');
    wrapper.id = 'yt-inline-wrapper';

    wrapper.setAttribute('data-theme', getResolvedTheme());

    const header = document.createElement('div');
    header.id = 'yt-header';
    header.innerHTML = safeHTML(`
      <span>Related YouTube Videos (${videos.length})</span>
      <svg class="yt-toggle-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.3s ease;">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `);

    const container = document.createElement('div');
    container.id = 'yt-inline-container';

    header.addEventListener('click', () => {
      const icon = header.querySelector('.yt-toggle-icon');
      if (container.classList.contains('open')) {
        container.style.maxHeight = '0px';
        icon.style.transform = 'rotate(0deg)';
      } else {
        container.style.maxHeight = '250px';
        icon.style.transform = 'rotate(180deg)';
      }
      container.classList.toggle('open');
    });

    videos.forEach(video => {
      const videoId = video.id.videoId;
      if (!videoId) return;

      // Use a textarea trick to safely decode HTML entities from the YouTube API
      const titleText = video.snippet ? video.snippet.title : 'YouTube Video';
      const decodedTitle = document.createElement('textarea');
      decodedTitle.innerHTML = titleText;

      const card = document.createElement('a');
      card.className = 'yt-video-card';
      card.href = `https://www.youtube.com/watch?v=${videoId}`;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';

      card.innerHTML = safeHTML(`
        <div style="position: relative;">
          <img class="yt-thumbnail" src="https://i.ytimg.com/vi/${videoId}/mqdefault.jpg" alt="Thumbnail">
          <div class="yt-play-overlay">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
        </div>
        <div class="yt-title" title="${decodedTitle.value.replace(/"/g, '&quot;')}">${decodedTitle.value}</div>
      `);

      container.appendChild(card);
    });

    wrapper.appendChild(header);
    wrapper.appendChild(container);

    const contentArea = getMainContentContainer();
    if (contentArea && contentArea.parentNode) {
      contentArea.parentNode.insertBefore(wrapper, contentArea);
    }
  }

  function initYouTubeInline() {
    if (!isArticlePage() || !config.wikiTube) return;

    const title = getArticleTitle();
    if (!title) {
      logWarning('Could not get the article title.');
      return;
    }

    cleanOldCache();

    const apiKey = getAPIKey();
    if (!apiKey) {
      logWarning(
        'YouTube API Key is missing. Use the user script menu to set it.'
      );
      return;
    }

    const contentArea = getMainContentContainer();
    if (!contentArea || !contentArea.parentNode) return;

    const loadingMessage = document.createElement('div');
    loadingMessage.id = 'yt-loading';
    loadingMessage.setAttribute('data-theme', getResolvedTheme());
    loadingMessage.textContent = 'Loading YouTube videos...';
    contentArea.parentNode.insertBefore(loadingMessage, contentArea);

    const cached = getCachedVideos(title);
    if (cached && cached.length > 0) {
      logMessage('Loaded YouTube videos from cache.');
      showVideos(cached);
      loadingMessage.remove();
    } else {
      logMessage('Fetching YouTube videos from API...');
      fetchVideos(title, apiKey, results => {
        loadingMessage.remove();

        if (results.length > 0) {
          setCachedVideos(title, results);
          showVideos(results);
        } else {
          logMessage('No related videos found for this topic.');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initYouTubeInline);
  } else {
    initYouTubeInline();
  }

  //======================== Settings Panel ========================//
  function createSettingsPanel() {
    const panel = document.createElement('div');
    panel.id = 'wiki-preview-settings';
    panel.setAttribute('data-theme', getResolvedTheme());
    panel.innerHTML = safeHTML(`
      <div class="wiki-enhancer-settings-header">
        <span><strong>Wikipedia Enhancer Settings</strong></span>
        <button id="wiki-enhancer-close-settings" title="Close">×</button>
      </div>
      <div class="wiki-enhancer-settings-body">
        <label class="wiki-setting-row">
          <span>Enable Previews</span>
          <input type="checkbox" id="wiki-preview-enabled" ${
            config.preview ? 'checked' : ''
          }>
        </label>
        <label class="wiki-setting-row">
          <span>Enable WikiTube</span>
          <input type="checkbox" id="wiki-tube-enabled" ${
            config.wikiTube ? 'checked' : ''
          }>
        </label>
        <label class="wiki-setting-row">
          <span>Enable Logging</span>
          <input type="checkbox" id="wiki-logging-enabled" ${
            config.logging ? 'checked' : ''
          }>
        </label>
        <label class="wiki-setting-row">
          <span>Hover Delay for Preview</span>
          <input type="number" id="wiki-hover-delay" value="${
            config.hoverDelay
          }" min="0">
        </label>
        <label class="wiki-setting-row">
          <span>Preview Theme</span>
          <select id="wiki-theme">
            <option value="auto" ${
              config.theme === 'auto' ? 'selected' : ''
            }>Auto</option>
            <option value="light" ${
              config.theme === 'light' ? 'selected' : ''
            }>Light</option>
            <option value="dark" ${
              config.theme === 'dark' ? 'selected' : ''
            }>Dark</option>
          </select>
        </label>
        <label class="wiki-setting-row">
          <span>Preview Trigger</span>
          <select id="wiki-trigger">
            <option value="hover" ${
              config.trigger === 'hover' ? 'selected' : ''
            }>Hover</option>
            <option value="icon" ${
              config.trigger === 'icon' ? 'selected' : ''
            }>Icon</option>
            <option value="both" ${
              config.trigger === 'both' ? 'selected' : ''
            }>Both</option>
          </select>
        </label>
      </div>
    `);

    document.body.appendChild(panel);
    void panel.offsetWidth; // Force browser to register the start state
    panel.classList.add('show');

    // Close button handler
    document.getElementById('wiki-enhancer-close-settings').onclick = () => {
      panel.classList.remove('show');
      setTimeout(() => panel.remove(), 250);
    };

    // Bind input events
    document.getElementById('wiki-preview-enabled').onchange = e => {
      config.preview = e.target.checked;
      persistConfig(config);
      refreshLinkListeners();
    };
    document.getElementById('wiki-tube-enabled').onchange = e => {
      config.wikiTube = e.target.checked;
      persistConfig(config);
    };
    document.getElementById('wiki-logging-enabled').onchange = e => {
      config.logging = e.target.checked;
      persistConfig(config);
    };
    document.getElementById('wiki-hover-delay').onchange = e => {
      config.hoverDelay = parseInt(e.target.value, 10);
      persistConfig(config);
    };
    document.getElementById('wiki-theme').onchange = e => {
      config.theme = e.target.value;
      persistConfig(config);
      applyTheme();
    };
    document.getElementById('wiki-trigger').onchange = e => {
      config.trigger = e.target.value;
      persistConfig(config);
      refreshLinkListeners();
    };

    outsideClickClose(panel);
  }

  function createSettingsButton() {
    const btn = document.createElement('button');
    btn.className = 'wiki-settings-btn';
    btn.setAttribute('data-theme', getResolvedTheme());
    btn.textContent = getRandomIcon();
    btn.title = 'Wikipedia Preview Settings';

    btn.onclick = () => {
      const existingPanel = document.getElementById('wiki-preview-settings');
      if (!existingPanel) {
        createSettingsPanel();
      } else {
        // Allow toggling the menu closed by clicking the gear again
        existingPanel.classList.remove('show');
        setTimeout(() => existingPanel.remove(), 250);
      }
    };

    document.body.appendChild(btn);
  }
})();