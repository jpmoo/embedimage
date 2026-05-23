import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  NativeModules,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { FileUtils, PluginManager, PluginNoteAPI } from 'sn-plugin-lib';

type SortKey = 'date_desc' | 'date_asc' | 'name';
type ImageItem = { name: string; path: string };

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg'];
const IMAGES_DIR = '/storage/emulated/0/Document/Images';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Newest' },
  { key: 'date_asc', label: 'Oldest' },
  { key: 'name', label: 'Name' },
];

const { ImageProcessor } = NativeModules as {
  ImageProcessor?: { processForEmbed: (inputPath: string, whiteAlpha: number) => Promise<string> };
};

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

function isImage(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

function isPng(name: string): boolean {
  return name.toLowerCase().endsWith('.png');
}

function sortItems(items: ImageItem[], sort: SortKey): ImageItem[] {
  const copy = items.slice();
  const byName = (a: ImageItem, b: ImageItem) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });
  if (sort === 'name') copy.sort(byName);
  else if (sort === 'date_asc') copy.sort(byName);
  else copy.sort((a, b) => byName(b, a));
  return copy;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function FadeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(width);
  widthRef.current = width;

  const update = useCallback(
    (x: number) => {
      const w = Math.max(1, widthRef.current);
      onChange(Math.round(clamp((x / w) * 100, 0, 100)));
    },
    [onChange],
  );

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => update(e.nativeEvent.locationX),
      onPanResponderMove: (e) => update(e.nativeEvent.locationX),
    }),
  ).current;

  return (
    <View
      style={styles.sliderTrack}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}
    >
      <View style={[styles.sliderFill, { width: `${value}%` }]} />
      <View style={[styles.sliderThumb, { left: `${value}%` }]} />
    </View>
  );
}

