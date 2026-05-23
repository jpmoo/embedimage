// Windows 95 design system. All visual chrome (buttons, frames, title
// bars, menu bars) lives here so we can re-skin the whole app from one
// place. The Manta is monochrome e-ink, so the "color" palette is
// pragmatic: shades of gray that render as flat tones (or dithered)
// on-device. The bevel illusion comes from contrasting border colors
// rather than gradients.

import { TextStyle, ViewStyle } from 'react-native';

export const theme = {
  // Classic Win95 silver. On the Manta this comes out as a light gray;
  // the bevels still read clearly.
  bg: '#c0c0c0',
  panel: '#c0c0c0',
  inset: '#ffffff',          // input / list backgrounds
  highlight: '#ffffff',      // top + left edge of raised controls
  shadow: '#808080',         // mid bevel
  dark: '#000000',           // outer dark edge
  text: '#000000',
  textMuted: '#3f3f3f',
  // "Active title bar" blue from Win95. Manta will render it dark; fine.
  titleBg: '#000080',
  titleFg: '#ffffff',
  selBg: '#000080',
  selFg: '#ffffff',
  desktop: '#008080',        // teal — region picker uses this
};

// Bundle this in android/app/src/main/assets/fonts/ as VT323-Regular.ttf
// to get true pixel typography. Falls back to monospace if missing.
//   curl -L "https://fonts.gstatic.com/s/vt323/v17/pxiKyp0ihIEF2isfFJU.ttf" \
//        -o android/app/src/main/assets/fonts/VT323-Regular.ttf
export const PIXEL_FONT = 'VT323';
export const SANS_FONT = 'monospace';

// Outset bevel: highlight on top/left, shadow on bottom/right, plus a
// 1px black outer ring. The doubled-up border-style approach RN doesn't
// support, so we layer two Views (see Win95Frame).
export function outsetEdges(): ViewStyle {
  return {
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: theme.highlight,
    borderLeftColor: theme.highlight,
    borderRightColor: theme.dark,
    borderBottomColor: theme.dark,
  };
}

export function insetEdges(): ViewStyle {
  return {
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: theme.dark,
    borderLeftColor: theme.dark,
    borderRightColor: theme.highlight,
    borderBottomColor: theme.highlight,
  };
}

export function inner3D(): ViewStyle {
  // Secondary inner bevel — combined with outsetEdges this yields the
  // double-line raised look used by Win95 buttons.
  return {
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: theme.bg,
    borderLeftColor: theme.bg,
    borderRightColor: theme.shadow,
    borderBottomColor: theme.shadow,
  };
}

export const pixelText: TextStyle = {
  fontFamily: PIXEL_FONT,
  fontSize: 16,
  color: theme.text,
};

export const sansText: TextStyle = {
  fontFamily: SANS_FONT,
  fontSize: 12,
  color: theme.text,
};
