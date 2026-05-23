// Synchronous routing channel from index.js's button listener to
// App.tsx's initial render. The complication: the host runs index.js
// twice — once in a background context (button registrations + press
// listener) and again in a fresh UI context when the view opens. They
// have disjoint JS module state, so a plain in-memory variable here
// would be reset by the time App.tsx renders.
//
// We therefore back it with SharedPreferences via a synchronous native
// method, with an in-memory cache for same-context navigation.
import { NativeModules } from 'react-native';

const { ImageProcessor } = NativeModules;

let pendingButtonId = null;

export const setPendingButton = (id) => {
  pendingButtonId = id;
  // Fire-and-forget; the value lives in SharedPreferences so the UI
  // context can read it even if our JS module state was reset.
  try {
    ImageProcessor?.setPendingButton?.(id);
  } catch (_) {}
};

// Read AND clear. Called by App.tsx on first mount. Tries the native
// store first (works across context boundaries) then falls back to
// the in-memory variable (works for re-mounts within the same context).
export const checkPendingButton = () => {
  let val = null;
  try {
    const raw = ImageProcessor?.getAndClearPendingButton?.();
    if (typeof raw === 'string' && raw.length > 0) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) val = n;
    }
  } catch (_) {}
  if (val === null) val = pendingButtonId;
  pendingButtonId = null;
  return val;
};

export const peekPendingButton = () => pendingButtonId;
