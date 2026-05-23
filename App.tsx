import React, { useCallback, useEffect, useState } from 'react';
import { PluginManager } from 'sn-plugin-lib';
import { ImageProcessor } from './src/imageProcessor';
import { BrowserScreen } from './src/screens/Browser';
import { CaptureScreen } from './src/screens/Capture';
import { PreviewScreen } from './src/screens/Preview';
import { RefreshScreen } from './src/screens/Refresh';
import { SettingsScreen } from './src/screens/Settings';
import { SourcePicker } from './src/screens/SourcePicker';
import { baseUrl, loadStreamConfig } from './src/storage';
import { DEFAULT_STREAM_CONFIG, Entry, Screen, StreamConfig } from './src/types';

// Must match BUTTON_REFRESH in index.js.
const BUTTON_REFRESH = 2;

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('browser');
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [streamConfig, setStreamConfig] = useState<StreamConfig>(DEFAULT_STREAM_CONFIG);

  useEffect(() => {
    ImageProcessor?.cleanupCache?.().catch(() => {});
    (async () => {
      const cfg = await loadStreamConfig();
      setStreamConfig(cfg);
    })();

    // Route based on which sidebar button was tapped. PluginManager replays
    // the last button event to a freshly-registered listener, so the local
    // subscription here will fire immediately if we were launched by the
    // Refresh button.
    const sub = PluginManager.registerButtonListener({
      onButtonPress: (msg: any) => {
        if (msg?.id === BUTTON_REFRESH) setScreen('refresh');
      },
    });
    return () => {
      sub?.remove?.();
    };
  }, []);

  const openPreview = useCallback((entry: Entry) => {
    setSelectedEntry(entry);
    setScreen('preview');
  }, []);

  const goBrowser = useCallback(() => {
    setSelectedEntry(null);
    setScreen('browser');
  }, []);

  if (screen === 'refresh') {
    return <RefreshScreen />;
  }

  if (screen === 'preview' && selectedEntry) {
    return <PreviewScreen entry={selectedEntry} onBack={goBrowser} />;
  }

  if (screen === 'settings') {
    return (
      <SettingsScreen
        onBack={goBrowser}
        onSaved={(cfg) => setStreamConfig(cfg)}
      />
    );
  }

  if (screen === 'capture') {
    return (
      <CaptureScreen
        config={streamConfig}
        onConfigChange={setStreamConfig}
        onBack={goBrowser}
        onOpenSettings={() => setScreen('settings')}
        onOpenSourcePicker={() => setScreen('sourcepicker')}
      />
    );
  }

  if (screen === 'sourcepicker') {
    return (
      <SourcePicker
        baseUrl={baseUrl(streamConfig)}
        onClose={() => setScreen('capture')}
        onChanged={() => setScreen('capture')}
      />
    );
  }

  return (
    <BrowserScreen
      onPickFile={openPreview}
      onOpenSettings={() => setScreen('settings')}
      onOpenCapture={() => setScreen('capture')}
      onClose={() => {}}
      busy={false}
    />
  );
}
