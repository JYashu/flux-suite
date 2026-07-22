// ==UserScript==
// @name         Flux Glance
// @namespace    https://github.com/JYashu/flux-suite
// @version      1.0.0
// @description  Instant dictionary & translation lookup for any text. Select text or snip an image anywhere to get a dictionary or translation card with editable source/target languages, TTS playback, and one-click copy or in-place replace.
// @icon         https://logo-bits.s3.us-east-2.amazonaws.com/flux-galnce.svg
// @author       JYashu
// @license      Apache-2.0
// @match        *://*/*
// @match        file:///*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @require      https://flux-suite.vercel.app/libs/flux-kit/capture.js
// @connect      api.dictionaryapi.dev
// @connect      api.datamuse.com
// @connect      translate.googleapis.com
// @connect      translate.google.com
// @connect      cdn.jsdelivr.net
// @connect      api.ocr.space
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

  const { logError, logWarning } = createLogger('FluxGlance');
  const { initNotification, initTooltips } = FluxKit.ui;
  let notifNamespace = { namespace: 'flx-glance' };
  const showNotification = (msg, config = {}) => FluxKit.ui.showNotification(msg, { ...config, ...notifNamespace });

  const DEFAULT_CONFIG = {
    theme: 'auto',
    ocrMode: 'dom',
    keyboardTrigger: 'ctrl+shift+e',
    ocrTrigger: 'ctrl+shift+x',
    launcherTrigger: 'ctrl+shift+l',
    mouseModifier: 'alt',
    customTheme: FluxKit.theme.get('light')
  };

  let flxGlanceConfig = { ...DEFAULT_CONFIG, ...(GM_getValue('flux_glance_config', {})) };

  function saveConfig() {
    GM_setValue('flux_glance_config', flxGlanceConfig);
  }

  const THEME_PRESETS = {
    auto: { name: 'Auto (Site Match)' },
    ...FluxKit.theme.presets,
    custom: { ...flxGlanceConfig.customTheme, name: 'Custom' }
  };

  let activeTheme;

  const updateActiveTheme = (themeKey = flxGlanceConfig.theme) => {
    if (themeKey === 'auto') {
      activeTheme = FluxKit.theme.getSiteStyles();
    } else {
      activeTheme = THEME_PRESETS[themeKey] || THEME_PRESETS.light;
    }
  }

  updateActiveTheme();

  initNotification({ ...activeTheme, ...notifNamespace, position: 'top-center' });

  const FluxGlanceUI = (function () {
    let popupHost = null;
    let shadowRoot = null;

    function extractAudioUrl(dictData) {
      if (!dictData.phonetics || !Array.isArray(dictData.phonetics)) return null;
      const found = dictData.phonetics.find(p => p.audio && p.audio.trim() !== '');
      return found ? found.audio : null;
    }

    function destroy() {
      if (popupHost) {
        FluxKit.capture.speech.stop();
        popupHost.remove();
        popupHost = null;
        shadowRoot = null;
      }
    }

    function createHost(coords) {
      destroy();

      const glassBg = activeTheme.bg.length === 7 ? activeTheme.bg + 'e6' : activeTheme.bg;
      popupHost = FluxKit.utils.createHTMLElement('div', {
        id: 'flux-glance-host',
        style: {
          position: 'fixed',
          top: `${coords.y + 15}px`,
          left: `${coords.x + 10}px`,
          zIndex: '2147483647',
          width: '320px',
          minHeight: '100px',
          backgroundColor: glassBg,
          backdropFilter: `blur(10px) saturate(180%)`,
          color: activeTheme.text,
          border: activeTheme.border,
          borderRadius: '12px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      });

      popupHost.style.setProperty('--flx-bg', glassBg);
      popupHost.style.setProperty('--flx-text', activeTheme.text || '#000000');
      popupHost.style.setProperty('--flx-border', activeTheme.border || '1px solid rgba(128,128,128,0.2)');
      popupHost.style.setProperty('--flx-input-bg', activeTheme.inputBg || 'rgba(128,128,128,0.1)');
      popupHost.style.setProperty('--flx-accent-bg', activeTheme.accentBg || '#3b82f6');
      popupHost.style.setProperty('--flx-btn-text', activeTheme.btnTextColor || '#ffffff');

      shadowRoot = popupHost.attachShadow({ mode: 'open' }); // Must be open for drag util!
      initTooltips({ ...activeTheme, rootElement: shadowRoot, attribute: 'flxTrnslt', delay: 500 });

      if (FluxKit.utils.makeElementDragAndResize) {
        FluxKit.utils.makeElementDragAndResize(popupHost, null, {
          resizable: false,
          close: false,
          dblClickMaximize: false,
          autoFocus: false
        });
      }

      setTimeout(() => {
        document.addEventListener('click', function onClickAway(e) {
          // Don't close if they are clicking inside a select dropdown
          if (
            !popupHost ||
            (!popupHost.contains(e.target) && e.target.tagName !== 'OPTION')
          ) {
            destroy();
            document.removeEventListener('click', onClickAway);
          }
        });
      }, 100);

      document.body.appendChild(popupHost);
    }

    function showLoading(coords = null) {
      if (coords) createHost(coords);
      if (!shadowRoot) return;

      FluxKit.utils.withTTPatched(() => {
        shadowRoot.innerHTML = `
          <div style="padding: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; opacity: 0.7;">
            <span style="margin-top: 6px; font-size: 20px;">${FluxKit.ui.icons.loader}</span>
            <span>Looking up...</span>
          </div>
        `;
      });
    }

    function renderTranslation(data, isCached, onReTranslate, selectionContext = null) {
      if (!shadowRoot) return;

      let sourceLang = 'auto';

      const buildOptions = selectedVal => {
        return Object.entries(FluxKit.capture.langs)
          .map(([code, name]) => {
            const isSelected =
              code === selectedVal || (code === 'auto' && selectedVal === 'auto')
                ? 'selected'
                : '';
            return `<option value="${code}" ${isSelected}>${name}</option>`;
          })
          .join('');
      };

      const cacheHtml = isCached ? `
        <div data-flx-trnslt-tooltip="Loaded from local cache" style="margin-left: auto; color: #f59e0b; display: flex; align-items: center; opacity: 0.9; cursor: help;">
          ${FluxKit.ui.icons.zap}
        </div>` : '<div style="margin-left: auto;"></div>';

      let canInsert = false;
      if (selectionContext && selectionContext.element) {
        const el = selectionContext.element;
        const isStandardInput = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /text|search|password|tel|url/i.test(el.type));
        canInsert = isStandardInput || el.isContentEditable;
      }

      FluxKit.utils.withTTPatched(() => {
        shadowRoot.innerHTML = `
          <style>
            .flux-editable {
              opacity: 0.7; margin-bottom: 12px; font-size: 13px; line-height: 1.4;
              outline: none; padding-bottom: 4px; border-bottom: 1px dashed transparent;
              transition: all 0.2s ease; cursor: text;
            }
            .flux-editable:hover, .flux-editable:focus {
              opacity: 0.9; border-bottom: 1px dashed rgba(128,128,128,0.5);
            }
          </style>
          <div class="drag-handle" style="padding: 8px 12px; background: rgba(128,128,128,0.1); display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: grab;">
            <select id="flux-source-lang" data-no-drag="true" style="background: transparent; border: none; color: inherit; font-size: 12px; font-weight: 600; outline: none; cursor: pointer; max-width: 120px;">
              ${buildOptions(data.detectedLanguage || 'auto')}
            </select>
            <span style="opacity: 0.5;">&rarr;</span>
            <select id="flux-target-lang" data-no-drag="true" style="background: transparent; border: none; color: inherit; font-size: 12px; font-weight: 600; outline: none; cursor: pointer; max-width: 120px;">
              ${buildOptions(data.targetLang || 'en')}
            </select>
            ${cacheHtml}
          </div>
          <div data-no-drag="true" style="padding: 16px; font-size: 15px; line-height: 1.5; display:flex; flex-direction:column; gap:12px;">    
            <div style="position: relative; display: flex; flex-direction: column;">
              <div id="flux-glance-input" class="flux-editable" contenteditable="true" spellcheck="false" data-no-drag="true" style="padding-right: 24px;">${data.original}</div>
              <button id="flux-speak-source" style="position: absolute; right: 0; top: 0; background:transparent; border:none; color:inherit; opacity:0.4; cursor:pointer;" data-flx-trnslt-tooltip="Listen Original">
                ${FluxKit.ui.getIcon('speaker')}
              </button>
            </div>
            <div style="position: relative; display: flex; flex-direction: column; border-top: 1px solid rgba(128,128,128,0.15); padding-top: 12px;">
              <div style="font-weight: 500; padding-right: 24px;">${data.translated}</div>
              <button id="flux-speak-target" style="position: absolute; right: 0; top: 12px; background:transparent; border:none; color:#3b82f6; opacity:0.8; cursor:pointer;" data-flx-trnslt-tooltip="Listen Translation">
                ${FluxKit.ui.getIcon('speaker')}
              </button>
              <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
                <button id="flux-copy-trans" style="background: rgba(128,128,128,0.1); border: none; padding: 6px 10px; border-radius: 6px; color: inherit; font-size: 12px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.2s;">
                  ${FluxKit.ui.icons.copy}
                  <span class="btn-text">Copy</span>
                </button>
                
                ${canInsert ? `
                <button id="flux-replace-trans" style="background: var(--flx-accent-bg, #3b82f6); color: var(--flx-btn-text, #ffffff); border: none; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: filter 0.2s;">
                  ${FluxKit.ui.icons.swap} Replace
                </button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      });

      const speakSourceBtn = shadowRoot.getElementById('flux-speak-source');
      const speakTargetBtn = shadowRoot.getElementById('flux-speak-target');
      
      const sourceSelect = shadowRoot.getElementById('flux-source-lang');
      const targetSelect = shadowRoot.getElementById('flux-target-lang');
      const transInput = shadowRoot.getElementById('flux-glance-input');

      if (speakSourceBtn) {
        speakSourceBtn.addEventListener('click', () => {
          FluxKit.capture.speech.speak(transInput.innerText.trim(), { lang: sourceSelect.value });
        });
      }

      if (speakTargetBtn) {
        speakTargetBtn.addEventListener('click', () => {
          FluxKit.capture.speech.speak(data.translated, { lang: targetSelect.value });
        });
      }

      const copyBtn = shadowRoot.getElementById('flux-copy-trans');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(data.translated).then(() => {
            const textSpan = copyBtn.querySelector('.btn-text');
            textSpan.textContent = 'Copied!';
            setTimeout(() => { textSpan.textContent = 'Copy'; }, 2000);
          });
        });
      }

      const replaceBtn = shadowRoot.getElementById('flux-replace-trans');
      if (replaceBtn) {
        replaceBtn.addEventListener('click', () => {
          const status = FluxKit.capture.text.insertAtContext(data.translated, selectionContext);
          if (status === true) {
            destroy(); 
          } else if (status === 'orphaned') {
            replaceBtn.style.background = '#f59e0b';
            replaceBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              Saved to Clipboard
            `;
            setTimeout(() => destroy(), 2500);
          }
        });
      }

      const triggerUpdate = () => {
        const currentText = transInput.innerText.trim();
        if (currentText && currentText !== data.original) {
          onReTranslate(currentText, targetSelect.value, sourceLang);
        }
      };

      const handleLangChange = () => {
        const currentText = transInput.innerText.trim() || data.original;
        onReTranslate(currentText, targetSelect.value, sourceLang);
      };

      const handleSourceLangChange = () => {
        sourceLang = sourceSelect.value;
        handleLangChange();
      };

      sourceSelect.addEventListener('change', handleSourceLangChange);
      targetSelect.addEventListener('change', handleLangChange);

      transInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          triggerUpdate();
        }
      });
      transInput.addEventListener('blur', triggerUpdate);
    }

    function renderDictionary(data, isCached, onReSearch) {
      if (!shadowRoot) return;

      const firstMeaning = data.meanings && data.meanings[0];
      const primaryPos = firstMeaning ? firstMeaning.partOfSpeech : '';
      const primaryDef = firstMeaning && firstMeaning.definitions[0] ? firstMeaning.definitions[0].definition : 'Definition not found.';

      let synTags = []; let antTags = [];
      if (data.synonyms && data.synonyms.length > 0) synTags = data.synonyms;
      else if (firstMeaning.synonyms && firstMeaning.synonyms.length > 0) synTags = firstMeaning.synonyms;
      synTags = synTags.map(s => `<span style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${s}</span>`);

      if (data.antonyms && data.antonyms.length > 0) antTags = data.antonyms;
      else if (firstMeaning.antonyms && firstMeaning.antonyms.length > 0) antTags = firstMeaning.antonyms;
      antTags = antTags.map(s => `<span style="background: rgba(239, 68, 68, 0.15); color: #ef4444;  padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${s}</span>`);

      const primaryThesaurusHtml = `<div style="margin-top: 8px;">${[...synTags, ...antTags].join('')}</div>`;

      const renderPills = (list, type) => {
        if (!list || list.length === 0) return '';
        const isSyn = type === 'synonym';
        const bgStr = isSyn ? 'rgba(59, 130, 246, 0.15)' : 'rgba(239, 68, 68, 0.15)'; // Blue vs Red tint
        const txtStr = isSyn ? '#3b82f6' : '#ef4444';
        const label = isSyn ? 'Syn:' : 'Ant:';

        const tags = list
          .slice(0, 6)
          .map(w => `<span style="background: ${bgStr}; color: ${txtStr}; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">${w}</span>`,)
          .join('');
        return `<div style="margin-top: 4px;"><span style="font-size: 11px; font-weight: bold; color: ${txtStr}; margin-right: 4px; opacity: 0.8;">${label}</span>${tags}</div>`;
      };

      // Extended View: Loop through meanings
      let extendedHtml = '';
      if (data.meanings && data.meanings.length > 0) {
        data.meanings.forEach(meaning => {
          extendedHtml += `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(128,128,128,0.2);">
                      <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #3b82f6; letter-spacing: 0.5px; margin-bottom: 6px;">
                          ${meaning.partOfSpeech}
                      </div>`;

          // Meaning-level Synonyms/Antonyms
          extendedHtml += renderPills(meaning.synonyms, 'synonym');
          extendedHtml += renderPills(meaning.antonyms, 'antonym');

          extendedHtml += `<ul style="margin: 8px 0 0 0; padding-left: 16px; font-size: 13.5px; line-height: 1.5; opacity: 0.9;">`;

          meaning.definitions.slice(0, 3).forEach(defObj => {
            extendedHtml += `<li style="margin-bottom: 8px;">${defObj.definition}`;
            if (defObj.example) {
              extendedHtml += `<div style="opacity: 0.6; font-style: italic; margin-top: 2px;">"${defObj.example}"</div>`;
            }
            // Definition-level Synonyms/Antonyms
            extendedHtml += renderPills(defObj.synonyms, 'synonym');
            extendedHtml += renderPills(defObj.antonyms, 'antonym');
            extendedHtml += `</li>`;
          });

          extendedHtml += `</ul></div>`;
        });
      }

      const cacheHtml = isCached ? `<div data-flx-trnslt-tooltip="Loaded from local cache" style="margin-left: auto; color: #f59e0b; display: flex; align-items: center; opacity: 0.9; cursor: help;">${FluxKit.ui.icons.zap}</div>` : '<div style="margin-left: auto;"></div>';

      const audioUrl = extractAudioUrl(data);
      FluxKit.utils.withTTPatched(() => {
        shadowRoot.innerHTML = `
          <style>
            .flux-scroll::-webkit-scrollbar { width: 6px; }
            .flux-scroll::-webkit-scrollbar-track { background: transparent; }
            .flux-scroll::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 3px; }
            .flux-scroll::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.5); }
            .flux-expand-btn {
              width: 100%; text-align: center; padding: 6px; margin-top: 8px;
              background: rgba(128,128,128,0.08); border: none; border-radius: 6px;
              color: inherit; opacity: 0.7; font-size: 12px; font-weight: 600;
              cursor: pointer; transition: all 0.2s ease;
            }
            .flux-expand-btn:hover { background: rgba(128,128,128,0.15); opacity: 1; }
          </style>
          
          <div class="drag-handle" style="padding: 8px 12px; background: rgba(128,128,128,0.1); display: flex; align-items: center; cursor: grab; font-size: 13px">
            <span style="font-size: 8px; opacity:0.5; margin-top: 6px; margin-right: 8px; transform: scale(1.6);">${FluxKit.ui.icons.search}</span>
            <div id="flux-dict-search" contenteditable="true" data-no-drag="true" 
              style="background: transparent; border: none; color: inherit; font-size: 13px; font-weight: 600; outline: none; cursor: text; width: fit-content;">
                ${data.word}
            </div>
            ${cacheHtml}
          </div>

          <div data-no-drag="true" style="padding: 16px; display: flex; flex-direction: column;">
            <div>
              <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;">
                <span style="font-size: 18px; font-weight: bold;">${data.word}</span>
                <button id="flux-speak-word" style="background:transparent; border:none; padding: 2px; cursor:pointer; color:#3b82f6; display:inline-flex; align-items:center; opacity:0.8; transition:opacity 0.2s;" data-flx-trnslt-tooltip="Listen">
                  ${FluxKit.ui.getIcon('speaker')}
                </button>
                <span style="font-size: 13px; color: #3b82f6;">${primaryPos}</span>
                ${data.phonetic ? `<span style="font-size: 13px; opacity: 0.6;">${data.phonetic}</span>` : ''}
              </div>
              <div style="font-size: 14px; line-height: 1.5;">${primaryDef}</div>
              ${primaryThesaurusHtml}
            </div>

            <div id="flux-extended-view" class="flux-scroll" style="display: none; max-height: 250px; overflow-y: auto; margin-top: 4px;">
              ${extendedHtml}
            </div>

            ${data.meanings && data.meanings.length > 0 ? `<button id="flux-toggle-btn" class="flux-expand-btn">Show more definitions...</button>` : ''}
          </div>
        `;
      });

      const speakBtn = shadowRoot.getElementById('flux-speak-word');
      if (speakBtn) {
        speakBtn.addEventListener('click', () => {
          FluxKit.capture.speech.speak(data.word, { lang: 'en', audioUrl: audioUrl });
        });
      }

      const toggleBtn = shadowRoot.getElementById('flux-toggle-btn');
      const extendedView = shadowRoot.getElementById('flux-extended-view');
      const searchInput = shadowRoot.getElementById('flux-dict-search');

      if (toggleBtn && extendedView) {
        toggleBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const isHidden = extendedView.style.display === 'none';
          extendedView.style.display = isHidden ? 'block' : 'none';
          toggleBtn.textContent = isHidden
            ? 'Show less'
            : 'Show more definitions...';
        });
      }

      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const newWord = searchInput.textContent.trim()
          if (newWord && newWord !== data.word) onReSearch(newWord);
        }
      });
    }

    const settings = (function () {
      'use strict';

      let modalHost = null;
      let shadowRoot = null;

      function destroy() {
        if (modalHost) {
          modalHost.remove();
          modalHost = null;
          shadowRoot = null;
        }
      }

      function applyTheme(themeKey) {
        if (!modalHost) return;

        updateActiveTheme(themeKey);

        initNotification({ ...activeTheme, ...notifNamespace, position: 'top-center' });
        initTooltips({ ...activeTheme, rootElement: shadowRoot, attribute: 'flxTrnslt', delay: 500 });

        const themeBg = activeTheme.bg || '#ffffffe6';
        const glassBg = themeBg.length === 7 ? themeBg + 'e6' : themeBg;

        modalHost.style.setProperty('--flx-bg', glassBg);
        modalHost.style.setProperty('--flx-text', activeTheme.text || '#000000');
        modalHost.style.setProperty('--flx-border', activeTheme.border || '1px solid rgba(128,128,128,0.2)');
        modalHost.style.setProperty('--flx-input-bg', activeTheme.inputBg || 'rgba(128,128,128,0.1)');
        modalHost.style.setProperty('--flx-accent-bg', activeTheme.accentBg || '#3b82f6');
        modalHost.style.setProperty('--flx-btn-text', activeTheme.btnTextColor || '#ffffff');
      }

      function open() {
        if (modalHost) {
          if (modalHost.bringToFront) modalHost.bringToFront();
          return;
        }

        modalHost = FluxKit.utils.createHTMLElement('div', {
          id: 'flux-glance-settings',
          style: `
            position: fixed; top: 100px; left: 100px; z-index: 2147483647; width: 380px; 
            font-family: system-ui, sans-serif; box-shadow: 0 20px 40px rgba(0,0,0,0.3); 
            border-radius: 12px; overflow: hidden; 
            background: var(--flx-bg); color: var(--flx-text);
            border: var(--flx-border); backdrop-filter: blur(10px) saturate(180%);
            transition: background 0.3s ease, color 0.3s ease;
          `,
        });

        applyTheme(flxGlanceConfig.theme);

        shadowRoot = modalHost.attachShadow({ mode: 'open' });

        FluxKit.utils.withTTPatched(() => {
          shadowRoot.innerHTML = `
              <style>
                .flxn-form-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; font-size: 14px; }
                .flxn-form-label { font-weight: 500; opacity: 0.9; }
                .flxn-select, .flxn-input { 
                  padding: 6px 10px; border-radius: 6px; 
                  border: 1px solid rgba(128,128,128,0.3); 
                  background: var(--flx-input-bg); 
                  color: var(--flx-text); 
                  font-size: 13px; width: 140px; 
                  transition: background 0.3s ease, color 0.3s ease;
                }
                .flxn-select:focus, .flxn-input:focus { outline: none; border-color: var(--flx-accent-bg); }
                .flxn-color-picker { width: 30px; height: 30px; border: none; padding: 0; cursor: pointer; border-radius: 4px; overflow: hidden; background: transparent; }
                .btn-save { 
                  width: 100%; padding: 10px; 
                  background: var(--flx-accent-bg); 
                  color: var(--flx-btn-text); 
                  border: none; border-radius: 6px; font-weight: bold; cursor: pointer; 
                  transition: filter 0.2s; 
                }
                .btn-save:hover { filter: brightness(0.9); }
            </style>
            <div class="drag-handle" style="padding: 12px 16px; background: rgba(128,128,128,0.1); cursor: grab; font-weight: bold; display: flex; justify-content: space-between;">
              <span style="display: inline-flex; gap: 8px;">${FluxKit.ui.icons.settings} FluxGlance Settings</span>
            </div>
            <div id="settings-body" style="padding: 16px;"></div>
          `;
        });

        const body = shadowRoot.getElementById('settings-body');

        const themeControls = FluxKit.utils.createHTMLElement('div', {
          children: [
            FluxKit.utils.createHTMLElement('label', {
              class: 'flxn-form-row',
              children: [
                FluxKit.utils.createHTMLElement('div', { textContent: 'Theme Engine', class: 'flxn-form-label' }),
                FluxKit.utils.createHTMLElement('select', {
                  class: 'flxn-select',
                  children: Object.entries(THEME_PRESETS).map(([key, preset]) => FluxKit.utils.createHTMLElement('option', { value: key, textContent: preset.name, selected: key === flxGlanceConfig.theme })),
                  eventListener: {
                    change: e => {
                      flxGlanceConfig.theme = e.target.value;
                      applyTheme(flxGlanceConfig.theme);
                      const customPanel = shadowRoot.getElementById('flxn-custom-theme-panel');
                      if (customPanel) customPanel.style.display = flxGlanceConfig.theme === 'custom' ? 'flex' : 'none';
                      saveConfig();
                    },
                  },
                }),
              ],
            }),
            FluxKit.utils.createHTMLElement('div', {
              id: 'flxn-custom-theme-panel',
              style: `display: ${flxGlanceConfig.theme === 'custom' ? 'flex' : 'none'}; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; padding: 12px; background: rgba(128,128,128,0.05); border-radius: 8px; border: var(--flx-border);`,
              children: [
                { key: 'bg', label: 'BG' },
                { key: 'inputBg', label: 'Input' },
                { key: 'text', label: 'Text' },
                { key: 'accentBg', label: 'Accent' },
              ].map(prop =>
                FluxKit.utils.createHTMLElement('input', {
                  type: 'color', class: 'flxn-color-picker', title: prop.label, value: flxGlanceConfig.customTheme[prop.key],
                  eventListener: {
                    input: e => {
                      flxGlanceConfig.customTheme[prop.key] = e.target.value;
                      THEME_PRESETS.custom[prop.key] = e.target.value;
                      if (flxGlanceConfig.theme === 'custom') applyTheme('custom');
                      saveConfig();
                    },
                  },
                }),
              ),
            }),
          ],
        });

        const triggerControls = FluxKit.utils.createHTMLElement('div', {
          children: [
            FluxKit.utils.createHTMLElement('label', {
              class: 'flxn-form-row',
              children: [
                FluxKit.utils.createHTMLElement('div', { textContent: 'Keyboard Shortcut', class: 'flxn-form-label' }),
                FluxKit.utils.createHTMLElement('input', {
                  type: 'text', class: 'flxn-input', readOnly: true,
                  value: FluxKit.utils.formatShortcutForDisplay(flxGlanceConfig.keyboardTrigger),
                  style: 'text-align: center; font-family: monospace; cursor: pointer;',
                  eventListener: {
                    focus: e => {
                      isShortcutUpdating = true;
                      e.target.style.boxShadow = '0 0 0 2px var(--flx-accent-bg)';
                      e.target.value = 'Press keys...';
                    },
                    blur: e => {
                      isShortcutUpdating = false;
                      e.target.style.boxShadow = '';
                      e.target.value = FluxKit.utils.formatShortcutForDisplay(flxGlanceConfig.keyboardTrigger, { normalizeOS: true });
                    },
                    keydown: e => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.key === 'Escape') {
                        e.target.blur();
                        return;
                      }
                      if (e.key === 'Enter') {
                        if (e.target.dataset.tempStored) {
                          flxGlanceConfig.keyboardTrigger = e.target.dataset.tempStored;
                          saveConfig();
                        }
                        e.target.blur();
                        return;
                      }
                      const { stored, display, isModifierOnly } = FluxKit.utils.getShortcutFromEvent(e, { normalizeOS: true });
                      if (stored && !isModifierOnly) {
                        e.target.value = display;
                        e.target.dataset.tempStored = stored;
                      }
                    },
                  },
                }),
              ],
            }),
            FluxKit.utils.createHTMLElement('label', {
              class: 'flxn-form-row',
              children: [
                FluxKit.utils.createHTMLElement('div', { textContent: 'OCR Shortcut', class: 'flxn-form-label' }),
                FluxKit.utils.createHTMLElement('input', {
                  type: 'text', class: 'flxn-input', readOnly: true,
                  value: FluxKit.utils.formatShortcutForDisplay(flxGlanceConfig.ocrTrigger),
                  style: 'text-align: center; font-family: monospace; cursor: pointer;',
                  eventListener: {
                    focus: e => {
                      isShortcutUpdating = true;
                      e.target.style.boxShadow = '0 0 0 2px var(--flx-accent-bg)';
                      e.target.value = 'Press keys...';
                    },
                    blur: e => {
                      isShortcutUpdating = false;
                      e.target.style.boxShadow = '';
                      e.target.value = FluxKit.utils.formatShortcutForDisplay(flxGlanceConfig.ocrTrigger, { normalizeOS: true });
                    },
                    keydown: e => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.key === 'Escape') {
                        e.target.blur();
                        return;
                      }
                      if (e.key === 'Enter') {
                        if (e.target.dataset.tempStored) {
                          flxGlanceConfig.ocrTrigger = e.target.dataset.tempStored;
                          saveConfig();
                        }
                        e.target.blur();
                        return;
                      }
                      const { stored, display, isModifierOnly } = FluxKit.utils.getShortcutFromEvent(e, { normalizeOS: true });
                      if (stored && !isModifierOnly) {
                        e.target.value = display;
                        e.target.dataset.tempStored = stored;
                      }
                    },
                  },
                }),
              ],
            }),
            FluxKit.utils.createHTMLElement('label', {
              class: 'flxn-form-row',
              children: [
                FluxKit.utils.createHTMLElement('div', {
                  textContent: 'Mouse Modifier (Click)',
                  class: 'flxn-form-label',
                }),
                FluxKit.utils.createHTMLElement('select', {
                  class: 'flxn-select',
                  children: ['none', 'alt'].map(mod =>
                    FluxKit.utils.createHTMLElement('option', {
                      value: mod,
                      textContent: mod === 'none' ? 'None (Disabled)' : mod.toUpperCase(),
                      selected: mod === flxGlanceConfig.mouseModifier,
                    }),
                  ),
                  eventListener: {
                    change: e => {
                      flxGlanceConfig.mouseModifier = e.target.value;
                      saveConfig();
                    },
                  },
                }),
              ],
            }),
          ],
        });

        const ocrMode = FluxKit.utils.createHTMLElement('label', {
          class: 'flxn-form-row',
          children: [
            FluxKit.utils.createHTMLElement('div', {
              textContent: 'OCR Capture Engine',
              class: 'flxn-form-label',
              title:
                'DOM is faster and requires no permissions. Native captures DRM videos but prompts for screen share.',
            }),
            FluxKit.utils.createHTMLElement('select', {
              class: 'flxn-select',
              children: [
                { val: 'live', text: 'Live (Fast, No Prompts)' },
                { val: 'native', text: 'Native (Foolproof)' },
              ].map(opt =>
                FluxKit.utils.createHTMLElement('option', {
                  value: opt.val,
                  textContent: opt.text,
                  selected: opt.val === flxGlanceConfig.ocrMode,
                }),
              ),
              eventListener: {
                change: e => {
                  flxGlanceConfig.ocrMode = e.target.value;
                  saveConfig();
                },
              },
            }),
          ],
        });

        body.appendChild(themeControls);
        body.appendChild(ocrMode);
        body.appendChild(triggerControls);

        document.body.appendChild(modalHost);

        const dragHandle = shadowRoot.querySelector('.drag-handle');

        if (FluxKit.utils.makeElementDragAndResize) {
          const dragCleanup = FluxKit.utils.makeElementDragAndResize(
            modalHost,
            dragHandle,
            {
              resizable: false,
              close: { iconTop: 14, iconSize: 16, color: 'var(--flx-text)', hoverTransform: 'rotate(90deg) scale(1.1)' },
              dblClickMaximize: false,
              autoFocus: true,
              onClose: destroy,
            },
          );
          modalHost.bringToFront = dragCleanup.bringToFront;
        }
      }

      return { open, destroy };
    })();

    function focusSearch() {
      if (!shadowRoot) return;
      const input = shadowRoot.getElementById('flux-dict-search');
      if (input) {
        input.focus();
        const range = document.createRange();
        range.selectNodeContents(input);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }

    return { showLoading, renderTranslation, renderDictionary, settings, destroy, focusSearch };
  })();

  GM_registerMenuCommand('Settings', FluxGlanceUI.settings.open);

  const glanceCache = FluxKit.cache.register('translator-lookups', { storage: 'memory', policy: 'lru', maxSize: 30 });

  const getCacheKey = (word, toLang, fromLang) => `${word.toLowerCase().trim()}_${fromLang}_${toLang}`;

  const staticFluxPayload = {
    type: 'dictionary',
    word: 'flux',
    phonetic: '/flʌks/',
    phonetics: [ { text: '/flʌks/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/flux-us.mp3', sourceUrl: 'https://commons.wikimedia.org/w/index.php?curid=49883437', license: { name: 'BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0' } } ],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [
          { definition: 'The act of flowing; a continuous moving on or passing by, as of a flowing stream.', synonyms: [], antonyms: [] },
          { definition: 'A state of ongoing change.', synonyms: [], antonyms: [], example: 'Languages, like our bodies, are in a continual flux.' },
          { definition: 'A chemical agent for cleaning metal prior to soldering or welding.', synonyms: [], antonyms: [], example: 'It is important to use flux when soldering or oxides on the metal will prevent a good bond.' },
          { definition: 'The rate of transfer of energy (or another physical quantity) through a given surface, specifically electric flux, magnetic flux.', synonyms: [], antonyms: [], example: 'That high a neutron flux would be lethal in seconds.' },
          { definition: 'A disease which causes diarrhea, especially dysentery.', synonyms: [], antonyms: [] },
          { definition: 'Diarrhea or other fluid discharge from the body.', synonyms: [], antonyms: [] },
          { definition: 'The state of being liquid through heat; fusion.', synonyms: [], antonyms: [] },
        ],
        synonyms: [], antonyms: ['stasis'],
      },
      { partOfSpeech: 'verb', definitions: [ { definition: 'To use flux on.', synonyms: [], antonyms: [], example: 'You have to flux the joint before soldering.' }, { definition: 'To melt.', synonyms: [], antonyms: [] }, { definition: 'To flow as a liquid.', synonyms: [], antonyms: [] }, ], synonyms: [], antonyms: [] },
      { partOfSpeech: 'adjective', definitions: [ { definition: 'Flowing; unstable; inconstant; variable.', synonyms: [], antonyms: [] } ], synonyms: [], antonyms: [] },
    ],
    license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' },
    sourceUrls: ['https://en.wiktionary.org/wiki/flux'],
    synonyms: ['fluxion', 'magnetic flux', 'magnetic field', 'flux density'], antonyms: [],
  };

  glanceCache.set(getCacheKey('flux', 'en', 'auto'), staticFluxPayload, { pinned: true });
  
  async function performLookup(text, coords, targetLang = 'en', sourceLang = 'auto', selectionContext = null) {
    const cacheKey = getCacheKey(text, targetLang, sourceLang);
    const cachedData = await glanceCache.get(cacheKey);
    
    if (cachedData) {
      if (coords) FluxGlanceUI.showLoading(coords);
      
      if (cachedData.type === 'dictionary') {
        FluxGlanceUI.renderDictionary(cachedData, true, newWord => performLookup(newWord, null));
        
        if (text.toLowerCase() === 'flux') {
          setTimeout(() => FluxGlanceUI.focusSearch(), 50);
        }
      } else if (cachedData.type === 'translation') {
        FluxGlanceUI.renderTranslation(cachedData, true, (originalText, newTarget, newSource) => {
          performLookup(originalText, null, newTarget, newSource, selectionContext);
        }, selectionContext);
      }
      return;
    }
    
    FluxGlanceUI.showLoading(coords);

    try {
      if (!text.includes(' ') && text.length < 25 && targetLang === 'en') {
        const dictData = await FluxKit.api.dictionary.fetch(text);

        if (dictData) {
          const synonyms = await FluxKit.api.thesaurus.fetch(text, 'syn', 5);
          const antonyms = await FluxKit.api.thesaurus.fetch(text, 'ant', 5);
          dictData.synonyms = synonyms;
          dictData.antonyms = antonyms;
          dictData.type = 'dictionary';
          await glanceCache.set(cacheKey, dictData);

          FluxGlanceUI.renderDictionary(dictData, false, newWord => {
            performLookup(newWord, null);
          });
          return;
        }
      }

      const transData = await FluxKit.api.translate.fetch(
        text,
        targetLang,
        sourceLang,
      );

      transData.targetLang = targetLang;
      transData.type = 'translation';
      await glanceCache.set(cacheKey, transData);

      FluxGlanceUI.renderTranslation(
        transData, false,
        (originalText, newTarget, newSource) => {
          performLookup(originalText, null, newTarget, newSource, selectionContext);
        }, selectionContext
      );
    } catch (error) {
      logError(error, { __v: 1 });
      FluxGlanceUI.destroy();
    }
  }

  FluxKit.capture.text.init(
    (text, coords) => {
      const selectionContext = FluxKit.capture.text.getDeepSelectionContext();
      setTimeout(() => performLookup(text, coords, 'en', 'auto', selectionContext), 50);
    },
    {
      get keyboardTrigger() { return flxGlanceConfig.keyboardTrigger; },
      get mouseModifier() { return flxGlanceConfig.mouseModifier === 'none' ? null : flxGlanceConfig.mouseModifier; }
    },
  );

  FluxKit.capture.screen.init(async () => {
    if (document.getElementById('flux-glance-settings')) return;

    const snip = await FluxKit.capture.screen.startSnip({ mode: flxGlanceConfig.ocrMode, interactive: false });
    if (!snip) return;

    FluxGlanceUI.showLoading(snip.coords);

    try {
      const recognizedText = await FluxKit.capture.ocr.recognize(snip.base64, 'eng+jpn+chi_sim');
      const cleanText = recognizedText ? recognizedText.trim() : '';

      if (cleanText) {
        performLookup(cleanText, null, 'en', 'auto'); 
      } else {
        logWarning('OCR yielded no text.');
        showNotification('OCR yielded no text.', { icon: 'warning' })
        FluxGlanceUI.destroy(); 
      }
    } catch (err) {
      logError('Pipeline failed:', err);
      FluxGlanceUI.destroy();
    }
  }, {
    get keyboardTrigger() { return flxGlanceConfig.ocrTrigger; }
  });

  function handleKeydown(e) {
    const trigger = flxGlanceConfig.launcherTrigger;
    if (!trigger) return;

    if (FluxKit.utils.shouldIgnoreKeystroke(e, { allowModifiers: true })) return;

    const { stored } = FluxKit.utils.getShortcutFromEvent(e, { normalizeOS: true });

    if (stored === trigger) {
      e.preventDefault(); e.stopImmediatePropagation();
      performLookup('flux', { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 'en', 'auto');
    }
  }

  window.addEventListener('keydown', handleKeydown, { capture: true });
})();
