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
import { StatusDot } from '../StatusDot';
import { baseUrl, loadStreamConfig } from '../storage';
import { theme } from '../ui/theme';
import { MenuBar, StatusBar, TitleBar, Win95Button, Win95Frame, Win95InsetPanel } from '../ui/Win95';
import { useConnStatus } from '../useConnStatus';
import type { Entry, EntryKind, SortKey, StreamConfig } from '../types';
import { DEFAULT_STREAM_CONFIG } from '../types';
import { makeSession, StitchSession } from './StitchEditor';
import type { StitchImage } from '../imageProcessor';

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
  onStitchReady,
}: {
  onPickFile: (entry: Entry) => void;
  onOpenSettings: () => void;
  onOpenCapture: () => void;
  onClose: () => void;
  busy: boolean;
  onStitchReady?: (session: StitchSession) => void;
}): React.JSX.Element {
  const [currentDir, setCurrentDir] = useState<string>(DEFAULT_DIR);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sort, setSort] = useState<SortKey>('date_desc');
  const [columns, setColumns] = useState<number>(DEFAULT_COLUMNS);
  const [status, setStatus] = useState<string>('starting…');
  const [streamCfg, setStreamCfg] = useState<StreamConfig>(DEFAULT_STREAM_CONFIG);
  const connStatus = useConnStatus(baseUrl(streamCfg));
  useEffect(() => {
    loadStreamConfig().then(setStreamCfg).catch(() => {});
  }, []);

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

  // Stitch-pick state: when the user opens Tools → Stitch we flip into
  // pick mode. First tap on an image becomes image 1; second tap becomes
  // image 2 and immediately opens the StitchEditor.
  const [stitchPick, setStitchPick] = useState<{ first: StitchImage | null } | null>(null);

  const measureImage = useCallback((path: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      Image.getSize('file://' + path, (w, h) => resolve({ width: w, height: h }), (e) => reject(e));
    });
  }, []);

  const onPickEntry = useCallback(
    async (entry: Entry) => {
      if (entry.kind === 'folder') {
        setCurrentDir(entry.path);
        return;
      }
      if (stitchPick && onStitchReady) {
        // Resolve dimensions before constructing the session — the
        // editor needs them up front to lay out the preview.
        try {
          const dim = await measureImage(entry.path);
          const img: StitchImage = {
            path: entry.path, width: dim.width, height: dim.height,
            crop: { cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
          };
          if (!stitchPick.first) {
            setStitchPick({ first: img });
            setStatus(`Stitch · picked "${entry.name}" — tap a second image`);
          } else {
            const session = makeSession(stitchPick.first, img);
            setStitchPick(null);
            setStatus('Opening stitch editor…');
            onStitchReady(session);
          }
        } catch (e: any) {
          setStatus(`stitch pick failed: ${e?.message ?? e}`);
        }
        return;
      }
      onPickFile(entry);
    },
    [onPickFile, stitchPick, onStitchReady, measureImage],
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
      <TitleBar
        title="Embed Image"
        onClose={() => {
          onClose();
          PluginManager.closePluginView().catch(() => {});
        }}
      />
      <MenuBar
        menus={[
          {
            label: 'File',
            items: [
              { label: 'Open from system…', onPress: onSystemPicker },
              { label: 'Refresh', onPress: () => load(currentDir) },
              { separator: true, label: '' },
              { label: 'Exit', onPress: () => { onClose(); PluginManager.closePluginView().catch(() => {}); } },
            ],
          },
          {
            label: 'View',
            items: SORT_OPTIONS.map((opt) => ({
              label: `Sort by ${opt.label}${opt.key === sort ? '  •' : ''}`,
              onPress: () => setSort(opt.key),
            })).concat([
              { label: '', separator: true } as any,
              { label: 'Bigger thumbnails', onPress: () => setColumns((c) => clamp(c - 1, MIN_COLUMNS, MAX_COLUMNS)) } as any,
              { label: 'Smaller thumbnails', onPress: () => setColumns((c) => clamp(c + 1, MIN_COLUMNS, MAX_COLUMNS)) } as any,
            ]),
          },
          {
            label: 'Tools',
            items: [
              { label: 'Live Capture…', onPress: onOpenCapture },
              { separator: true, label: '' },
              {
                label: stitchPick ? 'Cancel stitch pick' : 'Stitch two images…',
                onPress: () => {
                  if (stitchPick) {
                    setStitchPick(null);
                    setStatus('Stitch pick cancelled.');
                  } else if (onStitchReady) {
                    setStitchPick({ first: null });
                    setStatus('Stitch · tap an image to pick the first');
                  }
                },
                disabled: !onStitchReady,
              },
              { separator: true, label: '' },
              { label: 'Settings…', onPress: onOpenSettings },
            ],
          },
        ]}
      />
      <View style={styles.toolbar}>
        <Win95Button small onPress={navigateUp} disabled={!canGoUp}>Up</Win95Button>
        <Win95Button small onPress={goHome}>Home</Win95Button>
        <Win95Button small active onPress={() => setCurrentDir(INTERNAL_ROOT)}>Internal</Win95Button>
        <View style={{ flex: 1 }} />
        <Win95Button small onPress={onOpenCapture}>Live…</Win95Button>
        <StatusDot status={connStatus} />
      </View>
      <View style={styles.pathInsetWrap}>
        <Win95InsetPanel style={styles.pathInset}>
          <Text style={styles.pathTxt} numberOfLines={1} ellipsizeMode="head">{currentDir}</Text>
        </Win95InsetPanel>
      </View>

      <Win95InsetPanel style={styles.listInset}>
        {sorted.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.empty}>Nothing here.</Text>
            <Text style={styles.emptySub}>{currentDir}</Text>
            <Text style={styles.emptyHint}>
              File → Open from system… for WebDAV/SD. Tools → Live Capture… to stream from a Mac.
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
                    <Text style={styles.folderIcon}>[DIR]</Text>
                  </View>
                ) : (
                  <Image source={{ uri: 'file://' + item.path }} style={styles.thumb} resizeMode="cover" />
                )}
                <Text numberOfLines={2} style={styles.tileName}>{item.name}</Text>
              </Pressable>
            )}
          />
        )}
      </Win95InsetPanel>

      <StatusBar>{status}</StatusBar>

      {busy ? (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#000" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 4,
    backgroundColor: theme.bg,
    borderBottomWidth: 1, borderBottomColor: theme.shadow,
  },
  pathInsetWrap: { paddingHorizontal: 6, paddingVertical: 4, backgroundColor: theme.bg },
  pathInset: { paddingHorizontal: 6, paddingVertical: 4 },
  pathTxt: { flex: 1, fontFamily: 'VT323', fontSize: 14, color: theme.text },
  listInset: { flex: 1, margin: 6 },
  grid: { padding: 6 },
  tile: { padding: 4, alignItems: 'center' },
  thumb: {
    width: '100%', aspectRatio: 1, backgroundColor: theme.bg,
    borderTopWidth: 1, borderLeftWidth: 1,
    borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.shadow, borderLeftColor: theme.shadow,
    borderRightColor: theme.highlight, borderBottomColor: theme.highlight,
  },
  folderThumb: {
    width: '100%', aspectRatio: 1, backgroundColor: theme.bg,
    borderTopWidth: 1, borderLeftWidth: 1,
    borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.highlight, borderLeftColor: theme.highlight,
    borderRightColor: theme.dark, borderBottomColor: theme.dark,
    alignItems: 'center', justifyContent: 'center',
  },
  folderIcon: { fontFamily: 'VT323', fontSize: 22, color: theme.text },
  tileName: { marginTop: 4, fontFamily: 'VT323', fontSize: 14, color: theme.text, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { fontFamily: 'VT323', fontSize: 18, color: theme.text, marginBottom: 4 },
  emptySub: { fontFamily: 'VT323', fontSize: 14, color: theme.textMuted, textAlign: 'center', marginBottom: 12 },
  emptyHint: { fontFamily: 'VT323', fontSize: 14, color: theme.textMuted, textAlign: 'center' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(192,192,192,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
});
