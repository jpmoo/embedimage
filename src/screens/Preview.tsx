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
      <View style={styles.header}>
        <Pressable style={styles.btn} onPress={onBack} disabled={busy}>
          <Text style={styles.btnTxt}>Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{entry.name}</Text>
        {previewing ? <ActivityIndicator size="small" color="#000" /> : null}
        <StatusDot status={connStatus} />
      </View>

      <Text style={styles.status} numberOfLines={1}>{status}</Text>

      <View style={styles.previewArea}>
        <Image source={{ uri: sourceUri }} style={styles.previewImg} resizeMode="contain" />
      </View>

      <AdjustmentPanel values={adjustments} onChange={setAdjustments} disabled={busy} />

      <View style={styles.actionRow}>
        <Pressable style={styles.actionBtn} onPress={onBack} disabled={busy}>
          <Text style={styles.btnTxt}>Cancel</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={onRemoveBg}
          disabled={busy || !baseUrl(streamCfg)}
        >
          <Text style={styles.btnTxt}>Remove BG</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.actionBtnPrimary]}
          onPress={onInsert}
          disabled={busy}
        >
          <Text style={[styles.btnTxt, styles.btnTxtPrimary]}>Insert</Text>
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
  btnTxt: { fontSize: 14, color: '#000' },
  btnTxtPrimary: { color: '#fff' },
  previewArea: {
    flex: 1, backgroundColor: '#fff', margin: 12,
    borderWidth: 1, borderColor: '#000',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImg: { width: '100%', height: '100%' },
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
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
});
