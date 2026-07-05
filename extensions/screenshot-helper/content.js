window.addEventListener("message", (event) => {
  if (event.source !== window || event.data.type !== "FLUX_CAPTURE_SCREENSHOT") return;

  if (!navigator.userActivation.isActive) {
    console.warn("🚫 [FluxScreenshot] Blocked: Screenshot requested without genuine user interaction. Potential silent capture attempt.");
    return;
  }

  chrome.runtime.sendMessage(
    { type: "FLUX_CAPTURE_SCREENSHOT", id: event.data.id },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("[FluxScreenshot] Runtime error:", chrome.runtime.lastError);
        return;
      }

      if (response && response.dataUrl) {
        window.postMessage(
          {
            type: "FLUX_SCREENSHOT_RESPONSE",
            id: event.data.id,
            dataUrl: response.dataUrl,
          },
          "*"
        );
      } else {
        console.error("[FluxScreenshot] No screenshot dataUrl in response:", response);
      }
    }
  );
});