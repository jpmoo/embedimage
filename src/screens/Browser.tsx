import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FileUtils, PluginManager, RattaFileSelector } from 'sn-plugin-lib';
import type { Entry, EntryKind, SortKey } from '../types';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];
const INTERNAL_ROOT = '/storage/emulated/0';
const DEFAULT_DIR = INTERNAL_ROOT + '/Document/Images';
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;
const DEFAULT_COLUMNS = 3;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Newest' },
  { key: 'date_asc', label: 'Oldest' },
  { key: 'name', label: 'Name' },
];

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

function parentDir(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const i = trimmed.lastIndexOf('/');
  if (i <= 0) return '/';
  return trimmed.slice(0, i);
}

function classifyEntry(name: string): EntryKind | null {
  const lower = name.toLowerCase();
  if (IMAGE_EXTS.some((e) => lower.endsWith(e))) return 'image';
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return 'folder';
  return null;
}

function isPng(name: string): boolean {
  return name.toLowerCase().endsWith('.png');
}

function sortEntries(items: Entry[], sort: SortKey): Entry[] {
  const folders = items.filter((e) => e.kind === 'folder');
  const images = items.filter((e) => e.kind === 'image');
  const byName = (a: Entry, b: Entry) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });
  folders.sort(byName);
  if (sort === 'name') images.sort(byName);
  else if (sort === 'date_asc') images.sort(byName);
  else images.sort((a, b) => byName(b, a));
  return folders.concat(images);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function BrowserScreen({
  onPickFile,
  onOpenSettings,
  onOpenCapture,
  onClose,
  busy,
}: {
  onPickFile: (entry: Entry) => void;
  onOpenSettings: () => void;
  onOpenCapture: () => void;
  onClose: () => void;
  busy: boolean;
}): React.JSX.Element {
  const [currentDir, setCurrentDir] = useState<string>(DEFAULT_DIR);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sort, setSort] = useState<SortKey>('date_desc');
  const [columns, setColumns] = useState<number>(DEFAULT_COLUMNS);
  const [status, setStatus] = useState<string>('starting…');

  const load = useCallback(async (dir: string) => {
    setStatus(`listing ${dir}`);
    try {
      let exists = false;
      try {
        exists = await FileUtils.exists(dir);
      } catch (e: any) {
        setStatus(`exists() threw: ${e?.message ?? e}`);
        return;
      }
      if (!exists) {
        if (dir === DEFAULT_DIR) {
          try {
            await FileUtils.makeDir(dir);
          } catch (e: any) {
            setStatus(`makeDir() threw: ${e?.message ?? e}`);
            return;
          }
        } else {
          setStatus(`directory missing: ${dir}`);
          setEntries([]);
          return;
        }
      }

      let raw: any = null;
      try {
        raw = await FileUtils.listFiles(dir);
      } catch (e: any) {
        setStatus(`listFiles() threw: ${e?.message ?? e}`);
        return;
      }

      const list: any[] = Array.isArray(raw) ? raw : [];
      const out: Entry[] = [];
      for (const entry of list) {
        const path = typeof entry === 'string' ? entry : entry?.path;
        const sdkType = typeof entry === 'string' ? undefined : entry?.type;
        if (!path) continue;
        const name = basename(path);
        if (!name || name.startsWith('.')) continue;
        let kind: EntryKind | null;
        if (sdkType === 0) kind = 'folder';
        else if (sdkType === 1) kind = isPng(name) || classifyEntry(name) === 'image' ? 'image' : null;
        else kind = classifyEntry(name);
        if (!kind) continue;
        out.push({ name, path, kind });
      }
      setEntries(out);
      const imgs = out.filter((e) => e.kind === 'image').length;
      const dirs = out.filter((e) => e.kind === 'folder').length;
      setStatus(`${imgs} image${imgs === 1 ? '' : 's'}, ${dirs} folder${dirs === 1 ? '' : 's'}`);
    } catch (err: any) {
      setStatus(`unexpected: ${err?.message ?? err}`);
    }
  }, []);

  useEffect(() => {
    load(currentDir);
  }, [currentDir, load]);

  // Note: previous versions probed FileUtils.getExternalDirPath() to expose
  // SD-card roots. The new Manta firmware leaves getCurrentActivity() null
  // when the JS bundle first runs, so that native call throws an NPE that
  // bypasses our try/catch and tears the RN bridge down. Use "Browse…"
  // (system picker) for SD / WebDAV instead.
  const currentRoot = INTERNAL_ROOT;

  const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);

  const onPickEntry = useCallback(
    (entry: Entry) => {
      if (entry.kind === 'folder') {
        setCurrentDir(entry.path);
      } else {
        onPickFile(entry);
      }
    },
    [onPickFile],
  );

  const onSystemPicker = useCallback(async () => {
    try {
      setStatus('opening system file picker…');
      const res: any = await RattaFileSelector.selectFile({
        selectType: 1,
        suffixList: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'],
        maxNum: 1,
        title: 'Pick image',
      });
      const path: string | undefined = Array.isArray(res) ? res[0] : res;
      if (!path) {
        setStatus('picker cancelled');
        return;
      }
      const name = basename(path);
      onPickFile({ name, path, kind: 'image' });
    } catch (e: any) {
      setStatus(`picker failed: ${e?.message ?? e}`);
    }
  }, [onPickFile]);

  const navigateUp = useCallback(() => {
    if (currentDir === currentRoot) return;
    const p = parentDir(currentDir);
    if (p === currentRoot || p.startsWith(currentRoot + '/')) {
      setCurrentDir(p);
    } else {
      setCurrentDir(currentRoot);
    }
  }, [currentDir, currentRoot]);

  const goHome = useCallback(() => setCurrentDir(DEFAULT_DIR), []);
  const canGoUp = currentDir !== currentRoot;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Embed Image</Text>
        <Pressable style={styles.btn} onPress={onOpenCapture}>
          <Text style={styles.btnTxt}>Live…</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={onOpenSettings}>
          <Text style={styles.btnTxt}>Settings</Text>
        </Pressable>
        <Pressable
          style={styles.btn}
          onPress={() => {
            onClose();
            PluginManager.closePluginView().catch(() => {});
          }}
        >
          <Text style={styles.btnTxt}>Close</Text>
        </Pressable>
      </View>

      <Text style={styles.status} numberOfLines={1}>{status}</Text>

      <View style={styles.pathBar}>
        <Pressable style={styles.btn} onPress={navigateUp} disabled={!canGoUp}>
          <Text style={[styles.btnTxt, !canGoUp && styles.btnTxtMuted]}>Up</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={goHome}>
          <Text style={styles.btnTxt}>Home</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnActive]}
          onPress={() => setCurrentDir(INTERNAL_ROOT)}
        >
          <Text style={[styles.btnTxt, styles.btnTxtPrimary]}>Internal</Text>
        </Pressable>
        <Text style={styles.pathTxt} numberOfLines={1} ellipsizeMode="head">{currentDir}</Text>
      </View>

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
        <Text style={styles.sortLabel}>Size:</Text>
        <Pressable
          onPress={() => setColumns((c) => clamp(c + 1, MIN_COLUMNS, MAX_COLUMNS))}
          style={styles.btn}
          disabled={columns >= MAX_COLUMNS}
        >
          <Text style={[styles.btnTxt, columns >= MAX_COLUMNS && styles.btnTxtMuted]}>−</Text>
        </Pressable>
        <Pressable
          onPress={() => setColumns((c) => clamp(c - 1, MIN_COLUMNS, MAX_COLUMNS))}
          style={styles.btn}
          disabled={columns <= MIN_COLUMNS}
        >
          <Text style={[styles.btnTxt, columns <= MIN_COLUMNS && styles.btnTxtMuted]}>+</Text>
        </Pressable>
        <Pressable onPress={onSystemPicker} style={styles.btn}>
          <Text style={styles.btnTxt}>Browse…</Text>
        </Pressable>
        <Pressable onPress={() => load(currentDir)} style={styles.btn}>
          <Text style={styles.btnTxt}>Refresh</Text>
        </Pressable>
      </View>

      {sorted.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>Nothing here.</Text>
          <Text style={styles.emptySub}>{currentDir}</Text>
          <Text style={styles.emptyHint}>
            Tap “Browse…” for the system picker (WebDAV + SD), “Live…” to stream from a Mac.
          </Text>
        </View>
      ) : (
        <FlatList
          key={`grid-${columns}`}
          data={sorted}
          keyExtractor={(it) => it.path}
          numColumns={columns}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.tile, { flexBasis: `${100 / columns}%`, maxWidth: `${100 / columns}%` }]}
              onPress={() => onPickEntry(item)}
              disabled={busy}
            >
              {item.kind === 'folder' ? (
                <View style={styles.folderThumb}>
                  <Text style={styles.folderIcon}>📁</Text>
                </View>
              ) : (
                <Image source={{ uri: 'file://' + item.path }} style={styles.thumb} resizeMode="cover" />
              )}
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
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#000',
  },
  title: { flex: 1, fontSize: 22, fontWeight: '600', color: '#000' },
  status: {
    fontSize: 12, color: '#444',
    paddingHorizontal: 16, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#ddd',
  },
  pathBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#ccc',
  },
  pathTxt: { flex: 1, fontSize: 12, color: '#555' },
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
  btnActive: { backgroundColor: '#000' },
  btnTxt: { fontSize: 14, color: '#000' },
  btnTxtMuted: { color: '#999' },
  btnTxtPrimary: { color: '#fff' },
  grid: { padding: 8 },
  tile: { padding: 6, alignItems: 'center' },
  thumb: { width: '100%', aspectRatio: 1, backgroundColor: '#eee' },
  folderThumb: {
    width: '100%', aspectRatio: 1, backgroundColor: '#f4f4f4',
    borderWidth: 1, borderColor: '#000',
    alignItems: 'center', justifyContent: 'center',
  },
  folderIcon: { fontSize: 40 },
  tileName: { marginTop: 4, fontSize: 12, color: '#000', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { fontSize: 16, color: '#000', marginBottom: 4 },
  emptySub: { fontSize: 13, color: '#444', textAlign: 'center', marginBottom: 12 },
  emptyHint: { fontSize: 12, color: '#666', textAlign: 'center' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
});
