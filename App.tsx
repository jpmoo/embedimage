import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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

const IMAGE_EXTS = ['.png'];
const IMAGES_DIR = '/storage/emulated/0/Document/Images';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Newest' },
  { key: 'date_asc', label: 'Oldest' },
  { key: 'name', label: 'Name' },
];

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

function isImage(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
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

export default function App(): React.JSX.Element {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [sort, setSort] = useState<SortKey>('date_desc');
  const [status, setStatus] = useState<string>('starting…');
  const [busy, setBusy] = useState(false);

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

  const onPick = useCallback(async (item: ImageItem) => {
    if (busy) return;
    setBusy(true);
    setStatus(`embedding ${item.name}…`);
    try {
      const res: any = await PluginNoteAPI.insertImage(item.path);
      if (!res || res.success === false) {
        const msg = res?.error?.message ?? 'insertImage failed';
        setStatus(`insert failed: ${msg}`);
        return;
      }
      try { await PluginNoteAPI.saveCurrentNote(); } catch {}
      try {
        ToastAndroid.showWithGravity(`Embedded ${item.name}`, ToastAndroid.SHORT, ToastAndroid.BOTTOM);
      } catch {}
      PluginManager.closePluginView().catch(() => {});
    } catch (err: any) {
      setStatus(`insert threw: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Embed PNG</Text>
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
          <Text style={styles.empty}>No PNG files yet.</Text>
          <Text style={styles.emptySub}>{IMAGES_DIR}</Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(it) => it.path}
          numColumns={3}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <Pressable style={styles.tile} onPress={() => onPick(item)} disabled={busy}>
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
    flexDirection: 'row', alignItems: 'center',
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
});