export default function App(): React.JSX.Element {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [sort, setSort] = useState<SortKey>('date_desc');
  const [status, setStatus] = useState<string>('starting…');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ImageItem | null>(null);
  const [fade, setFade] = useState(0);

  const load = useCallback(async () => {
    setStatus(`checking ${IMAGES_DIR}`);
    try {
      let exists = false;
      try {
        exists = await FileUtils.exists(IMAGES_DIR);
      } catch (e: any) {
        setStatus(`exists() threw: ${e?.message ?? e}`);
        return;
      }
      if (!exists) {
        setStatus('directory missing — creating');
        try {
          await FileUtils.makeDir(IMAGES_DIR);
        } catch (e: any) {
          setStatus(`makeDir() threw: ${e?.message ?? e}`);
          return;
        }
      }

      setStatus('listing files…');
      let entries: any = null;
      try {
        entries = await FileUtils.listFiles(IMAGES_DIR);
      } catch (e: any) {
        setStatus(`listFiles() threw: ${e?.message ?? e}`);
        return;
      }

      const list: any[] = Array.isArray(entries) ? entries : [];
      const imgs: ImageItem[] = [];
      for (const entry of list) {
        const path = typeof entry === 'string' ? entry : entry?.path;
        const type = typeof entry === 'string' ? 1 : entry?.type;
        if (!path || type === 0) continue;
        const name = basename(path);
        if (!isImage(name)) continue;
        imgs.push({ name, path });
      }
      setItems(imgs);
      setStatus(`found ${imgs.length} image${imgs.length === 1 ? '' : 's'} (raw entries: ${list.length})`);
    } catch (err: any) {
      setStatus(`unexpected: ${err?.message ?? err}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => sortItems(items, sort), [items, sort]);

  const openPreview = useCallback((item: ImageItem) => {
    setSelected(item);
    setFade(0);
  }, []);

  const closePreview = useCallback(() => {
    setSelected(null);
    setFade(0);
  }, []);

  const onInsert = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setStatus(`embedding ${selected.name}…`);
    try {
      const needsBake = fade > 0 || !isPng(selected.name);
      let pathToInsert = selected.path;

      if (needsBake) {
        if (!ImageProcessor?.processForEmbed) {
          setStatus('native ImageProcessor missing — rebuild plugin');
          return;
        }
        try {
          pathToInsert = await ImageProcessor.processForEmbed(selected.path, fade / 100);
        } catch (e: any) {
          setStatus(`process failed: ${e?.message ?? e}`);
          return;
        }
      }

      const res: any = await PluginNoteAPI.insertImage(pathToInsert);
      if (!res || res.success === false) {
        const msg = res?.error?.message ?? 'insertImage failed';
        setStatus(`insert failed: ${msg}`);
        return;
      }
      try { await PluginNoteAPI.saveCurrentNote(); } catch {}
      try {
        ToastAndroid.showWithGravity(`Embedded ${selected.name}`, ToastAndroid.SHORT, ToastAndroid.BOTTOM);
      } catch {}
      PluginManager.closePluginView().catch(() => {});
    } catch (err: any) {
      setStatus(`insert threw: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [selected, fade, busy]);

  if (selected) {
    const overlayOpacity = fade / 100;
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.btn} onPress={closePreview} disabled={busy}>
            <Text style={styles.btnTxt}>Back</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{selected.name}</Text>
        </View>

        <Text style={styles.status}>{status}</Text>

        <View style={styles.previewArea}>
          <Image
            source={{ uri: 'file://' + selected.path }}
            style={styles.previewImg}
            resizeMode="contain"
          />
          <View
            pointerEvents="none"
            style={[styles.previewOverlay, { opacity: overlayOpacity }]}
          />
        </View>

        <View style={styles.controlBar}>
          <Text style={styles.controlLabel}>Fade to white</Text>
          <Text style={styles.controlValue}>{fade}%</Text>
        </View>

        <View style={styles.sliderRow}>
          <Pressable style={styles.stepBtn} onPress={() => setFade((v) => clamp(v - 5, 0, 100))} disabled={busy}>
            <Text style={styles.btnTxt}>-</Text>
          </Pressable>
          <View style={styles.sliderWrap}>
            <FadeSlider value={fade} onChange={setFade} />
          </View>
          <Pressable style={styles.stepBtn} onPress={() => setFade((v) => clamp(v + 5, 0, 100))} disabled={busy}>
            <Text style={styles.btnTxt}>+</Text>
          </Pressable>
        </View>

        <View style={styles.presetRow}>
          {[0, 25, 50, 75, 90].map((p) => (
            <Pressable
              key={p}
              style={[styles.chip, p === fade && styles.chipActive]}
              onPress={() => setFade(p)}
              disabled={busy}
            >
              <Text style={[styles.chipTxt, p === fade && styles.chipTxtActive]}>{p}%</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.actionRow}>
          <Pressable style={[styles.actionBtn]} onPress={closePreview} disabled={busy}>
            <Text style={styles.btnTxt}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={onInsert} disabled={busy}>
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

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Embed Image</Text>
        <Pressable style={styles.btn} onPress={() => PluginManager.closePluginView().catch(() => {})}>
          <Text style={styles.btnTxt}>Close</Text>
        </Pressable>
      </View>

      <Text style={styles.status}>{status}</Text>

      <View style={styles.sortBar}>
        <Text style={styles.sortLabel}>Sort:</Text>
        {SORT_OPTIONS.map((opt) => {
          const active = opt.key === sort;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setSort(opt.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        <Pressable onPress={load} style={styles.btn}>
          <Text style={styles.btnTxt}>Refresh</Text>
        </Pressable>
      </View>

      {sorted.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No images yet.</Text>
          <Text style={styles.emptySub}>{IMAGES_DIR}</Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(it) => it.path}
          numColumns={3}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <Pressable style={styles.tile} onPress={() => openPreview(item)} disabled={busy}>
              <Image
                source={{ uri: 'file://' + item.path }}
                style={styles.thumb}
                resizeMode="cover"
              />
              <Text numberOfLines={2} style={styles.tileName}>{item.name}</Text>
            </Pressable>
          )}
        />
      )}

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
  sortBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#ccc',
  },
  sortLabel: { fontSize: 14, color: '#000', marginRight: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#000' },
  chipActive: { backgroundColor: '#000' },
  chipTxt: { fontSize: 14, color: '#000' },
  chipTxtActive: { color: '#fff' },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#000' },
  btnTxt: { fontSize: 14, color: '#000' },
  btnTxtPrimary: { color: '#fff' },
  grid: { padding: 8 },
  tile: { flex: 1 / 3, padding: 6, alignItems: 'center' },
  thumb: { width: '100%', aspectRatio: 1, backgroundColor: '#eee' },
  tileName: { marginTop: 4, fontSize: 12, color: '#000', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { fontSize: 16, color: '#000', marginBottom: 4 },
  emptySub: { fontSize: 13, color: '#444', textAlign: 'center' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewArea: {
    flex: 1, backgroundColor: '#fff', margin: 12,
    borderWidth: 1, borderColor: '#000',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImg: { width: '100%', height: '100%' },
  previewOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff',
  },
  controlBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8,
  },
  controlLabel: { fontSize: 14, color: '#000' },
  controlValue: { fontSize: 14, color: '#000', fontVariant: ['tabular-nums'] },
  sliderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  sliderWrap: { flex: 1 },
  sliderTrack: {
    height: 36, justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute', left: 0, top: 16, height: 4,
    backgroundColor: '#000',
  },
  sliderThumb: {
    position: 'absolute', top: 6, width: 24, height: 24,
    marginLeft: -12, borderRadius: 12,
    backgroundColor: '#000', borderWidth: 2, borderColor: '#fff',
  },
  stepBtn: {
    width: 40, height: 36, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#000',
  },
  presetRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingBottom: 8,
  },
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
});
