# 🛠️ Flux Suite

Welcome to my personal monorepo for UserScripts, browser automation tools, and web extensions.

I built this suite simply to improve my own daily web browsing, learn new web APIs, and my personal playground for creating exactly the tools I want to use.

If you stumble across this repository and find something useful for your own setup, that's an awesome bonus! Feel free to poke around, fork what you like, or use my core toolkit for your own scripts.

---

## 📂 What's in here?

I've organized things to keep my core libraries separate from the actual scripts I run in my browser:

```text
/
├── apps/               # The actual UserScripts I use daily
│   ├── originals/      # 💡 Scripts I built from scratch
│       ├── universal-notes/
│       └── wiki-enhancer/
│   ├── forks/          # 🍴 Community scripts that I use, tweaked to fit my workflow (UI preferences, FluxKit logging)
│       ├── google-photos-toolkit/
├── extensions/         # Browser extension helpers (e.g., screenshot utilities)
├── libs/               # Shared code and frameworks
│   ├── flux-kit/       # ⚙️ My personal UserScript framework (UI, Sync, Canvas)
│   ├── vendors/        # Third-party libraries (e.g., gif.js)
└── LICENSE             # Apache 2.0
```

---

## ⚙️ FluxKit (The Engine)

**FluxKit** is the backbone of this repo. It grew organically because I got tired of rewriting the same boilerplate for every new script. It handles the heavy lifting so I can just focus on building features.

Some fun things I built into it:
* **Decoupled UI Utilities:** A theme-aware component system that plays nice with both the standard DOM and isolated Shadow Roots. Just pass it the right references, and it builds complex UIs without CSS bleeding.
* **Cloud Sync:** A unified API I wrote to sync my notes across GitHub Gists, WebDAV, OneDrive, and Dropbox.
* **Vector Scratchpad:** A custom, decoupled HTML5 canvas engine because I wanted to be able to sketch over websites.
* **Strict CSP Bypasses:** Custom Trusted Types patching and a dynamic ESM loader using `Blob` URIs, so my scripts don't get blocked by aggressive security policies.

### Using FluxKit yourself
I deploy this repo to Vercel to serve as my own personal CDN. If you want to tinker with FluxKit in your own scripts, you can require it directly. 

Here is a boilerplate of the metadata you'll need:

```javascript
// ==UserScript==
// @name         My Custom Script
// @namespace    [http://tampermonkey.net/](http://tampermonkey.net/)
// @version      1.0
// @require      https://<your-vercel-url>/libs/flux-kit/core.js
// @require      https://<your-vercel-url>/libs/flux-kit/sync.js
// @require      https://<your-vercel-url>/libs/flux-kit/scratchpad.js
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// ==/UserScript==
```

### 🔒 Required Permissions (The Sandbox)
Because FluxKit does a lot of heavy lifting across different browser security contexts, it relies on a few specific UserScript Manager grants to function:
* `@grant unsafeWindow` - Without this, FluxKit cannot expose itself to the page, meaning the interactive `FluxKit.help()` console registry will be trapped inside the sandbox and completely inaccessible outside of the userscript's environment.
* `@grant GM_xmlhttpRequest` - Required by `FluxKit.sync` for bypassing CORS when talking to WebDAV servers and other APIs, and by the ESM loader to fetch remote modules.

### Built-in Docs
I built a documentation registry right into the browser console, to teach myslef how to use the things I created. Once FluxKit is loaded on a page (and `unsafeWindow` is granted), just open your DevTools and type:
* `FluxKit.help()` - View all registered modules.
* `FluxKit.help('sync')` - See how the sync module works.
* `FluxKit.help('ui.Scratchpad')` - Get examples for the Canvas engine.

---

## ⚖️ License & Attribution

* **My Code:** Everything I've written from scratch (including FluxKit and my original apps) is licensed under the **Apache License 2.0**.
* **Third-Party Code:** You'll find scripts in here that I found online and customized to my liking (located in `/apps/forks/` and `/libs/vendor/`). Some have visual tweaks, while others just have FluxKit logging hooked up to keep the console quiet. You find their original author credits and licenses (MIT, GPL, etc.) in their respective file headers.