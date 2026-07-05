// ==UserScript==
// @name         YouTube Zen
// @namespace    https://github.com/JYashu/flux-suite
// @version      5.1.0
// @description  Transform YouTube into a focused, music-centric environment. Removes Shorts, hides distractions, and auto-filters the homepage.
// @author       JYashu
// @license      Apache-2.0
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @match        https://www.youtube.com/
// @match        https://www.youtube.com/*
// @exclude      https://www.youtube.com/embed/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        none
// @run-at       document-idle
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

  if (window !== window.top) return;

  const { createLogger, createHTMLElement } = FluxKit.utils;
  const { showNotification } = FluxKit.ui;
  const { logMessage } = createLogger('YouTubeZen');

  logMessage('✅ Initialized');

  const TEMP_DISABLE_DURATION = 30 * 60 * 1000;
  const DISABLE_KEY = 'yt_script_temp_disabled';
  const DISABLE_TIME_KEY = 'yt_script_disabled_time';

  const style = createHTMLElement('style', { style: `
    ytd-shorts, 
    [tab-identifier="shorts-items"],
    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
    ytd-grid-video-renderer:has(span[aria-label="Shorts"]) { 
      display: none !important; 
    }
  `});
  document.head.appendChild(style);

  function isTemporarilyDisabled() {
    const disabled = localStorage.getItem(DISABLE_KEY) === 'true';
    const disabledAt = parseInt(localStorage.getItem(DISABLE_TIME_KEY) || '0', 10);

    if (disabled) {
      const now = Date.now();
      if (now - disabledAt >= TEMP_DISABLE_DURATION) {
        localStorage.setItem(DISABLE_KEY, 'false');
        showNotification('✅ YouTube-Zen re-enabled');
        return false;
      }
      return true;
    }
    return false;
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') {
      const currentlyDisabled = localStorage.getItem(DISABLE_KEY) === 'true';
      if (currentlyDisabled) {
        localStorage.setItem(DISABLE_KEY, 'false');
        showNotification('✅ YouTube-Zen re-enabled');
      } else {
        localStorage.setItem(DISABLE_KEY, 'true');
        localStorage.setItem(DISABLE_TIME_KEY, Date.now().toString());
        showNotification(`🚫 YouTube-Zen Disabled for ${TEMP_DISABLE_DURATION / (60 * 1000)} minutes`);
        window.location.reload();
      }
    }
  });

  const blockedElements = [
    'ytd-watch-next-secondary-results-renderer',
    'ytd-merch-shelf-renderer',
    '.ytp-endscreen-content'
  ];

  const allowedChips = ['music', 'mixes'];
  let autoClickDone = false;

  function isHomepage() { return window.location.pathname === '/'; }
  function isWatchPage() { return window.location.pathname.startsWith('/watch'); }

  function cleanPage() {
    if (isTemporarilyDisabled()) return;

    // Clean Watch page
    if (isWatchPage()) {
      blockedElements.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => { el.style.display = 'none' });
      });
      const button = document.querySelector('.ytp-size-button');
      if (button?.title.includes('Theater')) button.click();
    }

    removeShortsFromSidebar();
    rerouteHomeButton();
  }

  function removeShortsFromSidebar() {
    const shortsEntry = Array.from(document.querySelectorAll('ytd-guide-entry-renderer')).find(entry => {
      const label = entry.querySelector('yt-formatted-string');
      return label && label.textContent.trim().toLowerCase() === 'shorts';
    });
    if (shortsEntry) shortsEntry.remove();
  }

  function rerouteHomeButton() {
    const homeButton = Array.from(document.querySelectorAll('ytd-guide-entry-renderer')).find(entry => {
      const label = entry.querySelector('yt-formatted-string');
      return label && label.textContent.trim().toLowerCase() === 'home';
    });

    if (homeButton) {
      const link = homeButton.querySelector('a');
      if (link && !link.dataset.modified) {
        link.dataset.modified = 'true';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          setTimeout(() => {
            autoClickDone = false;
            window.location.href = 'https://www.youtube.com/';
          }, 10);
        });
      }
    }
  }

  function autoClickMusicTab() {
    if (!isHomepage() || autoClickDone) return;
    let attempts = 0;
    const interval = setInterval(() => {
      const musicChip = Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer')).find(chip => {
        const label = chip.querySelector('button > div');
        return label && label.textContent.trim().toLowerCase() === 'music';
      });

      if (musicChip && !musicChip.classList.contains('iron-selected')) {
        musicChip.querySelector('button')?.click();
      }

      if (musicChip?.classList.contains('iron-selected')) {
        autoClickDone = true;
        clearInterval(interval);
      }
      if (++attempts >= 40) clearInterval(interval);
    }, 300);
  }

  function filterChips() {
    if (!isHomepage()) return;
    document.querySelectorAll('yt-chip-cloud-chip-renderer').forEach(chip => {
      const label = chip.querySelector('button > div');
      const text = label?.textContent.trim().toLowerCase() || '';
      if (!allowedChips.some(keyword => text.includes(keyword))) chip.remove();
    });
  }

  function manageHomepageVisibility() {
    if (!isHomepage()) return;
    const contents = document.querySelector('ytd-rich-grid-renderer #contents');
    if (!contents) return;
    const selectedChip = Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer')).find(c => c.classList.contains('iron-selected'));
    const selectedText = selectedChip?.textContent?.trim().toLowerCase() || '';
    contents.style.display = allowedChips.some(k => selectedText.includes(k)) ? '' : 'none';
  }

  cleanPage();

  let lastPath = location.pathname;
  const observer = new MutationObserver(() => {
    if (isTemporarilyDisabled()) return;
    if (location.pathname !== lastPath || isHomepage()) {
      lastPath = location.pathname;
      if (!isWatchPage()) cleanPage();
      if (isHomepage()) {
        autoClickMusicTab();
        filterChips();
        manageHomepageVisibility();
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();