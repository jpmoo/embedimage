import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { theme } from '../ui/theme';
import { StatusBar, TitleBar, Win95Button, Win95Frame, Win95InsetPanel } from '../ui/Win95';
import { MacWindow, Region } from '../types';

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
    setStatus('TUNING… grabbing screen from Mac');
    try {
      const { downloadAndBake } = await import('../imageProcessor');
      const { DEFAULT_ADJUSTMENTS } = await import('../types');
      const path = await downloadAndBake(
        `${baseUrl}/preview-shot?max=700`,
        DEFAULT_ADJUSTMENTS,
        0,
        8000,
      );
      const st: any = await lanJson('GET', `${baseUrl}/status`, undefined, 3000);
      const mon = st?.monitor ?? { left: 0, top: 0, width: 0, height: 0 };
      setShotUri('file://' + path);
      Image.getSize('file://' + path, (pw, ph) => {
        const scale = mon.width ? pw / mon.width : 1.0;
        setShotInfo({
          monLeft: mon.left || 0,
          monTop: mon.top || 0,
          monW: mon.width || pw,
          monH: mon.height || ph,
          scale: scale > 0 ? scale : 1.0,
          previewW: pw,
          previewH: ph,
        });
        setStatus(`SIGNAL OK — ${mon.width}×${mon.height}`);
      }, () => setStatus('NO SIGNAL'));
    } catch (e: any) {
      setStatus(`FAULT: ${e?.message ?? e}`);
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
  const onTouchEnd = useCallback(() => {}, []);

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

  // ---- Menu mode (Win95 chrome) ----
  if (mode === 'menu') {
    return (
      <SafeAreaView style={styles.root}>
        <TitleBar title="SOURCE.EXE" onClose={onClose} />
        <View style={styles.body}>
          <Win95Frame style={styles.menuCard}>
            <Text style={styles.menuTitle}>Capture Source</Text>
            <Text style={styles.menuHint}>Choose what the Mac sends.</Text>
            <View style={{ height: 8 }} />
            <Win95Button onPress={onPickScreen} disabled={busy}>Full Screen</Win95Button>
            <View style={{ height: 6 }} />
            <Win95Button onPress={openWindowList} disabled={busy}>Window…</Win95Button>
            <View style={{ height: 6 }} />
            <Win95Button onPress={openRegion} disabled={busy} primary>Region (drag on CRT)</Win95Button>
          </Win95Frame>
        </View>
        <StatusBar>{status || 'Ready.'}</StatusBar>
        {busy ? <Overlay /> : null}
      </SafeAreaView>
    );
  }

  if (mode === 'window') {
    return (
      <SafeAreaView style={styles.root}>
        <TitleBar title="SOURCE.EXE — Pick Window" onClose={() => setMode('menu')} />
        <Win95InsetPanel style={styles.windowList}>
          <FlatList
            data={windows}
            keyExtractor={(w) => String(w.id)}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.windowRow, pressed && styles.windowRowPressed]}
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
        </Win95InsetPanel>
        <StatusBar>{status}</StatusBar>
        {busy ? <Overlay /> : null}
      </SafeAreaView>
    );
  }

  // ---- Region mode: CRT screensaver aesthetic ----
  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title="SOURCE.EXE — Region Capture" onClose={() => setMode('menu')} />
      <View style={styles.crtWrap}>
        <CrtBezel>
          {shotUri && previewLayout ? (
            <View
              style={[styles.crtScreen, previewLayout]}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={onTouchStart}
              onResponderMove={onTouchMove}
              onResponderRelease={onTouchEnd}
            >
              <Image
                source={{ uri: shotUri }}
                style={[previewLayout, styles.crtImage]}
                resizeMode="cover"
              />
              <Scanlines />
              <CrtPhosphorGlow />
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
                >
                  <Text style={styles.selRectLabel}>
                    {Math.round(selectionRect.w / (shotInfo?.scale ?? 1))}×
                    {Math.round(selectionRect.h / (shotInfo?.scale ?? 1))}
                  </Text>
                </View>
              ) : null}
              <CrtCornerTag>SOURCE-1</CrtCornerTag>
              <CrtBottomTag>{status}</CrtBottomTag>
            </View>
          ) : (
            <View style={styles.crtBlank}>
              <ActivityIndicator size="large" color="#5fff5f" />
              <Text style={styles.crtBlankTxt}>NO SIGNAL</Text>
              <Text style={styles.crtBlankSub}>{status}</Text>
            </View>
          )}
        </CrtBezel>
      </View>
      <View style={styles.controlRow}>
        <Win95Button small onPress={() => { setDragStart(null); setDragEnd(null); }}>Clear</Win95Button>
        <View style={{ flex: 1 }} />
        <Win95Button onPress={onUseRegion} disabled={busy || !selectionRect} primary>
          Use Selection
        </Win95Button>
      </View>
      <StatusBar>{status}</StatusBar>
      {busy ? <Overlay /> : null}
    </SafeAreaView>
  );
}

// ---- CRT cosmetic components ----

