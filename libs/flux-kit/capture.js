// ==UserScript==
// @name         FluxKit Capture
// @namespace    https://github.com/JYashu
// @version      1.0.0
// @description  Advanced screen snipping, Shadow DOM text replacement, and speech synthesis engine.
// @author       JYashu
// @license      Apache-2.0
// ==/UserScript==
(function() {
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

  if (typeof FluxKit === 'undefined' || !FluxKit.utils || !FluxKit.ui) {
    console.error('FluxKit Text Utility Error: Core FluxKit is missing. Please @require flux-kit/core.js & flux-kit/ui.js before flux-kit/text.js');
    return; 
  }

  FluxKit.capture = FluxKit.capture || {};

  FluxKit.capture.langs ??= {
    auto: 'Auto-Detect', en: 'English', es: 'Spanish', fr: 'French', hi: 'Hindi',
    de: 'German', el: 'Greek', is: 'Icelandic', ga: 'Irish', la: 'Latin',
    ja: 'Japanese', ko: 'Korean', ms: 'Malay', vi: 'Vietnamese', id: 'Indonesian', th: 'Thai', 
    'zh-CN': 'Chinese (Simplified, China)', 'zh-TW': 'Chinese (Traditional, Taiwan)', 
    'zh-HK': 'Chinese (Traditional, Hong Kong)', 'zh-SG': 'Chinese (Traditional, Singapore)',
    ru: 'Russian', pt: 'Portuguese', it: 'Italian', ro: 'Romanian', nl: 'Dutch',
    ur: 'Urdu', ar: 'Arabic', tr: 'Turkish', pl: 'Polish', he: 'Hebrew', fa: 'Persian',
    as: 'Assamese', bn: 'Bengali', gu: 'Gujarati', mr: 'Marathi', or: 'Oriya', ks: 'Kashmiri',
    pa: 'Punjabi', sa: 'Sanskrit', sd: 'Sindhi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam',
    kn: 'Kannada', ne: 'Nepali', bo: 'Tibetan',
  };

  FluxKit.capture.text ??= (function () {
    'use strict';

    function insertTextAtContext(text, context) {
      if (!context) return false;
      const { element, range } = context;

      if (element && !element.isConnected) {
        console.warn('[FluxKit] Target element was destroyed. Falling back to clipboard.');
        try { navigator.clipboard.writeText(text); } catch(e) {}
        return 'orphaned';
      }

      if (element && typeof element.focus === 'function') element.focus();

      let success = false;
      try { success = document.execCommand('insertText', false, text); } catch(e) {}

      if (!success) {
        if (element && (element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT' && /text|search|password|tel|url/i.test(element.type)))) {
          const start = element.selectionStart || 0;
          const end = element.selectionEnd || 0;
          element.setRangeText(text, start, end, 'end');
          element.dispatchEvent(new Event('input', { bubbles: true }));
          success = true;
        } else if (range) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          if (!document.execCommand('insertText', false, text)) {
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
            if (element) element.dispatchEvent(new Event('input', { bubbles: true }));
          }
          success = true;
        }
      }
      return success;
    }

    function getDeepSelectionContext() {
      let activeEl = document.activeElement;
      let selRoot = document;

      while (activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement) {
        selRoot = activeEl.shadowRoot;
        activeEl = selRoot.activeElement;
      }

      let savedRange = null;
      let sel = null;

      if (typeof selRoot.getSelection === 'function') sel = selRoot.getSelection();
      if (!sel || sel.rangeCount === 0) sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) savedRange = sel.getRangeAt(0).cloneRange();

      return { element: activeEl, range: savedRange };
    }

    function getDeepestActiveElement(root = document) {
      let active = root.activeElement;
      while (active && active.shadowRoot) active = active.shadowRoot.activeElement;
      return active;
    }

    function getSelectedText() {
      let text = window.getSelection().toString().trim();
      if (text) return text;

      let active = document.activeElement;
      while (active && active.shadowRoot) {
        const shadowRoot = active.shadowRoot;
        if (typeof shadowRoot.getSelection === 'function') {
          text = shadowRoot.getSelection().toString().trim();
          if (text) return text;
        }
        active = shadowRoot.activeElement;
      }

      const deepestActive = getDeepestActiveElement();
      if (deepestActive) {
        const tag = deepestActive.tagName;
        const isTextInput = tag === 'INPUT' && ['text', 'search', 'url'].includes(deepestActive.type);

        if (tag === 'TEXTAREA' || isTextInput) {
          text = deepestActive.value.substring(deepestActive.selectionStart, deepestActive.selectionEnd).trim();
        }
      }

      return text;
    }

    let lastMousePos = { x: 0, y: 0 };
    window.addEventListener('mousemove', e => {
        lastMousePos.x = e.clientX;
        lastMousePos.y = e.clientY;
      }, { passive: true },
    );

    const subscribers = new Set();
    let isInitialized = false;

    function handleKeydown(e) {
      if (FluxKit.utils.shouldIgnoreKeystroke(e, { ignoreInputs: false, ignoreContentEditable: false, allowModifiers: true })) return;

      for (const sub of subscribers) {
        if (!sub.config.keyboardTrigger) continue;
        
        const { stored } = FluxKit.utils.getShortcutFromEvent(e, { normalizeOS: sub.config.normalizeOS });
        if (stored === sub.config.keyboardTrigger) {
          const text = getSelectedText();
          if (text) {
            e.preventDefault(); e.stopPropagation();
            sub.callback(text, lastMousePos);
          }
        }
      }
    }

    function handleMouseUp(e) {
      for (const sub of subscribers) {
        if (!sub.config.mouseModifier || sub.config.mouseModifier === 'none') continue;

        const modMap = { alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey, cmd: e.metaKey, win: e.metaKey };
        const hasRequiredModifier = sub.config.mouseModifier ? modMap[sub.config.mouseModifier.toLowerCase()] : true;

        if (hasRequiredModifier && e.button === sub.config.mouseButton) {
          setTimeout(() => {
            const text = getSelectedText();
            if (text) sub.callback(text, { x: e.clientX, y: e.clientY });
          }, 50);
        }
      }
    }

    function init(onLookupCallback, config = {}) {
      const options = { keyboardTrigger: 'ctrl+shift+e', mouseModifier: 'alt', normalizeOS: true, mouseButton: 0, ...config };

      const subscriber = { callback: onLookupCallback, config: options };
      subscribers.add(subscriber);

      if (!isInitialized) {
        document.addEventListener('keydown', handleKeydown, true);
        document.addEventListener('mouseup', handleMouseUp);
        isInitialized = true;
      }

      return () => subscribers.delete(subscriber); // cleanup function
    }

    return { insertTextAtContext, getDeepSelectionContext, getSelectedText, init };
  })();

  FluxKit.capture.screen ??= (function () {
    'use strict';

    let overlayHost = null, shadowRoot = null, isHtml2CanvasLoaded = false;

    const subscribers = new Set();
    let isInitialized = false;

    function handleKeydown(e) {
      if (e.defaultPrevented || e._fluxHandled) return;
      if (FluxKit.utils.shouldIgnoreKeystroke(e, { allowModifiers: true })) return;

      for (const sub of subscribers) {
        if (!sub.config || !sub.callback || !sub.config.keyboardTrigger) continue;
        const { stored } = FluxKit.utils.getShortcutFromEvent(e, { normalizeOS: sub.config.normalizeOS });
        if (stored === sub.config.keyboardTrigger) {
          e._fluxHandled = true;
          e.preventDefault(); e.stopImmediatePropagation();
          sub.callback(e); break;
        }
      }
    }

    function init(callback, options = {}) {
      const config = { keyboardTrigger: 'ctrl+shift+x', normalizeOS: true, ...options };
      const subscriber = { callback, config };
      subscribers.add(subscriber);

      if (!isInitialized) {
        window.addEventListener('keydown', handleKeydown, { capture: true });
        isInitialized = true;
      }

      return () => subscribers.delete(subscriber); // cleanup function
    }

    function destroy() {
      if (overlayHost) { overlayHost.remove(); overlayHost = null; shadowRoot = null; }
      const orphanedLoader = document.getElementById('flux-sniper-loader');
      if (orphanedLoader) orphanedLoader.remove();
      document.body.style.cursor = '';
    }

    function showSniperLoader(msg = 'Capturing Viewport...', subMsg) {
      const loader = FluxKit.utils.createHTMLElement('div', {
        id: 'flux-sniper-loader',
        style: `
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          z-index: 2147483647; display: flex; justify-content: center; align-items: center;
          background: rgba(0,0,0,0.4); color: white; font-family: system-ui, sans-serif;
          backdrop-filter: blur(3px); cursor: wait;
        `,
      });
      loader.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 16px; background: rgba(0,0,0,0.6); padding: 24px 32px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <span style="display: flex; font-size: 36px; color: #3b82f6;">${FluxKit.ui.icons.loader}</span>
          <div style="font-weight: 500; font-size: 15px; letter-spacing: 0.5px;">${msg}</div>
          ${subMsg ? `<div style="font-weight: 500; font-size: 13px; letter-spacing: 0.5px; color: rgba(255,255,255,0.6)">${subMsg}</div>` :''}
        </div>
      `;
      document.body.appendChild(loader);
      return loader;
    }

    function loadHtml2Canvas() {
      return new Promise((resolve, reject) => {
        if (isHtml2CanvasLoaded && window.html2canvas) return resolve();
        const CACHE_KEY = 'flux_html2canvas_cache';
        const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
        const cached = GM_getValue(CACHE_KEY, null);

        if (cached && cached.code && Date.now() - cached.timestamp < CACHE_TTL) {
          try {
            document.head.appendChild(FluxKit.utils.createHTMLElement('script', { textContent:cached.code }));
            isHtml2CanvasLoaded = true; setTimeout(resolve, 50); return;
          } catch (e) { console.warn('[FluxSniper] Cache injection failed, falling back to CDN.'); }
        }

        GM_xmlhttpRequest({
          method: 'GET', anonymous: true, url: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
          onload: res => {
            if (res.status === 200) {
              try {
                GM_setValue(CACHE_KEY, { code: res.responseText, timestamp: Date.now() });
                document.head.appendChild(FluxKit.utils.createHTMLElement('script', { textContent: res.responseText }));
                isHtml2CanvasLoaded = true; setTimeout(resolve, 50);
              } catch (err) { reject(err); }
            } else reject(new Error(`HTTP Error ${res.status}`));
          },
          onerror: () => reject(new Error('Network error')),
          onabort: () => reject(new Error('Request aborted')),
        });
      });
    }

    async function getFreezeFrame(mode = 'dom', fullPage = false) {
      if (mode === 'native' && !fullPage) {
        const loader = document.getElementById('flux-sniper-loader'); if (loader) loader.style.display = 'none';
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, preferCurrentTab: true, audio: false });
          const track = stream.getVideoTracks()[0]; 
          
          return new Promise((resolve, reject) => {
            const video = FluxKit.utils.createHTMLElement('video', { srcObject: stream, muted: true });
            video.onloadedmetadata = async () => {
              try {
                await video.play();
                const settings = track.getSettings();
                const canvas = FluxKit.utils.createHTMLElement('canvas');
                canvas.width = settings.width || video.videoWidth; 
                canvas.height = settings.height || video.videoHeight;
                
                const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, canvas.width, canvas.height); track.stop();
                resolve({ canvas, width: canvas.width, height: canvas.height });
              } catch (err) { track.stop(); reject(err); }
            };
            video.onerror = () => { track.stop(); reject(new Error("Video playback failed")); };
          });
        } catch (e) { return null; }
      } else {
        try {
          await loadHtml2Canvas();
          
          const targetEl = fullPage ? document.body : document.documentElement;
          const opts = fullPage ?
            { useCORS: true, allowTaint: false, logging: false, backgroundColor: '#ffffff', windowWidth: document.body.scrollWidth, windowHeight: document.body.scrollHeight } :
            { x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight, useCORS: true, allowTaint: false, logging: false, backgroundColor: null };

          opts.ignoreElements = (el) => el.id === 'flux-sniper-host' || el.id === 'flux-sniper-loader';
          
          await new Promise(r => setTimeout(r, 50));
          const canvas = await html2canvas(targetEl, opts);
          return { canvas, width: canvas.width, height: canvas.height };
        } catch (e) {
          if (fullPage) return null;
          console.warn('[FluxSniper] DOM capture failed. Falling back to Native...');
          return await getFreezeFrame('native');
        }
      }
    }

    async function startSnip(options = {}) {
      const config = { mode: 'live', interactive: true, ...options };
      destroy();

      return new Promise(async (resolve) => {
        const isHostileSite = ['youtube.com', 'netflix.com', 'crunchyroll.com', 'primevideo.com', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'reddit.com'].some(d => window.location.hostname.includes(d));
        const hasLargeVideo = Array.from(document.querySelectorAll('video, canvas:not(#flux-translate-host canvas)')).some(el => {
          const rect = el.getBoundingClientRect(); return (rect.width > 200 && rect.height > 200 && rect.bottom > 0 && rect.top < window.innerHeight);
        });
        
        const requireNative = isHostileSite || hasLargeVideo;
        const activeMode = requireNative ? 'native' : config.mode;

        let isCancelled = false;
        let onScroll = null;
        
        const onEsc = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation(); isCancelled = true;
            window.removeEventListener('keydown', onEsc, { capture: true });
            if (onScroll) window.removeEventListener('scroll', onScroll, { passive: true });
            destroy(); resolve(null);
          }
        };
        window.addEventListener('keydown', onEsc, { capture: true });

        let frameData = null;
        if (activeMode !== 'live') {
          const loader = showSniperLoader('Capturing Viewport...');
          try { frameData = await getFreezeFrame(activeMode); }
          catch (error) { console.error('[FluxSniper] Capture error:', error); }
          finally { if (loader) loader.remove(); }
          if (isCancelled || !frameData) { cleanupAndResolve(null); return; }
        }

        let isDarkScene = false;
        if (frameData) {
          try {
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = 50; tmpCanvas.height = 50;
            const tCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
            tCtx.drawImage(frameData.canvas, 0, 0, 50, 50);
            const data = tCtx.getImageData(0, 0, 50, 50).data;
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; }
            const pixels = data.length / 4;
            isDarkScene = Math.sqrt(0.299 * Math.pow(r/pixels, 2) + 0.587 * Math.pow(g/pixels, 2) + 0.114 * Math.pow(b/pixels, 2)) < 127;
          } catch(e) {}
        }

        overlayHost = FluxKit.utils.createHTMLElement('div', { id: 'flux-sniper-host', style: `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; cursor: crosshair;` });
        shadowRoot = overlayHost.attachShadow({ mode: 'open' });
        FluxKit.ui.initTooltips({ ...this.theme, rootElement: shadowRoot, attribute: 'flxSnip' });

        const uiCanvas = FluxKit.utils.createHTMLElement('canvas', { style: 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block;', width: window.innerWidth, height: window.innerHeight });
        
        const toolbar = FluxKit.utils.createHTMLElement('div', {
          style: `position: absolute; top: 16px; right: 16px; display: flex; gap: 8px; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); padding: 8px; border-radius: 8px; font-family: system-ui; border: 1px solid rgba(255,255,255,0.1); cursor: default;`
        });

        const createBtn = (text, icon, onClick, isDisabled = false) => {
          const btn = FluxKit.utils.createHTMLElement('button', {
            innerHTML: `<span style="display: flex; font-size: 14px;">${icon}</span> <span style="font-size: 13px; font-weight: 500;">${text}</span>`,
            style: `display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: transparent; color: rgba(255,255,255,${isDisabled ? '0.3' : '0.7'}); border: rgba(255,255,255,${isDisabled ? '0.3' : '0.7'}; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); cursor: ${isDisabled ? 'not-allowed' : 'pointer'}; transition: background 0.2s;`,
            eventListener: isDisabled ? {
              click: () => alert("Full Page capture is disabled here. Highly complex apps (like YouTube) use strict security policies (CSP) that prevent safe scrolling captures.")
            } : {
              click: onClick,
              mouseenter: (e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)',
              mouseleave: (e) => e.currentTarget.style.background = 'transparent'
            }
          });
          if (isDisabled) btn.title = "Not available on highly complex or secure sites.";
          return btn;
        };

        toolbar.appendChild(createBtn('Save Visible', FluxKit.ui.icons.preview, async () => {
          let b64 = null;
          let coords = { x: window.innerWidth/2, y: window.innerHeight/2 };
          
          if (activeMode === 'live') {
            toolbar.style.display = 'none';
            overlayHost.style.display = 'none';
            const loadMsg = showSniperLoader('Capturing Viewport...');
            await new Promise(r => setTimeout(r, 50));
            try {
              await loadHtml2Canvas();
              const c = await html2canvas(document.documentElement, {
                x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight,
                useCORS: true, allowTaint: false, logging: false, backgroundColor: '#ffffff',
                ignoreElements: (el) => el.id === 'flux-sniper-host' || el.id === 'flux-sniper-loader'
              });
              b64 = c.toDataURL('image/jpeg', 0.9);
            } catch(e) { console.error(e); }
            finally { if(loadMsg) loadMsg.remove(); }
          } else {
            b64 = frameData.canvas.toDataURL('image/jpeg', 0.9);
          }
          
          if (b64) showPreviewViewer(b64, coords, 'visible');
          else cleanupAndResolve(null);
        }));

        toolbar.appendChild(createBtn('Full Page', FluxKit.ui.icons.document, async () => {
          toolbar.style.display = 'none';
          overlayHost.style.display = 'none';
          
          const fpLoader = showSniperLoader('Capturing Full Page...', '(This may take a moment)');
          const fpData = await getFreezeFrame('dom', true);
          if (fpLoader) fpLoader.remove();
          
          if (fpData) {
            const b64 = fpData.canvas.toDataURL('image/jpeg', 0.8);
            showPreviewViewer(b64, { x: window.innerWidth/2, y: window.innerHeight/2 }, 'full');
          } else { 
            overlayHost.style.display = 'block';
            toolbar.style.display = 'flex';
          }
        }, requireNative));

        const editToolbar = FluxKit.utils.createHTMLElement('div', {
          style: `position: absolute; display: none; gap: 8px; background: rgba(0,0,0,0.85); backdrop-filter: blur(12px); padding: 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 10; font-family: system-ui; transition: opacity 0.2s;`
        });

        if (config.interactive) {
          const createTbBtn = (icon, title, color, onClick) => FluxKit.utils.createHTMLElement('button', {
            icon: icon, flxSnipTooltip: title,
            style: `width: 32px; height: 32px; border-radius: 6px; border: none; background: transparent; color: ${color}; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; transition: background 0.2s;`,
            eventListener: { click: onClick, mouseenter: e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)', mouseleave: e => e.currentTarget.style.background = 'transparent' }
          });
          editToolbar.appendChild(createTbBtn('close', 'Cancel', '#ff4757', () => cleanupAndResolve(null)));
          editToolbar.appendChild(createTbBtn('copy', 'Copy to Clipboard', '#ffffff', () => processFinalCrop('copy')));
          editToolbar.appendChild(createTbBtn('import', 'Download', '#ffffff', () => processFinalCrop('download')));
          editToolbar.appendChild(createTbBtn('success', 'Confirm', '#2ed573', () => processFinalCrop('resolve')));
        }

        shadowRoot.appendChild(uiCanvas);
        shadowRoot.appendChild(toolbar);
        if (config.interactive) shadowRoot.appendChild(editToolbar);
        document.body.appendChild(overlayHost);

        const ctx = uiCanvas.getContext('2d');
        let appState = 'idle';
        
        let pageBox = { x: 0, y: 0, w: 0, h: 0 };
        let drawStartPage = { x: 0, y: 0 };
        let activeHandle = null;
        let hoveredElement = null;
        let hoveredPageRect = null;
        let lastMouseView = { x: 0, y: 0 };

        const drawOverlay = () => {
          ctx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
          
          if (activeMode !== 'live' && frameData) {
            ctx.drawImage(frameData.canvas, 0, 0, uiCanvas.width, uiCanvas.height);
          }
          
          ctx.fillStyle = activeMode === 'live' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.4)';
          ctx.fillRect(0, 0, uiCanvas.width, uiCanvas.height);

          let vBox = { x: pageBox.x - window.scrollX, y: pageBox.y - window.scrollY, w: pageBox.w, h: pageBox.h };

          if (appState === 'idle' && hoveredPageRect) {
            vBox = { x: hoveredPageRect.x - window.scrollX - 4, y: hoveredPageRect.y - window.scrollY - 4, w: hoveredPageRect.w + 8, h: hoveredPageRect.h + 8 };
          }

          if (vBox.w > 0 && vBox.h > 0) {
            const radius = 8;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(vBox.x, vBox.y, vBox.w, vBox.h, radius);
            else {
              ctx.moveTo(vBox.x + radius, vBox.y); ctx.arcTo(vBox.x + vBox.w, vBox.y, vBox.x + vBox.w, vBox.y + vBox.h, radius);
              ctx.arcTo(vBox.x + vBox.w, vBox.y + vBox.h, vBox.x, vBox.y + vBox.h, radius); ctx.arcTo(vBox.x, vBox.y + vBox.h, vBox.x, vBox.y, radius); ctx.arcTo(vBox.x, vBox.y, vBox.x + vBox.w, vBox.y, radius);
            }
            ctx.closePath();

            ctx.save(); ctx.clip(); 
            ctx.clearRect(vBox.x, vBox.y, vBox.w, vBox.h); 
            
            if (activeMode !== 'live' && frameData) {
                ctx.drawImage(
                  frameData.canvas, 
                  vBox.x * (frameData.width / uiCanvas.width), vBox.y * (frameData.height / uiCanvas.height), 
                  vBox.w * (frameData.width / uiCanvas.width), vBox.h * (frameData.height / uiCanvas.height), 
                  vBox.x, vBox.y, vBox.w, vBox.h
                );
            }
            
            if (appState !== 'idle') {
              ctx.fillStyle = isDarkScene ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.15)'; 
              ctx.fillRect(vBox.x, vBox.y, vBox.w, vBox.h);
            }
            ctx.restore(); 

            ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10;
            ctx.strokeStyle = (appState === 'drawing' || appState === 'resizing') ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1.5; ctx.stroke();
            ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

            if (appState === 'editing' || appState === 'resizing') {
              ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 4;
              const hSize = 8;
              const handles = [
                { x: vBox.x, y: vBox.y }, { x: vBox.x + vBox.w/2, y: vBox.y }, { x: vBox.x + vBox.w, y: vBox.y },
                { x: vBox.x + vBox.w, y: vBox.y + vBox.h/2 }, { x: vBox.x + vBox.w, y: vBox.y + vBox.h },
                { x: vBox.x + vBox.w/2, y: vBox.y + vBox.h }, { x: vBox.x, y: vBox.y + vBox.h }, { x: vBox.x, y: vBox.y + vBox.h/2 }
              ];
              handles.forEach(pt => { ctx.beginPath(); ctx.arc(pt.x, pt.y, hSize/2, 0, Math.PI * 2); ctx.fill(); });
            }
          }
        };

        const updateToolbar = () => {
          if (appState !== 'editing') { editToolbar.style.display = 'none'; return; }
          editToolbar.style.display = 'flex';
          toolbar.style.display = 'none';
          
          let vBox = { x: pageBox.x - window.scrollX, y: pageBox.y - window.scrollY, w: pageBox.w, h: pageBox.h };
          let tx = vBox.x + vBox.w - 160; let ty = vBox.y + vBox.h + 16;
          if (tx < 16) tx = Math.max(16, vBox.x);
          if (ty + 60 > window.innerHeight) ty = vBox.y + vBox.h - 60;
          ty = Math.min(ty, window.innerHeight - 60);
          ty = Math.max(ty, vBox.y + 16);
          
          editToolbar.style.left = `${tx}px`; editToolbar.style.top = `${ty}px`;
        };

        let autoScrollRaf = null;
        let autoScrollSpeed = { x: 0, y: 0 };

        const handleAutoScroll = () => {
          if (autoScrollSpeed.x === 0 && autoScrollSpeed.y === 0) {
            autoScrollRaf = null; return;
          }
          window.scrollBy(autoScrollSpeed.x, autoScrollSpeed.y);
          autoScrollRaf = requestAnimationFrame(handleAutoScroll);
        };

        const showPreviewViewer = (base64, coords, type) => {
          overlayHost.style.display = 'none';

          FluxKit.ui.viewer.open('Preview Snapshot.png', base64, {
            namespace: 'sniper-preview',
            hideDefaultActions: true,
            onClose: (reason) => {
              if (reason === 'escape' || reason === 'manual') {
                cleanupAndResolve(null);
              } else if (reason === 'retry') {
                overlayHost.style.display = 'block';
                toolbar.style.display = 'flex';
              }
            },
            customActions: [
              {
                icon: 'refresh', iconColor: '#ff4757', flxSnipTooltip: 'Retry',
                onClick: (closeFn) => closeFn('retry')
              },
              {
                icon: 'copy', flxSnipTooltip: 'Copy to Clipboard',
                onClick: (closeFn, dataUrl) => {
                  fetch(dataUrl).then(r => r.blob()).then(blob => {
                    try { navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch(e) {}
                    closeFn('copy'); 
                    setTimeout(() => cleanupAndResolve(null), 50); 
                  });
                }
              },
              {
                icon: 'import', flxSnipTooltip: 'Download',
                onClick: (closeFn, dataUrl) => {
                  const a = document.createElement('a'); a.href = dataUrl; a.download = `Flux_Snip_${Date.now()}.png`; a.click();
                  closeFn('download'); 
                  setTimeout(() => cleanupAndResolve(null), 50);
                }
              },
              {
                icon: 'success', iconColor: '#2ed573', flxSnipTooltip: 'Confirm',
                onClick: (closeFn, dataUrl) => {
                  closeFn('confirm'); 
                  setTimeout(() => cleanupAndResolve({ base64: dataUrl, coords, type }), 50);
                }
              }
            ]
          });
        };

        const cleanupAndResolve = (result) => { 
          window.removeEventListener('keydown', onEsc, { capture: true }); 
          if (onScroll) window.removeEventListener('scroll', onScroll, { passive: true });
          if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
          destroy(); resolve(result); 
        };

        const processFinalCrop = async (action) => {
          let finalBase64 = null;
          let finalCoords = { x: pageBox.x + (pageBox.w/2), y: Math.max(0, pageBox.y) + (pageBox.h/2) };

          if (activeMode === 'live') {
            overlayHost.style.display = 'none';
            toolbar.style.display = 'none';
            if (editToolbar) editToolbar.style.display = 'none';
            const loadMsg = showSniperLoader('Rendering Selection...');
            await new Promise(r => setTimeout(r, 50));
            
            try {
              await loadHtml2Canvas();
              const c = await html2canvas(document.documentElement, {
                x: pageBox.x, y: pageBox.y, width: pageBox.w, height: pageBox.h,
                useCORS: true, allowTaint: false, logging: false, backgroundColor: '#ffffff',
                ignoreElements: (el) => el.id === 'flux-sniper-host' || el.id === 'flux-sniper-loader'
              });
              finalBase64 = c.toDataURL('image/jpeg', 0.9);
            } catch (e) {
              console.error('[FluxSniper] Live crop failed:', e);
            } finally {
              if (loadMsg) loadMsg.remove();
            }
          } else {
            const c = document.createElement('canvas');
            const vBox = { x: pageBox.x - window.scrollX, y: pageBox.y - window.scrollY, w: pageBox.w, h: pageBox.h };
            const rx = frameData.width / uiCanvas.width; const ry = frameData.height / uiCanvas.height;
            c.width = vBox.w * rx; c.height = vBox.h * ry;
            c.getContext('2d').drawImage(frameData.canvas, vBox.x * rx, vBox.y * ry, c.width, c.height, 0, 0, c.width, c.height);
            finalBase64 = c.toDataURL('image/jpeg', 0.9);
          }

          if (!finalBase64) { cleanupAndResolve(null); return; }

          if (action === 'copy') {
            fetch(finalBase64).then(r => r.blob()).then(blob => {
              try { navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch(e) {}
              cleanupAndResolve(null);
            });
          } else if (action === 'download') {
            const a = document.createElement('a'); a.href = finalBase64; a.download = `Flux_Snip_${Date.now()}.png`; a.click();
            cleanupAndResolve(null);
          } else if (action === 'resolve') {
            cleanupAndResolve({ base64: finalBase64, coords: finalCoords, type: 'region' });
          }
        };

        const getHandleAt = (x, y) => {
          if (appState !== 'editing') return null;
          const vBox = { x: pageBox.x - window.scrollX, y: pageBox.y - window.scrollY, w: pageBox.w, h: pageBox.h };
          const t = 12; const near = (v, target) => Math.abs(v - target) <= t;
          const n = near(y, vBox.y), s = near(y, vBox.y + vBox.h), w = near(x, vBox.x), e = near(x, vBox.x + vBox.w);
          
          if (n && w) return 'nw'; if (n && e) return 'ne'; if (s && w) return 'sw'; if (s && e) return 'se';
          if (n && x > vBox.x && x < vBox.x+vBox.w) return 'n'; if (s && x > vBox.x && x < vBox.x+vBox.w) return 's';
          if (w && y > vBox.y && y < vBox.y+vBox.h) return 'w'; if (e && y > vBox.y && y < vBox.y+vBox.h) return 'e';
          return null;
        };

        const updateBoxBounds = (px, py) => {
          if (appState === 'drawing') {
            if (Math.abs(px - drawStartPage.x) > 10 || Math.abs(py - drawStartPage.y) > 10) {
              hoveredPageRect = null; hoveredElement = null;
            }
            pageBox.x = Math.min(drawStartPage.x, px); pageBox.y = Math.min(drawStartPage.y, py);
            pageBox.w = Math.abs(px - drawStartPage.x); pageBox.h = Math.abs(py - drawStartPage.y);
          } else if (appState === 'resizing') {
            const dx = px - drawStartPage.x; const dy = py - drawStartPage.y;
            if (activeHandle.includes('n')) { pageBox.y += dy; pageBox.h -= dy; }
            if (activeHandle.includes('s')) { pageBox.h += dy; }
            if (activeHandle.includes('w')) { pageBox.x += dx; pageBox.w -= dx; }
            if (activeHandle.includes('e')) { pageBox.w += dx; }
            drawStartPage = { x: px, y: py };
          }
        };

        drawOverlay();

        onScroll = () => {
          if (appState === 'drawing' || appState === 'resizing') updateBoxBounds(lastMouseView.x + window.scrollX, lastMouseView.y + window.scrollY);
          drawOverlay();
          if (appState === 'editing') updateToolbar();
        };
        window.addEventListener('scroll', onScroll, { passive: true });

        uiCanvas.addEventListener('mousedown', e => {
          if (e.button !== 0) return;
          const handle = getHandleAt(e.clientX, e.clientY);
          lastMouseView = { x: e.clientX, y: e.clientY };
          
          const px = e.clientX + window.scrollX; const py = e.clientY + window.scrollY;

          if (handle) {
            appState = 'resizing'; activeHandle = handle;
            drawStartPage = { x: px, y: py };
            editToolbar.style.opacity = '0';
          } else {
            appState = 'drawing'; pageBox = { x: 0, y: 0, w: 0, h: 0 };
            drawStartPage = { x: px, y: py };
            editToolbar.style.display = 'none';
          }
        });

        uiCanvas.addEventListener('mousemove', e => {
          lastMouseView = { x: e.clientX, y: e.clientY };
          const px = e.clientX + window.scrollX; const py = e.clientY + window.scrollY;
          
          if (appState === 'idle' || appState === 'editing') {
            autoScrollSpeed = { x: 0, y: 0 };
            const handle = getHandleAt(e.clientX, e.clientY);
            const cursors = { nw: 'nwse', ne: 'nesw', sw: 'nesw', se: 'nwse', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };
            uiCanvas.style.cursor = handle ? `${cursors[handle]}-resize` : 'crosshair';
            
            if (appState === 'idle') {
              overlayHost.style.pointerEvents = 'none';
              const target = document.elementFromPoint(e.clientX, e.clientY);
              overlayHost.style.pointerEvents = 'auto';
              
              hoveredElement = (target && !['HTML', 'BODY'].includes(target.tagName)) ? target : null;
              if (hoveredElement) {
                const rect = hoveredElement.getBoundingClientRect();
                hoveredPageRect = { x: rect.x + window.scrollX, y: rect.y + window.scrollY, w: rect.width, h: rect.height };
              } else hoveredPageRect = null;
            }
          } else {
            const margin = 50;
            const maxS = 40;
            
            autoScrollSpeed.x = 0; autoScrollSpeed.y = 0;

            if (e.clientX < margin) autoScrollSpeed.x = -maxS * (1 - Math.max(0, e.clientX) / margin);
            else if (e.clientX > window.innerWidth - margin) autoScrollSpeed.x = maxS * (1 - Math.max(0, window.innerWidth - e.clientX) / margin);

            if (e.clientY < margin) autoScrollSpeed.y = -maxS * (1 - Math.max(0, e.clientY) / margin);
            else if (e.clientY > window.innerHeight - margin) autoScrollSpeed.y = maxS * (1 - Math.max(0, window.innerHeight - e.clientY) / margin);

            if ((autoScrollSpeed.x !== 0 || autoScrollSpeed.y !== 0) && !autoScrollRaf) {
              autoScrollRaf = requestAnimationFrame(handleAutoScroll);
            }

            updateBoxBounds(px, py);
          }
          drawOverlay();
        });

        uiCanvas.addEventListener('mouseup', async () => {
          autoScrollSpeed = { x: 0, y: 0 };
          if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }

          if (appState === 'idle' || appState === 'editing') return;
          
          if (appState === 'drawing' && pageBox.w < 10 && pageBox.h < 10) {
            if (hoveredElement && hoveredPageRect && hoveredPageRect.w > 10) {
              const vBox = { x: hoveredPageRect.x - window.scrollX, y: hoveredPageRect.y - window.scrollY, w: hoveredPageRect.w, h: hoveredPageRect.h };
              const isClipped = vBox.x < 0 || vBox.y < 0 || vBox.x + vBox.w > window.innerWidth || vBox.y + vBox.h > window.innerHeight;
              
              if (isClipped && (activeMode === 'dom')) {
                appState = 'processing';
                toolbar.style.display = 'none';
                if (editToolbar) editToolbar.style.display = 'none';
                
                const elLoader = showSniperLoader('Rendering Large Element...');
                await loadHtml2Canvas();
                html2canvas(hoveredElement, { useCORS: true, allowTaint: false, logging: false, backgroundColor: '#ffffff' })
                  .then(elCanvas => {
                      if (elLoader) elLoader.remove();
                      cleanupAndResolve({ 
                        base64: elCanvas.toDataURL('image/jpeg', 0.9), 
                        coords: { x: hoveredPageRect.x + (hoveredPageRect.w/2), y: Math.max(0, hoveredPageRect.y) + (hoveredPageRect.h/2) }, 
                        type: 'element-deep' 
                      });
                  }).catch(() => { if (elLoader) elLoader.remove(); cleanupAndResolve(null); });
                return; 
              }

              pageBox = { x: hoveredPageRect.x, y: hoveredPageRect.y, w: hoveredPageRect.w, h: hoveredPageRect.h };
              if (!config.interactive) return processFinalCrop('resolve');
            } else {
              appState = 'idle'; drawOverlay(); return;
            }
          }

          if (pageBox.w < 0) { pageBox.x += pageBox.w; pageBox.w = Math.abs(pageBox.w); }
          if (pageBox.h < 0) { pageBox.y += pageBox.h; pageBox.h = Math.abs(pageBox.h); }

          if (!config.interactive) return processFinalCrop('resolve');

          appState = 'editing';
          editToolbar.style.opacity = '1';
          drawOverlay();
          updateToolbar();
        });
      });
    }

    return { init, startSnip };
  })();

  FluxKit.capture.ocr ??= (function () {
    'use strict';

    let isScriptLoaded = false;
    let cachedWorker = null;
    let currentLangs = '';

    function loadTesseract() {
      return new Promise((resolve, reject) => {
        if (isScriptLoaded && window.Tesseract) return resolve();

        const CACHE_KEY = 'flux_tesseract_cache';
        const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

        const cached = GM_getValue(CACHE_KEY, null);
        if (cached && cached.code && Date.now() - cached.timestamp < CACHE_TTL) {
          try {
            document.head.appendChild(FluxKit.utils.createHTMLElement('script', { textContent: cached.code }));
            isScriptLoaded = true;
            setTimeout(resolve, 50);
            return;
          } catch (e) {
            console.warn('[FluxOCR] Cache injection failed, falling back to CDN.');
          }
        }

        GM_xmlhttpRequest({
          method: 'GET', url: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', anonymous: true,
          onload: res => {
            if (res.status === 200) {
              try {
                GM_setValue(CACHE_KEY, { code: res.responseText, timestamp: Date.now() });
                document.head.appendChild(FluxKit.utils.createHTMLElement('script', { textContent: res.responseText }));
                isScriptLoaded = true;
                setTimeout(resolve, 50);
              } catch (err) {
                reject(err);
              }
            } else {
              reject(new Error('HTTP Error fetching Tesseract'));
            }
          },
          onerror: () => reject(new Error('Network error')),
          onabort: () => reject(new Error('Aborted')),
        });
      });
    }

    async function getWorker(langs) {
      await loadTesseract();
      if (cachedWorker && currentLangs !== langs) {
        await cachedWorker.terminate();
        cachedWorker = null;
      }
      if (!cachedWorker) {
        cachedWorker = await Tesseract.createWorker(langs);
        currentLangs = langs;
      }
      return cachedWorker;
    }

    async function cloudRecognize(base64Image, tesseractLangs) {
      return new Promise(resolve => {
        // Map Tesseract language codes to OCR.Space language codes
        let cloudLang = 'eng';
        if (tesseractLangs.includes('jpn')) cloudLang = 'jpn';
        else if (tesseractLangs.includes('chi_sim')) cloudLang = 'chs';
        else if (tesseractLangs.includes('chi_tra')) cloudLang = 'cht';
        else if (tesseractLangs.includes('kor')) cloudLang = 'kor';

        const formData = new FormData();

        formData.append('apikey', 'K89849503488957');
        formData.append('language', cloudLang);
        formData.append('isOverlayRequired', 'false');
        formData.append('base64Image', base64Image);

        GM_xmlhttpRequest({
          method: 'POST', url: 'https://api.ocr.space/parse/image', data: formData,
          onload: res => {
            try {
              const json = JSON.parse(res.responseText);
              if (json.ParsedResults && json.ParsedResults.length > 0) resolve(json.ParsedResults[0].ParsedText);
              else resolve(null);
            } catch (e) {
              console.error('[FluxOCR] Cloud Parse Error:', e);
              resolve(null);
            }
          },
          onerror: () => resolve(null),
        });
      });
    }

    async function recognize(base64Image, langs = 'eng') {
      try {
        const worker = await getWorker(langs);
        const { data: { text } } = await worker.recognize(base64Image);
        return text;
      } catch (error) {
        console.warn('[FluxOCR] Local Tesseract blocked by CSP. Auto-falling back to Cloud OCR Engine...');
        return await cloudRecognize(base64Image, langs);
      }
    }

    return { recognize };
  })();

  FluxKit.capture.speech ??= (function () {
    'use strict';

    let audioCtx = null, currentSource = null, audioQueue = [], isPlaying = false;

    function chunkText(text, maxLength = 150) {
      const sentences = text.match(/[^.!?,\n]+[.!?,\n]*/g) || [text];
      const chunks = [];
      let currentChunk = '';

      for (let sentence of sentences) {
        // If a single segment without punctuation is STILL too long,
        // forcibly split it by spaces so the Google API doesn't throw a 400/404 error.
        if (sentence.length > maxLength) {
          if (currentChunk) { chunks.push(currentChunk.trim()); currentChunk = ''; }

          const words = sentence.split(' ');
          for (const word of words) {
            if ((currentChunk + ' ' + word).length > maxLength) {
              if (currentChunk) chunks.push(currentChunk.trim());
              currentChunk = word;
            } else {
              currentChunk += (currentChunk ? ' ' : '') + word;
            }
          }
          continue;
        }

        // Normal punctuation-based chunking
        if ((currentChunk + sentence).length > maxLength) {
          if (currentChunk) chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk += sentence;
        }
      }

      if (currentChunk) chunks.push(currentChunk.trim());

      return chunks.filter(Boolean);
    }

    function fetchAudioArrayBuffer(url) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET', url: url, responseType: 'arraybuffer', anonymous: true,
          onload: res => {
            if (res.status === 200) resolve(res.response);
            else reject(new Error(`HTTP ${res.status}`));
          },
          onerror: () => reject(new Error('Network Error')),
          onabort: () => reject(new Error('Aborted')),
        });
      });
    }

    async function playNextInQueue() {
      if (audioQueue.length === 0) { isPlaying = false; return; }

      isPlaying = true;
      const target = audioQueue.shift();

      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        let arrayBuffer;
        if (target.startsWith('http')) {
          arrayBuffer = await fetchAudioArrayBuffer(target);
        } else {
          throw new Error('Invalid audio target URL');
        }

        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        currentSource = audioCtx.createBufferSource();
        currentSource.buffer = audioBuffer;
        currentSource.connect(audioCtx.destination);

        currentSource.onended = () => {
          currentSource.disconnect();
          currentSource = null;
          playNextInQueue();
        };

        currentSource.start(0);

      } catch (e) {
        console.warn('[FluxTranslate] Failed to fetch or play TTS chunk:', e);
        playNextInQueue();
      }
    }

    function speak(text, options = {}) {
      const config = { lang: 'en', audioUrl: null, ...options };
      stop();
      if (config.audioUrl) {
        audioQueue.push(config.audioUrl);
        playNextInQueue();
        return;
      }
      speakGoogle(text, config.lang);
    }

    function speakGoogle(text, lang) {
      if (!text) return;
      const cleanText = text.replace(/\s+/g, ' ').trim();
      const chunks = chunkText(cleanText, 150);
      const newUrls = chunks.map(chunk => `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(chunk)}`);
      audioQueue.push(...newUrls);
      if (!isPlaying) playNextInQueue();
    }

    function stop() {
      audioQueue = []; 
      isPlaying = false;
      if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource.disconnect();
        currentSource = null;
      }
    }

    return { speak, stop };
  })();

  FluxKit.help.register('capture', {
    _summary: 'A comprehensive Input & Data Acquisition layer for capturing text, pixels, and audio.',
    _description: 'Provides decoupled utilities for DOM text scraping, screen snipping, optical character recognition (OCR), and text-to-speech (TTS). Designed to act as the primary interface between user input and background processing engines.',

    langs: {
      _summary: 'A dictionary of supported language codes mapped to their human-readable names.',
      _command: 'FluxKit.capture.langs[code]',
      _example: "console.log(FluxKit.capture.langs['zh-CN']); // Returns 'Chinese (Simplified, China)'"
    },

    text: {
      _summary: 'Captures selected text from the DOM, seamlessly piercing Shadow DOM boundaries.',
      
      getSelectedText: {
        _summary: 'Synchronously retrieves the currently selected text across the entire page.',
        _description: 'Intelligently traverses through standard DOM selections, open Shadow DOM boundaries, and active input/textarea fields to reliably extract user-highlighted text.',
        _command: 'FluxKit.capture.text.getSelectedText()',
        _returns: 'String (The trimmed selected text, or an empty string)'
      },
      
      init: {
        _summary: 'Initializes the global text scraper listeners (keyboard and mouse).',
        _command: 'FluxKit.capture.text.init(onLookupCallback, config?)',
        _arguments: {
          'onLookupCallback': { Type: 'Function', Required: 'Yes', Description: 'Fired when text is successfully captured. Receives (text, mouseCoords).' },
          'config': { Type: 'Object', Required: 'No', Description: 'Trigger configuration overrides.' }
        },
        _config: {
          'keyboardTrigger': { Type: 'String', Default: "'ctrl+shift+e'", Description: 'Keyboard shortcut to trigger extraction.' },
          'mouseModifier': { Type: 'String', Default: "'alt'", Description: 'Modifier key required for mouse-click extraction.' },
          'normalizeOS': { Type: 'Boolean', Default: 'true', Description: 'Normalizes cross-platform keys (e.g. mapping Mac Cmd to Ctrl).' },
          'mouseButton': { Type: 'Number', Default: '0', Description: 'Target mouse button (0 = left, 1 = middle, 2 = right).' }
        }
      }
    },

    screen: {
      _summary: 'A native-feeling snipping tool that captures pixel-perfect base64 images of the viewport.',
      _description: 'Features a dual-engine architecture: a frictionless DOM mode (html2canvas) and a foolproof Native mode (getDisplayMedia) to automatically bypass DRM and cross-origin restrictions. Includes a hover engine for 1-click DOM element cropping, full-page stitching, and an interactive editing phase.',
      
      init: {
        _summary: 'Binds the global hotkey listener to trigger the snipping UI.',
        _command: 'FluxKit.capture.screen.init(callback, options?)',
        _arguments: {
          'callback': { Type: 'Function', Required: 'Yes', Description: 'Fired when the user presses the trigger shortcut. Receives the KeyboardEvent.' },
          'options': { Type: 'Object', Required: 'No', Description: 'Shortcut configuration overrides.' }
        },
        _config: {
          'keyboardTrigger': { Type: 'String', Default: "'ctrl+shift+x'", Description: 'Shortcut to trigger the snippet tool.' },
          'normalizeOS': { Type: 'Boolean', Default: 'true', Description: 'Normalizes Mac/Windows modifier keys.' }
        }
      },
      
      startSnip: {
        _summary: 'Launches the interactive screen-cropping overlay.',
        _description: 'Freezes the viewport and provides advanced cropping tools. Supports drag-to-crop, 1-click auto-element cropping, full-page capturing, and an interactive resizing phase with native clipboard integration.',
        _command: 'await FluxKit.capture.screen.startSnip(options?)',
        _arguments: {
          'options': { Type: 'Object', Required: 'No', Description: 'Capture engine configuration.' }
        },
        _config: {
          'mode': { Type: 'String', Default: "'dom'", Description: "Forces the capture engine. 'dom' uses html2canvas (fast, no prompts). 'native' uses the screen-share API (DRM-safe)." },
          'interactive': { Type: 'Boolean', Default: 'true', Description: "If true, opens a floating toolbar allowing users to resize the box, download, or copy to clipboard before resolving." }
        },
        _returns: 'Promise<Object | null> { base64: String, coords: { x: Number, y: Number } }'
      }
    },

    ocr: {
      _summary: 'A smart optical character recognition engine for extracting text from images.',
      _description: 'Features a hybrid architecture: heavily caches Tesseract.js locally for instant processing, with a seamless cloud-API fallback to bypass strict Content-Security-Policies (like on YouTube).',
      
      recognize: {
        _summary: 'Processes a base64 image and returns the recognized text.',
        _command: 'await FluxKit.capture.ocr.recognize(base64Image, langs?)',
        _arguments: {
          'base64Image': { Type: 'String', Required: 'Yes', Description: 'A base64 encoded image string (e.g., from capture.screen.startSnip).' },
          'langs': { Type: 'String', Required: 'No', Default: "'eng'", Description: 'Tesseract language codes joined by "+", e.g., "eng+jpn".' }
        },
        _returns: 'Promise<String | null> (The extracted text, or null if processing fails)'
      }
    },

    speech: {
      _summary: 'A robust Text-To-Speech (TTS) audio queue manager.',
      _description: 'Handles ultra-long strings by chunking them via punctuation/spaces to bypass API length limits, sequencing them flawlessly into a native HTML5 Audio stream.',
      
      speak: {
        _summary: 'Starts playing TTS audio for the provided text, automatically canceling any currently playing audio.',
        _command: 'FluxKit.capture.speech.speak(text, options?)',
        _arguments: {
          'text': { Type: 'String', Required: 'Yes', Description: 'The text string to read aloud.' },
          'options': { Type: 'Object', Required: 'No', Description: 'Playback configuration.' }
        },
        _config: {
          'lang': { Type: 'String', Default: "'en'", Description: 'Language code for the TTS voice.' },
          'audioUrl': { Type: 'String', Default: 'null', Description: 'Direct URL to bypass standard TTS and play a custom audio file.' }
        }
      },
      
      stop: {
        _summary: 'Immediately halts audio playback and flushes the queue.',
        _description: 'Safely unloads the audio element to prevent Firefox NS_BINDING_ABORTED network panics.',
        _command: 'FluxKit.capture.speech.stop()'
      }
    }
  }, { isNative: true });
})();