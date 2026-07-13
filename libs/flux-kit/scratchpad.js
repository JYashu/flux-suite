// ==UserScript==
// @name         FluxKit Scratchpad
// @namespace    https://github.com/JYashu
// @version      1.1.0
// @description  A full-featured, responsive interactive drawing board with a built-in UI toolkit.
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

  if (typeof FluxKit === 'undefined' || !FluxKit.utils || !FluxKit.theme || !FluxKit.ui) {
    console.error('FluxKit Scratchpad Error: Core FluxKit is missing. Please @require flux-kit/core.js before flux-kit/scratchpad.js');
    return;
  }

  FluxKit.ui.ScratchpadCore ??= class {
    constructor(canvasElement, options = {}) {
      this._abortController = new AbortController();
      this.globalCtrlOpts = { signal: this._abortController.signal, capture: true };
      this.isActive = true;
      if (!canvasElement || canvasElement.tagName !== 'CANVAS') throw new Error('Scratchpad requires a valid HTMLCanvasElement');
      this._activeKeys = new Set();
      window.addEventListener('blur', () => this._activeKeys.clear(), this.globalCtrlOpts);

      this.canvas = canvasElement;
      this.ctx = this.canvas.getContext('2d', { alpha: true, desynchronized: true });

      const safeNum = (val, fallback) => typeof val === 'number' && !isNaN(val) ? val : Number(val) || fallback;

      this.options = {
        strokeColor: options.strokeColor || 'var(--sp-text)',
        strokeWidth: Math.max(0.1, safeNum(options.strokeWidth, 3)),
        strokeAlpha: Math.max(0.1, Math.min(1, safeNum(options.strokeAlpha, 1.0))),
        pointThreshold: Math.max(0, safeNum(options.pointThreshold, 3)),
        backgroundColor: options.backgroundColor || 'transparent',
        eraserWidth: safeNum(options.eraserWidth, 20),
        chunkThreshold: Math.max(10, safeNum(options.chunkThreshold, 30)),
        onChange: typeof options.onChange === 'function' ? options.onChange : null,
        exportConfig: { mode: 'auto', maxWidth: 4096, maxHeight: 4096, padding: 10, ...(options.exportConfig || {}) },
        imageCompression: options.imageCompression === false ? false : {
          maxWidth: 1600,
          quality: 0.85,
          ...(options.imageCompression || {})
        },
        disableImagePaste: options.disableImagePaste || false,
        ...options,
      };

      this.strokes = []; this.undoStack = []; this.redoStack = [];
      this.assets = {}; this.imageCache = {};
      this.currentStroke = null; this.activeGestureId = null;
      this.selectedChunkIds = new Set(); this.isMarqueeSelecting = false; this.marqueeStart = { x: 0, y: 0 }; this.selectionOriginalState = null;
      this.currentTool = 'pen';
      this.isDrawing = false;
      this.lastX = 0; this.lastY = 0;
      this.currentSmoothWidth = this.options.strokeWidth;
      this.viewport = { x: 0, y: 0, scale: 1 };
      this.isPanning = false; this.panStartX = 0; this.panStartY = 0;
      this.activePointers = new Map();
      this.isPinching = false; this.lastPinchDistance = 0; this.lastPinchCenter = { x: 0, y: 0 };
      this.logicalX = null; this.logicalY = null; this.logicalWidth = null; this.logicalHeight = null;
      this._hasResized = false; this._needsAutoFit = false;
      this._startDrawing = this._startDrawing.bind(this);
      this._draw = this._draw.bind(this);
      this._stopDrawing = this._stopDrawing.bind(this);
      this.resize = this.resize.bind(this);
      this.isDraggingSelection = false; this.dragStartX = 0; this.dragStartY = 0;
      this.activeHandle = null; this.selectionOriginalBounds = null; this.selectionOriginalChunk = null;
      this.isSpacePressed = false;

      const keydownListener = e => {
        if (!this.isActive || FluxKit.utils.shouldIgnoreKeystroke(e)) return;

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
        const key = e.key.toLowerCase();
        this._activeKeys.add(key);

        if (key === 'escape' && this.currentStroke && this.currentTool === 'line') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.currentStroke.points.splice(-2, 2);
            if (this.currentStroke.points.length >= 4) this.strokes.push(this.currentStroke);
            this.currentStroke = null;
            this._drawDraftStroke();
            this._redraw();
            return;
        }

        if (cmdOrCtrl) {
          if (key === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
          if (key === 'y') { e.preventDefault(); this.redo(); return; }
          if (key === 'backspace') { e.preventDefault(); this.clear(); return; }
        }

        if (this.selectedChunkIds.size > 0) {
          if (key === 'delete' || key === 'backspace') { this.deleteSelection(); return; }
          if (cmdOrCtrl && (key === 'd' || key === 'c')) { e.preventDefault(); this.duplicateSelection(); return; }
          if (e.shiftKey && key === 'h') { e.preventDefault(); this.flipSelection('h'); return; }
          if (e.shiftKey && key === 'v') { e.preventDefault(); this.flipSelection('v'); return; }
        }

        if (key === '+' || key === '=') { 
          e.preventDefault(); 
          if (this.selectedChunkIds.size > 0) this.scaleSelection(1.05);
          else this.setZoom(0.1); 
          return; 
        }
        if (key === '-' || key === '_') { 
          e.preventDefault(); 
          if (this.selectedChunkIds.size > 0) this.scaleSelection(0.95);
          else this.setZoom(-0.1); 
          return; 
        }
        if ((key === '1' && e.shiftKey) || key === '0') { e.preventDefault(); this.zoomToFit(); return; }

        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
          e.preventDefault();
          if (this.selectedChunkIds.size > 0) {
            const amount = e.shiftKey ? 10 : 1;
            let dx = 0, dy = 0;
            if (this._activeKeys.has('arrowup')) dy -= amount;
            if (this._activeKeys.has('arrowdown')) dy += amount;
            if (this._activeKeys.has('arrowleft')) dx -= amount;
            if (this._activeKeys.has('arrowright')) dx += amount;

            for (const chunk of this.strokes) {
              if (this.selectedChunkIds.has(chunk.id)) {
                if (chunk.type === 'image') { chunk.x += dx; chunk.y += dy; } 
                else {
                  for(let i = 0; i < chunk.points.length; i += 2) {
                    chunk.points[i] += dx; chunk.points[i+1] += dy;
                  }
                }
              }
            }
            this._redraw();
          } else {
            const panAmount = e.shiftKey ? 100 : 25;
            let dx = 0, dy = 0;
            if (this._activeKeys.has('arrowup')) dy += panAmount;
            if (this._activeKeys.has('arrowdown')) dy -= panAmount;
            if (this._activeKeys.has('arrowleft')) dx += panAmount;
            if (this._activeKeys.has('arrowright')) dx -= panAmount;
            this.viewport.x += dx; this.viewport.y += dy;
            this._redraw();
          }
          return;
        }

        if (key === ' ' || key === 'spacebar') {
          e.preventDefault(); e.stopPropagation();
          if (!this.isSpacePressed) { this.isSpacePressed = true; this.canvas.style.cursor = 'grab'; }
        }
      };

      const keyupListener = e => {
        if (!this.isActive || FluxKit.utils.shouldIgnoreKeystroke(e)) return;
        const key = e.key.toLowerCase();
        this._activeKeys.delete(key);
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
          if (this.selectedChunkIds.size > 0) this._saveState();
        }
        if (key === ' ' || key === 'spacebar') {
          this.isSpacePressed = false;
          this.setTool(this.currentTool);
        }
      };

      document.addEventListener('keyup', keyupListener, this.globalCtrlOpts);
      document.addEventListener('keydown', keydownListener, this.globalCtrlOpts);

      this._initCanvas();
    }

    _initCanvas() {
      this.canvas.style.touchAction = 'none';
      this.canvas.style.cursor = 'crosshair';
      this.draftCanvas = FluxKit.utils.createHTMLElement('canvas', { style: 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;' });
      this.canvas.parentElement.appendChild(this.draftCanvas);
      this.draftCtx = this.draftCanvas.getContext('2d');

      this.canvas.addEventListener('pointerdown', this._startDrawing);
      this.canvas.addEventListener('pointermove', this._draw);
      window.addEventListener('pointerup', this._stopDrawing, this.globalCtrlOpts);

      this.canvas.addEventListener('wheel', e => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          let rawDelta = -e.deltaY * 0.01;
          const zoomDelta = Math.max(-0.5, Math.min(0.5, rawDelta));

          const rect = this.canvas.getBoundingClientRect();
          const centerPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          this.setZoom(zoomDelta, centerPoint);
          return;
        }

        this.viewport.x -= e.deltaX;
        this.viewport.y -= e.deltaY;
        this._redraw();
      }, { passive: false });

      this.resize(); this._saveState(true);
    }

    _resolveColor(colorStr, targetAlpha = 1) {
      if (FluxKit.theme.createAlphaColor) return FluxKit.theme.createAlphaColor(colorStr, targetAlpha, this.canvas.parentElement);
      return colorStr;
    }

    _applyToolStyles(targetCtx, color, width, alpha = 1) {
      targetCtx.lineCap = 'round';
      targetCtx.lineJoin = 'round';
      targetCtx.strokeStyle = this._resolveColor(color, alpha);
      targetCtx.lineWidth = width;
    }

    _getCoords(e) {
      const rect = this.canvas.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      return { x: (rawX - this.viewport.x) / this.viewport.scale, y: (rawY - this.viewport.y) / this.viewport.scale };
    }

    _getHandleHit(x, y, bounds) {
      const p = 4 / this.viewport.scale;
      const hSize = 14 / this.viewport.scale;
      const bx = bounds.x - p, by = bounds.y - p, bw = bounds.w + p * 2, bh = bounds.h + p * 2;
      const isHit = (hx, hy) => Math.abs(x - hx) <= hSize && Math.abs(y - hy) <= hSize;

      if (isHit(bx + bw / 2, by - 24 / this.viewport.scale)) return 'rot';
      if (isHit(bx, by)) return 'tl';
      if (isHit(bx + bw, by)) return 'tr';
      if (isHit(bx, by + bh)) return 'bl';
      if (isHit(bx + bw, by + bh)) return 'br';
      return null;
    }

    _distanceToSegmentSq(p, v, w) {
      const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
      if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      const closestX = v.x + t * (w.x - v.x);
      const closestY = v.y + t * (w.y - v.y);
      return (p.x - closestX) ** 2 + (p.y - closestY) ** 2;
    }

    _erase(eraserX, eraserY) {
      const eraserPos = { x: eraserX, y: eraserY };
      let strokeDeleted = false;

      for (let i = this.strokes.length - 1; i >= 0; i--) {
        const stroke = this.strokes[i];
        if (stroke.type === 'image') continue;
        const pts = stroke.points;
        const hitRadiusSq = (this.options.eraserWidth / 2 + stroke.width / 2) ** 2;
        let hit = false;

        if (pts.length === 2) {
          if ((eraserX - pts[0]) ** 2 + (eraserY - pts[1]) ** 2 <= hitRadiusSq) hit = true;
        } else {
          for (let j = 0; j < pts.length - 2; j += 2) {
            if (this._distanceToSegmentSq(eraserPos, { x: pts[j], y: pts[j + 1] }, { x: pts[j + 2], y: pts[j + 3] }) <= hitRadiusSq) {
              hit = true;
              break;
            }
          }
        }

        if (hit) {
          this.strokes.splice(i, 1);
          strokeDeleted = true;
          break;
        }
      }
      if (strokeDeleted) this._redraw();
    }

    _renderChunkToCtx(targetCtx, chunk) {
      if (!this.imageCache) this.imageCache = {};

      if (chunk.type === 'image') {
        const imgToDraw = this._getRecoloredImage(chunk.assetId, chunk.color);
        
        if (imgToDraw) {
          targetCtx.save();
          
          const cx = chunk.x + chunk.w / 2;
          const cy = chunk.y + chunk.h / 2;
          targetCtx.translate(cx, cy);
          
          if (chunk.rotation) targetCtx.rotate(chunk.rotation);
          
          const scaleX = chunk.w < 0 ? -1 : 1;
          const scaleY = chunk.h < 0 ? -1 : 1;
          targetCtx.scale(scaleX, scaleY);
          
          const absW = Math.abs(chunk.w);
          const absH = Math.abs(chunk.h);
          
          targetCtx.globalAlpha = chunk.alpha ?? 1.0; 
          targetCtx.drawImage(imgToDraw, -absW / 2, -absH / 2, absW, absH);
          
          targetCtx.restore();
        } else if (this.assets && this.assets[chunk.assetId]) {
          // Fallback loader if the image isn't cached yet
          const newImg = new Image();
          this.imageCache[chunk.assetId] = newImg;
          newImg.onload = () => this._redraw();
          newImg.src = this.assets[chunk.assetId];
        }
        return;
      }
      
      this._applyToolStyles(targetCtx, chunk.color, chunk.width, chunk.alpha);
      targetCtx.beginPath();
      
      if (chunk.type === 'rect' || chunk.type === 'oval') {
        const cx = chunk.x + chunk.w / 2;
        const cy = chunk.y + chunk.h / 2;
        
        targetCtx.save();
        targetCtx.translate(cx, cy);
        if (chunk.rotation) targetCtx.rotate(chunk.rotation);
        
        // We draw using absolute dimensions, but allow negative widths/heights to handle flipping
        if (chunk.type === 'rect') {
          targetCtx.rect(-chunk.w / 2, -chunk.h / 2, chunk.w, chunk.h);
        } else if (chunk.type === 'oval') {
          targetCtx.ellipse(0, 0, Math.abs(chunk.w / 2), Math.abs(chunk.h / 2), 0, 0, 2 * Math.PI);
        }
        
        targetCtx.restore();
        targetCtx.stroke();
        return;
      }

      const pts = chunk.points;
      if (chunk.type === 'line') {
        targetCtx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) targetCtx.lineTo(pts[i], pts[i + 1]);
      } else if (pts.length >= 4) {
        targetCtx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) targetCtx.quadraticCurveTo(pts[i - 2], pts[i - 1], (pts[i - 2] + pts[i]) / 2, (pts[i - 1] + pts[i + 1]) / 2);
        targetCtx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
      } else if (pts.length === 2) {
        targetCtx.moveTo(pts[0], pts[1]);
        targetCtx.lineTo(pts[0], pts[1]);
      }
      targetCtx.stroke();
    }

    _distToSegmentSquared(p, v, w) {
      const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
      if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      return ((p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2);
    }

    _getGroupBounds() {
      if (this.selectedChunkIds.size === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      for (const chunk of this.strokes) {
        if (this.selectedChunkIds.has(chunk.id)) {
          const b = this._getChunkBounds(chunk);
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.w);
          maxY = Math.max(maxY, b.y + b.h);
        }
      }

      if (minX === Infinity) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    _getChunkBounds(chunk) {
      if (chunk.type === 'image') {
        if (!chunk.rotation) return { x: Math.min(chunk.x, chunk.x + chunk.w), y: Math.min(chunk.y, chunk.y + chunk.h), w: Math.abs(chunk.w), h: Math.abs(chunk.h) };
        
        const cx = chunk.x + chunk.w / 2, cy = chunk.y + chunk.h / 2;
        const w = chunk.w / 2, h = chunk.h / 2;
        const cos = Math.cos(chunk.rotation), sin = Math.sin(chunk.rotation);
        
        // Calculate where all 4 corners actually sit in 2D space
        const corners = [ {x: -w, y: -h}, {x: w, y: -h}, {x: w, y: h}, {x: -w, y: h} ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const p of corners) {
            const rx = cx + (p.x * cos - p.y * sin);
            const ry = cy + (p.x * sin + p.y * cos);
            minX = Math.min(minX, rx); minY = Math.min(minY, ry);
            maxX = Math.max(maxX, rx); maxY = Math.max(maxY, ry);
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
      if (chunk.type === 'image' || chunk.type === 'rect' || chunk.type === 'oval') {
        if (!chunk.rotation) return { x: Math.min(chunk.x, chunk.x + chunk.w), y: Math.min(chunk.y, chunk.y + chunk.h), w: Math.abs(chunk.w), h: Math.abs(chunk.h) };
        
        const cx = chunk.x + chunk.w / 2, cy = chunk.y + chunk.h / 2;
        const w = chunk.w / 2, h = chunk.h / 2;
        const cos = Math.cos(chunk.rotation), sin = Math.sin(chunk.rotation);
        
        const corners = [ {x: -w, y: -h}, {x: w, y: -h}, {x: w, y: h}, {x: -w, y: h} ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const p of corners) {
            const rx = cx + (p.x * cos - p.y * sin);
            const ry = cy + (p.x * sin + p.y * cos);
            minX = Math.min(minX, rx); minY = Math.min(minY, ry);
            maxX = Math.max(maxX, rx); maxY = Math.max(maxY, ry);
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const radius = chunk.width / 2;
      for (let i = 0; i < chunk.points.length; i += 2) {
        minX = Math.min(minX, chunk.points[i] - radius);
        minY = Math.min(minY, chunk.points[i + 1] - radius);
        maxX = Math.max(maxX, chunk.points[i] + radius);
        maxY = Math.max(maxY, chunk.points[i + 1] + radius);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    _getHitTarget(x, y) {
      for (let i = this.strokes.length - 1; i >= 0; i--) {
        const stroke = this.strokes[i];
        if (stroke.type === 'image' || stroke.type === 'rect' || stroke.type === 'oval') {
          const b = this._getChunkBounds(stroke);
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return stroke.id;
        } else {
          const hitRadius = stroke.width / 2 + 4;
          const pts = stroke.points;
          for (let j = 0; j < pts.length - 2; j += 2) {
            const distSq = this._distToSegmentSquared({ x, y }, { x: pts[j], y: pts[j + 1] }, { x: pts[j + 2], y: pts[j + 3] });
            if (distSq <= hitRadius * hitRadius) return stroke.id;
          }
        }
      }
      return null;
    }

    _startDrawing(e) {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      this.canvas.setPointerCapture(e.pointerId);

      this.activePointers.set(e.pointerId, e);

      if (this.activePointers.size === 2) {
        this.isPinching = true;
        this.isDrawing = false;

        if (this.currentStroke) {
          this.currentStroke = null;
          this._drawDraftStroke();
        }

        const pts = Array.from(this.activePointers.values());
        this.lastPinchDistance = Math.hypot(
          pts[0].clientX - pts[1].clientX,
          pts[0].clientY - pts[1].clientY,
        );
        this.lastPinchCenter = {
          x: (pts[0].clientX + pts[1].clientX) / 2,
          y: (pts[0].clientY + pts[1].clientY) / 2,
        };
        return;
      }

      if (this.activePointers.size > 2) return;

      const { x, y } = this._getCoords(e);

      if (this.currentTool === 'crop') {
        this.isDrawing = true;
        this.cropStart = { x, y };
        return;
      }

      if (
        this.currentTool === 'pan' || e.button === 1 || e.ctrlKey || e.metaKey || this.isSpacePressed) {
        this.isPanning = true;
        this.panStartX = e.clientX - this.viewport.x;
        this.panStartY = e.clientY - this.viewport.y;
        this.canvas.style.cursor = 'grabbing';
        return;
      }

      if (this.currentTool === 'select') {
        const groupBounds = this._getGroupBounds();
        const pad = 10 / this.viewport.scale;

        if (groupBounds && this.selectedChunkIds.size > 0) {
          const handle = this._getHandleHit(x, y, groupBounds);
          if (handle) {
            this.activeHandle = handle;
            this.selectionOriginalBounds = groupBounds;
            this.selectionOriginalState = [];

            for (let i = 0; i < this.strokes.length; i++) {
              const chunk = this.strokes[i];
              if (this.selectedChunkIds.has(chunk.id)) {
                const clone = JSON.parse(JSON.stringify(chunk));
                clone._origIndex = i; // Save exact 1:1 pointer!
                this.selectionOriginalState.push(clone);
              }
            }
            if (handle === 'rot') {
              const cx = groupBounds.x + groupBounds.w / 2;
              const cy = groupBounds.y + groupBounds.h / 2;
              this.selectionStartAngle = Math.atan2(y - cy, x - cx);
            }
            return;
          }
        }

        const hitId = this._getHitTarget(x, y);

        if (hitId) {
          if (e.shiftKey) {
            // SHIFT+CLICK TOGGLE: If it's selected, unselect it. If not, add it.
            if (this.selectedChunkIds.has(hitId)) {
              this.selectedChunkIds.delete(hitId);
              this.isDraggingSelection = false; // Prevent dragging an item that just got unselected
            } else {
              this.selectedChunkIds.add(hitId);
              this.isDraggingSelection = true;
            }
          } else {
            if (!this.selectedChunkIds.has(hitId)) {
              this.selectedChunkIds.clear();
              this.selectedChunkIds.add(hitId);
            }
            this.isDraggingSelection = true;
          }

          this.dragStartX = x;
          this.dragStartY = y;
          this._redraw();
          return;
        }

        if (groupBounds && x >= groupBounds.x - pad && x <= groupBounds.x + groupBounds.w + pad && y >= groupBounds.y - pad && y <= groupBounds.y + groupBounds.h + pad) {
          if (!e.shiftKey) {
              this.isDraggingSelection = true;
              this.dragStartX = x;
              this.dragStartY = y;
              return;
          }
        }

        if (!e.shiftKey) this.selectedChunkIds.clear(); // Only clear if Shift isn't held
        this.isMarqueeSelecting = true;
        this.marqueeStart = { x, y };
        this._redraw();
        return;
      }

      this.isDrawing = true; this.lastX = x; this.lastY = y; this.startX = x; this.startY = y;

      if (this.currentTool === 'line') {
        if (this.currentStroke && this.currentStroke.type === 'line') {
          this.currentStroke.points.push(x, y);
          this._drawDraftStroke();
          return;
        }
        this.activeGestureId = FluxKit.utils.getUniqueId();
        this.currentStroke = { id: this.activeGestureId, type: 'line', color: this.options.strokeColor, alpha: this.options.strokeAlpha, width: this.options.strokeWidth, points: [x, y, x, y] };
        return;
      }

      if (this.currentTool === 'rect' || this.currentTool === 'oval') {
        this.activeGestureId = FluxKit.utils.getUniqueId();
        this.currentStroke = { id: this.activeGestureId, type: this.currentTool, color: this.options.strokeColor, alpha: this.options.strokeAlpha, width: this.options.strokeWidth, x, y, w: 0, h: 0, rotation: 0 };
        return;
      }

      if (this.currentTool === 'eraser') this._erase(x, y);

      if (this.currentTool === 'eraser') this._erase(x, y);
      else {
        this.activeGestureId = FluxKit.utils.getUniqueId();

        const rawPressure = e.pointerType === 'pen' && e.pressure ? Math.max(0.1, e.pressure) : 0.5;
        this.currentSmoothWidth = this.options.strokeWidth * (rawPressure * 2);

        this.currentStroke = {
          id: this.activeGestureId,
          color: this.options.strokeColor,
          alpha: this.options.strokeAlpha,
          width: Math.max(1, Math.round(this.currentSmoothWidth)),
          points: [x, y],
        };

        this._drawDraftStroke();
      }
    }

    _draw(e) {
      e.preventDefault();
      if (this.activePointers.has(e.pointerId)) this.activePointers.set(e.pointerId, e);
      if (this.isPinching && this.activePointers.size === 2) {
        const pts = Array.from(this.activePointers.values());
        const currentDistance = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        const currentCenter = { x: (pts[0].clientX + pts[1].clientX) / 2, y: (pts[0].clientY + pts[1].clientY) / 2 };

        const dx = currentCenter.x - this.lastPinchCenter.x;
        const dy = currentCenter.y - this.lastPinchCenter.y;
        this.viewport.x += dx; this.viewport.y += dy;

        if (this.lastPinchDistance > 0) {
          const zoomDelta = currentDistance / this.lastPinchDistance - 1;
          if (Math.abs(zoomDelta) > 0.01) {
            const rect = this.canvas.getBoundingClientRect();
            const centerCoords = { x: currentCenter.x - rect.left, y: currentCenter.y - rect.top };
            this.setZoom(zoomDelta * 1.5, centerCoords);
          }
        }

        this.lastPinchDistance = currentDistance;
        this.lastPinchCenter = currentCenter;
        this._redraw();
        return;
      }
      if (this.currentTool === 'select' && this.isMarqueeSelecting) {
        this.draftCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.draftCtx.clearRect(0, 0, this.draftCanvas.width, this.draftCanvas.height);
        this._applyViewportTransform(this.draftCtx);

        const { x, y } = this._getCoords(e);
        const w = x - this.marqueeStart.x;
        const h = y - this.marqueeStart.y;

        // Draw a sleek translucent blue marquee box
        this.draftCtx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        this.draftCtx.fillRect(this.marqueeStart.x, this.marqueeStart.y, w, h);

        // Draw the dashed border
        this.draftCtx.strokeStyle = '#3b82f6';
        this.draftCtx.lineWidth = 1 / this.viewport.scale;
        this.draftCtx.setLineDash([4 / this.viewport.scale, 4 / this.viewport.scale]);
        this.draftCtx.strokeRect(this.marqueeStart.x, this.marqueeStart.y, w, h);
        this.draftCtx.setLineDash([]);

        return;
      }
      if (this.isPanning) {
        this.viewport.x = e.clientX - this.panStartX;
        this.viewport.y = e.clientY - this.panStartY;
        this._redraw();
        return;
      }
      if (this.currentTool === 'crop' && this.isDrawing) {
        this.draftCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.draftCtx.clearRect(0, 0, this.draftCanvas.width, this.draftCanvas.height);

        this.draftCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        this.draftCtx.fillRect(0, 0, this.draftCanvas.width, this.draftCanvas.height);

        this._applyViewportTransform(this.draftCtx);
        const { x, y } = this._getCoords(e);
        const w = x - this.cropStart.x;
        const h = y - this.cropStart.y;

        this.draftCtx.globalCompositeOperation = 'destination-out';
        this.draftCtx.fillStyle = '#ffffff';
        this.draftCtx.fillRect(this.cropStart.x, this.cropStart.y, w, h);

        this.draftCtx.globalCompositeOperation = 'source-over';
        this.draftCtx.strokeStyle = 'var(--sp-text)';
        this.draftCtx.lineWidth = 2 / this.viewport.scale;
        this.draftCtx.setLineDash([ 6 / this.viewport.scale, 6 / this.viewport.scale ]);
        this.draftCtx.strokeRect(this.cropStart.x, this.cropStart.y, w, h);
        this.draftCtx.setLineDash([]);

        return;
      }

      const { x, y } = this._getCoords(e);
      if (this.currentTool === 'select') {
        if (this.activeHandle && this.selectionOriginalState) {
          if (this.activeHandle === 'rot') {
            const OB = this.selectionOriginalBounds;
            const cx = OB.x + OB.w / 2;
            const cy = OB.y + OB.h / 2;
            const currentAngle = Math.atan2(y - cy, x - cx);
            let deltaAngle = currentAngle - this.selectionStartAngle;

            // SHIFT KEY: Snap to 15-degree increments!
            if (e.shiftKey) {
              const snap = Math.PI / 12;
              deltaAngle = Math.round(deltaAngle / snap) * snap;
            }

            const cos = Math.cos(deltaAngle);
            const sin = Math.sin(deltaAngle);

            for (const origC of this.selectionOriginalState) {
              const liveC = this.strokes[origC._origIndex];
              if (!liveC) continue;

              if (liveC.type === 'image') {
                const origCx = origC.x + origC.w / 2;
                const origCy = origC.y + origC.h / 2;
                
                // Orbit the image's center point around the group's master center point
                liveC.x = cx + ((origCx - cx) * cos - (origCy - cy) * sin) - origC.w / 2;
                liveC.y = cy + ((origCx - cx) * sin + (origCy - cy) * cos) - origC.h / 2;
                liveC.rotation = (origC.rotation || 0) + deltaAngle;
              } else {
                for (let i = 0; i < origC.points.length; i += 2) {
                  const dx = origC.points[i] - cx;
                  const dy = origC.points[i + 1] - cy;
                  liveC.points[i] = cx + (dx * cos - dy * sin);
                  liveC.points[i + 1] = cy + (dx * sin + dy * cos);
                }
              }
            }
            this._redraw();
            return;
          }
          const OB = this.selectionOriginalBounds;
          let cx, cy, hx, hy; // Anchor Point (cx,cy) and Original Handle Point (hx,hy)

          if (this.activeHandle === 'tl') { cx = OB.x + OB.w; cy = OB.y + OB.h; hx = OB.x; hy = OB.y; }
          else if (this.activeHandle === 'tr') { cx = OB.x; cy = OB.y + OB.h; hx = OB.x + OB.w; hy = OB.y; }
          else if (this.activeHandle === 'bl') { cx = OB.x + OB.w; cy = OB.y; hx = OB.x; hy = OB.y + OB.h; }
          else if (this.activeHandle === 'br') { cx = OB.x; cy = OB.y; hx = OB.x + OB.w; hy = OB.y + OB.h; }

          let scaleX = (x - cx) / (hx - cx || 1);
          let scaleY = (y - cy) / (hy - cy || 1);

          // Prevent shrinking to absolute zero
          if (Math.abs(scaleX) < 0.05) scaleX = scaleX < 0 ? -0.05 : 0.05;
          if (Math.abs(scaleY) < 0.05) scaleY = scaleY < 0 ? -0.05 : 0.05;

          // SHIFT KEY: Lock aspect ratio for uniform scaling
          if (e.shiftKey) {
            const lockScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
            scaleX = scaleX < 0 ? -lockScale : lockScale;
            scaleY = scaleY < 0 ? -lockScale : lockScale;
          }

          // Apply matrix scale to everything in the group
          for (const origC of this.selectionOriginalState) {
            const liveC = this.strokes[origC._origIndex];
            if (!liveC) continue;

            if (liveC.type === 'image') {
              liveC.x = cx + (origC.x - cx) * scaleX;
              liveC.y = cy + (origC.y - cy) * scaleY;
              liveC.w = origC.w * scaleX;
              liveC.h = origC.h * scaleY;
            } else {
              liveC.width = Math.max(0.5, origC.width * Math.max(Math.abs(scaleX), Math.abs(scaleY)));
              for (let i = 0; i < origC.points.length; i += 2) {
                liveC.points[i] = cx + (origC.points[i] - cx) * scaleX;
                liveC.points[i + 1] = cy + (origC.points[i + 1] - cy) * scaleY;
              }
            }
          }
          this._redraw();
          return;
        }

        if (this.isDraggingSelection && this.selectedChunkIds.size > 0) {
          const dx = x - this.dragStartX, dy = y - this.dragStartY;

          for (const chunk of this.strokes) {
            if (this.selectedChunkIds.has(chunk.id)) {
              if (chunk.type === 'image') {
                chunk.x += dx; chunk.y += dy;
              } else {
                for (let i = 0; i < chunk.points.length; i += 2) {
                  chunk.points[i] += dx; chunk.points[i + 1] += dy;
                }
              }
            }
          }
          this.dragStartX = x; this.dragStartY = y; this._redraw();
          return;
        }

        if (!this.isDraggingSelection && !this.activeHandle) {
          let newCursor = 'default';
          const groupBounds = this._getGroupBounds();

          let handle;
          if (groupBounds) {
            const handle = this._getHandleHit(x, y, groupBounds);
            if (handle === 'tl' || handle === 'br') newCursor = 'nwse-resize';
            else if (handle === 'tr' || handle === 'bl') newCursor = 'nesw-resize';
            else {
              const pad = 10 / this.viewport.scale;
              if (x >= groupBounds.x - pad && x <= groupBounds.x + groupBounds.w + pad && y >= groupBounds.y - pad && y <= groupBounds.y + groupBounds.h + pad) {
                newCursor = 'move';
              }
            }
          }

          // If not hovering over active box, check if hovering over unselected line
          if (newCursor === 'default' && this._getHitTarget(x, y)) newCursor = 'pointer';
          this.canvas.style.cursor = handle === 'rot' ? 'crosshair' : newCursor;
          return;
        }
      }

      if (this.currentTool === 'line') {
        if (this.currentStroke) {
          this.currentStroke.points[this.currentStroke.points.length - 2] = x;
          this.currentStroke.points[this.currentStroke.points.length - 1] = y;
          this._drawDraftStroke();
        }
        return;
      }

      if (!this.isDrawing) return;

      if (this.currentTool === 'rect' || this.currentTool === 'oval') {
        let targetW = x - this.startX;
        let targetH = y - this.startY;

        if (e.shiftKey) {
          const size = Math.max(Math.abs(targetW), Math.abs(targetH));
          targetW = targetW < 0 ? -size : size;
          targetH = targetH < 0 ? -size : size;
        }

        this.currentStroke.w = targetW;
        this.currentStroke.h = targetH;
        this._drawDraftStroke();
        return;
      }

      if (this.currentTool === 'eraser') {
        this._erase(x, y); this.lastX = x; this.lastY = y;
      } else {
        const distance = Math.hypot(x - this.lastX, y - this.lastY);

        if (distance >= this.options.pointThreshold) {
          if (e.shiftKey || e.altKey) {
          let targetX = x;
          let targetY = y;

          if (e.altKey) {
            const dx = Math.abs(x - this.startX);
            const dy = Math.abs(y - this.startY);
            if (dx > dy) {
              targetY = this.startY;
            } else {
              targetX = this.startX;
            }
          }

          // For a straight line, only two points in the array: Start and End.
          this.currentStroke.points = [this.startX, this.startY, targetX, targetY];
          this.lastX = targetX;
          this.lastY = targetY;

          this._drawDraftStroke();
          return;
        }
          
          this.currentStroke.points.push(x, y);
          this.lastX = x;
          this.lastY = y;

          this._drawDraftStroke();

          const rawPressure = e.pointerType === 'pen' && e.pressure ? Math.max(0.1, e.pressure) : 0.5;
          const targetWidth = this.options.strokeWidth * (rawPressure * 2);

          this.currentSmoothWidth += (targetWidth - this.currentSmoothWidth) * 0.2;
          const roundedWidth = Math.max(1, Math.round(this.currentSmoothWidth));

          const isHighlighter = this.options.strokeAlpha < 1.0;
          const widthChanged = !isHighlighter && Math.abs(this.currentStroke.width - roundedWidth) >= 2;
          const effectiveChunkThreshold = isHighlighter ? 2000 : this.options.chunkThreshold * 2;

          if (this.currentStroke.points.length >= effectiveChunkThreshold || widthChanged) {
            this.strokes.push(this.currentStroke);
            this._renderChunkToCtx(this.ctx, this.currentStroke);

            this.currentStroke = {
              id: this.activeGestureId,
              color: this.options.strokeColor,
              alpha: this.options.strokeAlpha,
              width: roundedWidth, points: [x, y],
              points: [x, y],
            };
            this.startX = x;
            this.startY = y;
          }
        }
      }
    }

    _stopDrawing(e) {
      if (this.currentTool === 'select') {
        if (this.activeHandle) {
          this.activeHandle = null;
          this.selectionOriginalBounds = null;
          this.selectionOriginalState = null;
          this._saveState();
          return;
        }
        if (this.isDraggingSelection) {
          this.isDraggingSelection = false;
          this._saveState();
          return;
        }

        if (this.isMarqueeSelecting) {
          this.isMarqueeSelecting = false;
          const { x, y } = this._getCoords(e);

          // Normalize the box coordinates (in case they dragged up/left)
          const minX = Math.min(this.marqueeStart.x, x);
          const minY = Math.min(this.marqueeStart.y, y);
          const maxX = Math.max(this.marqueeStart.x, x);
          const maxY = Math.max(this.marqueeStart.y, y);

          const marqueeRect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

          const rectsIntersect = (r1, r2) => !(r2.x > r1.x + r1.w || r2.x + r2.w < r1.x || r2.y > r1.y + r1.h || r2.y + r2.h < r1.y);

          // Add everything inside the box to our Selection Set!
          for (const stroke of this.strokes) {
            const bounds = this._getChunkBounds(stroke);
            if (rectsIntersect(marqueeRect, bounds)) {
              this.selectedChunkIds.add(stroke.id);
            }
          }

          // Clear the translucent blue box off the draft canvas
          this.draftCtx.setTransform(1, 0, 0, 1, 0, 0);
          this.draftCtx.clearRect(0, 0, this.draftCanvas.width, this.draftCanvas.height);

          this._redraw();
          return;
        }
      }

      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) this.isPinching = false;

      if (this.isPanning) {
        this.isPanning = false;
        this.setTool(null);
        return;
      }

      if (this.currentTool === 'crop' && this.isDrawing) {
        this.isDrawing = false;
        const { x, y } = this._getCoords(e);

        const cx = Math.min(this.cropStart.x, x);
        const cy = Math.min(this.cropStart.y, y);
        const cw = Math.abs(x - this.cropStart.x);
        const ch = Math.abs(y - this.cropStart.y);

        if (cw > 10 && ch > 10) this._applyCrop(cx, cy, cw, ch);

        this.draftCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.draftCtx.clearRect(0, 0, this.draftCanvas.width, this.draftCanvas.height);
        return;
      }
      if (this.isDraggingSelection) {
        this.isDraggingSelection = false;
        this._saveState();
        return;
      }
      if (this.activeHandle) {
        this.activeHandle = null;
        this.selectionOriginalBounds = null;
        this.selectionOriginalChunk = null;
        this._saveState();
        return;
      }

      if (!this.isDrawing) return;
      this.isDrawing = false;
      if ((this.currentTool === 'rect' || this.currentTool === 'oval') && this.currentStroke) {
        if (Math.abs(this.currentStroke.w) > 5 && Math.abs(this.currentStroke.h) > 5) {
          this.strokes.push(this.currentStroke);
        }
        this.currentStroke = null;
        this.draftCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.draftCtx.clearRect(0, 0, this.draftCanvas.width, this.draftCanvas.height);
        this._redraw();
      }

      if (this.currentTool === 'pen' && this.currentStroke) {
        if (this.currentStroke.points.length === 2) {
          this.currentStroke.points.push(this.currentStroke.points[0], this.currentStroke.points[1]);
        }
        
        // Only push strokes that actually have coordinates
        if (this.currentStroke.points.length >= 4) {
          this.strokes.push(this.currentStroke);
        }
        
        this.currentStroke = null;

        this.draftCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.draftCtx.clearRect(0, 0, this.draftCanvas.width, this.draftCanvas.height);
        this._redraw();
      }

      this._saveState();
    }

    _applyCrop(cx, cy, cw, ch) {
      const newStrokes = [];
      const dpr = window.devicePixelRatio || 1;

      for (const chunk of this.strokes) {
        if (chunk.type === 'image') {
          
          const b = this._getChunkBounds(chunk);
          const ix = Math.max(b.x, cx);
          const iy = Math.max(b.y, cy);
          const iw = Math.min(b.x + b.w, cx + cw) - ix;
          const ih = Math.min(b.y + b.h, cy + ch) - iy;

          if (iw > 0 && ih > 0) {
            const tempCanvas = FluxKit.utils.createHTMLElement('canvas', { width: iw * dpr, height: ih * dpr });
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.scale(dpr, dpr);
            
            // Shift the context so we only draw the portion that falls inside the crop bounds
            tempCtx.translate(-ix, -iy);
            
            this._renderChunkToCtx(tempCtx, chunk);
            
            const dataUrl = tempCanvas.toDataURL('image/png');
            const newAssetId = 'asset_' + FluxKit.utils.getUniqueId();
            this.assets[newAssetId] = dataUrl;

            newStrokes.push({ 
              ...chunk, 
              assetId: newAssetId, 
              x: ix, y: iy, w: iw, h: ih,
              rotation: 0, alpha: 1.0, color: null 
            });
          }
        } else {
          
          const r = chunk.width / 2;
          let currentPoints = [];

          for (let i = 0; i < chunk.points.length; i += 2) {
            const px = chunk.points[i];
            const py = chunk.points[i + 1];
            
            if (px + r >= cx && px - r <= cx + cw && py + r >= cy && py - r <= cy + ch) {
              currentPoints.push(px, py);
            } else {
              if (currentPoints.length > 0) {
                newStrokes.push({ ...chunk, points: currentPoints });
                currentPoints = [];
              }
            }
          }
          if (currentPoints.length > 0) newStrokes.push({ ...chunk, points: currentPoints });
        }
      }

      this.strokes = newStrokes;
      
      // Update the logical framing so "Zoom to Fit" and "Export" respect the new cropped boundary
      this.logicalX = cx; 
      this.logicalY = cy;
      this.logicalWidth = cw; 
      this.logicalHeight = ch;

      this._redraw(); 
      this._saveState();
    }

    _applyViewportTransform(targetCtx) {
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = window.devicePixelRatio || 1;
      targetCtx.scale(dpr, dpr);
      targetCtx.translate(this.viewport.x, this.viewport.y);
      targetCtx.scale(this.viewport.scale, this.viewport.scale);
    }

    _redraw() {
      const dpr = window.devicePixelRatio || 1;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      this._applyViewportTransform(this.ctx);

      if (this.options.backgroundColor !== 'transparent') {
        this.ctx.fillStyle = this._resolveColor(this.options.backgroundColor);
        this.ctx.fillRect(-10000, -10000, 20000, 20000);
      }

      for (const stroke of this.strokes) this._renderChunkToCtx(this.ctx, stroke);

      if (this.selectedChunkIds.size > 0) {
        const groupBounds = this._getGroupBounds();

        if (groupBounds) {
          this.ctx.save();
          this.ctx.strokeStyle = '#3b82f6'; // Focus Blue
          this.ctx.lineWidth = 2 / this.viewport.scale;

          const p = 6 / this.viewport.scale;
          const bx = groupBounds.x - p;
          const by = groupBounds.y - p;
          const bw = groupBounds.w + p * 2;
          const bh = groupBounds.h + p * 2;

          // Draw dashed bounding box
          this.ctx.setLineDash([ 6 / this.viewport.scale, 4 / this.viewport.scale ]);
          this.ctx.strokeRect(bx, by, bw, bh);

          // Draw the Rotation stalk
          this.ctx.setLineDash([]);
          this.ctx.beginPath();
          this.ctx.moveTo(bx + bw / 2, by);
          this.ctx.lineTo(bx + bw / 2, by - 24 / this.viewport.scale);
          this.ctx.stroke();

          this.ctx.fillStyle = '#ffffff';
          const hSize = 8 / this.viewport.scale;

          const drawHandle = (hx, hy, isRound = false) => {
            if (isRound) {
              this.ctx.beginPath();
              this.ctx.arc(hx, hy, hSize / 1.5, 0, Math.PI * 2);
              this.ctx.fill(); this.ctx.stroke();
            } else {
              this.ctx.fillRect(hx - hSize / 2, hy - hSize / 2, hSize, hSize);
              this.ctx.strokeRect(hx - hSize / 2, hy - hSize / 2, hSize, hSize);
            }
          };

          drawHandle(bx, by); drawHandle(bx + bw, by); 
          drawHandle(bx, by + bh); drawHandle(bx + bw, by + bh);
          drawHandle(bx + bw / 2, by - 24 / this.viewport.scale, true);

          this.ctx.restore();
        }
      }
    }

    _drawDraftStroke() {
      this.draftCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.draftCtx.clearRect(0, 0, this.draftCanvas.width, this.draftCanvas.height);

      this._applyViewportTransform(this.draftCtx);

      if (this.currentStroke) this._renderChunkToCtx(this.draftCtx, this.currentStroke);
    }

    _getRecoloredImage(assetId, targetColor) {
      if (!targetColor) return this.imageCache[assetId];
      const cacheKey = `${assetId}_${targetColor}`;
      if (this.imageCache[cacheKey]) return this.imageCache[cacheKey];

      const originalImg = this.imageCache[assetId];
      if (!originalImg) return null;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = originalImg.width;
      tempCanvas.height = originalImg.height;
      const tempCtx = tempCanvas.getContext('2d');

      tempCtx.drawImage(originalImg, 0, 0);

      tempCtx.globalCompositeOperation = 'source-in';

      tempCtx.fillStyle = this._resolveColor(targetColor);
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

      this.imageCache[cacheKey] = tempCanvas;

      return tempCanvas;
    }

    _getExportBounds(config = {}) {
      const mergedConfig = { ...this.options.exportConfig, ...config };
      const dpr = window.devicePixelRatio || 1;
      const mode = mergedConfig.mode;

      if (mode === 'viewport') {
        const rect = this.canvas.getBoundingClientRect();
        return {
          x: -this.viewport.x / this.viewport.scale, y: -this.viewport.y / this.viewport.scale,
          w: rect.width / this.viewport.scale, h: rect.height / this.viewport.scale
        };
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      if (mode === 'auto' && this.strokes.length > 0) {
        for (const stroke of this.strokes) {
          if (stroke.type === 'image') {
            minX = Math.min(minX, stroke.x);
            minY = Math.min(minY, stroke.y);
            maxX = Math.max(maxX, stroke.x + stroke.w);
            maxY = Math.max(maxY, stroke.y + stroke.h);
          } else {
            const radius = stroke.width / 2;
            for (let i = 0; i < stroke.points.length; i += 2) {
              minX = Math.min(minX, stroke.points[i] - radius);
              minY = Math.min(minY, stroke.points[i + 1] - radius);
              maxX = Math.max(maxX, stroke.points[i] + radius);
              maxY = Math.max(maxY, stroke.points[i + 1] + radius);
            }
          }
        }

        if (this.logicalWidth !== null && this.logicalWidth !== undefined) {
          minX = Math.min(minX, this.logicalX);
          minY = Math.min(minY, this.logicalY);
          maxX = Math.max(maxX, this.logicalX + this.logicalWidth);
          maxY = Math.max(maxY, this.logicalY + this.logicalHeight);
        }
      } else {
        minX = this.logicalX ?? 0; minY = this.logicalY ?? 0;
        maxX = minX + (this.logicalWidth ?? this.canvas.width / dpr);
        maxY = minY + (this.logicalHeight ?? this.canvas.height / dpr);
      }

      if (minX === Infinity) { minX = 0; minY = 0; maxX = this.canvas.width / dpr; maxY = this.canvas.height / dpr; }

      let w = maxX - minX, h = maxY - minY, cx = minX + w / 2, cy = minY + h / 2;

      const pad = mergedConfig.padding ?? 10;
      w += pad * 2; h += pad * 2;

      if (mergedConfig.aspectRatio) {
        const currentRatio = w / h;
        if (currentRatio < mergedConfig.aspectRatio) w = h * mergedConfig.aspectRatio;
        else if (currentRatio > mergedConfig.aspectRatio) h = w / mergedConfig.aspectRatio;
      }

      const maxWidth = mergedConfig.maxWidth || 4096;
      const maxHeight = mergedConfig.maxHeight || 4096;
      if (w > maxWidth) w = maxWidth;
      if (h > maxHeight) h = maxHeight;

      return { x: cx - w / 2, y: cy - h / 2, w: Math.max(1, w), h: Math.max(1, h) };
    }

    _saveState(suppressEvent = false) {
      const stateObj = {
        strokes: this.strokes,
        logicalX: this.logicalX, logicalY: this.logicalY, logicalWidth: this.logicalWidth, logicalHeight: this.logicalHeight,
        viewportX: this.viewport.x, viewportY: this.viewport.y, viewportScale: this.viewport.scale,
      };
      const snapshot = JSON.stringify(stateObj);
      if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) return;
      this.undoStack.push(snapshot);
      this.redoStack = [];
      
      if (!suppressEvent && this.options.onChange) {
         this.options.onChange();
      }
    }

    setTool(color, width, alpha) {
      if (width) {
        this.options.strokeWidth = width;
        this.options.eraserWidth = width * 4;
      }
      if (alpha) this.options.strokeAlpha = alpha;
      if (color) {
        if (color === 'eraser') this.currentTool = 'eraser';
        else if (color === 'pan') this.currentTool = 'pan';
        else if (color === 'crop') this.currentTool = 'crop';
        else if (color === 'select') this.currentTool = 'select';
        else if (['pen', 'line', 'rect', 'oval'].includes(color)) this.currentTool = color;
        else { 
          this.options.strokeColor = color; 
          if (!['pen', 'line', 'rect', 'oval'].includes(this.currentTool)) {
              this.currentTool = 'pen'; 
          }
        }
        if (this.currentTool !== 'select' && this.selectedChunkIds.size > 0) {
            this.selectedChunkIds.clear();
            this._redraw();
        }
      }

      if (this.currentTool === 'eraser') {
        const ew = this.options.eraserWidth;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ew}" height="${ew}" viewBox="0 0 ${ew} ${ew}"><circle cx="${ew / 2}" cy="${ew / 2}" r="${ew / 2 - 1}" fill="none" stroke="#999999" stroke-width="2"/></svg>`;
        this.canvas.style.cursor = `url('data:image/svg+xml,${encodeURIComponent(svg)}') ${ew / 2} ${ew / 2}, crosshair`;
      }
      else if (this.currentTool === 'crop') this.canvas.style.cursor = 'crosshair';
      else if (this.currentTool === 'pan') this.canvas.style.cursor = 'grab';
      else if (this.currentTool === 'select') this.canvas.style.cursor = 'default';
      else this.canvas.style.cursor = 'crosshair';
    }

    updateSelectionStyle(updates) {
      if (this.selectedChunkIds.size === 0) return false;
      let changed = false;

      for (const chunk of this.strokes) {
        if (this.selectedChunkIds.has(chunk.id)) {
          if (chunk.type === 'image') {
            if (updates.color) chunk.color = updates.color;
            if (updates.alpha !== undefined) chunk.alpha = updates.alpha;
          } else {
            if (updates.color) chunk.color = updates.color;
            if (updates.width) chunk.width = updates.width;
            if (updates.alpha !== undefined) chunk.alpha = updates.alpha;
          }
          changed = true;
        }
      }

      if (changed) { this._redraw(); this._saveState(); }
      return changed;
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      if (!this._hasResized) {
        this._hasResized = true;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);

        if (this.draftCanvas) {
          this.draftCanvas.width = rect.width * dpr;
          this.draftCanvas.height = rect.height * dpr;
          this.draftCtx.scale(dpr, dpr);
        }

        if (this._needsAutoFit) {
          this._needsAutoFit = false;
          this.zoomToFit();
        } else { this._redraw(); }
        return;
      }

      const oldW = this.canvas.width / dpr;
      const oldH = this.canvas.height / dpr;

      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.scale(dpr, dpr);

      if (this.draftCanvas) {
        this.draftCanvas.width = rect.width * dpr;
        this.draftCanvas.height = rect.height * dpr;
        this.draftCtx.scale(dpr, dpr);
      }

      const diffW = rect.width - oldW; const diffH = rect.height - oldH;
      this.viewport.x += diffW / 2; this.viewport.y += diffH / 2;

      if (this._needsAutoFit) {
        this._needsAutoFit = false;
        this.zoomToFit();
      } else { this._redraw(); }
    }

    zoomToFit(padding = 20) {
      if (this.strokes.length === 0 && !this.logicalWidth) return;

      const rect = this.canvas.parentElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      let targetBounds;
      if (this.logicalWidth) targetBounds = { x: this.logicalX, y: this.logicalY, w: this.logicalWidth, h: this.logicalHeight };
      else targetBounds = this._getExportBounds({ mode: 'auto', padding: 0 });

      const availW = rect.width - padding * 2;
      const availH = rect.height - padding * 2;

      if (availW <= 0 || availH <= 0) return;

      const scaleX = availW / targetBounds.w; const scaleY = availH / targetBounds.h;

      const targetScale = Math.min(scaleX, scaleY, 5.0);

      const cx = targetBounds.x + targetBounds.w / 2;
      const cy = targetBounds.y + targetBounds.h / 2;

      this.viewport.scale = Math.max(0.05, targetScale);
      this.viewport.x = rect.width / 2 - cx * this.viewport.scale;
      this.viewport.y = rect.height / 2 - cy * this.viewport.scale;

      this._redraw();
    }

    duplicateSelection() {
      if (this.selectedChunkIds.size === 0) return;

      const newSelection = new Set();
      const offset = 20 / this.viewport.scale;

      const idMap = new Map();
      const clonedStrokes = [];

      for (const chunk of this.strokes) {
        if (this.selectedChunkIds.has(chunk.id)) {
          const clone = JSON.parse(JSON.stringify(chunk));

          // Generate ONE new ID per original line
          if (!idMap.has(chunk.id)) idMap.set(chunk.id, FluxKit.utils.getUniqueId());
          clone.id = idMap.get(chunk.id);

          // Apply visual offset
          if (clone.type === 'image') {
            clone.x += offset; clone.y += offset;
          } else {
            for (let i = 0; i < clone.points.length; i += 2) {
              clone.points[i] += offset; clone.points[i + 1] += offset;
            }
          }

          clonedStrokes.push(clone);
          newSelection.add(clone.id);
        }
      }

      this.strokes.push(...clonedStrokes);
      this.selectedChunkIds = newSelection;
      this._redraw();
      this._saveState();
    }

    flipSelection(axis = 'h') {
      if (this.selectedChunkIds.size === 0) return;
      const bounds = this._getGroupBounds();
      const cx = bounds.x + bounds.w / 2;
      const cy = bounds.y + bounds.h / 2;

      for (const chunk of this.strokes) {
        if (!this.selectedChunkIds.has(chunk.id)) continue;
        
        if (chunk.type === 'image') {
          if (axis === 'h') {
            const chunkCx = chunk.x + chunk.w / 2;
            chunk.x = (cx - (chunkCx - cx)) - chunk.w / 2;
            chunk.w = -chunk.w;
            chunk.rotation = -(chunk.rotation || 0);
          } else {
            const chunkCy = chunk.y + chunk.h / 2;
            chunk.y = (cy - (chunkCy - cy)) - chunk.h / 2;
            chunk.h = -chunk.h;
            chunk.rotation = -(chunk.rotation || 0);
          }
        } else {
          for (let i = 0; i < chunk.points.length; i += 2) {
            if (axis === 'h') chunk.points[i] = cx - (chunk.points[i] - cx);
            else chunk.points[i + 1] = cy - (chunk.points[i + 1] - cy);
          }
        }
      }
      this._redraw();
      this._saveState();
    }

    undo() {
      if (this.undoStack.length > 1) {
        this.redoStack.push(this.undoStack.pop());
        try {
          const prevState = JSON.parse(this.undoStack[this.undoStack.length - 1]);
          if (prevState.strokes) {
            this.strokes = prevState.strokes;
            this.logicalX = prevState.logicalX;
            this.logicalY = prevState.logicalY;
            this.logicalWidth = prevState.logicalWidth;
            this.logicalHeight = prevState.logicalHeight;
          } else {
            this.strokes = prevState;
          }
        } catch (e) {}
        this._redraw();
        if (this.options.onChange) this.options.onChange();
      }
    }

    redo() {
      if (this.redoStack.length > 0) {
        const nextStateStr = this.redoStack.pop();
        this.undoStack.push(nextStateStr);
        try {
          const nextState = JSON.parse(nextStateStr);
          if (nextState.strokes) {
            this.strokes = nextState.strokes;
            this.logicalX = nextState.logicalX;
            this.logicalY = nextState.logicalY;
            this.logicalWidth = nextState.logicalWidth;
            this.logicalHeight = nextState.logicalHeight;
          } else {
            this.strokes = nextState;
          }
        } catch (e) {}
        this._redraw();
        if (this.options.onChange) this.options.onChange();
      }
    }

    loadVectorJSON(jsonString, isDestructive = true) {
      try {
        const parsed = JSON.parse(jsonString);
        let hasCamera = false;

        if (parsed && parsed.strokes) {
          if (!Array.isArray(parsed.strokes)) throw new Error("Strokes data is corrupted.");
          this.strokes = parsed.strokes;
          this.assets = parsed.assets || {};
          this.logicalX = parsed.logicalX;
          this.logicalY = parsed.logicalY;
          this.logicalWidth = parsed.logicalWidth;
          this.logicalHeight = parsed.logicalHeight;
          if (parsed.viewportScale !== undefined) {
            this.viewport.x = parsed.viewportX;
            this.viewport.y = parsed.viewportY;
            this.viewport.scale = parsed.viewportScale;
            hasCamera = true;
          }
        } else if (Array.isArray(parsed)) {
          this.strokes = parsed;
          this.assets = {};
        }

        for (const stroke of this.strokes) {
          if (stroke.type === 'image' && stroke.dataUrl && !stroke.assetId) {
            const newId = 'asset_' + FluxKit.utils.getUniqueId();
            this.assets[newId] = stroke.dataUrl;
            stroke.assetId = newId;
            delete stroke.dataUrl;
          }
        }

        if (isDestructive) {
          this.undoStack = [this.getVectorJSON()]; 
          this.redoStack = [];
        } else {
          this._saveState(true);
        }

        if (hasCamera) {
          this._needsAutoFit = false;
          this._redraw();
        } else {
          const rect = this.canvas.parentElement.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) this.zoomToFit();
          else this._needsAutoFit = true;
        }
        return true;
      } catch (e) {
        console.error('Scratchpad: Failed to load vector data', e);
        return false;
      }
    }

    getVectorJSON() {
      const activeAssets = new Set();
      this.strokes.forEach(s => { 
        if (s.type === 'image' && s.assetId) activeAssets.add(s.assetId); 
      });
      const cleanAssets = {};
      for (const [id, data] of Object.entries(this.assets || {})) {
        if (activeAssets.has(id)) cleanAssets[id] = data;
      }
      this.assets = cleanAssets;
      return JSON.stringify({
        strokes: this.strokes,
        assets: this.assets || {},
        logicalX: this.logicalX,
        logicalY: this.logicalY,
        logicalWidth: this.logicalWidth,
        logicalHeight: this.logicalHeight,
        viewportX: this.viewport.x,
        viewportY: this.viewport.y,
        viewportScale: this.viewport.scale,
      });
    }

    pasteImage(fileOrBlob, clientX = null, clientY = null) {
      if (this.options.disableImagePaste) {
        FluxKit.ui.showNotification("Image pasting is disabled!", { icon: '🚫' });
        return;
      }
      const reader = new FileReader();
      reader.onload = async e => {
        const rawDataUrl = e.target.result;
        let dataUrl = rawDataUrl;
        if (this.options.imageCompression) {
          const { maxWidth, quality } = this.options.imageCompression;
          dataUrl = await FluxKit.utils.compressImage(rawDataUrl, maxWidth, quality);
        }
        const img = new Image();
        img.onload = () => {
          const assetId = 'asset_' + FluxKit.utils.getUniqueId();
          this.assets[assetId] = dataUrl;

          const dpr = window.devicePixelRatio || 1;
          const logicalW = this.canvas.width / dpr;
          const logicalH = this.canvas.height / dpr;
          const scale = Math.min((logicalW * 0.9) / img.width, (logicalH * 0.9) / img.height, 1);

          const w = img.width * scale, h = img.height * scale;

          let targetX = (logicalW / 2 - this.viewport.x) / this.viewport.scale - w / 2;
          let targetY = (logicalH / 2 - this.viewport.y) / this.viewport.scale - h / 2;

          if (clientX !== null && clientY !== null) {
            const rect = this.canvas.getBoundingClientRect();
            targetX = ((clientX - rect.left) - this.viewport.x) / this.viewport.scale - w / 2;
            targetY = ((clientY - rect.top) - this.viewport.y) / this.viewport.scale - h / 2;
          }

          this.imageCache[assetId] = img;

          this.strokes.push({ id: FluxKit.utils.getUniqueId(), type: 'image', assetId: assetId, color: null, x: targetX, y: targetY, w, h });

          this._redraw();
          this._saveState();
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(fileOrBlob);
    }

    setZoom(delta, centerPoint = null) {
      const oldScale = this.viewport.scale;
      let newScale = this.viewport.scale + delta;
      newScale = Math.max(0.1, Math.min(5, newScale)); // Clamp between 10% and 500% zoom

      if (centerPoint) {
        const ratio = newScale / oldScale;
        this.viewport.x = centerPoint.x - (centerPoint.x - this.viewport.x) * ratio;
        this.viewport.y = centerPoint.y - (centerPoint.y - this.viewport.y) * ratio;
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const cx = rect.width / 2; const cy = rect.height / 2;
        const ratio = newScale / oldScale;
        this.viewport.x = cx - (cx - this.viewport.x) * ratio;
        this.viewport.y = cy - (cy - this.viewport.y) * ratio;
      }

      this.viewport.scale = newScale;
      this._redraw();
    }

    exportImage(config = {}) {
      if (this.strokes.length === 0) return null;

      const bounds = this._getExportBounds(config);
      const dpr = window.devicePixelRatio || 1;

      const finalW = config.outputWidth || bounds.w;
      const finalH = config.outputHeight || bounds.h;

      const scaleX = finalW / bounds.w;
      const scaleY = finalH / bounds.h;

      const exportCanvas = FluxKit.utils.createHTMLElement('canvas', { width: finalW * dpr, height: finalH * dpr });
      const exportCtx = exportCanvas.getContext('2d');

      exportCtx.scale(dpr, dpr);

      exportCtx.scale(scaleX, scaleY);
      exportCtx.translate(-bounds.x, -bounds.y);

      if (this.options.backgroundColor !== 'transparent') {
        exportCtx.fillStyle = this._resolveColor(this.options.backgroundColor);
        exportCtx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      }

      for (const stroke of this.strokes) this._renderChunkToCtx(exportCtx, stroke);

      return exportCanvas.toDataURL('image/png', config.quality || 1.0);
    }

    scaleSelection(scaleFactor) {
      if (this.selectedChunkIds.size === 0) return;
      const bounds = this._getGroupBounds();
      if (!bounds) return;

      // Find the absolute center of the bounding box to act as the anchor
      const cx = bounds.x + bounds.w / 2;
      const cy = bounds.y + bounds.h / 2;

      for (const chunk of this.strokes) {
        if (!this.selectedChunkIds.has(chunk.id)) continue;

        if (chunk.type === 'image') {
          // Scale position relative to center, then scale dimensions
          chunk.x = cx + (chunk.x - cx) * scaleFactor;
          chunk.y = cy + (chunk.y - cy) * scaleFactor;
          chunk.w *= scaleFactor;
          chunk.h *= scaleFactor;
        } else {
          // Scale stroke thickness and all individual vector points
          chunk.width = Math.max(0.5, chunk.width * scaleFactor);
          for (let i = 0; i < chunk.points.length; i += 2) {
            chunk.points[i] = cx + (chunk.points[i] - cx) * scaleFactor;
            chunk.points[i + 1] = cy + (chunk.points[i + 1] - cy) * scaleFactor;
          }
        }
      }
      this._redraw();
      this._saveState();
    }

    deleteSelection() {
      if (this.selectedChunkIds.size === 0) return;
      this.strokes = this.strokes.filter(s => !this.selectedChunkIds.has(s.id));
      this.selectedChunkIds.clear();
      this._redraw(); this._saveState();
    }

    clear() { this.strokes = []; this._redraw(); this._saveState(); }

    claimsKey(e) {
      if (!this.isActive || FluxKit.utils.shouldIgnoreKeystroke(e)) return false;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();

      if (key === 'escape' && this.currentStroke && this.currentTool === 'line') return true;
      
      if (cmdOrCtrl && ['z', 'y'].includes(key)) return true;
      if (cmdOrCtrl && key === 'backspace') return true;

      if (this.selectedChunkIds.size > 0) {
        if (key === 'delete' || key === 'backspace') return true;
        if (cmdOrCtrl && (key === 'd' || key === 'c')) return true;
        if (e.shiftKey && (key === 'h' || key === 'v')) return true;
      }

      if (['+', '=', '-', '_'].includes(key)) return true;
      if ((key === '1' && e.shiftKey) || key === '0') return true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) return true;
      if (key === ' ' || key === 'spacebar') return true;

      return false;
    }

    destroy() {
      if (this._abortController) this._abortController.abort();
      this.canvas = null;
      this.draftCanvas = null;
      this.ctx = null;
      this.draftCtx = null;
    }
  };

  FluxKit.ui.Scratchpad ??= class {
    constructor(parentElement, options = {}) {
      this._abortController = new AbortController();
      this.globalCtrlOpts = { signal: this._abortController.signal, capture: true };
      this.isActive = true;
      this.options = {
        ...options,
        sizeControl: options.sizeControl || 'buttons',
        brushSizes: options.brushSizes || [
          { id: 'Light', val: 2, sizePx: 4 },
          { id: 'Thin', val: 4, sizePx: 8 },
          { id: 'Medium', val: 8, sizePx: 16 },
          { id: 'Thick', val: 12, sizePx: 24 },
        ],
        brushAlphas: options.brushAlphas || [
          { id: 'Ghost', val: 0.2 },
          { id: 'Light', val: 0.5 },
          { id: 'Solid', val: 1.0 },
        ],
        showExportSettings: options.showExportSettings || false,
        defaultExportMode: options.defaultExportMode || 'auto',
      };
      this.rootNode = parentElement.getRootNode();
      this.currentExportMode = this.options.defaultExportMode;
      this.themeConfig = { autoDark: !(options.theme && options.theme.darkMode !== undefined), ...(options.theme || {}) };
      this.imageCache = {};
      this.container = FluxKit.utils.createHTMLElement('div', { className: 'flx-sp-wrapper' });
      this.toolsGroupColors = FluxKit.utils.createHTMLElement('div', { style: 'display: flex; gap: 10px; align-items: center;' });
      this.core = null; this.colorButtons = []; this.currentColor = null;
      this.logicalWidth = null; this.logicalHeight = null;
      this._injectStyles(parentElement); this._buildUI(parentElement);
      this._themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this._onSystemThemeChange = e => { if (!this.themeConfig.autoDark) return; this.updateTheme(); };
      this._themeMediaQuery.addEventListener('change', this._onSystemThemeChange, this.globalCtrlOpts);

      const keydownListener = (e) => {
        if (!this.core || !this.container || !this.isActive) return;
        if (FluxKit.utils.shouldIgnoreKeystroke(e)) return;

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
        const key = e.key.toLowerCase();

        if (key === 'escape' && this.container.classList.contains('flx-sp-maximized')) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          if (this.fsBtn) this.fsBtn.click();
          return;
        }

        if (cmdOrCtrl && key === 'f') { e.preventDefault(); this.currentFsMode = 'native'; if (this.fsBtn) this.fsBtn.click(); return; }
        
        if (!cmdOrCtrl && !e.shiftKey) {
            if (key === 'f') { e.preventDefault(); this.currentFsMode = 'viewport'; if (this.fsBtn) this.fsBtn.click(); return; }
            if (key === 'v') { e.preventDefault(); if (this.selectBtn) this.selectBtn.click(); return; }
            if (key === 'e') { e.preventDefault(); if (this.eraserBtn) this.eraserBtn.click(); return; }
            if (key === 'c') { e.preventDefault(); if (this.cropBtn) this.cropBtn.click(); return; }
            if (key === 'p') { e.preventDefault(); if (this.penBtn) this.penBtn.click(); return; }
            if (key === 'l') { e.preventDefault(); if (this.lineBtn) this.lineBtn.click(); return; }
            if (key === 'r') { e.preventDefault(); if (this.rectBtn) this.rectBtn.click(); return; }
            if (key === 'o') { e.preventDefault(); if (this.ovalBtn) this.ovalBtn.click(); return; }

            if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(key)) {
              const idx = parseInt(key) - 1;
              if (this.colorButtons && this.colorButtons[idx]) {
                  e.preventDefault();
                  this.colorButtons[idx].click();
              }
              return;
            }
        }
      };
      
      document.addEventListener('keydown', keydownListener, this.globalCtrlOpts);
    }

    _injectStyles(parentElement) {
      const root = parentElement.getRootNode();
      const styleId = 'flx-scratchpad-styles';
      if (root.querySelector(`#${styleId}`)) return;
      const styleText = `
        .flx-sp-wrapper {
          display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 380px;
          background-color: var(--sp-bg); border: 1px solid var(--sp-border); border-radius: 8px;
          overflow: hidden; box-shadow: var(--sp-shadow, 0 4px 12px rgba(0,0,0,0.05));
          transition: all 0.2s ease;
        }
        .flx-sp-canvas-area {
          flex: 1; position: relative; touch-action: none; background-color: var(--sp-bg);
          background-image: radial-gradient(var(--sp-dot) 1.5px, transparent 1.5px);
          background-size: 24px 24px; background-position: center; transition: background-color 0.2s ease;
          box-shadow: inset 0 0 0 1px var(--sp-separator), inset 0 3px 6px rgba(0,0,0,0.03);
        }
        .flx-sp-toolbar {
          display: flex; justify-content: space-between; align-items: center; padding: 8px 12px;
          background-color: var(--sp-input-bg); border: 1px solid var(--sp-accent);
          transition: background-color 0.2s ease; position: relative; z-index: 10;
          flex-wrap: nowrap; gap: 8px; overflow: visible; border-radius: 8px 8px 0 0;
        }
        .flx-sp-color-btn { padding: 4px 12px !important; background: var(--sp-bg) !important; border-radius: 6px !important; border: 1px solid var(--sp-separator) !important;}
        .flx-sp-color-btn:hover { transform: scale(1.15); }
        .flx-sp-color-btn.active { transform: scale(1.2); box-shadow: 0 0 0 1px var(--sp-accent) !important; z-index: 2; }
        .flx-sp-swatch {
          display: block; flex-shrink: 0;
          width: 16px !important; height: 16px !important;
          min-width: 16px !important; min-height: 16px !important;
          border-radius: 50%; pointer-events: none;
          background-color: var(--sp-color-val); /* Binds to the CSS var we set in JS */
        }
        .flx-sp-tool-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; padding: 0 !important;
          background: transparent !important; border: 1px solid var(--sp-separator) !important; border-radius: 6px;
          color: var(--sp-text) !important; opacity: 0.8;
          cursor: pointer; transition: all 0.15s ease;
        }
        .flx-sp-tool-btn:hover {
          background-color: var(--sp-accent) !important;
          color: var(--sp-btn-text) !important;
          opacity: 1;
        }
        .flx-sp-tool-btn.danger {
            opacity: 0.8;
        }
        .flx-sp-tool-btn:hover, .flx-sp-tool-btn.active {
          background-color: var(--sp-accent) !important;
          color: var(--sp-btn-text) !important;
          border-color: var(--sp-accent) !important;
        }
        .flx-sp-tool-btn.danger:hover {
          color: #ffffff !important; background-color: #ef4444 !important; border-color: #ef4444 !important;
        }
        /* --- Brush Settings Popover & Sliders --- */
        .flx-sp-size-preview {
          display: block; border-radius: 50%; background: var(--sp-text);
          transition: width 0.1s, height 0.1s, opacity 0.1s;
          flex-shrink: 0; /* CRITICAL: Prevents the dot from being squished into an oval */
        }
        .flx-sp-popover {
          position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%) translateY(-10px);
          background-color: var(--sp-bg); border: 1px solid var(--sp-border);
          border-radius: 8px; padding: 12px 16px; box-shadow: var(--sp-shadow);
          display: flex; flex-direction: column; gap: 14px; align-items: center;
          opacity: 0; pointer-events: none; transition: all 0.2s ease; z-index: 100;
        }
        .flx-sp-popover.open {
          opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0);
        }
        .flx-sp-popover-row {
          display: flex; align-items: center; gap: 10px; width: 100%;
        }
        .flx-sp-popover-label {
          font-size: 11px; color: var(--sp-text); opacity: 0.7; width: 45px; text-align: left;
        }
        /* --- Custom Range Slider --- */
        .flx-sp-slider-container {
          display: flex; align-items: center; gap: 10px; margin: 0 8px; width: 100%;
        }
        .flx-sp-slider {
          -webkit-appearance: none; appearance: none;
          width: 100%; min-width: 120px !important; /* Force a minimum readable width */
          height: 4px !important; border-radius: 2px !important;
          background: var(--sp-separator) !important; outline: none !important;
          margin: 0 !important; padding: 0 !important; border: none !important;
        }
        .flx-sp-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 14px !important; height: 14px !important; border-radius: 50% !important;
          background: var(--sp-text) !important; cursor: pointer !important;
          border: 2px solid var(--sp-input-bg) !important;
          box-shadow: 0 0 0 1px var(--sp-separator), 0 2px 4px rgba(0,0,0,0.1) !important;
          transition: transform 0.1s;
        }
        .flx-sp-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
        .flx-sp-slider::-moz-range-thumb {
          width: 10px !important; height: 10px !important; border-radius: 50% !important;
          background: var(--sp-text) !important; cursor: pointer !important;
          border: 2px solid var(--sp-input-bg) !important;
          box-shadow: 0 0 0 1px var(--sp-separator), 0 2px 4px rgba(0,0,0,0.1) !important;
        }
        .flx-sp-wrapper:fullscreen {
          border: none !important; border-radius: 0 !important;
          min-width: 100vw !important; min-height: 100vh !important;
        }
        .flx-sp-wrapper:-webkit-full-screen {
          border: none !important; border-radius: 0 !important;
          min-width: 100vw !important; min-height: 100vh !important;
        }
        .flx-sp-left-more-popover {
          position: absolute; top: calc(100% + 8px); left: 0;
          transform: translateY(-10px);
          background-color: var(--sp-bg); border: 1px solid var(--sp-border);
          border-radius: 8px; padding: 8px; box-shadow: var(--sp-shadow);
          display: flex; flex-direction: row; flex-wrap: wrap; width: 140px;
          justify-content: flex-start; gap: 6px;
          opacity: 0; pointer-events: none; transition: all 0.2s ease; z-index: 100;
        }
        .flx-sp-left-more-popover.open {
          opacity: 1; pointer-events: auto; transform: translateY(0);
        }
        .flx-sp-more-popover {
          position: absolute; top: calc(100% + 8px); right: 0;
          transform: translateY(-10px);
          background-color: var(--sp-bg); border: 1px solid var(--sp-border);
          border-radius: 8px; padding: 8px; box-shadow: var(--sp-shadow);
          display: flex; flex-direction: row; flex-wrap: wrap; width: 130px;
          justify-content: flex-start; gap: 6px;
          opacity: 0; pointer-events: none; transition: all 0.2s ease; z-index: 100;
        }
        .flx-sp-more-popover.open {
          opacity: 1; pointer-events: auto; transform: translateY(0);
        }
        .flx-sp-wrapper.flx-sp-maximizeds {
          position: fixed !important; pointer-events: auto;
          top: 24px !important; left: 24px !important;
          right: 24px !important; bottom: 24px !important;
          width: auto !important; height: auto !important;
          max-width: none !important; max-height: none !important;
          z-index: 2147483646 !important; /* Maximum possible z-index - 1 for tooltips */
          box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6), 0 12px 48px rgba(0, 0, 0, 0.5) !important;
          border-radius: 12px !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .flx-sp-wrapper.flx-sp-maximized {
          position: fixed !important; pointer-events: auto;
          top: 0 !important; left: 0 !important;
          width: 100vw !important; height: 100vh !important;
          z-index: 2147483646 !important;
          display: grid !important;
          place-items: center !important;
          background: rgba(0, 0, 0, 0.6) !important;
          border-radius: 0 !important;
        }
        .flx-sp-wrapper.flx-sp-maximized > .flx-sp-canvas-area {
          width: 90vw !important;
          height: 85vh !important;
          border-radius: 12px !important;
          box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5) !important;
          border: 1px solid var(--sp-accent);
        }
        .flx-sp-wrapper.flx-sp-maximized > .flx-sp-toolbar {
          width: 70vw !important;
          border-radius: 12px !important;
          box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5) !important;
        }
      `;
      const style = FluxKit.utils.createHTMLElement('style', { id: styleId, textContent: styleText });
      if (root === document) (document.head || document.documentElement).appendChild(style);
      else root.appendChild(style);
    }

    _buildUI(parentElement) {
      const toolbar = FluxKit.utils.createHTMLElement('div', { className: 'flx-sp-toolbar' });
      const leftTools = FluxKit.utils.createHTMLElement('div', { style: 'display: flex; gap: 8px; align-items: center;' });
      const rightActions = FluxKit.utils.createHTMLElement('div', { style: 'display: flex; gap: 4px; align-items: center; flex-wrap: nowrap' });
      this.toolbar = toolbar; this.leftTools = leftTools; this.rightActions = rightActions;

      const getDivider = () => FluxKit.utils.createHTMLElement('div', { style: 'width: 1px; height: 18px; background: var(--sp-separator); margin: 0 4px;' });

      const openPopover = (e, btnElement, popoverElement) => {
        e.preventDefault(); e.stopPropagation();
        popoverElement.classList.toggle('open');
        btnElement.classList.toggle('active');
      }

      const closePopover = (e, btnElement, popoverElement) => {
        if (popoverElement.classList.contains('open')) {
          const path = e.composedPath();
          if (!path.includes(btnElement) && !path.includes(popoverElement)) {
            popoverElement.classList.remove('open');
            btnElement.classList.remove('active');
          }
        }
      }

      this.leftMoreWrapper = FluxKit.utils.createHTMLElement('div', { style: 'position: relative; display: none; align-items: center;' });
      this.leftMoreBtn = FluxKit.utils.createHTMLElement('button', { className: 'flx-sp-tool-btn', spTooltip: 'More Tools', icon: 'chevronRight', eventListener: (e) => openPopover(e, this.leftMoreBtn, this.leftMorePopover) });
      this.leftMorePopover = FluxKit.utils.createHTMLElement('div', { className: 'flx-sp-left-more-popover', eventListener: e => openPopover(e, this.leftMoreBtn, this.leftMorePopover) });

      document.addEventListener('pointerdown', e => closePopover(e, this.leftMoreBtn, this.leftMorePopover), this.globalCtrlOpts);

      this.leftMoreWrapper.appendChild(this.leftMoreBtn); this.leftMoreWrapper.appendChild(this.leftMorePopover);

      this.leftTools.appendChild(this.toolsGroupColors); this.leftTools.appendChild(this.leftMoreWrapper);

      const collapsibleTools = [];

      leftTools.appendChild(this.toolsGroupColors);
      leftTools.appendChild(getDivider());

      this.currentWidth = this.options.strokeWidth || 3;

      if (this.options.sizeControl !== 'none') {
        const popover = FluxKit.utils.createHTMLElement('div', { className: 'flx-sp-popover' });
        const settingsBtn = FluxKit.utils.createHTMLElement('button', { className: 'flx-sp-tool-btn', spTooltip: 'Brush Settings', icon: 'settings', eventListener: e => openPopover(e, settingsBtn, popover) });

        document.addEventListener('pointerdown', e => closePopover(e, settingsBtn, popover), this.globalCtrlOpts);

        const previewDot = FluxKit.utils.createHTMLElement('span', { className: 'flx-sp-size-preview', style: { width: `${this.currentWidth}px`, height: `${this.currentWidth}px`, opacity: this.currentAlpha } });
        popover.appendChild(FluxKit.utils.createHTMLElement('div', { style: 'height: 30px; display: flex; align-items: center; justify-content: center; width: 100%; margin-bottom: 4px;', children: previewDot }));

        const updateStrokeSize = (val) => {
          this.currentWidth = val;
          previewDot.style.width = `${val}px`;
          previewDot.style.height = `${val}px`;
          if (this.core) {
            this.core.setTool(null, val, null);
            this.core.updateSelectionStyle({ width: val });
          }
        }
        const updateStrokeAlpha = (val) => {
          this.currentAlpha = val;
          previewDot.style.opacity = val;
          if (this.core) {
            this.core.setTool(null, null, val);
            this.core.updateSelectionStyle({ alpha: val });
          }
        }
        if (this.options.sizeControl === 'sliders') {
          this.currentAlpha = this.options.strokeAlpha || 1.0;
          const createSliderRow = (label, min, max, val, bg, onChange) => {
            const slider = FluxKit.utils.createHTMLElement('input', { className: 'flx-sp-slider', type: 'range', min, max, value: val, eventListener: { input: onChange } });
            if (bg) slider.style.background = bg;
            return FluxKit.utils.createHTMLElement('div', { class: 'flx-sp-popover-row', style: { width: '100%' }, innerHTML: FluxKit.utils.safeHTML(`<span class="flx-sp-popover-label">${label}</span>`), children: slider });;
          }
          popover.appendChild(
            createSliderRow('Size', '1', '30', this.currentWidth, null, e => updateStrokeSize(parseInt(e.target.value, 10))),
          );
          popover.appendChild(
            createSliderRow('Opacity', '10', '100', this.currentAlpha * 100, 'linear-gradient(to right, transparent, var(--sp-separator))', (e) => updateStrokeAlpha(parseInt(e.target.value, 10) / 100)),
          );
        } else if (this.options.sizeControl === 'buttons') {
          const container = FluxKit.utils.createHTMLElement('div', { style: 'display: flex; flex-direction: column; gap: 12px;' });

          const createBtnRow = (label, items, currentVal, activeProp, onClick ) => {
            const btnRow = FluxKit.utils.createHTMLElement('div', { style:  'display: flex; gap: 6px;' });
            items.forEach(item => {
              const btn = FluxKit.utils.createHTMLElement('button', { class: `flx-sp-tool-btn ${currentVal === item.val ? 'active' : ''}`, spTooltip: item.id,
                innerHTML: FluxKit.utils.safeHTML(item.sizePx
                  ? `<span style="display:block; width:${item.sizePx}px; height:${item.sizePx}px; border-radius:50%; background:currentColor; flex-shrink:0;"></span>`
                  : `<span style="font-size: 10px;">${item.id[0]}</span>`),
                eventListener: (e) => {
                  e.preventDefault();
                  onClick(item.val);
                  Array.from(btnRow.children).forEach(b => b.classList.remove('active'));
                  btn.classList.add('active');
                }
              })
              btnRow.appendChild(btn);
            });
            return FluxKit.utils.createHTMLElement('div', { innerHTML: FluxKit.utils.safeHTML(`<span class="flx-sp-popover-label" style="margin-bottom:4px; display:block;">${label}</span>`), children: btnRow });
          };

          container.appendChild(createBtnRow('Size', this.options.brushSizes, this.currentWidth, 'size', (val) => updateStrokeSize(val)));
          container.appendChild(createBtnRow('Opacity', this.options.brushAlphas, this.currentAlpha, 'alpha', val => updateStrokeAlpha(val)));

          popover.appendChild(container);
        }

        leftTools.appendChild(FluxKit.utils.createHTMLElement('div', { style: 'position: relative; display: flex; align-items: center;', children: [ settingsBtn, popover ] }));
      }

      const createActionBtn = (iconKey, title, isDanger, action) => FluxKit.utils.createHTMLElement('button', { className: `flx-sp-tool-btn ${isDanger ? 'danger' : ''}`, spTooltip: title, icon: iconKey, eventListener: (e) => { e.preventDefault(); action(); }
      });

      this.cropBtn = FluxKit.utils.createHTMLElement('button', { className: 'flx-sp-tool-btn', spTooltip: 'Crop Canvas', icon: 'crop' });

      this.cropBtn.addEventListener('click', e => {
        e.preventDefault();
        if (this.core) this.core.setTool('crop');
        this.colorButtons.forEach(b => b.classList.remove('active'));
        if (this.eraserBtn) this.eraserBtn.classList.remove('active');
        if (this.selectBtn) this.selectBtn.classList.remove('active');
        this.cropBtn.classList.add('active');
      });

      const focusBtn = FluxKit.utils.createHTMLElement('button', { className: 'flx-sp-tool-btn', spTooltip: 'Fit to Screen', icon: 'focus' });
      focusBtn.addEventListener('click', e => {
        e.preventDefault();
        if (this.core) this.core.zoomToFit();
      });

      this.currentFsMode = this.options.defaultFsMode || 'viewport';

      const fsHandler = (e) => {
        e.preventDefault();

        if (this.currentFsMode === 'native') {
          if (!document.fullscreenElement) {
            this.container.requestFullscreen().catch(err => console.warn(err));
          } else {
            document.exitFullscreen();
          }
        } else {
          const isMax = this.container.classList.toggle('flx-sp-maximized');
          if (isMax) {
            const root = this.container.getRootNode();
            const portalTarget = root === document ? document.body : root;

            this._originalParent = this.container.parentElement;
            this._placeholder = document.createElement('div');
            this._placeholder.style.cssText = `width: ${this.container.offsetWidth}px; height: ${this.container.offsetHeight}px;`;
            this._originalParent.insertBefore(this._placeholder, this.container);

            portalTarget.appendChild(this.container);
          } else {
            if (this._originalParent && this._placeholder) {
              this._originalParent.insertBefore(
                this.container,
                this._placeholder,
              );
              this._placeholder.remove();
              this._originalParent = null;
              this._placeholder = null;
            }
          }
        }
      };

      const fsMenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        fsPopover.classList.toggle('open');
        this.fsBtn.classList.toggle('active');
      }

      this.fsBtn = FluxKit.utils.createHTMLElement('button', {
        className: 'flx-sp-tool-btn', spTooltip: 'Maximize (Right-click for options)', icon: 'maximize',
        eventListener: { click: fsHandler, contexflxenu: fsMenu } });
      const fsPopover = FluxKit.utils.createHTMLElement('div', { class: 'flx-sp-popover', style: { width: '175px' }});

      document.addEventListener('pointerdown', e => {
        if (fsPopover.classList.contains('open')) {
          const path = e.composedPath();
          if (!path.includes(this.fsBtn) && !path.includes(fsPopover)) {
            fsPopover.classList.remove('open');
            this.fsBtn.classList.remove('active');
          }
        }
      }, this.globalCtrlOpts);

      fsPopover.appendChild(FluxKit.utils.createHTMLElement('div', { class: 'flx-sp-popover-row',
        children: FluxKit.utils.createHTMLElement('select', {
          style: 'flex: 1; background: var(--sp-input-bg); color: var(--sp-text); border: 1px solid var(--sp-border); border-radius: 4px; padding: 4px; outline: none; font-size: 11px; cursor: pointer;',
          children: [{ id: 'viewport', label: 'Expand to Viewport' }, { id: 'native', label: 'Native Fullscreen' }].map(opt => FluxKit.utils.createHTMLElement('option', { value: opt.id, textContent: opt.label, selected: opt.id === this.currentFsMode })),
          eventListener: { change: (e) => (this.currentFsMode = e.target.value) }
        })
      }));

      const fsWrapper = FluxKit.utils.createHTMLElement('div', { style: 'position: relative; display: flex; align-items: center;', children: [ this.fsBtn, fsPopover ] });

      const fileInput = FluxKit.utils.createHTMLElement('input', {
        type: 'file',
        accept: '.json',
        style: 'display: none;',
        eventListener: {
          change: (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
              const success = this.core.loadVectorJSON(event.target.result, false);
              if (!success) alert("Failed to load file. The JSON may be corrupted or from an older version.");
            };
            reader.readAsText(file);
            e.target.value = '';
          }
        }
      });
      this.container.appendChild(fileInput);

      const dataIOPopover = FluxKit.utils.createHTMLElement('div', { class: 'flx-sp-popover', style: { width: '140px' } });
      const dataIOBtn = FluxKit.utils.createHTMLElement('button', {
        className: 'flx-sp-tool-btn', icon: 'document', spTooltip: 'Import / Export Vector JSON',
        eventListener: (e) => openPopover(e, dataIOBtn, dataIOPopover)
      });

      document.addEventListener('pointerdown', e => closePopover(e, dataIOBtn, dataIOPopover), this.globalCtrlOpts);

      const exportJsonBtn = FluxKit.utils.createHTMLElement('button', {
        className: 'flx-sp-tool-btn', style: 'width: 100%; justify-content: flex-start; padding: 4px 8px !important; border: none !important;',
        innerHTML: FluxKit.utils.safeHTML(`
          <span style="display: flex; width: 16px; height: 16px; align-items: center; justify-content: center;">
            ${FluxKit.ui.icons.export}
          </span>
          <span style="font-size: 11px; margin-left: 6px;">Export JSON</span>
        `),
        eventListener: {
          click: (e) => {
            e.preventDefault();
            closePopover(e, dataIOBtn, dataIOPopover); // Hide menu
            if (!this.core || this.core.strokes.length === 0) return;

            const data = this.core.getVectorJSON();
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `scratchpad_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }
        }
      });

      const importJsonBtn = FluxKit.utils.createHTMLElement('button', {
        className: 'flx-sp-tool-btn', style: 'width: 100%; justify-content: flex-start; padding: 4px 8px !important; border: none !important;',
        innerHTML: FluxKit.utils.safeHTML(`
          <span style="display: flex; width: 16px; height: 16px; align-items: center; justify-content: center;">
              ${FluxKit.ui.icons.import}
          </span>
          <span style="font-size: 11px; margin-left: 8px;">Import JSON</span>
        `),
        eventListener: {
          click: (e) => {
            e.preventDefault();
            closePopover(e, dataIOBtn, dataIOPopover);
            fileInput.click();
          }
        }
      });

      dataIOPopover.appendChild(exportJsonBtn);
      dataIOPopover.appendChild(importJsonBtn);

      const dataIOWrapper = FluxKit.utils.createHTMLElement('div', {
        style: 'position: relative; display: flex; align-items: center;',
        children: [dataIOBtn, dataIOPopover]
      });

      collapsibleTools.push(this.cropBtn, focusBtn, fsWrapper, getDivider());

      if (this.options.showExportSettings) {
        const exportPopover = FluxKit.utils.createHTMLElement('div', { class: 'flx-sp-popover', style: { width: '180px' } });
        const exportBtn = FluxKit.utils.createHTMLElement('button', { className: 'flx-sp-tool-btn', spTooltip: 'Export/Save Mode', icon: 'image', eventListener: (e) => openPopover(e, exportBtn, exportPopover) });

        document.addEventListener('pointerdown', e => closePopover(e, exportBtn, exportPopover), this.globalCtrlOpts);

        const createSelectRow = (optionsArr, selectedVal, onChange) => FluxKit.utils.createHTMLElement('div', { className: 'flx-sp-popover-row', style: { width: '100%' },
          children: FluxKit.utils.createHTMLElement('select', { style: 'flex: 1; background: var(--sp-input-bg); color: var(--sp-text); border: 1px solid var(--sp-border); border-radius: 4px; padding: 4px; outline: none; font-size: 11px; cursor: pointer;',
            children: optionsArr.map(opt => FluxKit.utils.createHTMLElement('option', { value: opt.id, textContent: opt.label, selected: opt.id === selectedVal })),
            eventListener: { change: onChange }
          })
        });

        exportPopover.appendChild(
          createSelectRow([
              { id: 'auto', label: 'Auto (Fit All Ink)' },
              { id: 'logical', label: 'Logical (Crop Frame)' },
              { id: 'viewport', label: 'Viewport (Screen Only)' }
            ],
            this.currentExportMode, (e) => { this.currentExportMode = e.target.value; },
          ),
        );

        const exportWrapper = FluxKit.utils.createHTMLElement('div', { style: 'position: relative; display: flex; align-items: center;', children: [ exportBtn, exportPopover ] })
        rightActions.appendChild(exportWrapper);
        rightActions.appendChild(getDivider());
        collapsibleTools.push(exportWrapper);
      }

      collapsibleTools.push(dataIOWrapper);

      const moreBtn = FluxKit.utils.createHTMLElement('button', { className: 'flx-sp-tool-btn', icon: 'dots', eventListener: (e) => openPopover(e, moreBtn, morePopover) });
      const morePopover = FluxKit.utils.createHTMLElement('div', { class: 'flx-sp-more-popover' });

      document.addEventListener('pointerdown', e => closePopover(e, moreBtn, morePopover), this.globalCtrlOpts);

      const moreWrapper = FluxKit.utils.createHTMLElement('div', { style: 'position: relative; display: none; align-items: center;', children: [ moreBtn, morePopover ] });

      collapsibleTools.forEach(el => rightActions.appendChild(el));
      rightActions.appendChild(moreWrapper);

      rightActions.appendChild(getDivider());
      rightActions.appendChild(createActionBtn('undo', 'Undo', false, () => this.core && this.core.undo()));
      rightActions.appendChild(createActionBtn('redo', 'Redo', false, () => this.core && this.core.redo()));
      rightActions.appendChild(
        createActionBtn('trash', 'Clear Canvas', true, () => {
          if (this.core && this.core.selectedChunkIds.size > 0) this.core.deleteSelection();
          else if (this.core) this.core.clear();
        }),
      );

      toolbar.appendChild(leftTools);
      toolbar.appendChild(rightActions);

      this.collapsibleTools = collapsibleTools;
      this.moreWrapper = moreWrapper;
      this.morePopover = morePopover;
      this.moreBtn = moreBtn;

      this._requestLayoutCheck = () => {
        window.requestAnimationFrame(() => {
          if (!this.toolbar || !this.container) return;

          if (this.collapsibleTools && this.moreWrapper) {
            this.collapsibleTools.forEach(el => this.rightActions.insertBefore(el, this.moreWrapper));
            this.moreWrapper.style.display = 'none';
          }

          if (this.allLeftNodes) {
            this.allLeftNodes.forEach(node => this.toolsGroupColors.appendChild(node));
            this.leftMoreWrapper.style.display = 'none';
          }

          const getSpace = () => this.leftTools.scrollWidth + this.rightActions.scrollWidth;
          const maxSpace = this.toolbar.clientWidth - 16;

          if (getSpace() > maxSpace && this.collapsibleTools) {
            this.moreWrapper.style.display = 'flex';
            for (let i = this.collapsibleTools.length - 1; i >= 0; i--) {
              const el = this.collapsibleTools[i];
              this.morePopover.prepend(el);
              if (getSpace() <= maxSpace) break;
            }
          }

          if (getSpace() > maxSpace && this.allLeftNodes) {
            this.leftMoreWrapper.style.display = 'flex';
            for (let i = this.allLeftNodes.length - 1; i >= 0; i--) {
              const node = this.allLeftNodes[i];
              if (node.classList && node.classList.contains('active')) continue;
              this.leftMorePopover.prepend(node);
              if (getSpace() <= maxSpace) break;
            }
          }
        });
      };

      this._toolbarObserver = new ResizeObserver(() => {
        window.requestAnimationFrame(() => {
          if (this._requestLayoutCheck) this._requestLayoutCheck();
          if (this.core) this.core.resize();
        });
      });
      this._toolbarObserver.observe(this.container);
      this._abortController.signal.addEventListener('abort', () => this._toolbarObserver.disconnect());

      const canvasWrapper = FluxKit.utils.createHTMLElement('div', { class: 'flx-sp-canvas-area' });
      const canvas = FluxKit.utils.createHTMLElement('canvas', { style: 'width: 100%; height: 100%; display: block; cursor: crosshair;' });
      canvasWrapper.appendChild(canvas);

      this.container.appendChild(toolbar);
      this.container.appendChild(canvasWrapper);
      parentElement.appendChild(this.container);

      this.core = new FluxKit.ui.ScratchpadCore(canvas, {
        strokeWidth: this.options.strokeWidth || 3,
        strokeAlpha: this.options.strokeAlpha || 1.0,
        pointThreshold: this.options.pointThreshold || 3,
        backgroundColor: this.options.backgroundColor || 'transparent',
        onChange: this.options.onChange || null,
        strokeColor: this.currentColor || 'var(--sp-text)',
        imageCompression: this.options.imageCompression,
        disableImagePaste: this.options.disableImagePaste,
      });

      this._pasteListener = e => {
        if (this.container.offsetWidth === 0 || this.container.offsetHeight === 0) return;

        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return;
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const imageBlob = item.getAsFile();
            if (this.core) this.core.pasteImage(imageBlob);
            break;
          }
        }
      };

      document.addEventListener('paste', this._pasteListener, this.globalCtrlOpts);
      this._fullscreenListener = () => setTimeout(() => { if (this.core) this.core.resize(); }, 50);

      document.addEventListener('fullscreenchange', this._fullscreenListener, this.globalCtrlOpts);
      document.addEventListener('webkitfullscreenchange', this._fullscreenListener, this.globalCtrlOpts); // Safari fallback

      this.updateTheme();
    }

    _rebuildColorPickers(activeColorObjs = null) {
      this.toolsGroupColors.replaceChildren();
      this.leftMorePopover.replaceChildren();
      this.colorButtons = [];

      if (!activeColorObjs) {
        activeColorObjs = [
          { id: 'Theme Primary', val: 'var(--sp-text)' },
          { id: 'Theme Accent', val: 'var(--sp-accent)' },
          { id: 'Red', val: '#ef4444' },
          { id: 'Green', val: '#10b981' }
        ];
      }

      const colorTokens = activeColorObjs.map((obj, index) => {
        if (this.options.keepColors) return obj.val;
        return `var(--sp-color-${index + 1}, ${obj.val})`;
      });

      if (!this.currentColor || (!colorTokens.includes(this.currentColor) && this.currentColor !== 'eraser' && this.currentColor !== 'select')) {
        this.currentColor = colorTokens[0];
        if (this.core) this.core.setTool(this.currentColor);
      }

      colorTokens.forEach((tokenColor, index) => {
        const btn = FluxKit.utils.createHTMLElement('button', { className: `flx-sp-color-btn ${tokenColor === this.currentColor ? 'active' : ''}`, spTooltip: `Color: ${activeColorObjs[index].id}` });
        const swatch = FluxKit.utils.createHTMLElement('span', { class: 'flx-sp-swatch' });
        btn.style.setProperty('--sp-color-val', tokenColor, 'important');

        btn.appendChild(swatch);

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (this.currentColor === 'select' && this.core && this.core.selectedChunkIds.size > 0) {
            this.core.options.strokeColor = tokenColor;
            this.core.updateSelectionStyle({ color: tokenColor });
            if (this.leftMorePopover) this.leftMorePopover.classList.remove('open');
            if (this.leftMoreBtn) this.leftMoreBtn.classList.remove('active');
            if (this.cropBtn) this.cropBtn.classList.remove('active');
            return; // Stay in select mode!
          }

          this.currentColor = tokenColor;
          this.core.setTool(tokenColor);

          this.colorButtons.forEach(b => b.classList.remove('active'));
          if (this.eraserBtn) this.eraserBtn.classList.remove('active');
          if (this.selectBtn) this.selectBtn.classList.remove('active');
          if (this.cropBtn) this.cropBtn.classList.remove('active');
          btn.classList.add('active');

          if (this.leftMorePopover) this.leftMorePopover.classList.remove('open');
          if (this.leftMoreBtn) this.leftMoreBtn.classList.remove('active');
          if (this._requestLayoutCheck) this._requestLayoutCheck();
        });

        this.colorButtons.push(btn);
        this.toolsGroupColors.appendChild(btn);
      });

      this.toolsGroupColors.appendChild(FluxKit.utils.createHTMLElement('div', { style: 'width: 1px; height: 16px; background: var(--sp-separator); margin: 0 4px;' }));

      this.selectBtn = FluxKit.utils.createHTMLElement('button', {
        className: `flx-sp-tool-btn ${this.currentColor === 'select' ? 'active' : ''}`,
        icon: 'pointer', spTooltip: 'Select Tool',
        eventListener: (e) => {
          e.preventDefault();
          if (this.currentColor === 'select') {
            const lastColor = this.core ? this.core.options.strokeColor : 'var(--sp-text)';
            this.currentColor = lastColor;

            if (this.core) this.core.setTool(lastColor);

            this.selectBtn.classList.remove('active');
            this.colorButtons.forEach(b => {
              if (b.style.getPropertyValue('--sp-color-val') === lastColor || b.title.includes(lastColor)) {
                  b.classList.add('active');
              }
            });
            if (this._requestLayoutCheck) this._requestLayoutCheck();
            return;
          }
          this.currentColor = 'select';
          this.core.setTool('select');
          this.colorButtons.forEach(b => b.classList.remove('active'));
          if (this.eraserBtn) this.eraserBtn.classList.remove('active');
          this.selectBtn.classList.add('active');
          if (this.leftMorePopover) this.leftMorePopover.classList.remove('open');
          if (this.leftMoreBtn) this.leftMoreBtn.classList.remove('active');
          if (this.cropBtn) this.cropBtn.classList.remove('active');
          if (this._requestLayoutCheck) this._requestLayoutCheck();
        }
      });
      this.toolsGroupColors.appendChild(this.selectBtn);

      this.eraserBtn = FluxKit.utils.createHTMLElement('button', {
        className: `flx-sp-tool-btn ${this.currentColor === 'eraser' ? 'active' : ''}`,
        icon: 'eraser', spTooltip: 'Erasure',
        eventListener: (e) => {
          e.preventDefault();
          if (this.core && this.core.selectedChunkIds.size > 0) {
              this.core.deleteSelection();
              return;
          }
          this.currentColor = 'eraser';
          this.core.setTool('eraser');
          this.colorButtons.forEach(b => b.classList.remove('active'));
          if (this.selectBtn) this.selectBtn.classList.remove('active');
          this.eraserBtn.classList.add('active');
          if (this.leftMorePopover) this.leftMorePopover.classList.remove('open');
          if (this.leftMoreBtn) this.leftMoreBtn.classList.remove('active');
          if (this._requestLayoutCheck) this._requestLayoutCheck();
          if (this.cropBtn) this.cropBtn.classList.remove('active');
        }
      });
      this.toolsGroupColors.appendChild(this.eraserBtn);

      const createToolBtn = (id, icon, tooltip) => {
        const btn = FluxKit.utils.createHTMLElement('button', {
          className: `flx-sp-tool-btn ${this.currentTool === id || (!this.currentTool && id === 'pen') ? 'active' : ''}`, spTooltip: tooltip, icon,
          eventListener: (e) => {
            e.preventDefault();
            if (this.core && this.core.currentTool === 'line' && this.core.currentStroke) {
              this.core.currentStroke.points.splice(-2, 2);
              if (this.core.currentStroke.points.length >= 4) this.core.strokes.push(this.core.currentStroke);
              this.core.currentStroke = null;
              this.core._drawDraftStroke();
              this.core._redraw();
            }

            this.core.setTool(id);
            
            [this.selectBtn, this.eraserBtn, this.cropBtn, this.penBtn, this.lineBtn, this.rectBtn, this.ovalBtn].forEach(b => {
              if (b) b.classList.remove('active');
            });
            btn.classList.add('active');
            
            if (this.leftMorePopover) this.leftMorePopover.classList.remove('open');
            if (this.leftMoreBtn) this.leftMoreBtn.classList.remove('active');
            if (this._requestLayoutCheck) this._requestLayoutCheck();
          }
        });
        return btn;
      };

      this.penBtn = createToolBtn('pen', 'edit', 'Pen Tool (P)');
      this.lineBtn = createToolBtn('line', 'line', 'Continuous Line (L)');
      this.rectBtn = createToolBtn('rect', 'square', 'Rectangle (R)');
      this.ovalBtn = createToolBtn('oval', 'circle', 'Oval (O)');

      this.toolsGroupColors.appendChild(this.penBtn);
      this.toolsGroupColors.appendChild(this.lineBtn);
      this.toolsGroupColors.appendChild(this.rectBtn);
      this.toolsGroupColors.appendChild(this.ovalBtn);

      this.allLeftNodes = Array.from(this.toolsGroupColors.children);
      if (this._requestLayoutCheck) this._requestLayoutCheck();
    }

    updateTheme(newTheme = {}) {
      if (newTheme.darkMode !== undefined) this.themeConfig.autoDark = false;
      this.themeConfig = { ...this.themeConfig, ...newTheme };

      const isDark = this.themeConfig.autoDark
        ? FluxKit.theme.isSiteDark(this.container.parentElement || document.body)
        : !!this.themeConfig.darkMode;

      const activeTheme = FluxKit.theme.getSiteStyles({ isDark: isDark, target: this.container.parentElement || document.body, scrapeDOM: true });

      this.theme = { ...activeTheme, ...this.themeConfig };

      const dotColor = FluxKit.theme.createAlphaColor(this.theme.text, 0.15);

      this.container.style.setProperty('--sp-bg', this.theme.bg);
      this.container.style.setProperty('--sp-input-bg', this.theme.bg);
      this.container.style.setProperty('--sp-border', this.theme.border);
      this.container.style.setProperty('--sp-text', this.theme.text);
      this.container.style.setProperty('--sp-accent', this.theme.accentBg);
      this.container.style.setProperty('--sp-btn-text', this.theme.btnTextColor);
      this.container.style.setProperty('--sp-hover-bg', this.theme.hoverBg);
      this.container.style.setProperty('--sp-separator', this.theme.separator);
      this.container.style.setProperty('--sp-shadow', this.theme.boxShadow || '0 4px 12px rgba(0,0,0,0.05)');
      this.container.style.setProperty('--sp-dot', dotColor);
      this.container.style.setProperty('--sp-color-btn-bg', FluxKit.theme.createAlphaColor(this.theme.accentBg, 0.12));

      const textHex = FluxKit.theme.rgbToHex(this.theme.text, true).toLowerCase();
      const accentHex = FluxKit.theme.rgbToHex(this.theme.accentBg, true).toLowerCase();

      const defaultColors = [
        { id: 'Theme Primary', val: 'var(--sp-text)' },
        (textHex === accentHex)
              ? { id: 'Blue', val: '#3b82f6' }
              : { id: 'Theme Accent', val: 'var(--sp-accent)' },
        { id: 'Theme Accent', val: 'var(--sp-accent)' },
        { id: 'Red', val: '#ef4444' },
        { id: 'Green', val: '#10b981' }
      ];

      let penColors = this.options.colors || defaultColors;
      const seenValues = new Set();

      let activeColorObjs = penColors.reduce((acc, c, index) => {
        const rawVal = typeof c === 'string' ? c : (c.val || '');
        const isValid = rawVal.includes('var(') || CSS.supports('color', rawVal);
        let finalObj = c;
        if (!isValid) {
          console.warn(`[FluxKit Scratchpad] Invalid color at index ${index} ("${rawVal}"). Substituting with safe default.`);
          finalObj = defaultColors[index] || { id: 'Fallback Gray', val: '#808080' };
        }
        else if (typeof c === 'string') {
          let name = c;
          if (c.includes('--sp-text')) name = 'Theme Primary';
          else if (c.includes('--sp-accent')) name = 'Theme Accent';
          else if (c.startsWith('#') || c.startsWith('rgb')) name = FluxKit.theme.getColorName(c);
          finalObj = { id: name, val: c };
        }
        let compareVal = finalObj.val.toLowerCase().trim();
        if (compareVal.startsWith('rgb')) {
          compareVal = FluxKit.theme.rgbToHex(compareVal, true);
        } else if (compareVal.startsWith('#')) {
          if (compareVal.length === 4) compareVal = '#' + compareVal.split('').slice(1).map(x => x + x).join('');
          else if (compareVal.length === 9) compareVal = compareVal.substring(0, 7);
        }
        if (!seenValues.has(compareVal)) {
          seenValues.add(compareVal);
          acc.push(finalObj);
        } else {
          console.warn(`[FluxKit Scratchpad] Duplicate color dropped to save UI space ("${finalObj.val}").`);
        }
        return acc;
      }, []);

      if (!this.options.keepColors) {
        activeColorObjs.forEach((cObj, idx) => this.container.style.setProperty(`--sp-color-${idx + 1}`, cObj.val));
      }

      this._rebuildColorPickers(activeColorObjs);
      FluxKit.ui.initTooltips({ ...this.theme, rootElement: this.rootNode, attribute: 'data-sp-tooltip' });
      if (this.core) this.core._redraw();
    }

    getPreviewImage(config = {}) {
      if (!this.core) return null;
      const finalConfig = { mode: this.currentExportMode, ...config };
      return this.core.exportImage(finalConfig);
    }

    refresh() { this.core.resize(); }
    
    getVectorData() { return this.core.getVectorJSON(); }

    loadVectorData(jsonString) { this.core.loadVectorJSON(jsonString); }

    claimsKey(e) {
      if (!this.core || !this.container || !this.isActive) return false;
      if (FluxKit.utils.shouldIgnoreKeystroke(e)) return false;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();

      if (key === 'escape' && this.container.classList.contains('flx-sp-maximized')) return true;
      if (cmdOrCtrl && key === 'f') return true; 
      if (!cmdOrCtrl && !e.shiftKey) {
        if (['v', 'e', 'c', 'p', 'l', 'r', 'o', 'f'].includes(key)) return true;
        if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(key)) return true; 
      }

      return this.core.claimsKey(e);
    }

    setIsActive(state) {
      this.isActive = !!state;
      if (this.core) {
        this.core.isActive = this.isActive;
      }
    }

    destroy() {
      if (this.currentFsMode === 'native' && (document.fullscreenElement || document.webkitFullscreenElement)) {
        document.exitFullscreen().catch(() => {});
      } else if (this.container.classList.contains('flx-sp-maximized')) {
        if (this._placeholder) {
          this._placeholder.remove();
          this._placeholder = null;
        }
        this._originalParent = null;
      }

      if (this._abortController) this._abortController.abort();

      if (this._toolbarObserver) {
        this._toolbarObserver.disconnect();
        this._toolbarObserver = null;
      }

      if (this.core) {
        this.core.destroy();
        this.core = null;
      }

      if (this.container) {
        this.container.remove();
        this.container = null;
      }
    }
  };

  FluxKit.help.register('ui.Scratchpad', {
    _summary: 'A full-featured, responsive interactive drawing board with a built-in UI toolkit.',
    _description: 'Instantiates a complete canvas workspace including a toolbar, dynamic color pickers, tool selection, undo/redo, and responsive UI elements. It manages an internal ScratchpadCore rendering engine.',
    _command: 'new FluxKit.ui.Scratchpad(parentElement, options)',
    _arguments: {
      'parentElement': { Type: 'HTMLElement', Required: 'Yes', Description: 'The DOM node where the scratchpad interface will be mounted.' }
    },
    _config: {
      'sizeControl': { Type: 'String', Default: "'buttons'", Description: "Controls the brush size UI format. Accepts 'buttons', 'sliders', or 'none'." },
      'brushSizes': { Type: 'Array', Default: '4 standard sizes', Description: 'Array of size configurations for the UI. E.g., [{ id: "Thin", val: 4, sizePx: 8 }]' },
      'brushAlphas': { Type: 'Array', Default: '3 standard alphas', Description: 'Array of opacity configurations. E.g., [{ id: "Solid", val: 1.0 }]' },
      'showExportSettings': { Type: 'Boolean', Default: 'false', Description: 'Whether to show the export/save format dropdown.' },
      'defaultExportMode': { 
        Type: 'String', 
        Default: "'auto'", 
        Description: "Export framing behavior:\n• 'auto': Calculates a tight bounding box around all drawn ink/images.\n• 'logical': Exports the explicitly cropped frame (or physical canvas size if uncropped).\n• 'viewport': Takes a snapshot of exactly what is currently visible on-screen, respecting pan/zoom." 
      },
      'theme': { Type: 'Object', Default: '{}', Description: 'FluxKit theme overrides (e.g., { autoDark: false, darkMode: true }).' },
      'colors': { Type: 'Array', Default: 'Theme defaults', Description: 'Custom color palette array. Accepts hex codes, CSS variable references, or objects.' },
      'keepColors': { Type: 'Boolean', Default: 'false', Description: 'If true, prevents the UI from overriding root CSS variable colors.' },
      'strokeWidth': { Type: 'Number', Default: '3', Description: 'Initial stroke size.' },
      'strokeAlpha': { Type: 'Number', Default: '1.0', Description: 'Initial stroke opacity (0.0 to 1.0).' },
      'backgroundColor': { Type: 'String', Default: "'transparent'", Description: 'Background color of the canvas workspace.' },
      'pointThreshold': { Type: 'Number', Default: '3', Description: 'Minimum pixel distance between stroke points to trigger rendering.' },
      'defaultFsMode': { Type: 'String', Default: "'viewport'", Description: "Fullscreen behavior: 'viewport' (in-window max) or 'native' (OS fullscreen)." },
      'imageCompression': { Type: 'Object|Boolean', Default: '{ maxWidth: 1600, quality: 0.85 }', Description: 'Configuration for compressing pasted images. Pass false to disable compression entirely.' },
      'onChange': { Type: 'Function', Default: 'null', Description: 'Callback triggered whenever the canvas state changes.' }
    },
    _example: `const scratchpadInstance = new FluxKit.ui.Scratchpad(document.getElementById('spad-container'), {\n  sizeControl: 'sliders',\n  backgroundColor: '#ffffff',\n  imageCompression: { maxWidth: 1200, quality: 0.6 }\n});`,
    setIsActive: {
      _summary: 'Grants or revokes contextual keyboard focus for this specific instance.',
      _command: 'scratchpadInstance.setIsActive(state)',
      _arguments: { 'state': { Type: 'Boolean', Required: 'Yes', Description: 'Pass true if the modal needs to capture the keystrokes, false to revoke keystrokes.' } }
    },
    updateTheme: {
      _summary: 'Dynamically updates the UI and canvas styling to match a new theme.',
      _command: 'scratchpadInstance.updateTheme(newTheme)',
      _arguments: { 'newTheme': { Type: 'Object', Required: 'No', Description: 'Theme configuration object containing overrides like { darkMode: true }.' } }
    },
    refresh: {
      _summary: 'Forces a resize calculation and redraw of the internal canvas.',
      _command: 'scratchpadInstance.refresh()'
    },
    getVectorData: {
      _summary: 'Exports the entire canvas state as a serialized JSON string.',
      _command: 'scratchpadInstance.getVectorData()',
      _returns: 'String (JSON)'
    },
    getPreviewImage: {
      _summary: 'Renders the current canvas vectors into a base64 PNG data URL.',
      _command: 'scratchpadInstance.getPreviewImage(config)',
      _arguments: { 'config': { Type: 'Object', Required: 'No', Description: 'Export configurations like { mode: "auto", quality: 1.0, padding: 10 }.' } },
      _returns: 'String (Data URL) or null'
    },
    loadVectorJSON: {
      _summary: 'Restores the canvas from a previously exported serialized JSON string.',
      _command: 'scratchpadInstance.loadVectorJSON(jsonString)',
      _arguments: { 'jsonString': { Type: 'String', Required: 'Yes', Description: 'The JSON string generated by getVectorData().' } }
    },
    claimsKey: {
      _summary: 'Checks if a given KeyboardEvent should be handled by the Scratchpad.',
      _command: 'scratchpadInstance.claimsKey(event)',
      _arguments: { 'event': { Type: 'KeyboardEvent', Required: 'Yes', Description: 'The raw DOM keyboard event.' } },
      _returns: 'Boolean'
    },
    destroy: {
      _summary: 'Completely unmounts the scratchpad, destroys elements, and removes event listeners.',
      _command: 'scratchpadInstance.destroy()'
    }
  }, { isNative: true });

  FluxKit.help.register('ui.ScratchpadCore', {
    _summary: 'The headless vector rendering and interaction engine behind the Scratchpad.',
    _description: 'Handles all canvas drawing, matrix transformations, hardware-accelerated pan/zoom, vector math, shape calculations, undo/redo histories, and pointer event logic. It contains zero HTML UI elements.',
    _command: 'const coreInstance = new FluxKit.ui.ScratchpadCore(canvasElement, options)',
    _arguments: { 'canvasElement': { Type: 'HTMLCanvasElement', Required: 'Yes', Description: 'The raw HTML5 <canvas> element to render on.' } },
    _config: {
      'strokeColor': { Type: 'String', Default: "'var(--sp-text)'", Description: 'Initial stroke color.' },
      'strokeWidth': { Type: 'Number', Default: '3', Description: 'Initial stroke width.' },
      'strokeAlpha': { Type: 'Number', Default: '1.0', Description: 'Initial stroke alpha transparency.' },
      'pointThreshold': { Type: 'Number', Default: '3', Description: 'Pixel distance between vector points required to record a move.' },
      'backgroundColor': { Type: 'String', Default: "'transparent'", Description: 'Background fill color on render.' },
      'eraserWidth': { Type: 'Number', Default: '20', Description: 'Pixel radius of the vector eraser.' },
      'chunkThreshold': { Type: 'Number', Default: '30', Description: 'The length of points array before a line is batched into a finalized chunk.' },
      'exportConfig': { Type: 'Object', Default: '{ mode: "auto", maxWidth: 4096, maxHeight: 4096, padding: 10 }', Description: 'Default configurations for image exporting.' },
      'imageCompression': { Type: 'Object|Boolean', Default: '{ maxWidth: 1600, quality: 0.85 }', Description: 'Configuration for compressing pasted images. Pass false to disable compression entirely.' },
      'onChange': { Type: 'Function', Default: 'null', Description: 'Callback triggered when history/strokes are modified.' }
    },
    
    deleteSelection: {
      _summary: 'Deletes all currently selected chunks from the canvas.',
      _command: 'coreInstance.deleteSelection()'
    },
    updateSelectionStyle: {
      _summary: 'Applies style changes to currently selected items.',
      _command: 'coreInstance.updateSelectionStyle(updates)',
      _arguments: { 'updates': { Type: 'Object', Required: 'Yes', Description: '{ color: string, width: number, alpha: number }' } },
      _returns: 'Boolean (true if changes were made)'
    },
    resize: {
      _summary: 'Recalculates device pixel ratios and internal sizes based on the parent container bounds.',
      _command: 'coreInstance.resize()'
    },
    zoomToFit: {
      _summary: 'Calculates the bounding box of all strokes and scales the viewport matrix to fit them perfectly.',
      _command: 'coreInstance.zoomToFit(padding)',
      _arguments: { 'padding': { Type: 'Number', Required: 'No', Description: 'Pixel padding applied around the bounding box. Default is 20.' } }
    },
    duplicateSelection: {
      _summary: 'Clones the currently selected chunks and translates them by an offset.',
      _command: 'coreInstance.duplicateSelection()'
    },
    flipSelection: {
      _summary: 'Flips selected shapes across an axis by performing matrix transformations.',
      _command: 'coreInstance.flipSelection(axis)',
      _arguments: { 'axis': { Type: 'String', Required: 'No', Description: "'h' for horizontal, 'v' for vertical. Defaults to 'h'." } }
    },
    scaleSelection: {
      _summary: 'Multiplies the coordinates and dimensions of all selected elements by a specific scale factor.',
      _command: 'coreInstance.scaleSelection(scaleFactor)',
      _arguments: { 'scaleFactor': { Type: 'Number', Required: 'Yes', Description: 'Multiplier (e.g., 1.05 for 5% increase).' } }
    },
    undo: {
      _summary: 'Reverts the canvas to the previous state in the history stack.',
      _command: 'coreInstance.undo()'
    },
    redo: {
      _summary: 'Advances the canvas to the next state in the history stack (if available).',
      _command: 'coreInstance.redo()'
    },
    clear: {
      _summary: 'Completely erases the canvas and resets the strokes array.',
      _command: 'coreInstance.clear()'
    },
    setTool: {
      _summary: 'Changes the active pointer mode or drawing parameters.',
      _command: 'coreInstance.setTool(color, width, alpha)',
      _arguments: {
        'tool': { Type: 'String', Required: 'No', Description: "Tool mode, or color code for pen ('eraser', 'pan', 'crop', 'select', 'pen', 'line', 'rect', 'oval')." },
        'width': { Type: 'Number', Required: 'No', Description: 'New stroke width.' },
        'alpha': { Type: 'Number', Required: 'No', Description: 'New stroke alpha transparency.' }
      }
    },
    getVectorJSON: {
      _summary: 'Serializes the headless state (strokes, assets, bounds) to a JSON string.',
      _command: 'coreInstance.getVectorJSON()',
      _returns: 'String'
    },
    loadVectorJSON: {
      _summary: 'Restores the headless state from a serialized JSON string.',
      _command: 'coreInstance.loadVectorJSON(jsonString, isDestructive)',
      _arguments: {
        jsonString: { Type: 'String', Required: 'Yes', Description: 'The JSON state string.' },
        isDestructive: { Type: 'Boolean', Required: 'No', Description: 'By default set to true, if false then retains previous history stack and allows undo after load.' },
      }
    },
    pasteImage: {
      _summary: 'Embeds a File or Blob image onto the canvas at a specific viewport coordinate.',
      _command: 'coreInstance.pasteImage(fileOrBlob, clientX, clientY)',
      _arguments: {
        'fileOrBlob': { Type: 'File|Blob', Required: 'Yes', Description: 'The image source.' },
        'clientX': { Type: 'Number', Required: 'No', Description: 'Screen X coordinate for paste center.' },
        'clientY': { Type: 'Number', Required: 'No', Description: 'Screen Y coordinate for paste center.' }
      }
    },
    setZoom: {
      _summary: 'Steps the viewport zoom matrix up or down centered around a point.',
      _command: 'coreInstance.setZoom(delta, centerPoint)',
      _arguments: {
        'delta': { Type: 'Number', Required: 'Yes', Description: 'Amount to zoom relative to the current scale.' },
        'centerPoint': { Type: 'Object', Required: 'No', Description: '{x, y} coordinate defining the zoom anchor point. Defaults to canvas center.' }
      }
    },
    exportImage: {
      _summary: 'Draws all strokes to a temporary canvas and exports it to a PNG data URL.',
      _command: 'coreInstance.exportImage(config)',
      _arguments: { 'config': { Type: 'Object', Required: 'No', Description: 'Overrides for the default exportConfig.' } },
      _returns: 'String (Data URL) or null'
    },
    destroy: {
      _summary: 'Aborts controllers, destroys canvas references, and releases memory.',
      _command: 'coreInstance.destroy()'
    }
  }, { isNative: true });

})();