function CrtBezel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.crtOuter}>
      <View style={styles.crtFrame}>
        <View style={styles.crtInner}>{children}</View>
      </View>
      <View style={styles.crtStandRow}>
        <View style={styles.crtStand} />
        <View style={styles.crtKnob} />
        <View style={styles.crtKnob} />
        <View style={styles.crtLed} />
      </View>
    </View>
  );
}

function Scanlines(): React.JSX.Element {
  // Horizontal scanline overlay — done with a column of thin transparent
  // strips. Looks like an old CRT under e-ink rendering.
  const rows = 80;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={[styles.scanline, { top: `${(i / rows) * 100}%` }]} />
      ))}
    </View>
  );
}

function CrtPhosphorGlow(): React.JSX.Element {
  const flicker = React.useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 1.0, duration: 200, easing: Easing.linear, useNativeDriver: false }),
        Animated.timing(flicker, { toValue: 0.85, duration: 240, easing: Easing.linear, useNativeDriver: false }),
        Animated.timing(flicker, { toValue: 0.95, duration: 90, easing: Easing.linear, useNativeDriver: false }),
      ]),
    ).start();
  }, [flicker]);
  return <Animated.View pointerEvents="none" style={[styles.glow, { opacity: flicker.interpolate({ inputRange: [0.85, 1], outputRange: [0.1, 0.18] }) }]} />;
}

function CrtCornerTag({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Text style={styles.crtCornerTag}>{children}</Text>;
}

function CrtBottomTag({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Text style={styles.crtBottomTag}>{children}</Text>;
}

function Overlay(): React.JSX.Element {
  return <View style={styles.overlay}><ActivityIndicator size="large" color={theme.text} /></View>;
}

const PHOSPHOR = '#5fff7f';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1, padding: 16, alignItems: 'center' },
  menuCard: { padding: 16, minWidth: 280 },
  menuTitle: { fontFamily: 'VT323', fontSize: 22, color: theme.text },
  menuHint: { fontFamily: 'VT323', fontSize: 14, color: theme.textMuted },
  windowList: { flex: 1, margin: 6 },
  windowRow: { paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: theme.shadow },
  windowRowPressed: { backgroundColor: theme.selBg },
  windowOwner: { fontFamily: 'VT323', fontSize: 16, color: theme.text },
  windowTitle: { fontFamily: 'VT323', fontSize: 14, color: theme.textMuted, marginTop: 2 },

  // ---- CRT styles ----
  crtWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8, backgroundColor: theme.bg },
  crtOuter: { alignItems: 'center' },
  crtFrame: {
    padding: 18,
    backgroundColor: '#dcdcc8', // beige '90s monitor plastic
    borderTopLeftRadius: 14, borderTopRightRadius: 14,
    borderBottomLeftRadius: 6, borderBottomRightRadius: 6,
    borderTopWidth: 2, borderLeftWidth: 2,
    borderRightWidth: 2, borderBottomWidth: 2,
    borderTopColor: '#fff', borderLeftColor: '#fff',
    borderRightColor: '#808070', borderBottomColor: '#808070',
  },
  crtInner: {
    padding: 6,
    backgroundColor: '#080808',
    borderRadius: 8,
    borderWidth: 2, borderColor: '#202020',
  },
  crtScreen: { backgroundColor: '#000', borderRadius: 4, overflow: 'hidden' },
  crtImage: { opacity: 0.85 },
  scanline: {
    position: 'absolute', left: 0, right: 0, height: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PHOSPHOR,
  },
  selRect: {
    position: 'absolute',
    borderWidth: 2, borderColor: PHOSPHOR,
    backgroundColor: 'rgba(95,255,127,0.18)',
  },
  selRectLabel: {
    position: 'absolute', top: 2, left: 4,
    color: PHOSPHOR, fontFamily: 'VT323', fontSize: 14,
  },
  crtCornerTag: {
    position: 'absolute', top: 4, right: 6,
    color: PHOSPHOR, fontFamily: 'VT323', fontSize: 14,
  },
  crtBottomTag: {
    position: 'absolute', bottom: 4, left: 8, right: 8,
    color: PHOSPHOR, fontFamily: 'VT323', fontSize: 12,
  },
  crtBlank: {
    width: 320, height: 200, backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  crtBlankTxt: { color: PHOSPHOR, fontFamily: 'VT323', fontSize: 22 },
  crtBlankSub: { color: PHOSPHOR, fontFamily: 'VT323', fontSize: 14, opacity: 0.7 },
  crtStandRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    marginTop: -2,
    paddingHorizontal: 20, paddingVertical: 6,
    backgroundColor: '#dcdcc8',
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
    borderTopWidth: 1, borderTopColor: '#808070',
  },
  crtStand: { width: 60, height: 4, backgroundColor: '#808070', borderRadius: 2 },
  crtKnob: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#a0a090',
    borderTopWidth: 1, borderLeftWidth: 1,
    borderTopColor: '#fff', borderLeftColor: '#fff',
  },
  crtLed: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: PHOSPHOR,
  },

  controlRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 6, paddingVertical: 6,
    backgroundColor: theme.bg, alignItems: 'center',
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(192,192,192,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
});
