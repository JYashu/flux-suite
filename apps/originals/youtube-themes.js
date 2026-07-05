// ==UserScript==
// @name         YouTube Themes
// @namespace    https://github.com/JYashu/flux-suite
// @version      5.0.0
// @description  Enhance YouTube with custom UI themes, auto-HD playback, and advanced layout configuration (Tabview integration).
// @author       JYashu
// @license      Apache-2.0
// @icon         https://youtube-bits.s3.us-east-2.amazonaws.com/icon-yt.png
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @match        https://www.youtube.com/*
// @match        https://*.youtube.com/*
// @exclude      *://accounts.youtube.com/*
// @exclude      *://www.youtube.com/live_chat_replay*
// @exclude      *://www.youtube.com/persist_identity*
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==
/* global FluxKit, TTP */

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
 
  ('use strict');

  if (window !== window.top) return;

  const { createLogger } = FluxKit.utils;
  const { logMessage, logError, logWarning } = createLogger('FluxYouTube');

  //----------------------------------
  // Helpers: DOM waiters & storage – Configuration / defaults
  //----------------------------------
  const STORAGE_KEY = 'flux_yt_config';

  const defaultConfig = {
    logging: false,
    tabViewSkin: true,
    customTheming: true,
    theme: 'hollowKnight',
  };

  let config = initializeConfig();
  window.FluxYouTube = config;

  function initializeConfig() {
    try {
      const saved = GM_getValue(STORAGE_KEY);
      if (!saved) {
        logMessage('No config found, initializing default');
        GM_setValue(STORAGE_KEY, defaultConfig);
        return { ...defaultConfig };
      }
      const mergedConfig = { ...defaultConfig, ...saved }
      localStorage.setItem('flux-yt-tabview-disbled', mergedConfig.tabViewSkin ? 'false' : 'true');
      return mergedConfig;
    } catch (e) {
      logError('Failed to read config, falling back to default:', e);
      GM_setValue(STORAGE_KEY, defaultConfig);
      localStorage.setItem('flux-yt-tabview-disbled', defaultConfig.tabViewSkin ? 'false' : 'true');
      return { ...defaultConfig };
    }
  }

  function persistConfig(newConfig) {
    try {
      config = newConfig;
      GM_setValue(STORAGE_KEY, config);
      logMessage('Config persisted:', config);
    } catch (e) {
      logError('Failed to save config: ', e, { __v: 1 });
    }
  }

  function waitForPageLoad(callback) {
    if (document.readyState === 'complete') {
      callback();
    } else {
      window.addEventListener('DOMContentLoaded', callback, { once: true });
      window.addEventListener('load', callback, { once: true });
    }
  }

  function waitFor(selector, root = document, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const el = root.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const e = root.querySelector(selector);
        if (e) {
          obs.disconnect();
          resolve(e);
        }
      });
      obs.observe(root, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        reject(new Error('Timeout waiting for ' + selector));
      }, timeout);
    });
  }

  function whenAvailable(selectors, timeout = 15000) {
    // Try to find any of multiple selectors (returns first found element for first matching selector)
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeout;
      const tryNow = () => {
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el) return resolve(el);
        }
        if (Date.now() > deadline) {
          return reject(new Error('Timeout waiting for selectors'));
        }
        requestAnimationFrame(tryNow);
      };
      tryNow();
    });
  }

  //----------------------------------
  // Tools + UI Elements
  //----------------------------------
  const settingsModalCss =
    '.yt-settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 99999; animation: fadeIn 0.2s ease-out; } @keyframes fadeIn { from {opacity: 0;} to {opacity: 1;} } .yt-settings-modal { background: #fff; border-radius: 12px; padding: 20px 24px; min-width: 300px; max-width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.2); font-family: sans-serif; color: #111; animation: slideIn 0.25s ease-out; } @keyframes slideIn { from {transform: translateY(-10px); opacity:0;} to {transform: translateY(0); opacity: 1;} } .yt-settings-header { font-size: 18px; font-weight: bold; margin-bottom: 15px; } .yt-setting-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee; } .yt-setting-label { flex: 1; font-size: 13px; } /* Modern toggle switch */ .switch { position: relative; display: inline-block; width: 46px; height: 24px; } .switch input { opacity: 0; width: 0; height: 0; } .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .3s; border-radius: 34px; } .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; } input:checked + .slider { background-color: #3ea6ff; } input:checked + .slider:before { transform: translateX(22px); } .yt-settings-footer { display: flex; justify-content: end; gap: 8px; text-align: right; margin-top: 15px; } .yt-btn { background: #3ea6ff; color: white; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 14px; transition: background 0.2s; } .yt-btn:hover { background: #2196f3; }';

  GM_addStyle(settingsModalCss);

  function openSettings() {
    if (document.querySelector('.yt-settings-overlay')) {
      return;
    }
    const { tabViewSkin } = { ...config };

    function onTabviewSkinToggled(isNowEnabled) {
      localStorage.setItem('flux-yt-tabview-disbled', isNowEnabled ? 'false' : 'true');
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'flux-yt-tabview-disbled',
          newValue: isNowEnabled ? 'false' : 'true'
        }));
    }

    function isReloadNeeded() {
      return tabViewSkin !== config.tabViewSkin;
    }

    const overlay = document.createElement('div');
    overlay.className = 'yt-settings-overlay';

    const modal = document.createElement('div');
    modal.className = 'yt-settings-modal';

    const header = document.createElement('div');
    header.className = 'yt-settings-header';
    header.textContent = 'YouTube Settings';
    modal.appendChild(header);

    // Labels for boolean toggles
    const labels = {
      logging: 'Enable Logging',
      customTheming: 'Enable Custom Themes',
      tabViewSkin: 'Eable Tab View',
    };

    // Create boolean toggles
    Object.keys(labels).forEach(key => {
      const row = document.createElement('div');
      row.className = 'yt-setting-row';

      const label = document.createElement('div');
      label.className = 'yt-setting-label';
      label.textContent = labels[key];
      row.appendChild(label);

      const toggleWrapper = document.createElement('label');
      toggleWrapper.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = config[key];
      input.addEventListener('change', () => {
        config[key] = input.checked;
        persistConfig(config);
        logMessage(
          'Config updated:',
          key,
          config[key] ? 'enabled' : 'disabled',
          { __v: key === 'logging' ? 1 : 0 }
        );
        if (key === 'customTheming') {
          initYouTubeTheming();
        }
      });

      const slider = document.createElement('span');
      slider.className = 'slider';

      toggleWrapper.appendChild(input);
      toggleWrapper.appendChild(slider);
      row.appendChild(toggleWrapper);

      modal.appendChild(row);
    });

    // Searchable theme dropdown
    const themeRow = document.createElement('div');
    themeRow.className = 'yt-setting-row';

    const themeLabel = document.createElement('div');
    themeLabel.className = 'yt-setting-label';
    themeLabel.textContent = 'Theme';
    themeRow.appendChild(themeLabel);

    // Container for search + list
    const dropdownContainer = document.createElement('div');
    dropdownContainer.style.position = 'relative';
    dropdownContainer.style.width = '180px';
    dropdownContainer.style.fontSize = '13px';

    // Search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search themes...';
    searchInput.value = config.theme;
    searchInput.style.width = '100%';
    searchInput.style.padding = '4px';
    searchInput.style.border = '1px solid #ccc';
    searchInput.style.borderRadius = '6px';
    searchInput.style.boxSizing = 'border-box';
    searchInput.readOnly = true; // clicking will open dropdown

    // Dropdown list
    const dropdownList = document.createElement('div');
    dropdownList.style.position = 'absolute';
    dropdownList.style.top = '100%';
    dropdownList.style.left = '0';
    dropdownList.style.width = '100%';
    dropdownList.style.maxHeight = '100px'; // ~4 items tall
    dropdownList.style.overflowY = 'auto';
    dropdownList.style.border = '1px solid #ccc';
    dropdownList.style.borderRadius = '6px';
    dropdownList.style.background = '#fff';
    dropdownList.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
    dropdownList.style.display = 'none';
    dropdownList.style.zIndex = '100000';

    const themes = [
      'pokeTube',
      'hollowKnight',
      'nyanCat',
      'goku',
      'cinnamonRoll',
      'kuromi',
      'pikachu',
      'starWars',
      'purin',
      'frieren',
      'nezuko',
      'jotaro',
      'sonic',
      'hellokitty',
      'spidey',
      'random',
    ];

    function renderList(filter = '') {
      dropdownList.innerHTML = '';
      themes
        .filter(theme => theme.toLowerCase().includes(filter.toLowerCase()))
        .forEach(theme => {
          const item = document.createElement('div');
          item.textContent = theme;
          item.style.padding = '4px 8px';
          item.style.cursor = 'pointer';
          if (theme === config.theme) {
            item.style.background = '#3ea6ff';
            item.style.color = '#fff';
          }
          item.addEventListener('click', () => {
            config.theme = theme;
            persistConfig(config);
            logMessage('Theme changed to:', config.theme);
            initYouTubeTheming();
            searchInput.value = theme;
            dropdownList.style.display = 'none';
          });
          item.addEventListener('mouseenter', () => {
            item.style.background = '#eee';
          });
          item.addEventListener('mouseleave', () => {
            if (theme === config.theme) {
              item.style.background = '#3ea6ff';
              item.style.color = '#fff';
            } else {
              item.style.background = '';
              item.style.color = '';
            }
          });
          dropdownList.appendChild(item);
        });
    }

    // Toggle dropdown visibility
    searchInput.addEventListener('click', () => {
      if (dropdownList.style.display === 'none') {
        dropdownList.style.display = 'block';
        searchInput.readOnly = false;
        searchInput.focus();
        renderList();
      } else {
        dropdownList.style.display = 'none';
      }
    });

    // Filter while typing
    searchInput.addEventListener('input', () => {
      renderList(searchInput.value);
    });

    // Close when clicking outside
    document.addEventListener('click', e => {
      if (!dropdownContainer.contains(e.target)) {
        dropdownList.style.display = 'none';
        searchInput.readOnly = true;
      }
    });

    dropdownContainer.appendChild(searchInput);
    dropdownContainer.appendChild(dropdownList);
    themeRow.appendChild(dropdownContainer);
    modal.appendChild(themeRow);

    // Footer with close button
    const footer = document.createElement('div');
    footer.className = 'yt-settings-footer';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'yt-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      overlay.remove();
      if (isReloadNeeded()) {
        onTabviewSkinToggled(config.tabViewSkin);
      }
    });
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    // Close on overlay click
    overlay.appendChild(modal);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.remove();
        if (isReloadNeeded()) {
          window.location.reload();
        }
      }
    });

    document.body.appendChild(overlay);
  }

  const getVideo = () => document.querySelector('video.html5-main-video');
  const getPlayer = () => document.querySelector('ytd-player')?.player_;
  const getPlayerContainer = () => document.querySelector('div.html5-video-player#movie_player');

  GM_registerMenuCommand('Settings', () => {
    openSettings();
  });

  //----------------------------------
  // Video init [Auto HD]
  //----------------------------------
  const PREFERRED_QUALITIES = [
    //'highres', // 8K
    //'hd2160', // 4K
    'hd1440', // 1440p
    'hd1080', // 1080p
    'hd720', // 720p
    'large', // 480p
    'medium', // 360p
    'small', // 240p
    'tiny', // 144p
  ];

  function setBestAvailableQuality() {
    const ytPlayer = getPlayerContainer();
    if (!ytPlayer || typeof ytPlayer.getAvailableQualityLevels !== 'function')
      return;

    const availableQualities = ytPlayer.getAvailableQualityLevels();
    if (!availableQualities || availableQualities.length === 0) return;

    for (let quality of PREFERRED_QUALITIES) {
      if (availableQualities.includes(quality)) {
        ytPlayer.setPlaybackQualityRange(quality);
        ytPlayer.setPlaybackQuality(quality);
        logMessage('[YouTube Auto HD] Set to:', quality);
        break;
      }
    }
  }

  function onVideoChange() {
    const video = getVideo();
    if (!video) return;
    setTimeout(setBestAvailableQuality, 1000);
  }

  function initVideoListeners() {
    let mutationTimeout;

    window.addEventListener('yt-navigate-finish', onVideoChange);

    const observer = new MutationObserver(mutations => {
      const videoAdded = mutations.some(m =>
        [...m.addedNodes].some(node => node.tagName === 'VIDEO')
      );
      if (videoAdded) {
        clearTimeout(mutationTimeout);
        mutationTimeout = setTimeout(onVideoChange, 300);
      }
    });

    const playerContainer = document.getElementById('player') || document.body;
    observer.observe(playerContainer, { childList: true, subtree: true });

    onVideoChange();
  }

  waitForPageLoad(() => initVideoListeners());

  //----------------------------------
  // Custom Styles/Skins
  //----------------------------------
  let appliedThemeStyles = [];

  const BROAD_PROGRESS_BAR =
    '.ytp-progress-bar-container:hover .ytp-load-progress, .ytp-progress-bar-container:hover .ytp-scrubber-button {image-rendering: pixelated} .html5-progress-bar-container, .ytp-progress-bar-container {height: 8px !important} .html5-progress-bar, .ytp-progress-bar {margin-top: 8px !important} .html5-progress-list, .video-ads .html5-progress-list.html5-ad-progress-list, .video-ads .ytp-progress-list.ytp-ad-progress-list, .ytp-progress-list {height: 8px !important}';

  const logoThemes = {
    kuromi:
      '#logo-icon { content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/kuromi.webp") !important; width: 70px; height: 70px; object-fit: cover; } ytd-topbar-logo-renderer { width: 0%; }',
    nyanCat:
      '#logo-icon{content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/nyan-cat.gif") !important;width: 80px !important;height: 65px;object-fit: fit; transform: scale(0.7) !important; padding-top: 28px; }ytd-topbar-logo-renderer{width:0%;}',
    pikachu:
      '#logo-icon{content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/pikachu.gif") !important;width: 80px !important;height: 65px;object-fit: fit;}ytd-topbar-logo-renderer{width:0%;}',
    goku: '.ytd-topbar-logo-renderer{ width: 0%; }#logo-icon{ content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/goku.webp") !important; width: 55px; height: 55px; object-fit: cover;}#country-code{ display: none!important;}',
    hollowKnight:
      '#logo-icon {content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/hollow-knight.webp") !important;width: 70px !important;height: 50px !important;object-fit: cover !important;transform: translateY(-22px) !important;}.ytd-topbar-logo-renderer {transform: translateY(10px) !important;color: #687dde !important;}ytd-topbar-logo-renderer {width: 0% !important;}',
    cinnamonRoll:
      '#logo-icon {content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/cinnamon-roll.gif") !important;width: 85px;height: 50px;object-fit: cover;} ytd-topbar-logo-renderer{width: 0%;}',
    spidey:
      'ytd-topbar-logo-renderer{ width: 0%; }#logo-icon{ content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/spidey.webp") !important; width: 100px; height: 100px; object-fit: cover;}',
    frieren:
      '#logo-icon {content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/frieren.gif") !important;width: 75px !important;height: 55px;object-fit: fit; } ytd-topbar-logo-renderer {width: 0%;}',
    pokeTube: '{}',

    purin:
      '#logo-icon {content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/purin.webp") !important;width: 100px;height: 50px;object-fit: cover;} ytd-topbar-logo-renderer {width: 0%;',
    helloKitty:
      '#logo-icon{content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/hello-kitty.gif") !important;width: 80px !important;height: 65px;object-fit: fit;}ytd-topbar-logo-renderer{width:0%;}',
    cannabis:
      'ytd-topbar-logo-renderer{ width: 0%; }#logo-icon{ content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/cannabis.webp") !important; width: 55px; height: 55px; object-fit: cover;}#country-code{ display: none!Important;}',
  };

  const progressBarThemes = {
    pokeTube: `/********************************//*PokeTube by YAD*//********************************/body { font-family: PokeTubeFont !important; cursor: url("none"), auto !important;}/*option*/tp-yt-paper-listbox { background: #ef7d21 !important;}tp-yt-paper-listbox.yt-dropdown-menu { background-color: #ef7d21 !important;}tp-yt-paper-listbox.yt-dropdown-menu tp-yt-paper-item.yt-dropdown-menu { font-weight: inherit !important; background-color: #e9ab78 !important;}tp-yt-paper-listbox.yt-dropdown-menu tp-yt-paper-item.yt-dropdown-menu:hover { background-color: #27c9d5 !important;}tp-yt-paper-menu-button[vertical-align="top"] .dropdown-content.tp-yt-paper-menu-button { box-shadow: 0px 0px 0px 2px #856142 !important;}ytd-menu-popup-renderer { background-color: #fff0 !important; border-radius: 11px !important; box-shadow: 0px 0px 0px 3px #554242 !important;}yt-icon.ytd-topbar-logo-renderer,[id="logo"][class="style-scope ytd-masthead"] yt-icon.ytd-logo,tp-yt-app-drawer[opened] [class="style-scope ytd-logo"][id="logo-icon"] { /*logo*/ animation-name: logoyad !important; filter: none !important; animation-duration: 0.8s !important; animation-iteration-count: 1 !important; fill-opacity: 0 !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/poke-tube.png") !important; background-position: center !important; background-size: 100% !important; background-repeat: no-repeat !important; width: 100% !important; height: 50px !important; max-width: 70px !important; max-height: 100px !important;}/*Description*/#description { background-color: #fffde0 !important; color: #433d45 !important;}yt-formatted-string.ytd-watch-info-text,yt-formatted-string.ytd-channel-name a,ytd-text-inline-expander#description-inline-expander span.yt-core-attributed-string--link-inherit-color,ytd-text-inline-expander#inline-expander span.yt-core-attributed-string--link-inherit-color,.yt-video-attribute-view-model__title { color: #433d45 !important;}span.yt-core-attributed-string--link-inherit-color { color: #e5e0e0d1 !important;}yt-formatted-string#owner-sub-count { color: #fff !important;}yt-formatted-string > a { color: #433d45a3 !important;}.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--outline,.yt-spec-button-shape-next--call-to-action,ytd-button-renderer.ytd-masthead button.yt-spec-button-shape-next { color: #523a5ba3 !important; border: 1px solid #523a5ba3 !important;}ytd-button-renderer.ytd-masthead button.yt-spec-button-shape-next span.ytIconWrapperHost,yt-icon-badge-shape span.ytIconWrapperHost,yt-searchbox span.ytIconWrapperHost { color: #523a5ba3 !important;}.shortsLockupViewModelHostEndpoint { color: #523a5ba3 !important;}/*Tab View */${
      config.tabViewSkin
        ? '[tyt-tab] #right-tabs #material-tabs { background: #92d6cb;}ytd-watch-flexy #right-tabs .tab-content { background: #fffde0;}ytd-item-section-renderer a.yt-lockup-metadata-view-model-wiz__title > .yt-core-attributed-string,a.shortsLockupViewModelHostEndpoint > .yt-core-attributed-string { color: #433d45 !important;}ytd-item-section-renderer yt-content-metadata-view-model span.yt-core-attributed-string { color: #523a5ba3 !important;}.yt-core-image { border: 1ps solid #433d45;}.ytChipShapeChip { color: #523a5ba3 !important;}yt-chip-cloud-chip-renderer { border: 1px solid #523a5ba3 !important; border-radius: 9px;}#next-video-title.ytd-playlist-panel-renderer { color: #433d45 !important;}.byline-title.ytd-playlist-panel-renderer { color: #523a5be0 !important;}'
        : ''
    }/*country*/#country-code.ytd-topbar-logo-renderer { color: #fff !important; margin: 7px 0px 0px 2px !important;}/*trial dia*/tp-yt-paper-dialog { background: #90d5ca !important; color: aliceblue !important; box-shadow: 0px 0px 0px 3px #554949 !important; border-radius: 13px !important;}.ytd-topbar-logo-renderer:not(:active) { animation-name: logoyad !important; animation-duration: 0.8s !important; animation-iteration-count: 1 !important;}@keyframes logoyad { 0% { transform: scalex(0) } 25% { transform: scaleY(0.1) } 50% { transform: scalex(0.7) } 75% { transform: scaleY(0.15) }}/*playlist*/ytd-browse[page-subtype=playlist] { background-color: #f1f1f100 !important;}/**playlist page**/ytd-playlist-sidebar-renderer { background-color: #fff0 !important;}ytd-browse[page-subtype=playlist] ytd-two-column-browse-results-renderer.ytd-browse { background-color: #fff0 !important;}#container.ytd-playlist-panel-renderer { border: 1px solid #27c9d5 !important; box-shadow: 0px 0px 0px 3px #554242 !important;}.header.ytd-playlist-panel-renderer { background-color: #90d5ca !important; border: 2px solid #fff !important;}.playlist-items.ytd-playlist-panel-renderer { background-color: #fffde0 !important;}html:not(.style-scope)[dark],:not(.style-scope)[dark] { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-topbar1.png"), url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-topbar2.png"), #f0f098 !important; background-position-x: -15%, -4% !important; background-repeat: no-repeat !important; background-size: 440px, 440px !important; border: 0px solid #433c44 !important; box-shadow: inset 0px 0px 0px 4px #433c44 !important; animation: yadtop 1s 1 !important;}ytd-masthead[darker-dark-theme],ytd-masthead { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-topbar1.png"), url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-topbar2.png"), #4fb2ab !important; background-position-x: -15%, -4% !important; background-repeat: no-repeat !important; background-size: 440px, 440px !important; border: 0px solid #433c44 !important; border-radius: 0px 0px 10px 10px !important; box-shadow: inset 0px 0px 0px 4px #433c44 !important; animation: yadtop2 1s 1 !important;}@keyframes yadtop { 0% { transform: translateY(-65px) !important; background-position-x: -25%, -20% !important; } 100% { transform: translateY(0px) !important; }}@keyframes yadtop2 { 0% { transform: translateY(-65px) !important; background-position-x: -25%, -20% !important; } 100% { transform: translateY(0px) !important; }}/*div#content.style-scope.ytd-app { --ytd-masthead-height: inherit !important;}*/#logo-icon-container.ytd-topbar-logo-renderer #youtube-paths.ytd-topbar-logo-renderer path.ytd-topbar-logo-renderer { fill: #fff !important;}path.style-scope.ytd-topbar-logo-renderer { fill: #fd2b84 !important;}ytd-rich-grid-media[mini-mode] #video-title.ytd-rich-grid-media { text-shadow: 0 1px #a4a4a4 !important;}/*watched*/#progress.ytd-thumbnail-overlay-resume-playback-renderer { background-color: #fd2b4e !important;}ytd-compact-video-renderer:not([watch-feed-big-thumbs]) ytd-thumbnail.ytd-compact-video-renderer { margin-right: 8px !important; height: 94px !important; width: 168px !important;}/*thumbnails outline*/ytd-thumbnail #thumbnail.ytd-thumbnail { box-shadow: 0px 0px 0px 2px #554242 !important;}/*my eyes*/html:not(.style-scope) { --yt-spec-static-brand-red: #17a4c5 !important;}ytmusic-app, ytd-app[darker-dark-theme], ytd-app { background: linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-yadbike.gif"), url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-wallpaper.jpg"), #111918 !important; /* fallback color */ background-attachment: fixed, fixed, fixed, fixed !important; background-repeat: no-repeat, no-repeat, no-repeat, no-repeat !important; background-size: cover, 9%, cover, cover !important; background-blend-mode: normal, normal, screen, normal !important; background-position: center, 115% 542px, center, center !important; --app-drawer-content-container_-_background-color: #b4292900 !important; animation: yadgogo !important; animation-duration: 5s !important; animation-iteration-count: 1 !important;}ytd-app:active { background: linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-yadbike.gif"), url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-wallpaper.jpg"), #111918 !important; /* fallback color */ background-attachment: fixed, fixed, fixed, fixed !important; background-repeat: no-repeat, no-repeat, no-repeat, no-repeat !important; background-size: cover, 9%, cover, cover !important; background-blend-mode: normal, normal, screen, normal !important; background-position: center, 115% 542px, center, center !important; --app-drawer-content-container_-_background-color: #b4292900 !important; animation: yadgogo !important; animation-duration: 5s !important; animation-iteration-count: 1 !important;}ytd-rich-grid-media[mini-mode] #video-title.ytd-rich-grid-media { font-size: 16px !important;}.title.ytd-video-primary-info-renderer { font-size: 25px !important; color: #332F24 !important; padding-left: 10px !important;}ytd-video-primary-info-renderer { --yt-button-icon-size: 36px !important; border: 3px solid #2d5103 !important; border-radius: 0px 0px 9px 9px !important; background-color: #f7f6d7 !important;}span.ytd-video-view-count-renderer { /*views*/ color: #fb0 !important; font-size: 17px !important; padding-left: 10px !important;}ytd-sentiment-bar-renderer { /*like bar*/ padding-top: 0px !important;}ytd-sentiment-bar-renderer[activated] #like-bar.ytd-sentiment-bar-renderer { background-color: #17a4c5 !important;}#like-bar.ytd-sentiment-bar-renderer { background: #a4a4a4 !important;}ytd-toggle-button-renderer.style-default-active[is-icon-button] { color: #943536 !important;}ytd-sentiment-bar-renderer[activated][system-icons] #like-bar.ytd-sentiment-bar-renderer { background: #de6666 !important;}/*share save*/ytd-button-renderer #button.ytd-button-renderer { color: var(--yt-spec-icon-inactive) !important;}/*survey*/#star-survey.ytd-inline-survey-renderer { background: #FC4446 !important; border: 3px solid #373634 !important; border-radius: 7px !important;}#subtitle.ytd-inline-survey-renderer { color: #fffef8 !important;}#title.ytd-inline-survey-renderer,#follow-up-title.ytd-inline-survey-renderer { color: #fffef8 !important;}yt-icon.style-scope.ytd-rating-survey-option-renderer { color: #ffec61 !important;}ytd-button-renderer #button.ytd-button-renderer { color: #fff !important;}#inline-survey-header.ytd-inline-survey-renderer yt-icon-button.ytd-inline-survey-renderer { color: #68252f !important;}#inline-survey-compact-video-renderer.ytd-inline-survey-renderer { background-color: #633131 !important;}ytd-inline-survey-renderer[expanded] #dismissible.ytd-inline-survey-renderer { background-color: #b94da3 !important;}ytd-checkbox-survey-option-renderer.ytd-inline-survey-renderer { --paper-checkbox-unchecked-color: #741264 !important; --paper-checkbox-label-color: #fdffeb !important; --ytd-checkbox-survey-option-padding: 7px !important; background-color: #3fac7b00 !important;}#dismiss-button.ytd-inline-survey-renderer { background-color: #b94da3 !important; margin: 24px 0 !important;}ytd-button-renderer.style-primary[is-paper-button] { background-color: #5ca49b !important; color: var(--yt-spec-text-primary-inverse) !important;}#dismiss-button.ytd-inline-survey-renderer yt-icon-button.ytd-inline-survey-renderer { color: #702929 !important;}/*poll*/tp-yt-paper-item.ytd-backstage-poll-renderer[selected] .progress-bar.ytd-backstage-poll-renderer { background-color: var(--yt-live-chat-count-color-early-warning) !important;}.text-area.ytd-backstage-poll-renderer { color: #ffffff !important;}ytd-backstage-poll-renderer[show-poll-choice-border] tp-yt-paper-item.ytd-backstage-poll-renderer[selected] .choice-info.ytd-backstage-poll-renderer { border: 1px solid var(--yt-swatch-primary-darker) !important;}yt-icon.checked.ytd-backstage-poll-renderer { color: var(--paper-deep-orange-800) !important;}/*right col*/ytd-multi-page-menu-renderer[darker-dark-theme],ytd-multi-page-menu-renderer { background: #FC4446 !important; border: 3px solid #373634 !important; border-radius: 7px !important;}ytd-active-account-header-renderer { background-color: #943536 !important; border-bottom: 3px solid #403333 !important;}paper-item.ytd-compact-link-renderer { color: #fff !important; text-shadow: 0px 1.5px 0px #3626263d !important; font-family: PokeTubeFont !important;}tp-yt-paper-item { text-shadow: 0px 1.5px 0px #3626263d !important; font-family: PokeTubeFont !important;}yt-formatted-string.ytd-account-item-renderer[secondary] { color: #7dc3ed !important;}#channel-title.ytd-account-item-renderer { color: #fff !important;}#label.ytd-compact-link-renderer { font-size: 17px !important;}#label.ytd-toggle-theme-compact-link-renderer { font-size: 17px !important; color: beige !important;}yt-formatted-string[has-link-only_]:not([force-default-style]) a.yt-simple-endpoint.yt-formatted-string:visited { color: #d79e9e !important;}yt-formatted-string[has-link-only_]:not([force-default-style])a.yt-simple-endpoint.yt-formatted-string { color: #e46392;}/* reset for channel name */yt-formatted-string.ytd-channel-name a.yt-simple-endpoint.yt-formatted-string { color: #ffffffb0 !important;}.text.ytd-notification-renderer { color: #fffef2 !important; text-shadow: 0px 1.5px 0px #3626263d !important;}.message.ytd-notification-renderer { font-size: 17px !important;}ytd-simple-menu-header-renderer[darker-dark-theme],ytd-simple-menu-header-renderer { /*notif*/ background-color: #943536 !important; color: #fff !important; border-radius: 4px 4px 0px 0px !important; box-shadow: 0 2px 0px #4b2d2d !important;}/*notif number*/#notification-count.ytd-notification-topbar-button-renderer { background-color: #fc036b !important; box-shadow: 0px 0px 0px 2px #7f184b !important;}.metadata.ytd-notification-renderer { color: #943536 !important; font-size: 15px !important;}#account-name.ytd-active-account-header-renderer { color: #fff !important; font-size: 17px !important;}yt-icon.ytd-compact-link-renderer { color: #373634 !important; /*icon*/}yt-icon.ytd-toggle-theme-compact-link-renderer { color: #fff !important;}#label.ytd-toggle-theme-compact-link-renderer { font-size: 17px !important;}/*manage account*/yt-formatted-string[ellipsis-truncate] a.yt-formatted-string:last-child { color: beige !important;}/*pop up*/.ytp-popup { border-radius: 7px !important; background: #3a86ab !important; text-shadow: 0 0 2px rgba(0, 0, 0, .5) !important; border: 3px solid #202830 !important; font-family: PokeTubeFont !important;}.html5-video-info-panel { background: #84b559 !important; border-radius: 7px !important; color: #fff !important; border: 3px solid #254f1c !important;}.ytp-menuitem[aria-checked="true"] .ytp-menuitem-toggle-checkbox { /*setting*/ background: #ef7d21 !important; box-shadow: inset 0px 0px 0px 2px #fff !important;}.ytp-menuitem-toggle-checkbox { background: #454545 !important; box-shadow: inset 0px 0px 0px 2px #f0f0f0 !important;}.toggle-bar.paper-toggle-button { background-color: #454545 !important; box-shadow: inset 0px 0px 0px 2px #efefef !important; opacity: 1 !important;}paper-toggle-button[checked]:not([disabled]) .toggle-bar.paper-toggle-button { opacity: 1 !important; background-color: #ef7d21 !important; box-shadow: inset 0px 0px 0px 2px #fff !important;}paper-toggle-button[checked]:not([disabled]) .toggle-button.paper-toggle-button { background-color: #fff !important;}/*pokeball outline*/#guide-icon.ytd-masthead { box-shadow: 0px 0px 0px 6px #433c44 !important; border-radius: 44px !important;}/*left coloumn*/ytd-app[darker-dark-theme] #guide-content.ytd-app,#guide-content.ytd-app { background: linear-gradient(rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.4)), url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-tiles.png"), #f27f2c !important; background-blend-mode: normal, overlay !important; border: 0px solid #433c44 !important; border-radius: 0px 9px 9px 0px !important; box-shadow: inset 0px 0px 0px 4px #506070 !important;}#guide-section-title.ytd-guide-section-renderer { color: #000 !important;}#sections.ytd-guide-renderer>*.ytd-guide-renderer:not(:last-child) { border-bottom: 1px solid #433c44 !important; background-color: #7bc09100 !important;}#scrim.tp-yt-app-drawer { background: #ffd60000 !important;}.title.ytd-guide-entry-renderer { font-family: PokeTubeFont !important; font-size: 23px !important; text-shadow: 0px 1.5px 0px #dd171700 !important; font-variant-caps: all-small-caps !important;}.guide-icon.ytd-guide-entry-renderer { /*icons*/ color: #554949 !important;}#newness-dot.ytd-guide-entry-renderer { width: 5px !important; height: 5px !important; border-radius: 50% !important; background-color: #4fb2ab !important; margin: 0 6px !important; display: none !important; box-shadow: 0px 0px 0px 1px #fffef2 !important;}.guide-icon.ytd-guide-entry-renderer:hover { /*icons*/ color: #fff !important; animation: swing 0.1s 10 alternate !important; animation-timing-function: ease-in-out !important;}@keyframes swing { 0% { transform: rotate(120deg) } 100% { transform: rotate(5deg) }}#voice-search-button.ytd-masthead .ytd-masthead[is-icon-button],#buttons.ytd-masthead .ytd-masthead[is-icon-button]:hover { color: #de6666 !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-tone.png") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 100% !important;}.ytp-scrubber-pull-indicator { /*pika*/ background-color: #fff0 !important; height: 35px !important; width: 45px !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/pikachu.gif"), url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/pikachu-effect.gif") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 43px, 80px !important; bottom: -5px !important; left: -25.5px !important; transform: rotate(0deg) !important; transform: scale(1.1) !important; border-radius: 30px !important;}.html5-scrubber-button,.ytp-scrubber-button { transform: rotate(0deg) !important;}.ytp-swatch-background-color { /*sliderball*/ background-color: #fff0 !important;}.ad-interrupting .ytp-scrubber-button.ytp-swatch-background-color { background-color: #f70000 !important;}.ytp-play-progress { background: #ffe100a6 !important;}.ytp-scrubber-button { height: 0px !important; width: 0px !important;}.ytp-progress-list { background: #00fcb54d !important;}/*player icons*//*post name*/#author-text.yt-simple-endpoint.ytd-backstage-post-renderer { font-size: 20px !important;}#author-text.yt-simple-endpoint.ytd-comment-renderer { font-size: 18px !important; color: #f27f2c !important; text-shadow: 0px 0px 0px #beb3b3 !important;}#content-text.ytd-comment-renderer { font-size: 17px !important; color: #4f2121 !important;}/*active*/ytd-guide-entry-renderer[active] .guide-icon.ytd-guide-entry-renderer { color: #f0f098 !important;}ytd-guide-entry-renderer[active] .title.ytd-guide-entry-renderer { font-size: 25px !important; color: #414141 !important;}/*game*/ytd-rich-metadata-renderer { background-color: #fffde0 !important; box-shadow: 0px 0px 0px 3px #554242 !important; border-radius: 8px !important;}.ytp-volume-slider-handle { position: absolute !important; top: 50% !important; width: 12px !important; height: 12px !important; border-radius: 6px !important; margin-top: -6px !important; background-color: black !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-slider.gif") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 20px !important; box-shadow: 0 0 0px 3px #f50000 !important;}.ytp-volume-slider-handle:before { left: -58px !important; background: #fcfcfc36 !important;}/*volume box*/.ytp-volume-slider-active .ytp-volume-panel { width: 56px !important;}.ytp-volume-slider-handle:after { background: #ffffff38 !important;}.ytp-big-mode .ytp-volume-slider-active .ytp-volume-panel { width: 81px !important;}/*live chat*/yt-formatted-string.ytd-menu-navigation-item-renderer { color: #ffffff !important; font-family: PokeTubeFont !important;}ytd-menu-popup-renderer { box-shadow: unset !important;}.ytp-live-badge[disabled]:before { animation: livefeed 1s alternate infinite !important;}@keyframes livefeed { 0% { background: #0cfc2d; } 100% { background: #fc940c; }}.badge-style-type-live-now.ytd-badge-supported-renderer { background: #fc036b !important; color: #fff !important; border: 3px solid #8a2c2c !important; border-radius: 3px !important;}ytd-menu-popup-renderer { background-color: #fff0 !important; border-radius: 4px !important;}html:not(.style-scope)[watch-color-update] { --yt-live-chat-background-color: #f4fad4 !important; --yt-live-chat-header-background-color: #7bc091 !important; --yt-live-chat-action-panel-background-color: #7bc091 !important; --yt-live-chat-message-highlight-background-color: #1996d7fa !important; --yt-live-chat-ninja-message-background-color: #b62e2efa !important;}#show-hide-button.ytd-live-chat-frame>ytd-toggle-button-renderer.ytd-live-chat-frame { background-color: #48c7d0 !important; border-radius: 0px 0px 9px 9px !important;}#author-name.yt-live-chat-author-chip { color: #b90e0e99 !important;}yt-live-chat-header-renderer { border-radius: 7px 7px 0 0 !important;}ytd-live-chat-frame { border: 2px solid #494931c9 !important; border-radius: 9px !important; background-color: #3a86ab !important;}yt-live-chat-renderer[hide-timestamps] { border-radius: 8px 8px 0 0 !important;}#card.yt-live-chat-viewer-engagement-message-renderer { background-color: #bdd5ca !important;}paper-listbox.yt-dropdown-menu { background-color: #c93838 !important; border-radius: 9px !important;}paper-listbox.yt-dropdown-menu paper-item.yt-dropdown-menu:hover { background-color: #eeeeee4f !important;}paper-listbox.yt-dropdown-menu .iron-selected.yt-dropdown-menu { font-weight: inherit !important; background-color: #f48686c2 !important;}.item.yt-dropdown-menu { color: #fff !important;}.dropdown-content.paper-menu-button { border-radius: 9px !important; background-color: #00ff0d00 !important;}paper-listbox { background: #F37D33 !important; color: #fff !important; border: 3px solid #494931c9 !important; border-radius: 9px !important;}yt-icon.ytd-menu-service-item-renderer { color: #b02b2b !important;}yt-icon.ytd-menu-navigation-item-renderer { color: #b02b2b !important;}#unfocused.yt-live-chat-text-input-field-renderer { background-color: #fff7c8 !important;}#focused.yt-live-chat-text-input-field-renderer { background-color: #fd0 !important;}@font-face { font-family: PokeTubeFont !important; /*YADretroFont*/ src: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/fonts/poke-tube.woff2") !important; /*https://fonts.gstatic.com/s/vt323/v12/pxiKyp0ihIEF2isfFJU.woff2*/}::-webkit-scrollbar { width: 6px !important;}/* Track */::-webkit-scrollbar-track { border-radius: 0px !important; background: #6c222287 !important;}/* Handle */::-webkit-scrollbar-thumb { background: #ad764a9c !important; border-radius: 10px !important;}/* Handle on hover */::-webkit-scrollbar-thumb:hover { background: #e79a49 !important; box-shadow: inset 0px 0px 0px 1px #702929 !important;}/*yadgogo*/@keyframes yadgogo2 { 60% { background-position: 110% 542px, center }}@keyframes yadgogo { 100% { background-position: -15% 542px, center }}/*side col2*/ytd-mini-guide-renderer[darker-dark-theme],ytd-mini-guide-renderer { background-color: #ff070700 !important;}ytd-mini-guide-renderer,ytd-mini-guide-renderer[darker-dark-theme],ytd-mini-guide-entry-renderer { background-color: #fff0 !important;}ytd-mini-guide-entry-renderer[active] .guide-icon.ytd-mini-guide-entry-renderer { color: #4fd2e9 !important;}.guide-icon.ytd-mini-guide-entry-renderer { background-color: #fffde0 !important; color: #a08472 !important; border: 4px solid #fff !important; border-radius: 35px !important;}/*hashtag*/.super-title.ytd-video-primary-info-renderer { padding-left: 10px !important;}/*verified user*/ytd-author-comment-badge-renderer { background-color: #5edee5 !important; border-radius: 15px !important; padding: 6px !important;}/*search*/#container.ytd-searchbox input.ytd-searchbox { color: #302727e0 !important; font-family: PokeTubeFont !important;}/*********/ytd-searchbox[desktop-searchbar-style=rounded_corner_dark_btn] #container.ytd-searchbox,ytd-searchbox[desktop-searchbar-style=rounded_corner_light_btn] #container.ytd-searchbox,#container.ytd-searchbox { transition: 0.5s !important; background-color: #f0f098 !important; border: 0px solid #433c44 !important; border-right: 0px !important; border-radius: 25px 0 0 25px !important; box-shadow: 0 0 0 3px #433c44 !important;}#search-icon-legacy.ytd-searchbox { border-radius: 0 20px 20px 0 !important; background: #fd2b84 !important; border: 1px solid #fd2b84 !important; box-shadow: 0 0 0 3px #433c44, inset 0 0 0 2px #fd2b84 !important; border-left: 0px !important;}#search-icon-legacy.ytd-searchbox:hover { border-radius: 0 20px 20px 0 !important; background: #f27f2c !important; box-shadow: 0 0 0 3px #433c44 !important; border-left: 0px !important;}ytd-searchbox[system-icons] #search-icon-legacy.ytd-searchbox yt-icon.ytd-searchbox,.yt-spec-icon-badge-shape { color: #ffec61 !important;}ytd-searchbox[has-focus][desktop-searchbar-style=rounded_corner_dark_btn] #container.ytd-searchbox,ytd-searchbox[has-focus][desktop-searchbar-style=rounded_corner_light_btn] #container.ytd-searchbox,ytd-searchbox[has-focus] #container.ytd-searchbox { box-shadow: 0 0 0 3px #433c44 !important; border-right: none !important; background: #f0f098 !important;}.sbfl_b { /*report search predictiion*/ background: #01010100 !important;}.sbsb_a { background: #ea8745 !important; border-radius: 0px 0px 10px 10px !important; color: #fff !important; animation: yadpred 0.3s 1 !important; transform: translatey(0px) !important;}@keyframes yadpred { 0% { transform: translatey(-165px) } 100% { transform: translatey(0px) }}.sbpqs_a { color: #ffe6ec !important;}.sbdd_b { background-color: #95473B !important; border: 3px solid #95473B !important; border-radius: 0px 0px 12px 12px !important; animation: yadpred2 0.3s 1 !important; transform: translatey(0px) !important;}@keyframes yadpred2 { 0% { transform: translatey(-165px) } 100% { transform: translatey(0px) }}#contentWrapper.tp-yt-iron-dropdown>* { animation: yadpred3 0.3s 1 !important;}@keyframes yadpred3 { 0% { -webkit-transform: rotateX(80deg); transform: rotateX(80deg); opacity: 0; } 100% { -webkit-transform: rotateX(0); transform: rotateX(0); opacity: 1; }}@keyframes flip-in-hor-bottom { 0% { -webkit-transform: rotateX(80deg); transform: rotateX(80deg); opacity: 0; } 100% { -webkit-transform: rotateX(0); transform: rotateX(0); opacity: 1; }}.sbsb_d { background: #eeeeee30 !important;}.gsfs { font-size: 1.6rem !important; color: #fffdef !important;}.sbsb_i { color: #cc3364 !important;}/*join*/ytd-button-renderer.style-suggestive[is-paper-button] { border: 3px solid #fff0 !important; background-color: #fff0 !important; color: #fff !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-plank.png") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 100% 100% !important; width: 100% !important;}ytd-button-renderer.style-suggestive[is-paper-button] tp-yt-paper-button.ytd-button-renderer { border: 1px solid #065fd400 !important;}/*sub*/.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--filled,tp-yt-paper-button.ytd-subscribe-button-renderer { background-color: #fff0 !important; font-family: PokeTubeFont !important; border: 3px solid #fff0 !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-plank.png") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 100% 100% !important;}ytd-button-renderer.style-destructive[is-paper-button] { background-color: #fff0 !important; font-family: PokeTubeFont !important; border: 3px solid #fff0 !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-plank.png") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 100% 100% !important;}.ytp-sb-subscribe,a.ytp-sb-subscribe { background-color: #70b8f0 !important; color: #FBF9FA !important;}.iv-branding .branding-context-container-inner { background-color: #B8A8E9 !important; border-radius: 5px !important; color: #FBF9FA !important; border: 3px solid #80658b !important;}tp-yt-paper-button.ytd-subscribe-button-renderer[subscribed] { background-color: #a4a4a400 !important; color: #80626c !important;}/*bell notif*/ytd-subscription-notification-toggle-button-renderer #button.ytd-subscription-notification-toggle-button-renderer { background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-plank.png") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 100% 87% !important; color: var(--yt-spec-icon-active) !important;}/*bottom video info*/ytd-clarification-renderer[background-style=info] { background: #95f4d8 !important; border: 3px solid #492f2f !important; border-bottom: 0px !important;}/*select channel*/ytd-channel-switcher-renderer[dialog][dialog][dialog] { background: var(--yt-spec-static-brand-red) !important;}/*share dialog*/paper-dialog { background-color: #86c9aa !important; color: #fff !important; border-radius: 9px !important; border: 3px solid #2b534a !important;}#bar.yt-copy-link-renderer { border: 3px solid #2b2b2b !important; border-radius: 7px !important; background-color: #b2b2b2 !important;}/*settings*/ytd-settings-sidebar-renderer { background-color: #b2b2b200 !important;}/*profile outline*/yt-img-shadow.ytd-topbar-menu-button-renderer { box-shadow: 0px 0px 0px 3px #554242 !important;}#avatar.ytd-active-account-header-renderer { box-shadow: 0px 0px 0px 3px #4b0612 !important;}/*yt post*/ytd-post-renderer[uses-compact-lockup] { --yt-img-border-radius: 2px !important; padding: 12px 24px 0 24px !important; border: 3px solid #404868 !important; max-width: 386px !important; width: 386px !important; height: 196px !important; background-color: #98B0D8 !important; border-radius: 9px !important;}/*spider*/.guide-entry-badge.ytd-guide-entry-renderer { color: #fc4446 !important; animation: yadspider 3s infinite !important;}@keyframes yadspider { 0% { filter: blur(0px) } 90% { filter: blur(0px) } 100% { filter: blur(2px) }}/*wiki*/ytd-info-panel-content-renderer[has-menu] { background: #65ae8a !important; border: 3px solid #5b3e3e !important; border-bottom: unset !important;}/*hoy kopya pa haha!*/#contents ytd-rich-grid-row,#contents ytd-rich-grid-row #contents { display: contents !important;}.ytd-two-column-browse-results-renderer { --ytd-rich-grid-items-per-row: 3 !important;}/*hd 4k*/.ytp-swatch-color { color: #6bf9e5 !important;}.ytp-settings-button.ytp-hd-quality-badge:after { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/icons/poke-tube-hd.svg") no-repeat #f41492 center !important; background-size: 10px !important; border-radius: 50px !important; padding: 1px !important; box-shadow: 0px 0px 0px 2px #3c3535 !important;}.ytp-settings-button.ytp-4k-quality-badge:after { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/icons/poke-tube-4k.svg") no-repeat #f41492 center !important; background-size: 10px !important; border-radius: 50px !important; padding: 1px !important; box-shadow: 0px 0px 0px 2px #3c3535 !important;}.ytp-settings-button.ytp-8k-quality-badge:after { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/icons/poke-tube-8k.svg") no-repeat #10c7ad center !important; background-size: 10px !important; border-radius: 50px !important; padding: 1px !important; box-shadow: 0px 0px 0px 2px #3c3535 !important;}/*font changer*/* { font-family: PokeTubeFont !important;}/*subpop*/yt-notification-action-renderer[darker-dark-theme] tp-yt-paper-toast.yt-notification-action-renderer,tp-yt-paper-toast { background-color: #bb3434 !important; border-radius: 5px !important; box-shadow: 0px 0px 0px 3px #512828 !important;}yt-confirm-dialog-renderer[dialog][dialog][dialog] { background-color: #4fb4a1 !important; text-align: center !important; border-radius: 5px !important; font-family: PokeTubeFont !important;}.buttons.yt-confirm-dialog-renderer { border-top: 3px dashed #32775f !important; position: relative !important; padding: 5% !important; justify-content: center !important;}#scroller.yt-confirm-dialog-renderer { color: #fff !important; font-family: PokeTubeFont !important; font-size: 15px !important;}/*join menu*/ytd-sponsorships-offer-renderer[dialog][dialog][dialog] { --divider-color: var(--yt-spec-10-percent-layer) !important; background-color: #90d5ca !important;}yt-formatted-string.ytd-menu-service-item-renderer { /*orange pop*/ color: #f2f2f2 !important; font-family: PokeTubeFont !important;}.html5-video-player { font-family: PokeTubeFont !important;}/*tooltip*/#tooltip.tp-yt-paper-tooltip { background-image: linear-gradient(200deg, #90d5ca 0%, #27c9d5 100%) !important; background-color: #fb0 !important; color: white !important; border: 3px solid #311345 !important; border-radius: 6px !important; font-family: PokeTubeFont !important;}/*user channel*/.tab-content.tp-yt-paper-tab { font-family: PokeTubeFont !important;}tp-yt-paper-tab.iron-selected.ytd-c4-tabbed-header-renderer { color: white !important;}#channel-header.ytd-c4-tabbed-header-renderer { background-color: #cf060600 !important;}#tabs-inner-container.ytd-c4-tabbed-header-renderer { background-color: #ea8745 !important;}ytd-browse[page-subtype=channels] { background: #e0050500 !important;}ytd-watch-metadata { color: #ffffff !important;}#channel-container.ytd-c4-tabbed-header-renderer,#tabs-container.ytd-c4-tabbed-header-renderer { background-color: #41bdb7 !important; border: 3px solid #133e45 !important;}paper-tab.iron-selected.ytd-c4-tabbed-header-renderer { color: #ffffff !important;}#selectionBar.paper-tabs { border-bottom: 3px solid #ecdc57 !important;}/*top bar2*/#chips-wrapper.ytd-feed-filter-chip-bar-renderer { background-color: #a4a5b6 !important; border-top: 4px solid #453f13 !important; border-bottom: 4px solid #453d13 !important; margin-top: 4px !important;}/*active in navi*/yt-chip-cloud-chip-renderer[chip-style="STYLE_DEFAULT"][selected],yt-chip-cloud-chip-renderer[chip-style="STYLE_HOME_FILTER"][selected] { background-color: var(--yt-spec-static-brand-red) !important; color: var(--yt-spec-text-primary-inverse) !important;}/*navi bg*/#right-arrow.ytd-feed-filter-chip-bar-renderer:before { background: linear-gradient(to left, #fff0 20%, #fff0 80%) !important;}#left-arrow.ytd-feed-filter-chip-bar-renderer:after { background: linear-gradient(to right, #fff0 0%, #ffffff00 80%) !important;}#left-arrow-button.ytd-feed-filter-chip-bar-renderer,#right-arrow-button.ytd-feed-filter-chip-bar-renderer { background-color: #32aeb5 !important; border-radius: 50px 50px 50px 50px !important; transform: scale(0.8) !important; box-shadow: 0px 0px 0px 4px #474544 !important;}/*cc color under*/.ytp-chrome-controls .ytp-button[aria-pressed]:after { background-color: #d9ea10 !important;}/*video wall*//*.html5-video-player { background: #3e095e00 !important; background-image: url() !important; background-position: center !important; background-blend-mode: screen !important; background-attachment: fixed}*/ytd-watch-flexy[theater] #player-theater-container.ytd-watch-flexy,ytd-watch-flexy[fullscreen] #player-theater-container.ytd-watch-flexy { background: #26151500 !important;}/*playback and performance page*/#label.ytd-settings-checkbox-renderer { color: var(--yt-spec-text-secondary) !important; font-family: PokeTubeFont !important;}#label.ytd-settings-radio-option-renderer { color: var(--yt-spec-text-secondary) !important; font-family: PokeTubeFont !important;}/*spinner*/.ytp-spinner { position: absolute !important; left: 50% !important; top: 50% !important; width: 64px !important; margin-left: -32px !important; z-index: 18 !important; pointer-events: none !important;}.ytp-big-mode .ytp-spinner { width: 128px !important; margin-left: -64px !important;}.ytp-spinner-message { position: absolute !important; left: 50% !important; margin-top: 50% !important; width: 300px !important; font-size: 127% !important; line-height: 182% !important; margin-left: -150px !important; display: none !important; text-align: center !important; background-color: black !important; opacity: .5 !important;}.ytp-spinner-container { pointer-events: none !important; position: absolute !important; width: 100% !important; padding-bottom: 100% !important; top: 50% !important; left: 50% !important; margin-top: -50% !important; margin-left: -50% !important; animation: ytp-spinner-linspin 0.5s linear infinite !important; -webkit-animation: ytp-spinner-linspin 0.5s linear infinite !important;}.ytp-spinner-rotator { position: absolute !important; width: 100% !important; height: 100% !important; /* -webkit-animation:ytp-spinner-easespin 5332ms cubic-bezier(0.4,0.0,0.2,1) infinite both !important; */ animation: ytp-spinner-easespin 5332ms cubic-bezier(0.4, 0.0, 0.2, 1) infinite both !important;}.ytp-spinner-left { position: absolute !important; top: 0 !important; left: 0 !important; bottom: 0 !important; overflow: hidden !important;}.ytp-spinner-right { position: absolute !important; top: 0 !important; right: 0 !important; bottom: 0 !important; overflow: hidden !important;}.ytp-spinner-left { right: 49% !important;}.ytp-spinner-right { left: 49% !important;}.ytp-spinner-circle { box-sizing: border-box !important; position: absolute !important; width: 200% !important; height: 100% !important; border-style: solid !important; border-color: #e206599c #e206599c #ffffff9c #ffffff9c !important; border-radius: 50% !important; border-width: 23px !important;}.ytp-big-mode .ytp-spinner-circle { border-width: 45px !important;}.ytp-spinner-left .ytp-spinner-circle { left: 0 !important; right: -100% !important; border-right-color: transparent !important; -webkit-animation: ytp-spinner-left-spin 1333ms cubic-bezier(0.0, 0.0, 0.0, 0) infinite both !important; animation: ytp-spinner-left-spin 1333ms cubic-bezier(0.0, 0.0, 0.0, 0) infinite both !important;}.ytp-spinner-right .ytp-spinner-circle { left: -100% !important; right: 0 !important; border-left-color: transparent !important; -webkit-animation: ytp-right-spin 1333ms cubic-bezier(0.0, 0.0, 0.0, 0) infinite both !important; animation: ytp-right-spin 1333ms cubic-bezier(0.0, 0.0, 0.0, 0) infinite both !important;}@-webkit-keyframes ytp-spinner-linspin { to { -webkit-transform: rotate(-360deg) }}@keyframes ytp-spinner-linspin { 0% { transform: rotate(-360deg) }}@-webkit-keyframes ytp-spinner-easespin { 0% { transform: unset }}@-webkit-keyframes ytp-spinner-left-spin { 0% { transform: unset }}@keyframes ytp-spinner-left-spin { 0% { transform: unset }}@-webkit-keyframes ytp-right-spin { 0% { transform: unset }}@keyframes ytp-right-spin { 0% { transform: unset }}/*logo anim*/path.style-scope.ytd-topbar-logo-renderer { fill: #ff0073 !important;}#logo-icon-container.ytd-topbar-logo-renderer #youtube-paths.ytd-topbar-logo-renderer path.ytd-topbar-logo-renderer { fill: #ffffd6 !important;}polygon.style-scope.ytd-topbar-logo-renderer { fill: #ffff6e !important;}/*membership bubble*/yt-bubble-hint-renderer[style_=BUBBLE_HINT_STYLE_BLUE_TOOLTIP] { background-color: #e9ab78 !important; box-shadow: 0px 0px 0px 2px #554949 !important; border-radius: 6px !important;}yt-bubble-hint-renderer[position-type=OPEN_POPUP_POSITION_LEFT][style_=BUBBLE_HINT_STYLE_BLUE_TOOLTIP]::before { border-color: transparent transparent transparent #e9ab78 !important;}/*movie box*/ytd-movie-offer-module-renderer { display: block !important; border: 1px solid #27c9d5 !important; box-shadow: 0px 0px 0px 3px #554242 !important;}#header.ytd-movie-offer-module-renderer { background-color: #90d5ca !important; border: 2px solid #fff !important;}#wide-clickable-area.ytd-movie-offer-module-renderer { background-color: #fffde0 !important;}html[dark] .watch-skeleton .skeleton-bg-color { /*skeletal system*/ background-color: #ffb38400 !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-skeleton.gif") !important; background-repeat: repeat-y !important; background-position: bottom !important; background-blend-mode: screen !important; background-size: 100px !important;}.watch-skeleton .skeleton-bg-color { /*skeletal system*/ background-color: #ffb38400 !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/elements/poke-tube-skeleton.gif") !important; background-repeat: repeat-y !important; background-position: bottom !important; background-blend-mode: screen !important; background-size: 100px !important;}.masthead-skeleton-icon { background-color: #433c44 !important;}/*icon anim*/button.yt-icon-button:not(:hover) { transform: scale(1) rotate(360deg) !important; transition: transform 0.3s !important;}/*nav small*/yt-chip-cloud-renderer[darker-dark-theme] #left-arrow-button.yt-chip-cloud-renderer,yt-chip-cloud-renderer[darker-dark-theme] #right-arrow-button.yt-chip-cloud-renderer,#left-arrow-button.yt-chip-cloud-renderer,#right-arrow-button.yt-chip-cloud-renderer { background: #b4292900 !important; box-shadow: 0px 0px 0px 0px #554242 !important;}yt-chip-cloud-renderer { background-color: #eeeaca !important; border-radius: 50px !important; box-shadow: 0px 0px 0px 3px #554242 !important;}#left-arrow.yt-chip-cloud-renderer,#right-arrow.yt-chip-cloud-renderer { width: 29px !important; background: #a6a3ff00 !important;}path[d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"] { fill: #fffef8 !important;}path[d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"] { fill: #fffef8 !important;}/*history page*/ytd-two-column-browse-results-renderer[page-subtype=history] #secondary.ytd-two-column-browse-results-renderer { background-color: #f1f1f100 !important;}/*small PP*/.spinner-layer.paper-spinner::after,.circle-clipper.paper-spinner .circle.paper-spinner { border-width: var(--paper-spinner-stroke-width, 7px) !important; border-radius: 50% !important; border-color: aquamarine !important;}/*voice search dialog*/ytd-voice-search-dialog-renderer[dialog] { background: #90d5ca !important; color: aliceblue !important; box-shadow: 0px 0px 0px 3px #554949 !important; border-radius: 13px !important;}div#voice-search-button { border-radius: 48px !important; box-shadow: inset 0px 0px 0px 3px #484747 !important; background-color: #eeeaca !important;}div#voice-search-button:hover { border-radius: 48px !important; box-shadow: inset 0px 0px 0px 3px #fff !important; background-color: #e7de9a !important;}.ytp-autonav-toggle-button { background: none #6f6868 !important; box-shadow: inset 0px 0px 0px 2px #4a4947 !important;}.ytp-autonav-toggle-button[aria-checked="true"] { background-image: none !important; background-color: #ffef05 !important; box-shadow: inset 0px 0px 0px 2px #c18c0c !important;}.ytp-autonav-toggle-button[aria-checked="true"]:after { box-shadow: inset 0px 0px 0px 2px #c18c0c !important;}.ytp-autonav-toggle-button:after { box-shadow: inset 0px 0px 0px 2px #4a4947 !important;}img[src="https://www.gstatic.com/images/branding/product/2x/youtube_96in128dp.png"] { content: url("https://youtube-bits.s3.us-east-2.amazonaws.com/logo/poke-tube.webp") !important; filter: contrast(2.2) !important;}path[fill="#F00"],[d="M6,18h12v1H6V18z M22,6.2v9.6c0,0.66-0.54,1.2-1.2,1.2H3.2C2.54,17,2,16.46,2,15.8V6.2C2,5.54,2.54,5,3.2,5 h17.6C21.46,5,22,5.54,22,6.2z"] { fill: #33d79e !important; stroke: #332f24 !important;}circle[fill="red"] { fill: #d7b933 !important;}path[d="M19,4H5A2.15,2.15,0,0,0,3,6V18a2.15,2.15,0,0,0,2,2H19a2.15,2.15,0,0,0,2-2V6A2.15,2.15,0,0,0,19,4ZM5,18H19V6H5Z"] { fill: #d7b933 !important;}path[d="M15,12,10,8v8Z"] { fill: #fffef8 !important;}path[d="M23,12a11,11,0,0,1-3.22,7.78l-1.41-1.41a9,9,0,0,0,0-12.73l1.41-1.41A11,11,0,0,1,23,12ZM5.64,5.64,4.22,4.22a11,11,0,0,0,0,15.56l1.41-1.41a9,9,0,0,1,0-12.73ZM16.95,7.05,15.54,8.46a5,5,0,0,1,0,7.07l1.41,1.41a7,7,0,0,0,0-9.9Zm-9.9,0a7,7,0,0,0,0,9.9l1.41-1.41a5,5,0,0,1,0-7.07Z"] { fill: #d7b933 !important;}path[d="M12,9a3,3,0,1,1-3,3,3,3,0,0,1,3-3"] { fill: #fffef8 !important;}/*p i*/path[class="ytp-svg-fill"] { fill: #d7b933 !important;}path[class="ytp-svg-fill ytp-svg-volume-animation-speaker"] { fill: #d7b933 !important;}path[d="M21.39,13.19c0-0.08,0-0.15,0-0.22c-0.01-0.86-0.5-5-0.78-5.74c-0.32-0.85-0.76-1.5-1.31-1.91 c-0.9-0.67-1.66-0.82-2.6-0.84l-0.02,0c-0.4,0-3.01,0.32-5.2,0.62C9.28,5.4,6.53,5.8,5.88,6.04c-0.9,0.33-1.62,0.77-2.19,1.33 c-1.05,1.04-1.18,2.11-1.04,3.51c0.1,1.09,0.69,5.37,1.02,6.35c0.45,1.32,1.33,2.12,2.47,2.24c0.28,0.03,0.55,0.05,0.82,0.05 c1,0,1.8-0.21,2.72-0.46c1.45-0.39,3.25-0.87,6.97-0.87l0.09,0h0.02c0.91,0,3.14-0.2,4.16-2.07C21.44,15.12,21.41,13.91,21.39,13.19 z"],[cy="12"] { fill: #33d79e !important;}[cx="12"] { stroke: #332f24 !important;}path[d="m 23.94,18.78 c .03,-0.25 .05,-0.51 .05,-0.78 0,-0.27 -0.02,-0.52 -0.05,-0.78 l 1.68,-1.32 c .15,-0.12 .19,-0.33 .09,-0.51 l -1.6,-2.76 c -0.09,-0.17 -0.31,-0.24 -0.48,-0.17 l -1.99,.8 c -0.41,-0.32 -0.86,-0.58 -1.35,-0.78 l -0.30,-2.12 c -0.02,-0.19 -0.19,-0.33 -0.39,-0.33 l -3.2,0 c -0.2,0 -0.36,.14 -0.39,.33 l -0.30,2.12 c -0.48,.2 -0.93,.47 -1.35,.78 l -1.99,-0.8 c -0.18,-0.07 -0.39,0 -0.48,.17 l -1.6,2.76 c -0.10,.17 -0.05,.39 .09,.51 l 1.68,1.32 c -0.03,.25 -0.05,.52 -0.05,.78 0,.26 .02,.52 .05,.78 l -1.68,1.32 c -0.15,.12 -0.19,.33 -0.09,.51 l 1.6,2.76 c .09,.17 .31,.24 .48,.17 l 1.99,-0.8 c .41,.32 .86,.58 1.35,.78 l .30,2.12 c .02,.19 .19,.33 .39,.33 l 3.2,0 c .2,0 .36,-0.14 .39,-0.33 l .30,-2.12 c .48,-0.2 .93,-0.47 1.35,-0.78 l 1.99,.8 c .18,.07 .39,0 .48,-0.17 l 1.6,-2.76 c .09,-0.17 .05,-0.39 -0.09,-0.51 l -1.68,-1.32 0,0 z m -5.94,2.01 c -1.54,0 -2.8,-1.25 -2.8,-2.8 0,-1.54 1.25,-2.8 2.8,-2.8 1.54,0 2.8,1.25 2.8,2.8 0,1.54 -1.25,2.8 -2.8,2.8 l 0,0 z"] { fill: #33d79e !important;}path[d="M25,17 L17,17 L17,23 L25,23 L25,17 L25,17 Z M29,25 L29,10.98 C29,9.88 28.1,9 27,9 L9,9 C7.9,9 7,9.88 7,10.98 L7,25 C7,26.1 7.9,27 9,27 L27,27 C28.1,27 29,26.1 29,25 L29,25 Z M27,25.02 L9,25.02 L9,10.97 L27,10.97 L27,25.02 L27,25.02 Z"] { fill: #33d79e !important;}path[d="m 28,11 0,14 -20,0 0,-14 z m -18,2 16,0 0,10 -16,0 0,-10 z"] { fill: #33d79e !important;}.ytp-svg-shadow { stroke: #372f2f !important; stroke-opacity: 1 !important; stroke-width: 3px !important; fill: none !important;}#guide-icon.ytd-app { fill: #fff !important;}[d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"],[d="M21,6H3V5h18V6z M21,11H3v1h18V11z M21,17H3v1h18V17z"] { d: path("M23.7,12.85A11.88,11.88,0,0,1,0,12.85H6.58a5.36,5.36,0,0,0,10.55,0Zm-8.22-1a3.63,3.63,0,1,1-3.63-3.62A3.63,3.63,0,0,1,15.48,11.89Zm-1.21,0a2.42,2.42,0,1,0-2.42,2.41A2.42,2.42,0,0,0,14.27,11.89ZM11.85,10a1.89,1.89,0,1,0,1.9,1.89A1.89,1.89,0,0,0,11.85,10Zm0-10A11.91,11.91,0,0,0,0,11H6.56a5.36,5.36,0,0,1,10.58,0H23.7A11.9,11.9,0,0,0,11.85,0Z") !important; fill: #ffec61 !important;}[d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"] { d: path("M11.85,2.67l8,4.61V16.5l-8,4.6-8-4.6V7.28l8-4.61m0-2.67L1.55,5.94V17.83l10.3,6,10.29-6V5.94L11.85,0Zm-.48,12L10.08,9,6.83,7.68l1.28,3.06Zm4.21-1.26,1.29-3.06L13.61,9l-1.28,3ZM13.37,8.5,11.85,4.28,10.33,8.5l1.52,3.34Zm1.23,8.21s-1-.41-1-2.17a5,5,0,0,1,.66-2.7l-2.42.9-2.42-.9a5.07,5.07,0,0,1,.65,2.7c0,1.76-1,2.17-1,2.17C9.32,11.43,5,11.56,5,11.56v4.38l6.83,3.72,6.83-3.72V11.56S14.38,11.43,14.6,16.71Zm-2.75-1.43a1.68,1.68,0,0,1-.73-1.57l.73.31.69-.31A1.68,1.68,0,0,1,11.85,15.28Z") !important; fill: #ffec61 !important;}[d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"] { d: path("M4.94,6.19l6.91,2.45,6.91-2.45-6.91,12-6.91-12M23.67,2.07,11.85,6.27,0,2.07,11.85,22.62,23.67,2.07ZM11.85,13.88c-.36,0-.65.42-.69.94l.69,2.81v0l.69-2.81C12.5,14.3,12.21,13.88,11.85,13.88Zm3.88-3.22-2,.76.23-.85-.66.21.37-2.34-1.85,1.91L10,8.44l.37,2.34-.66-.21.23.85-2-.76,2,2.14s-.4,1.11-.35,1.06a5.34,5.34,0,0,1,1.05.16,1.38,1.38,0,0,1,1.2-.84A1.36,1.36,0,0,1,13,14a5.51,5.51,0,0,1,1.06-.16c.05.05-.35-1.06-.35-1.06Z") !important;}[d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"] { d: path("M11.85,3a8.92,8.92,0,1,1-8.92,8.92A8.92,8.92,0,0,1,11.85,3m0-2.72A11.64,11.64,0,1,0,23.49,11.89,11.65,11.65,0,0,0,11.85.25Zm-1.27,12c.68-1.19-2-2.1-2-3.4S10.12,7.71,10,6.12A2.1,2.1,0,0,1,11.23,4C4,5.13,4,11.28,4,11.28l6.43,4.13A5.23,5.23,0,0,1,10.58,12.24Zm1.13,2a1,1,0,0,0-1,1c0,.55,1,4.38,1,4.38s1-3.83,1-4.38A1,1,0,0,0,11.71,14.29Zm1.64,1.12,6.25-4.26.15-.1s-.2-4.93-5.89-6.85c0,0-.79,2.38,0,3.14a2,2,0,0,1-.71,3.29S11.58,10,12.4,8.9c1.14-1.52-.32-2.89-1.17-3.46,0,0,.27,2.31-.73,2.68s-.28,2.87,1.35,3.66S13.35,15.41,13.35,15.41Z") !important;}.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--text,#buttons.ytd-masthead .ytd-masthead[is-icon-button],yt-icon-button.ytd-notification-topbar-button-renderer,#button.ytd-topbar-menu-button-renderer,ytd-notification-topbar-button-renderer #button.ytd-notification-topbar-button-renderer { /* background-color: #506070 !important; */ /* border-radius: 50% !important; */ color: #943536 !important; /* box-shadow: inset 0px 0px 0px 3px #433c4480 !important; */}/*like button*/path[d*="M1 21h4V9H1v12zm22-11c0"],[d*="M18.77,11h-4.23l1.52-4.94"] { d: path("M11.3,13.86l-.24-.24.86-.86.86.86-.24.24A.86.86,0,0,1,11.3,13.86Zm12.51-2A11.89,11.89,0,1,1,1.61,6,8.51,8.51,0,0,1,.34.83C.34.31.62.3.85.31A9,9,0,0,1,5.78,1.73,11.77,11.77,0,0,1,11.92,0,11.9,11.9,0,0,1,18.2,1.8a8.91,8.91,0,0,1,5-1.49c.23,0,.51,0,.51.52,0,2.46-.44,4.09-1.41,5.32A11.84,11.84,0,0,1,23.81,11.89ZM18.7,6.49a3.41,3.41,0,0,1,1,.48,4,4,0,0,0,2.09-2.8c.06-1-.62-1.76-2-2.31h0a6.54,6.54,0,0,0-3,2.69,6.67,6.67,0,0,1,.87,1.1,12.75,12.75,0,0,0-11.3,0,6.67,6.67,0,0,1,.87-1.1,6.5,6.5,0,0,0-3-2.69h0c-1.41.55-2.1,1.33-2,2.31A4,4,0,0,0,4.34,7a3.38,3.38,0,0,1,1-.48l-.07.12A6.16,6.16,0,0,0,4.07,9.93c0,.18,0,.37-.07.57-.17,1.24-.87,4.14-.88,4.21A2.58,2.58,0,0,1,6,14.1a2.28,2.28,0,0,1,1.35,2.33,2.4,2.4,0,0,1-2,2.27C7.59,20.9,12,20.61,12,20.61s4.76.33,6.65-1.91a2.4,2.4,0,0,1-2-2.27A2.28,2.28,0,0,1,18,14.1a2.58,2.58,0,0,1,2.92.61c0-.07-.71-3-.88-4.21,0-.2,0-.39-.07-.57a6.16,6.16,0,0,0-1.23-3.32ZM8,11.18A3.2,3.2,0,0,0,5.56,11L5,11.15l.37.67c1-.54,2.1-.26,3.39.61l.45-.62Zm7,3.42a.7.7,0,0,1-.5.86.86.86,0,0,0-.6.8,4.37,4.37,0,0,1-.57,1.5,1.47,1.47,0,0,1-2.58,0,4,4,0,0,1-.57-1.5.87.87,0,0,0-.61-.8A.71.71,0,0,1,9,14.6l0-.11.08.08c.84.93,1.67,1,2.84.17l0,0,0,0c1.17.81,2,.76,2.84-.17l.07-.08Zm-1.5,1.24L12,15.28l-1.46.56c0,1.24.65,2.18,1.46,2.19S13.4,17.08,13.42,15.84Zm2.47-4.66-1.25.63.45.62c1.29-.87,2.43-1.15,3.39-.61l.37-.67L18.28,11A3.2,3.2,0,0,0,15.89,11.18Z") !important;}/*dislike button*/[d*="M15 3H6c-.83 0-1.54.5-1"],[d*="M17,4h-1H6.57C5.5,4,4.59,4"],[d*="M18,4h3v10h-3V4z M5.23,14h"] { d: path("M22.33,6.15c1-1.23,1.41-2.86,1.41-5.32,0-.52-.28-.53-.51-.52a8.91,8.91,0,0,0-5,1.49A11.9,11.9,0,0,0,11.92,0,11.77,11.77,0,0,0,5.78,1.73,9,9,0,0,0,.85.31C.62.3.34.31.34.83A8.51,8.51,0,0,0,1.61,6a11.88,11.88,0,1,0,20.72.16Zm-18-4.29h0a6.5,6.5,0,0,1,3,2.69,6.67,6.67,0,0,0-.87,1.1,12.75,12.75,0,0,1,11.3,0,6.67,6.67,0,0,0-.87-1.1,6.54,6.54,0,0,1,3-2.69h0c1.41.55,2.09,1.33,2,2.31A4,4,0,0,1,19.74,7a3.41,3.41,0,0,0-1-.48l.08.12A6.16,6.16,0,0,1,20,9.93c0,.18,0,.37.07.57.17,1.24.87,4.14.88,4.21A2.58,2.58,0,0,0,18,14.1a2.28,2.28,0,0,0-1.35,2.33,2.4,2.4,0,0,0,2,2.27C16.8,20.94,12,20.61,12,20.61s-4.45.29-6.65-1.91a2.4,2.4,0,0,0,2-2.27A2.28,2.28,0,0,0,6,14.1a2.58,2.58,0,0,0-2.92.61c0-.07.71-3,.88-4.21,0-.2,0-.39.07-.57A6.16,6.16,0,0,1,5.3,6.61l.07-.12a3.38,3.38,0,0,0-1,.48,4,4,0,0,1-2.09-2.8C2.18,3.19,2.87,2.41,4.28,1.86ZM14.5,11.62a2.58,2.58,0,0,0,0,.39,1.72,1.72,0,1,0,2.08-1.68l1-.62-.37-.59-3.5,2.21.38.59ZM15,11.3l.82-.52a.58.58,0,1,1-.82.53ZM7.78,13.74a1.71,1.71,0,0,0,1.68-2.12l.46.3.38-.59L6.81,9.12l-.38.59,1,.62a1.72,1.72,0,0,0,.36,3.41Zm-.58-3a.58.58,0,1,1-.58.58A.58.58,0,0,1,7.2,10.73Zm5,5.4,2.44,1.57-.38.59L12.15,17,10.1,18.29l-.38-.59Zm-.85-2.08-.24-.24.86-.86.86.86-.24.24A.88.88,0,0,1,11.3,14.05Z") !important;}/*cenematics*/#cinematics { display: none !important;}html:not(.style-scope),html:not(.style-scope)[dark],html:not(.style-scope)[system-icons] { --yt-live-chat-primary-text-color: #433c44 !important; --yt-spec-text-primary: #433c44 !important; --yt-spec-icon-active: #554949 !important; --yt-spec-icon-active-other: #f0f098 !important; --yt-spec-icon-inactive: #654848 !important; --yt-spec-icon-disabled: #909090 !important; --yt-spec-brand-icon-active: #554242 !important; --yt-spec-brand-icon-inactive: #a4a4a4 !important; --channel-name: #de6666 !important; --yt-spec-base-background: #90d5ca !important; --yt-spec-raised-background: #90d5ca !important; --yt-spec-menu-background: #90d5ca !important; --yt-spec-inverted-background: #0f0f0f !important; --yt-spec-additive-background: rgba(0, 0, 0, 0.05) !important; --yt-spec-outline: rgba(0, 0, 0, 0.1) !important; --yt-spec-shadow: rgba(0, 0, 0, 0.25) !important; --yt-spec-brand-background-solid: #90d5ca !important; --yt-spec-brand-background-primary: #90d5ca !important; --yt-spec-brand-background-secondary: #90d5ca !important; --yt-spec-general-background-a: #90d5ca !important; --yt-spec-general-background-b: #90d5ca !important; --yt-spec-general-background-c: #de6666 !important; --yt-spec-error-background: #181818 !important; --yt-spec-text-primary-inverse: #f0f098 !important; --yt-spec-text-secondary: #606060 !important; --yt-spec-text-disabled: #909090 !important; --yt-spec-call-to-action: #065fd4 !important; --yt-spec-call-to-action-inverse: #3ea6ff !important; --yt-spec-suggested-action: #def1ff !important; --yt-spec-suggested-action-inverse: #263850 !important; --yt-spec-icon-active-other: #606060 !important; --yt-spec-icon-inactive: #909090 !important; --yt-spec-icon-disabled: #ccc !important; --yt-spec-badge-chip-background: rgba(0, 0, 0, 0.05) !important; --yt-spec-verified-badge-background: rgba(0, 0, 0, 0.15) !important; --yt-spec-button-chip-background-hover: rgba(0, 0, 0, 0.1) !important; --yt-spec-touch-response: #000 !important; --yt-spec-touch-response-inverse: #f0f098 !important; --yt-spec-brand-icon-active: #f00 !important; --yt-spec-brand-icon-inactive: #606060 !important; --yt-spec-brand-button-background: #c00 !important; --yt-spec-brand-link-text: #c00 !important; --yt-spec-wordmark-text: #212121 !important; --yt-spec-10-percent-layer: rgba(0, 0, 0, 0.1) !important; --yt-spec-snackbar-background: #212121 !important; --yt-spec-snackbar-background-updated: #181818 !important; --yt-spec-error-indicator: #990412 !important; --yt-spec-themed-blue: #065fd4 !important; --yt-spec-themed-green: #107516 !important; --yt-spec-ad-indicator: #00716c !important; --yt-spec-themed-overlay-background: rgba(255, 255, 255, 0.7) !important; --yt-spec-commerce-badge-background: #deffde !important; --yt-spec-static-brand-red: #f00 !important; --yt-spec-static-brand-white: #fff !important; --yt-spec-static-brand-black: #212121 !important; --yt-spec-static-clear-color: rgba(255, 255, 255, 0) !important; --yt-spec-static-clear-black: rgba(0, 0, 0, 0) !important; --yt-spec-static-ad-yellow: #fbc02d !important; --yt-spec-static-grey: #606060 !important; --yt-spec-static-overlay-background-solid: #000 !important; --yt-spec-static-overlay-background-heavy: rgba(0, 0, 0, 0.8) !important; --yt-spec-static-overlay-background-medium: rgba(0, 0, 0, 0.6) !important; --yt-spec-static-overlay-background-medium-light: rgba(0, 0, 0, 0.3) !important; --yt-spec-static-overlay-background-light: rgba(0, 0, 0, 0.1) !important; --yt-spec-static-overlay-text-primary: #fff !important; --yt-spec-static-overlay-text-secondary: rgba(255, 255, 255, 0.7) !important; --yt-spec-static-overlay-text-disabled: rgba(255, 255, 255, 0.3) !important; --yt-spec-static-overlay-call-to-action: #3ea6ff !important; --yt-spec-static-overlay-icon-active-other: #fff !important; --yt-spec-static-overlay-icon-inactive: rgba(255, 255, 255, 0.7) !important; --yt-spec-static-overlay-icon-disabled: rgba(255, 255, 255, 0.3) !important; --yt-spec-static-overlay-button-secondary: rgba(255, 255, 255, 0.1) !important; --yt-spec-static-overlay-button-primary: rgba(255, 255, 255, 0.3) !important; --yt-spec-static-overlay-background-brand: rgba(204, 0, 0, 0.9) !important; --yt-spec-assistive-feed-vibrant-gradient-1: #007a65 !important; --yt-spec-assistive-feed-vibrant-gradient-2: #7f0e7f !important; --yt-spec-assistive-feed-vibrant-gradient-3: #ff8983 !important; --yt-spec-assistive-feed-themed-gradient-1: #d4fff8 !important; --yt-spec-assistive-feed-themed-gradient-2: #ffdeff !important; --yt-spec-assistive-feed-themed-gradient-3: #ffe6e6 !important; --yt-spec-call-to-action-faded: rgba(6, 95, 212, 0.3) !important; --yt-spec-call-to-action-hover: #0551b4 !important; --yt-spec-brand-button-background-hover: #990412 !important; --yt-spec-brand-link-text-faded: rgba(204, 0, 0, 0.3) !important; --yt-spec-filled-button-focus-outline: rgba(0, 0, 0, 0.6) !important; --yt-spec-static-overlay-button-hover: rgba(255, 255, 255, 0.5) !important; --yt-spec-filled-button-text: #fff !important; --yt-spec-paper-tab-ink: rgba(0, 0, 0, 0.3) !important; --yt-spec-selected-nav-text: #c00 !important;}`,
    kuromi:
      '.ytp-scrubber-pull-indicator {background-color: #fff0 !important; height: 35px !important; width: 45px !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/kuromi.gif") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 43px,80px !important; top: -20px !important; left: -20px !important; transform: rotate(0deg) !important; border-radius: 30px !important;}.html5-scrubber-button, .ytp-scrubber-button { transform: rotate(180deg) scale(1.8) !important;}.ytp-swatch-background-color {background-color: #fff0 !important;}.ad-interrupting .ytp-scrubber-button.ytp-swatch-background-color { background-color: #006f64d4 !important;}.ytp-play-progress { background: #006f64d4 !important;}.ytp-scrubber-button { height: 0px !important; width: 0px !important;}.ytp-progress-list { background: #00fcb54d !important;} .ytp-play-progress { background: #26221f !important;} .ytp-load-progress { background: #026259 !important; } { cursor: url(https://cur.cursors-4u.net/cursors/cur-3/cur237.ani), url(https://cur.cursors-4u.net/cursors/cur-3/cur237.png), auto !important; }',
    nyanCat:
      '@keyframes subtlePulse{0%,100%{box-shadow: 0 0 4px #ffd6ff77, 0 0 8px 2px #ff99ff66;}50%{box-shadow: 0 0 8px 2px #ffd6ff55, 0 0 12px 4px #ff99ff44;}}.html5-play-progress,.ytp-play-progress{background:linear-gradient(to right,#ff99ff,#ffc1cc,#ffd6ff80) !important;background:-webkit-linear-gradient(to right,#ff99ff,#ffc1cc,#ffd6ff80) !important;background:-moz-linear-gradient(to right,#ff99ff,#ffc1cc,#ffd6ff80) !important;box-shadow:0 0 8px 2px #ffd6ff55,0 0 12px 4px #ff99ff44;border-radius: 2px;animation: subtlePulse 2s infinite ease-in-out;}.html5-load-progress,.ytp-load-progress{background:url("https://youtube-bits.s3.us-east-2.amazonaws.com/progress/nyan-cat.gif")!important}.html5-scrubber-button,.ytp-scrubber-button{background:url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/nyan-cat.gif")!important;border:none!important;height:21px!important;margin-left:-18px!important;margin-top:0!important;transform:scale(.8);-webkit-transform:scale(.8);-moz-transform:scale(.8);-ms-transform:scale(.8);width:34px!important}.ytp-volume-slider-track{background:#0c4177!important}',
    pikachu:
      '.ytp-scrubber-pull-indicator {/*pika*/ background-color: #fff0 !important; height: 35px !important; width: 45px !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/pikachu.gif"), url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/pikachu-effect.gif") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 43px,80px !important; bottom: -5px !important; left: -25.5px !important; transform: rotate(0deg) !important; border-radius: 30px !important;}.html5-scrubber-button, .ytp-scrubber-button { transform: rotate(0deg) !important;}.ytp-swatch-background-color {/*sliderball*/ background-color: #fff0 !important;}.ad-interrupting .ytp-scrubber-button.ytp-swatch-background-color { background-color: #f70000 !important;}.ytp-play-progress { background: #ffe100a6 !important;}.ytp-scrubber-button { height: 0px !important; width: 0px !important;}.ytp-progress-list { background: #00fcb54d !important;}',
    goku:
      '.ytp-scrubber-container{width:16px!important;height:16px!important}.ytp-play-progress { background: #1ee5ea! important; } .ytp-load-progress { background: #FFD9DF! important; } .ytp-scrubber-button { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/goku-blue.webp")! important; background-repeat: no-repeat! important; width: 250px! important; height: 300px! important; margin-left: -118px! important; margin-top: -172px! important; transform: scale(0.20)! important; } .ytp-right-controls.style-scope.ytd-player,.ytp-left-controls.style-scope.ytd-player{ z-index:999!important;}#ytp-id-18{z-index: 99999!important;}',
    hollowKnight:
      '.ytp-scrubber-container {  top: -3px !important;}.ytp-scrubber-pull-indicator {  background-color: #fff0 !important;  height: 35px !important;  width: 45px !important;  background-image: url(https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/hollow-knight.webp) !important;  background-repeat: no-repeat !important;  background-position: center !important;  background-size: 43px, 80px !important;  bottom: 18px !important;  left: -10px !important;  transform: rotate(0deg) !important;  transform: scale(-1.5, 1.5) !important;  border-radius: 30px !important;}.ytp-swatch-background-color {  background-color: #212a53 !important;}.ytp-volume-slider-handle,.ytp-volume-slider-handle::after,.ytp-volume-slider-handle::before,.ytp-settings-menu .ytp-menuitem-toggle-checkbox,.ytp-autonav-toggle-button,.yt-spec-icon-badge-shape__badge,.iron-selected {  background-color: #212a53 !important;}.ytd-video-owner-renderer .yt-spec-button-shape-next--filled {  color: #fff !important;  background-color: #212a53 !important;}.ytd-channel-name .yt-simple-endpoint,.ytd-comment-renderer,ytd-author-comment-badge-renderer .ytd-channel-name {  color: #fff !important;}.ytd-c4-tabbed-header-renderer .iron-selected {  background-color: #212129 !important;  border-radius: 5px;  border-bottom-left-radius: 0px;  border-bottom-right-radius: 0px;}.ytp-play-progress {  background: #212b54 !important;}',
    cinnamonRoll:
      '.ytp-scrubber-pull-indicator { background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/cinnamon-roll.gif") !important; background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important; width: 60px !important; height: 34px !important; border: none !important; margin-left: -20px !important; margin-top: -10px !important; background-color: transparent !important; transform: rotate(0deg) scale(1.4) !important; bottom: -2px !important; left: 4px !important}.html5-scrubber-button,.ytp-scrubber-button { background: transparent !important; border: none !important;}.html5-play-progress,.ytp-play-progress { background: linear-gradient(to right, #50bfdc, #a0c4ce, #e3edef) !important;}',
    spidey: 
      '.ytp-scrubber-button { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/spidey.gif")! important;background-size: contain !important;background-repeat: no-repeat !important;background-position: center !important;width: 54px !important;height: 90px !important;margin-left: -18px !important;margin-top: -22px !important;transform: rotate(266deg) scale(0.8) !important;}',
    frieren: 
      '.ytp-scrubber-button { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/frieren.gif")! important;background-size: contain !important;background-repeat: no-repeat !important;background-position: center !important;width: 126px !important;height: 90px !important;margin-left: -60px !important;margin-top: -56px !important;transform: scale(0.4) !important;}',
    nezuko:
      '.ytp-scrubber-button { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/nezuko.gif")! important;background-repeat: no-repeat! important;width: 126px! important;height: 90px! important;margin-left: -75px! important;margin-top: -67px! important;transform: scale(0.6)! important;}.ytp-play-progress {background: linear-gradient(90deg, #ff9eb8 0%, #ff6f91 50%, #ff9eb8 100%) !important;}.ytp-load-progress {background: linear-gradient(90deg, #ffe6ee 0%, #ffd6e0 100%) !important;}.ytp-progress-bar {background-color: rgba(0, 0, 0, 0.3) !important;}',
    sonic:
      '/* * Name: YouTube - Sonic progress bar video player theme * Title: Sonic progress bar video player theme * Author: Crystallis * Version: 0.4.0 * */.html5-play-progress, .ytp-play-progress { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/progress/sonic.png") repeat-x ! important;}.html5-scrubber-button, .ytp-scrubber-button { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/sonic.gif") ! important; background-repeat: no-repeat ! important; width: 31px ! important; height: 40px ! important; border: none ! important; margin-left: -16px ! important; margin-top: -25px ! important;}.ytp-volume-slider-foreground:before { background: #0278d0 ! important; background: -moz-linear-gradient(left, #0278d0 0%, #0278d0 100%) ! important; background: -webkit-gradient(linear, left top, right top, color-stop(0%,#0278d0), color-stop(100%,#0278d0)) ! important; background: -webkit-linear-gradient(left, #0278d0 0%,#0278d0 100%) !important; background: -o-linear-gradient(left, #0278d0 0%,#0278d0 100%) ! important; background: -ms-linear-gradient(left, #0278d0 0%,#0278d0 100%) ! important; background: linear-gradient(to right, #0278d0 0%,#0278d0 100%) ! important;}',
    starWars: 
      `.html5-play-progress, .ytp-play-progress { background: ; background: -moz-linear-gradient(top, 0%, 35%, #ffffff 65%, 100%); background: -webkit-linear-gradient(top, 0%,#ffffff 35%,#ffffff 65%, 100%); background: linear-gradient(to bottom, 0%,#ffffff 24%,#ffffff 65%, 100%); box-shadow: 0px 0px 20px , 0px 0px 20px , 0px 0px 20px !important;} .html5-load-progress, .ytp-load-progress { background: #70B9FF; background: -moz-linear-gradient(top, rgba(120, 120, 120, 0.3) 0%, rgba(120, 120, 120, 0.3) 45%, rgba(255, 255, 255, 0.3) 55%, rgba(120, 120, 120, 0.3) 100%); background: -webkit-linear-gradient(top, rgba(120, 120, 120, 0.3) 0%, rgba(255, 255, 255, 0.3) 45%, rgba(255, 255, 255, 0.3) 55%,rgba(120, 120, 120, 0.3) 100%); background: linear-gradient(to bottom, rgba(120, 120, 120, 0.3) 0%, rgba(255, 255, 255, 0.3) 40%, rgba(255, 255, 255, 0.3) 55%,rgba(120, 120, 120, 0.3) 100%); box-shadow: 0px 0px 12px rgba(120, 120, 120, 0.3), 0px 0px 12px rgba(120, 120, 120, 0.3), 0px 0px 12px rgba(120, 120, 120, 0.3) !important;} .html5-scrubber-button, .ytp-scrubber-button { background: rgba(255, 255, 255, 0) !important; border-color: rgba(255, 255, 255, 0) !important; box-shadow: 0px 0px 0px rgba(255, 255, 255, 0), 0px 0px 0px rgba(255, 255, 255, 0), 0px 0px 0px rgba(255, 255, 255, 0) !important; transition: box-shadow 0.0s, background 0.0s !important; } .html5-scrubber-button:hover, .ytp-scrubber-button:hover { background: #FFFFFF !important; background: -moz-radial-gradient(center, ellipse cover, #ffffff 0%, #ffffff 20%, 100%) !important; background: -webkit-radial-gradient(center, ellipse cover, #ffffff 0%,#ffffff 20%, 100%) !important; background: radial-gradient(ellipse at center, #ffffff 0%,#ffffff 20%, 100%) !important; border-color: #ffffff !important; box-shadow: 0px 0px 10px , 0px 0px 12px , 0px 0px 14px !important; } .ytp-volume-slider-handle { position:absolute; top:50%; width:3px; height:14px; margin-top:-7px; margin-left:0px; background: !important; background: -moz-linear-gradient(left, 0%, 35%, #ffffff 65%, 100%) !important; background: -webkit-linear-gradient(left, 0%,#ffffff 35%,#ffffff 65%, 100%) !important; background: linear-gradient(to right, 0%,#ffffff 24%,#ffffff 65%, 100%) !important; box-shadow: 0px 0px 10px , 0px 0px 10px , 0px 0px 10px !important;}.ytp-big-mode .ytp-volume-slider-handle { width:4px; height:22px; margin-top:-11px}.ytp-volume-slider-handle:before,.ytp-volume-slider-handle:after { background: #ffffff !important; background: -moz-linear-gradient(top, 0%, 35%, #ffffff 65%, 100%) !important; background: -webkit-linear-gradient(top, 0%,#ffffff 35%,#ffffff 65%, 100%) !important; background: linear-gradient(to bottom, 0%,#ffffff 24%,#ffffff 65%, 100%) !important; width:50px; margin-left:-50px;}.ytp-volume-slider-handle:after { left:0px; background:rgba(255,255,255,.2)}.ytp-big-mode .ytp-volume-slider-handle:before,.ytp-volume-slider-handle:after { width:50px; height:2.5px;}.ytp-big-mode .ytp-volume-slider-handle:after { left:-46px; background:rgba(255,255,255,.2)} .ytp-settings-button.ytp-hd-quality-badge::after, .ytp-settings-button.ytp-4k-quality-badge::after, .ytp-settings-button.ytp-5k-quality-badge::after, .ytp-settings-button.ytp-8k-quality-badge::after { width:3px; height:px; top:8px; right:17px; background: !important; background: -moz-linear-gradient(left, 0%, 35%, #ffffff 65%, 100%) !important; background: -webkit-linear-gradient(left, 0%,#ffffff 35%,#ffffff 65%, 100%) !important; background: linear-gradient(to right, 0%,#ffffff 24%,#ffffff 65%, 100%) !important; box-shadow: 0px 0px 10px , 0px 0px 10px , 0px 0px 10px !important; content:''}.ytp-big-mode .ytp-settings-button.ytp-hd-quality-badge:after,.ytp-big-mode .ytp-settings-button.ytp-4k-quality-badge:after,.ytp-big-mode .ytp-settings-button.ytp-5k-quality-badge:after,.ytp-big-mode .ytp-settings-button.ytp-8k-quality-badge:after,.ytp-big-mode .ytp-settings-button.ytp-3d-badge-grey:after,.ytp-big-mode .ytp-settings-button.ytp-3d-badge:after { width:3px; height: calc(px*1.4) ; top:10px; right:23px; content:''; background-image:none;}.ytp-settings-button.ytp-3d-badge::after { width:4px; height:px; top:8px; right:16px; background: #00ED00 !important; background: -moz-linear-gradient(left, #00ED00 0%, #00ED00 35%, #ffffff 65%, #00ED00 100%) !important; background: -webkit-linear-gradient(left, #00ED00 0%,#ffffff 35%,#ffffff 65%,#00ED00 100%) !important; background: linear-gradient(to right, #00ED00 0%,#ffffff 24%,#ffffff 65%,#00ED00 100%) !important; box-shadow: 0px 0px 10px #00ED00, 0px 0px 10px #00ED00, 0px 0px 10px #00ED00 !important; content:''}.ytp-big-mode .ytp-settings-button.ytp-3d-badge::after { width:3px; height: calc(px*1.4) ; top:10px; right:23px; content:''} .ytp-swatch-color { color: !important;} .ytp-menuitem[aria-checked="true"] .ytp-menuitem-toggle-checkbox { background: #FFFFFF !important; background: -moz-radial-gradient(center, ellipse cover, #ffffff 0%, #ffffff 20%, 100%) !important; background: -webkit-radial-gradient(center, ellipse cover, #ffffff 0%,#ffffff 20%, 100%) !important; background: radial-gradient(ellipse at center, #ffffff 0%,#ffffff 20%, 100%) !important; border-color: #ffffff !important; box-shadow: 0px 0px 10px , 0px 0px 12px , 0px 0px 14px !important; content:''}.ytp-menuitem[aria-checked="true"] .ytp-menuitem-toggle-checkbox:before { -moz-transform:translateX(-50px); -ms-transform:translateX(-50px); -webkit-transform:translateX(-50px); transform:translateX(-50px)}.ytp-big-mode .ytp-menuitem[aria-checked="true"] .ytp-menuitem-toggle-checkbox:before { -moz-transform:translateX(-50px); -ms-transform:translateX(-50px); -webkit-transform:translateX(-50px); transform:translateX(-50px)} .ytp-menuitem[aria-checked="false"] .ytp-menuitem-toggle-checkbox { background: #FFFFFF !important; background: -moz-radial-gradient(center, ellipse cover, #ffffff 0%, #ffffff 20%, 100%) !important; background: -webkit-radial-gradient(center, ellipse cover, #ffffff 0%,#ffffff 20%, 100%) !important; background: radial-gradient(ellipse at center, #ffffff 0%,#ffffff 20%, 100%) !important; box-shadow: 0px 0px 10px , 0px 0px 12px , 0px 0px 14px !important; content:''; background-image:none;} .ytp-chrome-controls .ytp-button.ytp-youtube-button:hover:not([aria-disabled="true"]):not([disabled]) .ytp-svg-fill-logo-tube-lozenge { fill: #5099FF !important;} .ytp-settings-button svg { -moz-transition:-moz-transform .4s cubic-bezier(.58,.24,.47,2.3); -webkit-transition:-webkit-transform .4s cubic-bezier(.58,.24,.47,1); -ms-transition:-ms-transform .4s cubic-bezier(.58,.24,.47,2.3); transition:transform .4s cubic-bezier(.58,.24,.47,2.3)}.ytp-settings-button[aria-expanded=true] svg { -moz-transform:rotateY(180deg) translateY(-5px); -ms-transform:rotateY(180deg) translateY(-5px); -webkit-transform:rotateY(180deg) translateY(-5px); transform:rotateY(180deg) translateY(-5px);}.ytp-big-mode .ytp-settings-button[aria-expanded=true] svg { -moz-transform:rotateY(180deg) translateY(-9px); -ms-transform:rotateY(180deg) translateY(-9px); -webkit-transform:rotateY(180deg) translateY(-9px); transform:rotateY(180deg) translateY(-9px);}`,
    shiro:
      '.html5-play-progress,.ytp-play-progress { background: #FFC0CB repeat-x !important;}.html5-load-progress,.ytp-load-progress { background: #9999FF !important;}.html5-scrubber-button,.ytp-scrubber-button { background: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/shiro.png") !important; width: 45px !important; height: 44px !important; border: none !important; margin-left: -15px !important; margin-top: -15px !important; transform: scale(0.8); -webkit-transform: scale(0.8); -moz-transform: scale(0.8); -ms-transform: scale(0.8);}',
    jotaro:
      '.ytp-scrubber-pull-indicator {background-color: #fff0 !important; height: 65px !important; width: 50px !important; background-image: url("https://youtube-bits.s3.us-east-2.amazonaws.com/scrubber/jotaro.gif") !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 43px,80px !important; bottom: -13px !important; left: -25.5px !important; transform: rotate(0deg) !important; transform: scale(0.9) !important; border-radius: 30px !important;}.html5-scrubber-button, .ytp-scrubber-button { transform: rotate(0deg) !important;}.ytp-swatch-background-color { background-color: #fff0 !important;}.ad-interrupting .ytp-scrubber-button.ytp-swatch-background-color { background-color: #f70000 !important;}.ytp-play-progress { background: #ffe100a6 !important;}.ytp-scrubber-button { height: 0px !important; width: 0px !important;}.ytp-progress-list { background: #00fcb54d !important;}',
  };

  function initYouTubeTheming() {
    appliedThemeStyles.forEach(styleEl => styleEl.remove());
    appliedThemeStyles = [];

    function loadTheme() {
      if (!/youtube\.com/.test(window.location.host)) {
        return;
      }

      function addCustomCSS(css) {
        const style = GM_addStyle(css);
        appliedThemeStyles.push(style);
      }

      addCustomCSS(BROAD_PROGRESS_BAR);
      addCustomCSS(progressBarThemes[config.theme] || progressBarThemes.starWars);
      addCustomCSS(logoThemes[config.theme] || logoThemes.cannabis);
    }

    if (config.customTheming) {
      loadTheme();
    }
  }

  //----------------------------------
  // Start script
  //----------------------------------
  initYouTubeTheming();
})();