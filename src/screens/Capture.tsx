import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import { AdjustmentPanel } from '../AdjustmentPanel';
import { StatusDot } from '../StatusDot';
import { downloadAndBake, lanHttp, lanJson, lanPostFile } from '../imageProcessor';
import { insertAndTrack, replaceInPlace } from '../embedTracker';
import { baseUrl, saveStreamConfig } from '../storage';
import { theme } from '../ui/theme';
import { MenuBar, StatusBar, TitleBar, Win95Button, Win95InsetPanel } from '../ui/Win95';
import { useConnStatus } from '../useConnStatus';
import {
  Adjustments,
  DEFAULT_ADJUSTMENTS,
  EmbedTrack,
  LogEntry,
  StreamConfig,
} from '../types';

// During live capture the Mac server bakes adjustments into each frame
// before sending, so the Supernote-side bake should be identity. This
// trips the native module's fast path (no per-pixel loop).
const IDENTITY_ADJUSTMENTS: Adjustments = DEFAULT_ADJUSTMENTS;

const PREVIEW_MAX_DIM = 800;
const MIN_INTERVAL_SEC = 0.2;
const MAX_INTERVAL_SEC = 60;
const MAX_LOG_LINES = 12;
const INTERVAL_STEP = 0.5;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function nowHHMMSS(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function CaptureScreen({
  config,
  onConfigChange,
  onBack,
  onOpenSettings,
  onOpenSourcePicker,
}: {
  config: StreamConfig;
  onConfigChange: (cfg: StreamConfig) => void;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenSourcePicker: () => void;
}): React.JSX.Element {
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [capturing, setCapturing] = useState(false);
  const [framePath, setFramePath] = useState<string | null>(null);
  const [lastFrameTs, setLastFrameTs] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [track, setTrack] = useState<EmbedTrack | null>(null);
  const [intervalSec, setIntervalSec] = useState<number>(config.intervalSec);
  const [resolutionMul, setResolutionMul] = useState<number>(config.resolutionMul);
  const inFlight = useRef(false);
  const connStatus = useConnStatus(baseUrl(config));

  const pushLog = useCallback((msg: string) => {
    setLogs((prev) => {
      const next = prev.concat([{ ts: Date.now(), msg }]);
      return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
    });
  }, []);

  const url = baseUrl(config);

  // Debounced push of adjustments to the Mac server. The server applies
  // them to each captured frame; the Supernote-side bake then runs an
  // identity pass and skips the per-pixel loop.
  useEffect(() => {
    if (!url) return;
    const timer = setTimeout(() => {
      lanHttp('POST', `${url}/adjust`, adjustments, 2000).catch((e: any) => {
        pushLog(`adjust push failed: ${e?.message ?? e}`);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [adjustments, url, pushLog]);

  const fetchOnce = useCallback(async (): Promise<string | null> => {
    if (!url) {
      pushLog('no server configured — open Settings');
      return null;
    }
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      const path = await downloadAndBake(
        `${url}/frame`,
        IDENTITY_ADJUSTMENTS,
        PREVIEW_MAX_DIM,
        Math.max(2000, Math.round(intervalSec * 1500)),
      );
      setFramePath(path);
      setLastFrameTs(Date.now());
      return path;
    } catch (e: any) {
      pushLog(`fetch failed: ${e?.message ?? e}`);
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [url, intervalSec, pushLog]);

  // Capture polling loop.
  useEffect(() => {
    if (!capturing) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (!alive) return;
      await fetchOnce();
      if (!alive) return;
      timer = setTimeout(tick, Math.max(MIN_INTERVAL_SEC, intervalSec) * 1000);
    };
    pushLog(`start @ ${intervalSec}s — ${url || '(no server)'}`);
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      pushLog('pause');
    };
  }, [capturing, intervalSec, fetchOnce, pushLog, url]);

  // Re-bake the most recent raw frame when adjustments change while paused.
  // (When running, the next tick naturally picks up new adjustments.)
  // Skipped to keep the implementation simple — adjustments take effect on
  // the next captured frame.

  const onTogglePolling = useCallback(() => {
    setCapturing((c) => !c);
  }, []);

  const onCheckStatus = useCallback(async () => {
    if (!url) {
      pushLog('no server configured');
      return;
    }
    try {
      const j: any = await lanJson('GET', `${url}/status`, undefined, 3000);
      pushLog(`status: running=${j.running}, src=${j.source}, ip=${j.ip ?? '?'}`);
    } catch (e: any) {
      pushLog(`status failed: ${e?.message ?? e}`);
    }
  }, [url, pushLog]);

  const changeInterval = useCallback(
    (delta: number) => {
      const next = clamp(
        Math.round((intervalSec + delta) * 10) / 10,
        MIN_INTERVAL_SEC,
        MAX_INTERVAL_SEC,
      );
      if (next === intervalSec) return;
      setIntervalSec(next);
      const cfg = { ...config, intervalSec: next };
      onConfigChange(cfg);
      saveStreamConfig(cfg).catch(() => {});
    },
    [intervalSec, config, onConfigChange],
  );

  const changeResolutionMul = useCallback(
    (delta: number) => {
      const next = Math.round(clamp(resolutionMul + delta, 0.1, 1.0) * 10) / 10;
      if (next === resolutionMul) return;
      setResolutionMul(next);
      const cfg = { ...config, resolutionMul: next };
      onConfigChange(cfg);
      saveStreamConfig(cfg).catch(() => {});
      if (url) {
        lanHttp('POST', `${url}/resolution`, { mul: next }, 2000).catch((e: any) =>
          pushLog(`resolution push failed: ${e?.message ?? e}`),
        );
      }
    },
    [resolutionMul, config, onConfigChange, url, pushLog],
  );

  // Send the current resolution to the server when we first connect or
  // when the URL changes. Also send when adjustments are pushed but the
  // server hasn't been told yet.
  useEffect(() => {
    if (!url) return;
    lanHttp('POST', `${url}/resolution`, { mul: resolutionMul }, 2000).catch(() => {});
    // intentionally only on URL change — interactive changes go through
    // changeResolutionMul above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const onRemoveBg = useCallback(async () => {
    if (busy || !framePath) return;
    if (capturing) {
      pushLog('pause first — Remove BG only works on a still frame');
      return;
    }
    setBusy(true);
    pushLog('removing background via BiRefNet…');
    try {
      const outPath = await lanPostFile(`${url}/birefnet?bg=white`, framePath, 'image/png', 120000);
      setFramePath(outPath);
      setLastFrameTs(Date.now());
      pushLog('background removed (still frame). Insert or Replace to embed.');
    } catch (e: any) {
      pushLog(`Remove BG failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [busy, framePath, capturing, url, pushLog]);

  const onInsert = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    pushLog('insert: baking full-res…');
    try {
      const fullPath = await downloadAndBake(`${url}/frame`, IDENTITY_ADJUSTMENTS, 0, 8000);
      const newTrack = await insertAndTrack(fullPath);
      if (newTrack) {
        setTrack(newTrack);
        pushLog(`insert ok — num=${newTrack.numInPage}`);
      } else {
        pushLog('insert ok — couldn’t resolve element (Replace disabled)');
      }
      try {
        ToastAndroid.showWithGravity('Inserted frame', ToastAndroid.SHORT, ToastAndroid.BOTTOM);
      } catch {}
    } catch (e: any) {
      pushLog(`insert failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [busy, url, pushLog]);

  const onReplace = useCallback(async () => {
    if (busy || !track) return;
    setBusy(true);
    pushLog('replace: baking full-res…');
    try {
      const fullPath = await downloadAndBake(`${url}/frame`, IDENTITY_ADJUSTMENTS, 0, 8000);
      const newTrack = await replaceInPlace(track, fullPath);
      if (newTrack) {
        setTrack(newTrack);
        pushLog(`replace ok — num=${newTrack.numInPage}`);
      } else {
        pushLog('replace done — tracker reset');
        setTrack(null);
      }
    } catch (e: any) {
      pushLog(`replace failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [busy, track, url, pushLog]);

  // "Back" returns to the file browser (existing flow).
  const onBackToBrowser = useCallback(() => {
    setCapturing(false);
    onBack();
  }, [onBack]);

  // "Close" exits the plugin entirely, back to the note canvas — the user
  // asked for this so they can resume drawing without going via Browser.
  const onCloseToCanvas = useCallback(() => {
    setCapturing(false);
    PluginManager.closePluginView().catch(() => {});
  }, []);

  // "Replace & Close": one-tap refresh + back to canvas. Falls back to
  // Insert if there's no tracked embed yet.
  const onReplaceAndClose = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    pushLog(track ? 'replace+close: baking…' : 'insert+close: baking…');
    try {
      const fullPath = await downloadAndBake(`${url}/frame`, IDENTITY_ADJUSTMENTS, 0, 8000);
      if (track) {
        await replaceInPlace(track, fullPath);
      } else {
        await insertAndTrack(fullPath);
      }
      setCapturing(false);
      await PluginManager.closePluginView().catch(() => {});
    } catch (e: any) {
      pushLog(`failed: ${e?.message ?? e}`);
      setBusy(false);
    }
  }, [busy, track, url, pushLog]);

  const sourceUri = framePath ? 'file://' + framePath : null;
  const ageSec = lastFrameTs ? Math.round((Date.now() - lastFrameTs) / 1000) : null;

  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title="LIVE.EXE - Mac Capture" onClose={onCloseToCanvas} />
      <MenuBar
        menus={[
          {
            label: 'Stream',
            items: [
              { label: capturing ? 'Pause' : 'Start', onPress: onTogglePolling },
              { label: 'Pull once', onPress: () => fetchOnce(), disabled: !url },
              { separator: true, label: '' },
              { label: 'Check status', onPress: onCheckStatus, disabled: !url },
              { label: 'Close (back to canvas)', onPress: onCloseToCanvas },
              { label: 'Back to Browser', onPress: onBackToBrowser },
            ],
          },
          {
            label: 'Source',
            items: [
              { label: 'Pick screen / window / region…', onPress: onOpenSourcePicker, disabled: !url },
            ],
          },
          {
            label: 'Image',
            items: [
              { label: 'Remove background (still only)', onPress: onRemoveBg, disabled: !framePath || capturing },
              { separator: true, label: '' },
              { label: 'Settings…', onPress: onOpenSettings },
            ],
          },
        ]}
      />

      <View style={styles.statusStrip}>
        <Text style={styles.statusStripTxt} numberOfLines={1}>
          {url || '(no server set)'} · {intervalSec.toFixed(1)}s · {Math.round(resolutionMul * 100)}% ·{' '}
          {lastFrameTs ? `frame ${ageSec}s ago` : 'no frame yet'}{track ? ' · EMBED' : ''}
        </Text>
        <StatusDot status={connStatus} />
      </View>

      <Win95InsetPanel style={styles.previewArea}>
        {sourceUri ? (
          <Image source={{ uri: sourceUri }} style={styles.previewImg} resizeMode="contain" />
        ) : (
          <Text style={styles.placeholder}>
            {capturing ? 'waiting for first frame…' : 'STREAM → Start to begin'}
          </Text>
        )}
      </Win95InsetPanel>

      <View style={styles.controlBar}>
        <Win95Button small onPress={onTogglePolling} disabled={busy} active={capturing}>
          {capturing ? 'Pause' : 'Start'}
        </Win95Button>
        <Win95Button small onPress={() => fetchOnce()} disabled={busy || !url}>Pull</Win95Button>
        <Win95Button small onPress={onRemoveBg} disabled={busy || !framePath || capturing}>Rm BG</Win95Button>
        <View style={{ flex: 1 }} />
        <Text style={styles.dim}>Interval</Text>
        <Win95Button small onPress={() => changeInterval(-INTERVAL_STEP)} disabled={busy}>−</Win95Button>
        <Text style={styles.fieldVal}>{intervalSec.toFixed(1)}s</Text>
        <Win95Button small onPress={() => changeInterval(+INTERVAL_STEP)} disabled={busy}>+</Win95Button>
      </View>

      <View style={styles.controlBar}>
        <Win95Button small onPress={onOpenSourcePicker} disabled={busy || !url}>Source…</Win95Button>
        <Win95Button small onPress={onCheckStatus} disabled={busy || !url}>Status</Win95Button>
        <View style={{ flex: 1 }} />
        <Text style={styles.dim}>Res</Text>
        <Win95Button small onPress={() => changeResolutionMul(-0.1)} disabled={busy}>−</Win95Button>
        <Text style={styles.fieldVal}>{Math.round(resolutionMul * 100)}%</Text>
        <Win95Button small onPress={() => changeResolutionMul(+0.1)} disabled={busy}>+</Win95Button>
      </View>

      <AdjustmentPanel values={adjustments} onChange={setAdjustments} disabled={busy} />

      <Win95InsetPanel style={styles.logBox}>
        <ScrollView contentContainerStyle={styles.logScroll}>
          {logs.length === 0 ? (
            <Text style={styles.logEmpty}>C:\&gt;_ logs will appear here…</Text>
          ) : (
            logs.map((e, i) => (
              <Text key={`${e.ts}-${i}`} style={styles.logLine} numberOfLines={2}>
                {nowHHMMSS()} {e.msg}
              </Text>
            ))
          )}
        </ScrollView>
      </Win95InsetPanel>

      <View style={styles.actionRow}>
        <Win95Button onPress={onCloseToCanvas} disabled={busy}>Close</Win95Button>
        <View style={{ flex: 1 }} />
        <Win95Button onPress={onInsert} disabled={busy || !framePath}>Insert</Win95Button>
        <Win95Button onPress={onReplace} disabled={busy || !track || !framePath}>Replace</Win95Button>
        <Win95Button onPress={onReplaceAndClose} disabled={busy || !framePath} primary>
          {track ? 'Replace & Close' : 'Insert & Close'}
        </Win95Button>
      </View>

      {busy ? (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={theme.text} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  statusStrip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.bg,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  statusStripTxt: { flex: 1, fontFamily: 'VT323', fontSize: 14, color: theme.text },
  previewArea: {
    flex: 1, margin: 6,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImg: { width: '100%', height: '100%' },
  placeholder: { fontFamily: 'VT323', fontSize: 18, color: theme.textMuted, padding: 16 },
  controlBar: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 3,
    backgroundColor: theme.bg,
  },
  dim: { fontFamily: 'VT323', fontSize: 14, color: theme.text, marginHorizontal: 4 },
  fieldVal: {
    fontFamily: 'VT323', fontSize: 14, color: theme.text,
    minWidth: 44, textAlign: 'center',
  },
  logBox: {
    height: 100, marginHorizontal: 6, marginVertical: 4,
    paddingHorizontal: 4,
  },
  logScroll: { paddingVertical: 4 },
  logEmpty: { fontFamily: 'VT323', fontSize: 14, color: theme.shadow },
  logLine: { fontFamily: 'VT323', fontSize: 14, color: theme.text },
  actionRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 6, paddingVertical: 6,
    backgroundColor: theme.bg, alignItems: 'center',
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(192,192,192,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
});
