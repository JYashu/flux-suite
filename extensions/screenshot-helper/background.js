chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FLUX_CAPTURE_SCREENSHOT") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("[FluxScreenshot] Capture error:", chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });

    return true;
  }
});