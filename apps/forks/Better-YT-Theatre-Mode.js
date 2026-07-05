// ==UserScript==
// @name                Better YouTube Theater Mode
// @name:zh-TW          更佳 YouTube 劇場模式
// @name:zh-CN          更佳 YouTube 剧场模式
// @name:ja             より良いYouTubeシアターモード
// @icon                https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @author              ElectroKnight22
// @contributor         JYashu
// @namespace           electroknight22_youtube_better_theater_mode_namespace
// @version             3.4.1
// @match               *://www.youtube.com/*
// @match               *://www.youtube-nocookie.com/*
// @require             https://update.greasyfork.org/scripts/549881/1820274/YouTube%20Helper%20API.js
// @noframes
// @grant               GM.getValue
// @grant               GM.setValue
// @grant               GM.deleteValue
// @grant               GM.listValues
// @grant               GM.registerMenuCommand
// @grant               GM.unregisterMenuCommand
// @grant               GM_getValue
// @grant               GM_setValue
// @grant               GM_deleteValue
// @grant               GM_listValues
// @grant               GM_registerMenuCommand
// @grant               GM_unregisterMenuCommand
// @require             https://flux-suite.vercel.app/libs/flux-kit/core.js
// @run-at              document-idle
// @inject-into         page
// @license             MIT
// @description         Improves YouTube's theater mode with a Twitch.tv-like design, enhancing video and chat layouts while maintaining performance and compatibility.
// @description:zh-TW   改善 YouTube 劇場模式，參考 Twitch.tv 的設計，增強影片與聊天室佈局，同時維持效能與相容性。
// @description:zh-CN   改进 YouTube 剧场模式，参考 Twitch.tv 的设计，增强视频与聊天室布局，同时保持性能与兼容性，也达到了类似B站的网页全屏功能。
// @description:ja      YouTubeのシアターモードを改善し、Twitch.tvのデザインを参考にして、動画とチャットのレイアウトを強化しつつ、パフォーマンスと互換性を維持します。
// ==/UserScript==

// @downloadURL https://update.greasyfork.org/scripts/522466/Better%20YouTube%20Theater%20Mode.user.js
// @updateURL https://update.greasyfork.org/scripts/522466/Better%20YouTube%20Theater%20Mode.meta.js

/*jshint esversion: 11 */
/* global youtubeHelperApi, FluxKit */

