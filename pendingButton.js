// Inkling-style synchronous routing channel from index.js's button
// listener to App.tsx's initial render. Necessary because the host
// dispatches the button event around the time the JS bundle (re)loads
// — if App relies only on the SDK's replay via registerButtonListener,
// the first render shows the wrong screen (or none) and the user sees
// the default Browser instead of the lasso-specific screen they tapped.

let pendingButtonId = null;

export const setPendingButton = (id) => {
  pendingButtonId = id;
};

// Read AND clear — used by App.tsx on first mount to choose its
// initial screen, then it should not influence later mounts.
export const checkPendingButton = () => {
  const val = pendingButtonId;
  pendingButtonId = null;
  return val;
};

export const peekPendingButton = () => pendingButtonId;
