import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

type ImageItem = {
  name: string;
  path: string;
};

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  // True file-mtime sort is not available through the plugin SDK, so date sorts
  // fall back to filename order. Camera/scanner output is usually timestamped,
  // so this gives the expected ordering in practice.
  { key: 'date_desc', label: 'Newest' },
  { key: 'date_asc', label: 'Oldest' },
  { key: 'name', label: 'Name' },
];

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function isImage(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

function sortItems(items: ImageItem[], sort: SortKey): ImageItem[] {
  const copy = items.slice();
  if (sort === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } else if (sort === 'date_asc') {
    copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } else {
    copy.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  }
  return copy;
}

async function resolveImagesDir(): Promise<string> {
  const volumes = await FileUtils.getExternalDirPath();
  const root = Array.isArray(volumes) && volumes.length > 0
    ? volumes[0]
    : '/storage/emulated/0';
  return `${root.replace(/\/+$/, '')}/Documents/Images`;
}

export default function App() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [sort, setSort] = useState<SortKey>('date_desc');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirPath, setDirPath] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dir = await resolveImagesDir();
      setDirPath(dir);
      const exists = await FileUtils.exists(dir);
      if (!exists) {
        await FileUtils.makeDir(dir);
      }
      const entries = (await FileUtils.listFiles(dir)) || [];
      const imgs: ImageItem[] = [];
      for (const entry of entries) {
        // listFiles returns either string paths or { path, type } objects depending on SDK version.
        const path = typeof entry === 'string' ? entry : (entry as any).path;
        const type = typeof entry === 'string' ? 1 : (entry as any).type;
        if (!path) continue;
        if (type === 0) continue; // directory
        const name = basename(path);
        if (!isImage(name)) continue;
        imgs.push({ name, path });
      }
      setItems(imgs);
    } catch (err: any) {
      Alert.alert('Embed Image', `Could not read images directory.\n${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => sortItems(items, sort), [items, sort]);

  const onPick = useCallback(async (item: ImageItem) => {
    if (busy) return;
    setBusy(true);
    try {
      const res: any = await PluginNoteAPI.insertImage(item.path);
      if (!res || res.success === false) {
        throw new Error(res?.error?.message ?? 'insertImage failed');
      }
      try { await PluginNoteAPI.saveCurrentNote(); } catch {}
      ToastAndroid.showWithGravity(`Embedded ${item.name}`, ToastAndroid.SHORT, ToastAndroid.BOTTOM);
      PluginManager.closePluginView().catch(() => {});
    } catch (err: any) {
      Alert.alert('Embed Image', `Failed to embed: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Embed Image</Text>
        <Pressable
          style={styles.closeBtn}
          onPress={() => PluginManager.closePluginView().catch(() => {})}
        >
          <Text style={styles.closeTxt}>Close</Text>
        </Pressable>
      </View>

      <View style={styles.sortBar}>
        <Text style={styles.sortLabel}>Sort:</Text>
        {SORT_OPTIONS.map((opt) => {
          const active = opt.key === sort;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setSort(opt.key)}
              style={[styles.sortChip, active && styles.sortChipActive]}
            >
              <Text style={[styles.sortChipTxt, active && styles.sortChipTxtActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        <Pressable onPress={load} style={styles.refreshBtn}>
          <Text style={styles.refreshTxt}>Refresh</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : sorted.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No images found.</Text>
          <Text style={styles.emptySub}>{dirPath}</Text>
          <Text style={styles.emptySub}>Drop image files here and tap Refresh.</Text>
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
          <Text style={styles.overlayTxt}>Embedding…</Text>
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
  closeBtn: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#000' },
  closeTxt: { fontSize: 16, color: '#000' },
  sortBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#ccc',
  },
  sortLabel: { fontSize: 14, color: '#000', marginRight: 4 },
  sortChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#000', borderRadius: 2,
  },
  sortChipActive: { backgroundColor: '#000' },
  sortChipTxt: { fontSize: 14, color: '#000' },
  sortChipTxtActive: { color: '#fff' },
  refreshBtn: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#000' },
  refreshTxt: { fontSize: 14, color: '#000' },
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
  overlayTxt: { color: '#fff', marginTop: 12, fontSize: 16 },
});
