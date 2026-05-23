import React, { useCallback, useEffect, useState } from 'react';
import { PluginManager } from 'sn-plugin-lib';
import { checkPendingButton } from './pendingButton';
import { ImageProcessor } from './src/imageProcessor';
import { FileLogger } from './src/util/FileLogger';
import { BrowserScreen } from './src/screens/Browser';
import { CaptureScreen } from './src/screens/Capture';
import { DropInbox } from './src/screens/DropInbox';
import { PreviewScreen } from './src/screens/Preview';
import { LayerStitch } from './src/screens/LayerStitch';
import { RecognizeLasso } from './src/screens/RecognizeLasso';
import { RefreshScreen } from './src/screens/Refresh';
import { SettingsScreen } from './src/screens/Settings';
import { SourcePicker } from './src/screens/SourcePicker';
import { StitchEditor, makeSession, StitchSession } from './src/screens/StitchEditor';
import { baseUrl, loadStreamConfig } from './src/storage';
import { DEFAULT_STREAM_CONFIG, Entry, Screen, StreamConfig } from './src/types';

// Must match index.js. BUTTON_LASSO_SEND (4) is showType:0 — runs
// headlessly from index.js's button handler — so no route entry here.
const BUTTON_REFRESH = 2;
const BUTTON_DROP = 3;
const BUTTON_LASSO_RECOGNIZE = 5;
const BUTTON_LASSO_STITCH_LAYERS = 6;     // lasso-toolbar entry
const BUTTON_STITCH_LAYERS_SIDE = 7;      // sidebar entry (always-visible duplicate)

function initialScreenFromPendingButton(): Screen {
  const id = checkPendingButton();
  let chosen: Screen = 'browser';
  if (id === BUTTON_REFRESH) chosen = 'refresh';
  else if (id === BUTTON_DROP) chosen = 'dropinbox';
  else if (id === BUTTON_LASSO_RECOGNIZE) chosen = 'recognizelasso';
  else if (id === BUTTON_LASSO_STITCH_LAYERS) chosen = 'layerstitch';
  else if (id === BUTTON_STITCH_LAYERS_SIDE) chosen = 'layerstitch';
  FileLogger.raw('[embedimage] App initialScreen', { pendingId: id, chosen });
  return chosen;
}

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>(() => initialScreenFromPendingButton());
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [streamConfig, setStreamConfig] = useState<StreamConfig>(DEFAULT_STREAM_CONFIG);
  const [stitchSession, setStitchSession] = useState<StitchSession | null>(null);

  useEffect(() => {
    FileLogger.raw('[embedimage] App mounted');
    ImageProcessor?.cleanupCache?.().catch(() => {});
    (async () => {
      const cfg = await loadStreamConfig();
      setStreamConfig(cfg);
    })();

    const sub = PluginManager.registerButtonListener({
      onButtonPress: (msg: any) => {
        FileLogger.raw('[embedimage] App onButtonPress', { id: msg?.id });
        if (msg?.id === BUTTON_REFRESH) setScreen('refresh');
        else if (msg?.id === BUTTON_DROP) setScreen('dropinbox');
        else if (msg?.id === BUTTON_LASSO_RECOGNIZE) setScreen('recognizelasso');
        else if (msg?.id === BUTTON_LASSO_STITCH_LAYERS) setScreen('layerstitch');
        else if (msg?.id === BUTTON_STITCH_LAYERS_SIDE) setScreen('layerstitch');
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

  if (screen === 'dropinbox') {
    return <DropInbox onClose={goBrowser} />;
  }

  if (screen === 'recognizelasso') {
    return <RecognizeLasso />;
  }

  if (screen === 'layerstitch') {
    return <LayerStitch onClose={goBrowser} />;
  }

  if (screen === 'stitch' && stitchSession) {
    return (
      <StitchEditor
        session={stitchSession}
        onCancel={() => { setStitchSession(null); goBrowser(); }}
        onInserted={() => {
          setStitchSession(null);
          PluginManager.closePluginView().catch(() => {});
        }}
      />
    );
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
      onStitchReady={(session) => {
        setStitchSession(session);
        setScreen('stitch');
      }}
    />
  );
}
