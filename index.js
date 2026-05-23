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

// Sidebar buttons (type=1).
PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_MAIN,
  name: 'Embed Image',
  icon: ICON,
  showType: 1,
}).catch((e) => console.log('[embedimage] main button register failed:', e));

PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_REFRESH,
  name: 'Refresh Embed',
  icon: ICON,
  showType: 1,
}).catch((e) => console.log('[embedimage] refresh button register failed:', e));

PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_DROP,
  name: 'Drop Inbox',
  icon: ICON,
  showType: 1,
}).catch((e) => console.log('[embedimage] drop button register failed:', e));

// Lasso-toolbar button (type=2). Appears when the user lasso-selects ink
// on the page; tap to ship the selection to the Mac. registerButton
// returns a Promise, so a sync try/catch isn't enough — catch the
// rejection so an older host that rejects the call doesn't end up with
// a half-registered button confusing the lasso menu.
Promise.resolve()
  .then(() =>
    PluginManager.registerButton(2, ['NOTE'], {
      id: BUTTON_LASSO_SEND,
      name: 'Send to Mac',
      icon: ICON,
      showType: 1,
    }),
  )
  .catch((e) => console.log('[embedimage] lasso button register skipped:', e));

PluginManager.registerButtonListener({
  onButtonPress: (_msg) => {
    // Routing happens in App.tsx via the listener it registers there.
  },
});
