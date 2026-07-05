// ==UserScript==
// @name         Notion Stats
// @namespace    https://github.com/JYashu/flux-suite
// @version      1.7.0
// @description  A floating, expandable metrics panel for Notion. Tracks words, characters, sentences, paragraphs, reading time, and active selection stats.
// @author       JYashu
// @license      Apache-2.0
// @icon         https://www.google.com/s2/favicons?sz=64&domain=notion.so
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @match        https://app.notion.com/*
// @match        https://www.notion.so/*
// @grant        none
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

  const { createLogger, createHTMLElement } = FluxKit.utils;
  const { logMessage } = createLogger('FluxNotionMetrics');

  logMessage("✅ Loaded.");

  let statsBox = null;
  let wordCount = 0;
  let fullStats = "";
  let currentPage = location.pathname;
  let editor = null;
  let observer = null;
  let selectionStats = "";
  let manualOverride = false;

  // Toggle with Ctrl + Shift + W
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "w") {
      manualOverride = !manualOverride;
      logMessage(`Override: ${manualOverride ? "ON" : "OFF"}`);

      if (manualOverride) {
        setupObserver();
        if (statsBox) statsBox.style.display = "block";
      } else {
        if (!isWordCounterRequired()) {
          if (observer) observer.disconnect();
          if (statsBox) statsBox.style.display = "none";
        }
      }
    }
  });

  function hasQueryOverride() {
    return new URLSearchParams(window.location.search).has("wordcount");
  }

  function isContentPage() {
    return !!document.querySelector(".notion-page-content");
  }

  function isDatabaseView() {
    return document.querySelector('[role="grid"], .notion-collection_view') !== null;
  }

  function isWordCounterRequired() {
    return manualOverride || hasQueryOverride() || (!isDatabaseView() && isContentPage());
  }

  function expandBox(box, text) {
    if (box.dataset.state === "expanded" && box.innerText === text) return;

    const clone = box.cloneNode(true);
    clone.style.visibility = "hidden";
    clone.style.position = "absolute";
    clone.style.maxHeight = "none";
    clone.style.maxWidth = "240px";
    clone.style.width = "240px";
    clone.style.height = "auto";
    clone.style.overflow = "visible";
    clone.innerText = text;

    document.body.appendChild(clone);
    const fullHeight = clone.scrollHeight;
    document.body.removeChild(clone);

    box.style.maxWidth = "240px";
    box.innerText = text;
    box.style.maxHeight = box.scrollHeight + "px";
    void box.offsetHeight;

    box.style.maxHeight = fullHeight + "px";
    box.dataset.state = "expanded";
  }

  function collapseBox(box) {
    box.style.maxHeight = "27.5px";
    box.dataset.state = "collapsed";
    box.style.maxWidth = "108px";

    box.addEventListener("transitionend", function handler(e) {
      if (e.propertyName === "max-height") {
        box.innerText = `Words: ${wordCount}`;
        box.removeEventListener("transitionend", handler);
      }
    });
  }

  function createStatsBox() {
    const box = createHTMLElement("div", { id: 'flux-notion-metrics-panel', innerText: `Words: ${wordCount}`, dataset: { state: 'collapsed' },
      style: {
        position: "fixed", top: "52px", right: "12px", 
        background: "rgba(47, 52, 55, 0.9)", color: "#fff",
        padding: "6px 12px", borderRadius: "6px", fontSize: "13px",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
        zIndex: "9999", whiteSpace: "pre-line",
        maxWidth: "108px", maxHeight: "27.5px", overflow: "hidden", cursor: "default",
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        transition: "max-height 0.3s ease, max-width 0.3s ease, padding 0.3s ease"
      },
      eventListener: {
        mouseenter: () => {
          if (selectionStats) return;
          expandBox(box, fullStats);
        },
        mouseLeave: () => {
          if (selectionStats) return;
          collapseBox(box);
        }
      }
    });
    document.body.appendChild(box);
    return box;
  }

  function getWordCount(str) {
    const pattern = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\uac00-\ud7af]|\b[\p{L}\p{N}]+(?:[-.'’@][\p{L}\p{N}]+)*\b/gu;
    return str.match(pattern)?.length || 0;
  }

  function getCharacterCount(text) {
    const charsWithoutWhiteSpaces = text.replace(/\s/g, "").length;
    return `${text.length} (No Spaces: ${charsWithoutWhiteSpaces})`;
  }

  function getSentenceCount(text) {
    const normalizedText = text.trim().replace(/\s+/g, ' ');
    const sentences = normalizedText.match(/[^.!?]+[.!?]+(?:\s|$)/g);
    return sentences ? sentences.length : (normalizedText ? 1 : 0);
  }

  function getParagraphCount() {
    return Array.from(editor.children)
      .filter(child => child.innerText && child.innerText.trim().length > 0)
      .length;
  }

  function resetStatsBox() {
    if (!statsBox) return;
    if (statsBox.dataset.state === "expanded") {
      collapseBox(statsBox);
    } else {
      statsBox.innerText = `Words: ${wordCount}`;
    }
  }

  function updateStatsBox(text, isSelected = false) {
    if (!statsBox) statsBox = createStatsBox();

    if (isSelected) {
      selectionStats =
        `Selected Words: ${getWordCount(text)}\n` +
        `Selected: ${getCharacterCount(text)}\n` +
        `Sentences: ${getSentenceCount(text)}`;

      expandBox(statsBox, selectionStats);
    } else {
      wordCount = getWordCount(text);
      const readingTime = Math.ceil(wordCount / 200);
      fullStats =
        `Words: ${wordCount}\n` +
        `Characters: ${getCharacterCount(text)}\n` +
        `Sentences: ${getSentenceCount(text)}\n` +
        `Paragraphs: ${getParagraphCount()}\n` +
        `Reading Time: ${readingTime} min`;

      resetStatsBox();
    }
  }

  function updateStats() {
    if (!editor) return;
    const text = editor.innerText || "";
    updateStatsBox(text);
  }

  function updateSelectionStats() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      selectionStats = "";
      resetStatsBox();
      return;
    }

    const selectedText = sel.toString().trim();
    if (!selectedText) return;
    updateStatsBox(selectedText, true);
  }

  function setupObserver() {
    if (observer) observer.disconnect();

    editor = document.querySelector(".notion-page-content");

    if (!editor) {
      if (statsBox) statsBox.style.display = "none";
      return;
    } else {
      if (!statsBox) statsBox = createStatsBox();
      statsBox.style.display = "block";
    }

    observer = new MutationObserver(() => updateStats());
    observer.observe(editor, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    updateStats();
  }

  document.addEventListener("selectionchange", () => {
    if (!statsBox || !editor || !document.contains(editor)) return;
    updateSelectionStats();
  });

  setInterval(() => {
    const newPage = location.pathname;
    const newEditor = document.querySelector(".notion-page-content");

    if (newPage !== currentPage || newEditor !== editor) {
      currentPage = newPage;
      setTimeout(() => {
        if (isWordCounterRequired()) {
          setupObserver();
        } else {
          if (observer) observer.disconnect();
          if (statsBox) statsBox.style.display = "none";
        }
      }, 300);
    }
  }, 1000);

  // Bypass Notion DOM-lock
  const lockAfterRenderRegex = /\W+at [a-zA-Z]+\.lockAfterRender \(https:\/\/(www\.)?notion\.so\/app/;
  const mutationObserverPrototype = MutationObserver.prototype;
  const originalObserve = mutationObserverPrototype.observe;
  mutationObserverPrototype.observe = function () {
    const stackLines = new Error().stack.split("\n");
    if (stackLines.some(line => line.match(lockAfterRenderRegex) !== null)) {
      return;
    }
    originalObserve.call(this, ...arguments);
  };
})();