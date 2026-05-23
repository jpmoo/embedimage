import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import { replaceInPlace, insertAndTrack } from '../embedTracker';
import { downloadAndBake } from '../imageProcessor';
import { baseUrl, loadEmbedTrack, loadStreamConfig } from '../storage';
import { theme } from '../ui/theme';
import { TitleBar, Win95Frame, Win95InsetPanel } from '../ui/Win95';
import { DEFAULT_ADJUSTMENTS } from '../types';

const PROGRESS_SEGMENTS = 16;

export function RefreshScreen(): React.JSX.Element {
  const [status, setStatus] = useState<string>('Refreshing embed…');
  const tick = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(tick, {
        toValue: PROGRESS_SEGMENTS,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ).start();
  }, [tick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await loadStreamConfig();
        const url = baseUrl(cfg);
        if (!url) {
          setStatus('No server configured.\nOpen Embed Image → Settings.');
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
        setStatus(`FAILED: ${e?.message ?? e}`);
        setTimeout(() => PluginManager.closePluginView().catch(() => {}), 2500);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const segIndex = tick.interpolate({
    inputRange: [0, PROGRESS_SEGMENTS],
    outputRange: [0, PROGRESS_SEGMENTS],
  });

  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title="REFRESH.EXE" />
      <View style={styles.center}>
        <Win95Frame style={styles.dialog}>
          <Text style={styles.heading}>Refreshing embed…</Text>
          <Win95InsetPanel style={styles.progressInset}>
            <View style={styles.progressRow}>
              {Array.from({ length: PROGRESS_SEGMENTS }).map((_, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.segment,
                    {
                      opacity: segIndex.interpolate({
                        inputRange: [i - 1, i, i + 0.5, i + 1.5],
                        outputRange: [0.2, 1, 0.6, 0.2],
                        extrapolate: 'clamp',
                      }),
                    },
                  ]}
                />
              ))}
            </View>
          </Win95InsetPanel>
          <Text style={styles.msg}>{status}</Text>
        </Win95Frame>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  dialog: { padding: 16, minWidth: 320, gap: 12 },
  heading: { fontFamily: 'VT323', fontSize: 22, color: theme.text },
  progressInset: { padding: 4 },
  progressRow: { flexDirection: 'row', gap: 2 },
  segment: { flex: 1, height: 16, backgroundColor: theme.titleBg },
  msg: { fontFamily: 'VT323', fontSize: 16, color: theme.textMuted, textAlign: 'center' },
});