(function () {
    'use strict';

    const { createLogger } = FluxKit.utils;

    const { logError } = createLogger('YTBTheaterMode');

    const api = youtubeHelperApi;
    if (!api) return logError('Helper API not found.');

    const CONFIG = {
        STORAGE_PREFIX: 'betterTheater_',
        MIN_CHAT_SIZE: {
            width: 300, //px
        },
        DEFAULT_SETTINGS: {
            setLowMasthead: false,
            fullHeightVideo: false,
            tuckRecommendation: false,
            alwaysShowQuickActions: true,
            get theaterChatWidth() {
                return `${CONFIG.MIN_CHAT_SIZE.width}px`;
            },
        },
    };

    const MENU_LABELS = (() => {
        const browserLanguage = navigator.language ?? navigator.userLanguage;
        const translations = {
            moveMastheadBelowVideoPlayer: {
                'en-US': 'Move Search Bar Below Video',
                'zh-TW': '將搜尋列移動到影片下方',
                'zh-CN': '将搜寻列移动到影片下方',
                ja: '検索バーをビデオプレイヤーの下に移動',
            },
            fullHeightVideo: {
                'en-US': 'Full Height Video',
                'zh-TW': '延伸影片至視窗高度',
                'zh-CN': '下移推荐视频',
                ja: '動画をブラウザの高さに広げる',
            },
            tuckRecommendation: {
                'en-US': 'Shift Recommendations Down',
                'zh-TW': '下移推薦影片',
                'zh-CN': '下移推荐视频列表',
                ja: 'おすすめの動画を下にずらす',
            },
            alwaysShowQuickActions: {
                'en-US': 'Always Show Quick Actions',
                'zh-TW': '常駐顯示快速操作',
                'zh-CN': '常驻显示快速操作',
                ja: 'クイックアクションを常に表示',
            },
            autoSwitchPlayerMode: {
                'en-US': 'Auto Switch Player Mode',
                'zh-TW': '自動切換播放器模式',
                'zh-CN': '自动切换播放器模式',
                ja: 'プレイヤーモードの自動切り替え',
            },
        };

        const getPreferredLanguage = () => {
            if (['zh-TW', 'zh-HK'].includes(browserLanguage)) return 'zh-TW';
            if (browserLanguage.startsWith('zh')) return 'zh-CN';
            if (browserLanguage.startsWith('ja')) return 'ja';
            return 'en-US';
        };

        return new Proxy(translations, {
            get(target, property) {
                const keyGroup = target[property];
                if (!keyGroup) return `[${String(property)}]`;
                const currentLanguage = getPreferredLanguage();
                const fallbackLanguage = 'en-US';
                return keyGroup[currentLanguage] ?? keyGroup[fallbackLanguage] ?? `[Missing: ${String(property)}]`;
            },
        });
    })();

    const state = {
        userSettings: { ...CONFIG.DEFAULT_SETTINGS },
        menuItems: [],
        activeStyles: new Map(),
        resizeObserver: null,
        chatWidth: 0,
        moviePlayerHeight: 0,
        wideModeMinWidth: 0, // currently unused
    };

    const DOM = { moviePlayer: null };

    const GhostManager = {
        hasInitialized: false,
        observer: null,
        _pollingInterval: null,
        currentSource: null,
        currentTarget: null,

        init() {
            this.hasInitialized = true;
            this.observer = new MutationObserver((mutations) => {
                const isRelevant = mutations.some(
                    (_mutation) =>
                        _mutation.type === 'childList' ||
                        _mutation.type === 'characterData' ||
                        (_mutation.type === 'attributes' && _mutation.target === this.currentSource),
                );
                if (isRelevant) this.update();
            });

            if (!this.update()) {
                this._pollingInterval = setInterval(() => {
                    if (this.update()) {
                        clearInterval(this._pollingInterval);
                        this._pollingInterval = null;
                    }
                }, 500);
            }
        },

        safelyModifyDOM(action) {
            this.observer?.disconnect();
            try {
                action();
            } finally {
                this.observeElements(this.currentSource, this.currentTarget);
            }
        },

        isSourceReady(element) {
            return (
                element &&
                element.offsetWidth > 0 &&
                !!element.querySelector('button') &&
                !!element.querySelector('yt-icon, svg, img')
            );
        },

        _createBaseButton(referenceButton) {
            const ghost = document.createElement('button');
            ghost.classList.add('bt-ghost-clone');

            const defaults = {
                classes: [
                    'yt-spec-button-shape-next',
                    'yt-spec-button-shape-next--text',
                    'yt-spec-button-shape-next--overlay',
                    'yt-spec-button-shape-next--size-s',
                ],
                styles: { width: '32px', height: '32px' },
            };

            if (referenceButton) {
                ghost.className = referenceButton.className + ' bt-ghost-clone';
            } else {
                ghost.classList.add(...defaults.classes);
            }

            if (referenceButton) {
                const computed = window.getComputedStyle(referenceButton);
                Object.assign(ghost.style, {
                    margin: computed.margin,
                    padding: computed.padding,
                    width: computed.width,
                    height: computed.height,
                    minWidth: computed.minWidth,
                    verticalAlign: 'top',
                });
            } else {
                Object.assign(ghost.style, defaults.styles);
            }

            Object.assign(ghost.style, {
                cursor: 'pointer',
                border: 'none',
                outline: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                padding: '0 18px',
                position: 'relative',
            });

            return ghost;
        },

        _appendIcon(ghost, original) {
            const iconSource = original.querySelector('yt-icon, svg, img');
            if (!iconSource) {
                ghost.textContent = '🔔';
                return;
            }

            const clonedIcon = iconSource.cloneNode(true);
            clonedIcon.style.cssText =
                'width: 24px !important; height: 24px !important; display: block; pointer-events: none; fill: currentColor; color: inherit;';

            const wrapper = document.createElement('div');
            wrapper.className = 'yt-spec-button-shape-next__icon';
            wrapper.style.pointerEvents = 'none';
            wrapper.appendChild(clonedIcon);
            ghost.appendChild(wrapper);
        },

        _appendRipple(ghost) {
            const shape = document.createElement('yt-touch-feedback-shape');
            shape.className = 'yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--overlay-touch-response';
            shape.setAttribute('aria-hidden', 'true');

            shape.appendChild(document.createElement('div')).className = 'yt-spec-touch-feedback-shape__stroke';
            shape.appendChild(document.createElement('div')).className = 'yt-spec-touch-feedback-shape__fill';
            ghost.appendChild(shape);
        },

        _appendBadge(ghost, original) {
            const source = original.querySelector('.yt-spec-icon-badge-shape__badge');
            const text = source?.textContent?.trim();

            if (!text || window.getComputedStyle(source).display === 'none') return;

            const badge = document.createElement('div');
            badge.className = 'bt-ghost-badge';
            badge.textContent = text;

            const computed = window.getComputedStyle(source);

            Object.assign(badge.style, {
                position: 'absolute',
                top: '2px',
                right: '-2px',
                backgroundColor: computed.backgroundColor,
                color: computed.color,
                fontSize: computed.fontSize,
                fontWeight: computed.fontWeight,
                lineHeight: computed.lineHeight,
                fontFamily: computed.fontFamily,
                minWidth: computed.minWidth,
                height: computed.height,
                padding: computed.padding,
                borderRadius: computed.borderRadius,
                border: computed.border,
                pointerEvents: 'none',
                zIndex: '10',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
            });
            ghost.appendChild(badge);
        },

        syncGhost(original, container, targetIndex = 2) {
            if (!this.isSourceReady(original)) return false;

            let ghost = container.querySelector('.bt-ghost-clone');
            if (!ghost) {
                const referenceButton = container.querySelector('button:not(.bt-ghost-clone)');
                ghost = this._createBaseButton(referenceButton);

                this._appendIcon(ghost, original);
                this._appendRipple(ghost);

                const clickTarget = original.querySelector('button') || original;
                ghost.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clickTarget.click();
                });
            }

            const existingBadge = ghost.querySelector('.bt-ghost-badge');
            if (existingBadge) existingBadge.remove();
            this._appendBadge(ghost, original);

            this.safelyModifyDOM(() => {
                const children = Array.from(container.children);
                const currentIndex = children.indexOf(ghost);

                if (currentIndex === targetIndex) return;

                const offset = currentIndex !== -1 && currentIndex < targetIndex ? 1 : 0;
                const refNode = children[targetIndex + offset] || null;

                container.insertBefore(ghost, refNode);
            });

            return true;
        },

        observeElements(source, target) {
            this.currentSource = source || this.currentSource;
            this.currentTarget = target || this.currentTarget;
            if (!this.currentSource || !this.currentTarget) return;

            this.observer.disconnect();
            this.observer.observe(this.currentSource, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
            });
            this.observer.observe(this.currentTarget, { childList: true });
        },

        update() {
            if (!this.hasInitialized) return false;
            const shouldHaveGhosts = state.userSettings.fullHeightVideo && state.userSettings.setLowMasthead;

            if (shouldHaveGhosts) {
                const notifBell = document.querySelector('ytd-notification-topbar-button-renderer');
                const quickActions = document.querySelector('yt-player-quick-action-buttons');

                if (notifBell && quickActions) {
                    this.observeElements(notifBell, quickActions);
                    return this.syncGhost(notifBell, quickActions, 2);
                }
                return false;
            } else {
                const ghosts = document.querySelectorAll('.bt-ghost-clone');
                if (ghosts.length > 0) ghosts.forEach((el) => el.remove());

                this.observer?.disconnect();
                if (this._pollingInterval) clearInterval(this._pollingInterval);
                this.currentSource = null;
                this.currentTarget = null;
                return true;
            }
        },
    };

    const StyleManager = {
        activeStyles: new Map(),
        styleDefinitions: {
            staticStyles: {
                staticVideoPlayerFixStyle: {
                    id: 'betterTheater-staticVideoPlayerFixStyle',
                    getRule: () => `
                        .html5-video-container { top: -1px !important; }
                        #skip-navigation.ytd-masthead { left: -500px; }
                    `,
                },
                chatRendererFixStyle: {
                    id: 'betterTheater-staticChatRendererFixStyle',
                    getRule: () => `ytd-live-chat-frame[theater-watch-while][rounded-container] {
                        border-bottom: 0 !important;
                        }
                    `,
                },
                streamBackgroundImageFixStyle: {
                    id: 'betterTheater-streamBackgroundImageFixStyle',
                    getRule: () => `
                        .ytp-offline-slate-background {
                            background-size: contain !important;
                            max-width: 100% !important;
                            max-height: 100% !important;
                        }
                    `,
                },
                staticTuckRecommendationWidthClampStyle: {
                    id: 'betterTheater-staticTuckRecommendationWidthClampStyle',
                    getRule: () => `
                        #id.ytd-watch-metadata, #top-row.ytd-watch-metadata {
                            max-width:
                                calc(
                                    min(
                                        calc(100vw - 3 * var(--ytd-watch-flexy-horizontal-page-margin)),
                                        100% + var(--ytd-watch-flexy-sidebar-width) + var(--ytd-watch-flexy-horizontal-page-margin)
                                    )
                                )
                            !important;
                        }
                    `,
                },
            },
            chatStyle: {
                id: 'betterTheater-chatStyle',
                getRule: () => `
                    ytd-live-chat-frame[theater-watch-while][rounded-container] {
                        border-radius: 0 !important;
                        border-top: 0 !important;
                    }
                    ytd-watch-flexy[fixed-panels] #chat.ytd-watch-flexy {
                        top: 0 !important;
                        border-top: 0 !important;
                        border-bottom: 0 !important;
                    }
                    #chat-container { z-index: 2021 !important; }
                `,
            },
            fullHeightPlayerStyle: {
                id: 'betterTheater-fullHeightPlayerStyle',
                getRule: () => {
                    const viewportHeight =
                        state.userSettings.setLowMasthead ?
                            '100vh'
                        :   'calc(100vh - var(--ytd-watch-flexy-masthead-height))';

                    return `
                        ytd-watch-flexy[full-bleed-player] #full-bleed-container.ytd-watch-flexy {
                            min-height: ${viewportHeight} !important;
                            max-height: ${viewportHeight} !important;
                        }
                    `;
                },
            },
            alwaysShowQuickActionsStyle: {
                id: 'betterTheater-alwaysShowQuickActionsStyle',
                getRule: () => `
                    .ytp-fullscreen-quick-actions {
                        display: unset !important;
                    }
                    #show-hide-button.ytd-live-chat-frame {
                        display: none !important;
                    }
                    .ytp-timely-actions-content ytw-timely-actions-overlay-view-model {
                        transform: translateY(-24px) !important;
                    }
                `,
            },
            mastheadStyle: {
                id: 'betterTheater-mastheadStyle',
                getRule: () =>
                    `#masthead-container.ytd-app { max-width: calc(100% - ${state.chatWidth}px) !important; }`,
            },
            lowMastheadStyle: {
                id: 'betterTheater-lowMastheadStyle',
                getRule: () => `
                    #page-manager.ytd-app {
                        margin-top: 0 !important;
                        top: calc(-1 * var(--ytd-toolbar-offset)) !important;
                        position: relative !important;
                    }
                    ytd-watch-flexy:not([full-bleed-player][full-bleed-no-max-width-columns]) #columns.ytd-watch-flexy {
                        margin-top: var(--ytd-toolbar-offset) !important;
                    }
                    #masthead-container.ytd-app {
                        z-index: 599 !important;
                        top: ${state.moviePlayerHeight}px !important;
                        position: relative !important;
                    }
                    tp-yt-iron-dropdown {
                        top: calc(var(--ytd-masthead-height-accounting-for-hidden) / 2) !important;
                    }
                `,
            },
            chatClampLimits: {
                id: 'betterTheater-chatClampLimits',
                getRule: () => {
                    const flexy = api.page.watchFlexy;
                    const originalWidth = '402px';
                    const originalMinWidth = '402px';

                    if (flexy) {
                        const style = window.getComputedStyle(flexy);
                        const fetchedWidth = style.getPropertyValue('--ytd-watch-flexy-sidebar-width')?.trim();
                        const fetchedMinWidth = style.getPropertyValue('--ytd-watch-flexy-sidebar-min-width')?.trim();
                        return `
                            ytd-live-chat-frame[theater-watch-while] {
                                min-width: ${CONFIG.MIN_CHAT_SIZE.width}px !important;
                                max-width: 33.33vw !important;
                            }
                            .ytd-watch-flexy {
                                --ytd-watch-flexy-sidebar-width: clamp(${
                                    CONFIG.MIN_CHAT_SIZE.width
                                }px, var(--bt-chat-width), 33.33vw) !important;
                                --ytd-watch-flexy-sidebar-min-width: clamp(${
                                    CONFIG.MIN_CHAT_SIZE.width
                                }px, var(--bt-chat-width), 33.33vw) !important;
                            }
                            ytd-watch-flexy[flexy] #secondary.ytd-watch-flexy {
                                --ytd-watch-flexy-sidebar-width: ${fetchedWidth ?? originalWidth} !important;
                                --ytd-watch-flexy-sidebar-min-width: ${fetchedMinWidth ?? originalMinWidth} !important;
                            }
                            ytd-watch-next-secondary-results-renderer {
                                --ytd-reel-item-compact-layout-width: calc((${fetchedWidth ?? originalWidth} - 8px) / 3) !important;
                                --ytd-reel-item-thumbnail-height: calc((${fetchedWidth ?? originalWidth} / 3 / 9 * 16)) !important;
                            }
                            ytd-live-chat-frame[theater-watch-while] yt-live-chat-renderer {
                                width: 100% !important; max-width: 100% !important;
                            }

                            /* bypass youtube's throttling of style calculations (makes reflow instant) */
                            ytd-watch-flexy[flexy] #secondary.ytd-watch-flexy {
                                width: var(--bt-chat-width) !important;
                                min-width: var(--bt-chat-width) !important;
                                max-width: var(--bt-chat-width) !important;
                            }
                            ytd-watch-flexy[flexy] #primary.ytd-watch-flexy {
                                /* force the video player side to perfectly flex around the chat */
                                flex: 1 1 0% !important;
                                min-width: 0 !important;
                                max-width: none !important;
                            }
                        `;
                    }
                    return '';
                },
            },
            tuckRecommendationStyles: {
                liveStyle: {
                    id: 'betterTheater-tuckRecommendationStreamStyle',
                    getRule: () => `
                        #columns.style-scope.ytd-watch-flexy {
                            flex-direction: column !important;
                        }
                        #secondary {
                            width: auto !important;
                            margin: 0 var(--ytd-watch-flexy-horizontal-page-margin) !important;
                        }
                        #teaser-carousel.ytd-watch-metadata {
                            width: auto !important;
                        }
                    `,
                },
                vodStyle: {
                    id: 'betterTheater-tuckRecommendationVodStyle',
                    getRule: () => `
                        #id.ytd-watch-metadata, #top-row.ytd-watch-metadata {
                            width: calc(100% + var(--ytd-watch-flexy-sidebar-width) + var(--ytd-watch-flexy-horizontal-page-margin)) !important;
                        }
                        #secondary:not(:has(ytd-playlist-panel-renderer)) {
                            transform: translateY(calc(var(--ytd-watch-flexy-top-padding) * 6)) !important;
                        }
                        #secondary:has(ytd-playlist-panel-renderer) {
                            transform: translateY(calc(var(--ytd-watch-flexy-top-padding) * 6.5 + 1px)) !important;
                        }
                    `,
                },
                videoStyle: {
                    id: 'betterTheater-tuckRecommendationVideoStyle',
                    getRule: () => `
                        #id.ytd-watch-metadata, #top-row.ytd-watch-metadata {
                            width: calc(100% + var(--ytd-watch-flexy-sidebar-width) + var(--ytd-watch-flexy-horizontal-page-margin)) !important;
                        }
                        #secondary:not(:has(ytd-playlist-panel-renderer)) {
                            transform: translateY(calc(var(--ytd-watch-flexy-top-padding) * 6)) !important;
                        }
                        #secondary:has(ytd-playlist-panel-renderer) {
                            transform: translateY(calc(var(--ytd-watch-flexy-top-padding) * 6.5 + 1px)) !important;
                        }
                    `,
                },
            },
        },
        apply(styleDef, isPersistent = false) {
            if (typeof styleDef.getRule !== 'function') return;

            const newCss = styleDef.getRule();
            let styleElement = document.getElementById(styleDef.id);

            if (styleElement) {
                if (styleElement.textContent === newCss) {
                    if (!state.activeStyles.has(styleDef.id)) {
                        state.activeStyles.set(styleDef.id, { element: styleElement, persistent: isPersistent });
                    }
                    return;
                }

                styleElement.textContent = newCss;
                return;
            }

            styleElement = document.createElement('style');
            styleElement.id = styleDef.id;
            styleElement.textContent = newCss;
            document.head.appendChild(styleElement);

            state.activeStyles.set(styleDef.id, { element: styleElement, persistent: isPersistent });
        },
        remove(styleDef) {
            const element = document.getElementById(styleDef.id);
            if (element) element.remove();
            state.activeStyles.delete(styleDef.id);
        },

        removeAll() {
            const styleIdsToRemove = [...state.activeStyles.keys()];
            styleIdsToRemove.forEach((styleId) => {
                const styleData = state.activeStyles.get(styleId);
                if (styleData && !styleData.persistent) {
                    this.remove({ id: styleId });
                }
            });
        },

        toggle(styleDef, condition) {
            condition ? this.apply(styleDef) : this.remove(styleDef);
        },
    };

    const StorageManager = {
        getValue: async (key, defaultValue) => {
            try {
                return await api.storage.load(CONFIG.STORAGE_PREFIX + key, defaultValue);
            } catch (error) {
                logError(`Failed to parse storage key "${key}"`, error);
                return null;
            }
        },
        setValue: async (key, value) => {
            try {
                await api.storage.save(CONFIG.STORAGE_PREFIX + key, value);
            } catch (error) {
                logError(`Failed to set storage key "${key}"`, error);
            }
        },
        deleteValue: async (key) => {
            await api.storage.delete(CONFIG.STORAGE_PREFIX + key);
        },
        listValues: async () => {
            const fullList = await api.storage.list();
            const filteredList = fullList
                .filter((key) => key.startsWith(CONFIG.STORAGE_PREFIX))
                .map((key) => key.substring(CONFIG.STORAGE_PREFIX.length));
            return filteredList;
        },
    };

    const SettingsManager = {
        async update(key, value) {
            try {
                const settings = await StorageManager.getValue('settings', CONFIG.DEFAULT_SETTINGS);
                settings[key] = value;
                await StorageManager.setValue('settings', settings);
                state.userSettings[key] = value;
            } catch (error) {
                logError(`Error updating setting: ${key}.`, error);
            }
        },
        async load() {
            try {
                const storedSettings = await StorageManager.getValue('settings', CONFIG.DEFAULT_SETTINGS);
                const newSettings = { ...CONFIG.DEFAULT_SETTINGS, ...storedSettings };
                state.userSettings = newSettings;
                if (Object.keys(storedSettings ?? {}).length !== Object.keys(newSettings).length) {
                    await StorageManager.setValue('settings', state.userSettings);
                }
            } catch (error) {
                logError('Error loading settings.', error);
                throw error;
            }
        },
        async cleanupStorage() {
            try {
                const allowedKeys = ['settings'];
                const keys = await StorageManager.listValues();
                for (const key of keys) {
                    if (!allowedKeys.includes(key)) {
                        await StorageManager.deleteValue(key);
                    }
                }
            } catch (error) {
                logError('Error cleaning up old storage.', error);
            }
        },
    };

    const MenuManager = {
        clear() {
            while (state.menuItems.length) GM.unregisterMenuCommand(state.menuItems.pop());
        },
        refresh() {
            this.clear();
            const shouldAutoClose = GM?.info?.scriptHandler === 'ScriptCat';
            const menuConfig = [
                {
                    label: () =>
                        `${state.userSettings.setLowMasthead ? '✅' : '❌'} ${MENU_LABELS.moveMastheadBelowVideoPlayer}`,
                    id: 'toggleLowMasthead',
                    action: () =>
                        SettingsManager.update('setLowMasthead', !state.userSettings.setLowMasthead).then(() =>
                            App.updateAllStyles(),
                        ),
                },
                {
                    label: () => `${state.userSettings.fullHeightVideo ? '✅' : '❌'} ${MENU_LABELS.fullHeightVideo}`,
                    id: 'toggleFullHeightVideo',
                    action: () =>
                        SettingsManager.update('fullHeightVideo', !state.userSettings.fullHeightVideo).then(() => {
                            App.updateVideoStyle();
                            GhostManager.update();
                        }),
                },
                {
                    label: () =>
                        `${state.userSettings.tuckRecommendation ? '✅' : '❌'} ${MENU_LABELS.tuckRecommendation}`,
                    id: 'toggleTuckRecommendation',
                    action: () =>
                        SettingsManager.update('tuckRecommendation', !state.userSettings.tuckRecommendation).then(
                            () => {
                                App.updateRecommendationTuckStyle();
                            },
                        ),
                },
                {
                    label: () =>
                        `${state.userSettings.alwaysShowQuickActions ? '✅' : '❌'} ${MENU_LABELS.alwaysShowQuickActions}`,
                    id: 'toggleAlwaysShowQuickActions',
                    action: () =>
                        SettingsManager.update(
                            'alwaysShowQuickActions',
                            !state.userSettings.alwaysShowQuickActions,
                        ).then(() => {
                            App.updateQuickActionStyle();
                        }),
                },
                {
                    label: () =>
                        `${state.userSettings.autoSwitchPlayerMode ? '✅' : '❌'} ${MENU_LABELS.autoSwitchPlayerMode}`,
                    id: 'toggleAutoSwitchPlayerMode',
                    action: () =>
                        SettingsManager.update('autoSwitchPlayerMode', !state.userSettings.autoSwitchPlayerMode).then(
                            () => {
                                requestAnimationFrame(() => App.updatePlayerMode());
                            },
                        ),
                },
            ];
            menuConfig.forEach((item) => {
                const commandId = GM.registerMenuCommand(
                    item.label(),
                    async () => {
                        await item.action();
                        this.refresh();
                    },
                    { id: item.id, autoClose: shouldAutoClose },
                );
                state.menuItems.push(commandId ?? item.id);
            });
        },
    };

    const ChatInteractionManager = {
        addChatWidthResizeHandle() {
            if (window.innerWidth / 3 <= CONFIG.MIN_CHAT_SIZE.width) return;
            const chat = api.chat.iFrame;
            if (!chat || chat.querySelector('#chat-width-resize-handle')) return;

            const storedWidth = state.userSettings.theaterChatWidth ?? `${CONFIG.MIN_CHAT_SIZE.width}px`;
            this._applyTheaterWidth(api.page.watchFlexy, chat, storedWidth);

            const handle = document.createElement('div');
            handle.id = 'chat-width-resize-handle';
            handle.className = 'style-scope ytd-live-chat-frame';
            Object.assign(handle.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '6px',
                height: '100%',
                cursor: 'ew-resize',
                zIndex: '10001',
            });
            chat.appendChild(handle);

            let startX = 0;
            let startWidth = 0;
            let animationFrame;

            const _onPointerMove = (e) => {
                if (!handle.hasPointerCapture(e.pointerId)) return;
                cancelAnimationFrame(animationFrame);
                animationFrame = requestAnimationFrame(() => {
                    const dx = startX - e.clientX;
                    const newWidth = Math.max(CONFIG.MIN_CHAT_SIZE.width, startWidth + dx);
                    this._applyTheaterWidth(api.page.watchFlexy, chat, `${newWidth}px`);
                });
            };

            const _onPointerUp = (event) => {
                handle.releasePointerCapture(event.pointerId);
                document.removeEventListener('pointermove', _onPointerMove);
                document.removeEventListener('pointerup', _onPointerUp);
                SettingsManager.update(
                    'theaterChatWidth',
                    api.page.watchFlexy?.style.getPropertyValue('--bt-chat-width'),
                );
            };

            handle.addEventListener('pointerdown', (event) => {
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                event.preventDefault();
                document.body.click(); // Deselect any text
                startX = event.clientX;
                startWidth = chat.getBoundingClientRect().width;
                handle.setPointerCapture(event.pointerId);
                document.addEventListener('pointermove', _onPointerMove);
                document.addEventListener('pointerup', _onPointerUp);
            });
        },
        _applyTheaterWidth(flexy, chat, widthCss) {
            if (flexy) flexy.style.setProperty('--bt-chat-width', widthCss);
            if (chat) {
                chat.style.width = widthCss;
                chat.style.zIndex = '1999';
            }
            window.dispatchEvent(new Event('resize')); // bypass youtube's throttling of style calculations
        },
        removeChatWidthResizeHandle() {
            api.chat.iFrame?.querySelector('#chat-width-resize-handle')?.remove();
            const flexy = api.page.watchFlexy;
            const chat = api.chat.iFrame;
            if (flexy) flexy.style.removeProperty('--bt-chat-width');
            if (chat) {
                chat.style.width = '';
                chat.style.zIndex = '';
            }
        },
    };

    const App = {
        init() {
            try {
                if (api.gmCapabilities.isMissing) throw new Error('Greasemonkey API not detected');
                Promise.all([SettingsManager.cleanupStorage(), SettingsManager.load()]).then(() => {
                    if (unsafeWindow.ytInitialData?.responseContext?.mainAppWebResponseContext?.loggedOut !== true)
                        GhostManager.init();
                    Object.values(StyleManager.styleDefinitions.staticStyles).forEach((style) =>
                        StyleManager.apply(style, true),
                    );
                    this._handlePageUpdate();
                    this.attachEventListeners();
                    MenuManager.refresh();
                    GhostManager.update();
                });
            } catch (error) {
                logError('Initialization failed.', error);
            }
        },
        _shouldApplyChatStyle() {
            const chatBox = api.chat.iFrame?.getBoundingClientRect();
            const flexy = api.page.watchFlexy;
            const isSecondaryVisible = flexy?.querySelector('#secondary')?.style.display !== 'none';
            return (
                api.player.isTheater &&
                !api.player.isFullscreen &&
                !api.chat.isCollapsed &&
                chatBox?.width > 0 &&
                isSecondaryVisible
            );
        },
        updatePlayerMode() {
            if (!state.userSettings.autoSwitchPlayerMode) return;

            const flexy = api.page.watchFlexy;
            if (!flexy) return;

            const computedStyles = window.getComputedStyle(flexy);
            const sidebarWidth = parseFloat(computedStyles.getPropertyValue('--ytd-watch-flexy-sidebar-width')) || 402;

            const miniGuide = document.querySelector('ytd-mini-guide-renderer');
            const guideWidth = miniGuide && miniGuide.offsetParent !== null ? miniGuide.offsetWidth : 72;

            // YouTube's Internal Player Minimum (tentative guess)
            // likely is `var x1o; x1o.dismissState = 540;` from https://www.youtube.com/s/_/ytmainappweb/_/js/k=ytmainappweb.kevlar_base.en_US.H6w3EUqm5ak.es5.O/am=AAAAIAAAMEA/d=1/br=1/rs=AGKMywHt_LEr-bY6FtHHqidcd6WjLRnBkw/m=kevlar_base_module,kevlar_main_module,kevlar_base_sync_mod_chunk (m=kevlar_base_module,kevlar_main_module,kevlar_base_sync_mod_chunk)
            // The absolute rock-bottom limit YouTube uses before snapping to a single column
            const YOUTUBE_INTERNAL_MIN_PLAYER_WIDTH = 540;

            const swapThreshold = guideWidth + YOUTUBE_INTERNAL_MIN_PLAYER_WIDTH + sidebarWidth; // tentative 1014px
            const currentWidth = window.innerWidth;

            if (currentWidth < swapThreshold && !state.autoSwitchedToNormal) {
                document.querySelector('ytd-watch-flexy #ytd-player button.ytp-size-button')?.click();
                state.autoSwitchedToNormal = true;
            } else if (currentWidth > swapThreshold && state.autoSwitchedToNormal) {
                document.querySelector('ytd-watch-flexy #ytd-player button.ytp-size-button')?.click();
                state.autoSwitchedToNormal = false;
            }
        },
        updateChatStyles() {
            const styles = StyleManager.styleDefinitions;
            const shouldStyle = this._shouldApplyChatStyle();
            StyleManager.toggle(styles.chatStyle, shouldStyle);
            StyleManager.toggle(styles.chatClampLimits, shouldStyle);

            shouldStyle ?
                ChatInteractionManager.addChatWidthResizeHandle()
            :   ChatInteractionManager.removeChatWidthResizeHandle();
            this.updateMastheadStyle(shouldStyle);
        },
        updateMastheadStyle(isChatStyled) {
            const styles = StyleManager.styleDefinitions;
            const updateLowMastheadStyle = () => {
                if (!DOM.moviePlayer) return;
                const shouldApply =
                    state.userSettings.setLowMasthead &&
                    api.player.isTheater &&
                    !api.player.isFullscreen &&
                    api.page.type === 'watch';
                StyleManager.toggle(styles.lowMastheadStyle, shouldApply);
            };

            if (isChatStyled === undefined) isChatStyled = this._shouldApplyChatStyle();
            updateLowMastheadStyle();

            const shouldShrinkMasthead = isChatStyled && api.chat.iFrame?.getAttribute('theater-watch-while') === '';

            state.chatWidth = api.chat.iFrame?.offsetWidth ?? 0;
            StyleManager.toggle(styles.mastheadStyle, shouldShrinkMasthead);
            DOM.moviePlayer?.setCenterCrop?.();
        },
        updateVideoStyle() {
            const shouldApply = state.userSettings.fullHeightVideo && api.player.isTheater;
            StyleManager.toggle(StyleManager.styleDefinitions.fullHeightPlayerStyle, shouldApply);
        },
        updateRecommendationTuckStyle() {
            const styles = StyleManager.styleDefinitions.tuckRecommendationStyles;
            Object.values(styles).forEach((style) => StyleManager.toggle(style, false));

            if (!state.userSettings.tuckRecommendation) return;
            if (!api.player.isTheater || api.player.isFullscreen || api.page.type !== 'watch') return;

            const isVod = api.video.wasStreamedOrPremiered;
            const canHaveChat = api.video.isLiveOrVodContent || isVod;
            const isCollapsed = !api.chat.container || !api.chat.iFrame || api.chat.isCollapsed; // TODO: Patch helper lib. YouTube can return chat state even when chat elements are missing.

            if (!canHaveChat || (isVod && isCollapsed)) return StyleManager.toggle(styles.videoStyle, true);
            if (!isCollapsed) return StyleManager.toggle(isVod ? styles.vodStyle : styles.liveStyle, true);
        },
        updateQuickActionStyle() {
            const styles = StyleManager.styleDefinitions.alwaysShowQuickActionsStyle;
            StyleManager.toggle(styles, state.userSettings.alwaysShowQuickActions);
        },
        updateAllStyles() {
            try {
                this.updateVideoStyle();
                this.updateChatStyles();
                this.updateRecommendationTuckStyle();
                this.updateQuickActionStyle();
                GhostManager.update();
            } catch (error) {
                logError('Error updating styles.', error);
            }
        },
        updateMoviePlayerObserver() {
            const newMoviePlayer = api.player.playerObject ?? document.querySelector('#movie_player');
            if (DOM.moviePlayer === newMoviePlayer) return;

            if (state.resizeObserver) state.resizeObserver.disconnect();
            state.resizeObserver = new ResizeObserver((entries) => {
                window.requestAnimationFrame(() => {
                    if (!Array.isArray(entries) || !entries.length) return;

                    const entry = entries[0];
                    if (Math.abs(state.moviePlayerHeight - entry.contentRect.height) > 1) {
                        state.moviePlayerHeight = entry.contentRect.height;
                        this.updateAllStyles();
                    }
                });
            });

            DOM.moviePlayer = newMoviePlayer;
            if (DOM.moviePlayer) state.resizeObserver.observe(DOM.moviePlayer);
        },
        updatePlayerParameters() {
            if (!api.page.watchFlexy) return state.wideModeMinWidth;
            const computedStyles = window.getComputedStyle(api.page.watchFlexy);
            const wideModeMinWidth = computedStyles
                .getPropertyValue('--ytd-watch-flexy-max-player-width-wide-screen')
                .trim();

            state.wideModeMinWidth = parseInt(wideModeMinWidth) || 0;
        },
        _handlePageUpdate() {
            try {
                this.updateMoviePlayerObserver();
                this.updatePlayerParameters();
                this.updateAllStyles();
            } catch (error) {
                logError('Error handling page update.', error);
            }
        },
        _handleResize() {
            try {
                if (this._resizeTimeout) return;
                this._resizeTimeout = setTimeout(() => {
                    requestAnimationFrame(() => this.updatePlayerMode());
                    this._resizeTimeout = null;
                }, 250);
            } catch (error) {
                logError('Error handling resize.', error);
            }
        },
        _handleFullscreenChange() {
            try {
                this.updateAllStyles();
            } catch (error) {
                logError('Error handling fullscreen change.', error);
            }
        },
        _handleTheaterChange() {
            try {
                this.updateAllStyles();
            } catch (error) {
                logError('Error handling theater change.', error);
            }
        },
        _handleChatStateUpdate() {
            try {
                this.updateAllStyles();
            } catch (error) {
                logError('Error handling chat state update.', error);
            }
        },
        _handlePageDataFetch() {
            try {
                this._handlePageUpdate();
            } catch (error) {
                logError('Error handling page data fetch.', error);
            }
        },
        attachEventListeners() {
            const events = {
                'yt-set-theater-mode-enabled': () => this._handleTheaterChange(),
                'yt-page-data-fetched': () => this._handlePageDataFetch(),
                'yt-page-data-updated': () => this._handlePageUpdate(),
                fullscreenchange: () => this._handleFullscreenChange(),
                'iron-resize': () => this._handleResize(),
            };

            for (const [event, handler] of Object.entries(events)) {
                window.addEventListener(event, handler, { capture: true, passive: true });
            }

            api.eventTarget.addEventListener(
                'yt-helper-api-chat-state-updated',
                this._handleChatStateUpdate.bind(this),
            );
            api.eventTarget.addEventListener('yt-helper-api-ready', () => {
                if (api.page.type === 'watch') {
                    this._handlePageUpdate();
                }
            });

            let isResizeScheduled = false;
            window.addEventListener('resize', () => {
                if (isResizeScheduled) return;
                isResizeScheduled = true;
                requestAnimationFrame(() => {
                    this.updateAllStyles();
                    isResizeScheduled = false;
                });
            });
        },
    };
    App.init();
})();
