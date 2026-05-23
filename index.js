import { AppRegistry, Image } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import App from './App';
import { name as appName } from './app.json';
import pluginConfig from './PluginConfig.json';
import { runSendLassoToMac } from './src/lassoExport';
import { runQuickStitch } from './src/quickStitch';
import { loadStreamConfig } from './src/storage';
import { FileLogger } from './src/util/FileLogger';
import { setPendingButton } from './pendingButton';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

FileLogger.raw('[embedimage] bundle start', {
  version: pluginConfig.versionName, code: pluginConfig.versionCode,
});

// Button IDs. App.tsx watches the most recent press and routes to the
// matching headless screen if applicable.
export const BUTTON_MAIN = 1;
export const BUTTON_REFRESH = 2;
export const BUTTON_DROP = 3;
export const BUTTON_LASSO_SEND = 4;             // lasso toolbar — ship to Mac
export const BUTTON_LASSO_RECOGNIZE = 5;        // lasso toolbar — OCR -> insert text
export const BUTTON_LASSO_STITCH_LAYERS = 6;    // lasso toolbar — layer picker → image
export const BUTTON_STITCH_LAYERS_SIDE = 7;     // sidebar duplicate of above (always visible)
export const BUTTON_QUICK_STITCH_TRANSP = 8;    // lasso toolbar — headless stitch (transparent BG)
export const BUTTON_QUICK_STITCH_WHITE = 9;     // lasso toolbar — headless stitch (white BG)

const ICON = Image.resolveAssetSource(require('./assets/icon.png')).uri;

function mkName(label) {
  return { en: label, zh_CN: label, zh_TW: label, ja: label };
}

const baseBtn = (id, label) => ({
  id,
  name: label,
  nameMap: mkName(label),
  desc: '',
  descMap: mkName(''),
  icon: ICON,
  showType: 1,
});

// Helper that logs success/failure of each registration to the log
// file so the next adb pull tells us exactly what registered.
function regBtn(type, label, payload) {
  return PluginManager.registerButton(type, ['NOTE'], payload)
    .then((ok) => FileLogger.raw('[embedimage] registerButton OK', { id: payload.id, label, type, ok }))
    .catch((e) => FileLogger.raw('[embedimage] registerButton FAIL', { id: payload.id, label, type, err: String(e?.message ?? e) }));
}

regBtn(1, 'Embed Image', baseBtn(BUTTON_MAIN, 'Embed Image'));
regBtn(1, 'Refresh Embed', baseBtn(BUTTON_REFRESH, 'Refresh Embed'));
regBtn(1, 'Drop Inbox', baseBtn(BUTTON_DROP, 'Drop Inbox'));

// Stitch Layers also lives as a SIDEBAR button. The lasso "..." popup
// in the Manta toolbar has limited visible space; with Sticker + our
// Send to Mac + Recognize already there, the lasso version may scroll
// off-screen and look "missing". The sidebar entry is always visible
// — lasso state is preserved when the plugin view opens, so the user
// can lasso → open sidebar → Stitch Layers and the picker still sees
// the selection. The lasso-toolbar version below stays registered for
// users who scroll to it. The two registrations need distinct ids;
// App.tsx routes both to the same LayerStitch screen.
regBtn(1, 'Stitch Layers', baseBtn(BUTTON_STITCH_LAYERS_SIDE, 'Stitch Layers'));

// Lasso-toolbar buttons (type=2). The host's area-selection adapter
// expects `editDataTypes` and `nameMap` — without either it throws.
// editDataTypes values per the SDK:
//   0 handwritten strokes  1 title  2 image  3 text  4 link  5 shapes
regBtn(2, 'Send to Mac', {
  ...baseBtn(BUTTON_LASSO_SEND, 'Send to Mac'),
  editDataTypes: [0, 1, 2, 3, 4, 5],
  showType: 0, // headless — runs straight from the button listener
});

regBtn(2, 'Recognize', {
  ...baseBtn(BUTTON_LASSO_RECOGNIZE, 'Recognize'),
  editDataTypes: [0, 1, 3], // strokes / title / text
});

regBtn(2, 'Stitch Layers', {
  ...baseBtn(BUTTON_LASSO_STITCH_LAYERS, 'Stitch Layers'),
  editDataTypes: [0, 1, 2, 3, 4, 5],
});

// Headless "just do it" variants — same plumbing as Send to Mac
// (showType:0, runs straight from the button-press handler, no plugin
// view to open). Bypasses the routing race entirely. The view-based
// "Stitch Layers" picker stays for users who want layer selection.
regBtn(2, 'Stitch (transparent)', {
  ...baseBtn(BUTTON_QUICK_STITCH_TRANSP, 'Stitch (transparent)'),
  editDataTypes: [0, 1, 2, 3, 4, 5],
  showType: 0,
});

regBtn(2, 'Stitch (white BG)', {
  ...baseBtn(BUTTON_QUICK_STITCH_WHITE, 'Stitch (white BG)'),
  editDataTypes: [0, 1, 2, 3, 4, 5],
  showType: 0,
});

PluginManager.registerButtonListener({
  onButtonPress: (msg) => {
    FileLogger.raw('[embedimage] onButtonPress', msg);
    if (msg?.id === BUTTON_LASSO_SEND) {
      loadStreamConfig()
        .then((cfg) => runSendLassoToMac(cfg.lassoFormat ?? 'png'))
        .catch(() => {});
      return;
    }
    if (msg?.id === BUTTON_QUICK_STITCH_TRANSP) {
      runQuickStitch(true).catch(() => {});
      return;
    }
    if (msg?.id === BUTTON_QUICK_STITCH_WHITE) {
      runQuickStitch(false).catch(() => {});
      return;
    }
    if (msg?.id !== undefined && msg?.id !== null) {
      setPendingButton(msg.id);
    }
  },
});
