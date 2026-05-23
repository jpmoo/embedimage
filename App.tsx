import React, { useCallback, useEffect, useState } from 'react';
import { ImageProcessor } from './src/imageProcessor';
import { BrowserScreen } from './src/screens/Browser';
import { CaptureScreen } from './src/screens/Capture';
import { PreviewScreen } from './src/screens/Preview';
import { SettingsScreen } from './src/screens/Settings';
import { loadStreamConfig } from './src/storage';
import { DEFAULT_STREAM_CONFIG, Entry, Screen, StreamConfig } from './src/types';

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
  }, []);

  const openPreview = useCallback((entry: Entry) => {
    setSelectedEntry(entry);
    setScreen('preview');
  }, []);

  const goBrowser = useCallback(() => {
    setSelectedEntry(null);
    setScreen('browser');
  }, []);

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
