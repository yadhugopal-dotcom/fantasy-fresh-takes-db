import { toBlob } from "html-to-image";

export function supportsClipboardImageCopy() {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof window.ClipboardItem !== "undefined" &&
    Boolean(navigator.clipboard && typeof navigator.clipboard.write === "function")
  );
}

export async function copyNodeImageToClipboard(node, options = {}) {
  if (!node) {
    throw new Error("This section is not ready to share yet.");
  }

  if (!supportsClipboardImageCopy()) {
    throw new Error("Clipboard image copy not supported in this browser.");
  }

  const userFilter = typeof options.filter === "function" ? options.filter : null;
  const previousCaptureMode = node?.dataset?.shareCapture;
  if (options.captureMode) {
    node.dataset.shareCapture = String(options.captureMode);
  }

  let blob;

  try {
    blob = await toBlob(node, {
      backgroundColor: options.backgroundColor || "#f4efe6",
      cacheBust: true,
      pixelRatio: 2,
      ...options,
      filter(targetNode) {
        if (targetNode?.dataset?.shareIgnore === "true") {
          return false;
        }

        return userFilter ? userFilter(targetNode) : true;
      },
    });
  } finally {
    if (options.captureMode) {
      if (previousCaptureMode) {
        node.dataset.shareCapture = previousCaptureMode;
      } else {
        delete node.dataset.shareCapture;
      }
    }
  }

  if (!blob) {
    throw new Error("Unable to capture this section right now.");
  }

  await navigator.clipboard.write([
    new window.ClipboardItem({
      "image/png": blob,
    }),
  ]);

  return blob;
}
