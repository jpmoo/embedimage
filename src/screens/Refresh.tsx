import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import { replaceInPlace, insertAndTrack } from '../embedTracker';
import { downloadAndBake } from '../imageProcessor';
import { baseUrl, loadEmbedTrack, loadStreamConfig } from '../storage';
import { DEFAULT_ADJUSTMENTS } from '../types';

// Headless-ish: opens briefly when the "Refresh Embed" sidebar button is
// tapped, fetches the latest frame from the configured Mac server, and
// replaces (or inserts) the embedded image, then closes the plugin view.
export function RefreshScreen(): React.JSX.Element {
  const [status, setStatus] = useState<string>('refreshing…');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await loadStreamConfig();
        const url = baseUrl(cfg);
        if (!url) {
          setStatus('no server configured — open Embed Image → Settings');
          setTimeout(() => PluginManager.closePluginView().catch(() => {}), 2500);
          return;
        }
        const track = await loadEmbedTrack();
        const fullPath = await downloadAndBake(`${url}/frame`, DEFAULT_ADJUSTMENTS, 0, 8000);
        if (cancelled) return;
        if (track) {
          await replaceInPlace(track, fullPath);
        } else {
          await insertAndTrack(fullPath);
        }
        if (cancelled) return;
        await PluginManager.closePluginView().catch(() => {});
      } catch (e: any) {
        setStatus(`failed: ${e?.message ?? e}`);
        setTimeout(() => PluginManager.closePluginView().catch(() => {}), 2500);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <ActivityIndicator size="large" color="#000" />
      <Text style={styles.txt}>{status}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', gap: 16 },
  txt: { fontSize: 14, color: '#000' },
});
