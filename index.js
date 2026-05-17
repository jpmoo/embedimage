import { AppRegistry, Image } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

const BUTTON_ID = 1001;

// type=1: sidebar/toolbar button in the NOTE editor's plugins area.
// showType=1: tapping the button opens the full-screen plugin UI (App.tsx).
// type=1 → sidebar button. expandButton=0 → no extension, just an entry in the sidebar plugins area.
PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_ID,
  name: 'Embed Image',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  enable: true,
  expandButton: 0,
});

PluginManager.registerButtonListener({
  onButtonPress(event) {
    if (event?.id === BUTTON_ID) {
      PluginManager.showPluginView();
    }
  },
});
