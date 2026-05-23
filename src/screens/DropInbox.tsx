import React, { useCallback, useEffect, useState } from 'react';
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
import { PluginManager } from 'sn-plugin-lib';
import { insertAndTrack } from '../embedTracker';
import { downloadAndBake, lanHttp, lanJson } from '../imageProcessor';
import { baseUrl, loadStreamConfig } from '../storage';
import { theme } from '../ui/theme';
import { StatusBar, TitleBar, Win95Button, Win95InsetPanel } from '../ui/Win95';
import { DEFAULT_ADJUSTMENTS, DEFAULT_STREAM_CONFIG } from '../types';

// "Drop Inbox" — files dropped (or AirDropped) into ~/EmbedImage/Drop on
// the Mac appear here, newest first. Tap to insert; the Mac then moves
// the file out of the watch folder so it won't show up again.

type DropItem = { name: string; size: number; mtime: number };

export function DropInbox({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [url, setUrl] = useState<string>('');
  const [items, setItems] = useState<DropItem[]>([]);
  const [folder, setFolder] = useState<string>('');
  const [status, setStatus] = useState<string>('loading…');
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const refresh = useCallback(async (u: string) => {
    if (!u) return;
    setStatus('refreshing…');
    try {
      const res: any = await lanJson('GET', `${u}/drop/list`, undefined, 3000);
      const list: DropItem[] = Array.isArray(res?.items) ? res.items : [];
      setItems(list);
      setFolder(String(res?.folder ?? ''));
      setStatus(`${list.length} item${list.length === 1 ? '' : 's'}`);
      // Pre-fetch small thumbnails for the visible list.
      const newThumbs: Record<string, string> = {};
      for (const it of list.slice(0, 24)) {
        try {
          const path = await downloadAndBake(
            `${u}/drop/file?name=${encodeURIComponent(it.name)}`,
            DEFAULT_ADJUSTMENTS,
            200, // small thumb
            8000,
          );
          newThumbs[it.name] = 'file://' + path;
        } catch {
          // skip; show name only
        }
      }
      setThumbs(newThumbs);
    } catch (e: any) {
      setStatus(`failed: ${e?.message ?? e}`);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const cfg = await loadStreamConfig();
      const u = baseUrl(cfg);
      setUrl(u);
      if (u) refresh(u);
      else setStatus('no server configured');
    })();
  }, [refresh]);

  const onInsert = useCallback(async (it: DropItem) => {
    if (busy) return;
    setBusy(true);
    setStatus(`embedding ${it.name}…`);
    try {
      const path = await downloadAndBake(
        `${url}/drop/file?name=${encodeURIComponent(it.name)}`,
        DEFAULT_ADJUSTMENTS,
        0,
        15000,
      );
      await insertAndTrack(path);
      // Consume on the Mac (moves it to .consumed/) and refresh.
      await lanHttp('POST', `${url}/drop/consume`, { name: it.name }, 3000).catch(() => {});
      await PluginManager.closePluginView().catch(() => {});
    } catch (e: any) {
      setStatus(`insert failed: ${e?.message ?? e}`);
      setBusy(false);
    }
  }, [busy, url]);

  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title="DROP.EXE — Mac watch folder" onClose={onClose} />
      <View style={styles.subhead}>
        <Text style={styles.folder} numberOfLines={1}>{folder || '(folder unknown)'}</Text>
        <Win95Button small onPress={() => refresh(url)} disabled={busy || !url}>Refresh</Win95Button>
      </View>

      <Win95InsetPanel style={styles.listInset}>
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Inbox is empty.</Text>
            <Text style={styles.emptyHint}>
              Drop or AirDrop image files into:{'\n'}{folder || '~/EmbedImage/Drop'}{'\n\n'}
              They'll show up here on the next Refresh.
            </Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(it) => it.name}
            numColumns={3}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => {
              const uri = thumbs[item.name];
              return (
                <Pressable style={styles.tile} onPress={() => onInsert(item)} disabled={busy}>
                  <View style={styles.tileImgWrap}>
                    {uri ? (
                      <Image source={{ uri }} style={styles.tileImg} resizeMode="cover" />
                    ) : (
                      <Text style={styles.tilePlaceholder}>[IMG]</Text>
                    )}
                  </View>
                  <Text numberOfLines={2} style={styles.tileName}>{item.name}</Text>
                </Pressable>
              );
            }}
          />
        )}
      </Win95InsetPanel>

      <StatusBar>{status}</StatusBar>

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
  subhead: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 6, paddingVertical: 4,
    backgroundColor: theme.bg,
  },
  folder: { flex: 1, fontFamily: 'VT323', fontSize: 14, color: theme.text },
  listInset: { flex: 1, margin: 6 },
  grid: { padding: 6 },
  tile: { width: '33.333%', padding: 4 },
  tileImgWrap: {
    width: '100%', aspectRatio: 1, backgroundColor: theme.bg,
    borderTopWidth: 1, borderLeftWidth: 1,
    borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.shadow, borderLeftColor: theme.shadow,
    borderRightColor: theme.highlight, borderBottomColor: theme.highlight,
    alignItems: 'center', justifyContent: 'center',
  },
  tileImg: { width: '100%', height: '100%' },
  tilePlaceholder: { fontFamily: 'VT323', fontSize: 14, color: theme.shadow },
  tileName: { marginTop: 4, fontFamily: 'VT323', fontSize: 14, color: theme.text, textAlign: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontFamily: 'VT323', fontSize: 18, color: theme.text, marginBottom: 6 },
  emptyHint: { fontFamily: 'VT323', fontSize: 14, color: theme.textMuted, textAlign: 'center' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(192,192,192,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
});
