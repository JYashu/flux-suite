// ==UserScript==
// @name         FHP: Diff WorkSpace
// @description  Multi-tab, persistent diff workspace for FluxHub — line and inline char-level diffs, JSON formatting, JWT/Base64/URL payload decoding, drag-and-drop file loading, and hunk-level merge controls. Workspaces are domain-scoped and synced via FluxKit.cache (IndexedDB).
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @author       JYashu
// @license      Apache-2.0
// @match        *://*/*
// @match        file:///*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// ==/UserScript==
/* global FluxKit */

(function() {
  'use strict';

  if (window.self !== window.top) return;

  const PLUGIN_ID = 'flx-diff-workspace';
  const DIFF_STATE_KEY = 'FLX_DIFF_INDEX';
  const TOAST_NS = { namespace: 'flx-notes' };
  let activeThemeKey = 'auto';

  const { createLogger, createHTMLElement, safeHTML } = FluxKit.utils;

  const { logMessage, logError } = createLogger('FluxHub', 'DiffWs');

  const showNotification = (msg, config) => FluxKit.ui.showNotification(msg, { ...config, ...TOAST_NS });

  const diffState = FluxKit.state.register('diff-ws');

  const diffCache = FluxKit.cache.register('diff_workspace', {
    storage: 'indexeddb',
    policy: 'none'
  });

  const DiffStorage = {
    getIndex: () => diffState.get(DIFF_STATE_KEY, []),

    saveIndex: (indexArray) => diffState.set(DIFF_STATE_KEY, indexArray),

    createInstance: async () => {
      const index = DiffStorage.getIndex();

      if (index.length >= 10) {
        const oldest = index.sort((a, b) => a.lastModified - b.lastModified)[0];
        await DiffStorage.deleteInstance(oldest.id);
      }

      let maxNum = 0;
      index.forEach(t => {
        const match = t.title.match(/Workspace (\d+)/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      });

      const newId = `diff_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newEntry = {
        id: newId,
        domain: window.location.hostname,
        title: `Diff WorkSpace ${maxNum + 1}`,
        lastModified: Date.now()
      };

      await diffCache.set(newId, { left: '', right: '' });

      const updatedIndex = DiffStorage.getIndex();
      updatedIndex.push(newEntry);
      DiffStorage.saveIndex(updatedIndex);
      return newEntry;
    },

    deleteInstance: async (id) => {
      const index = DiffStorage.getIndex().filter(entry => entry.id !== id);
      DiffStorage.saveIndex(index);
      await diffCache.delete(id);
    },

    sweepOrphans: async () => {
      try {
        const localKeys = await diffCache.engine.keys();
        const globalIndex = DiffStorage.getIndex();
        const validIds = new Set(globalIndex.map(e => e.id));

        for (const key of localKeys) {
          if (!validIds.has(key)) {
            await diffCache.delete(key);
            logMessage(`Garbage Collector swept orphaned payload: ${key}`);
          }
        }
      } catch (e) {}
    }
  };

  DiffStorage.sweepOrphans();

  const DiffEngine = {
    compute: (oldArr, newArr) => {
      let start = 0;
      let endA = oldArr.length - 1;
      let endB = newArr.length - 1;

      while (start <= endA && start <= endB && oldArr[start] === newArr[start]) start++;
      while (endA >= start && endB >= start && oldArr[endA] === newArr[endB]) { endA--; endB--; }

      const prefix = oldArr.slice(0, start).map(val => ({ type: 'unchanged', value: val }));
      const suffix = oldArr.slice(endA + 1).map(val => ({ type: 'unchanged', value: val }));

      const midOld = oldArr.slice(start, endA + 1);
      const midNew = newArr.slice(start, endB + 1);

      if (midOld.length === 0 && midNew.length === 0) return [...prefix, ...suffix];
      if (midOld.length === 0) return [...prefix, ...midNew.map(val => ({ type: 'added', value: val })), ...suffix];
      if (midNew.length === 0) return [...prefix, ...midOld.map(val => ({ type: 'removed', value: val })), ...suffix];

      const calculateMatrix = (arrA, arrB) => {
        const matrix = Array(arrA.length + 1).fill(null).map(() => new Int32Array(arrB.length + 1));
        for (let i = 1; i <= arrA.length; i++) {
          for (let j = 1; j <= arrB.length; j++) {
            if (arrA[i - 1] === arrB[j - 1]) matrix[i][j] = matrix[i - 1][j - 1] + 1;
            else matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
          }
        }

        let i = arrA.length, j = arrB.length;
        const result = [];
        while (i > 0 || j > 0) {
          if (i > 0 && j > 0 && arrA[i - 1] === arrB[j - 1]) {
            result.unshift({ type: 'unchanged', value: arrA[i - 1] });
            i--; j--;
          } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
            result.unshift({ type: 'added', value: arrB[j - 1] });
            j--;
          } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
            result.unshift({ type: 'removed', value: arrA[i - 1] });
            i--;
          }
        }
        return result;
      };

      const maxMatrixSize = 250000; // 500x500 lines max per matrix
      let result = [];

      if (midOld.length * midNew.length > maxMatrixSize) {
        const chunkSize = 500; // Break into smaller chunks to prevent call-stack/memory lockup
        for (let i = 0; i < Math.max(midOld.length, midNew.length); i += chunkSize) {
          const chunkOld = midOld.slice(i, i + chunkSize);
          const chunkNew = midNew.slice(i, i + chunkSize);
          result = result.concat(calculateMatrix(chunkOld, chunkNew));
        }
      } else {
        result = calculateMatrix(midOld, midNew);
      }

      return [...prefix, ...result, ...suffix];
    },

    diffLines: (oldText, newText) => DiffEngine.compute(oldText ? oldText.split('\n') : [], newText ? newText.split('\n') : []),

    diffChars: (oldStr, newStr) => {
      // Safety threshold: Skip inline diffing for massive single lines (e.g., minified files)
      if (oldStr.length > 5000 || newStr.length > 5000) return null;

      const raw = DiffEngine.compute(oldStr.split(''), newStr.split(''));

      // Group contiguous characters to optimize DOM nodes
      const grouped = [];
      raw.forEach(token => {
        const last = grouped[grouped.length - 1];
        if (last && last.type === token.type) last.value += token.value;
        else grouped.push({ ...token });
      });
      return grouped;
    }
  };

  const PayloadDecoder = {
    isJWT: (str) => /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/.test(str),
    isBase64: (str) => /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(str),

    safeAtob: (b64) => {
      const binString = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
      return decodeURIComponent(binString.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    },

    process: (rawText) => {
      const text = rawText.trim();
      if (!text) return rawText;

      if (PayloadDecoder.isJWT(text)) {
        try {
          const parts = text.split('.');
          return JSON.stringify({
            header: JSON.parse(PayloadDecoder.safeAtob(parts[0])),
            payload: JSON.parse(PayloadDecoder.safeAtob(parts[1])),
            signature: "[HIDDEN_BINARY_SIGNATURE]"
          }, null, 2);
        } catch (e) {}
      }

      if (text.includes('%')) {
        try {
          const decoded = decodeURIComponent(text);
          if (decoded !== text) {
            try { return JSON.stringify(JSON.parse(decoded), null, 2); }
            catch (e) { return decoded; }
          }
        } catch (e) {}
      }

      if (PayloadDecoder.isBase64(text)) {
        try {
          const decoded = PayloadDecoder.safeAtob(text);
          try { return JSON.stringify(JSON.parse(decoded), null, 2); }
          catch (e) { return decoded; }
        } catch (e) {}
      }

      throw new Error("Unrecognized payload format");
    }
  };

  class DiffWorkspace {
    static activeId = null;
    static host = null;
    static shadowRoot = null;
    static overlay = null;
    static headerControlsWrap = null;
    static tabBarWrap = null;
    static bodyWrap = null;

    static applyTheme(element, themeKey) {
      const theme = FluxKit.theme.get(themeKey);
      const cssVars = {
        '--omni-bg': FluxKit.theme.createAlphaColor(theme.bg, 0.95),
        '--omni-bg-solid': FluxKit.theme.createAlphaColor(theme.bg, 1),
        '--omni-bg-light': FluxKit.theme.createAlphaColor(theme.bg, 0.4),
        '--omni-input-bg': theme.inputBg,
        '--omni-text': theme.text,
        '--omni-btn-text': theme.btnTextColor,
        '--omni-muted-text': FluxKit.theme.createAlphaColor(theme.text, 0.6),
        '--omni-border': theme.border,
        '--omni-separator': theme.separator,
        '--omni-hover': theme.hoverBg,
        '--omni-font': theme.fontFamily,
        '--omni-btn-bg': theme.hoverBg,
        '--omni-btn-hover': theme.btnHoverBg,
        '--omni-accent': theme.accentBg,
        '--omni-muted-accent': FluxKit.theme.createAlphaColor(theme.accentBg, 0.6),
        '--omni-accent-text': theme.accentText,
        '--omni-success': theme.success,
        '--omni-danger': theme.danger,
        '--omni-shadow': theme.boxShadow
      };
      for (const [key, value] of Object.entries(cssVars)) element.style.setProperty(key, value);
      FluxKit.ui.initTooltips({
        ...theme,
        rootElement: this.shadowRoot,
        attribute: 'diffWs',
        border: `1px solid ${theme.accentBg}`,
        delay: 500
      });
      FluxKit.ui.initNotification({
        ...theme,
        ...TOAST_NS,
        rootElement: this.shadowRoot,
      });
    }

    static open(targetId = null, themeKey = activeThemeKey) {
      activeThemeKey = themeKey;
      let index = DiffStorage.getIndex();

      if (index.length === 0) {
        DiffStorage.createInstance().then(newEntry => DiffWorkspace.open(newEntry.id, themeKey));
        return;
      }

      DiffWorkspace.activeId = targetId || index[index.length - 1].id;

      if (!DiffWorkspace.host || !document.getElementById('flx-diff-host')) {
        DiffWorkspace.initShell();
      } else {
        DiffWorkspace.applyTheme(DiffWorkspace.overlay, activeThemeKey);
        if (DiffWorkspace.bringToFront) DiffWorkspace.bringToFront();
      }

      DiffWorkspace.renderContent();
    }

    static initShell() {
      DiffWorkspace.host = document.createElement('div');
      DiffWorkspace.host.id = 'flx-diff-host';
      DiffWorkspace.host.style.cssText = 'all: initial; display: block; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; overflow: visible; pointer-events: none;';
      DiffWorkspace.shadowRoot = DiffWorkspace.host.attachShadow({ mode: 'open' });

      DiffWorkspace.overlay = createHTMLElement('div', {
        id: 'flx-diff-workspace',
        style: {
          pointerEvents: 'auto', position: 'fixed',
          width: '80vw', height: '80vh', left: '10vw', top: '10vh',
          background: 'var(--omni-bg-solid)', color: 'var(--omni-text)',
          fontFamily: 'var(--omni-font, system-ui, sans-serif)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)', borderRadius: '8px',
          border: '1px solid var(--omni-border)', overflow: 'hidden'
        }
      });

      DiffWorkspace.applyTheme(DiffWorkspace.overlay, activeThemeKey);

      const header = createHTMLElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--omni-bg-solid)', borderBottom: '1px solid var(--omni-border)', alignItems: 'center', cursor: 'grab' }
      });

      const titleWrap = createHTMLElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', pointerEvents: 'none' } });
      titleWrap.innerHTML = safeHTML(`<span style="color: var(--omni-accent);">${FluxKit.ui.getIcon('code')}</span> <span style="font-size: 14px; font-weight: bold;">Diff WS</span>`);

      DiffWorkspace.headerControlsWrap = createHTMLElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginRight: '90px' } });
      header.appendChild(titleWrap); header.appendChild(DiffWorkspace.headerControlsWrap);

      DiffWorkspace.tabBarWrap = createHTMLElement('div', {
        style: { display: 'flex', gap: '2px', padding: '8px 8px 0 8px', background: 'var(--omni-bg-solid)', borderBottom: '1px solid var(--omni-separator)', overflowX: 'auto' }
      });

      DiffWorkspace.bodyWrap = createHTMLElement('div', {
        style: { display: 'flex', flexDirection: 'column', flex: '1 1 0%', minHeight: '0', background: 'var(--omni-bg)', position: 'relative', overflow: 'hidden' }
      });

      DiffWorkspace.overlay.appendChild(header);
      DiffWorkspace.overlay.appendChild(DiffWorkspace.tabBarWrap);
      DiffWorkspace.overlay.appendChild(DiffWorkspace.bodyWrap);

      DiffWorkspace.shadowRoot.appendChild(DiffWorkspace.overlay);
      document.body.appendChild(DiffWorkspace.host);

      const controlIconCfg = { iconTop: 12 };
      const windowControls = FluxKit.utils.attachWindowControls(DiffWorkspace.overlay, header, {
        minWidth: 400, minHeight: 300, minimize: true, maximize: true, close: true,
        close: controlIconCfg, maximize: controlIconCfg, minimize: controlIconCfg,
        onClose: () => {
          DiffWorkspace.host.remove();
          DiffWorkspace.host = null;
          DiffWorkspace.overlay = null;
        },
      });

      DiffWorkspace.bringToFront = windowControls.bringToFront;
      DiffWorkspace.maximize = () => {
        if (DiffWorkspace.overlay.classList.contains('flxn-minimized') && windowControls.toggleMinimize) windowControls.toggleMinimize();
      };
    }

    static renderContent() {
      const index = DiffStorage.getIndex();
      const activeTab = index.find(t => t.id === DiffWorkspace.activeId) || index[0];

      DiffWorkspace.tabBarWrap.innerHTML = safeHTML('');
      index.forEach(tab => {
        const isSelected = tab.id === activeTab.id;
        const tabEl = createHTMLElement('div', {
          style: {
            padding: '6px 12px', background: isSelected ? 'var(--omni-hover)' : 'transparent',
            borderTopLeftRadius: '6px', borderTopRightRadius: '6px',
            color: isSelected ? 'var(--omni-text)' : 'var(--omni-muted-text)',
            fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
            border: isSelected ? '1px solid var(--omni-separator)' : '1px solid transparent', borderBottom: 'none'
          },
          eventListener: {
            click: (e) => {
              if (e.target.isContentEditable || isSelected) return;
              DiffWorkspace.open(tab.id, activeThemeKey);
            }
          }
        });

        const titleSpan = createHTMLElement('span', {
          textContent: tab.title,
          diffWsTooltip: 'Double-click to rename',
          style: { outline: 'none', minWidth: '40px', display: 'inline-block', whiteSpace: 'nowrap' },
          eventListener: {
            dblclick: (e) => {
              e.stopPropagation();
              titleSpan.contentEditable = 'true';
              titleSpan.focus();
              document.execCommand('selectAll', false, null);
            },
            blur: (e) => saveTitle(e.target.textContent),
            keydown: (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                titleSpan.blur();
              }
            }
          }
        });

        const saveTitle = (newTitle) => {
          titleSpan.contentEditable = 'false';
          const t = newTitle.trim() || 'Untitled Workspace';
          titleSpan.textContent = t;
          const idx = DiffStorage.getIndex();
          const tabEntry = idx.find(x => x.id === tab.id);
          if (tabEntry && tabEntry.title !== t) {
            tabEntry.title = t;
            DiffStorage.saveIndex(idx);
          }
        };

        tabEl.appendChild(titleSpan);

        const delBtn = createHTMLElement('span', {
          icon: 'close', style: { opacity: '0.5', fontSize: '10px' },
          eventListener: {
            click: async (e) => {
              e.stopPropagation();
              await DiffStorage.deleteInstance(tab.id);
              const newIndex = DiffStorage.getIndex();
              if (newIndex.length > 0) DiffWorkspace.open(newIndex[0].id, activeThemeKey);
              else {
                if (DiffWorkspace.host) DiffWorkspace.host.remove();
                DiffWorkspace.host = null;
                DiffWorkspace.overlay = null;
              }
            },
            mouseenter: e => { e.target.style.opacity = '1' },
            mouseleave: e => { e.target.style.opacity = '0.5' }
          }
        });
        tabEl.appendChild(delBtn);
        DiffWorkspace.tabBarWrap.appendChild(tabEl);
      });

      const hasReachedMaxLimit = DiffStorage.getIndex().length >= 10;
      const newTabBtn = createHTMLElement('div', {
        icon: 'plus',
        style: { padding: '6px 12px', color: hasReachedMaxLimit ? 'var(--omni-muted-text)' : 'var(--omni-text)', opacity: 0.7, cursor: hasReachedMaxLimit ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center' },
        eventListener: async () => {
          if (hasReachedMaxLimit) return;
          const newEntry = await DiffStorage.createInstance();
          DiffWorkspace.open(newEntry.id, activeThemeKey);
        }
      });
      DiffWorkspace.tabBarWrap.appendChild(newTabBtn);

      DiffWorkspace.bodyWrap.innerHTML = safeHTML('');
      DiffWorkspace.headerControlsWrap.innerHTML = safeHTML('');

      if (activeTab.domain !== window.location.hostname) {
        const redirectUI = createHTMLElement('div', {
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: '12px', padding: '24px' }
        });
        redirectUI.appendChild(createHTMLElement('div', { textContent: 'Cross-Domain Workspace', style: { fontSize: '18px', fontWeight: 'bold' } }));
        redirectUI.appendChild(createHTMLElement('div', { textContent: `This workspace lives on ${activeTab.domain}. Navigate to that domain to view it.`, style: { fontSize: '13px', color: 'var(--omni-muted-text)' } }));
        const openBtn = createHTMLElement('button', {
          icon: 'externalLink', textContent: `Open ${activeTab.domain}`,
          style: {
            display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 16px', marginTop: '8px',
            background: 'var(--omni-input-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)',
            borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s'
          },
          eventListener: {
            click: () => GM_openInTab(`https://${activeTab.domain}`, { active: true, insert: true }),
            mouseenter: (e) => { e.target.style.background = 'var(--omni-hover)' },
            mouseleave: (e) => { e.target.style.background = 'var(--omni-input-bg)' }
          }
        });
        redirectUI.appendChild(openBtn);
        DiffWorkspace.bodyWrap.appendChild(redirectUI);
        return;
      }

      const editorWrap = createHTMLElement('div', {
        style: { display: 'flex', flex: '1 1 0%', minHeight: '0', width: '100%', background: 'var(--omni-border)', gap: '1px', position: 'relative' }
      });

      const createPane = (placeholderText) => {
        const pane = createHTMLElement('div', { style: { flex: '1 1 0%', display: 'flex', minWidth: '0', minHeight: '0', background: 'var(--omni-bg)', overflow: 'hidden', position: 'relative' } });
        const gutter = createHTMLElement('div', {
          style: { width: '40px', background: 'var(--omni-input-bg)', color: 'var(--omni-muted-text)', textAlign: 'right', padding: '16px 8px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.5', overflow: 'hidden', userSelect: 'none', borderRight: '1px solid var(--omni-border)', whiteSpace: 'pre' },
          textContent: '1'
        });
        const textarea = createHTMLElement('textarea', {
          placeholder: placeholderText, spellcheck: 'false',
          style: { flex: '1 1 0%', minWidth: '0', background: 'transparent', color: 'var(--omni-text)', border: 'none', padding: '16px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.5', resize: 'none', outline: 'none', whiteSpace: 'pre', overflow: 'auto' }
        });

        const dropOverlay = createHTMLElement('div', {
          innerHTML: `<div style="font-size: 32px; margin-bottom: 8px;">${FluxKit.ui.getIcon('export')}</div><div>Drop file to load</div>`,
          style: { position: 'absolute', inset: '0', background: 'color-mix(in srgb, var(--omni-accent) 95%, transparent)', color: 'var(--omni-accent-text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 'bold', zIndex: '10', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.15s ease', backdropFilter: 'blur(2px)' }
        });

        let dragCounter = 0;
        pane.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; if (dragCounter === 1) dropOverlay.style.opacity = '1'; });
        pane.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        pane.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter === 0) dropOverlay.style.opacity = '0'; });
        pane.addEventListener('drop', (e) => {
          e.preventDefault(); dragCounter = 0; dropOverlay.style.opacity = '0';
          const file = e.dataTransfer.files[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) return;
          const reader = new FileReader();
          reader.onload = (event) => { textarea.value = event.target.result; textarea.dispatchEvent(new Event('input')); };
          reader.readAsText(file);
        });

        pane.appendChild(gutter); pane.appendChild(textarea); pane.appendChild(dropOverlay);
        return { pane, gutter, textarea };
      };

      const leftArea = createPane('Paste original text here...');
      const rightArea = createPane('Paste modified text here...');

      const updateLineNumbers = (ta, gutter) => { gutter.textContent = Array.from({ length: ta.value.split('\n').length || 1 }, (_, i) => i + 1).join('\n') };

      let isSyncingLeftEd = false, isSyncingRightEd = false;
      leftArea.textarea.addEventListener('scroll', () => {
        leftArea.gutter.scrollTop = leftArea.textarea.scrollTop;
        if (!isSyncingLeftEd) { isSyncingRightEd = true; rightArea.textarea.scrollTop = leftArea.textarea.scrollTop; rightArea.textarea.scrollLeft = leftArea.textarea.scrollLeft; }
        isSyncingLeftEd = false;
      });
      rightArea.textarea.addEventListener('scroll', () => {
        rightArea.gutter.scrollTop = rightArea.textarea.scrollTop;
        if (!isSyncingRightEd) { isSyncingLeftEd = true; leftArea.textarea.scrollTop = rightArea.textarea.scrollTop; leftArea.textarea.scrollLeft = rightArea.textarea.scrollLeft; }
        isSyncingRightEd = false;
      });

      let saveTimeout;
      const handleInput = () => {
        updateLineNumbers(leftArea.textarea, leftArea.gutter); updateLineNumbers(rightArea.textarea, rightArea.gutter);
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
          await diffCache.set(activeTab.id, { left: leftArea.textarea.value, right: rightArea.textarea.value });
          const idx = DiffStorage.getIndex();
          const tabEntry = idx.find(x => x.id === activeTab.id);
          if (tabEntry) { tabEntry.lastModified = Date.now(); DiffStorage.saveIndex(idx); }
        }, 400);
      };

      leftArea.textarea.addEventListener('input', handleInput); rightArea.textarea.addEventListener('input', handleInput);

      editorWrap.appendChild(leftArea.pane); editorWrap.appendChild(rightArea.pane);

      const loader = createHTMLElement('div', {
        icon: 'hourglassSpin',
        style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--omni-bg-solid)', zIndex: '10', fontSize: '24px', color: 'var(--omni-accent)' }
      });
      editorWrap.appendChild(loader);
      DiffWorkspace.bodyWrap.appendChild(editorWrap);

      diffCache.get(activeTab.id).then(payload => {
        if (payload) {
          leftArea.textarea.value = payload.left || ''; rightArea.textarea.value = payload.right || '';
          updateLineNumbers(leftArea.textarea, leftArea.gutter); updateLineNumbers(rightArea.textarea, rightArea.gutter);
        }
      }).catch(err => logError('Hydration Error:', err, { __v: 1 })).finally(() => {
        loader.style.transition = 'opacity 0.2s ease'; loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 200);
      });

      const renderWrap = createHTMLElement('div', {
        style: { display: 'none', flex: '1 1 0%', minHeight: '0', width: '100%', background: 'var(--omni-border)', gap: '1px', position: 'relative' }
      });

      const leftRender = createHTMLElement('div', { style: { flex: '1 1 0%', minWidth: '0', overflowY: 'auto', overflowX: 'hidden', background: 'var(--omni-bg)', position: 'relative' } });
      const rightRender = createHTMLElement('div', { style: { flex: '1 1 0%', minWidth: '0', overflowY: 'auto', overflowX: 'hidden', background: 'var(--omni-bg)', position: 'relative' } });

      const leftSpacer = createHTMLElement('div', { style: { width: '1px' } });
      const rightSpacer = createHTMLElement('div', { style: { width: '1px' } });
      leftRender.appendChild(leftSpacer); rightRender.appendChild(rightSpacer);

      renderWrap.appendChild(leftRender); renderWrap.appendChild(rightRender);
      DiffWorkspace.bodyWrap.appendChild(renderWrap);

      const poolSize = 100; // Render enough to cover a 4k monitor plus buffer
      const leftPool = [], rightPool = [];
      const ROW_HEIGHT = 24;

      const createVirtualRow = () => {
        const row = createHTMLElement('div', { style: { display: 'flex', height: `${ROW_HEIGHT}px`, position: 'absolute', width: '100%', top: '-100px' } });
        const numWrap = createHTMLElement('div', { style: { width: '40px', flexShrink: '0', padding: '0 8px', textAlign: 'right', color: 'var(--omni-muted)', background: 'var(--omni-input-bg)', borderRight: '1px solid var(--omni-border)', fontSize: '12px', lineHeight: `${ROW_HEIGHT}px`, userSelect: 'none' } });
        const contentWrap = createHTMLElement('div', { style: { padding: '0 12px', color: 'var(--omni-text)', fontSize: '13px', lineHeight: `${ROW_HEIGHT}px`, whiteSpace: 'pre', overflowX: 'auto', flexGrow: '1', minWidth: '0' } });
        row.appendChild(numWrap); row.appendChild(contentWrap);

        // Cache flags to prevent redundant DOM updates
        row._num = numWrap; row._content = contentWrap; row._btn = null; row._mappedIndex = -1;
        return row;
      };

      for (let i = 0; i < poolSize; i++) {
        const lNode = createVirtualRow(); const rNode = createVirtualRow();
        leftPool.push(lNode); rightPool.push(rNode);
        leftRender.appendChild(lNode); rightRender.appendChild(rNode);
      }

      let virtualLeftMap = []; let virtualRightMap = []; let currentHunks = [];

      const updateVirtualDOM = () => {
        const scrollTop = leftRender.scrollTop;
        const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
        const endIndex = Math.min(virtualLeftMap.length, startIndex + poolSize);

        for (let i = startIndex; i < endIndex; i++) {
          const lData = virtualLeftMap[i]; const rData = virtualRightMap[i];

          const lNode = leftPool[i % poolSize]; const rNode = rightPool[i % poolSize];

          const applyDataToNode = (node, data, dataIndex) => {
            if (!data || node._mappedIndex === dataIndex) return;

            node._mappedIndex = dataIndex;
            node.style.top = `${dataIndex * ROW_HEIGHT}px`;
            node.style.background = data.type === 'added' ? 'var(--omni-success)' : data.type === 'removed' ? 'var(--omni-danger)' : 'transparent';
            node.style.opacity = data.type === 'ghost' ? '0' : '1';

            if (data.type !== 'ghost') {
              if (data.type !== 'unchanged') node.style.backgroundColor = `color-mix(in srgb, ${node.style.background} 15%, transparent)`;
              node._num.textContent = data.num || '';

              if (Array.isArray(data.content)) {
                node._content.innerHTML = safeHTML('');
                data.content.forEach(token => {
                  const span = document.createElement('span'); span.textContent = token.value;
                  if (token.type === 'added') span.style.backgroundColor = 'color-mix(in srgb, var(--omni-success) 40%, transparent)';
                  else if (token.type === 'removed') span.style.backgroundColor = 'color-mix(in srgb, var(--omni-danger) 40%, transparent)';
                  if (token.type !== 'unchanged') span.style.borderRadius = '2px';
                  node._content.appendChild(span);
                });
              } else {
                node._content.textContent = data.content;
              }

              if (node._btn) { node._btn.remove(); node._btn = null; }
              if (data.action) {
                const btn = createHTMLElement('div', {
                  innerHTML: FluxKit.ui.getIcon(data.action.icon) || (data.action.icon === 'chevronRight' ? '→' : '←'),
                  diffWsTooltip: data.action.title,
                  style: {
                    position: 'absolute', top: '2px',
                    [data.action.icon === 'chevronRight' ? 'right' : 'left']: '8px',
                    background: 'var(--omni-bg-solid)', color: 'var(--omni-text)',
                    border: '1px solid var(--omni-border)', borderRadius: '4px',
                    width: '20px', height: '20px', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', cursor: 'pointer', zIndex: '5',
                    boxShadow: 'var(--omni-shadow)', transition: 'background 0.2s', fontSize: '12px'
                  },
                  eventListener: {
                    click: data.action.onClick,
                    mouseenter: e => e.target.style.background = 'var(--omni-hover)',
                    mouseleave: e => e.target.style.background = 'var(--omni-bg-solid)'
                  }
                });
                node.appendChild(btn); node._btn = btn;
              }
            } else {
              node.style.background = 'var(--omni-bg-light)'; node.style.pointerEvents = 'none';
              if (node._btn) { node._btn.remove(); node._btn = null; }
              node._content.textContent = ''; node._num.textContent = '';
            }
          };

          applyDataToNode(lNode, lData, i); applyDataToNode(rNode, rData, i);
        }
      };

      let isSyncingLeft = false, isSyncingRight = false;
      leftRender.addEventListener('scroll', () => {
        if (isSyncingLeft) { isSyncingLeft = false; return; }
        isSyncingRight = true;
        rightRender.scrollTop = leftRender.scrollTop;
        rightRender.scrollLeft = leftRender.scrollLeft;
        updateVirtualDOM();
      });
      rightRender.addEventListener('scroll', () => {
        if (isSyncingRight) { isSyncingRight = false; return; }
        isSyncingLeft = true;
        leftRender.scrollTop = rightRender.scrollTop;
        leftRender.scrollLeft = rightRender.scrollLeft;
        updateVirtualDOM();
      });

      const renderDiffs = () => {
        const textL = leftArea.textarea.value.replace(/\r/g, '');
        const textR = rightArea.textarea.value.replace(/\r/g, '');
        const diffs = DiffEngine.diffLines(textL, textR);

        currentHunks = []; let currentHunk = null;
        diffs.forEach(diff => {
          if (diff.type === 'unchanged') { if (currentHunk) { currentHunks.push(currentHunk); currentHunk = null; } currentHunks.push({ type: 'unchanged', lines: [diff.value] }); }
          else { if (!currentHunk) currentHunk = { type: 'change', left: [], right: [] }; if (diff.type === 'removed') currentHunk.left.push(diff.value); if (diff.type === 'added') currentHunk.right.push(diff.value); }
        });
        if (currentHunk) currentHunks.push(currentHunk);

        virtualLeftMap = []; virtualRightMap = [];
        let leftLineNum = 1, rightLineNum = 1;

        currentHunks.forEach((hunk, hunkIdx) => {
          if (hunk.type === 'unchanged') {
            hunk.lines.forEach(line => {
              virtualLeftMap.push({ num: leftLineNum++, content: line, type: 'unchanged' });
              virtualRightMap.push({ num: rightLineNum++, content: line, type: 'unchanged' });
            });
          } else {
            const maxLines = Math.max(hunk.left.length, hunk.right.length);
            for (let i = 0; i < maxLines; i++) {
              const leftLine = hunk.left[i], rightLine = hunk.right[i];
              let leftAction = null, rightAction = null;

              if (i === 0) {
                if (hunk.left.length > 0) {
                  leftAction = { icon: 'chevronRight', title: 'Merge Right', onClick: () => applyMerge(hunkIdx, 'right') };
                }
                if (hunk.right.length > 0) {
                  rightAction = { icon: 'chevronLeft', title: 'Merge Left', onClick: () => applyMerge(hunkIdx, 'left') };
                }
              }

              let leftContent = leftLine, rightContent = rightLine;

              if (leftLine !== undefined && rightLine !== undefined) {
                const inlineDiff = DiffEngine.diffChars(leftLine, rightLine);
                if (inlineDiff) {
                  leftContent = inlineDiff.filter(t => t.type !== 'added');
                  rightContent = inlineDiff.filter(t => t.type !== 'removed');
                }
              }

              if (leftLine !== undefined) virtualLeftMap.push({ num: leftLineNum++, content: leftContent, type: 'removed', action: leftAction });
              else virtualLeftMap.push({ type: 'ghost', action: leftAction });

              if (rightLine !== undefined) virtualRightMap.push({ num: rightLineNum++, content: rightContent, type: 'added', action: rightAction });
              else virtualRightMap.push({ type: 'ghost', action: rightAction });
            }
          }
        });

        leftPool.forEach(n => { n.style.top = '-100px'; n._mappedIndex = -1; });
        rightPool.forEach(n => { n.style.top = '-100px'; n._mappedIndex = -1; });

        const totalHeight = `${virtualLeftMap.length * ROW_HEIGHT}px`;
        leftSpacer.style.height = totalHeight; rightSpacer.style.height = totalHeight;

        updateVirtualDOM();
      };

      const applyMerge = (hunkIdx, direction) => {
        const h = currentHunks[hunkIdx];
        if (direction === 'right') h.right = [...h.left]; else h.left = [...h.right];
        leftArea.textarea.value = currentHunks.flatMap(x => x.type === 'unchanged' ? x.lines : x.left).join('\n');
        rightArea.textarea.value = currentHunks.flatMap(x => x.type === 'unchanged' ? x.lines : x.right).join('\n');
        handleInput(); renderDiffs();
      };

      let isCompareMode = false;

      const buildHeaderBtn = (icon, text, title, onClick) => {
        const bgColor = icon === '' ? 'var(--omni-accent)' : 'var(--omni-input-bg)';
        const hoverBg = icon === '' ? 'var(--omni-hover)' : 'var(--omni-omni-hover)';
        const txtColor = icon === '' ? 'var(--omni-btn-text)' : 'var(--omni-text)';
        const hvrTxtColor = 'var(--omni-text)';
        return createHTMLElement('button', {
          icon, textContent: text, title,
          style: { display: 'flex', gap: '6px', alignItems: 'center', padding: '6px 12px', background: bgColor, color: txtColor, border: '1px solid var(--omni-border)', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s', minWidth: text === 'Compare' ? '85px' : 'auto', justifyContent: 'center' },
          eventListener: { click: onClick, mouseenter: e => { if(!e.target.textContent.includes('Copied')) { e.target.style.background = hoverBg; e.target.style.color = hvrTxtColor; }}, mouseleave: e => { if(!e.target.textContent.includes('Copied')) { e.target.style.background = bgColor; e.target.style.color = txtColor;}} }
        });
      }

      const formatBtn = buildHeaderBtn('json', 'Format JSON', 'Format raw JSON', () => {
        const formatPane = (area) => {
          if (!area.textarea.value.trim()) return;
          try { area.textarea.value = JSON.stringify(JSON.parse(area.textarea.value), null, 2); updateLineNumbers(area.textarea, area.gutter); }
          catch (e) { const origBg = area.textarea.style.background; area.textarea.style.background = 'color-mix(in srgb, var(--omni-danger) 15%, transparent)'; setTimeout(() => { area.textarea.style.background = origBg }, 300); }
        };
        formatPane(leftArea); formatPane(rightArea); handleInput(); if (isCompareMode) renderDiffs();
      });

      const decodeBtn = buildHeaderBtn('unlock', 'Decode', 'Decode JWTs, Base64, etc', () => {
        let mutated = false;
        const processPane = (area) => {
          if (!area.textarea.value.trim()) return;
          try {
            const result = PayloadDecoder.process(area.textarea.value);
            if (result !== area.textarea.value) {
              area.textarea.value = result; updateLineNumbers(area.textarea, area.gutter); mutated = true;
              const origBg = area.textarea.style.background; area.textarea.style.background = 'color-mix(in srgb, var(--omni-success) 15%, transparent)'; setTimeout(() => { area.textarea.style.background = origBg }, 300);
            }
          } catch (e) { const origBg = area.textarea.style.background; area.textarea.style.background = 'color-mix(in srgb, var(--omni-danger) 15%, transparent)'; setTimeout(() => { area.textarea.style.background = origBg }, 300); }
        };
        processPane(leftArea); processPane(rightArea); if (mutated) { handleInput(); if (isCompareMode) renderDiffs(); }
      });

      const swapBtn = buildHeaderBtn('swap', 'Swap', 'Swap Left & Right panes', () => {
        const temp = leftArea.textarea.value;
        leftArea.textarea.value = rightArea.textarea.value;
        rightArea.textarea.value = temp;
        updateLineNumbers(leftArea.textarea, leftArea.gutter);
        updateLineNumbers(rightArea.textarea, rightArea.gutter);
        handleInput();
        if (isCompareMode) renderDiffs();
      });

      const copyBtn = buildHeaderBtn('copy', 'Copy Result', 'Copy right pane', async (e) => {
        try {
          await navigator.clipboard.writeText(rightArea.textarea.value);
          const orig = e.target.innerHTML; e.target.innerHTML = safeHTML(`${FluxKit.ui.getIcon('success')} Copied!`); e.target.style.color = 'var(--omni-success)'; e.target.style.borderColor = 'var(--omni-success)';
          setTimeout(() => { e.target.innerHTML = safeHTML(orig); e.target.style.color = 'var(--omni-text)'; e.target.style.borderColor = 'var(--omni-border)'; }, 2000);
        } catch (err) {}
      });

      const saveBtn = buildHeaderBtn('download', 'Save', 'Download right pane as a file', (e) => {
        if (!rightArea.textarea.value) return;
        const blob = new Blob([rightArea.textarea.value], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `diff_export_${Date.now()}.txt`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const orig = e.target.innerHTML; e.target.innerHTML = safeHTML(`${FluxKit.ui.getIcon('success')} Saved!`); e.target.style.color = 'var(--omni-success)'; e.target.style.borderColor = 'var(--omni-success)';
        setTimeout(() => { e.target.innerHTML = safeHTML(orig); e.target.style.color = 'var(--omni-text)'; e.target.style.borderColor = 'var(--omni-border)'; }, 2000);
      });

      const compareBtn = buildHeaderBtn('', 'Compare', '', (e) => {
        isCompareMode = !isCompareMode;
        if (isCompareMode) {
          e.target.textContent = 'Edit Mode'; e.target.style.background = 'var(--omni-hover)';
          editorWrap.style.display = 'none'; renderWrap.style.display = 'flex'; renderDiffs();
        } else {
          e.target.textContent = 'Compare'; e.target.style.background = 'var(--omni-accent)';
          editorWrap.style.display = 'flex'; renderWrap.style.display = 'none';
        }
      });

      DiffWorkspace.headerControlsWrap.appendChild(formatBtn); DiffWorkspace.headerControlsWrap.appendChild(decodeBtn);
      DiffWorkspace.headerControlsWrap.appendChild(copyBtn); DiffWorkspace.headerControlsWrap.appendChild(compareBtn);
    }
  }

  const registerPlugin = () => {
    FluxKit.ipc.broadcast('register-command', {
      id: PLUGIN_ID, prefix: '> diff',
      title: 'Launch Diff WorkSpace',
      icon: 'code', type: 'view',
      acceptsArgs: true
    });
  };

  registerPlugin();
  FluxKit.ipc.listen('search-bar-ready', registerPlugin);

  FluxKit.ipc.listen('flxhub-mount-view', (payload) => {
    if (payload.pluginId !== PLUGIN_ID) return;

    if (payload.themeKey) activeThemeKey = payload.themeKey;
    const host = document.getElementById('flx-hub-host');
    const slot = host?.shadowRoot?.getElementById(payload.targetId);
    if (!slot) return;

    const searchTerm = (payload.query || '').toLowerCase();
    const index = DiffStorage.getIndex();

    const filtered = index.filter(t => t.title.toLowerCase().includes(searchTerm));

    const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px' } });

    const wsNodes = [];
    let subIndex = 0;

    if (filtered.length === 0) {
      container.appendChild(createHTMLElement('div', {
        textContent: 'No workspaces match your search.',
        style: { padding: '12px', textAlign: 'center', color: 'var(--omni-muted-text)', fontSize: '13px' }
      }));
    } else {
      filtered.forEach((ws, idx) => {
        const item = createHTMLElement('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', cursor: 'pointer', borderRadius: '6px',
            border: '1px solid var(--omni-border)', background: 'var(--omni-bg)',
            color: 'var(--omni-text)', fontSize: '13px', transition: 'all 0.1s'
          },
          eventListener: {
            click: () => {
              DiffWorkspace.open(ws.id, activeThemeKey);
              FluxKit.ipc.broadcast('flxhub-hide', {}, true);
            },
            mouseenter: () => { subIndex = idx; updateSubSelection(); }
          }
        });

        const dateStr = new Date(ws.lastModified).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        item.innerHTML = safeHTML(`
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--omni-accent);">${FluxKit.ui.getIcon('code')}</span>
            <span style="font-weight: 500;">${ws.title}</span>
          </div>
          <div style="font-size: 11px; color: var(--omni-muted-text);">${dateStr}</div>
        `);

        wsNodes.push(item);
        container.appendChild(item);
      });
    }

    const updateSubSelection = () => {
      wsNodes.forEach((node, idx) => {
        if (idx === subIndex) {
          node.style.borderColor = 'var(--omni-muted-text)';
          node.style.background = 'var(--omni-hover)';
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
          node.style.borderColor = 'var(--omni-border)';
          node.style.background = 'var(--omni-bg)';
        }
      });
    };

    if (wsNodes.length > 0) updateSubSelection();

    const actions = [
      FluxKit.ui.omni.Button('plus', 'New Workspace', (e) => {
        e.stopPropagation();
        DiffStorage.createInstance().then((newEntry) => {
          DiffWorkspace.open(newEntry.id, activeThemeKey);
          FluxKit.ipc.broadcast('flxhub-hide', {}, true);
        });
      })
    ];

    slot.innerHTML = safeHTML('');
    slot.appendChild(FluxKit.ui.omni.DetailCard(container, actions));

    slot.addEventListener('flx-remote-keydown', (e) => {
      const { key } = e.detail;
      if (wsNodes.length === 0) return;

      if (key === 'ArrowDown') {
        e.preventDefault();
        subIndex = Math.min(subIndex + 1, wsNodes.length - 1);
        updateSubSelection();
      }
      else if (key === 'ArrowUp') {
        e.preventDefault();
        subIndex = Math.max(subIndex - 1, 0);
        updateSubSelection();
      }
      else if (key === 'Enter') {
        if (wsNodes[subIndex]) {
          e.preventDefault();
          wsNodes[subIndex].click();
        }
      }
    });
  });

  FluxKit.ipc.listen('flxhub-execute-view', (payload) => {
    if (payload.pluginId === PLUGIN_ID) {
      const searchTerm = (payload.args || []).join(' ').toLowerCase();
      const index = DiffStorage.getIndex();
      const filtered = index.filter(t => t.title.toLowerCase().includes(searchTerm));

      if (filtered.length > 0) DiffWorkspace.open(filtered[0].id, activeThemeKey);
      else DiffWorkspace.open(null, activeThemeKey);
    }
  });
})();