import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  GestureResponderEvent,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { lanHttp, lanJson } from '../imageProcessor';
import { MacWindow, Region } from '../types';

// Lets the user pick a capture source (full screen / window / region)
// directly from the Manta. For "region" we pull a downscaled snapshot of
// the Mac primary monitor and let the user drag a rectangle on the
// touchscreen; coordinates are mapped back to Mac pixels via the
// X-Mon-* / X-Scale headers returned by /preview-shot.

type Mode = 'menu' | 'window' | 'region';

export function SourcePicker({
  baseUrl,
  onClose,
  onChanged,
}: {
  baseUrl: string;
  onClose: () => void;
  onChanged: (label: string) => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [windows, setWindows] = useState<MacWindow[]>([]);
  const [shotUri, setShotUri] = useState<string | null>(null);
  const [shotInfo, setShotInfo] = useState<{
    monLeft: number; monTop: number; monW: number; monH: number; scale: number;
    previewW: number; previewH: number;
  } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);

  const postSource = useCallback(async (payload: object, label: string) => {
    setBusy(true);
    try {
      await lanHttp('POST', `${baseUrl}/source`, payload, 3000);
      onChanged(label);
      onClose();
    } catch (e: any) {
      setStatus(`failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [baseUrl, onChanged, onClose]);

  const onPickScreen = useCallback(() => {
    postSource({ source: 'screen', monitor_index: 1 }, 'Full screen');
  }, [postSource]);

  const openWindowList = useCallback(async () => {
    setMode('window');
    setBusy(true);
    setStatus('loading windows…');
    try {
      const list: any = await lanJson('GET', `${baseUrl}/windows`, undefined, 3000);
      setWindows(Array.isArray(list) ? list : []);
      setStatus(`${Array.isArray(list) ? list.length : 0} windows`);
    } catch (e: any) {
      setStatus(`failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [baseUrl]);

  const openRegion = useCallback(async () => {
    setMode('region');
    setBusy(true);
    setStatus('grabbing screenshot from Mac…');
    try {
      const { downloadAndBake } = await import('../imageProcessor');
      const { DEFAULT_ADJUSTMENTS } = await import('../types');
      const previewMax = 700;
      const path = await downloadAndBake(
        `${baseUrl}/preview-shot?max=${previewMax}`,
        DEFAULT_ADJUSTMENTS,
        0,
        8000,
      );
      const st: any = await lanJson('GET', `${baseUrl}/status`, undefined, 3000);
      const mon = st?.monitor ?? { left: 0, top: 0, width: 0, height: 0 };
      setShotUri('file://' + path);
      Image.getSize('file://' + path, (pw, ph) => {
        const monLong = Math.max(mon.width || 0, mon.height || 0) || Math.max(pw, ph);
        const scale = monLong > 0 ? pw / (mon.width || pw) : 1.0;
        setShotInfo({
          monLeft: mon.left || 0,
          monTop: mon.top || 0,
          monW: mon.width || pw,
          monH: mon.height || ph,
          scale: scale > 0 ? scale : 1.0,
          previewW: pw,
          previewH: ph,
        });
        setStatus(`drag a region · mac ${mon.width}×${mon.height}`);
      }, () => setStatus('failed to read screenshot'));
    } catch (e: any) {
      setStatus(`failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [baseUrl]);

  const previewLayout = useMemo(() => {
    if (!shotInfo) return null;
    return { width: shotInfo.previewW, height: shotInfo.previewH };
  }, [shotInfo]);

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    setDragStart({ x: locationX, y: locationY });
    setDragEnd({ x: locationX, y: locationY });
  }, []);
  const onTouchMove = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    setDragEnd({ x: locationX, y: locationY });
  }, []);
  const onTouchEnd = useCallback(() => {
    // no-op; selection committed by "Use selection" button.
  }, []);

  const selectionRect = useMemo(() => {
    if (!dragStart || !dragEnd) return null;
    const x = Math.min(dragStart.x, dragEnd.x);
    const y = Math.min(dragStart.y, dragEnd.y);
    const w = Math.abs(dragEnd.x - dragStart.x);
    const h = Math.abs(dragEnd.y - dragStart.y);
    if (w < 8 || h < 8) return null;
    return { x, y, w, h };
  }, [dragStart, dragEnd]);

  const onUseRegion = useCallback(() => {
    if (!selectionRect || !shotInfo) return;
    const invScale = 1.0 / shotInfo.scale;
    const region: Region = {
      x: Math.round(shotInfo.monLeft + selectionRect.x * invScale),
      y: Math.round(shotInfo.monTop + selectionRect.y * invScale),
      w: Math.round(selectionRect.w * invScale),
      h: Math.round(selectionRect.h * invScale),
    };
    postSource({ source: 'region', region }, `Region ${region.w}×${region.h}`);
  }, [selectionRect, shotInfo, postSource]);

  if (mode === 'menu') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.btn} onPress={onClose}>
            <Text style={styles.btnTxt}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Mac source</Text>
        </View>
        <View style={styles.body}>
          <Pressable style={styles.bigBtn} onPress={onPickScreen} disabled={busy}>
            <Text style={styles.bigBtnTxt}>Full screen</Text>
          </Pressable>
          <Pressable style={styles.bigBtn} onPress={openWindowList} disabled={busy}>
            <Text style={styles.bigBtnTxt}>Window…</Text>
          </Pressable>
          <Pressable style={styles.bigBtn} onPress={openRegion} disabled={busy}>
            <Text style={styles.bigBtnTxt}>Region (drag on preview)</Text>
          </Pressable>
          {!!status && <Text style={styles.status}>{status}</Text>}
        </View>
        {busy ? <View style={styles.overlay}><ActivityIndicator size="large" color="#000" /></View> : null}
      </SafeAreaView>
    );
  }

  if (mode === 'window') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.btn} onPress={() => setMode('menu')}>
            <Text style={styles.btnTxt}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Pick window</Text>
        </View>
        <Text style={styles.status}>{status}</Text>
        <FlatList
          data={windows}
          keyExtractor={(w) => String(w.id)}
          renderItem={({ item }) => (
            <Pressable
              style={styles.windowRow}
              onPress={() => postSource({ source: 'window', window_id: item.id }, `${item.owner}`)}
              disabled={busy}
            >
              <Text style={styles.windowOwner}>{item.owner || '(unknown)'}</Text>
              <Text style={styles.windowTitle} numberOfLines={1}>
                {item.title || '(no title)'} · {item.w}×{item.h}
              </Text>
            </Pressable>
          )}
        />
        {busy ? <View style={styles.overlay}><ActivityIndicator size="large" color="#000" /></View> : null}
      </SafeAreaView>
    );
  }

  // region mode
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.btn} onPress={() => setMode('menu')}>
          <Text style={styles.btnTxt}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Drag region</Text>
      </View>
      <Text style={styles.status}>{status}</Text>
      <View style={styles.previewWrap}>
        {shotUri && previewLayout ? (
          <View
            style={[styles.previewBox, previewLayout]}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={onTouchStart}
            onResponderMove={onTouchMove}
            onResponderRelease={onTouchEnd}
          >
            <Image source={{ uri: shotUri }} style={previewLayout} />
            {selectionRect ? (
              <View
                style={[
                  styles.selRect,
                  {
                    left: selectionRect.x,
                    top: selectionRect.y,
                    width: selectionRect.w,
                    height: selectionRect.h,
                  },
                ]}
              />
            ) : null}
          </View>
        ) : (
          <ActivityIndicator size="large" color="#000" />
        )}
      </View>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => { setDragStart(null); setDragEnd(null); }}>
          <Text style={styles.btnTxt}>Clear</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          style={[styles.btn, selectionRect && styles.btnActive]}
          onPress={onUseRegion}
          disabled={busy || !selectionRect}
        >
          <Text style={[styles.btnTxt, selectionRect && styles.btnTxtPrimary]}>Use selection</Text>
        </Pressable>
      </View>
      {busy ? <View style={styles.overlay}><ActivityIndicator size="large" color="#000" /></View> : null}
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
  status: { fontSize: 12, color: '#444', paddingHorizontal: 16, paddingVertical: 6 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#000' },
  btnActive: { backgroundColor: '#000' },
  btnTxt: { fontSize: 14, color: '#000' },
  btnTxtPrimary: { color: '#fff' },
  body: { padding: 16, gap: 12 },
  bigBtn: {
    paddingVertical: 18, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#000', alignItems: 'center',
  },
  bigBtnTxt: { fontSize: 16, color: '#000' },
  windowRow: {
    paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  windowOwner: { fontSize: 15, color: '#000', fontWeight: '500' },
  windowTitle: { fontSize: 12, color: '#666', marginTop: 2 },
  previewWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  previewBox: { borderWidth: 1, borderColor: '#000', overflow: 'hidden' },
  selRect: {
    position: 'absolute',
    borderWidth: 2, borderColor: '#000',
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  row: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#ccc',
    alignItems: 'center',
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
});
