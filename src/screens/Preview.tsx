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
import { adjustmentsAreDefault, bakeFile } from '../imageProcessor';
import { Adjustments, DEFAULT_ADJUSTMENTS, Entry } from '../types';

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
      const needsBake = !allDefault || !isPng(entry.name);
      let pathToInsert = entry.path;
      if (needsBake) {
        try {
          pathToInsert = await bakeFile(entry.path, adjustments, 0);
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
  }, [entry, adjustments, busy]);

  const sourceUri = 'file://' + (previewPath ?? entry.path);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.btn} onPress={onBack} disabled={busy}>
          <Text style={styles.btnTxt}>Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{entry.name}</Text>
        {previewing ? <ActivityIndicator size="small" color="#000" /> : null}
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
