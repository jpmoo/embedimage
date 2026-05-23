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
import { downloadAndBake, lanHttp, lanJson } from '../imageProcessor';
import { insertAndTrack, replaceInPlace } from '../embedTracker';
import { baseUrl, saveStreamConfig } from '../storage';
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
}: {
  config: StreamConfig;
  onConfigChange: (cfg: StreamConfig) => void;
  onBack: () => void;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [capturing, setCapturing] = useState(false);
  const [framePath, setFramePath] = useState<string | null>(null);
  const [lastFrameTs, setLastFrameTs] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [track, setTrack] = useState<EmbedTrack | null>(null);
  const [intervalSec, setIntervalSec] = useState<number>(config.intervalSec);
  const inFlight = useRef(false);

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

  const onClose = useCallback(() => {
    setCapturing(false);
    setTrack(null);
    onBack();
  }, [onBack]);

  const sourceUri = framePath ? 'file://' + framePath : null;
  const ageSec = lastFrameTs ? Math.round((Date.now() - lastFrameTs) / 1000) : null;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.btn} onPress={onClose} disabled={busy}>
          <Text style={styles.btnTxt}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Live Capture</Text>
        <Pressable style={styles.btn} onPress={onOpenSettings} disabled={busy}>
          <Text style={styles.btnTxt}>Settings</Text>
        </Pressable>
      </View>

      <Text style={styles.status} numberOfLines={1}>
        {url || '(no server set)'} · interval {intervalSec.toFixed(1)}s ·{' '}
        {lastFrameTs ? `last frame ${ageSec}s ago` : 'no frame yet'}
        {track ? ' · embedded' : ''}
      </Text>

      <View style={styles.previewArea}>
        {sourceUri ? (
          <Image source={{ uri: sourceUri }} style={styles.previewImg} resizeMode="contain" />
        ) : (
          <Text style={styles.placeholder}>
            {capturing ? 'waiting for first frame…' : 'tap Start to begin streaming'}
          </Text>
        )}
      </View>

      <View style={styles.controlBar}>
        <Pressable
          style={[styles.btn, capturing && styles.btnActive]}
          onPress={onTogglePolling}
          disabled={busy}
        >
          <Text style={[styles.btnTxt, capturing && styles.btnTxtPrimary]}>
            {capturing ? 'Pause' : 'Start'}
          </Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => fetchOnce()} disabled={busy || !url}>
          <Text style={styles.btnTxt}>Pull once</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={onCheckStatus} disabled={busy || !url}>
          <Text style={styles.btnTxt}>Status</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.btn} onPress={() => changeInterval(-INTERVAL_STEP)} disabled={busy}>
          <Text style={styles.btnTxt}>−</Text>
        </Pressable>
        <Text style={styles.intervalLabel}>{intervalSec.toFixed(1)}s</Text>
        <Pressable style={styles.btn} onPress={() => changeInterval(+INTERVAL_STEP)} disabled={busy}>
          <Text style={styles.btnTxt}>+</Text>
        </Pressable>
      </View>

      <AdjustmentPanel values={adjustments} onChange={setAdjustments} disabled={busy} />

      <View style={styles.logBox}>
        <ScrollView contentContainerStyle={styles.logScroll}>
          {logs.length === 0 ? (
            <Text style={styles.logEmpty}>logs will appear here…</Text>
          ) : (
            logs.map((e, i) => (
              <Text key={`${e.ts}-${i}`} style={styles.logLine} numberOfLines={2}>
                {nowHHMMSS()} {e.msg}
              </Text>
            ))
          )}
        </ScrollView>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={styles.actionBtn} onPress={onClose} disabled={busy}>
          <Text style={styles.btnTxt}>Close</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.actionBtnPrimary]}
          onPress={onInsert}
          disabled={busy || !framePath}
        >
          <Text style={[styles.btnTxt, styles.btnTxtPrimary]}>Insert</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, track ? styles.actionBtnPrimary : styles.actionBtnDisabled]}
          onPress={onReplace}
          disabled={busy || !track || !framePath}
        >
          <Text style={[styles.btnTxt, track && styles.btnTxtPrimary]}>Replace</Text>
        </Pressable>
      </View>

      {busy ? (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#000',
  },
  title: { flex: 1, fontSize: 22, fontWeight: '600', color: '#000' },
  status: {
    fontSize: 12, color: '#444',
    paddingHorizontal: 16, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#ddd',
  },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#000' },
  btnActive: { backgroundColor: '#000' },
  btnTxt: { fontSize: 14, color: '#000' },
  btnTxtPrimary: { color: '#fff' },
  previewArea: {
    flex: 1, backgroundColor: '#fff', margin: 12,
    borderWidth: 1, borderColor: '#000',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImg: { width: '100%', height: '100%' },
  placeholder: { fontSize: 14, color: '#666' },
  controlBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#ccc',
  },
  intervalLabel: { fontSize: 14, color: '#000', minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'] },
  logBox: {
    height: 110, marginHorizontal: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#bbb', backgroundColor: '#fafafa',
  },
  logScroll: { padding: 6 },
  logEmpty: { fontSize: 11, color: '#888' },
  logLine: { fontSize: 11, color: '#222', fontFamily: 'monospace' },
  actionRow: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#ccc',
  },
  actionBtn: {
    flex: 1, paddingVertical: 12,
    borderWidth: 1, borderColor: '#000',
    alignItems: 'center', justifyContent: 'center',
  },
  actionBtnPrimary: { backgroundColor: '#000' },
  actionBtnDisabled: { borderColor: '#ccc' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
});
