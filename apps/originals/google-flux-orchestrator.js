// ==UserScript==
// @name         Google Flux Orchestrator
// @namespace    https://github.com/JYashu/flux-suite
// @version      1.2.0
// @description  Seamlessly orchestrate Google accounts and apps with gesture-based FAB controls, account aliasing, and tab-switching intelligence.
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.so
// @author       JYashu
// @license      Apache-2.0
// @match        *://*.google.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// ==/UserScript==
/* global FluxKit */

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

  const { createLogger } = FluxKit.utils;

  const { logMessage } = createLogger('GoogleFluxOrchestrator');

  // ----------------------------------
  // CONTAINER ISOLATION (Zen / Multi-Account Containers)
  // ----------------------------------
  const PROFILE_ID = getContainerProfileId();

  function getContainerProfileId() {
    const cookieName = 'gfo_profile';
    const match = document.cookie.match(new RegExp('(?:^|; )' + cookieName + '=([^;]+)'));
    if (match) return match[1];

    const newId = 'profile_' + Math.random().toString(36).substring(2, 11);
    const expires = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${cookieName}=${newId}; domain=.google.com; path=/; expires=${expires}; SameSite=Lax`;
    return newId;
  }

  function getProfileVal(key, defaultVal) {
    const store = GM_getValue(key, {});
    if (typeof store !== 'object' || store === null) return defaultVal;
    return store.hasOwnProperty(PROFILE_ID) ? store[PROFILE_ID] : defaultVal;
  }

  function setProfileVal(key, val) {
    let store = GM_getValue(key, {});
    if (typeof store !== 'object' || store === null) store = {};
    store[PROFILE_ID] = val;
    GM_setValue(key, store);
  }

  // ----------------------------------
  // STATE, CONFIG & SERVICE REGISTRY
  // ----------------------------------
  let MAX_ACCOUNTS = getProfileVal('maxAccounts', 3);
  let accountNames = getProfileVal('accountNames', {});
  let accountAvatars = getProfileVal('accountAvatars', {});

  const SERVICES = {
    'mail': { name: 'Mail', getRoot: (u) => `https://mail.google.com/mail/u/${u}/` },
    'drive': { name: 'Drive', getRoot: (u) => `https://drive.google.com/drive/u/${u}/` },
    'docs': { name: 'Docs', getRoot: (u) => `https://docs.google.com/document/u/${u}/` },
    'sheets': { name: 'Sheets', getRoot: (u) => `https://docs.google.com/spreadsheets/u/${u}/` },
    'slides': { name: 'Slides', getRoot: (u) => `https://docs.google.com/presentation/u/${u}/` },
    'photos': { name: 'Photos', getRoot: (u) => `https://photos.google.com/u/${u}/` },
    'calendar': { name: 'Calendar', getRoot: (u) => `https://calendar.google.com/calendar/u/${u}/r` },
    'meet': { name: 'Meet', getRoot: (u) => `https://meet.google.com/?authuser=${u}` },
    'gemini': { name: 'Gemini', getRoot: (u) => `https://gemini.google.com/?authuser=${u}` },
    'keep': { name: 'Keep', getRoot: (u) => `https://keep.google.com/?authuser=${u}` },
    'notebooklm': { name: 'NotebookLM', getRoot: (u) => `https://notebooklm.google.com/?authuser=${u}` }
  };

  function getCurrentAppKey() {
    const host = window.location.hostname;
    const path = window.location.pathname;
    if (host.includes('docs.google.com')) {
      if (path.includes('/spreadsheets/')) return 'sheets';
      if (path.includes('/presentation/')) return 'slides';
      return 'docs';
    }
    if (host.includes('mail.google.com')) return 'mail';
    if (host.includes('drive.google.com')) return 'drive';
    if (host.includes('photos.google.com') || host.includes('googleusercontent.com/photos')) return 'photos';
    if (host.includes('calendar.google.com')) return 'calendar';
    if (host.includes('meet.google.com')) return 'meet';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('keep.google.com')) return 'keep';
    if (host.includes('notebooklm.google.com')) return 'notebooklm';
    return 'unknown_app';
  }

  GM_registerMenuCommand("⚙️ Set Max Accounts", () => {
    const input = prompt(`Enter the maximum number of logged-in Google accounts:\n(Currently set to ${MAX_ACCOUNTS})`, MAX_ACCOUNTS);
    if (input !== null) updateMaxAccounts(input);
  });

  // ----------------------------------
  // AVATAR HARVESTER
  // ----------------------------------
  function harvestAvatar() {
    const index = getCurrentIndex();
    const imgs = document.querySelectorAll('img');

    for (let img of imgs) {
      if (img.src && (img.src.includes('googleusercontent.com/a/') || img.src.includes('googleusercontent.com/a-/'))) {
        const cleanUrl = img.src.split('=')[0] + '=s128-c';

        if (accountAvatars[index] !== cleanUrl) {
          accountAvatars[index] = cleanUrl;
          setProfileVal('accountAvatars', accountAvatars);

          const fabImg = document.getElementById('gfo-fab-avatar-img');
          if (fabImg && fabImg.tagName.toLowerCase() !== 'img') {
            const newImg = document.createElement('img');
            newImg.src = cleanUrl;
            newImg.className = fabImg.className;
            newImg.id = fabImg.id;
            fabImg.parentNode.replaceChild(newImg, fabImg);
          } else if (fabImg) {
            fabImg.src = cleanUrl;
          }
        }
        break;
      }
    }
  }

  setTimeout(harvestAvatar, 1500);
  setTimeout(harvestAvatar, 4000);

  function updateMaxAccounts(newValStr) {
    const parsed = parseInt(newValStr, 10);
    if (isNaN(parsed) || parsed < 1) return false;

    if (parsed < MAX_ACCOUNTS) {
      if (!confirm(`Are you sure you want to reduce your account limit to ${parsed}? Identifiers for higher accounts will be deleted.`)) return false;
      for (let i = parsed; i < MAX_ACCOUNTS; i++) delete accountNames[i];
      setProfileVal('accountNames', accountNames);
    }

    MAX_ACCOUNTS = parsed;
    setProfileVal('maxAccounts', MAX_ACCOUNTS);
    return true;
  }

  // ----------------------------------
  // AUTO-ERROR RECOVERY (404 / 403)
  // ----------------------------------
  function checkAndHandleError() {
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('gfo_switch')) return;

    const title = document.title.toLowerCase();
    const isError = title.includes('error') ||
      title.includes('access denied') ||
      title.includes('not found') ||
      title.includes('unauthorized') ||
      document.querySelector('.error-title') ||
      document.querySelector('.aw-error-container') ||
      document.body.innerText.includes("You need permission");

    if (isError) {
      const index = getCurrentIndex();
      const currentAppKey = getCurrentAppKey();
      let rootUrl = SERVICES[currentAppKey] ? SERVICES[currentAppKey].getRoot(index) : `https://${window.location.hostname}/?authuser=${index}`;

      logMessage("Access denied detected. Auto-redirecting to app root:", rootUrl);
      window.location.replace(rootUrl);
    }
  }
  checkAndHandleError();
  window.addEventListener('DOMContentLoaded', checkAndHandleError);

  // ----------------------------------
  // CORE LOGIC & SMART ROUTING
  // ----------------------------------
  function getCurrentIndex() {
    const pathMatch = window.location.pathname.match(/\/u\/(\d+)\//);
    if (pathMatch) return parseInt(pathMatch[1], 10);
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('authuser')) return parseInt(urlParams.get('authuser'), 10);
    return 0;
  }

  function generateUrlForIndex(targetIndex, targetAppKey) {
    const currentAppKey = getCurrentAppKey();

    if (targetAppKey !== currentAppKey && SERVICES[targetAppKey]) {
      return SERVICES[targetAppKey].getRoot(targetIndex);
    }

    const url = new URL(window.location.href);
    if (url.pathname.match(/\/u\/\d+\//)) {
      url.pathname = url.pathname.replace(/\/u\/\d+\//, `/u/${targetIndex}/`);
    } else {
      url.searchParams.set('authuser', targetIndex);
    }

    url.searchParams.set('gfo_switch', '1');
    return url.toString();
  }

  function navigateTo(targetIndex, isNewTab, targetAppKey) {
    const newUrl = generateUrlForIndex(targetIndex, targetAppKey);
    if (isNewTab) {
      window.open(newUrl, '_blank');
    } else {
      window.location.href = newUrl;
    }
  }

  function switchAccount(direction, isNewTab) {
    if (MAX_ACCOUNTS <= 1) return;
    let nextIndex = getCurrentIndex() + direction;
    if (nextIndex >= MAX_ACCOUNTS) nextIndex = 0;
    if (nextIndex < 0) nextIndex = MAX_ACCOUNTS - 1;
    navigateTo(nextIndex, isNewTab, getCurrentAppKey());
  }

  // ----------------------------------
  // THEME SYNC ENGINE
  // ----------------------------------
  function syncTheme() {
    let isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      document.documentElement.hasAttribute('dark') ||
      document.body.classList.contains('dark-mode') ||
      document.body.classList.contains('inbox-dark');

    if (!isDark) {
      const bodyColor = window.getComputedStyle(document.body).backgroundColor;
      const htmlColor = window.getComputedStyle(document.documentElement).backgroundColor;

      const checkColor = (bodyColor !== 'rgba(0, 0, 0, 0)' && bodyColor !== 'transparent') ? bodyColor : htmlColor;

      const rgbMatch = checkColor.match(/\d+/g);
      if (rgbMatch && rgbMatch.length >= 3) {
        const r = parseInt(rgbMatch[0]);
        const g = parseInt(rgbMatch[1]);
        const b = parseInt(rgbMatch[2]);

        const brightness = Math.round(((r * 299) + (g * 587) + (b * 114)) / 1000);

        isDark = brightness < 128;
      }
    }

    const fab = document.getElementById('gfo-fab');
    const modal = document.getElementById('gfo-modal-overlay');

    if (isDark) {
      if (fab) fab.classList.add('gfo-force-dark');
      if (modal) modal.classList.add('gfo-force-dark');
    } else {
      if (fab) fab.classList.remove('gfo-force-dark');
      if (modal) modal.classList.remove('gfo-force-dark');
    }
  }

  // Observe the DOM so it dynamically switches if the user toggles dark mode in app settings
  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // ----------------------------------
  // HINT CAROUSEL LOGIC
  // ----------------------------------
  const HINTS = [
    "💡 Press Alt+S (or Option+S) anytime to open or close this menu.", // NEW HINT
    "💡 Use Up/Down arrows to navigate, and Enter to switch accounts.",
    "💡 Hold Ctrl/Cmd while clicking 'Switch' to open in a new tab.",
    "💡 Drag the floating button left or right to quickly switch accounts.",
    "💡 Just start typing (e.g., 'Drive') to quickly select an app from the list.",
    "💡 Press numbers 0-9 to jump to an account instantly (Ctrl+Num for new tab)."
  ];
  let hintInterval = null;
  let currentHintIndex = 0;

  function startHintCarousel() {
    const hintEl = document.getElementById('gfo-hint-text');
    if (!hintEl) return;

    currentHintIndex = 0;
    hintEl.textContent = HINTS[currentHintIndex];
    hintEl.style.opacity = 1;

    clearInterval(hintInterval);
    hintInterval = setInterval(() => {
      hintEl.style.opacity = 0;

      setTimeout(() => {
        currentHintIndex = (currentHintIndex + 1) % HINTS.length;
        hintEl.textContent = HINTS[currentHintIndex];
        hintEl.style.opacity = 1;
      }, 300);
    }, 5000);
  }

  function stopHintCarousel() {
    clearInterval(hintInterval);
  }

  // ----------------------------------
  // GLOBAL HOTKEYS (Alt+S to Toggle, Esc to Close)
  // ----------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyS') {
      e.preventDefault(); // Prevent Google from capturing this
      e.stopPropagation();

      if (modalOverlay && modalOverlay.classList.contains('gfo-open')) {
        closeSwitcherModal();
      } else {
        openSwitcherModal();
      }
    }

    if (e.key === 'Escape' && modalOverlay && modalOverlay.classList.contains('gfo-open')) {
      e.preventDefault();
      e.stopPropagation();
      closeSwitcherModal();
    }
  }, true);

  // ----------------------------------
  // UI CREATION
  // ----------------------------------
  let modalOverlay;
  const svgNS = "http://www.w3.org/2000/svg";

  let focusedIndex = 0;
  let isKeyboardNavActive = false;

  function openSwitcherModal() {
    if (!modalOverlay) createModal();

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    focusedIndex = getCurrentIndex();
    isKeyboardNavActive = false;
    const listContainer = document.getElementById('gfo-account-list');
    if (listContainer) listContainer.classList.remove('gfo-keyboard-active');

    const dropdown = document.getElementById('gfo-app-select-input');
    if (dropdown) dropdown.value = getCurrentAppKey();
    renderAccountList(document.getElementById('gfo-account-list'));

    modalOverlay.style.display = 'block';
    void modalOverlay.offsetWidth;
    modalOverlay.classList.add('gfo-open');

    startHintCarousel();
  }

  function closeSwitcherModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.remove('gfo-open');
    setTimeout(() => { modalOverlay.style.display = 'none'; }, 250);
  }

  function createAvatarElement(index, sizeClass, id = '') {
    if (accountAvatars[index]) {
      const img = document.createElement('img');
      img.src = accountAvatars[index];
      img.className = `gfo-avatar-img ${sizeClass}`;
      if (id) img.id = id;
      return img;
    } else {
      const fallback = document.createElement('div');
      fallback.className = `gfo-avatar-fallback ${sizeClass}`;
      fallback.textContent = index;
      if (id) fallback.id = id;
      return fallback;
    }
  }

  function createModal() {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'gfo-modal-overlay';

    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeSwitcherModal(); });

    const dialog = document.createElement('div');
    dialog.id = 'gfo-modal-dialog';

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'gfo-modal-header';

    const title = document.createElement('h2');
    title.textContent = "Accounts: ";

    const editSpan = document.createElement('span');
    editSpan.textContent = MAX_ACCOUNTS;
    editSpan.contentEditable = "true";
    editSpan.id = 'gfo-max-edit';

    editSpan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); editSpan.blur(); }
    });

    editSpan.addEventListener('blur', () => {
      if (updateMaxAccounts(editSpan.textContent)) {
        renderAccountList(listContainer);
      } else {
        editSpan.textContent = MAX_ACCOUNTS;
      }
    });

    const closeBtn = document.createElement('div');
    closeBtn.className = 'gfo-modal-close';
    const closeSvg = document.createElementNS(svgNS, "svg");
    closeSvg.setAttribute("viewBox", "0 0 24 24");
    closeSvg.setAttribute("width", "24");
    closeSvg.setAttribute("height", "24");
    closeSvg.setAttribute("fill", "currentColor");
    const closePath = document.createElementNS(svgNS, "path");
    closePath.setAttribute("d", "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z");
    closeSvg.appendChild(closePath);
    closeBtn.appendChild(closeSvg);
    closeBtn.addEventListener('click', closeSwitcherModal);

    title.appendChild(editSpan);
    header.appendChild(title);
    header.appendChild(closeBtn);

    // --- App Selector Bar ---
    const appSelectorBar = document.createElement('div');
    appSelectorBar.className = 'gfo-app-selector-bar';

    const appLabel = document.createElement('span');
    appLabel.textContent = 'Route to:';

    const appSelect = document.createElement('select');
    appSelect.className = 'gfo-app-select';
    appSelect.id = 'gfo-app-select-input';

    const currentAppKey = getCurrentAppKey();

    if (!SERVICES[currentAppKey]) {
      const unknownOpt = document.createElement('option');
      unknownOpt.value = currentAppKey;
      unknownOpt.textContent = 'Current App';
      appSelect.appendChild(unknownOpt);
    }

    Object.keys(SERVICES).forEach(key => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = SERVICES[key].name;
      appSelect.appendChild(option);
    });

    appSelect.value = currentAppKey;

    appSelect.addEventListener('change', () => {
      renderAccountList(listContainer);
    });

    // --- Type-to-Select & Hotkey Logic ---
    let searchBuffer = '';
    let searchTimeout = null;

    document.addEventListener('keydown', (e) => {
      if (modalOverlay.style.display === 'none') return;
      if (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT') return;

      const selectedAppKey = appSelect.value;

      // --- Arrow Navigation & Enter to Switch ---
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); // Stop window from scrolling
        const list = document.getElementById('gfo-account-list');

        if (!isKeyboardNavActive) {
          isKeyboardNavActive = true;
          list.classList.add('gfo-keyboard-active');
        }

        if (e.key === 'ArrowDown') {
          focusedIndex = (focusedIndex + 1) % MAX_ACCOUNTS;
        } else {
          focusedIndex = (focusedIndex - 1 + MAX_ACCOUNTS) % MAX_ACCOUNTS;
        }

        const rows = document.querySelectorAll('.gfo-account-row');
        rows.forEach((row, i) => {
          row.classList.toggle('gfo-focused-row', i === focusedIndex);
          if (i === focusedIndex) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const isNewTab = e.ctrlKey || e.metaKey;
        navigateTo(focusedIndex, isNewTab, selectedAppKey);
        return;
      }

      // --- Number Key Account Routing (0-9) ---
      if (/^[0-9]$/.test(e.key)) {
        const targetIndex = parseInt(e.key, 10);
        if (targetIndex < MAX_ACCOUNTS) {
          e.preventDefault();
          e.stopPropagation();
          const isNewTab = e.ctrlKey || e.metaKey;
          navigateTo(targetIndex, isNewTab, selectedAppKey);
        }
        return;
      }

      // --- Type to select App ---
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      searchBuffer += e.key.toLowerCase();
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => { searchBuffer = ''; }, 600);

      const options = Array.from(appSelect.options);
      const match = options.find(opt => opt.textContent.toLowerCase().startsWith(searchBuffer));

      if (match && appSelect.value !== match.value) {
        appSelect.value = match.value;
        renderAccountList(document.getElementById('gfo-account-list'));
      }
    });

    appSelectorBar.appendChild(appLabel);
    appSelectorBar.appendChild(appSelect);

    // --- List Container ---
    const listContainer = document.createElement('div');
    listContainer.id = 'gfo-account-list';
    renderAccountList(listContainer);

    const footer = document.createElement('div');
    footer.className = 'gfo-modal-footer';

    const hintText = document.createElement('div');
    hintText.id = 'gfo-hint-text';

    footer.appendChild(hintText);

    dialog.appendChild(header);
    dialog.appendChild(appSelectorBar);
    dialog.appendChild(listContainer);
    dialog.appendChild(footer);
    modalOverlay.appendChild(dialog);
    document.body.appendChild(modalOverlay);

    syncTheme();
  }

  function renderAccountList(container) {
    container.textContent = '';
    const currentIndex = getCurrentIndex();
    const currentAppKey = getCurrentAppKey();

    const dropdown = document.getElementById('gfo-app-select-input');
    const selectedAppKey = dropdown ? dropdown.value : currentAppKey;

    for (let i = 0; i < MAX_ACCOUNTS; i++) {
      const row = document.createElement('div');
      row.className = 'gfo-account-row';
      if (i === currentIndex) row.classList.add('gfo-active-row');
      if (i === focusedIndex) row.classList.add('gfo-focused-row');

      const avatar = createAvatarElement(i, 'gfo-size-md');

      const nameEdit = document.createElement('div');
      nameEdit.className = 'gfo-name-edit';
      nameEdit.contentEditable = "true";
      nameEdit.setAttribute('placeholder', 'Add account name...');
      nameEdit.textContent = accountNames[i] || '';

      nameEdit.addEventListener('input', (e) => {
        accountNames[i] = e.target.textContent.trim();
        setProfileVal('accountNames', accountNames);
      });
      nameEdit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); nameEdit.blur(); }
      });

      const actionBtn = document.createElement('div');
      actionBtn.className = 'gfo-icon-btn';

      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "20");
      svg.setAttribute("height", "20");
      svg.setAttribute("fill", "currentColor");
      const path = document.createElementNS(svgNS, "path");

      const isSameAccount = (i === currentIndex);
      const isSameApp = (selectedAppKey === currentAppKey);

      if (isSameAccount && isSameApp) {
        path.setAttribute("d", "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z");
        actionBtn.classList.add('gfo-disabled');
        actionBtn.title = "Already here";
      } else {
        path.setAttribute("d", "M16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8-1.41 1.41z");
        actionBtn.title = `Route to ${SERVICES[selectedAppKey]?.name || 'App'} (Ctrl+Click for New Tab)`;
        actionBtn.addEventListener('click', (e) => {
          const isNewTab = e.ctrlKey || e.metaKey;
          navigateTo(i, isNewTab, selectedAppKey);
        });
      }

      svg.appendChild(path);
      actionBtn.appendChild(svg);

      row.appendChild(avatar);
      row.appendChild(nameEdit);
      row.appendChild(actionBtn);
      container.appendChild(row);
    }
  }

  function createFAB() {
    const currentIndex = getCurrentIndex();
    const btn = document.createElement('div');
    btn.id = 'gfo-fab';

    const avatarNode = createAvatarElement(currentIndex, 'gfo-size-sm', 'gfo-fab-avatar-img');
    btn.appendChild(avatarNode);

    const textSpan = document.createElement('span');
    textSpan.id = 'gfo-fab-text';
    textSpan.textContent = accountNames[currentIndex] ? accountNames[currentIndex] : `Acc ${currentIndex}`;
    btn.appendChild(textSpan);

    // --- Gesture & Swipe Logic ---
    const SWIPE_THRESHOLD = 50;
    const CLICK_TOLERANCE = 5;
    let startX = 0;
    let isPointerDown = false;
    let ghostTimer = null;
    let wakeupTimer = null;
    let isGhostMode = false;
    let fabRect = null;

    btn.addEventListener('pointerenter', () => {
      if (isGhostMode || isPointerDown) return;

      ghostTimer = setTimeout(() => {
        isGhostMode = true;
        fabRect = btn.getBoundingClientRect();

        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';

        document.addEventListener('pointermove', trackMouseForWakeup);
      }, 1500);
    });

    btn.addEventListener('pointerleave', () => {
      clearTimeout(ghostTimer);
    });

    function trackMouseForWakeup(e) {
      const padding = 20;
      const isOutside = (
        e.clientX < fabRect.left - padding ||
        e.clientX > fabRect.right + padding ||
        e.clientY < fabRect.top - padding ||
        e.clientY > fabRect.bottom + padding
      );

      if (isOutside) {
        if (!wakeupTimer) {
          wakeupTimer = setTimeout(() => {
            isGhostMode = false;
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            document.removeEventListener('pointermove', trackMouseForWakeup);
            wakeupTimer = null;
          }, 1000); // 1-second grace period before reappearing
        }
      } else {
        if (wakeupTimer) {
          clearTimeout(wakeupTimer);
          wakeupTimer = null;
        }
      }
    }

    btn.addEventListener('dragstart', (e) => e.preventDefault());

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      clearTimeout(ghostTimer);
      isPointerDown = true;
      startX = e.clientX;
      btn.style.transition = 'none';
      btn.setPointerCapture(e.pointerId);
    });

    btn.addEventListener('pointermove', (e) => {
      if (!isPointerDown) return;
      const deltaX = e.clientX - startX;

      let dragDistance = deltaX * 0.25;
      const maxNudge = 45;
      if (dragDistance > maxNudge) dragDistance = maxNudge;
      if (dragDistance < -maxNudge) dragDistance = -maxNudge;

      btn.style.transform = `translateX(${dragDistance}px)`;
    });

    window.addEventListener('pointerup', (e) => {
      if (!isPointerDown) return;
      isPointerDown = false;

      try { btn.releasePointerCapture(e.pointerId); } catch (err) { }

      btn.style.transition = 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.2s, box-shadow 0.2s';
      btn.style.transform = 'translateX(0px)';

      const deltaX = e.clientX - startX;

      if (deltaX > SWIPE_THRESHOLD) {
        switchAccount(1, e.ctrlKey || e.metaKey);
      } else if (deltaX < -SWIPE_THRESHOLD) {
        switchAccount(-1, e.ctrlKey || e.metaKey);
      } else if (Math.abs(deltaX) < CLICK_TOLERANCE) {
        const rect = btn.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          window.getSelection().removeAllRanges();
          openSwitcherModal();
        }
      }
    });

    window.addEventListener('pointercancel', (e) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      try { btn.releasePointerCapture(e.pointerId); } catch (err) { }
      btn.style.transition = 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.2s, box-shadow 0.2s';
      btn.style.transform = 'translateX(0px)';
    });

    btn.addEventListener('contextmenu', (e) => e.preventDefault());

    document.body.appendChild(btn);
    syncTheme();
  }

  // ----------------------------------
  // STYLING
  // ----------------------------------
  const styles = `
    #gfo-fab, #gfo-modal-overlay {
      --gfo-surface: #ffffff;
      --gfo-text: #3c4043;
      --gfo-text-strong: #202124;
      --gfo-icon: #5f6368;
      --gfo-hover: rgba(255, 255, 255, 0.04);
      --gfo-border: #f1f3f4;
      --gfo-blue: #1a73e8;
      --gfo-blue-muted: #e8f0fe;
      --gfo-overlay: rgba(32, 33, 36, 0.6);
      --gfo-shadow-1: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);
      --gfo-shadow-2: 0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12), 0 11px 15px -7px rgba(0,0,0,0.2);
      --gfo-placeholder: #80868b;
    }

    /*
    @media (prefers-color-scheme: dark) {
      #gfo-fab, #gfo-modal-overlay {
        --gfo-surface: #202124;
        --gfo-text: #e8eaed;
        --gfo-text-strong: #ffffff;
        --gfo-icon: #9aa0a6;
        --gfo-hover: rgba(255, 255, 255, 0.04);
        --gfo-border: #3c4043;
        --gfo-blue: #8ab4f8;
        --gfo-blue-muted: rgba(138, 180, 248, 0.12);
        --gfo-overlay: rgba(0, 0, 0, 0.6);
        --gfo-shadow-1: 0 1px 2px 0 rgba(0,0,0,0.6), 0 1px 3px 1px rgba(0,0,0,0.3);
        --gfo-shadow-2: 0 24px 38px 3px rgba(0,0,0,0.6), 0 9px 46px 8px rgba(0,0,0,0.5), 0 11px 15px -7px rgba(0,0,0,0.4);
        --gfo-placeholder: #9aa0a6;
      }
    }
    */

    #gfo-fab.gfo-force-dark, #gfo-modal-overlay.gfo-force-dark {
      --gfo-surface: #202124;
      --gfo-text: #e8eaed;
      --gfo-text-strong: #ffffff;
      --gfo-icon: #9aa0a6;
      --gfo-hover: rgba(255, 255, 255, 0.04);
      --gfo-border: #3c4043;
      --gfo-blue: #8ab4f8;
      --gfo-blue-muted: rgba(138, 180, 248, 0.12);
      --gfo-overlay: rgba(0, 0, 0, 0.6);
      --gfo-shadow-1: 0 1px 2px 0 rgba(0,0,0,0.6), 0 1px 3px 1px rgba(0,0,0,0.3);
      --gfo-shadow-2: 0 24px 38px 3px rgba(0,0,0,0.6), 0 9px 46px 8px rgba(0,0,0,0.5), 0 11px 15px -7px rgba(0,0,0,0.4);
      --gfo-placeholder: #9aa0a6;
    }

    #gfo-fab { position: fixed; bottom: 24px; right: 28px; background-color: var(--gfo-surface); color: var(--gfo-text); font-family: 'Google Sans', Roboto, Arial, sans-serif; font-size: 14px; font-weight: 500; padding: 0 16px 0 12px; height: 48px; border-radius: 24px; box-shadow: var(--gfo-shadow-1); cursor: pointer; z-index: 999998; user-select: none; touch-action: none; display: flex; align-items: center; gap: 10px; transition: all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1); max-width: 220px; transition: all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1), opacity 0.3s ease; }
    #gfo-fab:hover { background-color: var(--gfo-hover); }
    #gfo-fab-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--gfo-text-strong); }

    .gfo-avatar-img { border-radius: 50%; object-fit: cover; flex-shrink: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1); }
    .gfo-avatar-fallback { border-radius: 50%; display: flex; align-items: center; justify-content: center; background-color: var(--gfo-border); color: var(--gfo-text-strong); font-weight: 500; flex-shrink: 0; user-select: none; }
    .gfo-active-row .gfo-avatar-fallback { background-color: var(--gfo-blue-muted); color: var(--gfo-blue); }
    .gfo-size-sm { width: 24px; height: 24px; font-size: 13px; }
    .gfo-size-md { width: 32px; height: 32px; font-size: 15px; }

    #gfo-modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--gfo-overlay); z-index: 999999; font-family: 'Google Sans', Roboto, Arial, sans-serif; opacity: 0; transition: opacity 0.2s ease; }
    #gfo-modal-overlay.gfo-open { opacity: 1; }

    #gfo-modal-dialog { position: absolute; bottom: 85px; right: 28px; background: var(--gfo-surface); width: 420px; max-width: calc(100vw - 48px); max-height: calc(100vh - 110px); border-radius: 12px; box-shadow: var(--gfo-shadow-2); display: flex; flex-direction: column; overflow: hidden; transform-origin: bottom right; transform: scale(0.8) translateY(20px); opacity: 0; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); pointer-events: none; }
    #gfo-modal-overlay.gfo-open #gfo-modal-dialog { transform: scale(1) translateY(0); opacity: 1; pointer-events: auto; }

    .gfo-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; }
    .gfo-modal-header h2 { margin: 0; font-size: 16px; font-weight: 500; color: var(--gfo-text-strong); letter-spacing: 0.1px; }
    #gfo-max-edit { color: var(--gfo-icon); padding: 2px 6px; border-radius: 4px; cursor: text; outline: none; transition: background 0.2s; }
    #gfo-max-edit:hover { background: var(--gfo-hover); }
    #gfo-max-edit:focus { background: var(--gfo-border); color: var(--gfo-text-strong); }

    .gfo-modal-close { color: var(--gfo-icon); cursor: pointer; padding: 8px; margin-right: -8px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background 0.2s, color 0.2s; }
    .gfo-modal-close:hover { background-color: var(--gfo-hover); color: var(--gfo-text-strong); }

    .gfo-app-selector-bar { padding: 12px 24px; background-color: var(--gfo-surface); border-top: 1px solid var(--gfo-border); border-bottom: 1px solid var(--gfo-border); display: flex; align-items: center; gap: 12px; }
    .gfo-app-selector-bar span { font-size: 14px; color: var(--gfo-text); font-weight: 500; }
    .gfo-app-select { flex-grow: 1; padding: 6px 12px; border: 1px solid var(--gfo-border); border-radius: 4px; font-family: inherit; font-size: 14px; color: var(--gfo-text-strong); background-color: var(--gfo-surface); outline: none; cursor: pointer; transition: border-color 0.2s; }
    .gfo-app-select:focus { border-color: var(--gfo-blue); }

    #gfo-account-list { max-height: 650px; overflow-y: auto; padding: 8px 0; }
    .gfo-account-row { display: flex; align-items: center; padding: 10px 24px; gap: 16px; }
    .gfo-active-row { background-color: var(--gfo-blue-muted); }
    #gfo-account-list.gfo-keyboard-active .gfo-focused-row { box-shadow: inset 0 0 0 2px var(--gfo-blue); background-color: var(--gfo-hover); border-radius: 6px; }

    .gfo-name-edit { flex-grow: 1; font-size: 14px; color: var(--gfo-text-strong); outline: none; cursor: text; padding: 6px 4px; border-bottom: 1px solid transparent; transition: border-color 0.2s; white-space: nowrap; overflow: hidden; font-family: inherit; }
    .gfo-active-row .gfo-name-edit { font-weight: 500; color: var(--gfo-blue); }
    .gfo-name-edit:focus { border-bottom: 1px solid var(--gfo-blue); }
    .gfo-name-edit:empty:before { content: attr(placeholder); color: var(--gfo-placeholder); pointer-events: none; display: block; }

    .gfo-icon-btn { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--gfo-icon); transition: background 0.2s; }
    .gfo-icon-btn:hover:not(.gfo-disabled) { background-color: var(--gfo-hover); color: var(--gfo-text-strong); }
    .gfo-disabled { color: var(--gfo-blue); cursor: default; }

    .gfo-modal-footer { padding: 14px 24px; font-size: 12.5px; color: var(--gfo-icon); background-color: var(--gfo-hover); border-top: 1px solid var(--gfo-border); min-height: 46px; display: flex;  align-items: center; justify-content: center; text-align: center; }
    #gfo-hint-text { opacity: 0; transition: opacity 0.3s ease-in-out; line-height: 1.4; }
  `;

  GM_addStyle(styles);
  createFAB();

})();
