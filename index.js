import { AppRegistry, Image } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// Button IDs. App.tsx watches the most recent press and routes to the
// matching headless screen if applicable.
export const BUTTON_MAIN = 1;
export const BUTTON_REFRESH = 2;
export const BUTTON_DROP = 3;
export const BUTTON_LASSO_SEND = 4; // lasso-toolbar button (type=2)

const ICON = Image.resolveAssetSource(require('./assets/icon.png')).uri;

// The Supernote host crashes (java.lang.NullPointerException inside
// PluginButtonAdapter / the lifecycle that registers the button) if
// nameMap or descMap is missing — its adapter does
// `new HashSet<>(button.nameMap.keySet())` without a null check. Provide
// at least the English fallback for every button.
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

// Sidebar buttons (type=1). The host accepts these even with a null
// nameMap on current firmware, but we include it defensively in case
// a future build tightens the adapter the way the lasso one does.
PluginManager.registerButton(1, ['NOTE'], baseBtn(BUTTON_MAIN, 'Embed Image'))
  .catch((e) => console.log('[embedimage] main button register failed:', e));

PluginManager.registerButton(1, ['NOTE'], baseBtn(BUTTON_REFRESH, 'Refresh Embed'))
  .catch((e) => console.log('[embedimage] refresh button register failed:', e));

PluginManager.registerButton(1, ['NOTE'], baseBtn(BUTTON_DROP, 'Drop Inbox'))
  .catch((e) => console.log('[embedimage] drop button register failed:', e));

// Lasso-toolbar button (type=2). The host's area-selection adapter
// expects `editDataTypes` (which lasso content kinds the button applies
// to) and `nameMap`. With either missing it throws a HashSet NPE when
// the user opens the "..." menu and the menu crashes the note app.
// editDataTypes values per the SDK:
//   0 handwritten strokes  1 title  2 image  3 text  4 link  5 shapes
PluginManager.registerButton(2, ['NOTE'], {
  ...baseBtn(BUTTON_LASSO_SEND, 'Send to Mac'),
  editDataTypes: [0, 1, 2, 3, 4, 5],
}).catch((e) => console.log('[embedimage] lasso button register skipped:', e));

PluginManager.registerButtonListener({
  onButtonPress: (_msg) => {
    // Routing happens in App.tsx via the listener it registers there.
  },
});
