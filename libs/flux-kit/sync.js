// ==UserScript==
// @name         FluxKit Sync
// @namespace    https://github.com/JYashu
// @version      1.1.0
// @description  Universal Cloud Storage & Sync Engine.
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

  if (typeof FluxKit === 'undefined' || !FluxKit.utils || !FluxKit.theme || !FluxKit.ui || !FluxKit.api) {
    console.error('FluxKit Scratchpad Error: Core FluxKit is missing. Please @require FluxKit/core.js before FluxKit/sync.js');
    return; 
  }

  FluxKit.sync ??= (function() {
    let onTokenRefreshCallback = null;
    const AllProviders = ['GitHub Gist', 'GitHub Repo', 'WebDAV', 'Dropbox', 'OneDrive'];

    const CAPABILITIES = {
      'Local': { 
        maxFileSize: 500 * 1024 * 1024, // 500MB (Browser Blob Limit)
        totalQuota: 5 * 1024 * 1024 * 1024, // 5GB 
        allowsNativeFiles: true, 
        allowsScreenshots: true, 
        requiresBatchedBase64: false 
      },
      'GitHub Gist': {
        maxFileSize: 0.95 * 1024 * 1024, totalQuota: 20 * 1024 * 1024,
        allowsNativeFiles: false, allowsScreenshots: true, requiresBatchedBase64: true
      },
      'GitHub Repo': {
        maxFileSize: 50 * 1024 * 1024, totalQuota: 1024 * 1024 * 1024,
        allowsNativeFiles: true, allowsScreenshots: true, requiresBatchedBase64: false
      },
      'WebDAV': {
        maxFileSize: 50 * 1024 * 1024, totalQuota: 500 * 1024 * 1024,
        allowsNativeFiles: true, allowsScreenshots: true, requiresBatchedBase64: false
      },
      'Dropbox': {
        maxFileSize: 150 * 1024 * 1024, totalQuota: 2 * 1024 * 1024 * 1024,
        allowsNativeFiles: true, allowsScreenshots: true, requiresBatchedBase64: false
      },
      'OneDrive': {
        maxFileSize: 250 * 1024 * 1024, totalQuota: 5 * 1024 * 1024 * 1024,
        allowsNativeFiles: true, allowsScreenshots: true, requiresBatchedBase64: false
      }
    };

    const { githubGist, githubRepo, webdav, dropbox, onedrive } = FluxKit.api;

    const Providers = {
      'GitHub Gist': {
        fetch: async (profile, options) => {
          const gistData = await githubGist.fetchGistFiles(profile.gistId, profile.token);
          if (options.filename && gistData.files) return { files: { [options.filename]: gistData.files[options.filename] } };
          return gistData;
        },
        upload: async (profile, filesToUpload, onProgress) => {
          for (const [filename, data] of Object.entries(filesToUpload)) {
            if (data.content instanceof Blob) {
              const buffer = await data.content.arrayBuffer();
              const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
              data.content = `data:${data.content.type};base64,${base64}`;
            }
          }

          const entries = Object.entries(filesToUpload);
          let currentBatch = {}, batchSize = 0;
          let lastFilename = '';

          for (const [name, data] of entries) {
            const size = data.content.length;
            if (batchSize + size > 5 * 1024 * 1024 && Object.keys(currentBatch).length > 0) {
              await githubGist.uploadDataToGistFile("bulk", profile.gistId, profile.token, { files: currentBatch }, true);
              if (onProgress) onProgress(lastFilename);
              currentBatch = {};
              batchSize = 0;
            }
            currentBatch[name] = data;
            batchSize += size;
            lastFilename = name;
          }

          if (Object.keys(currentBatch).length > 0) {
            await githubGist.uploadDataToGistFile("bulk", profile.gistId, profile.token, { files: currentBatch }, true);
            if (onProgress) onProgress(lastFilename);
          }
          return true;
        },
        delete: async (profile, filename) => {
          try {
            await githubGist.deleteFile(profile.gistId, profile.token, filename);
          } catch (e) {
            if (e.status === 422 || e.status === 404) return true;
            throw e;
          }
          return true;
        },
        handshake: async (data, options) => {
          if (!data.token || data.token.length < 10) throw new Error('Please enter a valid API token.');
          const isTokenValid = await githubGist.verifyCredentials(data.token);
          if (!isTokenValid) throw new Error('Invalid GitHub token.');

          if (!data.gistId || data.gistId.trim() === '') {
            data.gistId = await githubGist.createNewGist(data.token);
          } else {
            const isAccessValid = await githubGist.verifyGistAccess(data.token, data.gistId);
            if (!isAccessValid) throw new Error('Could not access Gist ID.');
          }
        }
      },
      'GitHub Repo': {
        fetch: async (profile, options) => {
          const namespace = profile.namespace || 'SyncData';
          const subFolder = profile.subFolder || '';
          const { owner, repo } = await githubRepo.ensureRepo(profile.token, namespace);

          if (options.filename) {
            const isText = options.filename.match(/\.(json|txt|md|csv|xml|js|css|html)$/i);
            const responseType = isText ? 'text' : 'blob';
            const fullPath = [subFolder, options.filename].filter(Boolean).join('/');

            const meta = await githubRepo.request('GET', `/repos/${owner}/${repo}/contents/${fullPath}`, profile.token);
            if (meta && meta.download_url) {
              const content = await githubRepo.request('GET', meta.download_url, profile.token, null, responseType);
              return { files: content ? { [options.filename]: { content } } : {} };
            }
            return { files: {} };
          }
          return await githubRepo.fetchAllFiles(profile.token, owner, repo, subFolder);
        },
        upload: async (profile, filesToUpload, onProgress) => {
          const namespace = profile.namespace || 'SyncData';
          const subFolder = profile.subFolder || '';
          const { owner, repo } = await githubRepo.ensureRepo(profile.token, namespace);

          const entries = Object.entries(filesToUpload);
          const CONCURRENCY_LIMIT = 1;

          for (let i = 0; i < entries.length; i += CONCURRENCY_LIMIT) {
            const chunk = entries.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(chunk.map(async ([filename, data]) => {
                try {
                  await githubRepo.uploadFile(profile.token, owner, repo, subFolder, filename, data.content);
                  if (onProgress) onProgress(filename);
                } catch (err) {
                  console.error("Batch upload failed for", filename);
                  throw err;
                }
              }
            ));
          }
          return true;
        },
        delete: async (profile, filename) => {
          const namespace = profile.namespace || 'SyncData';
          const subFolder = profile.subFolder || '';
          const safeRepoName = namespace.replace(/\s+/g, '-');

          const user = await githubRepo.request('GET', '/user', profile.token);
          if (!user) return true; // Auth failed, let it pass so queue drops it

          try {
            await githubRepo.deleteFile(profile.token, user.login, safeRepoName, subFolder, filename);
          } catch(e) {
            if (e.status === 404 || e.status === 409) return true; // Already deleted
            throw e;
          }
          return true;
        },
        handshake: async (data, options) => {
          if (!data.token || data.token.length < 10) throw new Error('API Token is required.');
          const isTokenValid = await githubGist.verifyCredentials(data.token);
          if (!isTokenValid) throw new Error('Invalid GitHub token.');

          if (options.namespace) data.namespace = options.namespace;
          if (!data.namespace) throw new Error('Repository Name is required.');
          if (!data.subFolder || data.subFolder.trim() === '') data.subFolder = options.defaultSubFolder || '';

          try {
            await githubRepo.ensureRepo(data.token, data.namespace);
          } catch (err) {
            throw new Error(`Failed to access/create repo: ${err.message}`);
          }
        }
      },
      'WebDAV': {
        fetch: async (profile, options) => {
          const namespace = profile.namespace || 'SyncData';
          const subFolder = profile.subFolder || '';
          const folderPath = [namespace, subFolder].filter(Boolean).join('/');
          const targetUrl = await webdav.ensureDirectory(profile.url, folderPath, profile.username, profile.password);
          if (options.filename) {
            const isText = options.filename.match(/\.(json|txt|md|csv|xml|js|css|html)$/i);
            const responseType = isText ? 'text' : 'blob';
            const content = await webdav.fetchFile(targetUrl, profile.username, profile.password, options.filename, responseType);
            return { files: content ? { [options.filename]: { content } } : {} };
          }
          return await webdav.fetchAllFiles(targetUrl, profile.username, profile.password);
        },
        upload: async (profile, filesToUpload, onProgress) => {
          const namespace = profile.namespace || '';
          const subFolder = profile.subFolder || '';
          const folderPath = [namespace, subFolder].filter(Boolean).join('/');
          const targetUrl = await webdav.ensureDirectory(profile.url, folderPath, profile.username, profile.password);

          const subDirs = new Set();
          for (const filename of Object.keys(filesToUpload)) {
            if (filename.includes('/')) {
              subDirs.add(filename.split('/').slice(0, -1).join('/'));
            }
          }
          for (const dir of subDirs) {
            await webdav.ensureDirectory(targetUrl, dir, profile.username, profile.password);
          }

          const entries = Object.entries(filesToUpload);
          const CONCURRENCY_LIMIT = 5;

          for (let i = 0; i < entries.length; i += CONCURRENCY_LIMIT) {
            const chunk = entries.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(chunk.map(async ([filename, data]) => {
                try {
                  await webdav.uploadFile(targetUrl, profile.username, profile.password, filename, data.content);
                  if (onProgress) onProgress(filename);
                } catch (err) {
                  console.error("Batch upload failed for", filename);
                  throw err;
                }
              }
            ));
          }
          return true;
        },
        delete: async (profile, filename) => {
          const namespace = profile.namespace || '';
          const subFolder = profile.subFolder || '';
          const folderPath = [namespace, subFolder].filter(Boolean).join('/');
          
          let targetUrl = profile.url.replace(/\/$/, '');
          if (folderPath) {
            targetUrl += '/' + folderPath.split('/').map(encodeURIComponent).join('/');
          }
          
          await webdav.deleteFile(targetUrl, profile.username, profile.password, filename);
          return true;
        },
        handshake: async (data, options) => {
          if (!data.url || !data.username || !data.password) throw new Error('URL, Username, and Password are required.');
          const isValid = await webdav.verifyCredentials(data.url, data.username, data.password);
          if (!isValid) throw new Error('WebDAV authentication failed. Check URL and credentials.');
          if (!data.subFolder || data.subFolder.trim() === '') data.subFolder = options.defaultSubFolder || '';
          data.namespace = options.namespace || '';
        }
      },
      'Dropbox': {
        ensureValidToken: async (profile) => {
          if (profile.token && profile.tokenExpiresAt && Date.now() < profile.tokenExpiresAt - 300000) {
            return profile.token;
          }
          if (!profile.refreshToken || !profile.appKey || !profile.appSecret) {
            throw new Error('Dropbox credentials missing. Please re-authenticate.');
          }

          const tokens = await dropbox.refreshAccessToken(profile.appKey, profile.appSecret, profile.refreshToken);
          profile.token = tokens.access_token;
          profile.tokenExpiresAt = Date.now() + (tokens.expires_in * 1000);

          if (typeof onTokenRefreshCallback === 'function') onTokenRefreshCallback(profile);

          return profile.token;
        },
        fetch: async (profile, options) => {
          const validToken = await Providers['Dropbox'].ensureValidToken(profile);
          const namespace = profile.namespace || 'UniversalNotes';
          const subFolder = profile.subFolder || '';
          const basePath = `/${namespace}${subFolder ? '/' + subFolder : ''}`.replace(/\/+/g, '/').replace(/\/$/, '');

          if (options.filename) {
            const isText = options.filename.match(/\.(json|txt|md|csv|xml|js|css|html)$/i);
            const filePath = `${basePath}/${options.filename}`.replace(/\/+/g, '/');
            const content = await dropbox.fetchFile(validToken, filePath, isText ? 'text' : 'blob');
            return { files: content !== null ? { [options.filename]: { content } } : {} };
          }
          return { files: await dropbox.fetchAllFiles(validToken, basePath) };
        },
        upload: async (profile, filesToUpload, onProgress) => {
          const validToken = await Providers['Dropbox'].ensureValidToken(profile);
          const namespace = profile.namespace || 'UniversalNotes';
          const subFolder = profile.subFolder || '';
          const basePath = `/${namespace}${subFolder ? '/' + subFolder : ''}`.replace(/\/+/g, '/').replace(/\/$/, '');

          const entries = Object.entries(filesToUpload);
          const CONCURRENCY_LIMIT = 4;

          for (let i = 0; i < entries.length; i += CONCURRENCY_LIMIT) {
            const chunk = entries.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(chunk.map(async ([filename, data]) => {
              const filePath = `${basePath}/${filename}`.replace(/\/+/g, '/');
              await dropbox.uploadFile(validToken, filePath, data.content);
              if (onProgress) onProgress(filename);
            }));
          }
          return true;
        },
        delete: async (profile, filename) => {
          const validToken = await Providers['Dropbox'].ensureValidToken(profile);
          const namespace = profile.namespace || 'UniversalNotes';
          const subFolder = profile.subFolder || '';
          const basePath = `/${namespace}${subFolder ? '/' + subFolder : ''}`.replace(/\/+/g, '/').replace(/\/$/, '');
          const filePath = `${basePath}/${filename}`.replace(/\/+/g, '/');
          await dropbox.deleteFile(validToken, filePath);
          return true;
        },
        handshake: async (data, options) => {
          data.appKey = (data.appKey || '').trim();
          data.appSecret = (data.appSecret || '').trim();
          data.authCode = (data.authCode || '').trim();

          if (!data.appKey || !data.appSecret) throw new Error('App Key and Secret are required.');

          if (!data.refreshToken) {
            if (!data.authCode) throw new Error('Please click Get Auth Code, authorize the app, and paste the code here.');
            const tokens = await dropbox.exchangeAuthCode(data.appKey, data.appSecret, data.authCode);
            data.refreshToken = tokens.refresh_token;
            data.token = tokens.access_token;
            data.tokenExpiresAt = Date.now() + (tokens.expires_in * 1000);
            data.authCode = '';
          }

          if (!data.token) await Providers['Dropbox'].ensureValidToken(data);

          if (options.namespace) data.namespace = options.namespace;
          if (!data.namespace) throw new Error('App Folder Name is required.');
          if (!data.subFolder || data.subFolder.trim() === '') data.subFolder = options.defaultSubFolder || '';
        }
      },
      'OneDrive': {
        ensureValidToken: async (profile) => {
          if (profile.token && profile.tokenExpiresAt && Date.now() < profile.tokenExpiresAt - 300000) {
            return profile.token;
          }
          if (!profile.refreshToken || !profile.appKey) {
            throw new Error('OneDrive credentials missing. Please re-authenticate.');
          }

          const tokens = await onedrive.refreshAccessToken(profile.appKey, profile.appSecret, profile.refreshToken);
          profile.token = tokens.access_token;
          profile.tokenExpiresAt = Date.now() + (tokens.expires_in * 1000);

          if (typeof onTokenRefreshCallback === 'function') onTokenRefreshCallback(profile);

          return profile.token;
        },
        fetch: async (profile, options) => {
          const validToken = await Providers['OneDrive'].ensureValidToken(profile);
          const namespace = profile.namespace || 'UniversalNotes';
          const subFolder = profile.subFolder || '';
          const basePath = `/${namespace}${subFolder ? '/' + subFolder : ''}`.replace(/\/+/g, '/').replace(/\/$/, '');

          if (options.filename) {
            const isText = options.filename.match(/\.(json|txt|md|csv|xml|js|css|html)$/i);
            const filePath = `${basePath}/${options.filename}`.replace(/\/+/g, '/');
            const content = await onedrive.fetchFile(validToken, filePath, isText ? 'text' : 'blob');
            return { files: content !== null ? { [options.filename]: { content } } : {} };
          }
          return { files: await onedrive.fetchAllFiles(validToken, basePath) };
        },
        upload: async (profile, filesToUpload, onProgress) => {
          const validToken = await Providers['OneDrive'].ensureValidToken(profile);
          const namespace = profile.namespace || 'UniversalNotes';
          const subFolder = profile.subFolder || '';
          const basePath = `/${namespace}${subFolder ? '/' + subFolder : ''}`.replace(/\/+/g, '/').replace(/\/$/, '');

          const entries = Object.entries(filesToUpload);
          const CONCURRENCY_LIMIT = 4;

          for (let i = 0; i < entries.length; i += CONCURRENCY_LIMIT) {
            const chunk = entries.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(chunk.map(async ([filename, data]) => {
              const filePath = `${basePath}/${filename}`.replace(/\/+/g, '/');
              await onedrive.uploadFile(validToken, filePath, data.content);
              if (onProgress) onProgress(filename);
            }));
          }
          return true;
        },
        delete: async (profile, filename) => {
          const validToken = await Providers['OneDrive'].ensureValidToken(profile);
          const namespace = profile.namespace || 'UniversalNotes';
          const subFolder = profile.subFolder || '';
          const basePath = `/${namespace}${subFolder ? '/' + subFolder : ''}`.replace(/\/+/g, '/').replace(/\/$/, '');
          const filePath = `${basePath}/${filename}`.replace(/\/+/g, '/');
          await onedrive.deleteFile(validToken, filePath);
          return true;
        },
        handshake: async (data, options) => {
          data.appKey = (data.appKey || '').trim();
          data.appSecret = (data.appSecret || '').trim();

          if (!data.appKey) throw new Error('Client ID (App Key) is required.');

          if (!data.refreshToken) {
            let authCode = (data.authCode || '').trim();
            if (authCode.includes('code=')) {
              authCode = new URL(authCode).searchParams.get('code') || authCode;
            }
            if (!authCode) throw new Error('Please click Get Auth Code, sign in, and paste the resulting localhost URL (or just the code) here.');

            const tokens = await onedrive.exchangeAuthCode(data.appKey, data.appSecret, authCode);
            if (!tokens.refresh_token) throw new Error('OneDrive did not provide an offline token. Ensure you checked "offline_access" in Azure.');

            data.refreshToken = tokens.refresh_token;
            data.token = tokens.access_token;
            data.tokenExpiresAt = Date.now() + (tokens.expires_in * 1000);
            data.authCode = '';
          }

          if (!data.token) await Providers['OneDrive'].ensureValidToken(data);

          if (options.namespace) data.namespace = options.namespace;
          if (!data.namespace) throw new Error('App Folder Name is required.');
          if (!data.subFolder || data.subFolder.trim() === '') data.subFolder = options.defaultSubFolder || '';
        }
      }
    };

    function getCapabilities(profile) {
      const provider = profile?.provider || 'Local';
      const defaults = CAPABILITIES[provider] || CAPABILITIES['Local'];
      return {
        ...defaults,
        maxFileSize: profile?.maxFileSize || defaults.maxFileSize,
        totalQuota: profile?.totalQuota || defaults.totalQuota
      };
    }

    function isConfigured(profile) {
      if (!profile) return false;
      if (profile.provider === 'WebDAV') return !!(profile.url && profile.username && profile.password);
      if (profile.provider === 'Dropbox' || profile.provider === 'OneDrive') return !!(profile.refreshToken && profile.appKey);
      if (profile.provider === 'GitHub Repo') return !!(profile.token && profile.namespace);
      return !!profile.token;
    }

    function handleApiError(err, provider) {
      console.error(`[${provider}] Sync Error:`, err);
      if (err.status === 401 || err.status === 403) return new Error('AUTH_EXPIRED');
      if (err.status === 503 || err.status === 504) return new Error('SERVER_DOWN');
      return new Error(`Sync failed: ${err.message || 'Unknown error'}`);
    }

    async function fetch(profile, options = {}) {
      if (!profile) throw new Error("No profile provided");
      const provider = profile.provider || 'Local';
      if (!Providers[provider]) throw new Error(`Unknown provider: ${provider}`);
      try {
        return await Providers[provider].fetch(profile, options);
      } catch (err) {
        throw handleApiError(err, provider);
      }
    }

    async function upload(profile, payload, defaultFilename = "data.json", onProgress) {
      if (!profile) throw new Error("No profile provided");
      const provider = profile.provider || 'Local';
      const handler = Providers[provider];
      if (!handler) throw new Error(`Unknown provider: ${provider}`);
      const limits = getCapabilities(profile);

      let filesToUpload = payload;
      const isComplexFormat = Object.values(payload).some(val => val && typeof val === 'object' && val.content !== undefined);

      if (!isComplexFormat) {
        if (payload instanceof Blob) {
          filesToUpload = { [defaultFilename]: { content: payload } };
        } else {
          filesToUpload = {
            [defaultFilename]: { content: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }
          };
        }
      }

      let totalBytes = 0;
      for (const data of Object.values(filesToUpload)) {
        totalBytes += new Blob([data.content]).size;
      }

      if (totalBytes > limits.totalQuota) {
        const mb = (totalBytes / 1024 / 1024).toFixed(2);
        const limitMb = (limits.totalQuota / 1024 / 1024).toFixed(0);
        throw new Error(`QUOTA_EXCEEDED: Payload is ${mb}MB. Maximum for ${provider} is ${limitMb}MB.`);
      }

      try {
        return await handler.upload(profile, filesToUpload, onProgress);
      } catch (err) {
        throw handleApiError(err, provider);
      }
    }

    async function deleteAsset(profile, filename) {
      if (!profile) throw new Error("No profile provided");
      const provider = profile.provider || 'Local';
      const handler = Providers[provider];
      
      if (!handler || !handler.delete) {
        throw new Error(`Unknown provider or delete not supported: ${provider}`);
      }

      try {
        return await handler.delete(profile, filename);
      } catch (err) {
        throw handleApiError(err, provider);
      }
    }

    class Editor {
      constructor(target, profile, options, onComplete) {
        this.target = target;
        this.profile = { ...profile };
        this.data = { ...profile };
        this.options = options || {};
        this.onComplete = onComplete;

        this.layout = this.options.layout === 'vertical' ? 'vertical' : 'horizontal';

        this.themeConfig = {
          autoDark: !(options.theme && options.theme.darkMode !== undefined),
          fontFamily: 'system-ui, sans-serif',
          borderRadius: '6px',
          gap: '12px',
          inputPad: '8px',
          labelWeight: '500',
          fontSize: '14px',
          ...(options.theme || {})
        };

        this._themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this._onSystemThemeChange = (e) => {
          if (!this.themeConfig.autoDark) return;
          this._injectStyles();
        };
        this._themeMediaQuery.addEventListener('change', this._onSystemThemeChange);
      }

      _injectStyles() {
        const isDark = this.themeConfig.autoDark ? FluxKit.theme.isSiteDark(this.target) : !!this.themeConfig.darkMode;
        const theme = FluxKit.theme.get(isDark);

        const renderTheme = {
          bg: this.themeConfig.bg || theme.bg,
          text: this.themeConfig.text || theme.text,
          inputBg: this.themeConfig.inputBg || theme.accentBg,
          font: this.themeConfig.fontFamily || 'system-ui, sans-serif',
          accentBg: this.themeConfig.accentBg || (isDark ? '#4F46E5' : '#5C7CFA'),
          btnText: this.themeConfig.btnTextColor || '#ffffff',
          radius: this.themeConfig.borderRadius || '6px',
          border: this.themeConfig.border || theme.border,
          gap: this.themeConfig.gap || '12px',
          inputPad: this.themeConfig.inputPad || '8px',
          labelWeight: this.themeConfig.labelWeight || '600',
          fontSize: this.themeConfig.fontSize || '13px'
        };

        const styleContent = `
          .flx-wiz-root {
            --wiz-bg: ${renderTheme.bg};
            --wiz-text: ${renderTheme.text};
            --wiz-input-bg: ${renderTheme.inputBg};
            --wiz-font: ${renderTheme.font};
            --wiz-accent: ${renderTheme.accentBg};
            --wiz-btn-text: ${renderTheme.btnText};
            --wiz-radius: ${renderTheme.radius};
            --wiz-border: ${renderTheme.border};
            --wiz-gap: ${renderTheme.gap};
            --wiz-input-pad: ${renderTheme.inputPad};
            --wiz-label-weight: ${renderTheme.labelWeight};
            --wiz-font-size: ${renderTheme.fontSize};
          }
          .flx-wiz-wrapper { padding: 0; width: 100%; font-family: var(--wiz-font); color: var(--wiz-text); font-size: var(--wiz-font-size); }
          .flx-wiz-btn {
            display: block; margin-bottom: var(--wiz-input-pad); padding: 10px;
            background: var(--wiz-accent); color: var(--wiz-btn-text);
            border: none; border-radius: var(--wiz-radius); cursor: pointer;
            transition: opacity 0.2s, transform 0.1s;
          }
          .flx-wiz-input {
            margin-bottom: var(--wiz-input-pad); border-radius: 4px; box-sizing: border-box;
            background: var(--wiz-input-bg); border: 1px solid var(--wiz-border);
            color: var(--wiz-text); font-family: inherit; width: 100%;
          }
          .flx-wiz-form-row, .flx-wiz-folder-row { var(--wiz-gap); }
          .flx-wiz-form-label { text-align: left; font-size: inherit; font-weight: var(--wiz-label-weight); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .flx-wiz-folder-container { display: flex; align-items: center; gap: calc(var(--wiz-gap) / 2); }
          .flx-wiz-folder-prefix { font-size: inherit; opacity: 0.6; white-space: nowrap; }
          .layout-horizontal .flx-wiz-form-row,
          .layout-horizontal .flx-wiz-folder-row {
            display: grid;
            grid-template-columns: 110px 1fr;
            align-items: center;
            gap: var(--wiz-gap);
          }
          .layout-horizontal .flx-wiz-form-label { margin-bottom: 0; }
          .layout-vertical .flx-wiz-form-row,
          .layout-vertical .flx-wiz-folder-row {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: calc(var(--wiz-gap) / 2);
          }
          .layout-vertical .flx-wiz-folder-container { width: 100%; }
        `;

        let styleEl = this.target.querySelector('#flx-wiz-styles');
        if (!styleEl) {
          styleEl = FluxKit.utils.createHTMLElement('style', { id: 'flx-wiz-styles' });
          this.target.appendChild(styleEl);
        }
        styleEl.textContent = styleContent;
      }

      updateTheme(newTheme) {
        if (newTheme.darkMode !== undefined) this.themeConfig.autoDark = false;
        this.themeConfig = { ...this.themeConfig, ...newTheme };
        this._injectStyles();
      }

      destroy() {
        this._themeMediaQuery.removeEventListener('change', this._onSystemThemeChange);
      }

      render(container) {
        if (container) this.containerRef = container;
        this._injectStyles();

        container.innerHTML = FluxKit.utils.safeHTML ? FluxKit.utils.safeHTML('') : '';
        const wrapper = FluxKit.utils.createHTMLElement('div', { class: `flx-wiz-wrapper layout-${this.layout}` });

        const root = FluxKit.utils.createHTMLElement('div', { class: 'flx-wiz-root' });
        root.appendChild(wrapper);

        const p = this.data.provider;

        if (p) {
          const headerChildren = [
            FluxKit.utils.createHTMLElement('h4', { textContent: p, style: 'margin: 0; font-size: 15px;' })
          ];

          const linkContainer = FluxKit.utils.createHTMLElement('div', {
            style: 'display: flex; gap: 16px; align-items: center;'
          });

          const ns = this.options.namespace || this.data.namespace || '';
          const sub = this.data.subFolder || '';
          let folderUrl = null;

          if (p === 'GitHub Gist' && this.data.gistId) {
            folderUrl = `https://gist.github.com/${this.data.gistId}`;
          } else if (p === 'Dropbox' && ns) {
            folderUrl = `https://www.dropbox.com/home/Apps/${encodeURIComponent(ns)}/${encodeURIComponent(sub)}`.replace(/\/+$/, '');
          } else if (p === 'GitHub Repo' && ns.includes('/')) {
            folderUrl = `https://github.com/${ns}/tree/main/${sub}`.replace(/\/+$/, '');
          } else if (p === 'OneDrive') {
            folderUrl = 'https://onedrive.live.com/';
          }

          const linkStyle = 'color: var(--wiz-text); opacity: 0.7; text-decoration: none; display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; line-height: 1; transition: all 0.2s;';
          const linkHTML = (label) => `<span>${label}</span><span style="display: flex; margin-top: -1px;">${FluxKit.ui.icons.externalLink}</span>`;

          if (folderUrl) {
            linkContainer.appendChild(FluxKit.utils.createHTMLElement('a', {
              href: folderUrl, target: '_blank', rel: 'noopener noreferrer',
              style: linkStyle, innerHTML: linkHTML('Files'),
              eventListener: {
                mouseover: function() { this.style.opacity = '1'; this.style.color = 'var(--wiz-accent)'; },
                mouseout: function() { this.style.opacity = '0.7'; this.style.color = 'var(--wiz-text)'; }
              }
            }));
          }

          const providerLinks = {
            'GitHub Gist': 'https://github.com/settings/tokens',
            'GitHub Repo': 'https://github.com/settings/tokens',
            'Dropbox': 'https://www.dropbox.com/developers/apps',
            'OneDrive': 'https://go.microsoft.com/fwlink/?linkid=2083908'
          };

          const pLink = providerLinks[p];
          if (pLink) {
            linkContainer.appendChild(FluxKit.utils.createHTMLElement('a', {
              href: pLink, target: '_blank', rel: 'noopener noreferrer',
              style: linkStyle, innerHTML: linkHTML('Settings'),
              eventListener: {
                mouseover: function() { this.style.opacity = '1'; this.style.color = 'var(--wiz-accent)'; },
                mouseout: function() { this.style.opacity = '0.7'; this.style.color = 'var(--wiz-text)'; }
              }
            }));
          }

          // Only append the container if it actually has links (protects WebDAV)
          if (linkContainer.childNodes.length > 0) {
            headerChildren.push(linkContainer);
          }

          wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
            style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--wiz-border); padding-bottom: 10px;',
            children: headerChildren
          }));
        }

        const addLabeledInput = (labelText, fieldKey, isPassword, tooltip) => {
          const input = FluxKit.utils.createHTMLElement('input', {
            class: 'flx-wiz-input', type: isPassword ? 'password' : 'text',
            value: this.data[fieldKey] || '',
            eventListener: { input: (e) => this.data[fieldKey] = e.target.value }
          });
          if (tooltip) input.dataset.tooltip = tooltip;

          wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
            class: 'flx-wiz-form-row',
            children: [
              FluxKit.utils.createHTMLElement('div', { class: 'flx-wiz-form-label', textContent: labelText }),
              input
            ]
          }));
        };

        const addFolderRow = (labelText) => {
          const lockedNs = this.options.namespace;
          const input = FluxKit.utils.createHTMLElement('input', {
            class: 'flx-wiz-input', type: 'text',
            value: this.data.subFolder || '', placeholder: this.data.subFolder || 'Leave blank for root',
            eventListener: { input: (e) => { this.data.subFolder = e.target.value }}
          });

          const children = [];
          if (lockedNs) children.push(FluxKit.utils.createHTMLElement('span', { class: 'flx-wiz-folder-prefix', textContent: `${lockedNs} /` }));
          children.push(input);

          wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
            class: 'flx-wiz-folder-row',
            children: [
              FluxKit.utils.createHTMLElement('div', { class: 'flx-wiz-form-label', textContent: labelText }),
              FluxKit.utils.createHTMLElement('div', { class: 'flx-wiz-folder-container', children })
            ]
          }));
        };

        if (p === 'WebDAV') {
          addLabeledInput('WebDAV URL', 'url', false);
          addLabeledInput('Username', 'username', false);
          addLabeledInput('App Password', 'password', true);
          addFolderRow('Directory');

          const defaultLimits = CAPABILITIES['WebDAV'];
          const fileMB = this.data.maxFileSize ? (this.data.maxFileSize / 1024 / 1024) : (defaultLimits.maxFileSize / 1024 / 1024);
          const quotaMB = this.data.totalQuota ? (this.data.totalQuota / 1024 / 1024) : (defaultLimits.totalQuota / 1024 / 1024);

          const fileInput = FluxKit.utils.createHTMLElement('input', { class: 'flx-wiz-input', type: 'number', value: fileMB, style: 'margin:0;' });
          const quotaInput = FluxKit.utils.createHTMLElement('input', { class: 'flx-wiz-input', type: 'number', value: quotaMB, style: 'margin:0;' });

          fileInput.addEventListener('input', (e) => { const val = parseInt(e.target.value, 10); if (!isNaN(val)) this.data.maxFileSize = val * 1024 * 1024; });
          quotaInput.addEventListener('input', (e) => { const val = parseInt(e.target.value, 10); if (!isNaN(val)) this.data.totalQuota = val * 1024 * 1024; });

          wrapper.appendChild(FluxKit.utils.createHTMLElement('details', {
            style: 'margin-top: 12px; font-size: 13px; background: rgba(128,128,128,0.05); border: 1px solid var(--wiz-border-subtle); padding: 12px; border-radius: var(--wiz-radius);',
            children: [
              FluxKit.utils.createHTMLElement('summary', { textContent: 'Advanced Storage Limits', style: 'cursor: pointer; font-weight: 600;' }),
              FluxKit.utils.createHTMLElement('div', { style: 'margin: 8px 0; opacity: 0.8; font-size: 11px;', textContent: 'Warning: Increasing chunk size above 50MB may cause browser memory crashes.' }),
              FluxKit.utils.createHTMLElement('label', { class: 'flx-wiz-form-row', children: [ FluxKit.utils.createHTMLElement('div', { class: 'flx-wiz-form-label', textContent: 'Max File Size (MB)' }), fileInput ] }),
              FluxKit.utils.createHTMLElement('label', { class: 'flx-wiz-form-row', children: [ FluxKit.utils.createHTMLElement('div', { class: 'flx-wiz-form-label', textContent: 'Total Quota (MB)' }), quotaInput ] })
            ]
          }));
        } else if (p === 'Dropbox') {
          addLabeledInput('App Key', 'appKey', false);
          addLabeledInput('App Secret', 'appSecret', true);
          addFolderRow('App Folder');
        } else if (p === 'OneDrive') {
          addLabeledInput('Client ID', 'appKey', false);
          addLabeledInput('Client Secret', 'appSecret', true);
          addFolderRow('Root Folder');
        } else if (p === 'GitHub Repo') {
          addLabeledInput('Access Token', 'token', true);
          addFolderRow('Repository');
        } else {
          addLabeledInput('Gist ID', 'gistId', false);
          addLabeledInput('Access Token', 'token', true);
        }

        if (this.options.customElements) {
          wrapper.appendChild(this.options.customElements);
        }

        container.appendChild(root);
        return this;
      }
    }

    class Wizard {
      constructor(target, options, onComplete) {
        this.target = target;
        this.options = options || {};
        this.onComplete = onComplete;
        this.allowedProviders = (this.options.providers && Array.isArray(this.options.providers) && this.options.providers.length > 0)
          ? this.options.providers.filter(p => AllProviders.includes(p))
          : AllProviders;
        if (this.allowedProviders.length === 0) this.allowedProviders = AllProviders;
        this.step = 1;
        this.data = { provider: null, token: '', gistId: '', subFolder: '' };
        this.error = null;
        this.loading = false;

        this.themeConfig = {
          autoDark: !(options.theme && options.theme.darkMode !== undefined),
          fontFamily: 'system-ui, sans-serif',
          borderRadius: '6px',
          ...(options.theme || {})
        };

        this._themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this._onSystemThemeChange = (e) => {
          if (!this.themeConfig.autoDark) return;
          this._injectStyles();
        };
        this._themeMediaQuery.addEventListener('change', this._onSystemThemeChange);
      }

      _injectStyles() {
        const isDark = this.themeConfig.autoDark ? FluxKit.theme.isSiteDark(this.target) : !!this.themeConfig.darkMode;
        const theme = FluxKit.theme.get(isDark);

        const renderTheme = {
          bg: this.themeConfig.bg || theme.bg,
          text: this.themeConfig.text || theme.text,
          inputBg: this.themeConfig.inputBg || theme.accentBg,
          font: this.themeConfig.fontFamily,
          accentBg: this.themeConfig.accentBg || (isDark ? '#4F46E5' : '#5C7CFA'),
          accentText: this.themeConfig.accentText || (isDark ? '#818CF8' : '#4F46E5'),
          btnText: this.themeConfig.btnTextColor || '#ffffff',
          radius: this.themeConfig.borderRadius,
          border: this.themeConfig.border || theme.border,
          borderSubtle: this.themeConfig.borderSubtle || theme.separator,
          chipBg: this.themeConfig.chipBg || theme.hoverBg,
          chipShadow: theme.boxShadow
        };

        FluxKit.ui.initTooltips({  ...theme, ...renderTheme, rootElement: this.target.getRootNode(), attribute: 'data-fxksw-tooltip' });

        const glassBg = renderTheme.bg.length === 7 ? renderTheme.bg + 'E6' : renderTheme.bg;

        const styleString = `
          .flx-wiz-root {
            --wiz-bg: ${glassBg};
            --wiz-text: ${renderTheme.text};
            --wiz-input-bg: ${renderTheme.inputBg};
            --wiz-font: ${renderTheme.font};
            --wiz-accent-bg: ${renderTheme.accentBg};
            --wiz-accent-text: ${renderTheme.accentText};
            --wiz-accent-text-hover: ${renderTheme.accentText}${isDark ? 'cc' : 'dd'};
            --wiz-btn-text: ${renderTheme.btnText};
            --wiz-radius: ${renderTheme.radius};
            --wiz-border: ${renderTheme.border};
            --wiz-border-subtle: ${renderTheme.borderSubtle};
            --wiz-chip-bg: ${renderTheme.chipBg};
            --wiz-chip-hover-shadow: ${renderTheme.chipShadow};

            background: var(--wiz-bg);
            color: var(--wiz-text);
            font-family: var(--wiz-font);
            backdrop-filter: blur(10px) saturate(180%);
            -webkit-backdrop-filter: blur(10px) saturate(180%);
            border: 1px solid var(--wiz-border);
            border-radius: 8px;
          }

          .flx-wiz-wrapper {
            font-family: var(--wiz-font);
            color: var(--wiz-text);
            padding: 10px;
          }
          .flx-wiz-btn-wrapper {
            flex: 0 0 auto; display: flex; justify-content: start;
            gap: 8px; text-align: right; margin-top: 15px;
          }
          .flx-wiz-btn {
            display: block; margin-bottom: 8px; padding: 10px;
            background: var(--wiz-accent-bg); color: var(--wiz-btn-text);
            border: none; border-radius: var(--wiz-radius); cursor: pointer;
            transition: opacity 0.2s, transform 0.1s;
          }
          .flx-wiz-btn:hover { opacity: 0.9; }
          .flx-wiz-btn:active { transform: scale(0.98); }
          .flx-wiz-input {
            width: 100%; margin: 8px 0; padding: 8px;
            border-radius: 4px; box-sizing: border-box;
            background: var(--wiz-input-bg);
            border: 1px solid var(--wiz-border);
            color: var(--wiz-text);
            font-family: inherit;
          }
          .flx-wiz-input:focus {
            outline: 2px solid var(--wiz-accent-bg);
            border-color: transparent;
          }
          .flx-wiz-provider-chips {
            display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;
          }
          .flx-wiz-provider-chip {
            display: flex; align-items: center; gap: 6px; padding: 6px 14px;
            background: var(--wiz-chip-bg);
            border: 1px solid var(--wiz-border-subtle);
            border-radius: 20px; cursor: pointer;
            transition: all 0.2s ease;
            font-size: 13px; font-weight: 500; white-space: nowrap;
          }
          .flx-wiz-provider-chip:hover {
            background: var(--wiz-chip-bg);
            border-color: var(--wiz-accent-bg);
            transform: translateY(-1px);
            box-shadow: var(--wiz-chip-hover-shadow);
          }
          .flx-wiz-provider-chip-icon { font-size: 14px; }

          .flx-wiz-link {
            color: var(--wiz-accent-text);
            text-decoration: none;
            font-weight: bold;
          }
          .flx-wiz-link:hover {
            color: var(--wiz-accent-text-hover);
            text-decoration: underline;
          }

          .flx-wiz-error { color: #ff4757; font-size: 12px; margin-bottom: 8px; }
          .flx-wiz-success { color: #2ecc71; font-weight: bold; font-size: 12px; margin-bottom: 12px; }
          .flx-wiz-hint { font-size: 11px; opacity: 0.8; }
          .flx-wiz-label { font-size: 12px; opacity: 0.7; margin-bottom: 12px; }
        `;

        let styleEl = this.target.querySelector('#flx-wiz-styles');
        if (!styleEl) {
          styleEl = FluxKit.utils.createHTMLElement('style', { id: 'flx-wiz-styles' });
          this.target.appendChild(styleEl);
        }
        styleEl.textContent = styleString;
      }

      updateTheme(newTheme) {
        if (newTheme.darkMode !== undefined) this.themeConfig.autoDark = false;
        this.themeConfig = { ...this.themeConfig, ...newTheme };
        this._injectStyles();
      }

      destroy() {
        this._themeMediaQuery.removeEventListener('change', this._onSystemThemeChange);
      }

      async validateAndSave() {
        this.loading = true;
        this.error = null;
        this.render(this.containerRef);

        try {
          await Providers[this.data.provider].handshake(this.data, this.options);
          this.loading = false;
          this.onComplete(this.data);
        } catch (e) {
          this.error = e.message;
          this.loading = false;
          this.render(this.containerRef);
        }
      }

      render(container) {
        if (container) this.containerRef = container;

        this._injectStyles();

        container.innerHTML = FluxKit.utils.safeHTML ? FluxKit.utils.safeHTML('') : '';
        const wrapper = FluxKit.utils.createHTMLElement('div', { class: 'flx-wiz-wrapper' });

        const root = FluxKit.utils.createHTMLElement('div', { class: 'flx-wiz-root' });
        root.appendChild(wrapper);

        if (this.error) {
          wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
            style: 'color: #ff4757; font-size: 12px; margin-bottom: 8px;',
            textContent: this.error
          }));
        }

        if (this.step === 1 && this.allowedProviders.length === 1) {
          this.data.provider = this.allowedProviders[0];
          this.step = 2;
        }

        if (this.step === 1) this.renderProviderStep(wrapper);
        else if (this.step === 2) this.renderConfigStep(wrapper);

        container.appendChild(root);
        return this;
      }

      renderProviderStep(wrapper) {
        wrapper.appendChild(FluxKit.utils.createHTMLElement('h4', {
          textContent: 'Select Storage',
          style: 'margin-bottom: 4px; margin-top: 0;'
        }));

        wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
          style: 'font-size: 12px; opacity: 0.7; margin-bottom: 12px;',
          textContent: 'Choose where you want to securely sync your data.'
        }));

        const providerIcons = {
          'GitHub Gist': '📝', 'GitHub Repo': '🗂️', 'WebDAV': '☁️',
          'Dropbox': '📦', 'OneDrive': '📁'
        };

        const layout = this.options.providerLayout || 'chips';

        if (layout === 'dropdown') {
          const select = FluxKit.utils.createHTMLElement('select', {
            class: 'flx-wiz-input',
            style: 'cursor: pointer;'
          });

          this.allowedProviders.forEach(p => {
            const option = FluxKit.utils.createHTMLElement('option', {
              value: p,
              textContent: `${providerIcons[p] || '🔌'} ${p}`
            });
            select.appendChild(option);
          });
          wrapper.appendChild(select);

          wrapper.appendChild(FluxKit.utils.createHTMLElement('button', {
            class: 'flx-wiz-btn',
            style: 'width: 100%; margin-top: 12px;',
            textContent: 'Next',
            eventListener: () => {
              this.data.provider = select.value;
              this.step = 2;
              this.render(this.containerRef);
            }
          }));
        } else {
          const chipContainer = FluxKit.utils.createHTMLElement('div', { class: 'flx-wiz-provider-chips' });

          this.allowedProviders.forEach(p => {
            const icon = providerIcons[p] || '🔌';

            const chip = FluxKit.utils.createHTMLElement('div', {
              class: 'flx-wiz-provider-chip',
              eventListener: {
                click: () => {
                  this.data.provider = p;
                  this.step = 2;
                  this.render(this.containerRef);
                }
              },
              children: [
                FluxKit.utils.createHTMLElement('span', { class: 'flx-wiz-provider-chip-icon', textContent: icon }),
                FluxKit.utils.createHTMLElement('span', { textContent: p })
              ]
            });

            chipContainer.appendChild(chip);
          });

          wrapper.appendChild(chipContainer);
        }
      }

      renderConfigStep(wrapper) {
        wrapper.appendChild(FluxKit.utils.createHTMLElement('h4', { textContent: `Setup ${this.data.provider}` }));

        const setupGuidePopover = (popoverDetails, title = '') => {
          const hintWrapper = FluxKit.utils.createHTMLElement('div', {
            style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;'
          });
          hintWrapper.appendChild(FluxKit.utils.createHTMLElement('span', {
            style: 'font-size: 11px; opacity: 0.8;',
            innerHTML: title || '',
          }));
          hintWrapper.appendChild(FluxKit.utils.createHTMLElement('span', {
            innerHTML: `<span style="display: flex; margin-top: -1px;">${FluxKit.ui.icons.info}</span><span>Setup Guide</span>`,
            style: 'cursor: help; color: var(--wiz-text); opacity: 0.7; text-decoration: none; display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; line-height: 1; transition: all 0.2s;',
            fxkswPopover: `${popoverDetails}`,
            eventListener: {
               mouseover: function() { this.style.opacity = '1'; this.style.color = 'var(--wiz-accent-bg)'; },
               mouseout: function() { this.style.opacity = '0.7'; this.style.color = 'var(--wiz-text)'; }
            }
          }));
          return hintWrapper;
        };

        const getExtLink = (url, label, title) => {
          return `<a href="${url}" data-popup="${title || label}" style="color: var(--wiz-accent-bg); text-decoration: none; font-weight: bold; display: inline-flex; align-items: center; gap: 2px;">${label} <span style="display: flex; margin-top: -2px; transform: scale(0.8); opacity: 0.7;">${FluxKit.ui.icons.externalLink}</span></a>`;
        }

        if (this.data.provider === 'GitHub Gist') {
          const setupDetails = `
            <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px; border-bottom: 1px solid rgba(128,128,128,0.2); padding-bottom: 6px;">GitHub Gist Setup</div>
            <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-weight: normal;">
              <li>Go to ${getExtLink('https://github.com/settings/tokens', 'GitHub Tokens')}.</li>
              <li>Click <b>Generate new token (classic)</b>.</li>
              <li>Give it a name and set expiration (e.g., No expiration).</li>
              <li>Check the <code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 3px;">gist</code> scope box.</li>
              <li>Generate and paste the token below.</li>
            </ol>
            <div style="margin-top: 8px; font-size: 11px; opacity: 0.8;">Note: Fine-grained tokens do not currently support the Gist API.</div>
          `;
          wrapper.appendChild(setupGuidePopover(setupDetails));

          const inputToken = FluxKit.utils.createHTMLElement('input', {
            class: 'flx-wiz-input', placeholder: 'Enter API Token (Needs "gist" scope)',
            value: this.data.token || '', type: 'password',
            fxkswTooltip: 'Classic PAT requires the "gist" scope. Fine-grained tokens currently do not support Gists.',
            eventListener: { input: (e) => { this.data.token = e.target.value }}
          });

          const inputGistID = FluxKit.utils.createHTMLElement('input', {
            class: 'flx-wiz-input', placeholder: 'Existing Gist ID (Optional)',
            value: this.data.gistId || '',
            fxkswTooltip:'Leave blank to auto-create a new Gist, or paste an existing ID to connect.',
            eventListener: { input: (e) => { this.data.gistId = e.target.value }}
          });

          wrapper.appendChild(inputToken);
          wrapper.appendChild(inputGistID);
        } else if (this.data.provider === 'GitHub Repo') {
          const setupDetails = `
            <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px; border-bottom: 1px solid rgba(128,128,128,0.2); padding-bottom: 6px;">GitHub Repo Setup</div>
            <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-weight: normal;">
              <li>Go to ${getExtLink('https://github.com/settings/tokens?type=beta', 'Fine-grained Tokens', 'GitHub Tokens')}.</li>
              <li>Click <b>Generate new token</b>.</li>
              <li>Under Repository Access, select <b>All repositories</b> (or select your specific repo).</li>
              <li>Under Permissions > Repository permissions, grant <b>Read and write</b> access to <code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 3px;">Contents</code> and <code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 3px;">Administration</code> (needed to auto-create repos).</li>
              <li>Generate and paste the token below.</li>
            </ol>
          `;
          wrapper.appendChild(setupGuidePopover(setupDetails));

          const inputToken = FluxKit.utils.createHTMLElement('input', {
            class: 'flx-wiz-input', placeholder: 'Enter API Token (Needs "repo" scope)',
            value: this.data.token || '', type: 'password',
            fxkswTooltip:'Classic PAT: check "repo". Fine-grained: needs "Contents" and "Administration" (Read/Write) on All Repos.',
            eventListener: { input: (e) => { this.data.token = e.target.value }}
          });
          wrapper.appendChild(inputToken);

          const defaultSub = this.options.defaultSubFolder || '';
          const placeholderSuffix = defaultSub ? `(Default: ${defaultSub})` : `(Leave blank for root)`;

          if (this.options.namespace) {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
              style: 'display: flex; align-items: center; gap: 6px; margin: 8px 0;',
              children: [
                FluxKit.utils.createHTMLElement('span', {
                  textContent: `${this.options.namespace} /`,
                  style: 'font-size: 13px; opacity: 0.7; white-space: nowrap;',
                  fxkswTooltip:'Base Repository Name (Locked by Script)'
                }),
                FluxKit.utils.createHTMLElement('input', {
                  class: 'flx-wiz-input', style: 'margin: 0; flex-grow: 1;',
                  placeholder: `Folder Path ${placeholderSuffix}`, value: this.data.subFolder || '',
                  fxkswTooltip:'The subfolder path inside the repository where data will be saved.',
                  eventListener: { input: (e) => { this.data.subFolder = e.target.value }}
                })
              ]
            }));
          } else {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: 'Repository Name (e.g., SyncData)',
              value: this.data.namespace || '',
              fxkswTooltip:'The name of the repository. SyncWizard will create it as Private if it does not exist.',
              eventListener: { input: (e) => { this.data.namespace = e.target.value }}
            }));
            wrapper.appendChild(FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: `Folder Path ${placeholderSuffix}`,
              value: this.data.subFolder || '',
              fxkswTooltip:'The specific folder inside the repository to use.',
              eventListener: { input: (e) => { this.data.subFolder = e.target.value }}
            }));
          }
        } else if (this.data.provider === 'WebDAV') {
          const setupDetails = `
            <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px; border-bottom: 1px solid rgba(128,128,128,0.2); padding-bottom: 6px;">WebDAV Setup Guide</div>
            <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-weight: normal;">
              <li>Locate your server's WebDAV URL (e.g., Nextcloud usually uses <code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 3px;">/remote.php/webdav/</code>).</li>
              <li>Go to your provider's Security or Account settings.</li>
              <li>Generate an <b>App Password</b> specifically for this script. <i>(Do not use your main account password!)</i></li>
              <li>Enter your username and the new App Password below.</li>
              <li>When you click Finish Setup, Tampermonkey may prompt you to <b>"Allow"</b> the cross-origin request. Click "Always Allow".</li>
            </ol>
          `;
          wrapper.appendChild(setupGuidePopover(setupDetails));
          const urlInput = FluxKit.utils.createHTMLElement('input', {
            class: 'flx-wiz-input', placeholder: 'WebDAV URL (e.g., https://nextcloud.com/remote.php/webdav/)',
            value: this.data.url || '',
            fxkswTooltip:'The base WebDAV URL for your server (must start with http:// or https://).',
            eventListener: { input: (e) => { this.data.url = e.target.value }}
          });

          const flxHint = FluxKit.utils.createHTMLElement('div', {
            style: 'font-size: 11px; opacity: 0.7; margin-top: -4px; margin-bottom: 8px; line-height: 1.2;',
            textContent: 'Note: Tampermonkey may prompt you to allow this connection. If it fails instantly, check your TM Settings -> User domain whitelist.'
          });

          const userInput = FluxKit.utils.createHTMLElement('input', {
            class: 'flx-wiz-input', placeholder: 'Username', value: this.data.username || '',
            fxkswTooltip:'Your WebDAV username.',
            eventListener: { input: (e) => { this.data.username = e.target.value }}
          });

          const passInput = FluxKit.utils.createHTMLElement('input', {
            class: 'flx-wiz-input', placeholder: 'App Password', type: 'password', value: this.data.password || '',
            fxkswTooltip:'Highly recommended to generate an App Password in your server settings rather than using your main account password.',
            eventListener: { input: (e) => { this.data.password = e.target.value }}
          });

          wrapper.appendChild(urlInput);
          wrapper.appendChild(flxHint);
          wrapper.appendChild(userInput);
          wrapper.appendChild(passInput);

          const defaultSub = this.options.defaultSubFolder || '';
          const placeholderSuffix = defaultSub ? `(Default: ${defaultSub})` : `(Leave blank for root)`;

          if (this.options.namespace) {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
              style: 'display: flex; align-items: center; gap: 6px; margin: 8px 0;',
              children: [
                FluxKit.utils.createHTMLElement('span', { textContent: `${this.options.namespace} /`, style: 'font-size: 13px; opacity: 0.7; white-space: nowrap;', fxkswTooltip:'Base Directory (Locked by Script)' }),
                FluxKit.utils.createHTMLElement('input', {
                  class: 'flx-wiz-input', style: 'margin: 0; flex-grow: 1;', placeholder: `Folder Path ${placeholderSuffix}`,
                  value: this.data.subFolder || '', fxkswTooltip:'The relative subfolder where your data will be nested.',
                  eventListener: { input: (e) => { this.data.subFolder = e.target.value }}
                })
              ]
            }));
          } else {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: `Folder Path ${placeholderSuffix}`,
              value: this.data.subFolder || '', fxkswTooltip:'The folder path on your WebDAV server where files will be uploaded.',
              eventListener: { input: (e) => { this.data.subFolder = e.target.value }}
            }));
          }
        } else if (this.data.provider === 'Dropbox') {

          if (!this.data.refreshToken) {
            const setupDetails = `
              <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px; border-bottom: 1px solid rgba(128,128,128,0.2); padding-bottom: 6px;">Dropbox Setup Guide</div>
              <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-weight: normal;">
                <li>Go to the ${getExtLink('https://www.dropbox.com/developers/apps', 'Dropbox App Console')}.</li>
                <li>Click <b>Create App</b> &rarr; <b>Scoped App</b> &rarr; <b>App folder</b>.</li>
                <li>In <b>Permissions</b>, check <code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 3px;">files.content.read</code> and <code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 3px;">files.content.write</code>.</li>
                <li>Paste the App Key and Secret below.</li>
              </ol>
            `;
            wrapper.appendChild(setupGuidePopover(setupDetails), '<span style="font-size: 11px; opacity: 0.8;">Step 1: Enter your Dropbox App Key & Secret.</span>');

            const inputKey = FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: 'App Key', value: this.data.appKey || '',
              eventListener: { input: (e) => { this.data.appKey = e.target.value }}
            });

            const inputSecret = FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: 'App Secret', type: 'password', value: this.data.appSecret || '',
              eventListener: { input: (e) => { this.data.appSecret = e.target.value }}
            });

            const getCodeBtn = FluxKit.utils.createHTMLElement('button', {
              class: 'flx-wiz-btn', style: 'width: 100%; text-align: center; margin-top: 4px;', textContent: 'Get Auth Code',
              fxkswTooltip:'Clicking this opens Dropbox so you can authorize the app and get the final code.',
              eventListener: (e) => {
                e.preventDefault();
                if (!this.data.appKey) return alert('Enter your App Key first.');
                FluxKit.utils.openPopupWindow(`https://www.dropbox.com/oauth2/authorize?client_id=${this.data.appKey}&response_type=code&token_access_type=offline`, { title: 'Authorize Dropbox' });
              }
            });

            wrapper.appendChild(inputKey);
            wrapper.appendChild(inputSecret);
            wrapper.appendChild(getCodeBtn);

            wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
              style: 'font-size: 11px; opacity: 0.8; margin-top: 12px; margin-bottom: 4px;',
              textContent: 'Step 2: Paste the code Dropbox gives you.'
            }));

            const inputAuthCode = FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: 'Authorization Code', value: this.data.authCode || '',
              fxkswTooltip:'Paste the authorization code generated from the Dropbox popup here.',
              eventListener: { input: (e) => { this.data.authCode = e.target.value }}
            });
            wrapper.appendChild(inputAuthCode);

          } else {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('div', { innerHTML: '✓ Dropbox Authorized', style: 'color: #2ecc71; font-weight: bold; font-size: 12px; margin-bottom: 12px;' }));
          }

          const defaultSub = this.options.defaultSubFolder || '';
          const placeholderSuffix = defaultSub ? `(Default: ${defaultSub})` : `(Leave blank for root)`;

          if (this.options.namespace) {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
              style: 'display: flex; align-items: center; gap: 6px; margin: 8px 0;',
              children: [
                FluxKit.utils.createHTMLElement('span', {
                  textContent: `/${this.options.namespace}/`, style: 'font-size: 13px; opacity: 0.7; white-space: nowrap;',
                  fxkswTooltip:'Base App Folder (Locked by Script)'
                }),
                FluxKit.utils.createHTMLElement('input', {
                  class: 'flx-wiz-input', style: 'margin: 0; flex-grow: 1;', placeholder: `Subfolder ${placeholderSuffix}`,
                  value: this.data.subFolder || '', fxkswTooltip:'The subfolder inside your Dropbox App folder.',
                  eventListener: { input: (e) => { this.data.subFolder = e.target.value }}
                })
              ]
            }));
          } else {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: 'App Folder Name (e.g., SyncData)',
              value: this.data.namespace || '', fxkswTooltip:'The name of the folder created in Apps/ on your Dropbox.',
              eventListener: { input: (e) => { this.data.namespace = e.target.value }}
            }));
            wrapper.appendChild(FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: `Subfolder ${placeholderSuffix}`,
              value: this.data.subFolder || '', fxkswTooltip:'An optional subfolder to keep files organized.',
              eventListener: { input: (e) => { this.data.subFolder = e.target.value }}
            }));
          }
        } else if (this.data.provider === 'OneDrive') {

          if (!this.data.refreshToken) {
            const setupDetails = `
              <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px; border-bottom: 1px solid rgba(128,128,128,0.2); padding-bottom: 6px;">OneDrive Setup Guide</div>
              <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-weight: normal;">
                <li>Go to the ${getExtLink('https://go.microsoft.com/fwlink/?linkid=2083908', 'App Registrations Portal', 'Azure Portal')}.</li>
                <li>New Registration &rarr; <b>"Accounts in any organizational directory and personal Microsoft accounts"</b>.</li>
                <li>Redirect URI: <b>Web</b> &rarr; <code style="background: rgba(128,128,128,0.2); padding: 2px 4px;">http://localhost</code></li>
                <li><b>API Permissions:</b> Add <code style="background: rgba(128,128,128,0.2); padding: 2px 4px;">Files.ReadWrite</code> & <code style="background: rgba(128,128,128,0.2); padding: 2px 4px;">offline_access</code> (under <b>Delegated</b> permissions).</li>
                <li><b>Client Secret:</b> Go to <b>Certificates & secrets</b>, create a new one, and <b>copy the VALUE</b>.</li>
                <li>Use <b>Application (client) ID</b> as App Key and the copied Secret as App Secret.</li>
              </ol>
            `;
            wrapper.appendChild(setupGuidePopover(setupDetails), '<span style="font-size: 11px; opacity: 0.8;">Step 1: Enter your Azure Client ID. <br><span style="color: #e74c3c; font-weight: bold; font-size: 10px;">(Requires Azure Directory / M365)</span></span>');

            const inputKey = FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: 'Client ID (App Key)', value: this.data.appKey || '',
              eventListener: { input: (e) => { this.data.appKey = e.target.value }}
            });

            const inputSecret = FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: 'Client Secret (Required for Web-type apps)', type: 'password',
              value: this.data.appSecret || '', fxkswTooltip:'If Azure demands a secret, generate one in Certificates & Secrets.',
              eventListener: { input: (e) => { this.data.appSecret = e.target.value }}
            });

            const getCodeBtn = FluxKit.utils.createHTMLElement('button', {
              class: 'flx-wiz-btn', style: 'width: 100%; text-align: center; margin-top: 4px;', textContent: 'Get Auth Code',
              fxkswTooltip:'Opens Microsoft login. You will be redirected to an error page (localhost). Copy the URL of that error page!',
              eventListener: (e) => {
                e.preventDefault();
                if (!this.data.appKey) return alert('Enter your Client ID first.');
                const scopes = encodeURIComponent('offline_access Files.ReadWrite User.Read');
                FluxKit.utils.openPopupWindow(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${this.data.appKey}&response_type=code&redirect_uri=http://localhost&scope=${scopes}`, { title: 'Authorize OneDrive' });
              }
            });

            wrapper.appendChild(inputKey);
            wrapper.appendChild(inputSecret);
            wrapper.appendChild(getCodeBtn);

            wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
              style: 'font-size: 11px; opacity: 0.8; margin-top: 12px; margin-bottom: 4px;',
              textContent: 'Step 2: Paste the localhost URL you were redirected to.'
            }));

            const inputAuthCode = FluxKit.utils.createHTMLElement('input', {
              class: 'flx-wiz-input', placeholder: 'Paste the http://localhost/?code=... URL here',
              value: this.data.authCode || '',
              eventListener: { input: (e) => {
                  let val = e.target.value.trim();
                  if (val.includes('code=')) val = new URL(val).searchParams.get('code');
                  this.data.authCode = val;
              }}
            });
            wrapper.appendChild(inputAuthCode);

          } else {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('div', { innerHTML: '✓ OneDrive Authorized', style: 'color: #2ecc71; font-weight: bold; font-size: 12px; margin-bottom: 12px;' }));
          }

          const defaultSub = this.options.defaultSubFolder || '';
          const placeholderSuffix = defaultSub ? `(Default: ${defaultSub})` : `(Leave blank for root)`;

          if (this.options.namespace) {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('div', {
              style: 'display: flex; align-items: center; gap: 6px; margin: 8px 0;',
              children: [
                FluxKit.utils.createHTMLElement('span', { textContent: `/${this.options.namespace}/`, style: 'font-size: 13px; opacity: 0.7; white-space: nowrap;', fxkswTooltip:'Root Folder (Locked)' }),
                FluxKit.utils.createHTMLElement('input', {
                  class: 'flx-wiz-input', style: 'margin: 0; flex-grow: 1;', placeholder: `Subfolder ${placeholderSuffix}`, value: this.data.subFolder || '',
                  eventListener: { input: (e) => { this.data.subFolder = e.target.value }}
                })
              ]
            }));
          } else {
            wrapper.appendChild(FluxKit.utils.createHTMLElement('input', { class: 'flx-wiz-input', placeholder: 'Root Folder Name', value: this.data.namespace || '', eventListener: { input: (e) => { this.data.namespace = e.target.value }} }));
            wrapper.appendChild(FluxKit.utils.createHTMLElement('input', { class: 'flx-wiz-input', placeholder: `Subfolder ${placeholderSuffix}`, value: this.data.subFolder || '', eventListener: { input: (e) => { this.data.subFolder = e.target.value }} }));
          }
        }

        const btn = FluxKit.utils.createHTMLElement('button', {
          class: 'flx-wiz-btn',
          textContent: this.loading ? 'Verifying...' : 'Finish Setup',
          eventListener: () => this.validateAndSave()
        });
        wrapper.appendChild(btn);
      }
    }

    return {
      AllProviders, Providers, CAPABILITIES, getCapabilities,
      isConfigured, handleApiError, fetch, upload, deleteAsset, Wizard, Editor,
      setTokenRefreshCallback: (cb) => { onTokenRefreshCallback = cb; }
    };
  })();
  
  FluxKit.help.register('sync', {
    _summary: 'Universal Cloud Storage & Sync Engine',
    _description: 'Abstracts authentication, data fetching, and chunked uploading across multiple providers including GitHub, WebDAV, Dropbox, and OneDrive. Features built-in setup Wizards and Editors.',
    _command: 'FluxKit.sync',
    _example: 'await FluxKit.sync.upload(myProfile, myData);\nconst data = await FluxKit.sync.fetch(myProfile);',

    AllProviders: {
      _summary: 'List of all supported cloud storage providers.',
      _command: 'FluxKit.sync.AllProviders',
      _returns: "Array of strings (e.g., ['GitHub Gist', 'GitHub Repo', 'WebDAV', 'Dropbox', 'OneDrive'])"
    },

    CAPABILITIES: {
      _summary: 'Default file size limits and feature flags per provider.',
      _command: 'FluxKit.sync.CAPABILITIES',
      _returns: 'Object mapping provider names to capability objects.'
    },

    getCapabilities: {
      _summary: 'Retrieves the active limits and capabilities for a specific profile.',
      _command: 'FluxKit.sync.getCapabilities(profile)',
      _arguments: {
        profile: { Type: 'Object', Required: 'Yes', Description: 'The sync profile configuration object.' }
      },
      _returns: 'Object { maxFileSize, totalQuota, allowsNativeFiles, allowsScreenshots, requiresBatchedBase64 }'
    },

    isConfigured: {
      _summary: 'Validates if a profile has the minimum required credentials to operate.',
      _command: 'FluxKit.sync.isConfigured(profile)',
      _arguments: {
        profile: { Type: 'Object', Required: 'Yes', Description: 'The sync profile to validate.' }
      },
      _returns: 'Boolean (true if ready for use).'
    },

    handleApiError: {
      _summary: 'Standardizes HTTP/API errors across different providers.',
      _command: 'FluxKit.sync.handleApiError(err, provider)',
      _arguments: {
        err: { Type: 'Error/Object', Required: 'Yes', Description: 'The raw error object thrown by the API.' },
        provider: { Type: 'String', Required: 'Yes', Description: 'The name of the provider.' }
      },
      _returns: 'A standardized Error object (e.g., AUTH_EXPIRED, SERVER_DOWN).'
    },

    setTokenRefreshCallback: {
      _summary: 'Registers a global callback fired whenever an OAuth token automatically refreshes (Dropbox/OneDrive).',
      _command: 'FluxKit.sync.setTokenRefreshCallback(callback)',
      _arguments: {
        callback: { Type: 'Function', Required: 'Yes', Description: '(profile) => void. Use this to save the new token to your persistent storage.' }
      },
      _example: "FluxKit.sync.setTokenRefreshCallback((updatedProfile) => {\n  GM_setValue('sync_profile', updatedProfile);\n});"
    },

    fetch: {
      _summary: 'Fetches data or files from the configured cloud provider.',
      _command: 'await FluxKit.sync.fetch(profile, options)',
      _arguments: {
        profile: { Type: 'Object', Required: 'Yes', Description: 'The authenticated sync profile.' },
        options: { Type: 'Object', Required: 'No', Description: '{ filename: string } to fetch a specific file.' }
      },
      _returns: 'Promise<{ files: { [filename]: { content } } }>',
      _example: "const result = await FluxKit.sync.fetch(profile, { filename: 'data.json' });\nconsole.log(result.files['data.json'].content);"
    },

    upload: {
      _summary: 'Uploads data, automatically handling size limits, base64 conversions, and provider routing.',
      _command: 'await FluxKit.sync.upload(profile, payload, defaultFilename, onProgress)',
      _arguments: {
        profile: { Type: 'Object', Required: 'Yes', Description: 'The authenticated sync profile.' },
        payload: { Type: 'Object|Blob|String', Required: 'Yes', Description: 'The data to upload. Can be a complex format, a Blob, or a raw string/JSON.' },
        defaultFilename: { Type: 'String', Required: 'No', Description: 'Fallback filename if payload is not a complex files object (Default: "data.json").' },
        onProgress: { Type: 'Function', Required: 'No', Description: 'Callback (filename) => {} triggered after each file/chunk uploads.' }
      },
      _returns: 'Promise<Boolean> true on successful upload, or throws an Error.',
      _example: "await FluxKit.sync.upload(profile, { mySetting: true }, 'settings.json', (file) => console.log(`Uploaded ${file}`));"
    },

    delete: {
      _summary: 'Deletes a specific file directly from the active cloud provider.',
      _command: 'await FluxKit.sync.delete(profile, fileIdOrName)',
      _arguments: {
        profile: { Type: 'Object', Required: 'Yes', Description: 'The authenticated sync profile.' },
        fileIdOrName: { Type: 'String', Required: 'Yes', Description: 'The exact filename, path, or API ID to delete from the cloud.' }
      },
      _returns: 'Promise<Boolean>'
    },

    Wizard: {
      _summary: 'Interactive UI component for guiding users through OAuth and provider setup.',
      _description: 'Creates a step-by-step UI for configuring a sync profile. ⚠️ Note: Always call .destroy() when removing the UI to clean up event listeners.',
      _command: 'new FluxKit.sync.Wizard(targetElement, options, onComplete)',
      _arguments: {
        target: { Type: 'HTMLElement', Required: 'Yes', Description: 'The root element (e.g., a Shadow DOM root or document.body) where the <style> tags will be injected to ensure CSS isolation.' },
        options: { Type: 'Object', Required: 'No', Description: 'Config { providers: [], defaultSubFolder: "", namespace: "", theme: {} }.' },
        onComplete: { Type: 'Function', Required: 'Yes', Description: 'Callback triggered with the fully authenticated profile.' }
      },
      _config: {
        _description: 'Configures which providers are allowed and locks structural settings.',
        'providers': { Type: 'Array<String>', Default: 'All', Description: 'e.g., ["WebDAV", "GitHub Repo"]' },
        'providerLayout': { Type: 'String', Default: '"chips"', Description: '"chips" or "dropdown"' },
        'namespace': { Type: 'String', Default: 'None', Description: 'Forcefully lock the root folder/repo name.' },
        'defaultSubFolder': { Type: 'String', Default: 'None', Description: 'Pre-fills the subfolder input.' },
        'theme': { Type: 'Object', Default: '{}', Description: 'Overrides for colors, radius, and fonts.' }
      },
      _example: "const wizard = new FluxKit.sync.Wizard(document.getElementById('setup'), {}, (profile) => {\n  console.log('Setup complete!', profile);\n  wizard.destroy(); // Clean up listeners!\n});\nwizard.render();",

      render: {
        _summary: 'Builds and injects the wizard DOM elements and styles into the target container.',
        _command: 'wizardInstance.render(container)',
        _arguments: {
          container: { Type: 'HTMLElement', Required: 'Yes', Description: 'The specific DOM node where the UI form elements and inputs will be rendered.' }
        }
      },
      updateTheme: {
        _summary: 'Updates the visual theme on the fly and immediately re-injects the CSS.',
        _command: 'wizardInstance.updateTheme(newTheme)',
        _arguments: {
          newTheme: { Type: 'Object', Required: 'Yes', Description: 'Partial theme object (e.g., { darkMode: true, accentBg: "#ff0000" }).' }
        }
      },
      destroy: {
        _summary: 'Cleans up background system event listeners.',
        _description: '⚠️ Highly recommended to call this once setup is complete or the modal is closed. It removes the window.matchMedia event listener to prevent memory leaks.',
        _command: 'wizardInstance.destroy()'
      }
    },

    Editor: {
      _summary: 'Interactive UI component for modifying an existing sync profile configuration.',
      _description: 'Creates a form interface populated with an existing profile. ⚠️ Note: Always call .destroy() when removing the UI to clean up event listeners.',
      _command: 'new FluxKit.sync.Editor(targetElement, profile, options, onComplete)',
      _arguments: {
        target: { Type: 'HTMLElement', Required: 'Yes', Description: 'The root element (e.g., a Shadow DOM root or document.body) where the <style> tags will be injected to ensure CSS isolation.' },
        profile: { Type: 'Object', Required: 'Yes', Description: 'Existing profile data to populate the fields.' },
        options: { Type: 'Object', Required: 'No', Description: 'UI options e.g., { layout: "vertical", theme: {} }.' },
        onComplete: { Type: 'Function', Required: 'No', Description: 'Optional callback for completion events.' }
      },
      _config: {
        _description: 'Configures visual layout and structure locks.',
        'layout': { Type: 'String', Default: '"horizontal"', Description: '"horizontal" or "vertical" input alignment.' },
        'namespace': { Type: 'String', Default: 'None', Description: 'Visually locks the root folder/repo name.' },
        'theme': { Type: 'Object', Default: '{}', Description: 'Overrides for colors, radius, and fonts.' }
      },
      _example: "const editor = new FluxKit.sync.Editor(document.getElementById('edit-pane'), existingProfile);\neditor.render();\n\n// Later, when closing the panel:\neditor.destroy();",

      render: {
        _summary: 'Builds and injects the editor DOM elements and styles into the target container.',
        _command: 'editorInstance.render(container)',
        _arguments: {
          container: { Type: 'HTMLElement', Required: 'Yes', Description: 'The specific DOM node where the UI form elements and inputs will be rendered.' }
        }
      },
      updateTheme: {
        _summary: 'Updates the visual theme on the fly and immediately re-injects the CSS.',
        _command: 'editorInstance.updateTheme(newTheme)',
        _arguments: {
          newTheme: { Type: 'Object', Required: 'Yes', Description: 'Partial theme object (e.g., { darkMode: true, accentBg: "#ff0000" }).' }
        }
      },
      destroy: {
        _summary: 'Cleans up background system event listeners.',
        _description: '⚠️ Highly recommended to call this once editing is complete or the modal is closed. It removes the window.matchMedia event listener to prevent memory leaks.',
        _command: 'editorInstance.destroy()'
      }
    },
  }, { isNative: true });
})();