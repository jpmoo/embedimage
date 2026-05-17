import { AppRegistry, Image } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

const BUTTON_ID = 1;

// type=1: sidebar button (plugins area). showType=1: tap opens the plugin view (App.tsx).
PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_ID,
  name: 'Embed Image',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
});

PluginManager.registerButtonListener({
  onButtonPress: (msg) => {
    if (!msg || msg.id !== BUTTON_ID) return;
    // showType=1 opens the view automatically; nothing else to do here.
  },
});
