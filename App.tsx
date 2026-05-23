import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  NativeModules,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { FileUtils, PluginManager, PluginNoteAPI, RattaFileSelector } from 'sn-plugin-lib';

type SortKey = 'date_desc' | 'date_asc' | 'name';
type EntryKind = 'image' | 'folder';
type Entry = { name: string; path: string; kind: EntryKind };

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];
const ROOT = '/storage/emulated/0';
const DEFAULT_DIR = ROOT + '/Document/Images';
const PREVIEW_MAX_DIM = 800;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'date_desc', label: 'Newest' },
  { key: 'date_asc', label: 'Oldest' },
  { key: 'name', label: 'Name' },
];

const { ImageProcessor } = NativeModules as {
  ImageProcessor?: {
    processForEmbed: (
      inputPath: string,
      whiteAlpha: number,
      brightness: number,
      contrast: number,
      gamma: number,
      previewMaxDim: number,
    ) => Promise<string>;
    cleanupCache: () => Promise<number>;
  };
};

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
  // No extension → assume folder. Files with non-image extensions are skipped.
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

function RangeSlider({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(width);
  widthRef.current = width;

  const update = useCallback(
    (x: number) => {
      const w = Math.max(1, widthRef.current);
      const pct = clamp(x / w, 0, 1);
      const raw = min + pct * (max - min);
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(snapped, min, max));
    },
    [min, max, step, onChange],
  );

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (e) => update(e.nativeEvent.locationX),
      onPanResponderMove: (e) => update(e.nativeEvent.locationX),
    }),
  ).current;

  const pct = clamp((value - min) / (max - min), 0, 1) * 100;

  return (
    <View
      style={styles.sliderTrack}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}
    >
      <View style={styles.sliderRail} />
      <View style={[styles.sliderFill, { width: `${pct}%` }]} />
      <View style={[styles.sliderThumb, { left: `${pct}%` }]} />
    </View>
  );
}

function AdjustRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  onReset,
  disabled,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.adjustRow}>
      <View style={styles.adjustHeader}>
        <Text style={styles.adjustLabel}>{label}</Text>
        <Text style={styles.adjustValue}>{display}</Text>
        <Pressable style={styles.resetBtn} onPress={onReset} disabled={disabled}>
          <Text style={styles.resetBtnTxt}>Reset</Text>
        </Pressable>
      </View>
      <View style={styles.sliderRow}>
        <Pressable
          style={styles.stepBtn}
          onPress={() => onChange(clamp(value - step, min, max))}
          disabled={disabled}
        >
          <Text style={styles.btnTxt}>-</Text>
        </Pressable>
        <View style={styles.sliderWrap}>
          <RangeSlider
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={onChange}
            disabled={disabled}
          />
        </View>
        <Pressable
          style={styles.stepBtn}
          onPress={() => onChange(clamp(value + step, min, max))}
          disabled={disabled}
        >
          <Text style={styles.btnTxt}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const DEFAULT_GAMMA = 1.0;

function adjustmentsAreDefault(fade: number, brightness: number, contrast: number, gamma: number) {
  return (
    fade === 0 &&
    brightness === 0 &&
    contrast === 0 &&
    Math.abs(gamma - DEFAULT_GAMMA) < 1e-6
  );
}

