// ==UserScript==
// @name         FluxKit Core
// @namespace    https://github.com/JYashu
// @version      1.0.0
// @description  A high-performance UI toolkit.
// @author       JYashu
// @license      Apache-2.0
// ==/UserScript==
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

  const SANDBOX = window;
  const PAGE = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : SANDBOX;

  (function setupGlobalState() {
    if (!PAGE.__FLUX_LOGGER_CORE__) {
      PAGE.__FLUX_LOGGER_CORE__ = {
        logs: {}, customLimits: {}, customStates: {},
        maxLogs: 500, debugMaxLogs: 1000,
        logEnabled: false, debugEnabled: false
      };
    }
  })();

  const CORE = PAGE.__FLUX_LOGGER_CORE__;

  SANDBOX.FluxKit = SANDBOX.FluxKit || {};
  FluxKit.utils = FluxKit.utils || {};
  FluxKit.loader = FluxKit.loader || {};
  FluxKit.ui = FluxKit.ui || {};

  SANDBOX.FluxKit = SANDBOX.FluxKit || {};

  const emojiMap = { dolphin:'🐬', sloth:'🦥', mammoth:'🦣', elephant:'🐘', ladybug:'🐞', bat:'🦇', llama:'🦙', swan:'🦢', eagle:'🦅', snail:'🐌', butterfly:'🦋', flamingo:'🦩', whale:'🐋', orca:'🐳', seal:'🦭', octopus:'🐙', sauropod:'🦕', shell:'🐚', jellyfish:'🪼', dodo:'🦤', web:'🕸️', spider:'🕷️', cat:'𓃠', fish:'𓆡', turtle:'𓆉', moai:'🗿', alien:'👾', kiss:'💋', genie:'🧞‍♂️', gear:'⚙' };

  FluxKit.ui.icons ??= {
    pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.74L9.6 6a3 3 0 0 1 5.8 0l.6 4.74A2 2 0 0 0 17.43 12.5l.57.5v2H6v-2l.57-.5A2 2 0 0 0 8 10.74z"/></svg>',
    pinned: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.74L9.6 6a3 3 0 0 1 5.8 0l.6 4.74A2 2 0 0 0 17.43 12.5l.57.5v2H6v-2l.57-.5A2 2 0 0 0 8 10.74z"/></svg>',
    export: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    import: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    sync: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    preview: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    camera: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    merge: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    bookmark: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    clear: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
    zap: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    save: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    document: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    ban: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    hourglass: `<svg class="hourglass-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"></path><path d="M5 2h14"></path><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path><polygon class="sand-top" points="7.5,6 16.5,6 12,11.5" fill="currentColor" stroke="none"></polygon><polygon class="sand-bottom" points="12,12.5 7.5,18 16.5,18" fill="currentColor" stroke="none"></polygon><line class="sand-stream" x1="12" y1="11.5" x2="12" y2="18" stroke="currentColor" stroke-width="1.5"></line></svg>`,
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 12v3a1 1 0 0 0 1 1"></path><path d="M12 8h.01"></path></svg>',
    externalLink: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
    undo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
    redo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>',
    eraser: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
    scribble: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    textCaret: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2" /><path d="M14 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2" /></svg>',
    image: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
    crop: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path></svg>',
    focus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path></svg>',
    maximize: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>',
    dots: `<span style="display:flex;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg></span>`,
    pointer: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>`,
    chevronRight: `<span style="display:flex;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></span>`,
    edit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`,
    minus: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"></line></svg>`,
    square: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`,
    circle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>`,
  };

  let ttPolicy = {
    createHTML: (string) => string,
    createScriptURL: (url) => url,
    createScript: (script) => script
  };

  if (window.isSecureContext && window.trustedTypes && window.trustedTypes.createPolicy) {
    try {
      ttPolicy = window.trustedTypes.createPolicy('default', ttPolicy);
    } catch (e1) {
      try {
        ttPolicy = window.trustedTypes.createPolicy('flxkit-policy', ttPolicy);
      } catch (e) {
        console.warn('[FluxKit] TrustedTypes policy restricted by CSP, using default passthrough.');
      }
    }
  }

  function safeHTML(html) {
    return ttPolicy.createHTML(html || '');
  }

  FluxKit.ttPolicy ??= ttPolicy;
  FluxKit.utils.safeHTML ??= safeHTML;

  /**
   * Executes a function while temporarily disabling Trusted Types
   * for innerHTML assignments.
   */
  FluxKit.utils.withTTPatched ??= (callback) => {
    if (!window.trustedTypes) return callback();

    const sinks = [
      { proto: Element.prototype, prop: 'innerHTML' },
      { proto: Element.prototype, prop: 'outerHTML' },
      { proto: Element.prototype, prop: 'insertAdjacentHTML', isMethod: true }
    ];

    const originals = {};

    sinks.forEach(({ proto, prop, isMethod }) => {
      if (isMethod) {
        originals[prop] = proto[prop];
        proto[prop] = function(position, text) {
          const safeText = typeof text === 'string' ? ttPolicy.createHTML(text) : text;
          return originals[prop].call(this, position, safeText);
        };
      } else {
        const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
        if (descriptor) {
          originals[prop] = descriptor.set;
          Object.defineProperty(proto, prop, {
            set: function(val) {
              const safeVal = typeof val === 'string' ? ttPolicy.createHTML(val) : val;
              originals[prop].call(this, safeVal);
            },
            configurable: true
          });
        }
      }
    });

    try {
      return callback();
    } finally {
      // Restore everything
      sinks.forEach(({ proto, prop, isMethod }) => {
        if (isMethod) {
          proto[prop] = originals[prop];
        } else if (originals[prop]) {
          Object.defineProperty(proto, prop, {
            set: originals[prop],
            configurable: true
          });
        }
      });
    }
  };

  FluxKit.exposeToPage ??= (moduleName = null) => {
    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : SANDBOX;

    if (targetWindow === SANDBOX) {
      console.warn('[FluxKit] Cannot expose to page: unsafeWindow is not available.');
      return false;
    }

    targetWindow.FluxKit ??= {};

    // Expose the entire toolkit
    if (!moduleName) {
      Object.keys(FluxKit).forEach(key => {
        targetWindow.FluxKit[key] ??= FluxKit[key];
      });
      return true;
    }
    
    // Expose only a specific, requested module (e.g., 'utils')
    if (FluxKit[moduleName]) {
      targetWindow.FluxKit[moduleName] ??= FluxKit[moduleName];
      return true;
    }
    
    console.error(`[FluxKit] Failed to expose: Module '${moduleName}' does not exist.`);
    return false;
  };

  FluxKit.help ??= PAGE.FluxKit?.help || (function () {
    const registry = {};
    const META_KEYS = new Set([ '_summary', '_description', '_command', '_arguments', '_config', '_example', '_returns', '_list' ]);

    const resolvePath = (path, createIfMissing = false) => {
      if (!path) return registry;
      const keys = path.split('.');
      let current = registry;

      for (const key of keys) {
        const lowerKey = key.toLowerCase();
        let actualKey = Object.keys(current).find(k => k.toLowerCase() === lowerKey);
        if (createIfMissing && !actualKey) {
          actualKey = key;
          current[actualKey] ??= {};
        }
        if (!actualKey || !current[actualKey]) return null;
        current = current[actualKey];
      }
      return current;
    };

    const helpRouter = (query = '') => {
      if (!query) {
        console.group(
          '%c🚀 FluxKit Help - Main Menu',
          'font-size: 14px; font-weight: bold; color: #4CAF50;',
        );
        console.info('Run FluxKit.help("module.method") to explore deeper.');

        const toc = {};
        for (const key in registry) {
          const moduleNode = registry[key];

          // Dynamically extract all child keys (ignoring the private _meta object)
          const children = Object.keys(moduleNode).filter(k => k !== '_meta');
          const isNative = moduleNode._meta?.isNative;

          toc[key] = {
            'Origin': isNative ? '🧩 FluxKit Core' : '📦 Script Add-on',
            'Summary': moduleNode._meta?._summary || moduleNode._meta?._description || 'No description provided.',
            'Sub-Modules / Methods': children.length > 0 ? children.join(', ') : 'None',
          };
        }

        console.table(toc);
        console.groupEnd();
        return;
      }

      const target = resolvePath(query);

      if (!target || !target._meta) {
        console.warn(`[FluxKit Docs] No documentation found for "${query}".`);
        return;
      }

      const meta = target._meta;
      console.group(
        `%c📘 FluxKit Docs - [ ${query} ] ${meta.isNative ? '(🧩 Core)' : '(📦 Add-on)'}`,
        'font-size: 14px; font-weight: bold; color: #42A5F5;',
      );

      if (meta._summary) {
        console.info(`%c${meta._summary}`, 'font-size: 13px; font-weight: bold;');
      }

      if (meta._description) {
        console.info(meta._description);
      }

      if (meta._command) {
        console.info('%cAccess Path:', 'color: #BA68C8; font-weight: bold;');
        console.log(`%c${meta._command}`, 'font-family: monospace; font-size: 13px; background: rgba(128, 128, 128, 0.15); padding: 2px 6px; border-radius: 4px;');
      }

      let argsToRender = meta._arguments;

      if (meta._config && !argsToRender) {
        const configDescription = meta._config._description || 'Configuration object. See detailed breakdown below.';
        argsToRender = {
          'config': {
            Type: 'Object',
            Required: 'No',
            Description: configDescription
          }
        };
      }

      if (argsToRender) {
        console.info('%cArguments:', 'color: #FF9800; font-weight: bold;');
        console.table(argsToRender);
      }

      if (meta._config) {
        console.info('%cConfiguration Object Properties:', 'color: #EC407A; font-weight: bold;');
        if (meta._config._description) {
          console.log(`%cℹ️ ${meta._config._description}`, 'font-style: italic; color: #00ACC1; margin-bottom: 4px;');
        }
        const tableData = {};
        for (const key in meta._config) {
          if (key !== '_description') {
            tableData[key] = meta._config[key];
          }
        }
        console.table(tableData);
      }

      if (meta._returns) {
        console.info('%cReturns:', 'color: #4CAF50; font-weight: bold;');
        console.info(`%c${meta._returns}`, 'font-style: italic;');
      }

      const listData = meta._list.items;
      if (listData) {
        console.groupCollapsed('%cQuick List / Data (Click to Expand)', 'color: #FF7043; font-weight: bold; cursor: pointer;');
        if (meta._list._description) {
          console.log(`%cℹ️ ${meta._config._description}`, 'font-style: italic; color: #00ACC1; margin-bottom: 4px;');
        }
        
        if (Array.isArray(listData)) {
          const formattedList = {};
          listData.forEach((item, index) => {
             const key = `[ ${(index + 1).toString().padStart(2, '0')} ]`;
             formattedList[key] = { 'Value': item };
          });
          console.table(formattedList);
          
        } else if (typeof listData === 'object') {
          if (listData._summary) console.info(`%c${listData._summary}`, 'font-style: italic; color: #9E9E9E;');
          if (listData._command) {
            console.log(`%c${listData._command}`, 'font-family: monospace; font-size: 13px; background: rgba(128, 128, 128, 0.15); padding: 2px 6px; border-radius: 4px;');
          }
          if (listData._returns) {
            console.log(`%cReturns: %c${listData._returns}`, 'color: #4CAF50; font-weight: bold;', 'font-family: monospace; color: inherit;');
          }
          
          if (!listData._summary && !listData._command && !listData._returns) {
            console.table(listData);
          }
        } else {
          console.log(listData);
        }

        console.groupEnd();
      }

      const childrenNames = Object.keys(target).filter(k => k !== '_meta');
      if (childrenNames.length > 0) {
        console.info('%cAvailable Sub-modules / Methods:', 'color: #FF9800; font-weight: bold;');
        const hasAnyGrandChildren = childrenNames.some(child => {
          return Object.keys(target[child]).filter(k => k !== '_meta').length > 0;
        });
        const subToc = {};
        childrenNames.forEach(child => {
          const cMeta = target[child]._meta || {};
          const usage = cMeta._command || child;

          let paramList = [];
          if (cMeta._arguments) {
              for (const [argName, argData] of Object.entries(cMeta._arguments)) {
                  const isOpt = (argData.Required && argData.Required.toLowerCase() === 'no') ? '?' : '';
                  const type = argData.Type ? `: ${argData.Type}` : '';
                  paramList.push(`${argName}${isOpt}${type}`);
              }
          }
          if (cMeta._config) paramList.push(`options: Object`);
          const rowData = {
            'Usage': usage,
            'Parameters': paramList.length > 0 ? paramList.join(', ') : 'None'
          };
          if (hasAnyGrandChildren) {
            const grandChildren = Object.keys(target[child]).filter(k => k !== '_meta');
            rowData['Sub-Modules / Methods'] = grandChildren.length > 0 ? grandChildren.join(', ') : 'None';
          }
          rowData['Summary'] = cMeta._summary || cMeta._description || 'No description provided.';
          subToc[child] = rowData;
        });
        console.table(subToc);
      }

      if (meta._example) {
        console.info('%cExample Usage:', 'font-style: italic; color: #00ACC1;');
        console.log(meta._example);
      }

      console.groupEnd();
    };

    helpRouter.register = function (path, data, options = {}) {
      const isNative = options.isNative === true;
      const rootNode = resolvePath(path, true);
      const attachData = (node, payload) => {
        node._meta ??= {};
        node._meta.isNative = isNative;
        for (const [key, value] of Object.entries(payload)) {
          if (META_KEYS.has(key.toLowerCase())) {
            node._meta[key.toLowerCase()] = value;
          } else if (typeof value === 'object' && value !== null) {
            node[key] ??= {};
            attachData(node[key], value);
          }
        }
      };
      attachData(rootNode, data);
    };

    if (!PAGE.__FLUX_KIT_WELCOME_LOGGED__) {
      console.log('%c🛠️ FluxKit active. Type FluxKit.help() for commands.', 'color: #00ACC1; font-style: italic;');
      console.log('%c🛠️ FluxKit Logger active. Type FluxLogs.help() for commands.', 'color: #00ACC1; font-style: italic;');
      PAGE.__FLUX_KIT_WELCOME_LOGGED__ = true;
    }

    return helpRouter;
  })();

  FluxKit.exposeToPage('help');

  PAGE.FluxLogs ??= {
    help: () => FluxKit.help('logs'),

    scripts: () => Object.keys(CORE.logs),

    clear: (scriptName = null) => {
      if (scriptName && CORE.logs[scriptName]) {
        CORE.logs[scriptName] = { standard: [], debug: [] };
        console.log(`Cleared standard and debug logs for ${scriptName}`);
      } else {
        CORE.logs = {};
        console.log('Cleared all logs across all scripts.');
      }
    },

    live: (state = true, scriptName = null) => {
      if (scriptName) {
        if (!CORE.customStates[scriptName]) CORE.customStates[scriptName] = {};
        CORE.customStates[scriptName].logEnabled = !!state;
        console.log(`%cLive Logging for [${scriptName}] is now ${state ? 'ON 🟢' : 'OFF 🔴'}`, `color: ${state ? '#4CAF50' : '#F44336'};`);
      } else {
        CORE.logEnabled = !!state;
        console.log(`%cGlobal Live Logging is now ${CORE.logEnabled ? 'ON 🟢' : 'OFF 🔴'}`, `color: ${CORE.logEnabled ? '#4CAF50' : '#F44336'}; font-weight: bold;`);
      }
    },

    debug: (state = true, scriptName = null) => {
      if (scriptName) {
        if (!CORE.customStates[scriptName]) CORE.customStates[scriptName] = {};
        CORE.customStates[scriptName].debugEnabled = !!state;
        console.log(`%cDebug Logging for [${scriptName}] is now ${state ? 'ON 🟢' : 'OFF 🔴'}`, `color: ${state ? '#4CAF50' : '#F44336'};`);
      } else {
        CORE.debugEnabled = !!state;
        console.log(`%cGlobal Debug Logging is now ${CORE.debugEnabled ? 'ON 🟢' : 'OFF 🔴'}`, `color: ${CORE.debugEnabled ? '#4CAF50' : '#F44336'}; font-weight: bold;`);
      }
    },

    limit: (standardLimit, debugLimit, scriptName = null) => {
      if (scriptName) {
        CORE.customLimits[scriptName] = {
          max: standardLimit ?? CORE.maxLogs,
          debugMax: debugLimit ?? CORE.debugMaxLogs
        };
        console.log(`Updated limits for [${scriptName}] -> Std: ${standardLimit}, Dbg: ${debugLimit}`);
      } else {
        if (standardLimit !== undefined) CORE.maxLogs = standardLimit;
        if (debugLimit !== undefined) CORE.debugMaxLogs = debugLimit;
        console.log(`Updated Global Limits -> Std: ${CORE.maxLogs}, Dbg: ${CORE.debugMaxLogs}`);
      }
    },

    status: () => {
      console.group('🛠️ FluxKit Logger Status');
      console.table({
        'Global Live Logging': CORE.logEnabled ? 'ON 🟢' : 'OFF 🔴',
        'Global Debug Logging': CORE.debugEnabled ? 'ON 🟢' : 'OFF 🔴',
        'Global Standard Limit': CORE.maxLogs,
        'Global Debug Limit': CORE.debugMaxLogs,
        'Active Scripts Tracked': Object.keys(CORE.logs).length
      });

      if (Object.keys(CORE.customLimits).length > 0) {
        console.log('%cScript Limit Overrides:', 'font-weight: bold; color: #FF9800;');
        console.table(CORE.customLimits);
      }

      if (Object.keys(CORE.customStates).length > 0) {
        console.log('%cScript State Overrides:', 'font-weight: bold; color: #00BCD4;');
        console.table(CORE.customStates);
      }
      console.groupEnd();
    },

    show: (options = {}) => {
      const { script, level, search } = options;
      let results = [];
      let requestedLevels = [];
      if (level) {
        if (Array.isArray(level)) {
          requestedLevels = level.map(l => l.toLowerCase());
        } else if (typeof level === 'string') {
          requestedLevels = level
            .split(/[\s&,+\-|]+/)
            .filter(Boolean)
            .map(l => l.trim().toLowerCase());
        }
      }

      const needsDebug = requestedLevels.length === 0 || requestedLevels.includes('debug');
      const needsStandard = requestedLevels.length === 0 ||
        requestedLevels.some(l => ['standard', 'info', 'warn', 'error'].includes(l));

      const targets = script && CORE.logs[script]
        ? [CORE.logs[script]]
        : Object.values(CORE.logs);

      targets.forEach(target => {
        if (needsStandard) results.push(...target.standard);
        if (needsDebug) results.push(...target.debug);
      });

      if (requestedLevels.length > 0 && !requestedLevels.includes('standard')) {
        results = results.filter(log => requestedLevels.includes(log.level));
      }

      if (search) {
        const term = search.toLowerCase();
        results = results.filter(log => log.message.toLowerCase().includes(term));
      }

      results.sort((a, b) => new Date(b.time) - new Date(a.time));

      if (results.length === 0) {
        console.log('No logs found matching criteria.');
      } else {
        console.table(results);
      }
      
    }
  };

  FluxKit.utils.createLogger ??= (configKey, pluginKey = '') => {
    const scriptId = pluginKey === '' ? configKey : `${configKey}.${pluginKey}`;

    if (!CORE.logs[scriptId]) {
      CORE.logs[scriptId] = { standard: [], debug: [] };
    }

    const pushLog = (level, message, data, isDebug = false) => {
      const targetArray = isDebug ? CORE.logs[scriptId].debug : CORE.logs[scriptId].standard;

      const limits = CORE.customLimits[scriptId];
      const maxLimit = isDebug
          ? (limits ? limits.debugMax : CORE.debugMaxLogs)
          : (limits ? limits.max : CORE.maxLogs);

      const snapshot = {
          time: new Date().toISOString(),
          script: scriptId,
          level,
          message,
          data: data.map(d => {
              try { return structuredClone(d); }
              catch {
                  try { return JSON.parse(JSON.stringify(d)); }
                  catch { return String(d); }
              }
          })
      };

      targetArray.unshift(snapshot);

      while (targetArray.length > maxLimit) {
          targetArray.pop();
      }
    };

    const shouldLog = (isForDebug, verbose) => {
      // Priority 1: Global Overrides
      if (isForDebug && CORE.debugEnabled) return true;
      if (!isForDebug && CORE.logEnabled) return true;

      // Priority 2: Console Script Overrides (Targeted)
      const stateOverride = CORE.customStates[scriptId];
      if (stateOverride) {
          if (isForDebug && stateOverride.debugEnabled === true) return true;
          if (!isForDebug && stateOverride.logEnabled === true) return true;
      }

      // Priority 3: Source Code Config
      try {
          const config = SANDBOX[configKey];
          if (config && config.logging === true) return true;
      } catch {}

      // Priority 4: Verbiage Fallback
      return !isForDebug && verbose > 0;
    };

    const logWith = (fn, tag, level) => (message, ...data) => {
      let verbose = 0;

      if (data.length && typeof data[data.length - 1] === 'object' && data[data.length - 1] !== null && '__v' in data[data.length - 1]) {
          verbose = data.pop().__v;
      }

      const isDebug = level === 'debug';
      pushLog(level, message, data, isDebug);

      if (shouldLog(isDebug, verbose)) {
          fn(`[${scriptId}]${tag}`, message, ...data);
      }
    };

    return {
      logMessage: logWith(console.log, ':', 'info'),
      logError: logWith(console.error, ' ❌:', 'error'),
      logWarning: logWith(console.warn, ' ⚠️:', 'warn'),
      logDebug: logWith(console.debug, ' DEBUG:', 'debug'),
    };
  };

  FluxKit.utils.createHTMLElement ??= (tagName, attributes = {}) => {
    const el = document.createElement(tagName);

    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined) continue;

      switch (key) {
        case "style":
          if (typeof value === "string") {
            value.split(';').forEach(rule => {
              if (!rule.trim()) return;
              const splitIndex = rule.indexOf(':');
              if (splitIndex === -1) return;
              const cssKey = rule.slice(0, splitIndex).trim();
              let cssVal = rule.slice(splitIndex + 1).trim();
              let priority = '';
              if (cssVal.toLowerCase().endsWith('!important')) {
                cssVal = cssVal.replace(/!important$/i, '').trim();
                priority = 'important';
              }
              el.style.setProperty(cssKey, cssVal, priority);
            });
          }
          else if (value && typeof value === "object") {
            Object.assign(el.style, value);
          }
          break;

        case "dataset":
          if (value && typeof value === "object") {
            for (const [dataKey, dataVal] of Object.entries(value)) {
              el.dataset[FluxKit.utils.toCamelCase(dataKey)] = dataVal;
            }
          }
          break;

        case "flxTitle":
        case "flxTooltip":
          if (typeof value === "string") el.dataset.tooltip = value;
          else if (value && typeof value === "object") {
            Object.assign(el.dataset, value);
          }
          break;

        case "flxPopover":
          if (typeof value === "string") el.dataset.tooltip = value;
          else if (value && typeof value === "object") {
            Object.assign(el.dataset, value);
          }
          el.dataset.tooltipInteractive = "true";
          break;

        case "class":
          if (typeof value === "string") el.className = value;
          break;

        case "eventListener":
          if (typeof value === "function") {
            el.addEventListener("click", value);
          } else if (Array.isArray(value)) {
            value.forEach(({ type, fn, config }) => el.addEventListener(type, fn, config));
          } else if (value && typeof value === "object") {
            for (const [type, fn] of Object.entries(value)) {
              el.addEventListener(type, fn);
            }
          }
          break;

        case "children":
          (Array.isArray(value) ? value : [value])
            .forEach(child => el.appendChild(
              typeof child === "string" ? document.createTextNode(child) : child
            ));
          break;

        case "icon":
          if (typeof value === "string") {
            const iconSpan = document.createElement("span");
            iconSpan.style.display = "flex";
            const rawIcon = FluxKit.ui.icons[value] || "";
            iconSpan.innerHTML = safeHTML(rawIcon);
            el.appendChild(iconSpan);
          }
          break;

        case "innerHTML":
          el.innerHTML = safeHTML(value);
          break;

        default:
          if (typeof value === "boolean") {
            if (value) el.setAttribute(key, "");
            else el.removeAttribute(key);
          } else if (key in el) {
            el[key] = value;
          } else {
            el.setAttribute(key, value);
          }
      }
    }
    return el;
  }

  FluxKit.utils.createSVGElement ??= (tagName, attributes = {}) => {
    const SVG_NS = "http://www.w3.org/2000/svg";
    const el = document.createElementNS(SVG_NS, tagName);

    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined) continue;

      switch (key) {
        case "style":
          if (typeof value === "string") el.setAttribute("style", value);
          else {
            const styleStr = Object.entries(value)
              .map(([k, v]) => `${k}:${v}`)
              .join(";");
            el.setAttribute("style", styleStr);
          }
          break;

        case "dataset":
          for (const [dataKey, dataVal] of Object.entries(value)) {
            el.setAttribute(`data-${dataKey}`, dataVal);
          }
          break;

        case "class":
          el.setAttribute("class", value);
          break;

        case "eventListener":
          if (typeof value === "function") {
            el.addEventListener("click", value);
          } else if (Array.isArray(value)) {
            value.forEach(({ type, fn, config }) =>
              el.addEventListener(type, fn, config)
            );
          } else {
            for (const [type, fn] of Object.entries(value)) {
              el.addEventListener(type, fn);
            }
          }
          break;

        case "children":
          (Array.isArray(value) ? value : [value]).forEach((child) =>
            el.appendChild(
              typeof child === "string"
                ? document.createTextNode(child)
                : child
            )
          );
          break;

        default:
          if (typeof value === "boolean") {
            if (value) el.setAttribute(key, "");
            else el.removeAttribute(key);
          } else {
            el.setAttribute(key, value);
          }
      }
    }

    return el;
  };

  FluxKit.utils.getUniqueId ??= function generateId(existingIds = []) {
    const rand5 = () => Math.random().toString(36).slice(2).padEnd(5, '0').slice(0, 5);
    const id = `${rand5()}-${Date.now().toString(36)}-${rand5()}`;
    if (existingIds && existingIds.includes(id)) {
      return generateId(existingIds);
    }
    return id;
  };

  FluxKit.utils.openPopupWindow ??= (url, options = {}) => {
    const w = options.width || 560, h = options.height || 640;
    const defaultOptions = {
      title: 'FluxKit Window',
      top: Math.round(window.screenY + (window.outerHeight - h) / 2),
      left: Math.round(window.screenX + (window.outerWidth - w) / 2),
      toolbar: 'no', menubar: 'no', scrollbars: 'yes', resizable: 'yes'
    }
    const { title, left, top, toolbar, menubar, scrollbars, resizable} = { ...defaultOptions, ...options };

    window.open(
      url, title,
      `width=${w},height=${h},left=${left},top=${top},toolbar=${toolbar},menubar=${menubar},scrollbars=${scrollbars},resizable=${resizable}`
    );
  }

  if (!FluxKit.utils.initPopupWindows) {
    const __popupRoots = new WeakSet();

    FluxKit.utils.initPopupWindows = ((rootElement = document, options = {}) => {
      if (__popupRoots.has(rootElement)) return;
      __popupRoots.add(rootElement);

      rootElement.addEventListener('click', (e) => {
        const anchor = e.target.closest('a[data-popup]');
        if (!anchor) return;
        
        e.preventDefault();
        e.stopPropagation();

        const url = anchor.href;
        
        if (!url || url === window.location.href) return;
        
        FluxKit.utils.openPopupWindow(url, { 
          ...options,
          title: anchor.dataset.popup || 'FluxKit Window',
          width: anchor.dataset.popupWidth ? parseInt(anchor.dataset.popupWidth, 10) : 560,
          height: anchor.dataset.popupHeight ? parseInt(anchor.dataset.popupHeight, 10) : 640
        });
      }, true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FluxKit.utils.initPopupWindows(), { once: true });
  } else {
    FluxKit.utils.initPopupWindows();
  }

  FluxKit.utils.getRandomIcon ??= (name) => {
    if (name && emojiMap[name.toLowerCase()]) return emojiMap[name.toLowerCase()];
    const icons = Object.values(emojiMap);
    return icons[Math.floor(Math.random() * icons.length)];
  };

  FluxKit.utils.makeElementDragAndResize ??= (element, header = null, options = {}) => {
    const opt = {
      resizable: true, keepInViewport: true, dragThreshold: 3,
      minWidth: 160, minHeight: 90, initWidth: null, initHeight: null, maxWidth: Infinity, maxHeight: Infinity, lockAspectRatio: false, aspectRatio: null, /* inferred if null */
      noDragSelector: 'button, input, select, textarea, a, [role="button"], [role="link"], [contenteditable="true"], [data-no-drag]',
      onDragStart: null, onDragging: null, onDragEnd: null, onResizeStart: null, onResizing: null, onResizeEnd: null,
      onClick: null, // genuine dragElement on handle (not after drag)
      ...options,
    };
    const ctrl = new AbortController();
    const { signal } = ctrl;

    if (!getComputedStyle(element).position || getComputedStyle(element).position === 'static') {
      element.style.position = 'fixed';
    }

    (function initPositionSafely() {
      const prevTransition = element.style.transition || '';
      const prevVisibility = element.style.visibility || '';

      element.style.transition = 'none';
      element.style.visibility = 'hidden';
      element.style.willChange = 'left, top';

      const cs = getComputedStyle(element);
      if (cs.position === 'static') {
        element.style.position = 'fixed';
      }

      requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();

        let left = rect.left;
        let top = rect.top;

        if (opt.initLeft != null) left = opt.initLeft;
        if (opt.initTop != null) top = opt.initTop;

        element.style.left = `${Math.round(left)}px`;
        element.style.top = `${Math.round(top)}px`;
        element.style.transform = 'none';

        requestAnimationFrame(() => {
          element.style.visibility = prevVisibility || '';
          setTimeout(() => {
            element.style.transition = prevTransition;
          }, 20);
        });
      });
    })();

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const dragElement = header || element;
    const ogCursor = getComputedStyle(dragElement).cursor;
    dragElement.style.cursor ||= 'move';
    dragElement.style.touchAction = 'none';

    let dragging = false, resizing = false, moved = false;
    let suppressNextClick = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0, startW = 0, startH = 0;

    const getRect = () => element.getBoundingClientRect();
    const getAspect = () => opt.aspectRatio || (getRect().width / Math.max(1, getRect().height));

    let isMaximized = false;

    // ---- DRAG ----
    const onPointerDownDrag = (e) => {
      if (isMaximized) return;
      if (e.button != null && e.button !== 0) return;
      if (e.target && e.target.closest(opt.noDragSelector)) return;

      const r = getRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseFloat(element.style.left) || r.left;
      startTop = parseFloat(element.style.top) || r.top;
      moved = false;
      dragging = false;
      dragElement.setPointerCapture?.(e.pointerId);
    };

    const onPointerMoveDrag = (e) => {
      if (resizing) return;
      if (!dragElement.hasPointerCapture?.(e.pointerId)) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > opt.dragThreshold) {
        dragging = true;
        moved = true;
        suppressNextClick = true; // guard the ghost click
        element.style.userSelect = 'none';
        opt.onDragStart?.(e, element);
      }

      if (!dragging) return;

      dragElement.style.cursor = 'move';
      e.preventDefault();

      let left = startLeft + dx;
      let top = startTop + dy;

      const r = getRect();
      if (opt.keepInViewport) {
        left = clamp(left, 0, window.innerWidth - r.width);
        top = clamp(top, 0, window.innerHeight - r.height);
      }

      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.transform = 'none';

      opt.onDragging?.(e, element);
    };

    const onPointerUpDrag = (e) => {
      if (dragging) {
        dragging = false;
        element.style.userSelect = '';
        dragElement.style.cursor = ogCursor || 'move';
        opt.onDragEnd?.(e, element);
      }
      dragElement.releasePointerCapture?.(e.pointerId);
      requestAnimationFrame(() => { suppressNextClick = false; });
    };

    dragElement.addEventListener('pointerdown', onPointerDownDrag, { signal });
    window.addEventListener('pointermove', onPointerMoveDrag, { signal });
    window.addEventListener('pointerup', onPointerUpDrag, { signal });

    dragElement.addEventListener('click', (e) => {
      if (suppressNextClick) {
        e.preventDefault();
        e.stopImmediatePropagation();
      } else {
        opt.onClick?.(e, element);
      }
    }, { capture: true, passive: false, signal });

    // ---- RESIZE (bottom-right) ----
    let resizer = null;
    if (opt.resizable) {
      resizer = element.querySelector(':scope > .element-resizer') || FluxKit.utils.createHTMLElement('div');
      if (!resizer.parentNode) {
        resizer.className = 'element-resizer';
        Object.assign(resizer.style, {
          width: '14px', height: '14px', position: 'absolute',
          right: '0', bottom: '0', cursor: 'se-resize',
          background: 'transparent', zIndex: 2,
        });
        element.appendChild(resizer);
      }

      const onPointerDownResize = (e) => {
        if (e.button != null && e.button !== 0) return;
        const r = getRect();
        startX = e.clientX; startY = e.clientY;
        startW = r.width; startH = r.height;
        moved = false; resizing = true; suppressNextClick = true; // block post-resize click
        resizer.setPointerCapture?.(e.pointerId);
        element.style.userSelect = 'none';
        opt.onResizeStart?.(e, element);
      };

      const onPointerMoveResize = (e) => {
        if (!resizing) return;
        e.preventDefault();

        const aspect = getAspect();
        let w = startW + (e.clientX - startX);
        let h = startH + (e.clientY - startY);

        if (opt.lockAspectRatio) {
          // maintain aspect based on whichever axis moved more
          if (Math.abs(e.clientX - startX) >= Math.abs(e.clientY - startY)) {
            h = w / aspect;
          } else {
            w = h * aspect;
          }
        }

        w = clamp(w, opt.minWidth, opt.maxWidth);
        h = clamp(h, opt.minHeight, opt.maxHeight);

        if (opt.keepInViewport) {
          const r = getRect();
          w = Math.min(w, window.innerWidth - r.left);
          h = Math.min(h, window.innerHeight - r.top);
        }

        element.style.width = `${w}px`;
        element.style.height = `${h}px`;

        moved = true;
        if (isMaximized) {
          isMaximized = false;
        }
        opt.onResizing?.(e, element);
      };

      const onPointerUpResize = (e) => {
        if (!resizing) return;
        resizing = false;
        element.style.userSelect = '';
        resizer.releasePointerCapture?.(e.pointerId);
        opt.onResizeEnd?.(e, element);
        setTimeout(() => { suppressNextClick = false; }, 0);
      };

      resizer.addEventListener('pointerdown', onPointerDownResize, { signal });
      window.addEventListener('pointermove', onPointerMoveResize, { signal });
      window.addEventListener('pointerup', onPointerUpResize, { signal });
      resizer.addEventListener('dblclick', () => {
        element.style.transition = 'width 0.25s ease, height 0.25s ease, left 0.25s ease, top 0.25s ease';

        if (!isMaximized) {
          const margin = 40; // padding from viewport edges
          let viewportW = window.innerWidth - margin;
          let viewportH = window.innerHeight - margin;

          let targetW = viewportW;
          let targetH = viewportH;

          if (opt.lockAspectRatio) {
            const aspect = getAspect();
            if (targetW / targetH > aspect) {
              targetW = targetH * aspect;
            } else {
              targetH = targetW / aspect;
            }
          }

          const maxW = clamp(targetW, opt.minWidth, opt.maxWidth);
          const maxH = clamp(targetH, opt.minHeight, opt.maxHeight);

          const left = (window.innerWidth - maxW) / 2;
          const top = (window.innerHeight - maxH) / 2;

          element.style.width = `${maxW}px`;
          element.style.height = `${maxH}px`;
          element.style.left = `${left}px`;
          element.style.top = `${top}px`;

          dragElement.style.cursor = 'default';

          isMaximized = true;
        } else {
          let targetW = opt.initWidth || opt.minWidth;
          let targetH = opt.initHeight || opt.minHeight;

          if (opt.lockAspectRatio) {
            const aspect = getAspect();
            if (targetW / targetH > aspect) {
              targetW = targetH * aspect;
            } else {
              targetH = targetW / aspect;
            }
          }

          const minW = clamp(targetW, opt.minWidth, opt.maxWidth);
          const minH = clamp(targetH, opt.minHeight, opt.maxHeight);
          element.style.width = `${minW}px`;
          element.style.height = `${minH}px`;
          if (opt.keepInViewport) {
            const left = parseFloat(element.style.left || 0);
            const top = parseFloat(element.style.top || 0);

            let newLeft = left;
            let newTop = top;

            if (newLeft + minW > window.innerWidth) {
              newLeft = Math.max(0, window.innerWidth - minW);
            }
            if (newTop + minH > window.innerHeight) {
              newTop = Math.max(0, window.innerHeight - minH);
            }

            element.style.left = `${newLeft}px`;
            element.style.top = `${newTop}px`;
          }

          dragElement.style.cursor = ogCursor || 'move';
          isMaximized = false;
        }

        setTimeout(() => {
          opt.onResizeEnd?.(element);
        }, 50);
        setTimeout(() => {
          element.style.transition = '';
        }, 300);
      }, { signal });
    }

    return () => {
      try {ctrl.abort()} catch (e) {}
    };
  }

  FluxKit.utils.trapTabFocus ??= (element, initialFocus = null) => {
    const focusable = element.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const focusableArray = Array.from(focusable).filter(
      el => !el.disabled && el.offsetParent !== null
    );

    if (!focusableArray.length) return;

    if (initialFocus) initialFocus.focus();
    else focusableArray[0].focus();

    element.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;

      const currentIndex = focusableArray.indexOf(document.activeElement);
      const first = focusableArray[0];
      const last = focusableArray[focusableArray.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  FluxKit.theme ??= {
    presets: {
      light: {
        name: 'Clean Light', dark: false, bg: '#ffffff', text: '#111827', inputBg: '#f3f4f6', accentBg: '#3D5A80', accentText: '#293241', btnTextColor: '#ffffff',
        border: '1px solid rgba(0, 0, 0, 0.08)', hoverBg: 'rgba(0, 0, 0, 0.04)', hoverText: '#111827', separator: 'rgba(0, 0, 0, 0.08)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.02) inset', btnHoverBg: 'rgba(0, 0, 0, 0.06)',
        progressGradient: 'linear-gradient(90deg, #5C7CFA, #3D5A80)'
      },
      dark: {
        name: 'Dark', dark: true, bg: '#000000', text: '#e5e7eb', inputBg: '#121212', accentBg: '#333333', accentText: '#9ca3af', btnTextColor: '#ffffff',
        border: '1px solid rgba(255, 255, 255, 0.1)', hoverBg: 'rgba(255, 255, 255, 0.05)', hoverText: '#ffffff', separator: 'rgba(255, 255, 255, 0.1)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset', btnHoverBg: 'rgba(255, 255, 255, 0.1)',
        progressGradient: 'linear-gradient(90deg, #555555, #9ca3af)'
      },
      newsprint: {
        name: 'Newsprint', dark: false, bg: '#f7f4ed', text: '#191919', inputBg: '#ebe7de', accentBg: '#191919', accentText: '#111111', btnTextColor: '#f7f4ed',
        border: '1px solid rgba(25, 25, 25, 0.15)', hoverBg: 'rgba(25, 25, 25, 0.05)', hoverText: '#000000', separator: 'rgba(25, 25, 25, 0.15)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)', btnHoverBg: 'rgba(25, 25, 25, 0.1)',
        progressGradient: 'linear-gradient(90deg, #555555, #191919)'
      },
      blossom: {
        name: 'Blossom', dark: false, bg: '#fff0f5', text: '#831843', inputBg: '#fce7f3', accentBg: '#db2777', accentText: '#9d174d', btnTextColor: '#ffffff',
        border: '1px solid rgba(219, 39, 119, 0.15)', hoverBg: 'rgba(219, 39, 119, 0.08)', hoverText: '#9d174d', separator: 'rgba(219, 39, 119, 0.15)',
        boxShadow: '0 8px 24px rgba(219, 39, 119, 0.12)', btnHoverBg: 'rgba(219, 39, 119, 0.12)',
        progressGradient: 'linear-gradient(90deg, #f472b6, #db2777)'
      },
      material: {
        name: 'Material Light', dark: false, bg: '#ffffff', text: '#202124', inputBg: '#f1f3f4', accentBg: '#1a73e8', accentText: '#1558d6', btnTextColor: '#ffffff',
        border: '1px solid #dadce0', hoverBg: '#f1f3f4', hoverText: '#202124', separator: '#dadce0',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.08)', btnHoverBg: 'rgba(26, 115, 232, 0.08)',
        progressGradient: 'linear-gradient(90deg, #669df6, #1a73e8)'
      },
      sunset: {
        name: 'Sunset (Warm)', dark: true, bg: '#2d1b1b', text: '#ffdab9', inputBg: '#3d2b2b', accentBg: '#ff7e5f', accentText: '#ff9c85', btnTextColor: '#ffffff',
        border: '1px solid rgba(255, 126, 95, 0.2)', hoverBg: 'rgba(255, 126, 95, 0.1)', hoverText: '#ffffff', separator: 'rgba(255, 126, 95, 0.2)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 126, 95, 0.1) inset', btnHoverBg: 'rgba(255, 126, 95, 0.15)',
        progressGradient: 'linear-gradient(90deg, #ff9c85, #ff7e5f)'
      },
      terminal: {
        name: 'Terminal', dark: true, bg: '#09090b', text: '#4ade80', inputBg: '#18181b', accentBg: '#16a34a', accentText: '#4ade80', btnTextColor: '#000000',
        border: '1px solid #16a34a', hoverBg: 'rgba(22, 163, 74, 0.15)', hoverText: '#86efac', separator: '#16a34a',
        boxShadow: '0 0 15px rgba(22, 163, 74, 0.2)', btnHoverBg: 'rgba(22, 163, 74, 0.25)',
        progressGradient: 'linear-gradient(90deg, #22c55e, #16a34a)'
      },
      darkSleek: {
        name: 'Sleek Dark', dark: true, bg: '#1f2937', text: '#f9fafb', inputBg: '#374151', accentBg: '#E63946', accentText: '#ff7a84', btnTextColor: '#ffffff',
        border: '1px solid rgba(255, 255, 255, 0.1)', hoverBg: 'rgba(255, 255, 255, 0.05)', hoverText: '#ffffff', separator: 'rgba(255, 255, 255, 0.1)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset', btnHoverBg: 'rgba(255, 255, 255, 0.1)',
        progressGradient: 'linear-gradient(90deg, #ff7a84, #E63946)'
      },
      dracula: {
        name: 'Dracula', dark: true, bg: '#282a36', text: '#f8f8f2', inputBg: '#44475a', accentBg: '#ff79c6', accentText: '#ff92d0', btnTextColor: '#282a36',
        border: '1px solid #44475a', hoverBg: '#44475a', hoverText: '#ffffff', separator: '#44475a',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)', btnHoverBg: 'rgba(255, 121, 198, 0.15)',
        progressGradient: 'linear-gradient(90deg, #bd93f9, #ff79c6)'
      },
      nord: {
        name: 'Nord (Cool)', dark: true, bg: '#2e3440', text: '#d8dee9', inputBg: '#3b4252', accentBg: '#81a1c1', accentText: '#88c0d0', btnTextColor: '#2e3440',
        border: '1px solid #4c566a', hoverBg: '#434c5e', hoverText: '#eceff4', separator: '#4c566a',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)', btnHoverBg: 'rgba(129, 161, 193, 0.15)',
        progressGradient: 'linear-gradient(90deg, #88c0d0, #81a1c1)'
      },
      solarized: {
        name: 'Solarized Light', dark: false, bg: '#fdf6e3', text: '#657b83', inputBg: '#eee8d5', accentBg: '#2aa198', accentText: '#217d76', btnTextColor: '#ffffff',
        border: '1px solid #eee8d5', hoverBg: '#eee8d5', hoverText: '#586e75', separator: '#eee8d5',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)', btnHoverBg: 'rgba(42, 161, 152, 0.1)',
        progressGradient: 'linear-gradient(90deg, #268bd2, #2aa198)'
      }
    },

    isSystemDark: () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches,

    isSiteDark: (rootElement = null, fallbackOverride = null) => {
      let targetEls = null;

      if (typeof rootElement === 'string') {
        const found = document.querySelector(rootElement);
        if (found) targetEls = [found];
      } else if (rootElement instanceof Element) {
        targetEls = [rootElement];
      } else if (rootElement instanceof ShadowRoot) {
        targetEls = [rootElement.host];
      }
      if (!targetEls) targetEls = [document.body, document.documentElement];

      function getEffectiveBackgroundColor(elements) {
        for (let el of elements) {
          while (el) {
            if (el instanceof Element) {
              const bg = window.getComputedStyle(el).backgroundColor;
              if (bg && !bg.includes('rgba(0, 0, 0, 0)') && !bg.includes('transparent')) {
                return bg;
              }
            }
            el = el.parentNode || el.host;
            if (el === document) break;
          }
        }
        return null;
      }
      let bg = null;
      if (targetEls) {
        bg = getEffectiveBackgroundColor(targetEls);
      }
      const finalFallback = fallbackOverride !== null
        ? fallbackOverride
        : FluxKit.theme.isSystemDark();
      if (!bg) return finalFallback;
      const rgb = bg.match(/\d+(\.\d+)?/g);
      if (!rgb || rgb.length < 3) return FluxKit.theme.isSystemDark();
      const [r, g, b] = rgb.map(Number);
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      return brightness < 128;
    },

    get: (themeKeyOrIsDark, target = null) => {
      if (typeof themeKeyOrIsDark === 'string' && FluxKit.theme.presets[themeKeyOrIsDark]) {
        return FluxKit.theme.presets[themeKeyOrIsDark];
      }
      const resolvedIsDark = typeof themeKeyOrIsDark === 'boolean' ? themeKeyOrIsDark : null;

      return FluxKit.theme.getSiteStyles({
        isDark: resolvedIsDark,
        target: target || document.body || document.documentElement
      });
    },

    /**
     * Darkens a color by a percentage (0-100)
     * @param {string} color - Hex or RGB color
     * @param {number} percent - Percentage to darken (e.g., 10)
     */
    darken: (color, percent) => {
      let r, g, b, a = 1;

      // Handle RGB(A)
      if (color.startsWith('rgb')) {
        const values = color.match(/\d+(\.\d+)?/g).map(Number);
        [r, g, b] = values;
        if (values.length > 3) a = values[3];
      }
      // Handle Hex
      else {
        let hex = color.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        r = parseInt(hex.substr(0, 2), 16);
        g = parseInt(hex.substr(2, 2), 16);
        b = parseInt(hex.substr(4, 2), 16);
      }

      // Darken by reducing each channel
      const factor = (100 - percent) / 100;
      r = Math.floor(r * factor);
      g = Math.floor(g * factor);
      b = Math.floor(b * factor);

      return `rgba(${r}, ${g}, ${b}, ${a})`;
    },

    ensureMinOpacity: (colorStr, minOpacity = 0.85) => {
      if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') {
        return `rgba(0, 0, 0, ${minOpacity})`;
      }
      
      if (colorStr.includes('var(') || colorStr.includes('gradient')) return colorStr; 

      if (colorStr.startsWith('rgba')) {
        const values = colorStr.match(/\d+(\.\d+)?/g);
        if (values && values.length >= 4) {
          const a = parseFloat(values[3]);
          if (a < minOpacity) {
            return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${minOpacity})`;
          }
        }
      } 
      else if (colorStr.startsWith('#') && (colorStr.length === 5 || colorStr.length === 9)) {
        let r, g, b, aHex;
        if (colorStr.length === 5) {
          r = parseInt(colorStr[1] + colorStr[1], 16);
          g = parseInt(colorStr[2] + colorStr[2], 16);
          b = parseInt(colorStr[3] + colorStr[3], 16);
          aHex = colorStr[4] + colorStr[4];
        } else {
          r = parseInt(colorStr.substring(1, 3), 16);
          g = parseInt(colorStr.substring(3, 5), 16);
          b = parseInt(colorStr.substring(5, 7), 16);
          aHex = colorStr.substring(7, 9);
        }
        
        const a = parseInt(aHex, 16) / 255;
        if (a < minOpacity) {
          return `rgba(${r}, ${g}, ${b}, ${minOpacity})`;
        }
      }

      return colorStr; 
    },

    /**
     * Safely injects a hidden probe element into the DOM to force the browser 
     * to compute the raw RGB value of a CSS variable.
     */
    _probeForVarColor: (colorStr, targetElement = null) => {
      if (typeof colorStr !== 'string' || !colorStr.includes('var(')) {
        return colorStr;
      }

      let host = targetElement;
      if (!host || !host.isConnected) host = document.body;

      const voidElements = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);
      if (host && host.tagName && voidElements.has(host.tagName.toUpperCase())) {
        host = host.parentNode || document.body;
      }

      if (!host) return colorStr;

      try {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'none';
        wrapper.style.color = 'rgb(1, 2, 3)'; 

        const probe = document.createElement('div');
        probe.style.color = colorStr; 
        
        wrapper.appendChild(probe);
        host.appendChild(wrapper);
        
        const computed1 = window.getComputedStyle(probe).color;
        let result = colorStr;

        if (computed1 === 'rgb(1, 2, 3)') {
          wrapper.style.color = 'rgb(4, 5, 6)'; 
          const computed2 = window.getComputedStyle(probe).color;
          
          if (computed2 === 'rgb(1, 2, 3)') {
            result = computed1;
          }
        } 
        else if (computed1 && computed1.startsWith('rgb')) {
          result = computed1;
        }
        
        wrapper.remove();
        return result;
      } catch (e) {
        console.warn("[FluxKit] Failed to resolve CSS variable probe.", e);
        return colorStr;
      }
    },

    getColorName: (colorStr, colorMaps = {}, targetElement = null) => {
      if (typeof colorStr !== 'string') return 'Unknown Color';

      let resolvedStr = FluxKit.theme._probeForVarColor(colorStr.trim(), targetElement);

      if (resolvedStr.includes('var(')) {
        const match = resolvedStr.match(/var\((--[^,)]+)/);
        return match ? match[1] : resolvedStr;
      }

      const defaultColors = {
        '#000000': 'Black', '#ffffff': 'White', '#ff0000': 'Red', 
        '#00ff00': 'Green', '#0000ff': 'Blue', '#ffff00': 'Yellow', 
        '#00ffff': 'Cyan', '#ff00ff': 'Magenta', '#808080': 'Gray',
        '#ef4444': 'Red', '#f44336': 'Red', '#10b981': 'Emerald', 
        '#22c55e': 'Green', '#3b82f6': 'Blue', '#f59e0b': 'Orange', 
        '#eab308': 'Yellow', '#8b5cf6': 'Violet', '#a855f7': 'Purple', 
        '#ec4899': 'Pink', '#14b8a6': 'Teal', '#06b6d4': 'Cyan', 
        '#64748b': 'Slate', '#737373': 'Zinc', '#f97316': 'Orange',
      };
      
      const normalizedCustomMaps = Object.fromEntries(
        Object.entries(colorMaps).map(([k, v]) => [k.toLowerCase(), v])
      );
      
      const COMMON_COLORS = { ...defaultColors, ...normalizedCustomMaps };
      let lookupHex = resolvedStr.toLowerCase();

      if (lookupHex.startsWith('rgb')) {
        lookupHex = FluxKit.theme.rgbToHex(lookupHex, true);
      } 
      else if (lookupHex.startsWith('#')) {
        if (lookupHex.length === 4) {
          lookupHex = '#' + lookupHex.split('').slice(1).map(x => x + x).join('');
        } else if (lookupHex.length === 9) {
          lookupHex = lookupHex.substring(0, 7);
        }
      }
      
      const fallback = lookupHex.startsWith('#') ? lookupHex.toUpperCase() : resolvedStr;
      return COMMON_COLORS[lookupHex] || fallback;
    },

    rgbToHex: (rgbStr, dropAlpha = false) => {
      if (typeof rgbStr !== 'string') return rgbStr;
      const isValid = rgbStr.startsWith('rgb') && CSS.supports('color', rgbStr);
      if (!isValid) {
        console.warn(`[FluxKit] Invalid RGB value ("${rgbStr}").`);
        return rgbStr;
      }
      const rgbVals = rgbStr.match(/\d+(\.\d+)?/g);
      if (rgbVals && rgbVals.length >= 3) {
        let hex = '#' + [rgbVals[0], rgbVals[1], rgbVals[2]].map(x => {
          const hexStr = parseInt(x, 10).toString(16);
          return hexStr.length === 1 ? '0' + hexStr : hexStr;
        }).join('');
        if (!dropAlpha && rgbVals.length >= 4) {
          let alpha = parseFloat(rgbVals[3]);
          if (alpha > 1) alpha = alpha / 100;
          alpha = Math.max(0, Math.min(1, alpha));
          const alphaHex = Math.round(alpha * 255).toString(16);
          hex += alphaHex.length === 1 ? '0' + alphaHex : alphaHex;
        }
        return hex;
      } else {
        console.warn(`[FluxKit] Could not parse RGB numbers from ("${rgbStr}").`);
        return rgbStr;
      }
    },

    createAlphaColor: (colorStr, alpha, targetElement = null) => {
      if (!colorStr) return `rgba(128, 128, 128, ${alpha})`;
      let resolvedStr = FluxKit.theme._probeForVarColor(colorStr, targetElement);
      if (typeof resolvedStr === 'string' && resolvedStr.includes('var(')) {
        return resolvedStr; 
      }
      if (resolvedStr.startsWith('rgb')) {
        const values = resolvedStr.match(/\d+(\.\d+)?/g);
        if (values && values.length >= 3) {
          return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${alpha})`;
        }
      }
      if (resolvedStr.startsWith('#')) {
        let hex = resolvedStr.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        if (hex.length >= 6) {
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
      }
      return resolvedStr;
    },

    getContrastYIQ: (color) => {
      if (!color || color === 'transparent') return 'light';
      let r = 0, g = 0, b = 0;

      if (color.startsWith('rgb')) {
        const values = color.match(/\d+(\.\d+)?/g);
        if (values && values.length >= 3) [r, g, b] = values.map(Number);
      } else {
        let hex = color.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        if (hex.length >= 6) {
          r = parseInt(hex.substring(0, 2), 16);
          g = parseInt(hex.substring(2, 4), 16);
          b = parseInt(hex.substring(4, 6), 16);
        }
      }
      return ((r * 299 + g * 587 + b * 114) / 1000) >= 128 ? 'dark' : 'light';
    },

    ensureContrast: (bg, text, fallback) => {
      if (!text) return fallback;
      return (FluxKit.theme.getContrastYIQ(bg) === FluxKit.theme.getContrastYIQ(text)) ? fallback : text;
    },

    /**
     * Scrapes the current site for its primary colors and returns a theme object.
     * @param {Object} options - Configuration for scraping.
     * @param {HTMLElement} [options.target] - The DOM element to sample (defaults to body).
     * @param {boolean} [options.scrapeDOM=true] - Whether to hunt for button colors in the DOM.
     * @param {string} [options.ignoreSelector=''] - Selector to ignore (e.g., your own shadow root).
     * @param {boolean|null} [options.isDark=null] - Current theme mode. If null, auto-detects based on target.
     */
    getSiteStyles: function(options = {}) {
      const {
        scrapeDOM = true, ignoreSelector = '',
        target = document.body || document.documentElement
      } = options;

      let styleTarget = document.body || document.documentElement;
      let scrapeTarget = document.body || document.documentElement;

      if (typeof target === 'string') {
        const found = document.querySelector(target);
        if (found) {
          styleTarget = found;
          scrapeTarget = found;
        }
      } else if (target instanceof Element) {
        styleTarget = target;
        scrapeTarget = target;
      } else if (target instanceof ShadowRoot) {
        styleTarget = target.host;
        scrapeTarget = target;
      }

      const computedBody = window.getComputedStyle(styleTarget);
      let fontFamily = computedBody.fontFamily || 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

      if (/cursive|fantasy|comic/i.test(fontFamily)) {
        fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      }

      const resolvedIsDark = options.isDark ?? FluxKit.theme.isSiteDark(styleTarget);
      const basePreset = FluxKit.theme.presets[resolvedIsDark ? 'dark' : 'light'];

      function isTransparent(color) {
        return !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)' || (color.startsWith('rgba') && color.endsWith(', 0)'));
      }

      let siteBg = computedBody.backgroundColor;
      let siteText = computedBody.color;

      if (isTransparent(siteBg)) siteBg = basePreset.bg;
      if (isTransparent(siteText)) siteText = basePreset.text;

      let { accentBg, accentText, btnTextColor } = basePreset;

      const rootStyles = window.getComputedStyle(document.documentElement);
      const cssVars = ['--primary-color', '--accent-color', '--brand-color', '--color-primary', '--color-accent'];

      for (const v of cssVars) {
        const val = rootStyles.getPropertyValue(v).trim();
        if (val && !isTransparent(val)) {
          accentBg = val;
          accentText = val;
          break;
        }
      }

      if (scrapeDOM) {
        const candidates = Array.from(
          scrapeTarget.querySelectorAll('button, [class*="btn"], [role="button"]')
        );

        candidates.some((el) => {
          if (ignoreSelector && el.closest(ignoreSelector)) return false;

          if (el.offsetParent === null) return false;

          const computed = window.getComputedStyle(el);
          const bg = computed.backgroundColor;

          if (!isTransparent(bg)) {
            accentBg = bg;
            accentText = bg;
            btnTextColor = computed.color || btnTextColor;
            return true;
          }
          return false;
        });
      }

      btnTextColor = FluxKit.theme.ensureContrast(accentBg, btnTextColor, '#ffffff');
      accentText = FluxKit.theme.ensureContrast(
        resolvedIsDark ? '#1e1e1e' : '#ffffff',
        accentText,
        basePreset.accentText
      );
      siteText = FluxKit.theme.ensureContrast(siteBg, siteText, basePreset.text);

      const dynamicBorder = FluxKit.theme.createAlphaColor(siteText, 0.12);
      const dynamicHoverBg = FluxKit.theme.createAlphaColor(siteText, 0.05);
      const dynamicSeparator = FluxKit.theme.createAlphaColor(siteText, 0.08);
      const dynamicInputBg = FluxKit.theme.createAlphaColor(siteText, 0.03);

      const dynamicBtnHoverBg = FluxKit.theme.darken(accentBg, 12);
      const dynamicProgressGradient = `linear-gradient(90deg, ${accentBg}, ${dynamicBtnHoverBg})`;

      return {
        ...basePreset,
        name: `Native Dynamic ${resolvedIsDark ? 'Dark' : 'Light'}`,
        fontFamily, bg: siteBg, text: siteText, inputBg: dynamicInputBg,
        accentBg, accentText, btnTextColor, border: `1px solid ${dynamicBorder}`,
        hoverBg: dynamicHoverBg, hoverText: siteText,
        separator: dynamicSeparator, btnHoverBg: dynamicBtnHoverBg,
        progressGradient: dynamicProgressGradient
      };
    }
  };

  if (!FluxKit.ui.initNotification) {
    const notifRegistry = new Map();
    const injectedRoots = new WeakSet();

    FluxKit.ui.initNotification = (config = {}) => {
      const namespace = config.namespace || 'default';

      if (notifRegistry.has(namespace)) {
        Object.assign(notifRegistry.get(namespace), config);
      } else {
        notifRegistry.set(namespace, {
          rootElement: document.body,
          duration: 3000,
          position: 'top-right',
          borderRadius: '8px',
          fontFamily: 'system-ui, sans-serif',
          animationType: 'bounce',
          autoDark: true,
          ...config
        });
      }
    };

    FluxKit.ui.showNotification = (message, overrides = {}) => {
      const namespace = overrides.namespace || 'default';

      let activeConfig = notifRegistry.get(namespace) || {
          rootElement: document.body, duration: 3000, position: 'bottom-right',
          borderRadius: '8px', fontFamily: 'system-ui, sans-serif', autoDark: true
      };

      activeConfig = { ...activeConfig, ...overrides };
      const { rootElement, duration, icon, actionLabel, actionCallback, id } = activeConfig;

      const isDark = activeConfig.autoDark ? FluxKit.theme.isSiteDark() : !!activeConfig.darkMode;
      const theme = FluxKit.theme.get(isDark);

      const renderTheme = {
        bg: FluxKit.theme.ensureMinOpacity(activeConfig.bg || theme.bg),
        text: activeConfig.text || theme.text,
        boxShadow: activeConfig.boxShadow || theme.boxShadow,
        accentBg: activeConfig.accentBg || theme.accentBg,
        btnHoverBg: activeConfig.btnHoverBg || theme.btnHoverBg,
        btnColor: activeConfig.btnColor || theme.btnColor,
        progressGradient: activeConfig.progressGradient || theme.progressGradient
      };

      if (!injectedRoots.has(rootElement)) {
        const style = `
          @keyframes flxkit-progress { from { width: 0%; } to { width: 100%; } }
          @keyframes flxkit-notify-bounce {
            0% { transform: scaleY(0); opacity: 0; }
            20% { transform: scaleY(0); opacity: 0; }
            30% { transform: scale(1); opacity: 1; }
            40% { transform: scale(1.1); opacity: 1; }
            50% { transform: scale(1); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes flxkit-notify-bounce-out {
            0% { transform: scale(1); opacity: 1; }
            10% { transform: scale(1.1, 0.2); opacity: 1; }
            20% { transform: scale(1, 0.1); opacity: 1; }
            30% { transform: scaleY(0.8, 0); opacity: 0; }
            100% { transform: scaleY(0.8, 0); opacity: 0; }
          }
          @keyframes flxkit-notify-fade {
            0% { transform: translateY(15px) scale(0.95); opacity: 0; }
            100% { transform: translateY(0) scale(1); opacity: 1; }
          }
          @keyframes flxkit-notify-fade-out {
            0% { transform: translateY(0) scale(1); opacity: 1; }
            100% { transform: translateY(15px) scale(0.95); opacity: 0; }
          }
          /* Pause progress animations when the container is hovered */
          .flxkit-snackbar-container[data-expanded="true"] .flxkit-progress-bar {
            animation-play-state: paused !important;
          }
        `;
        const targetContainer = rootElement.nodeType === Node.DOCUMENT_NODE ? document.head : rootElement;
        targetContainer.appendChild(FluxKit.utils.createHTMLElement('style', { textContent: style }));
        injectedRoots.add(rootElement);
      }

      const isTop = activeConfig.position.startsWith('top');
      const isCenter = activeConfig.position.endsWith('center');
      const isLeft = activeConfig.position.endsWith('left');
      const dir = isTop ? 1 : -1;

      const containerSelector = `.flxkit-snackbar-container[data-position="${activeConfig.position}"]`;
      let container = rootElement.querySelector(containerSelector);

      if (!container) {
        container = FluxKit.utils.createHTMLElement('div', { className: 'flxkit-snackbar-container', dataset: { position: activeConfig.position } });

        Object.assign(container.style, {
          position: 'fixed', zIndex: '2147483647',
          display: 'grid',
          pointerEvents: 'none',
          [isTop ? 'top' : 'bottom']: '24px',
          ...(isCenter
                ? { left: '50%', transform: 'translateX(-50%)', justifyItems: 'center' }
                : { [isLeft ? 'left' : 'right']: '24px', justifyItems: isLeft ? 'start' : 'end' })
        });

        container.updateStack = () => {
          const wrappers = Array.from(container.querySelectorAll('.flxkit-toast-wrapper:not([data-removing="true"])')).reverse();
          
          const isExpanded = container.dataset.expanded === 'true';
          let offset = 0;

          container.style.pointerEvents = wrappers.length ? 'auto' : 'none';

          wrappers.forEach((w, i) => {
            if (isExpanded) {
              w.style.transform = `translate(0px, ${offset * dir}px) scale(1) rotate(0deg)`;
              offset += w.offsetHeight + 12; // 12px gap
              w.style.opacity = '1';
            } else {
              let x = 0, rot = 0;
              if (i !== 0) {
                rot = i % 2 === 1 ? i * -0.5 : i * 0.5;
                x = i % 2 === 1 ? -5 * i : 5 * i;
              }
              w.style.transform = `translate(${x}px, ${i * 3 * dir}px) scale(${Math.max(0, 1 - (i * 0.015))}) rotate(${rot}deg)`;
              w.style.opacity = i > 3 ? '0' : '1';
            }
            w.style.zIndex = 100 - i;
          });
        };

        container.addEventListener('mouseenter', container.updateStack);
        container.addEventListener('mouseleave', container.updateStack);

        let hoverTimeout;
        container.addEventListener('mouseenter', () => {
          clearTimeout(hoverTimeout);
          container.dataset.expanded = 'true';
          container.updateStack();
        });

        container.addEventListener('mouseleave', () => {
          hoverTimeout = setTimeout(() => {
            container.dataset.expanded = 'false';
            container.updateStack();
          }, 150); 
        });

        const observer = new MutationObserver(container.updateStack);
        observer.observe(container, { childList: true });

        rootElement.appendChild(container);
      }

      let animNameIn = `flxkit-notify-${activeConfig.animationType || 'bounce'}`;
      let animNameOut = `${animNameIn}-out`;
      if (activeConfig.animationType === 'custom' && activeConfig.customKeyframes) {
        container.appendChild(FluxKit.utils.createHTMLElement('style', { textContent: `@keyframes ${animNameIn} { ${activeConfig.customKeyframes} }` }));
      }
      if (activeConfig.animationType === 'custom' && activeConfig.customKeyframes) {
        animNameIn = `notify-custom-in-${id || FluxKit.utils.generateId()}`;
        animNameOut = activeConfig.customExitKeyframes ? `notify-custom-out-${id || Math.random().toString(36).substr(2, 5)}` : `flxkit-notify-fade-out`;
        
        const customStyle = `@keyframes ${animNameIn} { ${activeConfig.customKeyframes} }` +
          (activeConfig.customExitKeyframes ? ` @keyframes ${animNameOut} { ${activeConfig.customExitKeyframes} }` : '');
        container.appendChild(FluxKit.utils.createHTMLElement('style', { textContent: customStyle }));
      }

      if (id) {
        const isExpanded = container.dataset.expanded === 'true';
        if (!isExpanded) {
          const existingWrappers = container.querySelectorAll(`[data-toast-id="${id}"]`);
          existingWrappers.forEach(w => {
            w.dataset.removing = 'true';
            w.remove();
          });
        }
      }

      const wrapper = FluxKit.utils.createHTMLElement('div', { className: 'flxkit-toast-wrapper' });
      if (id) wrapper.dataset.toastId = id;

      Object.assign(wrapper.style, {
        gridArea: '1 / 1', width: '100%', boxSizing: 'border-box',
        position: 'relative', pointerEvents: 'auto',
        transition: 'transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.1), opacity 0.4s ease',
        transformOrigin: isTop ? 'top center' : 'bottom center'
      });

      const toast = FluxKit.utils.createHTMLElement('div', { className: 'flxkit-toast' });
      Object.assign(toast.style, {
        position: 'relative', overflow: 'hidden',
        fontSize: '13px', minWidth: '280px', maxWidth: '400px',
        padding: '12px 16px', backgroundColor: renderTheme.bg, color: renderTheme.text,
        borderRadius: activeConfig.borderRadius, boxShadow: renderTheme.boxShadow,
        fontFamily: activeConfig.fontFamily,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
        animation: `${animNameIn} 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.1) forwards`
      });

      const text = FluxKit.utils.createHTMLElement('div', { innerHTML: safeHTML(message), style: { flexGrow: '1', display: 'flex', alignItems: 'center', gap: '8px'} });

      if (icon) text.prepend(FluxKit.utils.createHTMLElement('span', { style: 'display:flex;align-items:center;', innerHTML: safeHTML(icon) }));

      const rightWrapper = FluxKit.utils.createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });

      const removeToast = () => {
        wrapper.dataset.removing = 'true';
        wrapper.style.opacity = '0';
        toast.style.animation = `${animNameOut} 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.1) forwards`;
        wrapper.style.transform = `scale(0.85) rotate(0deg)`;
        container.updateStack(); 
        setTimeout(() => wrapper.remove(), 400);
      };

      if (actionLabel && actionCallback) {
        rightWrapper.appendChild(
          FluxKit.utils.createHTMLElement('button', { textContent: actionLabel,
            style: {
              background: renderTheme.accentBg, color: renderTheme.btnColor,
              border: '1px solid rgba(128,128,128,0.2)', padding: '4px 10px',
              borderRadius: '6px', fontSize: '12px', cursor: 'pointer', transition: 'background 0.2s'
            },
            eventListener: {
              mouseover: (e) => { e.currentTarget.style.background = renderTheme.btnHoverBg },
              mouseout: (e) => { e.currentTarget.style.background = renderTheme.accentBg },
              click: () => { actionCallback(); removeToast(); }
            }
          })
        );
      }

      rightWrapper.appendChild(
        FluxKit.utils.createHTMLElement('button', { innerHTML: '✕',
          style: {
            background: 'transparent', border: 'none', padding: '0', pointerEvents: 'auto',
            color: renderTheme.text, cursor: 'pointer', opacity: '0.6', transition: 'opacity 0.2s',
            fontSize: '14px'
          },
          eventListener: {
            mouseover: (e) => { 
              e.currentTarget.style.opacity = '1'; 
              e.currentTarget.style.transform = 'rotate(90deg) scale(1.1)'; 
            },
            mouseout: (e) => { 
              e.currentTarget.style.opacity = '0.6';
              e.currentTarget.style.transform = 'rotate(0deg) scale(1)';
            },
            click: removeToast
          }
        })
      );

      const progress = FluxKit.utils.createHTMLElement('span', { className: 'flxkit-progress-bar',
        style: {
          position: 'absolute', left: '0', bottom: '0', height: '3px',
          width: '0%', borderRadius: '0', background: renderTheme.progressGradient,
          animation: `flxkit-progress ${duration}ms 0.1s linear forwards`
        }
      });

      progress.addEventListener('animationend', (e) => {
        if (e.animationName === 'flxkit-progress') removeToast();
      });

      toast.appendChild(progress);
      toast.appendChild(text);
      toast.appendChild(rightWrapper);

      wrapper.appendChild(toast);
      container.appendChild(wrapper);

      void wrapper.offsetHeight;
      container.updateStack();
    };
  }

  if (!FluxKit.ui.initContextMenu) {
    const ctxMenuRegistry = new Map();

    FluxKit.ui.initContextMenu = (config = {}) => {
      const namespace = config.namespace || 'default';

      if (ctxMenuRegistry.has(namespace)) {
        Object.assign(ctxMenuRegistry.get(namespace), config);
      } else {
        ctxMenuRegistry.set(namespace, {
          rootElement: document.body,
          fontFamily: 'system-ui, sans-serif',
          autoDark: true,
          ...config
        });
      }
    };

    FluxKit.ui.createContextMenu = (x, y, options, width = 160, overrides = {}) => {
      const namespace = overrides.namespace || 'default';

      let activeConfig = ctxMenuRegistry.get(namespace) || {
        rootElement: document.body, fontFamily: 'system-ui, sans-serif', autoDark: true
      };

      activeConfig = { ...activeConfig, ...overrides };
      const targetRoot = activeConfig.rootElement;

      const isDark = activeConfig.autoDark ? FluxKit.theme.isSystemDark() : !!activeConfig.darkMode;
      const theme = FluxKit.theme.get(isDark);

      const renderTheme = {
        bg: FluxKit.theme.ensureMinOpacity(activeConfig.bg || theme.bg),
        text: activeConfig.text || theme.text,
        border: activeConfig.border || theme.border,
        hoverBg: activeConfig.hoverBg || theme.hoverBg,
        hoverText: activeConfig.hoverText || theme.hoverText,
        separator: activeConfig.separator || theme.separator,
        font: activeConfig.fontFamily
      };

      const existingMenus = targetRoot.querySelectorAll('.flxkit-context-menu');
      existingMenus.forEach(m => m._destroy && m._destroy());

      const menu = FluxKit.utils.createHTMLElement('div', { className: 'flxkit-context-menu', tabIndex: 0, dataset: { namespace }});

      menu.style.setProperty('--ctx-bg', renderTheme.bg);
      menu.style.setProperty('--ctx-text', renderTheme.text);
      menu.style.setProperty('--ctx-border', renderTheme.border);
      menu.style.setProperty('--ctx-hover-bg', renderTheme.hoverBg);
      menu.style.setProperty('--ctx-hover-text', renderTheme.hoverText);
      menu.style.setProperty('--ctx-separator', renderTheme.separator);
      menu.style.setProperty('--ctx-font', renderTheme.font);

      Object.assign(menu.style, {
        pointerEvents: 'auto',
        position: 'fixed',
        background: 'var(--ctx-bg)',
        color: 'var(--ctx-text)',
        border: 'var(--ctx-border)',
        fontFamily: 'var(--ctx-font)',
        borderRadius: '8px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
        padding: '4px 0',
        opacity: '0',
        transform: 'translateY(-4px) scale(0.96)',
        transition: 'opacity 0.15s ease, transform 0.15s ease',
        zIndex: '999999',
        visibility: 'hidden',
        outline: 'none'
      });

      const items = [];
      const labels = [];
      let currentIndex = 0;

      const destroyMenu = () => {
        menu.remove();
        document.removeEventListener('mousedown', handleOutsideClick, true);
      };
      menu._destroy = destroyMenu;

      options.forEach((opt) => {
        if (opt.separator) {
          menu.appendChild(FluxKit.utils.createHTMLElement('div', { style: `height: 1px; background: var(--ctx-separator); margin: 4px 8px; pointer-events: none;` }));
          return;
        }

        const item = FluxKit.utils.createHTMLElement('div', { innerHTML: opt.label, dataset: { index: items.length } });

        if (opt.disabled) item.dataset.disabled = 'true';
        if (opt.title) {
          item.dataset.tooltip = opt.title;
          item.title = opt.title;
        }

        Object.assign(item.style, {
          padding: '8px 12px',
          cursor: opt.disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '13px',
          borderRadius: '4px',
          margin: '0 4px',
          opacity: '0',
          transform: 'translateY(-6px)',
          transition: 'background 0.15s ease, color 0.15s ease, opacity 0.2s ease, transform 0.2s ease',
          filter: opt.disabled ? 'grayscale(1)' : 'none'
        });

        if (opt.icon) {
          item.prepend(FluxKit.utils.createHTMLElement('span', { style: 'display:flex;align-items:center;gap:8px;', innerHTML: opt.icon }));
        }

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (opt.disabled) return;
          opt.action?.();
          destroyMenu();
        });

        item.addEventListener('mouseenter', (e) => {
          if (opt.disabled) return;

          if (items[currentIndex]) {
            items[currentIndex].style.background = 'transparent';
            items[currentIndex].style.color = 'var(--ctx-text)';
          }

          currentIndex = parseInt(item.dataset.index);

          if (items[currentIndex]) {
            items[currentIndex].style.background = 'var(--ctx-hover-bg)';
            items[currentIndex].style.color = 'var(--ctx-hover-text)';
          }
        });

        items.push(item);
        labels.push(opt.label.toLowerCase());
        menu.appendChild(item);
      });

      targetRoot.appendChild(menu);

      requestAnimationFrame(() => {
        const menuHeight = menu.offsetHeight;
        const menuWidth = menu.offsetWidth || width;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        let finalY = y;
        let finalX = x;

        if (y + menuHeight > viewportHeight - 10) finalY = viewportHeight - menuHeight - 10;
        if (finalY < 10) finalY = 10;

        if (x + menuWidth > viewportWidth - 10) finalX = viewportWidth - menuWidth - 10;
        if (finalX < 10) finalX = 10;

        Object.assign(menu.style, {
          top: `${finalY}px`,
          left: `${finalX}px`,
          minWidth: `${width}px`,
          visibility: 'visible',
          opacity: '1',
          transform: 'translateY(0) scale(1)'
        });

        items.forEach((el, i) => {
          setTimeout(() => {
            el.style.opacity = el.dataset.disabled === 'true' ? '0.5' : '1';
            el.style.transform = 'translateY(0)';
          }, i * 40);
        });

        menu.focus();

        if (items.length) {
          currentIndex = items.findIndex(el => el.dataset.disabled !== 'true');
          if (currentIndex === -1) currentIndex = 0;
          if (items[currentIndex] && items[currentIndex].dataset.disabled !== 'true') {
            items[currentIndex].style.background = 'var(--ctx-hover-bg)';
            items[currentIndex].style.color = 'var(--ctx-hover-text)';
          }
        }
      });

      let searchBuffer = '';
      let bufferTimeout = null;

      menu.addEventListener('keydown', (e) => {
        const resetCurrent = () => {
          if (items[currentIndex]) {
            items[currentIndex].style.background = 'transparent';
            items[currentIndex].style.color = 'var(--ctx-text)';
          }
        };
        const highlightCurrent = () => {
          if (items[currentIndex]) {
            items[currentIndex].style.background = 'var(--ctx-hover-bg)';
            items[currentIndex].style.color = 'var(--ctx-hover-text)';
          }
        };

        const moveFocus = (dir) => {
          let nextIndex = currentIndex;
          for (let i = 0; i < items.length; i++) {
            nextIndex = (nextIndex + dir + items.length) % items.length;
            if (items[nextIndex].dataset.disabled !== 'true') break;
          }
          if (items[nextIndex].dataset.disabled !== 'true') {
            resetCurrent();
            currentIndex = nextIndex;
            highlightCurrent();
          }
        };

        if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }

        if (e.key === 'Enter') {
          e.preventDefault();
          if (items[currentIndex] && items[currentIndex].dataset.disabled !== 'true') {
            items[currentIndex].click();
          }
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          destroyMenu();
        }

        if (e.key.length === 1 && /\w/.test(e.key)) {
          searchBuffer += e.key.toLowerCase();
          clearTimeout(bufferTimeout);
          bufferTimeout = setTimeout(() => (searchBuffer = ''), 800);

          const matchIndex = labels.findIndex((l, idx) => l.includes(searchBuffer) && items[idx].dataset.disabled !== 'true');
          if (matchIndex >= 0) {
            resetCurrent();
            currentIndex = matchIndex;
            highlightCurrent();
          }
        }
      });

      const handleOutsideClick = (e) => {
        if (!e.composedPath().includes(menu)) destroyMenu();
      };

      setTimeout(() => document.addEventListener('mousedown', handleOutsideClick, true), 0);
    };
  }

  if (!FluxKit.ui.initTooltips) {
    const initializedRoots = new WeakMap();

    FluxKit.ui.initTooltips = function(config = {}) {
      const currentRoot = config.rootElement || document;
      const targetAttr = config.attribute || 'data-tooltip';

      let rootConfigs = initializedRoots.get(currentRoot);
      if (!rootConfigs) {
        rootConfigs = new Map();
        initializedRoots.set(currentRoot, rootConfigs);
      }

      if (rootConfigs.has(targetAttr)) {
        const existingConfig = rootConfigs.get(targetAttr);
        Object.assign(existingConfig, config);
        return;
      }

      const instanceConfig = {
        rootElement: document.body,
        fontFamily: 'system-ui, sans-serif',
        delay: 400,
        attribute: 'data-tooltip',
        autoDark: true,
        ...config
      };

      rootConfigs.set(targetAttr, instanceConfig);

      const attrDelay = `${instanceConfig.attribute}-delay`;
      const attrInteractive = `data-tooltip-interactive`;

      const tooltipHTML = `
        <div class="flxkit-tooltip-box" style="
          position: relative;
          background: var(--tt-bg);
          color: var(--tt-text);
          border: var(--tt-border);
          font-family: var(--tt-font);
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 500;
          border-radius: 6px;
          white-space: normal;
          width: max-content;
          max-width: 320px;
          line-height: 1.4;
          word-wrap: break-word;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        ">
          <span class="flxkit-tooltip-text"></span>
        </div>
        <div class="flxkit-tooltip-arrow-wrapper" style="
          position: absolute;
          width: 14px;
          height: 7px;
          overflow: hidden;
          z-index: 2;
        ">
          <div class="flxkit-tooltip-arrow-inner" style="
            position: absolute;
            width: 10px;
            height: 10px;
            background: var(--tt-bg);
            border: var(--tt-border);
            transform: rotate(45deg);
            border-radius: 1px;
            box-sizing: border-box;
          "></div>
        </div>
      `;

      let tooltipTimer = null;
      const tooltipEl = FluxKit.utils.createHTMLElement('div', { className: 'flxkit-custom-tooltip', innerHTML: tooltipHTML,
        style: 'position: fixed; pointer-events: none; z-index: 2147483647; opacity: 0; transition: opacity 0.15s ease, transform 0.15s ease; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.15));'
       });

      const targetContainer = currentRoot.nodeType === Node.DOCUMENT_NODE
        ? (document.body || document.documentElement)
        : currentRoot;

      if (targetContainer) targetContainer.appendChild(tooltipEl);

      const boxEl = tooltipEl.querySelector('.flxkit-tooltip-box');
      const arrowWrapper = tooltipEl.querySelector('.flxkit-tooltip-arrow-wrapper');
      const arrowInner = tooltipEl.querySelector('.flxkit-tooltip-arrow-inner');
      const textEl = tooltipEl.querySelector('.flxkit-tooltip-text');

      tooltipEl.addEventListener('mouseenter', () => clearTimeout(tooltipEl._hideTimer));

      currentRoot.addEventListener('mouseover', (e) => {
        const target = e.target.closest(`[${instanceConfig.attribute}]`);
        if (!target) return;

        if (tooltipEl.parentNode !== targetContainer) {
          targetContainer.appendChild(tooltipEl);
        }

        clearTimeout(tooltipTimer);
        clearTimeout(tooltipEl._hideTimer);

        const text = target.getAttribute(instanceConfig.attribute);
        if (!text) return;

        const delayAttrVal = parseInt(target.getAttribute(attrDelay));
        const tooltipDelay = !isNaN(delayAttrVal) ? delayAttrVal : instanceConfig.delay;
        const isInteractive = target.hasAttribute(attrInteractive);

        if (target.title) {
          target.dataset.originalTitle = target.title;
          target.title = '';
        }

        tooltipTimer = setTimeout(() => {
          if (!target.isConnected || !currentRoot.contains(target)) return;

          const isDark = instanceConfig.autoDark ? FluxKit.theme.isSystemDark() : !!instanceConfig.darkMode;
          const theme = FluxKit.theme.get(isDark);

          tooltipEl.style.setProperty('--tt-bg', FluxKit.theme.ensureMinOpacity(instanceConfig.bg || theme.bg));
          tooltipEl.style.setProperty('--tt-text', instanceConfig.text || theme.text);
          tooltipEl.style.setProperty('--tt-border', instanceConfig.border || theme.border);
          tooltipEl.style.setProperty('--tt-font', instanceConfig.fontFamily || theme.fontFamily);

          tooltipEl.style.pointerEvents = isInteractive ? 'auto' : 'none';
          tooltipEl.dataset.isInteractive = isInteractive;

          textEl.innerHTML = safeHTML(text);
          tooltipEl.style.display = 'block';

          const rect = target.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) {
            tooltipEl.style.display = 'none';
            return;
          }

          tooltipEl.style.left = '0px';
          tooltipEl.style.top = '0px';
          const contextOffset = tooltipEl.getBoundingClientRect();

          let placement = 'top';
          
          let viewportY = rect.top - tooltipEl.offsetHeight - 8;

          if (viewportY < 10) {
            placement = 'bottom';
            viewportY = rect.bottom + 8;
          }

          let viewportX = rect.left + (rect.width / 2) - (tooltipEl.offsetWidth / 2);
          let clampedX = Math.max(10, Math.min(viewportX, window.innerWidth - tooltipEl.offsetWidth - 10));

          tooltipEl.style.left = `${clampedX - contextOffset.left}px`;
          tooltipEl.style.top = `${viewportY - contextOffset.top}px`;

          let targetCenter = rect.left + (rect.width / 2);
          let arrowX = targetCenter - clampedX;
          arrowWrapper.style.left = `${arrowX - 7}px`;

          tooltipEl.style.setProperty('--arrow-pos', `${arrowX}px`);
          const clipTop = `polygon(0% 0%, 100% 0%, 100% 100%, calc(var(--arrow-pos) + 6.5px) 100%, calc(var(--arrow-pos) + 6.5px) calc(100% - 1.5px), calc(var(--arrow-pos) - 6.5px) calc(100% - 1.5px), calc(var(--arrow-pos) - 6.5px) 100%, 0% 100%)`;
          const clipBottom = `polygon(0% 0%, calc(var(--arrow-pos) - 6.5px) 0%, calc(var(--arrow-pos) - 6.5px) 1.5px, calc(var(--arrow-pos) + 6.5px) 1.5px, calc(var(--arrow-pos) + 6.5px) 0%, 100% 0%, 100% 100%, 0% 100%)`;

          if (placement === 'top') {
            arrowWrapper.style.top = 'auto';
            arrowWrapper.style.bottom = '-6px';
            arrowInner.style.top = '-5px';
            arrowInner.style.left = '2px';
            arrowInner.style.borderTop = 'none';
            arrowInner.style.borderLeft = 'none';
            arrowInner.style.borderBottom = 'var(--tt-border)';
            arrowInner.style.borderRight = 'var(--tt-border)';

            boxEl.style.webkitClipPath = clipTop;
            boxEl.style.clipPath = clipTop;
            tooltipEl.style.transform = 'translateY(6px)';
          } else {
            arrowWrapper.style.bottom = 'auto';
            arrowWrapper.style.top = '-6px';
            arrowInner.style.top = '2px';
            arrowInner.style.left = '2px';
            arrowInner.style.borderBottom = 'none';
            arrowInner.style.borderRight = 'none';
            arrowInner.style.borderTop = 'var(--tt-border)';
            arrowInner.style.borderLeft = 'var(--tt-border)';

            boxEl.style.webkitClipPath = clipBottom;
            boxEl.style.clipPath = clipBottom;
            tooltipEl.style.transform = 'translateY(-6px)';
          }

          void tooltipEl.offsetWidth;
          tooltipEl.style.opacity = '1';
          tooltipEl.style.transform = 'translateY(0)';

        }, tooltipDelay);
      });

      currentRoot.addEventListener('mouseout', (e) => {
        const target = e.target.closest(`[${instanceConfig.attribute}]`);
        if (!target) return;

        clearTimeout(tooltipTimer);

        if (target.hasAttribute(attrInteractive)) return;

        if (tooltipEl) {
          tooltipEl.style.opacity = '0';
          tooltipEl.style.pointerEvents = 'none';
          const isTop = arrowWrapper.style.bottom === '-6px';
          tooltipEl.style.transform = isTop ? 'translateY(6px)' : 'translateY(-6px)';
        }
      });

      document.addEventListener('mousedown', (e) => {
        if (!tooltipEl || tooltipEl.style.opacity === '0') return;
        const path = e.composedPath();
        if (path.includes(tooltipEl)) return;
        const clickedTrigger = path.find(node =>
          node.nodeType === Node.ELEMENT_NODE &&
          node.hasAttribute &&
          node.hasAttribute(attrInteractive)
        );
        if (clickedTrigger && tooltipEl.dataset.isInteractive === 'true') return;
        tooltipEl.style.opacity = '0';
        tooltipEl.style.pointerEvents = 'none';
      }, true);

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && tooltipEl && tooltipEl.style.opacity === '1') {
          tooltipEl.style.opacity = '0';
          tooltipEl.style.pointerEvents = 'none';
        }
      }, true);

      FluxKit.utils.initPopupWindows(tooltipEl);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FluxKit.ui.initTooltips(), { once: true });
  } else {
    FluxKit.ui.initTooltips();
  }

  FluxKit.utils.toKebabCase = (str) => {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '');
  };

  FluxKit.utils.toCamelCase = (str) => {
    return str.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase());
  };

  FluxKit.ui.viewer ??= (function() {
    const viewerRegistry = new Map();
    const injectedRoots = new WeakSet();

    let customIcons = { close: '✖', download: '⬇️', file: '📄', code: '&lt;/&gt;' };
    let customRenderers = {};
    let extensionMap = {
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
      pdf: ['pdf'],
      text: ['txt', 'md', 'json', 'csv', 'xml', 'js', 'css', 'html', 'ini', 'log'],
      audio: ['mp3', 'wav', 'ogg', 'm4a'],
      video: ['mp4', 'webm']
    };

    function getCategory(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      for (const [category, extensions] of Object.entries(extensionMap)) {
        if (extensions.includes(ext)) return category;
      }
      return 'unsupported';
    }

    function downloadFile(filename, data) {
      let url = null;
      const isBlob = data instanceof Blob;
      if (typeof data === 'string' && data.startsWith('data:')) url = data;
      else if (isBlob) url = URL.createObjectURL(data);
      else if (typeof data === 'string') url = URL.createObjectURL(new Blob([data], { type: 'text/plain' }));
      if (!url) return;
      const a = FluxKit.utils.createHTMLElement('a', { href: url, download: filename, style: { display: 'none' } });
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); if (isBlob) URL.revokeObjectURL(url); }, 100);
    }

    const secureHtmlRenderer = (htmlText) => {
      const iframe = FluxKit.utils.createHTMLElement('iframe', {
        style: 'width: 100%; height: 100%; border: none; background: #fff; border-radius: 4px;'
      });
      iframe.setAttribute('sandbox', 'allow-scripts');
      setTimeout(() => {
        iframe.srcdoc = htmlText;
      }, 300);
      return iframe;
    };

    customRenderers['html'] = secureHtmlRenderer;
    customRenderers['htm'] = secureHtmlRenderer;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openViewers = document.querySelectorAll('.flxkit-viewer-backdrop');
        if (openViewers.length > 0) {
          const topmost = openViewers[openViewers.length - 1];
          if (topmost._destroy) topmost._destroy();
        }
      }
    }, true);

    return {
      init: function(config = {}) {
        const namespace = config.namespace || 'default';
        if (config.icons) customIcons = { ...customIcons, ...config.icons };

        if (viewerRegistry.has(namespace)) {
          Object.assign(viewerRegistry.get(namespace), config);
        } else {
          viewerRegistry.set(namespace, {
            rootElement: document.body,
            autoDark: true,
            fontFamily: 'system-ui, sans-serif',
            ...config
          });
        }
      },

      registerExtension: function(category, extensions) {
        if (!extensionMap[category]) extensionMap[category] = [];
        const extList = Array.isArray(extensions) ? extensions : [extensions];
        extensionMap[category].push(...extList.map(e => e.toLowerCase()));
      },

      registerRenderer: function(extension, renderFn) {
        customRenderers[extension.toLowerCase()] = renderFn;
      },

      open: function(filename, fileData, overrides = {}) {
        const namespace = overrides.namespace || 'default';

        let baseConfig = viewerRegistry.get(namespace) || {
          rootElement: document.body, autoDark: true, fontFamily: 'system-ui, sans-serif'
        };

        const activeConfig = { ...baseConfig, ...overrides };
        const rootNode = activeConfig.rootElement;

        const isDark = activeConfig.autoDark ? FluxKit.theme.isSystemDark() : !!activeConfig.darkMode;
        const theme = FluxKit.theme.get(isDark);

        const renderTheme = {
          bg: activeConfig.bg || theme.bg,
          text: activeConfig.text || theme.text,
          inputBg: activeConfig.inputBg || theme.hoverBg,
          border: activeConfig.border || theme.border,
          borderSubtle: activeConfig.borderSubtle || theme.separator,
          headerBg: activeConfig.headerBg || theme.accentBg,
          btnHoverBg: activeConfig.btnHoverBg || theme.btnHoverBg,
          boxShadow: activeConfig.boxShadow || theme.boxShadow,
          accentText: activeConfig.accentText || (isDark ? '#60a5fa' : '#2563eb')
        };

        if (!injectedRoots.has(rootNode)) {
          const styleString = `
            .flxkit-viewer-backdrop {
              pointer-events: auto; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
              background: rgba(15, 15, 15, 0.85); z-index: 999999;
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              opacity: 0; transition: opacity 0.1s ease-out; will-change: opacity;
            }
            .flxkit-viewer-backdrop.active { opacity: 1; }

            .flxkit-viewer-container {
              pointer-events: auto; width: 90vw; max-width: 1200px; height: 90vh;
              display: flex; flex-direction: column;
              background: var(--fluxkit-bg); color: var(--fluxkit-text); font-family: var(--fluxkit-font);
              overflow: hidden; position: relative; border: 1px solid var(--fluxkit-border-subtle) !important;
              box-shadow: 0 20px 50px rgba(0,0,0,0.5) !important; border-radius: 8px;
              contain: strict; backface-visibility: hidden; will-change: transform;
              transform: translate3d(0, 20px, 0); transition: transform 0.2s cubic-bezier(0.0, 0.0, 0.2, 1);
            }
            .flxkit-viewer-backdrop.active .flxkit-viewer-container { transform: translate3d(0, 0, 0); }
            .flxkit-viewer-backdrop.image-mode { background: rgba(0, 0, 0, 0.85); }
            .flxkit-viewer-container.image-mode {
              background: transparent; border: none !important; box-shadow: none !important;
              width: 100vw; height: 100vh; max-width: none; max-height: none; border-radius: 0;
              backdrop-filter: none; -webkit-backdrop-filter: none;
            }
            .flxkit-viewer-header {
              display: flex; justify-content: space-between; align-items: center; gap: 16px;
              padding: 12px 16px; background: var(--fluxkit-header-bg); color: var(--fluxkit-accent-text);
              border-bottom: 1px solid var(--fluxkit-border-subtle);
            }
            .image-mode .flxkit-viewer-header {
              position: absolute; top: 0; left: 0; right: 0; background: transparent;
              border: none; padding: 20px 24px; z-index: 10; color: rgba(255, 255, 255, 0.95);
            }
            .image-mode .flxkit-viewer-header h3 { text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
            .flxkit-viewer-header .flxkit-icon-action-btn {
              width: 28px; height: 28px; border-radius: 50%; font-size: 12px;
              display: flex; align-items: center; justify-content: center;
              background: transparent; color: var(--fluxkit-accent-text); opacity: 0.8;
              border: none; cursor: pointer; transition: all 0.2s ease;
            }
            .flxkit-viewer-header .flxkit-icon-action-btn:hover {
              opacity: 1; background: var(--fluxkit-btn-hover-bg);
            }
            .image-mode .flxkit-viewer-header .flxkit-icon-action-btn { background: rgba(0,0,0,0.4); color: #fff; opacity: 0.9; }
            .image-mode .flxkit-viewer-header .flxkit-icon-action-btn:hover { background: rgba(0,0,0,0.7); opacity: 1; }
            .flxkit-viewer-content {
              flex-grow: 1; display: flex; align-items: center; justify-content: center;
              overflow: hidden; position: relative; padding: 16px; min-height: 0;
              opacity: 0; transition: opacity 0.12s ease-in;
            }
            .flxkit-viewer-content.loaded { opacity: 1; }
            .image-mode .flxkit-viewer-content { padding: 0; width: 100%; height: 100%; }
            .flxkit-viewer-content pre {
              width: 100%; height: 100%; overflow: auto; margin: 0;
              background: var(--fluxkit-input-bg); color: var(--fluxkit-text);
              font-family: monospace; padding: 16px; border-radius: 4px;
              border: 1px solid var(--fluxkit-border-subtle);
              white-space: pre-wrap; word-wrap: break-word; font-size: 13px;
            }
            .flxkit-custom-render-wrapper {
              width: 100%; height: 100%; overflow-y: auto; margin: 0;
              background: var(--fluxkit-input-bg); color: var(--fluxkit-text);
              padding: 16px; border-radius: 4px; border: 1px solid var(--fluxkit-border-subtle);
            }
            .flxkit-viewer-content .flxkit-image-render {
              max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: 4px;
              box-shadow: 0 4px 30px rgba(0,0,0,0.4);
            }
            .flxkit-viewer-content audio {
              background: var(--fluxkit-input-bg); padding: 20px; border-radius: 50px;
              box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            }
            .flxkit-viewer-content video {
              background: #000; box-shadow: 0 4px 30px rgba(0,0,0,0.4);
              max-width: 100%; max-height: 100%; border-radius: 4px;
            }
            .flxkit-viewer-content a, .flxkit-custom-render-wrapper a {
              color: var(--fluxkit-accent-text); text-decoration: underline;
              text-decoration-color: var(--fluxkit-accent-text); text-underline-offset: 2px;
              transition: color 0.1s ease, text-decoration-color 0.1s ease;
            }
            .flxkit-viewer-content a:hover, .flxkit-custom-render-wrapper a:hover {
              color: var(--fluxkit-accent-text-hover); text-decoration-color: var(--fluxkit-accent-text-hover);
            }
          `;
          const targetContainer = rootNode.nodeType === Node.DOCUMENT_NODE ? document.head : rootNode;
          targetContainer.appendChild(FluxKit.utils.createHTMLElement('style', { textContent: styleString }));
          injectedRoots.add(rootNode);
        }

        const ext = filename.split('.').pop().toLowerCase();
        const category = getCategory(filename);
        const isBlob = fileData instanceof Blob;
        const renderUrl = isBlob ? URL.createObjectURL(fileData) : fileData;

        let isDestroyed = false;
        let backdrop = null;

        const closeViewer = () => {
          if (isDestroyed) return;
          isDestroyed = true;
          if (!backdrop) return;
          backdrop.classList.remove('active');
          const destroyDOM = () => {
            if (backdrop.parentNode) backdrop.remove();
            if (isBlob) URL.revokeObjectURL(renderUrl);
          };
          backdrop.addEventListener('transitionend', (e) => {
            if (e.propertyName === 'opacity') destroyDOM();
          }, { once: true });
          setTimeout(destroyDOM, 300);
        };

        let contentElement;
        let rawData = null;
        let renderedData = null;
        let isRawMode = false;

        const headerActions = FluxKit.utils.createHTMLElement('div', {
          style: 'display: flex; gap: 12px; align-items: center;'
        });

        if (customRenderers[ext]) {
          contentElement = FluxKit.utils.createHTMLElement('div', {
            class: 'flxkit-custom-render-wrapper',
            textContent: 'Loading preview...'
          });

          const renderCurrentView = () => {
            if (isDestroyed) return;
            contentElement.innerHTML = safeHTML('');
            if (isRawMode) {
              const pre = FluxKit.utils.createHTMLElement('pre', {
                textContent: rawData,
                style: 'border: none; padding: 0; margin: 0; height: 100%; box-sizing: border-box; background: transparent;'
              });
              contentElement.appendChild(pre);
            } else {
              if (renderedData instanceof HTMLElement) contentElement.appendChild(renderedData);
              else contentElement.innerHTML = safeHTML(renderedData);
            }
          };

          Promise.resolve().then(async () => {
            rawData = (isBlob && category === 'text') ? await fileData.text() : fileData;
            renderedData = await customRenderers[ext](rawData, { filename, category, isBlob });
            renderCurrentView();
          }).catch(err => {
            if (!isDestroyed) contentElement.textContent = 'Error rendering preview: ' + err.message;
          });

          if (category === 'text') {
            headerActions.appendChild(FluxKit.utils.createHTMLElement('button', {
              class: 'flxkit-icon-action-btn',
              innerHTML: customIcons.code,
              dataset: { [FluxKit.utils.toCamelCase(`flxkvw-${namespace}-tooltip`)]: 'Toggle Source' },
              eventListener: () => { isRawMode = !isRawMode; renderCurrentView(); }
            }));
          }
        }
        else if (category === 'image') {
          contentElement = FluxKit.utils.createHTMLElement('img', {
            class: 'flxkit-image-render', src: renderUrl, decoding: 'async',
            eventListener: { click: (e) => { e.stopPropagation(); if (e.metaKey || e.ctrlKey) window.open(renderUrl, '_blank'); } }
          });
        }
        else if (category === 'pdf') { contentElement = FluxKit.utils.createHTMLElement('iframe', { src: renderUrl, style: 'width: 100%; height: 100%; border: none; background: #fff; border-radius: 4px;' }); }
        else if (category === 'audio') { contentElement = FluxKit.utils.createHTMLElement('audio', { src: renderUrl, preload: 'metadata', controls: true, style: 'width: 80%;' }); }
        else if (category === 'video') { contentElement = FluxKit.utils.createHTMLElement('video', { src: renderUrl, preload: 'metadata', controls: true }); }
        else if (category === 'text') {
          contentElement = FluxKit.utils.createHTMLElement('pre', { textContent: isBlob ? 'Loading text...' : fileData });
          if (isBlob) fileData.text().then(text => { if (!isDestroyed) contentElement.textContent = text; });
        }
        else {
          contentElement = FluxKit.utils.createHTMLElement('div', {
            style: 'display: flex; flex-direction: column; align-items: center; gap: 16px; opacity: 0.8;',
            children: [
              FluxKit.utils.createHTMLElement('div', { innerHTML: customIcons.file, style: 'font-size: 48px;' }),
              FluxKit.utils.createHTMLElement('div', { textContent: 'No preview available for this file format.' })
            ]
          });
        }

        headerActions.appendChild(FluxKit.utils.createHTMLElement('button', { class: 'flxkit-icon-action-btn', innerHTML: customIcons.download, dataset: { [FluxKit.utils.toCamelCase(`flxkvw-${namespace}-tooltip`)]:'Download' }, eventListener: () => downloadFile(filename, fileData) }));
        headerActions.appendChild(FluxKit.utils.createHTMLElement('button', { class: 'flxkit-icon-action-btn', innerHTML: customIcons.close, dataset: { [FluxKit.utils.toCamelCase(`flxkvw-${namespace}-tooltip`)]:'Close' }, eventListener: closeViewer }));

        backdrop = FluxKit.utils.createHTMLElement('div', {
          class: `flxkit-viewer-backdrop ${category === 'image' && !customRenderers[ext] ? 'image-mode' : ''}`,
          eventListener: { click: closeViewer },
          children: [
            FluxKit.utils.createHTMLElement('div', {
              class: `flxkit-viewer-container ${category === 'image' && !customRenderers[ext] ? 'image-mode' : ''}`,
              eventListener: { click: (e) => { if (category !== 'image' || customRenderers[ext]) e.stopPropagation(); else if (e.target.closest('.flxkit-viewer-header')) e.stopPropagation(); } },
              children: [
                FluxKit.utils.createHTMLElement('div', {
                  class: 'flxkit-viewer-header',
                  children: [
                    FluxKit.utils.createHTMLElement('h3', { textContent: filename, style: 'margin: 0; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw;' }),
                    headerActions
                  ]
                }),
                FluxKit.utils.createHTMLElement('div', { class: 'flxkit-viewer-content', children: [contentElement] })
              ]
            })
          ]
        });

        backdrop.style.setProperty('--fluxkit-bg', renderTheme.bg);
        backdrop.style.setProperty('--fluxkit-text', renderTheme.text);
        backdrop.style.setProperty('--fluxkit-input-bg', renderTheme.inputBg);
        backdrop.style.setProperty('--fluxkit-font', activeConfig.fontFamily);
        backdrop.style.setProperty('--fluxkit-border', renderTheme.border);
        backdrop.style.setProperty('--fluxkit-border-subtle', renderTheme.borderSubtle);
        backdrop.style.setProperty('--fluxkit-header-bg', renderTheme.headerBg);
        backdrop.style.setProperty('--fluxkit-btn-hover-bg', renderTheme.btnHoverBg);
        backdrop.style.setProperty('--fluxkit-box-shadow', renderTheme.boxShadow);
        backdrop.style.setProperty('--fluxkit-accent-text', renderTheme.accentText);
        backdrop.style.setProperty('--fluxkit-accent-text-hover', renderTheme.accentText + (isDark ? 'cc' : 'dd'));

        backdrop._destroy = closeViewer;
        rootNode.appendChild(backdrop);
        const contentWrapper = backdrop.querySelector('.flxkit-viewer-content');

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            backdrop.classList.add('active');
            setTimeout(() => {
              if (isDestroyed) return;
              contentWrapper.appendChild(contentElement);
              void contentWrapper.offsetWidth;
              contentWrapper.classList.add('loaded');
            }, 120);
          });
        });
      },

      updateTheme: function(themeOptions, namespace = 'default') {
        let baseConfig = viewerRegistry.get(namespace) || {
          rootElement: document.body, autoDark: true, fontFamily: 'system-ui, sans-serif'
        };

        if (themeOptions.darkMode !== undefined) {
          themeOptions.autoDark = false;
        }

        const activeConfig = { ...baseConfig, ...themeOptions };
        viewerRegistry.set(namespace, activeConfig);

        const isDark = activeConfig.autoDark ? FluxKit.theme.isSystemDark() : !!activeConfig.darkMode;
        const theme = FluxKit.theme.get(isDark);

        const renderTheme = {
          bg: activeConfig.bg || theme.bg,
          text: activeConfig.text || theme.text,
          inputBg: activeConfig.inputBg || theme.hoverBg,
          border: activeConfig.border || theme.border,
          borderSubtle: activeConfig.borderSubtle || theme.separator,
          headerBg: activeConfig.headerBg || theme.accentBg,
          btnHoverBg: activeConfig.btnHoverBg || theme.btnHoverBg,
          boxShadow: activeConfig.boxShadow || theme.boxShadow,
          accentText: activeConfig.accentText || (isDark ? '#60a5fa' : '#2563eb')
        };

        const targetRoot = activeConfig.rootElement;
        const openViewers = targetRoot.querySelectorAll('.flxkit-viewer-backdrop');
                
        FluxKit.ui.initTooltips({  ...theme, ...renderTheme, rootElement: targetRoot, attribute: `data-flxkvw-${FluxKit.utils.toKebabCase(namespace)}-tooltip` });


        openViewers.forEach(backdrop => {
          backdrop.style.setProperty('--fluxkit-bg', renderTheme.bg);
          backdrop.style.setProperty('--fluxkit-text', renderTheme.text);
          backdrop.style.setProperty('--fluxkit-input-bg', renderTheme.inputBg);
          backdrop.style.setProperty('--fluxkit-font', activeConfig.fontFamily);
          backdrop.style.setProperty('--fluxkit-border', renderTheme.border);
          backdrop.style.setProperty('--fluxkit-border-subtle', renderTheme.borderSubtle);
          backdrop.style.setProperty('--fluxkit-header-bg', renderTheme.headerBg);
          backdrop.style.setProperty('--fluxkit-btn-hover-bg', renderTheme.btnHoverBg);
          backdrop.style.setProperty('--fluxkit-box-shadow', renderTheme.boxShadow);
          backdrop.style.setProperty('--fluxkit-accent-text', renderTheme.accentText);
          backdrop.style.setProperty('--fluxkit-accent-text-hover', renderTheme.accentText + (isDark ? 'cc' : 'dd'));
        });
      }
    };
  })();

  FluxKit.api ??= {
    githubGist: {
      verifyCredentials: function(token) {
        return new Promise((resolve) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://api.github.com/user',
            headers: { 'Authorization': `token ${token}` },
            onload: (res) => resolve(res.status === 200),
            onerror: () => resolve(false)
          });
        });
      },

      createNewGist: function(token, description = 'Universal Notes Storage') {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://api.github.com/gists',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            data: JSON.stringify({
              description,
              public: false,
              files: { 'notes.json': { content: '{}' } }
            }),
            onload: (res) => {
              if (res.status === 201) {
                resolve(JSON.parse(res.responseText).id);
              } else {
                reject(new Error(`Failed to create Gist: ${res.statusText}`));
              }
            },
            onerror: () => reject(new Error('Network error creating Gist'))
          });
        });
      },

      verifyGistAccess: function(token, gistId) {
        return new Promise((resolve) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.github.com/gists/${gistId}`,
            headers: { 'Authorization': `token ${token}` },
            onload: (res) => resolve(res.status === 200),
            onerror: () => resolve(false)
          });
        });
      },

      uploadDataToGistFile: function uploadDataToGistFile(gistFileName, gistId, token, data, isBulk = false) {
        return new Promise((resolve, reject) => {
          let payload = {};

          if (isBulk === true) {
            if (!data?.files || typeof data.files !== "object") {
              return reject(new Error("Bulk upload requires a { files: {...} } object"));
            }
            payload = data;
          } else {
            payload = {
              files: {
                [gistFileName]: {
                  content: typeof data === "string" ? data : JSON.stringify(data, null, 2)
                }
              }
            };
          }

          GM_xmlhttpRequest({
            method: "PATCH",
            url: `https://api.github.com/gists/${gistId}`,
            headers: Object.assign(
              { "Content-Type": "application/json" },
              token ? { "Authorization": `token ${token}` } : {}
            ),
            data: JSON.stringify(payload),
            onload: (res) => {
              if (res.status === 200) {
                try {
                  resolve(JSON.parse(res.responseText));
                } catch {
                  resolve(res.responseText);
                }
              } else {
                reject({ status: res.status, text: res.responseText });
              }
            },
            onerror: () => reject({ error: new Error("Upload request failed") })
          });
        });
      },

      fetchGistFiles: function fetchGistFiles(gistId, token = null) {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.github.com/gists/${gistId}`,
            headers: token ? { 'Authorization': `token ${token}` } : {},
            onload: (res) => {
              if (res.status !== 200) {
                return reject({ status: res.status, text: res.responseText });
              }
              try {
                const data = JSON.parse(res.responseText);
                if (!data.files) throw new Error("No files found in gist");
                resolve(data);
              } catch (e) {
                reject({ error: new Error('Failed to parse Gist response: ' + e.message) });
              }
            },
            onerror: () => reject({ error: new Error('Fetch request failed') })
          });
        });
      }
    },

    githubRepo: {
      request: function(method, endpoint, token, data = null, responseType = 'json') {
        return new Promise((resolve, reject) => {
          const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;
          const options = {
            method: method,
            url: url,
            headers: {
              'Authorization': `token ${token}`,
              'Accept': 'application/vnd.github.v3+json',
              'X-GitHub-Api-Version': '2022-11-28'
            },
            responseType: responseType === 'blob' ? 'blob' : 'text',
            onload: (res) => {
              if (res.status >= 200 && res.status < 300) {
                if (responseType === 'blob') resolve(res.response);
                else resolve(res.responseText && responseType === 'json' ? JSON.parse(res.responseText) : res.responseText);
              } else if (res.status === 404) {
                resolve(null);
              } else {
                reject(new Error(`GitHub API: ${res.status} - ${res.responseText}`));
              }
            },
            onerror: () => reject(new Error('Network Error'))
          };
          if (data) options.data = JSON.stringify(data);
          GM_xmlhttpRequest(options);
        });
      },

      ensureRepo: async function(token, repoName) {
        const safeRepoName = repoName.replace(/\s+/g, '-');

        const user = await FluxKit.api.githubRepo.request('GET', '/user', token);
        if (!user) throw new Error("Invalid Token");

        const repo = await FluxKit.api.githubRepo.request('GET', `/repos/${user.login}/${safeRepoName}`, token);
        if (!repo) {
          await FluxKit.api.githubRepo.request('POST', '/user/repos', token, {
            name: safeRepoName,
            private: true,
            description: "Created automatically by SyncWizard"
          });
        }
        return { owner: user.login, repo: safeRepoName };
      },

      fetchAllFiles: async function(token, owner, repo, folderPath) {
        const path = folderPath ? `/${folderPath}` : '';
        const items = await FluxKit.api.githubRepo.request('GET', `/repos/${owner}/${repo}/contents${path}`, token);

        if (!items || !Array.isArray(items)) return { files: {} };

        const files = {};
        for (const item of items) {
          if (item.type === 'file') {
            const isText = item.name.match(/\.(json|txt|md|csv|xml|js|css|html)$/i);
            const responseType = isText ? 'text' : 'blob';
            // Download raw file directly to avoid base64 decoding overhead on fetch
            const content = await FluxKit.api.githubRepo.request('GET', item.download_url, token, null, responseType);
            if (content) files[item.name] = { content };
          }
        }
        return { files };
      },

      toBase64: async function(content) {
        let buffer;
        if (content instanceof Blob) {
          buffer = await content.arrayBuffer();
        } else {
          const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
          buffer = new TextEncoder().encode(text).buffer;
        }
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i += 8192) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        return btoa(binary);
      },

      uploadFile: async function(token, owner, repo, folderPath, filename, content) {
        const fullPath = [folderPath, filename].filter(Boolean).join('/');
        const endpoint = `/repos/${owner}/${repo}/contents/${fullPath}`;

        // Fetch file first to get its 'sha' (GitHub requires this to update an existing file)
        const existing = await FluxKit.api.githubRepo.request('GET', endpoint, token);
        const sha = existing ? existing.sha : undefined;

        // Convert payload to Base64
        const b64Content = await FluxKit.api.githubRepo.toBase64(content);

        await FluxKit.api.githubRepo.request('PUT', endpoint, token, {
          message: `Sync ${filename}`,
          content: b64Content,
          sha: sha
        });
        return true;
      }
    },

    webdav: {
      verifyCredentials: function(url, username, password) {
        return new Promise((resolve) => {
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            console.error("WebDAV URL must start with http:// or https://");
            return resolve(false);
          }
          GM_xmlhttpRequest({
            method: 'PROPFIND',
            url: url.replace(/\/$/, ''),
            headers: { 'Authorization': 'Basic ' + btoa(`${username}:${password}`), 'Depth': '0' },
            onload: (res) => {
            if (res.status >= 200 && res.status < 300) resolve(true);
            else {
              console.error(`WebDAV Auth Failed: HTTP ${res.status}`, res.responseText);
              resolve(false);
            }
          },
          onerror: (err) => {
            console.error("Tampermonkey Network Error:", err);
            resolve(false);
          },
          onabort: () => resolve(false),
          ontimeout: () => resolve(false)
          });
        });
      },

      ensureDirectory: async function(baseUrl, folderPath, username, password) {
        if (!folderPath) return baseUrl.replace(/\/$/, ''); // No folder specified, use root

        const parts = folderPath.split('/').filter(Boolean);
        let currentUrl = baseUrl.replace(/\/$/, '');

        for (const part of parts) {
          currentUrl += '/' + encodeURIComponent(part);

          const exists = await new Promise((resolve) => {
            GM_xmlhttpRequest({
              method: 'PROPFIND',
              url: currentUrl,
              headers: { 'Authorization': 'Basic ' + btoa(`${username}:${password}`), 'Depth': '0' },
              onload: (res) => resolve(res.status >= 200 && res.status < 300),
              onerror: () => resolve(false)
            });
          });

          if (!exists) {
            await new Promise((resolve, reject) => {
              GM_xmlhttpRequest({
                method: 'MKCOL',
                url: currentUrl,
                headers: { 'Authorization': 'Basic ' + btoa(`${username}:${password}`) },
                onload: (res) => {
                  if (res.status === 201 || res.status === 405) resolve(true);
                  else reject(new Error(`Failed to create directory ${part}: ${res.status}`));
                },
                onerror: () => reject(new Error('Network error during directory creation'))
              });
            });
          }
        }
        return currentUrl; // Returns the final resolved URL
      },

      fetchFile: function(targetUrl, username, password, filename, responseType = 'text') {
        return new Promise((resolve) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: `${targetUrl}/${filename}`,
            headers: { 'Authorization': 'Basic ' + btoa(`${username}:${password}`) },
            responseType: responseType === 'blob' ? 'blob' : 'text',
            onload: (res) => {
              if (res.status !== 200) return resolve(null);
              resolve(responseType === 'blob' ? res.response : res.responseText);
            },
            onerror: () => resolve(null)
          });
        });
      },

      fetchAllFiles: function(targetUrl, username, password) {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'PROPFIND',
            url: targetUrl,
            headers: { 'Authorization': 'Basic ' + btoa(`${username}:${password}`), 'Depth': '1' },
            onload: async (res) => {
              if (res.status < 200 || res.status >= 300) return resolve({ files: {} });

              const hrefs = [...res.responseText.matchAll(/<d:href.*?>([^<]+)<\/d:href>/gi)];
              const filenames = hrefs.map(m => m[1].split('/').pop()).filter(f => f && f.includes('.'));

              const files = {};
              for (const file of filenames) {
                // If it's a known text format, fetch as text. Otherwise, Blob.
                const isText = file.match(/\.(json|txt|md|csv|xml|js|css|html)$/i);
                const responseType = isText ? 'text' : 'blob';

                const content = await FluxKit.api.webdav.fetchFile(targetUrl, username, password, file, responseType);
                if (content) files[file] = { content };
              }
              resolve({ files });
            },
            onerror: () => reject(new Error('Network error during directory scan'))
          });
        });
      },

      uploadFile: function(targetUrl, username, password, filename, content) {
        return new Promise((resolve, reject) => {
          let payload = content;
          let contentType = 'text/plain';

          if (content instanceof Blob) {
            payload = content;
            contentType = content.type || 'application/octet-stream';
          } else if (typeof content === 'object') {
            payload = JSON.stringify(content, null, 2);
            contentType = 'application/json';
          } else if (typeof content === 'string') {
            payload = content;
          }

          GM_xmlhttpRequest({
            method: 'PUT',
            url: `${targetUrl}/${filename}`,
            headers: {
              'Authorization': 'Basic ' + btoa(`${username}:${password}`),
              'Content-Type': contentType
            },
            data: payload,
            onload: (res) => (res.status >= 200 && res.status < 300) ? resolve(true) : reject(new Error(res.status)),
            onerror: () => reject(new Error('Network error'))
          });
        });
      }
    },

    dropbox: {
      exchangeAuthCode: async (appKey, appSecret, authCode) => {
        const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: authCode,
            grant_type: 'authorization_code',
            client_id: appKey,
            client_secret: appSecret
          })
        });
        const tokens = await res.json();
        if (!res.ok) throw new Error(tokens.error_description || 'Failed to exchange Auth Code.');
        if (!tokens.refresh_token) throw new Error('Dropbox did not provide an offline token. Go to Dropbox -> Settings -> Connected Apps, disconnect this app, and try again.');
        return tokens;
      },

      refreshAccessToken: async (appKey, appSecret, refreshToken) => {
        const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            client_id: appKey,
            client_secret: appSecret
          })
        });
        const tokens = await res.json();
        if (!res.ok) throw new Error(`Refresh failed: ${tokens.error_description || 'Unknown error'}`);
        return tokens;
      },

      request: async (token, endpoint, isContent = false, arg = null, body = null, returnType = 'json') => {
        const domain = isContent ? 'content.dropboxapi.com' : 'api.dropboxapi.com';

        // Fix Unicode characters crashing HTTP headers
        const apiArg = arg ? JSON.stringify(arg).replace(/[\u007F-\uFFFF]/g, chr => '\\u' + ('0000' + chr.charCodeAt(0).toString(16)).substr(-4)) : null;

        const headers = { 'Authorization': `Bearer ${token}` };
        if (apiArg) headers['Dropbox-API-Arg'] = apiArg;

        let finalBody = body;

        if (isContent && body) {
          headers['Content-Type'] = 'application/octet-stream';
          // Force raw binary to prevent browser from hijacking the MIME type
          if (body instanceof Blob) finalBody = await body.arrayBuffer();
          else if (typeof body === 'string') finalBody = new TextEncoder().encode(body);
        } else if (!isContent && body) {
          headers['Content-Type'] = 'application/json';
          finalBody = JSON.stringify(body);
        }

        const res = await fetch(`https://${domain}/2/${endpoint}`, { method: 'POST', headers, body: finalBody });
        if (!res.ok) throw Object.assign(new Error(`Dropbox API: ${res.statusText}`), { status: res.status });
        return returnType === 'blob' ? await res.blob() : (returnType === 'text' ? await res.text() : await res.json());
      },

      fetchFile: async (token, filePath, responseType = 'text') => {
        try {
          return await FluxKit.api.dropbox.request(token, 'files/download', true, { path: filePath }, null, responseType);
        } catch (e) {
          if (e.status === 409) return null; // 409 = File/Folder not found
          throw e;
        }
      },

      fetchAllFiles: async (token, basePath) => {
        const allFiles = {};
        try {
          let hasMore = true, cursor = null;
          while (hasMore) {
            const payload = cursor ? { cursor } : { path: basePath, recursive: true };
            const endpoint = cursor ? 'files/list_folder/continue' : 'files/list_folder';
            const result = await FluxKit.api.dropbox.request(token, endpoint, false, null, payload);

            for (const entry of result.entries) {
              if (entry['.tag'] === 'file') {
                const relativePath = entry.path_display.substring(basePath.length + 1);
                const isText = relativePath.match(/\.(json|txt|md|csv|xml|js|css|html)$/i);
                const content = await FluxKit.api.dropbox.fetchFile(token, entry.path_display, isText ? 'text' : 'blob');
                if (content !== null) allFiles[relativePath] = { content };
              }
            }
            hasMore = result.has_more;
            cursor = result.cursor;
          }
        } catch (e) {
          if (e.status !== 409) throw e;
        }
        return allFiles;
      },

      uploadFile: async (token, filePath, content) => {
        const argObj = { path: filePath, mode: 'overwrite', autorename: false, mute: true };
        return await FluxKit.api.dropbox.request(token, 'files/upload', true, argObj, content, 'json');
      }
    },

    onedrive: {
      exchangeAuthCode: async (clientId, clientSecret, authCode) => {
        return new Promise((resolve, reject) => {
          const params = new URLSearchParams({
            client_id: clientId,
            code: authCode,
            redirect_uri: 'http://localhost',
            grant_type: 'authorization_code',
          });
          if (clientSecret) params.append('client_secret', clientSecret);

          GM_xmlhttpRequest({
            method: "POST",
            url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            data: params.toString(),
            onload: (res) => {
              const tokens = JSON.parse(res.responseText);
              if (res.status === 200) resolve(tokens);
              else reject(new Error(tokens.error_description || 'Auth Failed'));
            },
            onerror: reject
          });
        });
      },

      refreshAccessToken: async (clientId, clientSecret, refreshToken) => {
        return new Promise((resolve, reject) => {
          const params = new URLSearchParams({
            client_id: clientId,
            refresh_token: refreshToken,
            redirect_uri: 'http://localhost',
            grant_type: 'refresh_token',
            scope: 'offline_access https://graph.microsoft.com/Files.ReadWrite'
          });
          if (clientSecret) params.append('client_secret', clientSecret);

          GM_xmlhttpRequest({
            method: "POST",
            url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            data: params.toString(),
            onload: (res) => {
              if (res.status === 200) resolve(JSON.parse(res.responseText));
              else reject(new Error('Refresh Failed'));
            },
            onerror: reject
          });
        });
      },

      request: async (token, path, method = 'GET', body = null, isContent = false) => {
        let cleanPath = path.replace(/^\/+/, '').replace(/\/+$/, '');
        let url;

        if (cleanPath === "") {
          url = `https://graph.microsoft.com/v1.0/me/drive/root${isContent ? '/content' : '/children'}`;
        } else {
          const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');
          url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:${isContent ? '/content' : '/children'}`;
        }

        return new Promise((resolve, reject) => {
          const details = {
            method: method,
            url: url,
            anonymous: true,
            headers: {
              "Authorization": "Bearer " + token.trim(),
              "Accept": "application/json",
              "ConsistencyLevel": "eventual"
            },
            responseType: (isContent && method === 'GET') ? 'blob' : 'json'
          };

          if (body && (method === 'PUT' || method === 'POST')) {
            details.headers["Content-Type"] = body instanceof Blob ? (body.type || 'application/octet-stream') : 'application/json';
            details.data = body instanceof Blob ? body : (typeof body === 'string' ? body : JSON.stringify(body));
          }

          details.onload = (res) => {
            if (res.status >= 200 && res.status < 300) {
              if (method === 'GET' && isContent) resolve(res.response);
              else resolve(res.responseText ? JSON.parse(res.responseText) : {});
            } else {
              let msErrorMsg = res.statusText;
              try {
                const msError = JSON.parse(res.responseText);
                msErrorMsg = msError.error.message || msError.error.code || res.responseText;
              } catch(e) {
                msErrorMsg = res.responseText || res.statusText;
              }

              reject(Object.assign(new Error(`OneDrive API Error (${res.status}): ${msErrorMsg}`), { status: res.status }));
            }
          };

          details.onerror = (err) => reject(err);
          GM_xmlhttpRequest(details);
        });
      },

      fetchFile: async (token, filePath, responseType = 'text') => {
        try {
          const result = await FluxKit.api.onedrive.request(token, filePath, 'GET', null, true);

          if (result instanceof Blob) {
            if (responseType === 'text') {
              return await result.text();
            }
            return result;
          }

          return result;
        } catch (e) {
          if (e.status === 404) return null;
          throw e;
        }
      },

      fetchAllFiles: async (token, basePath) => {
        const allFiles = {};
        try {
          const result = await FluxKit.api.onedrive.request(token, basePath, 'GET', null, false);
          for (const item of (result.value || [])) {
            if (item.file) {
              const isText = item.name.match(/\.(json|txt|md|csv|xml|js|css|html)$/i);
              const content = await FluxKit.api.onedrive.fetchFile(token, `${basePath}/${item.name}`, isText ? 'text' : 'blob');
              if (content !== null) allFiles[item.name] = { content };
            }
          }
        } catch (e) {
          if (e.status !== 404) throw e;
        }
        return allFiles;
      },

      uploadFile: async (token, filePath, content) => {
        return await FluxKit.api.onedrive.request(token, filePath, 'PUT', content, true);
      }
    }
  }

  /******** Loader (ESM) ********/
  FluxKit.loader ??= (function () {
    const _moduleCache = new Map();
    function gmFetchText(url, headers = {}) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_XMLHTTPREQUEST_MISSING'));
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: Object.assign({ 'Cache-Control': 'no-cache' }, headers),
          onload: r => (r.status >= 200 && r.status < 300) ? resolve(r.responseText) : reject(new Error('HTTP_' + r.status)),
          onerror: () => reject(new Error('NETWORK_ERR')),
          ontimeout: () => reject(new Error('TIMEOUT'))
        });
      });
    }
    async function sha256Base64(text) {
      const bytes = new TextEncoder().encode(text);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return btoa(String.fromCharCode(...new Uint8Array(hash)));
    }
    async function _executeLoad(url, integrityBase64) {
      const code = await gmFetchText(url);
      if (integrityBase64) {
        const got = await sha256Base64(code);
        if (got !== integrityBase64) throw new Error(`INTEGRITY_MISMATCH: Expected ${integrityBase64}, got ${got}`);
      }
      const blob = new Blob([code], { type: 'text/javascript' });
      const modUrl = URL.createObjectURL(blob);
      try { 
        const module = await import(modUrl); 
        return module;
      } catch (err) {
        if (err.message.includes('Content Security Policy')) {
          console.error(`[FluxKit Loader] CSP Blocked execution of Blob URI for ${url}. You may need to use @require instead.`);
        }
        throw err;
      } finally { 
        URL.revokeObjectURL(modUrl); 
      }
    }

    function loadESModule(url, { integrityBase64 = null, forceReload = false } = {}) {
      if (!forceReload && _moduleCache.has(url)) {
        return _moduleCache.get(url);
      }
      const loadPromise = _executeLoad(url, integrityBase64).catch(err => {
        _moduleCache.delete(url);
        throw err;
      });

      _moduleCache.set(url, loadPromise);
      return loadPromise;
    }

    return { 
      gmFetchText, 
      sha256Base64, 
      loadESModule,
      clearCache: () => _moduleCache.clear() 
    };
  })()

  FluxKit.help.register('core', {
    _description: 'Global toolkit methods and sandbox interactions.',

    exposeToPage: {
      _command: 'FluxKit.exposeToPage(moduleName?)', _summary: 'Escapes the Greasemonkey sandbox by attaching FluxKit to unsafeWindow.',
      _description: 'Bridges the gap between the isolated userscript environment and the actual webpage DOM.',
      _arguments: { 'moduleName': { Type: 'String', Required: 'No', Notes: 'Expose only a specific module (e.g., "utils"). Leave blank to expose everything.' }},
      _returns: 'Boolean (Success/Failure)'
    }
  }, { isNative: true });

  FluxKit.help.register('logs', {
    _summary: 'Advanced multi-stream logger tracking standard and debug logs per-script.',
    _description: 'Available directly in your browser\'s Developer Console.',

    show: {
      _command: 'FluxLogs.show(options?)', _summary: 'View and filter retained logs.', _description: 'Outputs a formatted table of logs to the console. Can be filtered by severity, specific script, or keyword.',
      _config: { _description: 'Configuration for filtering and displaying specific logs.',
        level: { Type: 'String | Array', Default: 'All', Description: 'e.g., "standard", "debug", "error", "warn"' },
        script: { Type: 'String', Default: 'All', Description: 'Filter by a specific script name.' },
        search: { Type: 'String', Default: 'None', Description: 'Text to search for in log messages.' },
      },
      _example: "FluxLogs.show({ level: ['error', 'warn'], script: 'UniversalNotes', search: 'failed' });",
    },

    scripts: { _command: 'FluxLogs.scripts()', _summary: 'List all active scripts tracking logs.', _returns: 'Array of script names.' },

    clear: { _command: 'FluxLogs.clear(scriptName?)', _summary: 'Wipe retained logs.', _arguments: { scriptName: { Type: 'String', Required: 'No', Description: 'Target script. Leaves blank to clear ALL logs globally.' }}},

    live: { _command: 'FluxLogs.live(state, scriptName?)', _summary: 'Toggle live standard console logging.',
      _arguments: {
        state: { Type: 'Boolean', Required: 'Yes', Description: 'true to enable, false to disable.' },
        scriptName: { Type: 'String', Required: 'No', Description: 'Apply only to this script (applies globally if omitted).' },
      },
    },

    debug: { _command: 'FluxLogs.debug(state, scriptName?)', _summary: 'Toggle live DEBUG console logging.',
      _arguments: {
        state: { Type: 'Boolean', Required: 'Yes', Description: 'true to enable, false to disable.' },
        scriptName: { Type: 'String', Required: 'No', Description: 'Apply only to this script (applies globally if omitted).' },
      },
    },

    limit: { _command: 'FluxLogs.limit(stdLimit, dbgLimit, scriptName?)', _summary: 'Update maximum log retention limits.',
      _arguments: {
        stdLimit: { Type: 'Number', Required: 'Yes', Description: 'Max standard logs to retain in memory.' },
        dbgLimit: { Type: 'Number', Required: 'Yes', Description: 'Max debug logs to retain in memory.' },
        scriptName: { Type: 'String', Required: 'No', Description: 'Apply only to this script (applies globally if omitted).' },
      },
    },
    status: { _command: 'FluxLogs.status()', _summary: 'Check global state, limits, and script-level overrides.' },
  }, { isNative: true });

  FluxKit.help.register('help', {
    _summary: 'The interactive FluxKit Documentation Engine, available directly in your browser\'s Developer Console.',
    _description: 'Provides built-in documentation for FluxKit modules and allows third-party UserScripts to register their own help menus.',
    _command: 'FluxKit.help(query?)',
    _arguments: { query: { Type: 'String', Required: 'No', Notes: 'The module path to inspect (e.g., "utils.darken"). Leave empty for the main menu.' } },
    _returns: 'Formatted Console Output',
    
    register: {
      _summary: 'Registers custom documentation into the FluxKit help system.',
      _description: 'Allows script developers to integrate their own custom modules into the global help registry. They will automatically be tagged as "Script Add-ons". Note: Only specific META_KEYS (prefixed with _) are parsed as documentation; all other keys are treated as nested sub-modules.',
      _command: 'FluxKit.help.register(path, data)',
      _arguments: {
        path: { Type: 'String', Required: 'Yes', Notes: 'Dot-notation path for the documentation (e.g., "myCustomScript.tools").' },
        data: { Type: 'Object', Required: 'Yes', Notes: 'The documentation payload. See the allowed schema below.' }
      },
      
      _config: {
        _description: 'Schema for the "data" payload. These keys MUST be prefixed with an underscore. ⚠️ ANY OTHER KEY provided will automatically be treated as a nested sub-module!',
        summary: { Usage: '_summary', Type: 'String', Description: 'A short overview. Prioritized in Table of Contents (TOC) views.' },
        description: { Usage: '_description', Type: 'String', Description: 'A detailed explanation. Acts as a fallback in TOCs if _summary is missing.' },
        command: { Usage: '_command', Type: 'String', Description: 'The exact code snippet to call this function (e.g., "module.doThing()").' },
        arguments: { Usage: '_arguments', Type: 'Object', Description: 'Nested object mapping arg names to { Type, Required, Notes }. Renders as a console.table().' },
        config: { Usage: '_config', Type: 'Object', Description: 'Nested object for documenting options. Must include a "_description" string.' },
        returns: { Usage: '_returns', Type: 'String', Description: 'A description of what the module outputs.' },
        list: { Usage: '_list', Type: 'Object ({ _description: String, items: Array | Object })', Description: 'Renders a beautiful grouped, index-numbered table or quick data list inside a collapsible group.' },
        example: { Usage: '_example', Type: 'String', Description: 'A multiline string showing real-world code usage.' }
      },
      
      _example: `FluxKit.help.register('myScript.tools', {\n  _summary: 'My Custom Script Utilities',\n  _description: 'A collection of tools for my specific workflow.',\n\n  // A nested sub-module inside the main module\n  calculate: {\n    _summary: 'Calculates a specific value.',\n    _command: 'FluxKit.myScript.tools.calculate(input)',\n    _arguments: {\n      input: { Type: 'Number', Required: 'Yes', Notes: 'The base value.' }\n    },\n    _returns: 'Number'\n  }\n});`
    }
  }, { isNative: true });

  FluxKit.help.register('utils', {
    _description: 'Low-level functional utilities for DOM manipulation, security, and window management.',

    safeHTML: {
      _command: 'FluxKit.utils.safeHTML(html)', _summary: 'Sanitizes an HTML string using the internal Trusted Types policy.',
      _arguments: { 'html': { Type: 'String', Required: 'Yes', Notes: 'Raw HTML string.' } }, _returns: 'TrustedHTML Object (or raw string if TT is unsupported).'
    },

    withTTPatched: {
      _command: 'FluxKit.utils.withTTPatched(callback)', _summary: 'Executes a function while temporarily intercepting and sanitizing Element.innerHTML assignments.',
      _arguments: { 'callback': { Type: 'Function', Required: 'Yes', Notes: 'The logic to run safely.' } }
    },

    createLogger: {
      _command: 'FluxKit.utils.createLogger(configKey, pluginKey?)', _summary: 'Instantiates an isolated, stream-based logger for a specific script.',
      _arguments: {
        'configKey': { Type: 'String', Required: 'Yes', Notes: 'The root name of the script.' },
        'pluginKey': { Type: 'String', Required: 'No', Notes: 'Optional sub-module tag.' }
      },
      _returns: 'Object { logMessage, logError, logWarning, logDebug }'
    },

    createHTMLElement: {
      _command: 'FluxKit.utils.createHTMLElement(tagName, attributes?)',
      _summary: 'Versatile DOM element creator that with deep attribute, style, and event binding support.',
      _description: 'Provides a clean, declarative way to build complex DOM trees. Automatically handles style objects, dataset objects, safe innerHTML injection, event listeners, and custom FluxKit properties (like flxPopover or icons).',
      _arguments: {
        tagName: { Type: 'String', Required: 'Yes', Notes: 'e.g., "div", "button", "span"' },
        attributes: { Type: 'Object', Required: 'No', Notes: 'Configuration dictionary for the element.' }
      },
      _config: {
        _description: 'Special properties supported inside the attributes object.',
        style: { Type: 'String | Object', Description: 'CSS string or object (e.g., { display: "flex" }).' },
        class: { Type: 'String', Description: 'Shorthand for className. Applies CSS classes to the element.' },
        dataset: { Type: 'Object', Description: 'Object of data attributes (keys are auto camel-cased).' },
        eventListener: { Type: 'Function | Array | Object', Description: 'Bind single click, array of events, or dictionary map.' },
        children: { Type: 'Array | HTMLElement | String', Description: 'Elements or strings to append as children.' },
        icon: { Type: 'String', Description: 'Injects an SVG from FluxKit.ui.icons.[icon]' },
        innerHTML: { Type: 'String', Description: 'HTML string, automatically sanitized via FluxKit.utils.safeHTML if available.' },
        flxTitle: { Type: 'String | Object', Description: 'Alias for flxTooltip. Sets up standard tooltip attributes.' },
        flxTooltip: { Type: 'String | Object', Description: 'Automatically binds the element to the FluxKit.ui tooltip system (sets data-tooltip).' },
        flxPopover: { Type: 'String | Object', Description: 'Spawns an interactive tooltip that stays open when hovered or clicked (sets data-tooltip and data-tooltip-interactive="true").' }
      },
      _example: `const btn = FluxKit.utils.createHTMLElement('button', {\n  class: 'primary-btn',\n  id: 'delete-btn',\n  icon: 'trash',\n  flxPopover: 'Clicking this deletes your current <b>draft</b>.',\n  children: 'Delete Data',\n  eventListener: () => delete()\n});`,
      _returns: 'HTMLElement'
    },

    createSVGElement: {
      _command: 'FluxKit.utils.createSVGElement(tagName, attributes?)', _summary: 'Constructs an SVG element using the proper XML namespace.',
      _arguments: {
        'tagName': { Type: 'String', Required: 'Yes', Notes: 'e.g., "svg", "path", "circle"' },
        'attributes': { Type: 'Object', Required: 'No', Notes: 'Same config parameters as createHTMLElement.' }
      }
    },

    getUniqueId: {
      _command: 'FluxKit.utils.getUniqueId(existingIds?)', _summary: 'Generates a random, collision-free ID string.',
      _arguments: { 'existingIds': { Type: 'Array<String>', Required: 'No', Notes: 'Array of IDs to check against for collisions.' } },
      _returns: 'String (e.g., "a1b2c-1j2k3l-x9y8z")'
    },

    openPopupWindow: { _command: 'FluxKit.utils.openPopupWindow(url, options?)', _summary: 'Opens a cleanly centered popup window (useful for OAuth flows).',
      _arguments: {
        'url': { Type: 'String', Required: 'Yes' },
        'options': { Type: 'Object', Required: 'No' }
      },
      _config: {
        'title': { Type: 'String', Default: '"FluxKit Window"' },
        'width': { Type: 'Number', Default: '560' },
        'height': { Type: 'Number', Default: '640' },
        'resizable': { Type: 'String', Default: '"yes"' },
        'scrollbars': { Type: 'String', Default: '"yes"' }
      },
    },

    initPopupWindows: {
      _summary: 'Activates the data-popup click interceptor on a DOM root.',
      _description: 'Auto-initializes on `document` by default. Any anchor tag with a `data-popup` attribute will automatically be hijacked into a centered popup window. Call this manually ONLY if you are injecting UI into a custom ShadowRoot, or want specific window configuration.',
      _command: 'FluxKit.utils.initPopupWindows(rootElement?, options?)',
      _arguments: {
        rootElement: { Type: 'HTMLElement', Required: 'No', Notes: 'Defaults to the main document. Pass your ShadowRoot here if your UI is encapsulated.' },
        options: { Type: 'Object', Required: 'No', Notes: 'Global configuration overrides for this root.' },
      },
      _config: {
        'title': { Type: 'String', Default: '"FluxKit Window"' },
        'width': { Type: 'Number', Default: '560' },
        'height': { Type: 'Number', Default: '640' },
        'resizable': { Type: 'String', Default: '"yes"' },
        'scrollbars': { Type: 'String', Default: '"yes"' }
      },
      _example: `// 1. Initialize the listener on your app's root\nFluxKit.utils.initPopupWindows(myShadowRoot);\n\n// 2. Any link created like this will now auto-popup!\nconst btn = FluxKit.utils.createHTMLElement('a', {\n  href: 'https://example.com',\n  dataset: { popup: 'My Custom Window', popupWidth: '800' },\n  textContent: 'Open Guide'\n});`
    },

    getRandomIcon: {
      _command: 'FluxKit.utils.getRandomIcon(name?)', _summary: 'Returns a specific or random emoji icon from the internal map.',
      _arguments: { 'name': { Type: 'String', Required: 'No', Notes: 'e.g., "dolphin", "alien", "moai"' } },
      _list: { _description: 'Available emojis:', items: Object.keys(emojiMap) },
      _returns: 'String (Emoji)'
    },

    makeElementDragAndResize: {
      _command: 'FluxKit.utils.makeElementDragAndResize(element, header?, options?)',
      _summary: 'Injects advanced window-management logic (drag, resize, snap) into a DOM element.',
      _arguments: {
        'element': { Type: 'HTMLElement', Required: 'Yes', Notes: 'The root element to make draggable.' },
        'header': { Type: 'HTMLElement', Required: 'No', Notes: 'The specific grab-handle. Defaults to the root element.' },
        'options': { Type: 'Object', Required: 'No' }
      },
      _config: {
        '_description': 'Advanced constraints and event hooks.',
        'resizable': { Type: 'Boolean', Default: 'true', Description: 'Adds a bottom-right resize handle.' },
        'keepInViewport': { Type: 'Boolean', Default: 'true', Description: 'Prevents dragging off-screen.' },
        'lockAspectRatio': { Type: 'Boolean', Default: 'false', Description: 'Forces proportional resizing.' },
        'minWidth / minHeight': { Type: 'Number', Default: '160 / 90', Description: 'Minimum bounds.' },
        'onDragStart / onDragging': { Type: 'Function', Default: 'None', Description: 'Event hooks.' }
      }
    },

    trapTabFocus: {
      _command: 'FluxKit.utils.trapTabFocus(element, initialFocus?)',
      _summary: 'Traps keyboard Tab navigation inside a container (crucial for accessibility in Modals).',
      _arguments: {
        'element': { Type: 'HTMLElement', Required: 'Yes', Notes: 'The container to lock focus within.' },
        'initialFocus': { Type: 'HTMLElement', Required: 'No', Notes: 'The element to focus immediately.' }
      }
    },

    toKebabCase: {
      _command: 'FluxKit.utils.toKebabCase(str)',
      _summary: 'Converts a camelCase or space-separated string to kebab-case.',
      _arguments: { 'str': { Type: 'String', Required: 'Yes' } },
      _returns: 'String'
    },

    toCamelCase: {
      _command: 'FluxKit.utils.toCamelCase(str)',
      _summary: 'Converts a kebab-case or space-separated string to camelCase.',
      _arguments: { 'str': { Type: 'String', Required: 'Yes' } },
      _returns: 'String'
    },
  }, { isNative: true });

  FluxKit.help.register('theme', {
    _description: 'Global theming engine, color manipulation, and DOM-based style scraping.',

    isSystemDark: { _command: 'FluxKit.theme.isSystemDark()', _summary: 'Check if the OS/Browser prefers dark mode.', _returns: 'Boolean' },

    isSiteDark: { _command: 'FluxKit.theme.isSiteDark(rootElement?, fallbackOverride?)', _summary: 'Scrapes the DOM to detect if the current site uses a dark background.',
      _arguments: {
        rootElement: { Type: 'HTMLElement', Required: 'No', Notes: 'Defaults to document.body' },
        fallbackOverride: { Type: 'Boolean', Required: 'No', Notes: 'Fallback if detection fails. Defaults to system preference.', },
      },
      _returns: 'Boolean'
    },

    get: { _command: 'FluxKit.theme.get(themeKeyOrIsDark?, target?)', _summary: 'Smart router that fetches a preset or generates a native-blending theme.',
      _description: 'By default (no arguments), it auto-detects the host site\'s color scheme and generates a complete theme object that blends flawlessly with the native UI. You can bypass this by requesting a specific preset.',
      _arguments: {
        themeKeyOrIsDark: { Type: 'String | Boolean | Null', Required: 'No', Notes: 'Pass nothing for auto-native, true/false to force native dark/light mode, or a string (e.g., "terminal") to force a hardcoded preset.' },
        target: { Type: 'HTMLElement', Required: 'No', Notes: 'If auto-generating a native theme, samples colors from this specific element instead of document.body.' }
      },
      _returns: 'Full Theme Object (bg, text, accentBg, dynamic borders, hover states, etc.)'
    },

    darken: { _command: 'FluxKit.theme.darken(color, percent)', _summary: 'Darkens a Hex or RGB color by a specific percentage.',
      _arguments: {
        color: { Type: 'String', Required: 'Yes', Notes: 'e.g., "#3D5A80" or "rgb(61, 90, 128)"' },
        percent: { Type: 'Number', Required: 'Yes', Notes: '0 to 100' },
      },
      _example: "FluxKit.theme.darken('#ffffff', 10); // Returns rgba(229, 229, 229, 1)"
    },

    ensureMinOpacity: {
      _command: 'FluxKit.theme.ensureMinOpacity(colorStr, minOpacity?)',
      _summary: 'Enforces a minimum opacity threshold on a color to guarantee readability.',
      _description: 'Parses RGBA and Hex (with alpha) strings. If the extracted alpha value falls below the threshold, it upgrades the color to the minimum opacity. Fully opaque colors, generic names, and CSS variables are safely returned untouched.',
      _arguments: {
        colorStr: { Type: 'String', Required: 'Yes', Notes: 'Hex (e.g., #RRGGBBAA) or RGBA string.' },
        minOpacity: { Type: 'Number', Required: 'No', Notes: 'Minimum acceptable opacity (0 to 1). Defaults to 0.85.' }
      },
      _example: "FluxKit.theme.ensureMinOpacity('rgba(0, 0, 0, 0.05)', 0.90);\n// Returns 'rgba(0, 0, 0, 0.9)'",
      _returns: 'String (The safely adjusted or original color string)'
    },

    getColorName: {
      _command: 'FluxKit.theme.getColorName(colorStr, colorMaps?, targetElement?)',
      _summary: 'Converts a hex, RGB, or CSS variable string into a human-readable color name.',
      _arguments: {
        colorStr: { Type: 'String', Required: 'Yes', Notes: 'Hex, RGB(A), or var(--custom) string to evaluate.' },
        colorMaps: { Type: 'Object', Required: 'No', Notes: 'Custom dictionary mapping hex codes to names.' },
        targetElement: { Type: 'HTMLElement', Required: 'No', Notes: 'Used to safely probe and compute CSS variables.' }
      },
      _returns: 'String (Color Name or original string/variable if unknown)'
    },

    rgbToHex: {
      _command: 'FluxKit.theme.rgbToHex(rgbStr, dropAlpha?)',
      _summary: 'Converts an rgb() or rgba() string into a standard Hex string.',
      _arguments: {
        rgbStr: { Type: 'String', Required: 'Yes', Notes: 'The RGB(A) string to convert.' },
        dropAlpha: { Type: 'Boolean', Required: 'No', Notes: 'If true, strips the alpha channel from the resulting Hex string. Defaults to false.' }
      },
      _returns: 'String (Hex color)'
    },

    createAlphaColor: { 
      _command: 'FluxKit.theme.createAlphaColor(colorStr, alpha, targetElement?)', 
      _summary: 'Converts any color string (Hex or RGB) into an RGBA string with the specified alpha.',
      _arguments: {
        colorStr: { Type: 'String', Required: 'Yes', Notes: 'Hex (#fff), RGB(a) string, or CSS variable (var(--color)).' },
        alpha: { Type: 'Number', Required: 'Yes', Notes: 'Opacity value (0 to 1).' },
        targetElement: { Type: 'HTMLElement', Required: 'No', Notes: 'Used to safely probe and compute CSS variables.' },
      },
      _example: "FluxKit.theme.createAlphaColor('#ffffff', 0.05);\n// Returns 'rgba(255, 255, 255, 0.05)'"
    },

    getContrastYIQ: {
      _command: 'FluxKit.theme.getContrastYIQ(color)',
      _summary: 'Determines if a color is perceived as "light" or "dark".',
      _returns: '"light" | "dark"'
    },

    ensureContrast: {
      _command: 'FluxKit.theme.ensureContrast(bg, text, fallback)',
      _summary: 'Checks if text provides sufficient contrast against a background; returns fallback if not.',
      _arguments: {
          bg: { Type: 'String', Required: 'Yes' },
          text: { Type: 'String', Required: 'Yes' },
          fallback: { Type: 'String', Required: 'Yes', Notes: 'Returned if contrast is poor.' }
      }
    },

    getSiteStyles: { _command: 'FluxKit.theme.getSiteStyles(options?)', _summary: 'Deep-scrapes the host website to build a complete native theme.',
      _description: 'Extracts core surface and accent colors, then uses alpha-blending and relative darkening to dynamically generate input backgrounds, borders, hover states, and separators that match the host site perfectly.',
      _config: {  _description: 'Options to control how aggressively to scrape the DOM for colors.',
        target: { Type: 'HTMLElement', Default: 'document.body', Description: 'Element to scrape.' },
        scrapeDOM: { Type: 'Boolean', Default: 'true', Description: 'Hunt for button background colors.' },
        ignoreSelector: { Type: 'String', Default: '""', Description: 'CSS selector to ignore (e.g., your own shadow root).' },
        isDark: { Type: 'Boolean', Default: 'Auto', Description: 'Force dark/light mode context.' }
      },
      _returns: 'Full Theme Object (Combines host properties with alpha-blended UI variables)'
    }
  }, { isNative: true });

  FluxKit.help.register('ui', {
    _description: 'High-level visual components: Notifications, Context Menus, Tooltips, and File Previewer.',

    icons: {
      _summary: 'Centralized collection of standardized SVG icons.',
      _description: 'A native icon library used across FluxKit and external scripts. Eliminates the need for FontAwesome or external font libraries. All icons use `currentColor` to automatically adapt to your theme.',
      
      _list: { _description: 'Available icons:', items: Object.keys(FluxKit.ui.icons) },
      
      usage: {
        _summary: 'How to inject an icon into your UI.',
        _command: 'FluxKit.ui.icons.[iconName]',
        _example: 'const btn = FluxKit.utils.createHTMLElement("button", {\n  innerHTML: `${FluxKit.ui.icons.save} Save File`\n});',
        _returns: 'String (Raw SVG HTML)'
      }
    },

    initNotification: { _command: 'FluxKit.ui.initNotification(config?)', _summary: 'Pre-configure the global toast notification system.',
      _config: { _description: 'Sets the baseline styling and behavior for all future toasts. Features a dynamic deck that expands and pauses timers when hovered.',
        namespace: { Type: 'String', Default: '"default"', Description: 'Supports multiple isolated configurations.' },
        rootElement: { Type: 'HTMLElement', Default: 'document.body', Description: 'Where to inject the toast container.' },
        position: { Type: 'String', Default: '"bottom-right"', Description: 'top/bottom + right/left/center joined by a hyphen.' },
        duration: { Type: 'Number', Default: '3000', Description: 'Milliseconds before auto-hiding. (Timers automatically pause when hovered)' },
        autoDark: { Type: 'Boolean', Default: 'true', Description: 'Auto-adapt to site theme.' },
        animationType: { Type: 'String', Default: '"bounce"', Description: 'The animation style ("bounce", "fade", or "custom").' },
        customKeyframes: { Type: 'String', Default: 'None', Description: 'CSS keyframes body for entrance (Requires animationType: "custom").' },
        customExitKeyframes: { Type: 'String', Default: 'None', Description: 'CSS keyframes body for exit. Falls back to a standard fade-out if omitted.' }      },
    },

    showNotification: { 
      _command: 'FluxKit.ui.showNotification(message, overrides?)', 
      _summary: 'Displays a smart toast notification within the 3D stack.',
      _arguments: {
        message: { Type: 'String', Required: 'Yes', Notes: 'HTML/Text to display.' },
        overrides: { Type: 'Object', Required: 'No', Notes: 'Config overrides for this specific toast.' },
      },
      _config: { 
        _description: 'Overrides for this specific toast, including interactive elements and ID tracking.',
        id: { Type: 'String | Number', Default: 'None', Description: 'Unique ID. If a new toast fires with an existing ID, it replaces the old one seamlessly instead of spamming the screen.' },
        icon: { Type: 'String (HTML)', Default: 'None', Description: 'Left-aligned icon element.' },
        actionLabel: { Type: 'String', Default: 'None', Description: 'Text for interactive button.' },
        actionCallback: { Type: 'Function', Default: 'None', Description: 'Triggered when action button is clicked.' },
      },
      _example: `// 1. Fire a loading state\nFluxKit.ui.showNotification('Syncing data...', { id: 'sync-task', duration: 20000 });\n\n// 2. Instantly replace the old notification instead of stacking it!\nsetTimeout(() => {\n  FluxKit.ui.showNotification('Sync Complete!', { id: 'sync-task', icon: '✅', duration: 3000, customAnimation: 'pop-in-bounce' });\n}, 1500);`
    },

    initContextMenu: { _command: 'FluxKit.ui.initContextMenu(config?)', _summary: 'Pre-configure the custom right-click menu system.',
      _config: { _description: 'Sets the baseline styling and namespace for context menus.',
        namespace: { Type: 'String', Default: '"default"', Description: 'Isolate configurations.' },
        rootElement: { Type: 'HTMLElement', Default: 'document.body', Description: 'Injection target.' },
        autoDark: { Type: 'Boolean', Default: 'true', Description: 'Match system/site theme.' },
      },
    },

    createContextMenu: { _command: 'FluxKit.ui.createContextMenu(x, y, options, width?, overrides?)', _summary: 'Spawns an interactive, keyboard-navigable context menu.',
      _arguments: {
        x: { Type: 'Number', Required: 'Yes', Notes: 'Viewport X coordinate (e.clientX)' },
        y: { Type: 'Number', Required: 'Yes', Notes: 'Viewport Y coordinate (e.clientY)' },
        options: { Type: 'Array<Object>', Required: 'Yes', Notes: 'Array of {label, action, icon, disabled, separator, title}' },
        width: { Type: 'Number', Required: 'No', Notes: 'Minimum width in px (default 160).' },
      },
      _example: `FluxKit.ui.createContextMenu(e.clientX, e.clientY, [\n  { label: 'Copy', action: () => copyData(), icon: '📋' },\n  { separator: true },\n  { label: 'Delete', action: () => deleteData(), disabled: true }\n]);`,
    },

    initTooltips: { _command: 'FluxKit.ui.initTooltips(config?)', _summary: 'Initializes an auto-anchoring tooltip system for [data-tooltip] elements.',
      _config: { _description: 'Configures the attribute to watch and global tooltip delay.',
        attribute: { Type: 'String', Default: '"data-tooltip"', Description: 'DOM attribute to watch.' },
        delay: { Type: 'Number', Default: '400', Description: 'Hover delay in ms before showing.' },
        autoDark: { Type: 'Boolean', Default: 'true', Description: 'Match system/site theme.' },
      },
      _example: `FluxKit.ui.initTooltips(); \n// Now any <button data-tooltip="Click Me"> will have a custom tooltip.`,
    },

    viewer: { _description: 'Robust, theme-aware file and data previewer (Images, PDFs, Text, Code).',

      init: { _command: 'FluxKit.ui.viewer.init(config?)', _summary: 'Configure the viewer system.',
        _config: { _description: 'Configures global viewer settings and custom SVG icons.',
          namespace: { Type: 'String', Default: '"default"' },
          icons: { Type: 'Object', Default: 'Internal SVGs', Description: 'Override close/download icons.' },
        },
      },

      open: { _command: 'FluxKit.ui.viewer.open(filename, fileData, overrides?)', _summary: 'Spawns a fullscreen modal to preview the file contents.',
        _arguments: {
          filename: { Type: 'String', Required: 'Yes', Notes: 'e.g., "script.js" or "photo.png"' },
          fileData: { Type: 'String | Blob', Required: 'Yes', Notes: 'Raw string, data URL, or Blob/File object.' },
          overrides: { Type: 'Object', Required: 'No', Notes: 'Theme/Namespace overrides.' },
        },
      },

      registerExtension: { _command: 'FluxKit.ui.viewer.registerExtension(category, extensions)', _summary: 'Map custom file extensions to internal preview categories.',
        _arguments: {
          category: { Type: 'String', Required: 'Yes', Notes: '"image", "text", "audio", "video", "pdf"' },
          extensions: { Type: 'String | Array', Required: 'Yes', Notes: 'e.g., ["ts", "jsx", "tsx"]' },
        },
        _example: "FluxKit.ui.viewer.registerExtension('text', ['py', 'java']);",
      },

      registerRenderer: { _command: 'FluxKit.ui.viewer.registerRenderer(extension, renderFn)', _summary: 'Inject a custom DOM builder for specific file types.',
        _arguments: {
          extension: { Type: 'String', Required: 'Yes', Notes: 'e.g., "html"' },
          renderFn: { Type: 'Function', Required: 'Yes', Notes: 'Async callback returning HTML string or DOM element.' },
        },
      },

      updateTheme: {
        _command: 'FluxKit.ui.viewer.updateTheme(themeOptions, namespace?)',
        _summary: 'Hot-swaps the viewer and tooltip themes dynamically while the viewer is open.',
        _arguments: {
          'themeOptions': { Type: 'Object', Required: 'Yes', Notes: 'Theme configuration overrides.' },
          'namespace': { Type: 'String', Required: 'No', Notes: 'Defaults to "default".' }
        },
        _returns: 'Void'
      },
    },
  }, { isNative: true });

  FluxKit.help.register('api', {
    _description: 'Cloud storage and communication layer. Standardized wrappers for external APIs.',

    githubGist: {
      _description: 'Interact with GitHub Gists for lightweight JSON/Text storage.',

      verifyCredentials: {
        _command: 'FluxKit.api.githubGist.verifyCredentials(token)', _summary: 'Test if a GitHub Personal Access Token (PAT) is valid.',
        _arguments: { 'token': { Type: 'String', Required: 'Yes' } }, _returns: 'Promise<Boolean>'
      },

      createNewGist: {
        _command: 'FluxKit.api.githubGist.createNewGist(token, description?)', _summary: 'Creates a new private Gist.',
        _arguments: {
          'token': { Type: 'String', Required: 'Yes' },
          'description': { Type: 'String', Required: 'No', Notes: 'Defaults to "Universal Notes Storage"' }
        },
        _returns: 'Promise<String> (The new Gist ID)'
      },

      verifyGistAccess: {
        _command: 'FluxKit.api.githubGist.verifyGistAccess(token, gistId)', _summary: 'Test if the token has access to a specific Gist ID.',
        _arguments: {
          'token': { Type: 'String', Required: 'Yes' },
          'gistId': { Type: 'String', Required: 'Yes' }
        },
        _returns: 'Promise<Boolean>'
      },

      uploadDataToGistFile: {
        _command: 'FluxKit.api.githubGist.uploadDataToGistFile(gistFileName, gistId, token, data, isBulk?)', _summary: 'Updates a specific file in a Gist, or performs a bulk update.',
        _description: 'Uses PATCH to update Gist files. Pass null as data to delete a file.',
        _arguments: {
          'gistFileName': { Type: 'String', Required: 'Yes', Notes: 'Target file (ignored if isBulk is true).' },
          'gistId': { Type: 'String', Required: 'Yes' },
          'token': { Type: 'String', Required: 'Yes' },
          'data': { Type: 'Object | String', Required: 'Yes', Notes: 'Data payload.' },
          'isBulk': { Type: 'Boolean', Required: 'No', Notes: 'If true, `data` must be a { files: {...} } object.' }
        },
        _returns: 'Promise<Object> (API Response)'
      },

      fetchGistFiles: {
        _command: 'FluxKit.api.githubGist.fetchGistFiles(gistId, token?)',
        _summary: 'Fetches and parses all files in a Gist.',
        _arguments: {
          'gistId': { Type: 'String', Required: 'Yes' },
          'token': { Type: 'String', Required: 'No', Notes: 'Required if the Gist is private.' }
        },
        _returns: 'Promise<Object> (Parsed Gist data)'
      }
    },

    githubRepo: {
      _description: 'Interact directly with GitHub Repositories for advanced file tracking.',

      verifyCredentials: {
        _command: 'FluxKit.api.githubGist.verifyCredentials(token)', _summary: 'Test if a GitHub Personal Access Token (PAT) is valid, resuses the method from githubGist.',
        _arguments: { 'token': { Type: 'String', Required: 'Yes' } }, _returns: 'Promise<Boolean>'
      },

      ensureRepo: {
        _command: 'FluxKit.api.githubRepo.ensureRepo(token, repoName)', _summary: 'Checks if a repo exists; creates it privately if it does not.',
        _arguments: {
          'token': { Type: 'String', Required: 'Yes' },
          'repoName': { Type: 'String', Required: 'Yes', Notes: 'Spaces will be replaced with dashes.' }
        },
        _returns: 'Promise<{owner, repo}>'
      },

      fetchAllFiles: {
        _command: 'FluxKit.api.githubRepo.fetchAllFiles(token, owner, repo, folderPath?)', _summary: 'Downloads all files from a specific repository folder.',
        _arguments: {
          'token': { Type: 'String', Required: 'Yes' },
          'owner': { Type: 'String', Required: 'Yes' },
          'repo': { Type: 'String', Required: 'Yes' },
          'folderPath': { Type: 'String', Required: 'No', Notes: 'Leave empty for root.' }
        },
        _returns: 'Promise<{ files: Object }>'
      },

      uploadFile: {
        _command: 'FluxKit.api.githubRepo.uploadFile(token, owner, repo, folderPath, filename, content)', _summary: 'Pushes a file directly to a repository.', _description: 'Automatically handles fetching the previous SHA file hash required by GitHub for updates.',
        _arguments: {
          'token': { Type: 'String', Required: 'Yes' },
          'owner': { Type: 'String', Required: 'Yes' },
          'repo': { Type: 'String', Required: 'Yes' },
          'folderPath': { Type: 'String', Required: 'Yes', Notes: 'e.g., "data/saves"' },
          'filename': { Type: 'String', Required: 'Yes' },
          'content': { Type: 'String | Blob | Object', Required: 'Yes', Notes: 'Auto-converted to Base64.' }
        },
        _returns: 'Promise<Boolean>'
      }
    },

    webdav: {
      _description: 'Generic WebDAV protocol wrappers (Nextcloud, ownCloud, NAS).',

      verifyCredentials: {
        _command: 'FluxKit.api.webdav.verifyCredentials(url, username, password)', _summary: 'Verify connection and credentials via PROPFIND.',
        _arguments: {
          'url': { Type: 'String', Required: 'Yes', Notes: 'Must start with http:// or https://' },
          'username': { Type: 'String', Required: 'Yes' },
          'password': { Type: 'String', Required: 'Yes' }
        },
        _returns: 'Promise<Boolean>'
      },

      ensureDirectory: {
        _command: 'FluxKit.api.webdav.ensureDirectory(baseUrl, folderPath, username, password)', _summary: 'Recursively creates nested folders using MKCOL.',
        _arguments: {
          'baseUrl': { Type: 'String', Required: 'Yes' },
          'folderPath': { Type: 'String', Required: 'No', Notes: 'e.g., "Backups/Notes"' },
          'username': { Type: 'String', Required: 'Yes' },
          'password': { Type: 'String', Required: 'Yes' }
        },
        _returns: 'Promise<String> (The final resolved URL)'
      },

      fetchAllFiles: {
        _command: 'FluxKit.api.webdav.fetchAllFiles(targetUrl, username, password)', _summary: 'List contents and download all files in a directory.',
        _description: 'Scans directory using PROPFIND depth:1, then concurrently fetches files as Text or Blob based on extension.', _returns: 'Promise<{ files: Object }>'
      },

      uploadFile: {
        _command: 'FluxKit.api.webdav.uploadFile(targetUrl, username, password, filename, content)', _summary: 'Upload or overwrite a file using PUT.',
        _arguments: {
          'targetUrl': { Type: 'String', Required: 'Yes', Notes: 'Base WebDAV directory URL.' },
          'username': { Type: 'String', Required: 'Yes' },
          'password': { Type: 'String', Required: 'Yes' },
          'filename': { Type: 'String', Required: 'Yes', Notes: 'Target filename (e.g., "backup.zip").' },
          'content': { Type: 'String | Blob | Object', Required: 'Yes' }
        },
        _returns: 'Promise<Boolean>'
      }
    },

    dropbox: {
      _description: 'Dropbox REST API wrappers.',

      exchangeAuthCode: { _command: 'FluxKit.api.dropbox.exchangeAuthCode(appKey, appSecret, authCode)', _summary: 'Exchange a temporary OAuth code for persistent tokens.', _returns: 'Promise<Object> (Contains access_token and refresh_token)' },

      refreshAccessToken: { _command: 'FluxKit.api.dropbox.refreshAccessToken(appKey, appSecret, refreshToken)', _summary: 'Generates a fresh short-lived access token.', _returns: 'Promise<Object>' },

      fetchAllFiles: {
        _command: 'FluxKit.api.dropbox.fetchAllFiles(token, basePath)', _summary: 'Recursively lists and downloads all files from a Dropbox folder.',
        _arguments: {
          'token': { Type: 'String', Required: 'Yes' },
          'basePath': { Type: 'String', Required: 'Yes', Notes: 'e.g., "/FluxKit/Notes"' }
        },
        _returns: 'Promise<Object> (Files mapped by relative path)'
      },

      uploadFile: {
        _command: 'FluxKit.api.dropbox.uploadFile(token, filePath, content)', _summary: 'Uploads a file to a specific Dropbox path (Overwrites automatically).',
        _arguments: {
          'token': { Type: 'String', Required: 'Yes', Notes: 'OAuth2 Access Token.' },
          'filePath': { Type: 'String', Required: 'Yes', Notes: 'Absolute path (e.g., "/Apps/FluxKit/data.json").' },
          'content': { Type: 'String | Blob | Object', Required: 'Yes' }
        },
        _returns: 'Promise<Object> (Dropbox file metadata)'
      }
    },

    onedrive: {
      _description: 'Microsoft Graph API wrappers for OneDrive (AppFolder Scoped).',

      exchangeAuthCode: { _command: 'FluxKit.api.onedriv e.exchangeAuthCode(clientId, clientSecret?, authCode)', _summary: 'Exchange OAuth code for MS Graph tokens.', _returns: 'Promise<Object>'},

      refreshAccessToken:  { _command: 'FluxKit.api.onedrive.refreshAcce ssToken(clientId, cli entSecret?, refreshToken)', _summary: 'Refresh MS Graph access token for offline_access scope.', _returns: 'Promise<Object>'},

      fetchAllFiles: {
        _command: 'FluxKit.api.onedrive.fetchAllFiles(token, basePath)', _summary: 'Downloads all files from a OneDrive folder.',
        _arguments: {
          'token': { Type: 'String', Required: 'Yes' },
          'basePath': { Type: 'String', Required: 'Yes', Notes: 'Path relative to the App Folder root.' }
        },
        _returns: 'Promise<Object>'
      },

      uploadFile: {
        _command: 'FluxKit.api.onedrive.uploadFile(token, filePath, content)', _summary: 'Uploads/overwrites a file in OneDrive.',
        _arguments: {
          'token': { Type: 'String', Required: 'Yes' },
          'filePath': { Type: 'String', Required: 'Yes', Notes: 'Path relative to the App Folder root.' },
          'content': { Type: 'String | Blob | Object', Required: 'Yes' }
        },
        _returns: 'Promise<Object> (DriveItem metadata)'
      }
    }
  }, { isNative: true });

  FluxKit.help.register('loader', {
    _description: 'ES Module loader and integrity verification via GM_xmlhttpRequest.',

    gmFetchText: {
      _command: 'FluxKit.loader.gmFetchText(url, headers?)', _summary: 'Fetches raw text bypassing CORS using Tampermonkey.',
      _arguments: {
        'url': { Type: 'String', Required: 'Yes' },
        'headers': { Type: 'Object', Required: 'No', Notes: 'Defaults to { "Cache-Control": "no-cache" }' }
      },
      _returns: 'Promise<String>'
    },

    sha256Base64: { _command: 'FluxKit.loader.sha256Base64(text)', _summary: 'Generates a Base64-encoded SHA-256 hash of a string using the Web Crypto API.', _returns: 'Promise<String>' },

    loadESModule: {
      _command: 'FluxKit.loader.loadESModule(url, options?)', _summary: 'Dynamically imports an external ES Module via Blob URLs.',
      _arguments: {
        'url': { Type: 'String', Required: 'Yes', Notes: 'Direct URL to the .js file.' },
        'options': { Type: 'Object', Required: 'No' }
      },
      _config: { 'integrityBase64': { Type: 'String', Default: 'null', Description: 'If provided, script halts if the fetched hash mismatches.' } },
      _returns: 'Promise<Module>'
    },

    clearCache: { 
      _command: 'FluxKit.loader.clearCache()', 
      _summary: 'Clears the internal ES Module cache, forcing a fresh fetch on the next load.', 
      _returns: 'Void' 
    }
  }, { isNative: true });
})();