import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { PluginManager, PluginNoteAPI } from 'sn-plugin-lib';
import { AdjustmentPanel } from '../AdjustmentPanel';
import { StatusDot } from '../StatusDot';
import { adjustmentsAreDefault, bakeFile, lanPostFile } from '../imageProcessor';
import { baseUrl, loadStreamConfig } from '../storage';
import { theme } from '../ui/theme';
import { StatusBar, TitleBar, Win95Button, Win95InsetPanel } from '../ui/Win95';
import { useConnStatus } from '../useConnStatus';
import { Adjustments, DEFAULT_ADJUSTMENTS, DEFAULT_STREAM_CONFIG, Entry, StreamConfig } from '../types';

const PREVIEW_MAX_DIM = 800;

function isPng(name: string): boolean {
  return name.toLowerCase().endsWith('.png');
}

export function PreviewScreen({
  entry,
  onBack,
}: {
  entry: Entry;
  onBack: () => void;
}): React.JSX.Element {
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>(entry.name);
  const [bgRemovedPath, setBgRemovedPath] = useState<string | null>(null);
  const [streamCfg, setStreamCfg] = useState<StreamConfig>(DEFAULT_STREAM_CONFIG);
  const connStatus = useConnStatus(baseUrl(streamCfg));

  useEffect(() => {
    loadStreamConfig().then(setStreamCfg).catch(() => {});
  }, []);

  // Debounced preview bake.
  useEffect(() => {
    const allDefault = adjustmentsAreDefault(adjustments);
    if (allDefault && isPng(entry.name)) {
      setPreviewPath(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setPreviewing(true);
      bakeFile(entry.path, adjustments, PREVIEW_MAX_DIM)
        .then((p) => {
          if (!cancelled) setPreviewPath(p);
        })
        .catch((e: any) => {
          if (!cancelled) setStatus(`preview failed: ${e?.message ?? e}`);
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [entry, adjustments]);

  const onInsert = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus(`embedding ${entry.name}…`);
    try {
      const allDefault = adjustmentsAreDefault(adjustments);
      const sourcePath = bgRemovedPath ?? entry.path;
      // Skip bake if no adjustments and the source is already a PNG (the
      // BiRefNet output is PNG too, so this branch covers that as well).
      const needsBake = !allDefault || (!bgRemovedPath && !isPng(entry.name));
      let pathToInsert = sourcePath;
      if (needsBake) {
        try {
          pathToInsert = await bakeFile(sourcePath, adjustments, 0);
        } catch (e: any) {
          setStatus(`process failed: ${e?.message ?? e}`);
          return;
        }
      }
      const res: any = await PluginNoteAPI.insertImage(pathToInsert);
      if (!res || res.success === false) {
        setStatus(`insert failed: ${res?.error?.message ?? 'unknown'}`);
        return;
      }
      try { await PluginNoteAPI.saveCurrentNote(); } catch {}
      try {
        ToastAndroid.showWithGravity(`Embedded ${entry.name}`, ToastAndroid.SHORT, ToastAndroid.BOTTOM);
      } catch {}
      PluginManager.closePluginView().catch(() => {});
    } catch (err: any) {
      setStatus(`insert threw: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [entry, adjustments, busy, bgRemovedPath]);

  const onRemoveBg = useCallback(async () => {
    if (busy) return;
    const url = baseUrl(streamCfg);
    if (!url) {
      setStatus('no Mac server configured — set it in Settings');
      return;
    }
    setBusy(true);
    setStatus('removing background via BiRefNet (Mac side)…');
    try {
      const outPath = await lanPostFile(`${url}/birefnet?bg=white`, entry.path, 'image/png', 120000);
      setBgRemovedPath(outPath);
      setPreviewPath(outPath);
      setStatus('background removed. Insert to embed.');
    } catch (e: any) {
      setStatus(`Remove BG failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [busy, streamCfg, entry.path]);

  const sourceUri = 'file://' + (previewPath ?? bgRemovedPath ?? entry.path);

  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title={`PREVIEW.EXE — ${entry.name}`} onClose={onBack} />
      <View style={styles.statusStrip}>
        <Text style={styles.statusTxt} numberOfLines={1}>{status}</Text>
        {previewing ? <ActivityIndicator size="small" color={theme.text} /> : null}
        <StatusDot status={connStatus} />
      </View>

      <Win95InsetPanel style={styles.previewArea}>
        <Image source={{ uri: sourceUri }} style={styles.previewImg} resizeMode="contain" />
      </Win95InsetPanel>

      <AdjustmentPanel values={adjustments} onChange={setAdjustments} disabled={busy} />

      <View style={styles.actionRow}>
        <Win95Button onPress={onBack} disabled={busy}>Cancel</Win95Button>
        <View style={{ flex: 1 }} />
        <Win95Button onPress={onRemoveBg} disabled={busy || !baseUrl(streamCfg)}>Remove BG</Win95Button>
        <Win95Button onPress={onInsert} disabled={busy} primary>Insert</Win95Button>
      </View>

      <StatusBar>{baseUrl(streamCfg) || 'no Mac server set'}</StatusBar>

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
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 8, paddingVertical: 2,
    backgroundColor: theme.bg,
  },
  statusTxt: { flex: 1, fontFamily: 'VT323', fontSize: 14, color: theme.text },
  previewArea: {
    flex: 1, margin: 6,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImg: { width: '100%', height: '100%' },
  actionRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 6, paddingVertical: 6,
    alignItems: 'center', backgroundColor: theme.bg,
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(192,192,192,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
});
