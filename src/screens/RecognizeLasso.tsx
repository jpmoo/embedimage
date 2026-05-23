import React, { useEffect, useState } from 'react';
import { Animated, Easing, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { PluginManager, PluginNoteAPI } from 'sn-plugin-lib';
import { recognizeLasso } from '../lassoRecognize';
import { theme } from '../ui/theme';
import { TitleBar, Win95Frame, Win95InsetPanel } from '../ui/Win95';
import { FileLogger } from '../util/FileLogger';

// Inkling's killer feature, blended in: lasso some handwriting, tap
// "Recognize" in the lasso menu, it OCRs the strokes and drops typed
// text into the note. Headless-ish flow like Refresh.

const PROGRESS_SEGMENTS = 16;

export function RecognizeLasso(): React.JSX.Element {
  const [status, setStatus] = useState<string>('Recognizing lasso…');
  const tick = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(tick, {
        toValue: PROGRESS_SEGMENTS, duration: 1600,
        easing: Easing.linear, useNativeDriver: false,
      }),
    ).start();
  }, [tick]);

  useEffect(() => {
    let cancelled = false;
    const WATCHDOG_MS = 25000;
    const watchdog = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setStatus('Timed out. Closing…');
      setTimeout(() => PluginManager.closePluginView().catch(() => {}), 1200);
    }, WATCHDOG_MS);

    (async () => {
      try {
        FileLogger.log('Recognize', 'screen mounted');
        setStatus('Reading lasso content…');
        const res = await recognizeLasso();
        FileLogger.log('Recognize', 'result', { text: res.text, stats: res.stats, hasRect: !!res.insertRect });
        if (cancelled) return;

        if (!res.text) {
          setStatus(
            res.stats.strokes === 0
              ? 'Nothing to recognize.\nLasso some handwriting first.'
              : 'OCR returned empty. Try a clearer hand.',
          );
          setTimeout(() => PluginManager.closePluginView().catch(() => {}), 2800);
          return;
        }

        setStatus(`Inserting (${res.text.length} chars)…`);
        const rect = res.insertRect ?? { left: 200, top: 200, right: 1800, bottom: 290 };
        const ins: any = await PluginNoteAPI.insertText({
          textContentFull: res.text,
          textRect: rect,
          fontSize: 36,
          textAlign: 0,
          textBold: 0,
          textItalics: 0,
          textFrameWidthType: 0,
          textFrameStyle: 0,
          textEditable: 1,
        } as any);
        FileLogger.log('Recognize', 'insertText ->', ins);
        if (!ins || ins.success === false) {
          setStatus(`Insert failed: ${ins?.error?.message ?? 'unknown'}`);
          setTimeout(() => PluginManager.closePluginView().catch(() => {}), 3000);
          return;
        }
        try { await PluginNoteAPI.saveCurrentNote(); } catch {}
        if (cancelled) return;
        setStatus(`Recognized ${res.text.length} chars`);
        setTimeout(() => PluginManager.closePluginView().catch(() => {}), 800);
      } catch (e: any) {
        FileLogger.log('Recognize', 'threw', e?.message ?? String(e));
        if (cancelled) return;
        setStatus(`Failed: ${e?.message ?? e}`);
        setTimeout(() => PluginManager.closePluginView().catch(() => {}), 2800);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, []);

  const segIndex = tick.interpolate({
    inputRange: [0, PROGRESS_SEGMENTS], outputRange: [0, PROGRESS_SEGMENTS],
  });

  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title="OCR.EXE — Recognize Lasso" />
      <View style={styles.center}>
        <Win95Frame style={styles.dialog}>
          <Text style={styles.heading}>Recognizing handwriting…</Text>
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
