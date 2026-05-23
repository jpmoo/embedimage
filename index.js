import { AppRegistry, Image } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// Button IDs. App.tsx reads the last pressed id off PluginManager and
// switches to the "refresh" headless flow if it sees BUTTON_REFRESH.
export const BUTTON_MAIN = 1;
export const BUTTON_REFRESH = 2;

const ICON = Image.resolveAssetSource(require('./assets/icon.png')).uri;

// type=1: sidebar button. showType=1: tap opens the plugin view (App.tsx).
// Both buttons go through the same view; App.tsx routes based on the
// pressed button id.
PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_MAIN,
  name: 'Embed Image',
  icon: ICON,
  showType: 1,
});

PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_REFRESH,
  name: 'Refresh Embed',
  icon: ICON,
  showType: 1,
});

PluginManager.registerButtonListener({
  onButtonPress: (_msg) => {
    // Routing happens in App.tsx via PluginManager.lastButtonEventMsg.
  },
});