export default function App(): React.JSX.Element {
  const [currentDir, setCurrentDir] = useState<string>(DEFAULT_DIR);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sort, setSort] = useState<SortKey>('date_desc');
  const [status, setStatus] = useState<string>('starting…');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [fade, setFade] = useState(0);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [gamma, setGamma] = useState(DEFAULT_GAMMA);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

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
          setStatus('default directory missing — creating');
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

  // One-shot cache cleanup on plugin open.
  useEffect(() => {
    ImageProcessor?.cleanupCache?.().catch(() => {});
  }, []);

  // Debounced preview bake. Reuses the source path when all sliders are at
  // defaults and the source is already PNG.
  useEffect(() => {
    if (!selected) return;
    const allDefault = adjustmentsAreDefault(fade, brightness, contrast, gamma);
    if (allDefault && isPng(selected.name)) {
      setPreviewPath(null);
      return;
    }
    if (!ImageProcessor?.processForEmbed) return;
    const t = setTimeout(() => {
      let cancelled = false;
      setPreviewing(true);
      ImageProcessor.processForEmbed(
        selected.path,
        fade / 100,
        brightness,
        contrast,
        gamma,
        PREVIEW_MAX_DIM,
      )
        .then((p) => {
          if (!cancelled) setPreviewPath(p);
        })
        .catch((e: any) => {
          if (!cancelled) setStatus(`preview failed: ${e?.message ?? e}`);
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
      return () => {
        cancelled = true;
      };
    }, 350);
    return () => clearTimeout(t);
  }, [selected, fade, brightness, contrast, gamma]);

  const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);

  const openPreview = useCallback((entry: Entry) => {
    setSelected(entry);
    setFade(0);
    setBrightness(0);
    setContrast(0);
    setGamma(DEFAULT_GAMMA);
    setPreviewPath(null);
  }, []);

  const closePreview = useCallback(() => {
    setSelected(null);
    setPreviewPath(null);
    setPreviewing(false);
  }, []);

  const onPickEntry = useCallback(
    (entry: Entry) => {
      if (entry.kind === 'folder') {
        setCurrentDir(entry.path);
      } else {
        openPreview(entry);
      }
    },
    [openPreview],
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
      setStatus(`picked ${path}`);
      const name = basename(path);
      openPreview({ name, path, kind: 'image' });
    } catch (e: any) {
      setStatus(`picker failed: ${e?.message ?? e}`);
    }
  }, [openPreview]);

  const onInsert = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setStatus(`embedding ${selected.name}…`);
    try {
      const allDefault = adjustmentsAreDefault(fade, brightness, contrast, gamma);
      const needsBake = !allDefault || !isPng(selected.name);
      let pathToInsert = selected.path;

      if (needsBake) {
        if (!ImageProcessor?.processForEmbed) {
          setStatus('native ImageProcessor missing — rebuild plugin');
          return;
        }
        try {
          pathToInsert = await ImageProcessor.processForEmbed(
            selected.path,
            fade / 100,
            brightness,
            contrast,
            gamma,
            0,
          );
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
      try {
        await PluginNoteAPI.saveCurrentNote();
      } catch {}
      try {
        ToastAndroid.showWithGravity(
          `Embedded ${selected.name}`,
          ToastAndroid.SHORT,
          ToastAndroid.BOTTOM,
        );
      } catch {}
      PluginManager.closePluginView().catch(() => {});
    } catch (err: any) {
      setStatus(`insert threw: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [selected, fade, brightness, contrast, gamma, busy]);

  const navigateUp = useCallback(() => {
    if (currentDir === ROOT) return;
    const p = parentDir(currentDir);
    if (!p.startsWith(ROOT)) {
      setCurrentDir(ROOT);
    } else {
      setCurrentDir(p);
    }
  }, [currentDir]);

  const goHome = useCallback(() => setCurrentDir(DEFAULT_DIR), []);

  if (selected) {
    const sourceUri = 'file://' + (previewPath ?? selected.path);
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable style={styles.btn} onPress={closePreview} disabled={busy}>
            <Text style={styles.btnTxt}>Back</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {selected.name}
          </Text>
          {previewing ? <ActivityIndicator size="small" color="#000" /> : null}
        </View>

        <Text style={styles.status} numberOfLines={1}>
          {status}
        </Text>

        <View style={styles.previewArea}>
          <Image source={{ uri: sourceUri }} style={styles.previewImg} resizeMode="contain" />
        </View>

        <ScrollView style={styles.adjustScroll} contentContainerStyle={styles.adjustScrollContent}>
          <AdjustRow
            label="Fade to white"
            value={fade}
            display={`${fade}%`}
            min={0}
            max={100}
            step={5}
            onChange={setFade}
            onReset={() => setFade(0)}
            disabled={busy}
          />
          <AdjustRow
            label="Brightness"
            value={brightness}
            display={`${brightness > 0 ? '+' : ''}${brightness}`}
            min={-100}
            max={100}
            step={5}
            onChange={setBrightness}
            onReset={() => setBrightness(0)}
            disabled={busy}
          />
          <AdjustRow
            label="Contrast"
            value={contrast}
            display={`${contrast > 0 ? '+' : ''}${contrast}`}
            min={-100}
            max={100}
            step={5}
            onChange={setContrast}
            onReset={() => setContrast(0)}
            disabled={busy}
          />
          <AdjustRow
            label="Gamma"
            value={gamma}
            display={gamma.toFixed(2)}
            min={0.5}
            max={2.0}
            step={0.05}
            onChange={(v) => setGamma(Math.round(v * 100) / 100)}
            onReset={() => setGamma(DEFAULT_GAMMA)}
            disabled={busy}
          />
        </ScrollView>

        <View style={styles.actionRow}>
          <Pressable style={styles.actionBtn} onPress={closePreview} disabled={busy}>
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

  const canGoUp = currentDir !== ROOT;
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Embed Image</Text>
        <Pressable style={styles.btn} onPress={() => PluginManager.closePluginView().catch(() => {})}>
          <Text style={styles.btnTxt}>Close</Text>
        </Pressable>
      </View>

      <Text style={styles.status} numberOfLines={1}>
        {status}
      </Text>

      <View style={styles.pathBar}>
        <Pressable style={styles.btn} onPress={navigateUp} disabled={!canGoUp}>
          <Text style={[styles.btnTxt, !canGoUp && styles.btnTxtMuted]}>Up</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={goHome}>
          <Text style={styles.btnTxt}>Home</Text>
        </Pressable>
        <Text style={styles.pathTxt} numberOfLines={1} ellipsizeMode="head">
          {currentDir}
        </Text>
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
            Tap “Browse…” to open the system picker — includes WebDAV mounts and SD card.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(it) => it.path}
          numColumns={3}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <Pressable style={styles.tile} onPress={() => onPickEntry(item)} disabled={busy}>
              {item.kind === 'folder' ? (
                <View style={styles.folderThumb}>
                  <Text style={styles.folderIcon}>📁</Text>
                </View>
              ) : (
                <Image source={{ uri: 'file://' + item.path }} style={styles.thumb} resizeMode="cover" />
              )}
              <Text numberOfLines={2} style={styles.tileName}>
                {item.name}
              </Text>
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
  btnTxt: { fontSize: 14, color: '#000' },
  btnTxtMuted: { color: '#999' },
  btnTxtPrimary: { color: '#fff' },
  grid: { padding: 8 },
  tile: { flex: 1 / 3, padding: 6, alignItems: 'center' },
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
  previewArea: {
    flex: 1, backgroundColor: '#fff', margin: 12,
    borderWidth: 1, borderColor: '#000',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImg: { width: '100%', height: '100%' },
  adjustScroll: { maxHeight: 320 },
  adjustScrollContent: { paddingHorizontal: 12, paddingBottom: 4 },
  adjustRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#eee' },
  adjustHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 4,
  },
  adjustLabel: { flex: 1, fontSize: 14, color: '#000' },
  adjustValue: { fontSize: 14, color: '#000', fontVariant: ['tabular-nums'] },
  resetBtn: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#000',
  },
  resetBtnTxt: { fontSize: 12, color: '#000' },
  sliderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 4, paddingVertical: 4,
  },
  sliderWrap: { flex: 1 },
  sliderTrack: { height: 36, justifyContent: 'center' },
  sliderRail: {
    position: 'absolute', left: 0, right: 0, top: 16, height: 4,
    backgroundColor: '#ddd',
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
