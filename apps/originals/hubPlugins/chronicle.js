// ==UserScript==
// @name         FHP: Chronicle
// @description  Track events, eras, and people with automatic milestone/timehop detection, multi-profile cloud sync, and external ICS calendar subscriptions.
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @author       JYashu
// @license      Apache-2.0
// @match        *://*/*
// @match        file:///*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @require      https://flux-suite.vercel.app/libs/flux-kit/core.js
// @require      https://flux-suite.vercel.app/libs/flux-kit/sync.js
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      graph.microsoft.com
// @connect      login.microsoftonline.com
// @connect      my.microsoftpersonalcontent.com
// @connect      calendar.google.com
// @connect      *
// ==/UserScript==
/* global FluxKit */

(function() {
  'use strict';

  if (window.self !== window.top) return;

  const { createLogger, createHTMLElement, safeHTML, getUniqueId } = FluxKit.utils;

  const { logMessage, logError } = createLogger('FluxHub', 'Chronicle');

  const SYNC_FILENAME = 'chronicle_vault.json';

  const STATE_KEYS = {
    activeProfile: 'dates_active_profile',
    syncProfile: 'dates_sync_profile',
    vault: 'dates_vault',
    lastSync: 'dates_last_sync',
    lastIcsSync: 'dates_last_ics_sync',
    widgetActive: 'dates_widget_active',
    activeTheme: 'dates_active_theme',
    pendingDeltas: 'dates_pending_deltas'
  };

  const hopState = FluxKit.state.register('time-hop');

  let activeReturnPath = '> date', activeEditReturnPath = '> date view-mode';
  let contextStack = [], activePersonContextId = null, activeParentContextId = null;
  let transientEventsCache = [];
  let isSyncing = false;

  const DateUtils = {
    getNextOccurrence: (dateStr) => {
      const d = new Date(dateStr);
      const now = new Date();
      
      if (d.getTime() > now.getTime()) return d.getTime(); 
      
      const nextAnniv = new Date(now.getFullYear(), d.getMonth(), d.getDate());
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      
      if (nextAnniv.getTime() < todayStart) nextAnniv.setFullYear(now.getFullYear() + 1);
      return nextAnniv.getTime();
    },

    getDaysBetween: (d1, d2) => {
      const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
      const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
      return Math.floor((utc2 - utc1) / 86400000);
    },

    getRelativeString: (targetDate, baseDate = new Date()) => {
      const target = new Date(targetDate);
      const base = new Date(baseDate);
      const isFuture = target > base;

      const d1 = isFuture ? base : target;
      const d2 = isFuture ? target : base;

      let years = d2.getFullYear() - d1.getFullYear();
      let months = d2.getMonth() - d1.getMonth();
      let days = d2.getDate() - d1.getDate();

      if (days < 0) {
        months--;
        const prevMonth = new Date(d2.getFullYear(), d2.getMonth(), 0);
        days += prevMonth.getDate();
      }
      if (months < 0) { years--; months += 12; }

      if (years === 0 && months === 0 && days === 0) return 'Today';

      const parts = [];
      if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
      if (months > 0) parts.push(`${months} mo${months > 1 ? 's' : ''}`);
      if (days > 0) parts.push(`${days} d`);

      return parts.join(', ') + ' ' + (isFuture ? 'from now' : 'ago');
    },

    exportICS: (event, isYearly = false) => {
      const dt = new Date(event.date);
      const formatICS = (date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const dtstamp = formatICS(new Date());
      const dtstart = formatICS(dt);

      let ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//FluxHub//Dates Plugin//EN',
        'BEGIN:VEVENT',
        `UID:${event.id}@fluxhub`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${dtstart}`,
        `SUMMARY:${event.title}`
      ];

      if (event.context) ics.push(`DESCRIPTION:${event.context}`);
      if (event.location) ics.push(`LOCATION:${event.location}`);
      if (isYearly) ics.push('RRULE:FREQ=YEARLY');

      ics.push('END:VEVENT', 'END:VCALENDAR');

      const blob = new Blob([ics.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },

    parseICS: (icsText, sourceName) => {
      const unfoldedText = icsText.replace(/\r?\n[ \t]/g, '');
      const lines = unfoldedText.split(/\r?\n/);
      const events = [];
      let currentEvent = null;

      lines.forEach(line => {
        if (line.startsWith('BEGIN:VEVENT')) {
          currentEvent = {
            id: 'ext_' + getUniqueId(), type: 'one-off',
            isReadOnly: true, source: sourceName, title: 'External Event',
            date: new Date().toISOString(), hasSpecificTime: false,
            isMilestone: false, externalUid: null
          };
        }
        else if (line.startsWith('END:VEVENT') && currentEvent) {
          if (currentEvent.externalUid) events.push(currentEvent);
          currentEvent = null;
        }
        else if (currentEvent) {
          if (line.startsWith('SUMMARY:')) currentEvent.title = line.substring(8);
          else if (line.startsWith('DESCRIPTION:')) currentEvent.context = line.substring(12);
          else if (line.startsWith('LOCATION:')) currentEvent.location = line.substring(9);
          else if (line.startsWith('UID:')) currentEvent.externalUid = line.substring(4).trim();
          else if (line.startsWith('RRULE:') && line.includes('FREQ=YEARLY')) currentEvent.isMilestone = true;
          else if (line.startsWith('DTSTART')) {
            const val = line.split(':').pop();
            if (val.length >= 8) {
              const y = val.substring(0,4), m = val.substring(4,6), d = val.substring(6,8);
              if (val.includes('T')) {
                const h = val.substring(9,11), min = val.substring(11,13), s = val.substring(13,15);
                currentEvent.date = new Date(Date.UTC(y, m-1, d, h, min, s)).toISOString();
                currentEvent.hasSpecificTime = true;
              } else {
                currentEvent.date = new Date(y, m-1, d).toISOString();
                currentEvent.hasSpecificTime = false;
              }
            }
          }
        }
      });
      return events;
    },

    getSourceColor: (sourceName, targetNode) => {
      const parsedAccent = FluxKit.theme.parseColor('var(--omni-accent)', targetNode);
      if (!parsedAccent) return 'var(--omni-accent)';
      
      const palette = FluxKit.theme.getPalette(parsedAccent);
      const colors = [
        palette.complementary,
        palette.triadic1,
        palette.triadic2,
        palette.analogous1,
        palette.analogous2,
        `rgb(${parsedAccent.r}, ${parsedAccent.g}, ${parsedAccent.b})`
      ];
      
      let hash = 0;
      for (let i = 0; i < sourceName.length; i++) {
        hash = sourceName.charCodeAt(i) + ((hash << 5) - hash);
      }
      return colors[Math.abs(hash) % colors.length];
    },

    createSourceBadge: (sourceName, targetNode) => {
      const { createHTMLElement } = FluxKit.utils;
      const color = DateUtils.getSourceColor(sourceName, targetNode);
      return createHTMLElement('div', {
        icon: 'worldClock', title: `Source: ${sourceName}`,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          fontSize: '9px', fontWeight: '800', letterSpacing: '0.5px', textTransform: 'uppercase',
          color: color, background: 'var(--omni-input-bg)', border: `1px solid ${color}`,
          borderRadius: '4px', padding: '1px 6px', height: '16px', whiteSpace: 'nowrap'
        },
        textContent: sourceName.length > 15 ? sourceName.substring(0, 15) + '...' : sourceName
      });
    }
  };

  const ChronicleManager = {
    getActiveProfile: () => hopState.get(STATE_KEYS.activeProfile, 'Personal'),
    setActiveProfile: (profileName) => hopState.set(STATE_KEYS.activeProfile, profileName.trim()),

    setReturnPath: (path) => { activeReturnPath = path.trim(); },
    getReturnPath: () => activeReturnPath || '> date',

    setEditReturnPath: (path) => { activeEditReturnPath = path.trim(); },
    getEditReturnPath: () => activeEditReturnPath || '> date view-mode',

    setContext: (id) => { contextStack = [id]; },
    pushContext: (id) => { contextStack.push(id); },
    popContext: () => {
      contextStack.pop();
      return contextStack.length > 0 ? contextStack[contextStack.length - 1] : null;
    },
    getContext: () => contextStack.length > 0 ? contextStack[contextStack.length - 1] : null,
    clearContext: () => { contextStack = []; },

    setPersonContext: (id) => { activePersonContextId = id; },
    getPersonContext: () => activePersonContextId,
    clearPersonContext: () => { activePersonContextId = null; },

    setParentContext: (id) => { activeParentContextId = id; },
    getParentContext: () => activeParentContextId,
    clearParentContext: () => { activeParentContextId = null; },

    getMilestones: (now) => {
      const { getDaysBetween } = DateUtils;
      const getOrdinal = n => { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
      return [
        { group: 'today', muteKey: 'today', calc: d => getDaysBetween(d, now) === 0, getLabel: () => ({ icon: 'pin', label: 'Happening Today' }) },
        { group: 'upcoming', muteKey: 'upcoming_standard', calc: d => { const diff = getDaysBetween(now, d); return diff > 0 && diff <= 14; }, getLabel: (d) => ({ label: `Upcoming (in ${getDaysBetween(now, d)}d)` })},
        { group: 'timehop', muteKey: '100_days', calc: d => getDaysBetween(d, now) === 100, getLabel: () => ({ label: '100 Days Ago' }) },
        { group: 'upcoming', muteKey: '100_days', calc: d => { const diff = getDaysBetween(d, now); return diff >= 93 && diff < 100; }, getLabel: (d) => ({ label: `100 Days Approaching (in ${100 - getDaysBetween(d, now)}d)` })},
        { group: 'upcoming', muteKey: 'yearly', calc: d => { if (d.getFullYear() >= now.getFullYear()) return false; let nextAnniv = new Date(now.getFullYear(), d.getMonth(), d.getDate()); if (nextAnniv.getTime() < now.getTime()) nextAnniv.setFullYear(now.getFullYear() + 1); const diff = getDaysBetween(now, nextAnniv); return diff > 0 && diff <= 14; }, getLabel: (d, evt) => { 
          let nextAnniv = new Date(now.getFullYear(), d.getMonth(), d.getDate()); let yrs = now.getFullYear() - d.getFullYear(); if (nextAnniv.getTime() < now.getTime()) { nextAnniv.setFullYear(now.getFullYear() + 1); yrs += 1; }
          const isPerson = evt && evt.type === 'person';
          return { label: `Upcoming ${isPerson ? getOrdinal(yrs) + ' Birthday' : yrs + ' Yr Anniversary'} (in ${getDaysBetween(now, nextAnniv)}d)` }; 
        } },
        { group: 'timehop', muteKey: 'monthly', calc: d => d.getMonth() === (now.getMonth() - 6 + 12) % 12 && d.getFullYear() === (now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear()) && d.getDate() === now.getDate(), getLabel: () => ({ label: '6 Months Ago Today' }) },
        { group: 'timehop', muteKey: 'yearly', calc: d => d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() < now.getFullYear(), getLabel: (d, evt) => { 
          const yrs = now.getFullYear() - d.getFullYear(); 
          if (evt && evt.type === 'person') return { label: getOrdinal(yrs) + ' Birthday Today' };
          return { label: yrs === 1 ? `1 Year Ago Today` : `${yrs} Years Ago Today` }; 
        } }
      ];
    },

    _getVault: () => hopState.get(STATE_KEYS.vault, { events: {}, subscriptions: {}, exclusions: {} }),

    getEvents: () => ChronicleManager._getVault().events[ChronicleManager.getActiveProfile()] || [],

    getSubscriptions: () => {
      const profile = ChronicleManager.getActiveProfile();
      const subs = ChronicleManager._getVault().subscriptions[profile] || [];
      return subs.filter(s => !s.deleted);
    },
    addSubscription: (name, url) => {
      const profile = ChronicleManager.getActiveProfile();
      const vault = ChronicleManager._getVault();
      if (!vault.subscriptions[profile]) vault.subscriptions[profile] = [];

      const subs = vault.subscriptions[profile];
      const existingIndex = subs.findIndex(s => s.url === url);
      const id = 'sub_' + FluxKit.utils.getUniqueId();

      if (existingIndex > -1) {
        subs[existingIndex].deleted = null;
        subs[existingIndex].name = name;
      } else {
        subs.push({ id, name, url, deleted: null });
      }

      hopState.set(STATE_KEYS.vault, vault);
      ChronicleManager._registerDelta('ADD_SUB', { profile, sub: { id, name, url } });
    },
    removeSubscription: (subId) => {
      const profile = ChronicleManager.getActiveProfile();
      const vault = ChronicleManager._getVault();
      if (vault.subscriptions[profile]) {
        const sub = vault.subscriptions[profile].find(s => s.id === subId);
        if (sub) {
          const deletedAt = Date.now();
          sub.deleted = deletedAt;
          hopState.set(STATE_KEYS.vault, vault);
          ChronicleManager._registerDelta('REMOVE_SUB', { profile, subId, deletedAt });
        }
      }
    },
    excludeExternalUid: (uid) => {
      const profile = ChronicleManager.getActiveProfile();
      const vault = ChronicleManager._getVault();
      if (!vault.exclusions[profile]) vault.exclusions[profile] = [];
      if (!vault.exclusions[profile].includes(uid)) {
        vault.exclusions[profile].push(uid);
        hopState.set(STATE_KEYS.vault, vault);
        ChronicleManager._registerDelta('EXCLUDE_UID', { profile, uid });
      }
    },

    getMergedEvents: () => {
      const profile = ChronicleManager.getActiveProfile();
      const vault = ChronicleManager._getVault();

      const nativeEvents = vault.events[profile] || [];
      const exclusions = vault.exclusions[profile] || [];

      const savedUids = nativeEvents.filter(e => e.externalUid).map(e => e.externalUid);

      const sortedTransient = [...transientEventsCache].sort((a, b) => new Date(a.date) - new Date(b.date));
      const seenExternalFutureTitles = new Set();
      
      const MAX_FUTURE_LIMIT_MS = 365 * 24 * 60 * 60 * 1000;
      const horizonTime = Date.now() + MAX_FUTURE_LIMIT_MS;

      const filteredTransient = sortedTransient.filter(extEvt => {
        if (exclusions.includes(extEvt.externalUid)) return false;
        if (savedUids.includes(extEvt.externalUid)) return false;

        const eventTime = new Date(extEvt.date).getTime();
        const isFuture = (eventTime + 24 * 60 * 60 * 1000) > Date.now();
        if (!isFuture && !extEvt.isMilestone) return false;

        if (eventTime > horizonTime) return false;

        if (isFuture && !extEvt.isMilestone) {
          const dedupeKey = `${extEvt.source}_${(extEvt.title || '').toLowerCase().trim()}`;
          if (seenExternalFutureTitles.has(dedupeKey)) return false;
          seenExternalFutureTitles.add(dedupeKey);
        }

        return true;
      });

      const allMerged = [...nativeEvents, ...filteredTransient];

      return allMerged.map(evt => {
        if (evt.isReadOnly) return evt;
        return {
          ...evt,
          isArchived: ChronicleManager._isEffectivelyArchived(evt, nativeEvents)
        };
      });
    },
    syncSubscriptions: async (force = false) => {
      const lastSync = hopState.get(STATE_KEYS.lastIcsSync, 0);
      if (!force && (Date.now() - lastSync < 30 * 60 * 1000) && transientEventsCache.length > 0) return;

      hopState.set(STATE_KEYS.lastIcsSync, Date.now());

      const subs = ChronicleManager.getSubscriptions();
      let newTransient = [];
      let fetchFailures = 0;

      for (const sub of subs) {
        try {
          const response = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
              method: 'GET', url: sub.url,
              onload: res => {
                if (res.status >= 200 && res.status < 400) resolve(res.responseText);
                else reject(new Error('HTTP ' + res.status));
              },
              onerror: err => reject(err)
            });
          });
          newTransient.push(...DateUtils.parseICS(response, sub.name));
        } catch(e) { fetchFailures++; logError('ICS Fetch Failed for:', sub.url, 'error:', e, { __v: 1 }); }
      }

      transientEventsCache = newTransient;

      if (fetchFailures === 0) {
        const profile = ChronicleManager.getActiveProfile();
        const vault = ChronicleManager._getVault();
        if (vault.exclusions[profile] && vault.exclusions[profile].length > 0) {
          const activeUids = new Set(newTransient.map(e => e.externalUid).filter(Boolean));
          const originalExclusions = vault.exclusions[profile];
          
          const prunedExclusions = originalExclusions.filter(uid => activeUids.has(uid));

          if (prunedExclusions.length !== originalExclusions.length) {
            vault.exclusions[profile] = prunedExclusions;
            hopState.set(STATE_KEYS.vault, vault);
            ChronicleManager._registerDelta('SET_EXCLUSIONS', { profile, exclusions: prunedExclusions });
          }
        }
      }

      const host = document.querySelector('#flx-hub-host')?.shadowRoot;
      if (host) {
        const isEditing = host.querySelector('input:focus, select:focus, textarea:focus');
        if (!isEditing) {
          const omniInput = host.querySelector('.flx-omni-input');
          if (omniInput) omniInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    },

    saveEvent: (event) => {
      const profile = ChronicleManager.getActiveProfile();
      const vault = ChronicleManager._getVault();
      if (!vault.events[profile]) vault.events[profile] = [];
      vault.events[profile].push(event);
      hopState.set(STATE_KEYS.vault, vault);
      ChronicleManager._registerDelta('SAVE_EVENT', { profile, event });
    },
    deleteEvent: (eventId) => {
      const profile = ChronicleManager.getActiveProfile();
      const vault = ChronicleManager._getVault();
      if (vault.events[profile]) {
        const targetEvent = vault.events[profile].find(e => e.id === eventId);
        if (targetEvent) {
          const grandParentIds = targetEvent.parentIds || (targetEvent.parentId ? [targetEvent.parentId] : []);

          vault.events[profile].forEach(e => {
            const currentPids = e.parentIds || (e.parentId ? [e.parentId] : []);
            if (currentPids.includes(eventId)) {
              e.parentIds = [...new Set([...currentPids.filter(id => id !== eventId), ...grandParentIds])];
              delete e.parentId;
            }
          });

          vault.events[profile] = vault.events[profile].filter(e => e.id !== eventId);
          hopState.set(STATE_KEYS.vault, vault);
          ChronicleManager._registerDelta('DELETE_EVENT', { profile, eventId, grandParentIds });
        }
      }
    },
    updateEvent: (updatedEvent) => {
      const profile = ChronicleManager.getActiveProfile();
      const vault = ChronicleManager._getVault();
      if (vault.events[profile]) {
        const index = vault.events[profile].findIndex(e => e.id === updatedEvent.id);
        if (index > -1) vault.events[profile][index] = updatedEvent;
        hopState.set(STATE_KEYS.vault, vault);
        ChronicleManager._registerDelta('UPDATE_EVENT', { profile, event: updatedEvent });
      }
    },
    resolvePerson: (rawName) => {
      const profile = ChronicleManager.getActiveProfile();
      const vault = ChronicleManager._getVault();
      if (!vault.events[profile]) vault.events[profile] = [];

      const name = rawName.trim();
      const lowerName = name.toLowerCase();
      const events = vault.events[profile];

      let match = events.find(e => e.type === 'person' && 
        (e.title.toLowerCase() === lowerName || (e.aliases || []).some(a => a.toLowerCase() === lowerName)));
      
      if (match) return match.id;

      const newPerson = { 
        id: 'evt_ppl_' + FluxKit.utils.getUniqueId(), title: name, 
        aliases: [], date: new Date().toISOString(),
        hasSpecificTime: false, type: 'person',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        isPinned: false, endedOn: null, isArchived: false,
        mutedGroups: [], alerts: [], location: '',
        context: 'Auto-generated from command line.',
        parentIds: []
      };
      
      events.push(newPerson);
      hopState.set(STATE_KEYS.vault, vault);
      ChronicleManager._registerDelta('SAVE_EVENT', { profile, event: newPerson });
      
      return newPerson.id;
    },
    mergeNodes: (sourceId, targetId) => {
      const profile = ChronicleManager.getActiveProfile();
      let vault = ChronicleManager._getVault();
      vault = ChronicleManager._applyJournalToVault(vault, [{ action: 'MERGE_NODES', payload: { profile, sourceId, targetId } }]);
      hopState.set(STATE_KEYS.vault, vault);
      ChronicleManager._registerDelta('MERGE_NODES', { profile, sourceId, targetId });
    },

    _isEffectivelyArchived: (event, allEvents) => {
      if (event.isArchived) return true;
      const pIds = event.parentIds || (event.parentId ? [event.parentId] : []);
      if (pIds.length === 0) return false;

      const checkArchived = (id, visited = new Set()) => {
        if (visited.has(id)) return false;
        visited.add(id);
        const node = allEvents.find(e => e.id === id);
        if (!node) return true;
        if (node.isArchived) return true;

        const nodePids = node.parentIds || (node.parentId ? [node.parentId] : []);
        if (nodePids.length === 0) return false; // Reached an active root
        return nodePids.every(pid => checkArchived(pid, visited));
      };

      return pIds.every(pid => checkArchived(pid, new Set()));
    },

    _registerDelta: (actionType, payload) => {
      const queue = hopState.get(STATE_KEYS.pendingDeltas, []);
      queue.push({ ts: Date.now(), id: FluxKit.utils.getUniqueId(), action: actionType, payload });
      hopState.set(STATE_KEYS.pendingDeltas, queue);
      ChronicleManager.triggerDebouncedSync();
    },

    triggerDebouncedSync: () => {
      if (ChronicleManager._syncTimer) clearTimeout(ChronicleManager._syncTimer);
      ChronicleManager._syncTimer = setTimeout(() => ChronicleManager.flushJournal(), 5000);
    },

    _mergeVaults: (v1, v2) => {
      const result = { events: {}, subscriptions: {}, exclusions: {} };
      const allProfiles = new Set([
        ...Object.keys(v1.events || {}),
        ...Object.keys(v2.events || {}),
        ...Object.keys(v1.subscriptions || {}),
        ...Object.keys(v2.subscriptions || {}),
        ...Object.keys(v1.exclusions || {}),
        ...Object.keys(v2.exclusions || {})
      ]);

      allProfiles.forEach(profile => {
        const events1 = v1.events?.[profile] || [];
        const events2 = v2.events?.[profile] || [];
        const eventMap = new Map();

        [...events1, ...events2].forEach(e => {
          if (!e || !e.id) return;
          const existing = eventMap.get(e.id);
          if (!existing) {
            eventMap.set(e.id, { ...e });
          } else {
            const chosen = (new Date(e.date).getTime() >= new Date(existing.date).getTime())
              ? { ...existing, ...e }
              : { ...e, ...existing };
            chosen.parentIds = [...new Set([...(existing.parentIds || []), ...(e.parentIds || [])])];
            if (e.aliases || existing.aliases) {
              chosen.aliases = [...new Set([...(existing.aliases || []), ...(e.aliases || [])])];
            }
            eventMap.set(e.id, chosen);
          }
        });
        result.events[profile] = Array.from(eventMap.values());

        const subs1 = v1.subscriptions?.[profile] || [];
        const subs2 = v2.subscriptions?.[profile] || [];
        const subMap = new Map();
        [...subs1, ...subs2].forEach(s => {
          if (!s || !s.url) return;
          const key = s.id || s.url;
          const existing = subMap.get(key);
          if (!existing) {
            subMap.set(key, { ...s });
          } else {
            subMap.set(key, { ...existing, ...s, deleted: s.deleted || existing.deleted || null });
          }
        });
        result.subscriptions[profile] = Array.from(subMap.values());

        const exc1 = v1.exclusions?.[profile] || [];
        const exc2 = v2.exclusions?.[profile] || [];
        result.exclusions[profile] = [...new Set([...exc1, ...exc2])];
      });

      return result;
    },
    pullRemote: async () => {
      const syncProfile = hopState.get(STATE_KEYS.syncProfile, null);
      if (!FluxKit.sync || !FluxKit.sync.isConfigured(syncProfile)) return;
      try {
        const data = await FluxKit.sync.fetch(syncProfile, { filename: SYNC_FILENAME });
        const localVault = ChronicleManager._getVault();
        const hasLocalData = Object.values(localVault.events || {}).some(arr => arr.length > 0);

        if (data && data.files && data.files[SYNC_FILENAME] && data.files[SYNC_FILENAME].content) {
          const remoteVault = JSON.parse(data.files[SYNC_FILENAME].content);
          const mergedVault = ChronicleManager._mergeVaults(localVault, remoteVault);
          hopState.set(STATE_KEYS.vault, mergedVault);
          hopState.set(STATE_KEYS.lastSync, Date.now());
        } else if (hasLocalData) {
          logMessage('Remote backup missing on server. Re-seeding remote vault from local...', { __v: 1 });
          await ChronicleManager.pushRemote();
        }
      } catch (e) { logError('Background pull failed:', e, { __v: 1 }); }
    },
    pushRemote: async () => {
      const syncProfile = hopState.get(STATE_KEYS.syncProfile, null);
      if (!FluxKit.sync || !FluxKit.sync.isConfigured(syncProfile)) return;
      try {
        await FluxKit.sync.upload(syncProfile, ChronicleManager._getVault(), SYNC_FILENAME);
        hopState.set(STATE_KEYS.lastSync, Date.now());
      } catch (e) { logError('Background push failed:', e, { __v: 1 }); }
    },

    _applyJournalToVault: (vault, journal) => {
      journal.forEach(entry => {
        const { action, payload } = entry;
        const profile = payload.profile;

        if (!vault.events[profile]) vault.events[profile] = [];
        if (!vault.subscriptions[profile]) vault.subscriptions[profile] = [];
        if (!vault.exclusions[profile]) vault.exclusions[profile] = [];

        const events = vault.events[profile];
        const subs = vault.subscriptions[profile];
        const exclusions = vault.exclusions[profile];

        switch (action) {
          case 'SAVE_EVENT':
            if (!events.some(e => e.id === payload.event.id)) {
              events.push(payload.event);
            }
            break;
          case 'UPDATE_EVENT': {
            const idx = events.findIndex(e => e.id === payload.event.id);
            if (idx > -1) events[idx] = payload.event;
            break;
          }
          case 'DELETE_EVENT':
            events.forEach(e => {
              const currentPids = e.parentIds || (e.parentId ? [e.parentId] : []);
              if (currentPids.includes(payload.eventId)) {
                e.parentIds = [...new Set([...currentPids.filter(id => id !== payload.eventId), ...(payload.grandParentIds || [])])];
                delete e.parentId;
              }
            });
            vault.events[profile] = events.filter(e => e.id !== payload.eventId);
            break;
          case 'MERGE_NODES': {
            const { sourceId, targetId } = payload;
            const sourceNode = events.find(e => e.id === sourceId);
            const targetNode = events.find(e => e.id === targetId);
            if (sourceNode && targetNode) {
              targetNode.aliases = [...new Set([...(targetNode.aliases || []), sourceNode.title, ...(sourceNode.aliases || [])])];
              events.forEach(evt => {
                if (evt.parentIds && evt.parentIds.includes(sourceId)) {
                  evt.parentIds = [...new Set(evt.parentIds.map(id => id === sourceId ? targetId : id))];
                }
              });
              vault.events[profile] = events.filter(e => e.id !== sourceId);
            }
            break;
          }
          case 'ADD_SUB': {
            const { name, url, id } = payload.sub;
            const existingSub = subs.find(s => s.url === url);
            if (existingSub) {
              existingSub.deleted = null;
              existingSub.name = name;
            } else {
              subs.push({ id, name, url, deleted: null });
            }
            break;
          }
          case 'REMOVE_SUB': {
            const sub = subs.find(s => s.id === payload.subId);
            if (sub) sub.deleted = payload.deletedAt;
            break;
          }
          case 'EXCLUDE_UID':
            if (!exclusions.includes(payload.uid)) exclusions.push(payload.uid);
            break;
          case 'SET_EXCLUSIONS':
            vault.exclusions[profile] = payload.exclusions || [];
            break;
        }
      });
      return vault;
    },
    pullJournal: async () => {
      const syncProfile = hopState.get(STATE_KEYS.syncProfile, null);
      if (!FluxKit.sync || !FluxKit.sync.isConfigured(syncProfile) || isSyncing) return;

      try {
        isSyncing = true;
        const jData = await FluxKit.sync.fetch(syncProfile, { filename: 'chronicle_journal.json' });
        let remoteJournal = jData && jData.files['chronicle_journal.json'] ? JSON.parse(jData.files['chronicle_journal.json'].content) : [];

        if (remoteJournal.length > 0) {
          let currentVault = ChronicleManager._getVault();
          currentVault = ChronicleManager._applyJournalToVault(currentVault, remoteJournal);
          hopState.set(STATE_KEYS.vault, currentVault);

          const host = document.querySelector('#flx-hub-host')?.shadowRoot;
          if (host) {
            const isEditing = host.querySelector('input:focus, select:focus, textarea:focus');
            if (!isEditing) {
              const omniInput = host.querySelector('.flx-omni-input');
              if (omniInput) omniInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        }

        hopState.set(STATE_KEYS.lastSync, Date.now());
      } catch (e) { logError('Journal pull failed:', e); } finally { isSyncing = false; }
    },
    flushJournal: async () => {
      const syncProfile = hopState.get(STATE_KEYS.syncProfile, null);
      if (!FluxKit.sync || !FluxKit.sync.isConfigured(syncProfile) || isSyncing) return;

      const deltasToPush = hopState.get(STATE_KEYS.pendingDeltas, []);
      if (deltasToPush.length === 0) return;

      try {
        isSyncing = true;

        const jData = await FluxKit.sync.fetch(syncProfile, { filename: 'chronicle_journal.json' });
        let remoteJournal = (jData && jData.files && jData.files['chronicle_journal.json'] && jData.files['chronicle_journal.json'].content)
          ? JSON.parse(jData.files['chronicle_journal.json'].content)
          : [];

        let mergedJournal = [...remoteJournal, ...deltasToPush];

        if (mergedJournal.length >= 50) {
          const vData = await FluxKit.sync.fetch(syncProfile, { filename: SYNC_FILENAME });
          let remoteVault = (vData && vData.files && vData.files[SYNC_FILENAME] && vData.files[SYNC_FILENAME].content)
            ? JSON.parse(vData.files[SYNC_FILENAME].content)
            : null;

          let currentLocalVault = ChronicleManager._getVault();
          let masterVault = remoteVault ? ChronicleManager._mergeVaults(currentLocalVault, remoteVault) : currentLocalVault;

          masterVault = ChronicleManager._applyJournalToVault(masterVault, mergedJournal);

          await FluxKit.sync.upload(syncProfile, masterVault, SYNC_FILENAME);
          await FluxKit.sync.upload(syncProfile, [], 'chronicle_journal.json');

          hopState.set(STATE_KEYS.vault, masterVault);
        } else {
          await FluxKit.sync.upload(syncProfile, mergedJournal, 'chronicle_journal.json');
        }

        const pushedIds = new Set(deltasToPush.map(d => d.id));
        const currentQueue = hopState.get(STATE_KEYS.pendingDeltas, []);
        const remainingQueue = currentQueue.filter(d => !pushedIds.has(d.id));
        hopState.set(STATE_KEYS.pendingDeltas, remainingQueue);

        hopState.set(STATE_KEYS.lastSync, Date.now());
      } catch (e) {
        logError('Journal flush failed:', e);
      } finally { isSyncing = false; }
    },

    _migrateVaultSchema: (vault) => {
      let migrated = false;

      if (vault.people && Object.keys(vault.people).length > 0) {
        for (const profile of Object.keys(vault.people)) {
          const legacyPeople = vault.people[profile];
          if (!legacyPeople || legacyPeople.length === 0) continue;

          if (!vault.events[profile]) vault.events[profile] = [];
          const events = vault.events[profile];

          legacyPeople.forEach(person => {
            const taggedEvents = events.filter(e => e.people && e.people.includes(person.id));

            let birthDate = new Date().toISOString();
            if (taggedEvents.length > 0) {
              const timestamps = taggedEvents.map(e => new Date(e.date).getTime()).filter(t => !isNaN(t));
              if (timestamps.length > 0) {
                birthDate = new Date(Math.min(...timestamps)).toISOString();
              }
            }

            const personEpicId = 'evt_ppl_' + FluxKit.utils.getUniqueId();
            const personEpic = {
              id: personEpicId, title: person.name,
              aliases: person.aliases || [], date: birthDate, hasSpecificTime: false,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              type: 'person', isPinned: false, endedOn: null, isArchived: false,
              mutedGroups: [], alerts: [], location: '',
              context: 'Migrated from legacy tags.',
              parentIds: []
            };

            events.push(personEpic);

            taggedEvents.forEach(e => {
              if (!e.parentIds) e.parentIds = [];
              if (!e.parentIds.includes(personEpicId)) e.parentIds.push(personEpicId);
            });
          });
        }
        migrated = true;
      }

      if (vault.people) {
        delete vault.people;
        migrated = true;
      }

      if (vault.events) {
        for (const profile of Object.keys(vault.events)) {
          vault.events[profile].forEach(e => {
            if (e.people !== undefined) {
              delete e.people;
              migrated = true;
            }
          });
        }
      }

      return { vault, migrated };
    },
  };

  const EventParser = {
    parse: function(rawInput) {
      let text = rawInput.trim();
      const event = {
        id: 'evt_' + getUniqueId(),
        title: '', date: null, hasSpecificTime: false,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        type: 'era', isPinned: false, endedOn: null, isArchived: false,
        mutedGroups: [], alerts: [], people: [], location: '', context: '',
        parentIds: []
      };

      // Extract Context
      const contextSplit = text.split('|');
      if (contextSplit.length > 1) { event.context = contextSplit.pop().trim(); text = contextSplit.join('|').trim(); }

      if (text.toLowerCase().startsWith('one-off ') || text.toLowerCase().startsWith('oneoff ')) {
        event.type = 'one-off';
        text = text.replace(/^(one-off|oneoff)\s+/i, '').trim();
      }

      // Extract Time (e.g., "at 5pm", "@ 14:30")
      const timeRegex = /\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
      const timeMatch = text.match(timeRegex);
      let hours = 0, minutes = 0;
      if (timeMatch) {
        event.hasSpecificTime = true;
        hours = parseInt(timeMatch[1], 10);
        minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;

        text = text.replace(timeMatch[0], '').trim();
      }

      // Extract Date
      const dateRegex = /\s+(today|tomorrow|yesterday|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+\d+\s+(?:days?|weeks?|months?)|on\s+.*|\d{4}-\d{2}-\d{2})$/i;
      const dateMatch = text.match(dateRegex);
      if (dateMatch) { event.date = this._resolveDate(dateMatch[1].trim()); text = text.replace(dateMatch[0], '').trim(); }
      else { event.date = new Date().toISOString(); }

      // Extract Location & People (e.g., in/near)
      const atMatch = text.match(/\b(?:in|near)\s+(.+)$/i);
      if (atMatch) { event.location = atMatch[1].trim(); text = text.replace(atMatch[0], '').trim(); }

      const withMatch = text.match(/\bwith\s+(.+)$/i);
      if (withMatch) {
        event.people = withMatch[1].split(/,|\band\b|&/i).map(s => s.trim()).filter(Boolean);
        text = text.replace(withMatch[0], '').trim();
      }

      event.title = text;

      if (event.hasSpecificTime) {
        const d = new Date(event.date);
        d.setHours(hours, minutes, 0, 0);
        event.date = d.toISOString();
      }

      return event;
    },

    _resolveDate: function(dateStr) {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      const str = dateStr.toLowerCase().replace(/^on\s+/, '');

      if (str === 'today') return d.toISOString();
      if (str === 'tomorrow') { d.setDate(d.getDate() + 1); return d.toISOString(); }
      if (str === 'yesterday') { d.setDate(d.getDate() - 1); return d.toISOString(); }

      const inMatch = str.match(/in\s+(\d+)\s+(day|week|month)s?/);
      if (inMatch) {
        const num = parseInt(inMatch[1], 10);
        if (inMatch[2] === 'day') d.setDate(d.getDate() + num);
        if (inMatch[2] === 'week') d.setDate(d.getDate() + (num * 7));
        if (inMatch[2] === 'month') d.setMonth(d.getMonth() + num);
        return d.toISOString();
      }

      const nextMatch = str.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
      if (nextMatch) {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = days.indexOf(nextMatch[1]);
        let diff = targetDay - d.getDay();
        if (diff <= 0) diff += 7; d.setDate(d.getDate() + diff);
        return d.toISOString();
      }

      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
      return d.toISOString();
    }
  };

  function registerToHub() {
    const currentVault = hopState.get(STATE_KEYS.vault, { events: {}, subscriptions: {}, exclusions: {} });
    const { vault: migratedVault, migrated } = ChronicleManager._migrateVaultSchema(currentVault);
    
    if (migrated) {
      logMessage('Executing one-time Entity Graph migration...', { __v: 1 });
      hopState.set(STATE_KEYS.vault, migratedVault);
      ChronicleManager.pushRemote();
    }

    FluxKit.ipc.broadcast('register-command', {
      id: 'plugin-chronicle-view', prefix: '> date', title: 'Timeline & Memory Tracker',
      icon: 'calendar', type: 'view', acceptsArgs: true
    });
    FluxKit.ipc.broadcast('register-command', {
      id: 'plugin-today-view', prefix: '> today', title: 'Today & Timehop Dashboard',
      icon: 'calendarDay', type: 'view', acceptsArgs: false
    });
    FluxKit.ipc.broadcast('register-command', {
      id: 'plugin-eras-view', prefix: '> eras', title: 'Life Eras & Durations',
      icon: 'clock', type: 'view', acceptsArgs: true
    });
    FluxKit.ipc.broadcast('register-command', {
      id: 'plugin-people-view', prefix: '> people', title: 'People & Tag Management',
      icon: 'user', type: 'view', acceptsArgs: true
    });

    const events = ChronicleManager.getEvents();
    const hasPinned = events.some(e => e.type === 'era' && e.isPinned && !e.isArchived);

    if (hasPinned) {
      FluxKit.ipc.broadcast('register-widget', { id: 'widget-eras-view', pluginId: 'plugin-eras-view', title: 'Pinned Eras' });
    }
    FluxKit.ipc.broadcast('register-widget', { id: 'widget-chronicle-today', pluginId: 'plugin-chronicle-view', title: 'Today in History' });

    const lastSync = hopState.get(STATE_KEYS.lastSync, 0);
    if (Date.now() - lastSync > 300000) {
      ChronicleManager.pullRemote();
      ChronicleManager.pullJournal();
    }
    ChronicleManager.syncSubscriptions();

    if (hopState.get(STATE_KEYS.pendingDeltas, []).length > 0) {
      ChronicleManager.flushJournal();
    }
  }

  registerToHub();
  FluxKit.ipc.listen('search-bar-ready', () => registerToHub());

  setInterval(() => {
    const lastIcsSync = hopState.get(STATE_KEYS.lastIcsSync, 0);
    if (Date.now() - lastIcsSync > 30 * 60 * 1000) {
      ChronicleManager.syncSubscriptions();
    }

    ChronicleManager.pullJournal();
  }, 10 * 60 * 1000);

  let viewAbortController = null;

  function createVirtualList(items, rowHeight, containerHeight, renderRowFn, onSelectIdx) {
    const { createHTMLElement } = FluxKit.utils;
    const container = createHTMLElement('div', {
      style: { height: `${containerHeight}px`, overflowY: 'auto', position: 'relative' }
    });

    const totalHeight = items.length * rowHeight;
    const ghost = createHTMLElement('div', { style: { height: `${totalHeight}px`, width: '1px' } });
    container.appendChild(ghost);

    const visibleCount = Math.ceil(containerHeight / rowHeight) + 2;
    const physicalNodes = [];

    for (let i = 0; i < visibleCount; i++) {
      const node = createHTMLElement('div', { style: { position: 'absolute', left: 0, right: 0, top: 0, display: 'none' } });
      physicalNodes.push(node);
      container.appendChild(node);
    }

    let currentStartIndex = -1;

    const render = () => {
      const scrollTop = container.scrollTop;
      let startIndex = Math.floor(scrollTop / rowHeight);
      startIndex = Math.max(0, Math.min(startIndex, items.length - visibleCount));

      if (startIndex !== currentStartIndex) {
        currentStartIndex = startIndex;

        physicalNodes.forEach((node, i) => {
          const itemIndex = startIndex + i;
          if (itemIndex < items.length) {
            node.style.display = 'block';
            node.style.transform = `translateY(${itemIndex * rowHeight}px)`;
            renderRowFn(node, items[itemIndex], itemIndex);
          } else {
            node.style.display = 'none';
          }
        });
      }
    };

    container.addEventListener('scroll', () => requestAnimationFrame(render), { passive: true });

    render();

    return { container, physicalNodes, getStartIndex: () => currentStartIndex };
  }

  const makeInput = (label, val, type = 'text', gridColumn = 'span 1') => {
    const wrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', gridColumn } });
    wrap.appendChild(createHTMLElement('label', { textContent: label, style: { fontSize: '11px', color: 'var(--omni-muted)', textTransform: 'uppercase' } }));
    const input = createHTMLElement('input', {
      type, value: val || '',
      style: { background: 'var(--omni-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', padding: '6px 8px', borderRadius: '6px', fontSize: '13px', outline: 'none' },
      eventListener: {
        keydown: (e) => e.stopPropagation(),
        focus: (e) => { e.target.style.borderColor = 'var(--omni-accent)' },
        blur: (e) => { e.target.style.borderColor = 'var(--omni-border)' }
      }
    });
    wrap.appendChild(input);
    return { wrap, input };
  };

  const makeSelect = (label, options, selectedValue, gridColumn = 'span 1') => {
    const wrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', gridColumn } });
    wrap.appendChild(createHTMLElement('label', { textContent: label, style: { fontSize: '11px', color: 'var(--omni-muted)', textTransform: 'uppercase' } }));
    const select = createHTMLElement('select', {
      style: { background: 'var(--omni-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', padding: '6px 8px', borderRadius: '6px', fontSize: '13px', outline: 'none' },
      eventListener: {
        keydown: (e) => e.stopPropagation(),
        focus: (e) => { e.target.style.borderColor = 'var(--omni-accent)' },
        blur: (e) => { e.target.style.borderColor = 'var(--omni-border)' }
      }
    });
    options.forEach(opt => {
      const el = createHTMLElement('option', { value: opt.value, textContent: opt.label });
      if (opt.value === selectedValue) el.selected = true;
      select.appendChild(el);
    });
    wrap.appendChild(select);
    return { wrap, select };
  };

  const makeMultiSelect = (label, options, selectedValues, gridColumn = 'span 1') => {
    const wrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', gridColumn } });
    wrap.appendChild(createHTMLElement('label', { textContent: label, style: { fontSize: '11px', color: 'var(--omni-muted)', textTransform: 'uppercase' } }));

    const interactiveWrap = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });

    const searchInput = createHTMLElement('input', {
      type: 'text', placeholder: 'Filter epics...',
      style: { background: 'var(--omni-bg)', color: 'var(--omni-text)', border: '1px solid var(--omni-border)', padding: '6px 8px', borderRadius: '6px', fontSize: '12px', outline: 'none' },
      eventListener: {
        keydown: (e) => e.stopPropagation(),
        focus: (e) => { e.target.style.borderColor = 'var(--omni-accent)' },
        blur: (e) => { e.target.style.borderColor = 'var(--omni-border)' },
        input: (e) => {
          const term = e.target.value.toLowerCase();
          let visibleCount = 0;
          rows.forEach(r => {
            if (r.textLabel.includes(term)) {
              r.el.style.display = 'flex';
              visibleCount++;
            } else {
              r.el.style.display = 'none';
            }
          });
          emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
        }
      }
    });

    const listContainer = createHTMLElement('div', {
      style: { background: 'var(--omni-bg)', border: '1px solid var(--omni-border)', borderRadius: '6px', maxHeight: '110px', overflowY: 'auto', padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }
    });

    const checkboxes = [];
    const rows = [];
    const emptyState = createHTMLElement('div', { textContent: 'No matching Epics found.', style: { fontSize: '12px', color: 'var(--omni-muted)', padding: '8px', textAlign: 'center', display: 'none' } });

    if (options.length === 0) {
      emptyState.textContent = 'No Epics available.';
      emptyState.style.display = 'block';
      listContainer.appendChild(emptyState);
    } else {
      interactiveWrap.appendChild(searchInput);
      listContainer.appendChild(emptyState);

      options.forEach(opt => {
        const row = createHTMLElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' } });
        row.addEventListener('mouseenter', () => row.style.background = 'var(--omni-hover)');
        row.addEventListener('mouseleave', () => row.style.background = 'transparent');

        const cb = createHTMLElement('input', { type: 'checkbox', value: opt.value, checked: selectedValues.includes(opt.value), style: { accentColor: 'var(--omni-accent)', cursor: 'pointer' } });
        checkboxes.push(cb);

        row.appendChild(cb);
        row.appendChild(createHTMLElement('span', { icon: opt.icon, textContent: opt.label, style: { display: 'flex', gap: '4px', fontSize: '13px', color: 'var(--omni-text)' } }));
        listContainer.appendChild(row);

        rows.push({ el: row, textLabel: opt.label.toLowerCase() });
      });
    }

    interactiveWrap.appendChild(listContainer);
    wrap.appendChild(interactiveWrap);

    return { wrap, getSelected: () => checkboxes.filter(c => c.checked).map(c => c.value) };
  };

  async function DateView(payload) {
    const host = document.getElementById('flx-hub-host');
    if (!host || !host.shadowRoot) return;
    const slot = host.shadowRoot.getElementById(payload.targetId);
    if (!slot) return;

    if (viewAbortController) viewAbortController.abort();
    viewAbortController = new AbortController();
    const { signal } = viewAbortController;

    const query = (payload.query || '').trim();
    const currentProfile = ChronicleManager.getActiveProfile();

    if (query.toLowerCase().startsWith('sync')) {
      const container = createHTMLElement('div', { style: { padding: '8px' }});
      slot.innerHTML = safeHTML('');
      slot.appendChild(container);

      try {
        const syncProfile = hopState.get(STATE_KEYS.syncProfile, null);
        const onSyncComplete = async (updatedProfile) => {
          hopState.set(STATE_KEYS.syncProfile, updatedProfile);
          await ChronicleManager.pushRemote();
          FluxKit.ipc.broadcast('flxhub-hide');
        };

        if (syncProfile && FluxKit.sync.isConfigured(syncProfile)) {
          new FluxKit.sync.Editor(container, syncProfile, { namespace: 'Flux/Chronicle', theme: FluxKit.theme.get(hopState.get(STATE_KEYS.activeTheme, 'auto')) }, onSyncComplete).render(container);
        } else {
          new FluxKit.sync.Wizard(container, { namespace: 'Flux/Chronicle', theme: FluxKit.theme.get(hopState.get(STATE_KEYS.activeTheme, 'auto')) }, onSyncComplete).render(container);
        }
      } catch (err) {
        container.innerHTML = safeHTML(`<div style="color: #ff4757; padding: 16px; font-size: 14px;"><strong>Wizard Crash:</strong> ${err.message}</div>`);
      }
      return;
    }

    if (query.toLowerCase().startsWith('profile ')) {
      const newProfile = query.substring(8).trim();
      const container = createHTMLElement('div', { style: { padding: '16px', textAlign: 'center' } });

      if (!newProfile) {
        container.innerHTML = safeHTML(`<span style="color: var(--omni-muted)">Current Profile:</span> <strong style="color: var(--omni-accent)">${currentProfile}</strong><br><br><span style="font-size: 12px; color: var(--omni-muted)">Type "> date profile Work" to switch.</span>`);
        slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([container]));
        return;
      }

      container.appendChild(document.createTextNode('Switching to profile: '));
      container.appendChild(createHTMLElement('strong', {
        style: { color: 'var(--omni-text)' },
        textContent: newProfile
      }));
      const actions = [ FluxKit.ui.omni.Button('success', 'Confirm Switch', async (e) => { e.stopPropagation(); ChronicleManager.setActiveProfile(newProfile); FluxKit.ipc.broadcast('flxhub-hide'); }) ];

      slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([container], actions));
      slot.addEventListener('flx-remote-keydown', (e) => {
        if (e.detail.key === 'Enter') { e.preventDefault(); ChronicleManager.setActiveProfile(newProfile); FluxKit.ipc.broadcast('flxhub-hide'); }
      }, { signal });
      return;
    }

    if (query.toLowerCase().startsWith('add')) {
      const inputStr = query.substring(3).trim();
      const parsed = EventParser.parse(inputStr);

      const prefilledPeopleStr = (parsed.people || []).join(', ');
      delete parsed.people; 

      const activeCtxId = ChronicleManager.getContext();
      const activeParentCtxId = ChronicleManager.getParentContext();
      
      const initialParentIds = [...new Set([
        ...(activeParentCtxId ? [activeParentCtxId] : []),
        ...(activeCtxId ? [activeCtxId] : [])
      ])].filter(Boolean);

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px' } });
      container.appendChild(createHTMLElement('div', { textContent: 'Add New Event', style: { fontWeight: 'bold', fontSize: '14px', color: 'var(--omni-accent)' }}));

      const dateObj = new Date(parsed.date);
      const tzOffset = dateObj.getTimezoneOffset() * 60000;
      const localISOTime = new Date(dateObj.getTime() - tzOffset).toISOString().slice(0, 16);

      const inputGrid = createHTMLElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } });

      const titleField = makeInput('Title', parsed.title, 'text', 'span 2');
      const dateField = makeInput('Start Date', localISOTime, 'datetime-local');
      const typeField = makeSelect('Entity Type', [
        { value: 'one-off', label: 'One-off Event' },
        { value: 'era', label: 'Continuous Epic' },
        { value: 'person', label: 'Person Entity' }
      ], parsed.type === 'era' ? 'era' : 'one-off');
      const locField = makeInput('Location', parsed.location);
      const newPeopleField = makeInput('Quick Add People (CSV)', prefilledPeopleStr);

      const allContexts = ChronicleManager.getEvents().filter(e => e.type === 'era' || e.type === 'person');
      const contextOptions = allContexts.map(e => ({ value: e.id, icon: e.type === 'person' ? 'user' : 'folder', label: e.title }));

      const parentField = makeMultiSelect('Linked Contexts', contextOptions, initialParentIds, 'span 2');
      const ctxField = makeInput('Context / Notes', parsed.context, 'text', 'span 2');

      inputGrid.append(titleField.wrap, dateField.wrap, typeField.wrap, locField.wrap, newPeopleField.wrap, parentField.wrap, ctxField.wrap);
      container.appendChild(inputGrid);

      const finalizeAndSave = () => {
        parsed.title = titleField.input.value.trim();
        if (!parsed.title) {
          FluxKit.ui.notify('Event title cannot be empty', 'error');
          return;
        }

        const finalDate = new Date(dateField.input.value);
        parsed.date = finalDate.toISOString();
        parsed.hasSpecificTime = (finalDate.getHours() !== 0 || finalDate.getMinutes() !== 0);

        parsed.location = locField.input.value.trim();
        parsed.context = ctxField.input.value.trim();
        parsed.type = typeField.select.value; 

        const rawNewPeople = newPeopleField.input.value.split(',').map(s => s.trim()).filter(Boolean);
        const resolvedPersonIds = rawNewPeople.map(rawName => ChronicleManager.resolvePerson(rawName));
        parsed.parentIds = [...new Set([...parentField.getSelected(), ...resolvedPersonIds])];

        ChronicleManager.saveEvent(parsed);
        ChronicleManager.clearParentContext();
        FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date' });
      };

      const actions = [ FluxKit.ui.omni.Button('success', 'Save Event', (e) => {
        e.stopPropagation(); finalizeAndSave();
      }) ];

      slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([container], actions));

      slot.addEventListener('flx-remote-keydown', (e) => {
        if (e.detail.key === 'Enter') {
          e.preventDefault();
          finalizeAndSave();
        }
      }, { signal: viewAbortController.signal });
      return;
    }
    
    if (query.toLowerCase().startsWith('edit-mode')) {
      const eventId = ChronicleManager.getContext();
      if (!eventId) {
        FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date edit' });
        return;
      }

      const events = ChronicleManager.getMergedEvents();
      const evt = events.find(e => e.id === eventId);
      if (!evt) return;

      if (evt.isReadOnly) {
        FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date view-mode' });
        return;
      }

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px' } });
      container.appendChild(createHTMLElement('div', { textContent: 'Edit Event', style: { fontWeight: 'bold', fontSize: '14px', color: 'var(--omni-accent)' }}));

      const dateObj = new Date(evt.date);
      const tzOffset = dateObj.getTimezoneOffset() * 60000;
      const localISOTime = new Date(dateObj.getTime() - tzOffset).toISOString().slice(0, 16);

      const inputGrid = createHTMLElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } });
      const titleField = makeInput('Title', evt.title, 'text', 'span 2');
      const dateField = makeInput('Start Date', localISOTime, 'datetime-local');
      const typeField = makeSelect('Entity Type', [
        { value: 'one-off', label: 'One-off Event' },
        { value: 'era', label: 'Continuous Epic' },
        { value: 'person', label: 'Person Entity' }
      ], evt.type);
      const endedField = makeInput('Ended On (Blank = Active)', evt.endedOn ? evt.endedOn.split('T')[0] : '', 'date');
      const locField = makeInput('Location', evt.location);
      const newPeopleField = makeInput('Quick Add People (CSV)', '');
      const aliasField = makeInput('Aliases (CSV)', (evt.aliases || []).join(', '));
      
      const allContexts = ChronicleManager.getEvents().filter(e => (e.type === 'era' || e.type === 'person') && e.id !== evt.id);
      const contextOptions = allContexts.map(e => ({ value: e.id, icon: e.type === 'person' ? 'user' : 'folder', label: e.title }));

      const currentParentIds = evt.parentIds || (evt.parentId ? [evt.parentId] : []);
      const parentField = makeMultiSelect('Linked Contexts', contextOptions, currentParentIds, 'span 2');
      const ctxField = makeInput('Context / Notes', evt.context, 'text', 'span 2');

      inputGrid.append(titleField.wrap, dateField.wrap, typeField.wrap, endedField.wrap, locField.wrap, newPeopleField.wrap);
      if (evt.type === 'person') inputGrid.append(aliasField.wrap);
      inputGrid.append(parentField.wrap, ctxField.wrap);
      container.appendChild(inputGrid);

      evt.mutedGroups = evt.mutedGroups || [];
      const makeToggle = (icon, label, isChecked) => {
        const wrap = createHTMLElement('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', background: 'var(--omni-hover)', padding: '6px 10px', borderRadius: '6px' } });
        const cb = createHTMLElement('input', { type: 'checkbox', checked: isChecked, style: { accentColor: 'var(--omni-accent)', cursor: 'pointer' } });
        wrap.appendChild(cb);
        wrap.appendChild(createHTMLElement('span', { icon, textContent: label, style: { display: 'flex', gap: '4px', fontSize: '11px', color: 'var(--omni-text)' } }));
        return { wrap, cb };
      };

      const toggleContainer = createHTMLElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' } });
      const pinToggle = makeToggle('', 'Pin to Widget', !!evt.isPinned);
      const muteYearly = makeToggle('', 'Mute Yearly', evt.mutedGroups.includes('yearly'));
      const muteMonthly = makeToggle('', 'Mute Monthly', evt.mutedGroups.includes('100_days'));
      const archiveGlobal = makeToggle('', 'Archive (Hide)', !!evt.isArchived);

      toggleContainer.append(pinToggle.wrap, muteYearly.wrap, muteMonthly.wrap, archiveGlobal.wrap);
      container.appendChild(toggleContainer);

      const actions = [
        FluxKit.ui.omni.Button('success', 'Save Changes', async (e) => {
          e.stopPropagation();
          evt.title = titleField.input.value.trim();
          const updatedDate = new Date(dateField.input.value);
          evt.date = updatedDate.toISOString();
          evt.hasSpecificTime = (updatedDate.getHours() !== 0 || updatedDate.getMinutes() !== 0);
          evt.location = locField.input.value.trim();
          
          const rawNewPeople = newPeopleField.input.value.split(',').map(s => s.trim()).filter(Boolean);
          const resolvedPersonIds = rawNewPeople.map(rawName => ChronicleManager.resolvePerson(rawName));
          evt.parentIds = [...new Set([...parentField.getSelected(), ...resolvedPersonIds])];

          delete evt.parentId;
          evt.context = ctxField.input.value.trim();
          evt.isArchived = archiveGlobal.cb.checked;
          evt.mutedGroups = [];
          if (muteYearly.cb.checked) evt.mutedGroups.push('yearly');
          if (muteMonthly.cb.checked) evt.mutedGroups.push('100_days');
          
          evt.type = typeField.select.value; 
          evt.aliases = aliasField.input.value.split(',').map(s => s.trim()).filter(Boolean);
          evt.isPinned = pinToggle.cb.checked;
          evt.endedOn = endedField.input.value ? new Date(endedField.input.value).toISOString() : null;
          
          ChronicleManager.updateEvent(evt);
          FluxKit.ipc.broadcast('flxhub-set-input', { value: ChronicleManager.getEditReturnPath() });
        }),
        FluxKit.ui.omni.Button('chevronLeft', 'Cancel', (e) => {
          e.stopPropagation();
          FluxKit.ipc.broadcast('flxhub-set-input', { value: ChronicleManager.getEditReturnPath() });
        })
      ];

      slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([container], actions));
      return;
    }

    if (query.toLowerCase().startsWith('edit')) {
      const filterTerm = query.substring(4).trim().toLowerCase();
      let events = ChronicleManager.getMergedEvents();
      const allEventsLookup = ChronicleManager.getEvents();

      if (filterTerm) {
        const isYearFilter = /^\d{4}$/.test(filterTerm);

        events = events.filter(e => {
          const parentTitles = (e.parentIds || []).map(pid => {
            const parent = allEventsLookup.find(node => node.id === pid);
            return parent ? parent.title.toLowerCase() : '';
          });
          const textMatch = (e.title || '').toLowerCase().includes(filterTerm) ||
                  (e.context || '').toLowerCase().includes(filterTerm) ||
                  (e.location || '').toLowerCase().includes(filterTerm) ||
                  parentTitles.some(title => title.includes(filterTerm));

          if (isYearFilter) {
            const eventYear = new Date(e.date).getFullYear().toString();
            return textMatch || eventYear === filterTerm;
          }

          return textMatch;
        });
      }

      events.sort((a, b) => {
        const diff = DateUtils.getNextOccurrence(a.date) - DateUtils.getNextOccurrence(b.date);
        return diff !== 0 ? diff : new Date(b.date) - new Date(a.date);
      });

      if (events.length === 0) {
        const emptyDiv = createHTMLElement('div', { style: { padding: '16px', textAlign: 'center', color: 'var(--omni-muted)', fontSize: '13px' } });
        emptyDiv.innerHTML = safeHTML(filterTerm ? `No events match "<strong>${filterTerm}</strong>".` : `No active timeline events. Type "> date add [event]" to begin.`);
        slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([emptyDiv], []));
        return;
      }

      const ROW_HEIGHT = 72;
      const CONTAINER_HEIGHT = 350;
      let selectedIndex = 0;

      const updateSelection = (ctx) => {
        ctx.physicalNodes.forEach((node, i) => {
          const itemIndex = ctx.getStartIndex() + i;
          if (itemIndex < events.length) {
            const row = node.firstElementChild;
            if (!row) return;
            if (itemIndex === selectedIndex) {
              row.style.borderColor = 'var(--omni-accent)';
              row.style.background = 'var(--omni-hover)';
            } else {
              row.style.borderColor = 'var(--omni-border)';
              row.style.background = 'var(--omni-bg)';
            }
          }
        });
      };

      function triggerView(evt) {
        ChronicleManager.setContext(evt.id);
        ChronicleManager.setEditReturnPath('> date ' + query);
        FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date edit-mode' });
      }

      const vListCtx = createVirtualList(events, ROW_HEIGHT, CONTAINER_HEIGHT, (node, evt, idx) => {
        node.innerHTML = '';
        node.style.padding = '0 8px';

        const row = createHTMLElement('div', {
          style: { padding: '12px', background: 'var(--omni-bg)', border: '1px solid var(--omni-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background-color 0.1s', marginBottom: '8px' },
          eventListener: {
            mouseenter: () => { selectedIndex = idx; updateSelection(vListCtx); },
            mouseleave: () => { selectedIndex = -1; updateSelection(vListCtx); },
            click: (e) => { e.stopPropagation(); triggerView(evt); }
          }
        });

        const leftCol = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
        const titleWrap = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' }});

        if (!evt.isReadOnly) {
          if (evt.type === 'era') titleWrap.appendChild(createHTMLElement('span', { icon: 'sync', style: { fontSize: '12px', opacity: '0.7' } }));
          else if (evt.type === 'person') titleWrap.appendChild(createHTMLElement('span', { icon: 'user', style: { fontSize: '12px', opacity: '0.7' } }));
        }
        
        titleWrap.appendChild(createHTMLElement('span', { style: { fontSize: '14px', fontWeight: 'bold', color: 'var(--omni-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, textContent: evt.title }));
        leftCol.appendChild(titleWrap);

        const dateStr = evt.hasSpecificTime
          ? new Date(evt.date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : new Date(evt.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

        const metaRow = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' } });
        metaRow.appendChild(createHTMLElement('span', { style: { fontSize: '11px', color: 'var(--omni-muted)', whiteSpace: 'nowrap' }, textContent: dateStr }));
        
        if (evt.isReadOnly) {
          metaRow.appendChild(DateUtils.createSourceBadge(evt.source, slot));
        }

        leftCol.appendChild(metaRow);
        row.appendChild(leftCol);

        let durationStr;
        if ((evt.type === 'era' || evt.type === 'person') && !evt.endedOn) durationStr = DateUtils.getRelativeString(DateUtils.getNextOccurrence(evt.date), new Date());
        else durationStr = DateUtils.getRelativeString(evt.date, new Date());
        row.appendChild(createHTMLElement('div', { style: { fontSize: '13px', fontWeight: 'bold', color: 'var(--omni-accent)' }, textContent: durationStr }));

        node.appendChild(row);

        if (idx === selectedIndex) {
          row.style.borderColor = 'var(--omni-accent)';
          row.style.background = 'var(--omni-hover)';
        }
      });

      updateSelection(vListCtx);

      slot.addEventListener('flx-remote-keydown', (e) => {
        const { key } = e.detail;
        if (key === 'ArrowDown') {
          e.preventDefault();
          selectedIndex = (selectedIndex + 1) % events.length;
          const scrollTarget = selectedIndex * ROW_HEIGHT;
          if (scrollTarget > vListCtx.container.scrollTop + CONTAINER_HEIGHT - ROW_HEIGHT) {
            vListCtx.container.scrollTop = scrollTarget - CONTAINER_HEIGHT + ROW_HEIGHT;
          } else if (scrollTarget < vListCtx.container.scrollTop) {
            vListCtx.container.scrollTop = scrollTarget;
          }
          updateSelection(vListCtx);
        }
        else if (key === 'ArrowUp') {
          e.preventDefault();
          selectedIndex = (selectedIndex - 1 + events.length) % events.length;
          const scrollTarget = selectedIndex * ROW_HEIGHT;
          if (scrollTarget < vListCtx.container.scrollTop) {
            vListCtx.container.scrollTop = scrollTarget;
          } else if (scrollTarget > vListCtx.container.scrollTop + CONTAINER_HEIGHT - ROW_HEIGHT) {
            vListCtx.container.scrollTop = scrollTarget - CONTAINER_HEIGHT + ROW_HEIGHT;
          }
          updateSelection(vListCtx);
        }
        else if (key === 'Enter') {
          e.preventDefault();
          const targetEvent = events[selectedIndex];
          if (targetEvent) triggerView(targetEvent);
        }
      }, { signal });

      const listWrap = createHTMLElement('div', { style: { padding: '8px 0' } });
      listWrap.appendChild(vListCtx.container);
      slot.innerHTML = safeHTML('');
      slot.appendChild(FluxKit.ui.omni.DetailCard([listWrap], []));
      return;
    }

    if (query.toLowerCase().startsWith('view-mode')) {
      const eventId = ChronicleManager.getContext();
      if (!eventId) {
        FluxKit.ipc.broadcast('flxhub-set-input', { value: ChronicleManager.getReturnPath() });
        return;
      }

      const events = ChronicleManager.getMergedEvents();
      const evt = events.find(e => e.id === eventId);
      if (!evt) return;
      
      const isPerson = evt.type === 'person';
      const dateObj = new Date(evt.date);
      const displayDate = evt.hasSpecificTime
        ? dateObj.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : dateObj.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

      let timeCurrency = DateUtils.getRelativeString(evt.date, new Date());
      if (evt.endedOn) {
        const totalDuration = DateUtils.getRelativeString(evt.endedOn, evt.date).replace(/( ago| from now)$/, '');
        timeCurrency = `Ended: ${new Date(evt.endedOn).toLocaleDateString()} — ${isPerson ? 'Lifespan' : 'Total Duration'}: ${totalDuration}`;
      } else if (isPerson || evt.type === 'era') {
        timeCurrency = `${isPerson ? 'Age: ' : ''}${timeCurrency.replace(/( ago| from now)$/, '')}`;
      }

      const gridData = {
        'Profile': `<span style="color: var(--omni-muted)">${currentProfile}</span>`,
        [isPerson ? 'Entity' : 'Event']: `<strong style="color: var(--omni-text)">${evt.title}</strong>`,
        [isPerson ? 'Born' : 'Timeline']: `<span style="color: var(--omni-accent)">${displayDate}</span> <span style="font-size: 11px; color: var(--omni-muted);">(${timeCurrency})</span>`
      };
      
      if (evt.isReadOnly) {
        const sourceColor = DateUtils.getSourceColor(evt.source, slot);
        gridData['Source Feed'] = `<span style="color: ${sourceColor}; font-weight: bold;">${evt.source}</span>`;
      }
      
      if (evt.location) gridData['Location'] = evt.location;
      if (evt.people && evt.people.length > 0) gridData['People'] = ChronicleManager.getPeopleNames(evt.people).join(', ');
      if (evt.context) gridData['Context'] = evt.context;

      const grid = FluxKit.ui.omni.DataGrid(gridData);

      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

      const headRow = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } });
      headRow.appendChild(createHTMLElement('div', { textContent: isPerson ? 'Person Profile' : (evt.type === 'era' ? 'Epic Details' : 'Event Details'), style: { fontWeight: 'bold', fontSize: '14px' }}));
      container.appendChild(headRow);

      const parentIds = evt.parentIds || (evt.parentId ? [evt.parentId] : []);
      if (parentIds.length > 0) {
        const allMergedForParents = ChronicleManager.getMergedEvents();
        const parentEvents = parentIds.map(pid => allMergedForParents.find(e => e.id === pid)).filter(Boolean);

        if (parentEvents.length > 0) {
          const parentWrap = createHTMLElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '-4px' } });
          parentEvents.forEach(p => {
            parentWrap.appendChild(createHTMLElement('div', {
              icon: p.type === 'person' ? 'user' : 'folder', textContent: `${p.title}`, title: 'Go to Parent Epic',
              style: { display: 'flex', gap: '4px', fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: 'var(--omni-hover)', color: 'var(--omni-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid var(--omni-border)', fontWeight: '600', transition: 'all 0.15s ease' },
              eventListener: {
                mouseenter: (e) => { e.currentTarget.style.borderColor = 'var(--omni-accent)'; e.currentTarget.style.color = 'var(--omni-accent)'; },
                mouseleave: (e) => { e.currentTarget.style.borderColor = 'var(--omni-border)'; e.currentTarget.style.color = 'var(--omni-text)'; },
                click: (e) => {
                  e.stopPropagation();
                  ChronicleManager.pushContext(p.id);
                  FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date view-mode' });
                }
              }
            }));
          });
          container.appendChild(parentWrap);
        }
      }

      container.appendChild(grid);

      const allMerged = ChronicleManager.getMergedEvents();
      const subEvents = allMerged.filter(e => {
        const pids = e.parentIds || (e.parentId ? [e.parentId] : []);
        return pids.includes(evt.id);
      }).sort((a, b) => new Date(a.date) - new Date(b.date)); 

      if (subEvents.length > 0) {
        const subContainer = createHTMLElement('div', {
          style: { display: 'flex', flexDirection: 'column', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--omni-separator)' }
        });

        subContainer.appendChild(createHTMLElement('div', {
          icon: 'link', textContent: isPerson ? 'MEMORY LANE' : 'TIMELINE',
          style: { display: 'flex', gap: '6px', fontSize: '12px', fontWeight: 'bold', color: 'var(--omni-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }
        }));

        const timelineWrap = createHTMLElement('div', {
          style: { borderLeft: '2px solid var(--omni-separator)', marginLeft: '7px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '4px', paddingBottom: '8px' }
        });

        subEvents.forEach((subEvt) => {
          const row = createHTMLElement('div', {
            style: { position: 'relative', padding: '4px 0', display: 'flex', flexDirection: 'column' }
          });

          const titleEl = createHTMLElement('div', {
            style: { fontSize: '14px', fontWeight: 'bold', color: 'var(--omni-text)', transition: 'color 0.2s ease' },
            textContent: subEvt.title
          });

          const nodeWrap = createHTMLElement('div', {
            style: { position: 'absolute', left: '-28px', top: '5px', width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: '2' },
            title: 'View Event Details',
            eventListener: {
              mouseenter: () => {
                dot.style.background = 'var(--omni-accent)';
                dot.style.borderColor = 'var(--omni-hover)';
                dot.style.transform = 'scale(1.3)';
                titleEl.style.color = 'var(--omni-accent)';
              },
              mouseleave: () => {
                dot.style.background = 'var(--omni-muted)';
                dot.style.borderColor = 'var(--omni-bg)';
                dot.style.transform = 'scale(1)';
                titleEl.style.color = 'var(--omni-text)';
              },
              click: (e) => {
                e.stopPropagation();
                ChronicleManager.pushContext(subEvt.id);
                FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date view-mode' });
              }
            }
          });

          const dot = createHTMLElement('div', {
            style: { width: '6px', height: '6px', background: 'var(--omni-muted)', borderRadius: '50%', border: '4px solid var(--omni-bg)', transition: 'all 0.2s ease', boxSizing: 'content-box' }
          });

          nodeWrap.appendChild(dot);
          row.appendChild(nodeWrap);

          const headWrap = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }});
          
          const grandChildren = allMerged.filter(e => {
            const pids = e.parentIds || (e.parentId ? [e.parentId] : []);
            return pids.includes(subEvt.id);
          });

          const leftTitleWrap = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
          leftTitleWrap.appendChild(titleEl);

          if (grandChildren.length > 0) {
            const badge = createHTMLElement('div', {
              style: { fontSize: '10px', fontWeight: 'bold', color: 'var(--omni-accent)', background: 'var(--omni-hover)', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px' }
            });
            badge.appendChild(createHTMLElement('span', { icon: 'layers', style: { fontSize: '10px' } }));
            badge.appendChild(createHTMLElement('span', { textContent: grandChildren.length }));
            leftTitleWrap.appendChild(badge);
          }

          headWrap.appendChild(leftTitleWrap);
          headWrap.appendChild(createHTMLElement('div', { style: { fontSize: '11px', color: 'var(--omni-accent)', fontWeight: '600', whiteSpace: 'nowrap', marginLeft: '12px' }, textContent: new Date(subEvt.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }));
          row.appendChild(headWrap);

          if (subEvt.context) {
            row.appendChild(createHTMLElement('div', { style: { fontSize: '13px', color: 'var(--omni-text)', opacity: '0.75', lineHeight: '1.5', marginTop: '4px' }, textContent: subEvt.context }));
          }

          timelineWrap.appendChild(row);
        });

        subContainer.appendChild(timelineWrap);
        container.appendChild(subContainer);
      }

      const actions = [];

      if (!evt.isReadOnly) {
        if (evt.type === 'era' || evt.type === 'person') {
          actions.push(FluxKit.ui.omni.Button('plus', 'Add Linked Event', (e) => {
            e.stopPropagation();
            ChronicleManager.setParentContext(evt.id);
            FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date add ' });
          }));
        }
        actions.push(FluxKit.ui.omni.Button('import', 'Export (Yearly)', (e) => {
          e.stopPropagation();
          DateUtils.exportICS(evt, true);
        }));
        actions.push(FluxKit.ui.omni.Button('import', 'Export (One-off)', (e) => {
          e.stopPropagation();
          DateUtils.exportICS(evt, false);
        }));
        actions.push(FluxKit.ui.omni.Button('edit', 'Edit', (e) => {
          e.stopPropagation();
          ChronicleManager.setEditReturnPath('> date view-mode');
          FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date edit-mode' });
        }));
        actions.push(FluxKit.ui.omni.Button('trash', 'Delete', async (e) => {
          e.stopPropagation();
          if(await FluxKit.ui.confirm(`Are you sure you want to permanently delete "${evt.title}"?`, { themeKey: hopState.get(STATE_KEYS.activeTheme, 'auto') })) {
            ChronicleManager.deleteEvent(evt.id);
            const prevId = ChronicleManager.popContext();
            if (prevId) FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date view-mode' });
            else FluxKit.ipc.broadcast('flxhub-set-input', { value: evt.type === 'era' ? '> eras' : (evt.type === 'person' ? '> people' : '> date') });
          }
        }));
      } else {
        actions.push(FluxKit.ui.omni.Button('settings', 'Manage Subscriptions', (e) => {
          e.stopPropagation();
          FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date sub' });
        }));

        actions.push(FluxKit.ui.omni.Button('plus', 'Save to Timeline', (e) => {
          e.stopPropagation();
          const nativeClone = { ...evt, id: 'evt_' + getUniqueId(), isReadOnly: false, type: evt.isMilestone ? 'era' : 'one-off' };
          delete nativeClone.source;
          delete nativeClone.isMilestone;
          ChronicleManager.saveEvent(nativeClone);
          const prevId = ChronicleManager.popContext();
          FluxKit.ipc.broadcast('flxhub-set-input', { value: prevId ? '> date view-mode' : ChronicleManager.getReturnPath() });
        }));

        actions.push(FluxKit.ui.omni.Button('ban', 'Ignore', (e) => {
          e.stopPropagation();
          if(confirm(`Hide this event from your timeline permanently?`)) {
            ChronicleManager.excludeExternalUid(evt.externalUid);
            const prevId = ChronicleManager.popContext();
            FluxKit.ipc.broadcast('flxhub-set-input', { value: prevId ? '> date view-mode' : ChronicleManager.getReturnPath() });
          }
        }));
      }

      actions.push(FluxKit.ui.omni.Button('chevronLeft', 'Back', (e) => {
        e.stopPropagation();
        const prevId = ChronicleManager.popContext();
        if (prevId) {
          FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date view-mode' });
        } else {
          FluxKit.ipc.broadcast('flxhub-set-input', { value: ChronicleManager.getReturnPath() });
        }
      }));

      slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([container], actions));
      return;
    }

    if (query.toLowerCase().startsWith('sub')) {
      const inputStr = query.substring(3).trim();

      if (inputStr.startsWith('http') || inputStr.startsWith('webcal')) {
        const parts = inputStr.split('|');
        let url = parts[0].trim();
        if (url.startsWith('webcal://')) url = url.replace(/^webcal:\/\//i, 'https://');

        const name = parts[1] ? parts[1].trim() : 'External Calendar';

        const container = createHTMLElement('div', { style: { padding: '16px', textAlign: 'center' }});
        container.innerHTML = safeHTML(`Subscribe to <strong>${name}</strong>?`);

        const actions = [ FluxKit.ui.omni.Button('success', 'Subscribe', async (e) => {
          e.stopPropagation();
          ChronicleManager.addSubscription(name, url);
          ChronicleManager.syncSubscriptions(true);
          FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date sub' });
        }) ];

        slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([container], actions));
        return;
      }

      const subs = ChronicleManager.getSubscriptions();
      const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0', maxHeight: '350px', overflowY: 'auto' }});

      const rowElements = [];
      let selectedIndex = -1;

      const updateSelection = () => {
        rowElements.forEach((item, idx) => {
          if (idx === selectedIndex) {
            item.el.style.borderColor = 'var(--omni-accent)';
            item.el.style.background = 'var(--omni-hover)';
            item.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else {
            item.el.style.borderColor = 'var(--omni-border)';
            item.el.style.background = 'var(--omni-bg)';
          }
        });
      };

      if (subs.length === 0) {
        const emptyDiv = createHTMLElement('div', { style: { padding: '16px', textAlign: 'center', color: 'var(--omni-muted)', fontSize: '13px', lineHeight: '1.5' } });
        emptyDiv.innerHTML = safeHTML(`No active subscriptions.<br><br>Type <strong>> date sub [URL] | [Name]</strong> to add one.`);
        container.appendChild(emptyDiv);
      } else {
        subs.forEach((sub, idx) => {
          const row = createHTMLElement('div', {
            style: { padding: '12px', background: 'var(--omni-bg)', border: '1px solid var(--omni-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'all 0.15s ease' },
            eventListener: {
              mouseenter: () => { selectedIndex = idx; updateSelection(); },
              mouseleave: () => { selectedIndex = -1; updateSelection(); },
              click: (e) => { e.stopPropagation(); triggerUnsubscribe(); }
            }
          });

          async function triggerUnsubscribe() {
            if(await FluxKit.ui.confirm(`Unsubscribe from ${sub.name}? All imported events will be instantly removed from your timeline.`, { themeKey: hopState.get(STATE_KEYS.activeTheme, 'auto') })) {
              ChronicleManager.removeSubscription(sub.id);
              ChronicleManager.syncSubscriptions(true);
              FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date sub' });
            }
          }

          const leftCol = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' } });
          leftCol.appendChild(createHTMLElement('div', { style: { fontSize: '14px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: sub.name }));
          leftCol.appendChild(createHTMLElement('div', { style: { fontSize: '11px', color: 'var(--omni-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px' }, textContent: sub.url }));
          row.appendChild(leftCol);

          const rightCol = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center' } });
          const delBtn = createHTMLElement('button', {
            textContent: 'Unsubscribe',
            style: { background: 'var(--omni-hover)', border: 'none', color: 'var(--omni-danger)', cursor: 'pointer', fontSize: '10px', padding: '6px 10px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 'bold' },
            eventListener: {
              mouseenter: e => { e.target.style.background = 'var(--omni-border)' },
              mouseleave: e => { e.target.style.background = 'var(--omni-hover)' },
              click: (e) => { e.stopPropagation(); triggerUnsubscribe(); }
            }
          });
          rightCol.appendChild(delBtn);
          row.appendChild(rightCol);

          container.appendChild(row);
          rowElements.push({ el: row, trigger: triggerUnsubscribe });
        });
      }

      const headerWrap = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 8px', borderBottom: '1px solid var(--omni-separator)', marginBottom: '8px' }});
      headerWrap.appendChild(createHTMLElement('span', { icon: 'worldClock', textContent: 'Active Subscriptions', style: { display: 'flex', gap: '4px', fontSize: '12px', fontWeight: 'bold', color: 'var(--omni-text)', textTransform: 'uppercase' }}));

      if (subs.length > 0) {
        headerWrap.appendChild(createHTMLElement('button', {
            textContent: 'Sync Feeds',
            style: { background: 'transparent', border: 'none', color: 'var(--omni-accent)', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase' },
            eventListener: { click: (e) => { e.stopPropagation(); ChronicleManager.syncSubscriptions(true); } }
        }));
      }

      const mainContainer = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column' }});
      mainContainer.appendChild(headerWrap);
      mainContainer.appendChild(container);

      if (rowElements.length > 0) {
        selectedIndex = 0;
        updateSelection();
        slot.addEventListener('flx-remote-keydown', (e) => {
          const { key } = e.detail;
          if (key === 'ArrowDown') { e.preventDefault(); selectedIndex = (selectedIndex + 1) % rowElements.length; updateSelection(); }
          else if (key === 'ArrowUp') { e.preventDefault(); selectedIndex = (selectedIndex - 1 + rowElements.length) % rowElements.length; updateSelection(); }
          else if (key === 'Enter') { e.preventDefault(); if (rowElements[selectedIndex]) rowElements[selectedIndex].trigger(); }
        }, { signal: viewAbortController.signal });
      }

      slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([mainContainer], []));
      return;
    }

    let events = ChronicleManager.getMergedEvents();
    const filterTerm = query.toLowerCase();
    const allEventsLookup = ChronicleManager.getEvents();

    if (filterTerm === 'archive' || filterTerm === 'archived') {
      events = events.filter(e => e.isArchived);
    } else {
      events = events.filter(e => !e.isArchived);

      if (filterTerm && !filterTerm.startsWith('add ') && !filterTerm.startsWith('sync') && !filterTerm.startsWith('profile ')) {
        const isYearFilter = /^\d{4}$/.test(filterTerm);

        events = events.filter(e => {
          const parentTitles = (e.parentIds || []).map(pid => {
            const parent = allEventsLookup.find(node => node.id === pid);
            return parent ? parent.title.toLowerCase() : '';
          });
          const textMatch = (e.title || '').toLowerCase().includes(filterTerm) ||
                  (e.context || '').toLowerCase().includes(filterTerm) ||
                  (e.location || '').toLowerCase().includes(filterTerm) ||
                  parentTitles.some(title => title.includes(filterTerm));

          if (isYearFilter) {
            const eventYear = new Date(e.date).getFullYear().toString();
            return textMatch || eventYear === filterTerm;
          }
          return textMatch;
        });
      }
    }

    events.sort((a, b) => {
      const diff = DateUtils.getNextOccurrence(a.date) - DateUtils.getNextOccurrence(b.date);
      return diff !== 0 ? diff : new Date(b.date) - new Date(a.date);
    });

    if (events.length === 0) {
      const emptyDiv = createHTMLElement('div', { style: { padding: '16px', textAlign: 'center', color: 'var(--omni-muted)', fontSize: '13px' } });
      emptyDiv.innerHTML = safeHTML(filterTerm ? `No events match "<strong>${filterTerm}</strong>".` : `No active timeline events. Type "> date add one-off [event]" to begin.`);
      slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([emptyDiv], []));
      return;
    }

    const ROW_HEIGHT = 72;
    const CONTAINER_HEIGHT = 350;
    let selectedIndex = 0;

    const updateSelection = (ctx) => {
      ctx.physicalNodes.forEach((node, i) => {
        const itemIndex = ctx.getStartIndex() + i;
        if (itemIndex < events.length) {
          const row = node.firstElementChild;
          if (!row) return;
          if (itemIndex === selectedIndex) {
            row.style.borderColor = 'var(--omni-accent)';
            row.style.background = 'var(--omni-hover)';
          } else {
            row.style.borderColor = 'var(--omni-border)';
            row.style.background = 'var(--omni-bg)';
          }
        }
      });
    };

    function triggerView(evt) {
      ChronicleManager.setContext(evt.id);
      ChronicleManager.setReturnPath('> date ' + query);
      FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date view-mode' });
    }

    const vListCtx = createVirtualList(events, ROW_HEIGHT, CONTAINER_HEIGHT, (node, evt, idx) => {
      node.innerHTML = '';
      node.style.padding = '0 8px';

      const row = createHTMLElement('div', {
        style: { padding: '12px', background: 'var(--omni-bg)', border: '1px solid var(--omni-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background-color 0.1s', marginBottom: '8px' },
        eventListener: {
          mouseenter: () => { selectedIndex = idx; updateSelection(vListCtx); },
          mouseleave: () => { selectedIndex = -1; updateSelection(vListCtx); },
          click: (e) => { e.stopPropagation(); triggerView(evt); }
        }
      });

      const leftCol = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
      const titleWrap = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' }});

      if (!evt.isReadOnly) {
        if (evt.type === 'era') titleWrap.appendChild(createHTMLElement('span', { icon: 'sync', style: { fontSize: '12px', opacity: '0.7' } }));
        else if (evt.type === 'person') titleWrap.appendChild(createHTMLElement('span', { icon: 'user', style: { fontSize: '12px', opacity: '0.7' } }));
      }
      
      titleWrap.appendChild(createHTMLElement('span', { style: { fontSize: '14px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: evt.title }));
      leftCol.appendChild(titleWrap);

      const dateStr = evt.hasSpecificTime
        ? new Date(evt.date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : new Date(evt.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

      const metaRow = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' } });
      metaRow.appendChild(createHTMLElement('span', { style: { fontSize: '11px', color: 'var(--omni-muted)', whiteSpace: 'nowrap' }, textContent: dateStr }));
      
      if (evt.isReadOnly) {
        metaRow.appendChild(DateUtils.createSourceBadge(evt.source, slot));
      }

      leftCol.appendChild(metaRow);
      row.appendChild(leftCol);

      let durationStr;
      if ((evt.type === 'era' || evt.type === 'person') && !evt.endedOn) durationStr = DateUtils.getRelativeString(DateUtils.getNextOccurrence(evt.date), new Date());
      else durationStr = DateUtils.getRelativeString(evt.date, new Date());
      row.appendChild(createHTMLElement('div', { style: { fontSize: '13px', fontWeight: 'bold', color: 'var(--omni-accent)' }, textContent: durationStr }));

      node.appendChild(row);

      if (idx === selectedIndex) {
        row.style.borderColor = 'var(--omni-accent)';
        row.style.background = 'var(--omni-hover)';
      }
    });

    updateSelection(vListCtx);

    slot.addEventListener('flx-remote-keydown', (e) => {
      const { key } = e.detail;
      if (key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % events.length;
        const scrollTarget = selectedIndex * ROW_HEIGHT;
        if (scrollTarget > vListCtx.container.scrollTop + CONTAINER_HEIGHT - ROW_HEIGHT) {
          vListCtx.container.scrollTop = scrollTarget - CONTAINER_HEIGHT + ROW_HEIGHT;
        } else if (scrollTarget < vListCtx.container.scrollTop) {
          vListCtx.container.scrollTop = scrollTarget;
        }
        updateSelection(vListCtx);
      }
      else if (key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + events.length) % events.length;
        const scrollTarget = selectedIndex * ROW_HEIGHT;
        if (scrollTarget < vListCtx.container.scrollTop) {
          vListCtx.container.scrollTop = scrollTarget;
        } else if (scrollTarget > vListCtx.container.scrollTop + CONTAINER_HEIGHT - ROW_HEIGHT) {
          vListCtx.container.scrollTop = scrollTarget - CONTAINER_HEIGHT + ROW_HEIGHT;
        }
        updateSelection(vListCtx);
      }
      else if (key === 'Enter') {
        e.preventDefault();
        const targetEvent = events[selectedIndex];
        if (targetEvent) triggerView(targetEvent);
      }
    }, { signal });

    const listWrap = createHTMLElement('div', { style: { padding: '8px 0' } });
    listWrap.appendChild(vListCtx.container);
    slot.innerHTML = safeHTML('');
    slot.appendChild(FluxKit.ui.omni.DetailCard([listWrap], []));
  }

  function TodayView(payload) {
    const host = document.getElementById('flx-hub-host');
    if (!host || !host.shadowRoot) return;
    const slot = host.shadowRoot.getElementById(payload.targetId);
    if (!slot) return;

    if (viewAbortController) viewAbortController.abort();
    viewAbortController = new AbortController();
    const { signal } = viewAbortController;

    const allEvents = ChronicleManager.getMergedEvents();
    const milestones = ChronicleManager.getMilestones(new Date());

    const groupedEvents = { today: [], upcoming: [], timehop: [] };

    allEvents.forEach(evt => {
      if (evt.isArchived || (evt.type === 'era' && evt.endedOn)) return;

      const evtDate = new Date(evt.date);
      const muted = evt.mutedGroups || [];

      for (const ms of milestones) {
        if (ms.calc(evtDate)) {
          if (muted.includes(ms.muteKey)) continue;
          groupedEvents[ms.group === 'today' || ms.group === 'upcoming' ? ms.group : 'timehop'].push({
            ...evt,
            milestoneLabel: ms.getLabel(evtDate, evt).label
          });
          break;
        }
      }
    });

    groupedEvents.upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

    const container = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px', padding: '8px 0', maxHeight: '450px', overflowY: 'auto' } });

    const rowElements = [];
    let selectedIndex = -1;

    const updateSelection = () => {
      rowElements.forEach((item, idx) => {
        if (idx === selectedIndex) {
          item.el.style.borderColor = 'var(--omni-accent)';
          item.el.style.background = 'var(--omni-hover)';
          item.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
          item.el.style.borderColor = 'var(--omni-border)';
          item.el.style.background = 'var(--omni-bg)';
        }
      });
    };

    const renderSection = (icon, title, events, emptyMsg) => {
      const section = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
      section.appendChild(createHTMLElement('div', { icon, textContent: title,
        style: { display: 'flex', gap: '4px', fontSize: '13px', fontWeight: 'bold', color: 'var(--omni-text)', borderBottom: '1px solid var(--omni-separator)', paddingBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }
      }));

      if (events.length === 0) {
        section.appendChild(createHTMLElement('div', { style: { fontSize: '13px', color: 'var(--omni-muted)', fontStyle: 'italic', padding: '4px 0' }, textContent: emptyMsg }));
      } else {
        events.forEach(evt => {
          const rowIdx = rowElements.length;
          const row = createHTMLElement('div', {
            style: { padding: '12px', background: 'var(--omni-bg)', border: '1px solid var(--omni-border)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px', cursor: 'pointer', transition: 'all 0.15s ease' },
            eventListener: {
              mouseenter: () => { selectedIndex = rowIdx; updateSelection(); },
              mouseleave: () => { selectedIndex = -1; updateSelection(); },
              click: (e) => { e.stopPropagation(); triggerView(); }
            }
          });

          function triggerView() {
            ChronicleManager.setContext(evt.id);
            ChronicleManager.setReturnPath('> today');
            FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date view-mode' });
          }

          const header = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
          const titleWrap = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } });

          if (!evt.isReadOnly) {
            if (evt.type === 'era') titleWrap.appendChild(createHTMLElement('span', { icon: 'sync', style: { fontSize: '12px', opacity: '0.7' } }));
            else if (evt.type === 'person') titleWrap.appendChild(createHTMLElement('span', { icon: 'user', style: { fontSize: '12px', opacity: '0.7' } }));
          }

          if (!evt.milestoneLabel.includes('Happening Today')) {
            titleWrap.appendChild(createHTMLElement('span', { style: { fontSize: '11px', color: 'var(--omni-accent)', fontWeight: 'bold', padding: '2px 6px', background: 'var(--omni-hover)', borderRadius: '4px' }, textContent: evt.milestoneLabel }));
          }
          titleWrap.appendChild(createHTMLElement('span', { style: { fontSize: '15px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: evt.title }));

          header.appendChild(titleWrap);

          const dateStr = evt.hasSpecificTime
            ? new Date(evt.date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : new Date(evt.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

          header.appendChild(createHTMLElement('div', { style: { fontSize: '12px', color: 'var(--omni-accent)', textAlign: 'right', whiteSpace: 'nowrap', marginLeft: '12px' }, textContent: dateStr }));
          row.appendChild(header);

          if (evt.context) row.appendChild(createHTMLElement('div', { style: { fontSize: '13px', color: 'var(--omni-muted)', fontStyle: 'italic', lineHeight: '1.4', marginTop: '4px' }, textContent: evt.context }));

          const metaRow = createHTMLElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '4px', alignItems: 'center' }});
          if (evt.location) metaRow.appendChild(createHTMLElement('div', { style: { fontSize: '11px', color: 'var(--omni-text)', opacity: '0.7' }, textContent: `📍 ${evt.location}` }));
          
          const pids = evt.parentIds || (evt.parentId ? [evt.parentId] : []);
          const parentPeople = pids.map(id => allEvents.find(e => e.id === id && e.type === 'person')).filter(Boolean);
          if (parentPeople.length > 0) {
            metaRow.appendChild(createHTMLElement('div', { 
              style: { display: 'flex', gap: '4px', fontSize: '11px', color: 'var(--omni-text)', opacity: '0.7' }, 
              icon: 'user', 
              textContent: parentPeople.map(p => p.title).join(', ') 
            }));
          }

          if (evt.isReadOnly) {
            metaRow.appendChild(DateUtils.createSourceBadge(evt.source, slot));
          }

          if (metaRow.children.length > 0) row.appendChild(metaRow);

          section.appendChild(row);
          rowElements.push({ el: row, trigger: triggerView });
        });
      }
      container.appendChild(section);
    };

    const totalEvents = groupedEvents.today.length + groupedEvents.upcoming.length + groupedEvents.timehop.length;

    if (totalEvents === 0) {
      const emptyState = createHTMLElement('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 16px', color: 'var(--omni-muted)', textAlign: 'center', gap: '12px' }
      });

      emptyState.appendChild(createHTMLElement('div', { textContent: '🌱', style: { fontSize: '32px', opacity: '0.8' } }));
      emptyState.appendChild(createHTMLElement('div', {
        innerHTML: '<strong style="color: var(--omni-text);">A quiet day on the timeline.</strong><br><span style="font-size: 13px; margin-top: 6px; display: inline-block;">No immediate milestones, upcoming events, or historical timehops on your radar.</span>',
        style: { fontSize: '15px', lineHeight: '1.4' }
      }));

      container.appendChild(emptyState);
    } else {
      if (groupedEvents.today.length > 0) renderSection('pin', 'Happening Today', groupedEvents.today);
      if (groupedEvents.upcoming.length > 0) renderSection('hourglass', 'Upcoming Reminders', groupedEvents.upcoming);
      if (groupedEvents.timehop.length > 0) renderSection('clock', 'Timehop', groupedEvents.timehop);
    }

    if (rowElements.length > 0) {
      selectedIndex = 0;

      slot.addEventListener('flx-remote-keydown', (e) => {
        const { key } = e.detail;
        if (key === 'ArrowDown') { e.preventDefault(); selectedIndex = (selectedIndex + 1) % rowElements.length; updateSelection(); }
        else if (key === 'ArrowUp') { e.preventDefault(); selectedIndex = (selectedIndex - 1 + rowElements.length) % rowElements.length; updateSelection(); }
        else if (key === 'Enter') { e.preventDefault(); if (rowElements[selectedIndex]) rowElements[selectedIndex].trigger(); }
      }, { signal });
    }

    slot.innerHTML = safeHTML('');
    slot.appendChild(FluxKit.ui.omni.DetailCard([container], []));
  }

  function ErasView(payload) {
    const host = document.getElementById('flx-hub-host');
    if (!host || !host.shadowRoot) return;
    const slot = host.shadowRoot.getElementById(payload.targetId);
    if (!slot) return;

    if (viewAbortController) viewAbortController.abort();
    viewAbortController = new AbortController();
    const { signal } = viewAbortController;

    const query = (payload.query || '').trim();
    const filterTerm = query.toLowerCase();

    let events = ChronicleManager.getEvents().filter(e => e.type === 'era' && !e.isArchived);

    if (filterTerm) {
      const allEventsLookup = ChronicleManager.getEvents();
      events = events.filter(e => {
        const parentTitles = (e.parentIds || []).map(pid => {
          const parent = allEventsLookup.find(node => node.id === pid);
          return parent ? parent.title.toLowerCase() : '';
        });
        return (e.title || '').toLowerCase().includes(filterTerm) ||
                (e.context || '').toLowerCase().includes(filterTerm) ||
                (e.location || '').toLowerCase().includes(filterTerm) ||
                parentTitles.some(title => title.includes(filterTerm));
      });
    }

    events.sort((a, b) => {
      const diff = DateUtils.getNextOccurrence(a.date) - DateUtils.getNextOccurrence(b.date);
      return diff !== 0 ? diff : new Date(b.date) - new Date(a.date);
    });

    if (events.length === 0) {
      const emptyDiv = createHTMLElement('div', { style: { padding: '16px', textAlign: 'center', color: 'var(--omni-muted)', fontSize: '13px' }, textContent: 'No Eras found.' });
      slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([emptyDiv], []));
      return;
    }

    const ROW_HEIGHT = 72;
    const CONTAINER_HEIGHT = 350;
    let selectedIndex = 0;

    const updateSelection = (ctx) => {
      ctx.physicalNodes.forEach((node, i) => {
        const itemIndex = ctx.getStartIndex() + i;
        if (itemIndex < events.length) {
          const row = node.firstElementChild;
          if (!row) return;
          if (itemIndex === selectedIndex) {
            row.style.borderColor = 'var(--omni-accent)';
            row.style.background = 'var(--omni-hover)';
          } else {
            row.style.borderColor = 'var(--omni-border)';
            row.style.background = 'var(--omni-bg)';
          }
        }
      });
    };

    function triggerView(evt) {
      ChronicleManager.setContext(evt.id);
      ChronicleManager.setReturnPath('> eras ' + query);
      FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date view-mode' });
    }

    const vListCtx = createVirtualList(events, ROW_HEIGHT, CONTAINER_HEIGHT, (node, evt, idx) => {
      node.innerHTML = '';
      node.style.padding = '0 8px';

      const row = createHTMLElement('div', {
        style: { padding: '12px', background: 'var(--omni-bg)', border: '1px solid var(--omni-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background-color 0.1s', marginBottom: '8px', opacity: evt.endedOn ? '0.6' : '1' },
        eventListener: {
          mouseenter: () => { selectedIndex = idx; updateSelection(vListCtx); },
          mouseleave: () => { selectedIndex = -1; updateSelection(vListCtx); },
          click: (e) => { e.stopPropagation(); triggerView(evt); }
        }
      });

      const leftCol = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
      leftCol.appendChild(createHTMLElement('div', { style: { fontSize: '14px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: evt.title }));

      const metaText = evt.endedOn
        ? `Ended: ${new Date(evt.endedOn).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
        : `Started: ${new Date(evt.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
      leftCol.appendChild(createHTMLElement('div', { style: { fontSize: '11px', color: 'var(--omni-muted)' }, textContent: metaText }));

      row.appendChild(leftCol);

      const baseDate = evt.endedOn ? new Date(evt.endedOn) : new Date();
      let durationStr = DateUtils.getRelativeString(evt.date, baseDate).replace(/( ago| from now)$/, '');

      row.appendChild(createHTMLElement('div', { style: { fontSize: '15px', fontWeight: 'bold', color: 'var(--omni-accent)' }, textContent: durationStr }));

      node.appendChild(row);

      if (idx === selectedIndex) {
        row.style.borderColor = 'var(--omni-accent)';
        row.style.background = 'var(--omni-hover)';
      }
    });

    updateSelection(vListCtx);

    slot.addEventListener('flx-remote-keydown', (e) => {
      const { key } = e.detail;
      if (key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % events.length;
        const scrollTarget = selectedIndex * ROW_HEIGHT;
        if (scrollTarget > vListCtx.container.scrollTop + CONTAINER_HEIGHT - ROW_HEIGHT) {
          vListCtx.container.scrollTop = scrollTarget - CONTAINER_HEIGHT + ROW_HEIGHT;
        } else if (scrollTarget < vListCtx.container.scrollTop) {
          vListCtx.container.scrollTop = scrollTarget;
        }
        updateSelection(vListCtx);
      }
      else if (key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + events.length) % events.length;
        const scrollTarget = selectedIndex * ROW_HEIGHT;
        if (scrollTarget < vListCtx.container.scrollTop) {
          vListCtx.container.scrollTop = scrollTarget;
        } else if (scrollTarget > vListCtx.container.scrollTop + CONTAINER_HEIGHT - ROW_HEIGHT) {
          vListCtx.container.scrollTop = scrollTarget - CONTAINER_HEIGHT + ROW_HEIGHT;
        }
        updateSelection(vListCtx);
      }
      else if (key === 'Enter') {
        e.preventDefault();
        const targetEvent = events[selectedIndex];
        if (targetEvent) triggerView(targetEvent);
      }
    }, { signal: viewAbortController?.signal });

    const listWrap = createHTMLElement('div', { style: { padding: '8px 0' } });
    listWrap.appendChild(vListCtx.container);
    slot.innerHTML = safeHTML('');
    slot.appendChild(FluxKit.ui.omni.DetailCard([listWrap], []));
  }

  function PeopleView(payload) {
    const host = document.getElementById('flx-hub-host');
    if (!host || !host.shadowRoot) return;
    const slot = host.shadowRoot.getElementById(payload.targetId);
    if (!slot) return;

    if (viewAbortController) viewAbortController.abort();
    viewAbortController = new AbortController();
    const { signal } = viewAbortController;

    const query = (payload.query || '').trim();

    if (query.startsWith('merge-mode')) {
      const sourceId = ChronicleManager.getPersonContext();
      if (!sourceId) {
        FluxKit.ipc.broadcast('flxhub-set-input', { value: '> people' });
        return;
      }

      const allEvents = ChronicleManager.getEvents();
      const sourcePerson = allEvents.find(p => p.id === sourceId);
      const targetPeople = allEvents.filter(p => p.type === 'person' && p.id !== sourceId);

      const container = createHTMLElement('div', { style: { padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }});
      container.appendChild(createHTMLElement('div', {
        innerHTML: `Select person to merge <strong>${sourcePerson ? sourcePerson.title : 'Unknown'}</strong> into:`,
        style: { fontSize: '13px', color: 'var(--omni-text)' }
      }));

      targetPeople.forEach(p => {
        const row = createHTMLElement('div', {
          style: { padding: '10px', background: 'var(--omni-bg)', border: '1px solid var(--omni-border)', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.15s ease', fontSize: '14px', color: 'var(--omni-text)', fontWeight: 'bold' },
          textContent: p.title,
          eventListener: {
            mouseenter: e => { e.target.style.borderColor = 'var(--omni-accent)' },
            mouseleave: e => { e.target.style.borderColor = 'var(--omni-border)' },
            click: (e) => {
              e.stopPropagation();
              ChronicleManager.mergeNodes(sourceId, p.id);
              ChronicleManager.clearPersonContext();
              FluxKit.ipc.broadcast('flxhub-set-input', { value: '> people' });
            }
          }
        });
        container.appendChild(row);
      });

      slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([container], []));
      return;
    }

    const filterTerm = query.toLowerCase();
    let events = ChronicleManager.getEvents().filter(e => e.type === 'person' && !e.isArchived);

    if (filterTerm) {
      events = events.filter(e => 
        (e.title || '').toLowerCase().includes(filterTerm) ||
        (e.aliases || []).some(a => a.toLowerCase().includes(filterTerm))
      );
    }

    events.sort((a, b) => a.title.localeCompare(b.title));

    if (events.length === 0) {
      const emptyDiv = createHTMLElement('div', { style: { padding: '16px', textAlign: 'center', color: 'var(--omni-muted)', fontSize: '13px' }, textContent: 'No People tracked yet.' });
      slot.innerHTML = safeHTML(''); slot.appendChild(FluxKit.ui.omni.DetailCard([emptyDiv], []));
      return;
    }

    const ROW_HEIGHT = 72;
    const CONTAINER_HEIGHT = 350;
    let selectedIndex = 0;

    const updateSelection = (ctx) => {
      ctx.physicalNodes.forEach((node, i) => {
        const itemIndex = ctx.getStartIndex() + i;
        if (itemIndex < events.length) {
          const row = node.firstElementChild;
          if (!row) return;
          if (itemIndex === selectedIndex) {
            row.style.borderColor = 'var(--omni-accent)';
            row.style.background = 'var(--omni-hover)';
          } else {
            row.style.borderColor = 'var(--omni-border)';
            row.style.background = 'var(--omni-bg)';
          }
        }
      });
    };

    function triggerView(evt) {
      ChronicleManager.setContext(evt.id);
      ChronicleManager.setReturnPath('> people ' + query);
      FluxKit.ipc.broadcast('flxhub-set-input', { value: '> date view-mode' });
    }

    const vListCtx = createVirtualList(events, ROW_HEIGHT, CONTAINER_HEIGHT, (node, evt, idx) => {
      node.innerHTML = '';
      node.style.padding = '0 8px';

      const row = createHTMLElement('div', {
        style: { padding: '12px', background: 'var(--omni-bg)', border: '1px solid var(--omni-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background-color 0.1s', marginBottom: '8px', opacity: evt.endedOn ? '0.6' : '1' },
        eventListener: {
          mouseenter: () => { selectedIndex = idx; updateSelection(vListCtx); },
          mouseleave: () => { selectedIndex = -1; updateSelection(vListCtx); },
          click: (e) => { e.stopPropagation(); triggerView(evt); }
        }
      });

      const leftCol = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
      leftCol.appendChild(createHTMLElement('div', { style: { fontSize: '14px', fontWeight: 'bold', color: 'var(--omni-text)' }, textContent: evt.title }));

      if (evt.aliases && evt.aliases.length > 0) {
        leftCol.appendChild(createHTMLElement('div', { style: { fontSize: '11px', color: 'var(--omni-muted)' }, textContent: `Aliases: ${evt.aliases.join(', ')}` }));
      }
      row.appendChild(leftCol);

      const rightCol = createHTMLElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });

      const baseDate = evt.endedOn ? new Date(evt.endedOn) : new Date();
      let durationStr = DateUtils.getRelativeString(evt.date, baseDate).replace(/( ago| from now)$/, '');
      
      rightCol.appendChild(createHTMLElement('div', { style: { fontSize: '13px', fontWeight: 'bold', color: 'var(--omni-accent)' }, textContent: `Age: ${durationStr}` }));

      const makeMiniBtn = (icon, color, onClick) => createHTMLElement('button', {
        icon, title: icon === 'merge' ? 'Merge with another Person' : 'Quick Actions',
        style: { background: 'var(--omni-hover)', border: 'none', color: color, cursor: 'pointer', fontSize: '10px', padding: '4px 8px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 'bold' },
        eventListener: {
          mouseenter: e => { e.target.style.background = 'var(--omni-border)' },
          mouseleave: e => { e.target.style.background = 'var(--omni-hover)' },
          click: onClick
        }
      });

      rightCol.appendChild(makeMiniBtn('merge', 'var(--omni-text)', (e) => {
        e.stopPropagation();
        ChronicleManager.setPersonContext(evt.id);
        FluxKit.ipc.broadcast('flxhub-set-input', { value: '> people merge-mode' });
      }));

      row.appendChild(rightCol);
      node.appendChild(row);

      if (idx === selectedIndex) {
        row.style.borderColor = 'var(--omni-accent)';
        row.style.background = 'var(--omni-hover)';
      }
    });

    updateSelection(vListCtx);

    slot.addEventListener('flx-remote-keydown', (e) => {
      const { key } = e.detail;
      if (key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % events.length;
        const scrollTarget = selectedIndex * ROW_HEIGHT;
        if (scrollTarget > vListCtx.container.scrollTop + CONTAINER_HEIGHT - ROW_HEIGHT) {
          vListCtx.container.scrollTop = scrollTarget - CONTAINER_HEIGHT + ROW_HEIGHT;
        } else if (scrollTarget < vListCtx.container.scrollTop) {
          vListCtx.container.scrollTop = scrollTarget;
        }
        updateSelection(vListCtx);
      }
      else if (key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + events.length) % events.length;
        const scrollTarget = selectedIndex * ROW_HEIGHT;
        if (scrollTarget < vListCtx.container.scrollTop) {
          vListCtx.container.scrollTop = scrollTarget;
        } else if (scrollTarget > vListCtx.container.scrollTop + CONTAINER_HEIGHT - ROW_HEIGHT) {
          vListCtx.container.scrollTop = scrollTarget - CONTAINER_HEIGHT + ROW_HEIGHT;
        }
        updateSelection(vListCtx);
      }
      else if (key === 'Enter') {
        e.preventDefault();
        const targetEvent = events[selectedIndex];
        if (targetEvent) triggerView(targetEvent);
      }
    }, { signal: viewAbortController?.signal });

    const listWrap = createHTMLElement('div', { style: { padding: '8px 0' } });
    listWrap.appendChild(vListCtx.container);
    slot.innerHTML = safeHTML('');
    slot.appendChild(FluxKit.ui.omni.DetailCard([listWrap], []));
  }

  FluxKit.ipc.listen('flxhub-mount-view', async (payload) => {
    if (payload.themeKey) hopState.set(STATE_KEYS.activeTheme, payload.themeKey);
    if (payload.pluginId === 'plugin-chronicle-view') return DateView(payload);
    if (payload.pluginId === 'plugin-today-view') return TodayView(payload);
    if (payload.pluginId === 'plugin-eras-view') return ErasView(payload);
    if (payload.pluginId === 'plugin-people-view') return PeopleView(payload);
  });

  FluxKit.ipc.listen('flxhub-mount-widget', async (payload) => {
    if (payload.widgetId !== 'widget-chronicle-today') return;

    const host = document.getElementById('flx-hub-host');
    if (!host || !host.shadowRoot) return;
    const slot = host.shadowRoot.getElementById(payload.targetId);
    if (!slot) return;

    const currentProfile = ChronicleManager.getActiveProfile();
    const allEvents = ChronicleManager.getMergedEvents();
    const milestones = ChronicleManager.getMilestones(new Date());

    const notableEvents = [];
    allEvents.forEach(evt => {
      if (evt.isArchived || (evt.type === 'era' && evt.endedOn)) return;
      const evtDate = new Date(evt.date);
      for (const ms of milestones) {
        if (ms.calc(evtDate)) {
          notableEvents.push({ ...evt, milestoneLabel: ms.getLabel(evtDate, evt).label });
          break;
        }
      }
    });

    const container = createHTMLElement('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px', cursor: 'pointer' },
      eventListener: (e) => { e.stopPropagation(); FluxKit.ipc.broadcast('flxhub-set-input', { value: '> today' }); }
    });

    const headerWrap = createHTMLElement('div', {
      style: { fontSize: '11px', fontWeight: 'bold', color: 'var(--omni-text)', borderBottom: '1px solid var(--omni-separator)', paddingBottom: '6px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', justifyContent: 'space-between' }
    });
    headerWrap.appendChild(createHTMLElement('span', { icon: 'calendar', textContent: 'Today\'s Highlights', style: { display: 'flex', gap: '4px' } }));
    headerWrap.appendChild(createHTMLElement('span', {
      style: { color: 'var(--omni-accent)' },
      textContent: currentProfile
    }));
    container.appendChild(headerWrap);

    if (notableEvents.length === 0) {
      container.appendChild(createHTMLElement('div', { style: { fontSize: '13px', color: 'var(--omni-muted)', fontStyle: 'italic', padding: '8px 0' }, textContent: "Nothing notable on the horizon today." }));
    } else {
      const maxDisplay = 3;
      const displayEvents = notableEvents.slice(0, maxDisplay);
      const overflowCount = notableEvents.length - maxDisplay;

      displayEvents.forEach(evt => {
        const row = createHTMLElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '8px' } });
        row.appendChild(createHTMLElement('div', { style: { display: 'flex', gap: '4px', fontSize: '11px', color: 'var(--omni-accent)', fontWeight: 'bold' }, icon: evt.milestoneIcon || '', textContent: evt.milestoneLabel }));
        row.appendChild(createHTMLElement('div', { style: { fontSize: '14px', color: 'var(--omni-text)', fontWeight: '500' }, textContent: evt.title }));
        if (evt.context) row.appendChild(createHTMLElement('div', { style: { fontSize: '12px', color: 'var(--omni-muted)', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: '2px' }, textContent: evt.context }));
        container.appendChild(row);
      });

      if (overflowCount > 0) {
        container.appendChild(createHTMLElement('div', {
          style: { fontSize: '11px', color: 'var(--omni-accent)', textAlign: 'center', marginTop: '4px', fontWeight: '600' },
          textContent: `+ ${overflowCount} more today`
        }));
      }
    }

    slot.innerHTML = safeHTML('');
    slot.appendChild(FluxKit.ui.omni.Widget(container));
  });

  FluxKit.ipc.listen('flxhub-mount-widget', async (payload) => {
    if (payload.widgetId !== 'widget-eras-view') return;
    const host = document.getElementById('flx-hub-host');
    if (!host || !host.shadowRoot) return;
    const slot = host.shadowRoot.getElementById(payload.targetId);
    if (!slot) return;

    const pinnedEras = ChronicleManager.getEvents().filter(e => e.type === 'era' && e.isPinned && !e.isArchived && !e.endedOn);

    const container = createHTMLElement('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px', cursor: 'pointer' },
      eventListener: (e) => { e.stopPropagation(); FluxKit.ipc.broadcast('flxhub-set-input', { value: '> eras' }); }
    });

    const headerWrap = createHTMLElement('div', {
      style: { fontSize: '11px', fontWeight: 'bold', color: 'var(--omni-text)', borderBottom: '1px solid var(--omni-separator)', paddingBottom: '6px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' },
      textContent: '📌 Active Eras'
    });
    container.appendChild(headerWrap);

    pinnedEras.forEach(evt => {
      const row = createHTMLElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } });
      row.appendChild(createHTMLElement('div', { style: { fontSize: '13px', color: 'var(--omni-text)', fontWeight: '500' }, textContent: evt.title }));

      let durationStr = DateUtils.getRelativeString(evt.date, new Date()).replace(/( ago| from now)$/, '');
      row.appendChild(createHTMLElement('div', { style: { fontSize: '13px', color: 'var(--omni-accent)', fontWeight: 'bold' }, textContent: durationStr }));
      container.appendChild(row);
    });

    slot.innerHTML = safeHTML('');
    slot.appendChild(FluxKit.ui.omni.Widget(container));
  });
})();