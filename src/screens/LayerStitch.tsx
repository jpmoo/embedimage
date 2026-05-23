import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import { lanPostFile } from '../imageProcessor';
import {
  composeLassoLayers, insertComposed, LassoSurvey, surveyLasso,
} from '../layerStitch';
import { baseUrl, loadStreamConfig } from '../storage';
import { theme } from '../ui/theme';
import { StatusBar, TitleBar, Win95Button, Win95Frame, Win95InsetPanel } from '../ui/Win95';
import { FileLogger } from '../util/FileLogger';

// "Stitch Layers" — lasso some content on the canvas, tap this button,
// pick which Supernote note layers (0..3) to include, choose transparent
// or white background, then insert/send the composited image.

export function LayerStitch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [survey, setSurvey] = useState<LassoSurvey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [transparent, setTransparent] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('Reading lasso…');
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await surveyLasso();
        if (!s) {
          setError('No lasso selection found. Lasso some content first.');
          setStatus('Idle');
          return;
        }
        setSurvey(s);
        // Default selection: every layer that has at least one lassoed element.
        const def = new Set(s.layers.filter((l) => l.count > 0).map((l) => l.layerId));
        setSelected(def);
        setStatus(`Lasso ok · ${s.layers.length} layer${s.layers.length === 1 ? '' : 's'}`);
      } catch (e: any) {
        FileLogger.log('LayerStitch', 'survey threw', e?.message ?? String(e));
        setError(e?.message ?? String(e));
      }
    })();
  }, []);

  const toggle = useCallback((layerId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId); else next.add(layerId);
      return next;
    });
  }, []);

  const totalPicked = survey
    ? survey.layers.filter((l) => selected.has(l.layerId)).reduce((n, l) => n + l.count, 0)
    : 0;

  const onPreview = useCallback(async () => {
    if (!survey || busy) return;
    setBusy(true);
    setStatus('Composing preview…');
    try {
      const path = await composeLassoLayers(survey, {
        selectedLayerIds: [...selected],
        transparentBg: transparent,
      });
      setPreviewUri('file://' + path + '?t=' + Date.now());
      setStatus(`Preview ready (${path.split('/').pop()})`);
    } catch (e: any) {
      FileLogger.log('LayerStitch', 'preview threw', e?.message ?? String(e));
      setStatus(`Preview failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [survey, selected, transparent, busy]);

  const onInsert = useCallback(async () => {
    if (!survey || busy) return;
    setBusy(true);
    setStatus('Composing & inserting…');
    try {
      const path = await composeLassoLayers(survey, {
        selectedLayerIds: [...selected],
        transparentBg: transparent,
      });
      await insertComposed(path);
      setStatus('Inserted. Closing…');
      setTimeout(() => PluginManager.closePluginView().catch(() => {}), 800);
    } catch (e: any) {
      FileLogger.log('LayerStitch', 'insert threw', e?.message ?? String(e));
      setStatus(`Insert failed: ${e?.message ?? e}`);
      setBusy(false);
    }
  }, [survey, selected, transparent, busy]);

  const onSendToMac = useCallback(async () => {
    if (!survey || busy) return;
    setBusy(true);
    setStatus('Composing & sending to Mac…');
    try {
      const cfg = await loadStreamConfig();
      const url = baseUrl(cfg);
      if (!url) {
        setStatus('No Mac server set. Settings → Mac Capture Server.');
        setBusy(false);
        return;
      }
      const path = await composeLassoLayers(survey, {
        selectedLayerIds: [...selected],
        transparentBg: transparent,
      });
      const name = `manta_layers_${new Date().toISOString().replace(/[:.]/g, '-')}.${cfg.lassoFormat}`;
      await lanPostFile(`${url}/sketch?name=${encodeURIComponent(name)}&format=${cfg.lassoFormat}`, path, 'image/png', 30000);
      setStatus(`Sent to Mac as ${name}. Closing…`);
      setTimeout(() => PluginManager.closePluginView().catch(() => {}), 1200);
    } catch (e: any) {
      FileLogger.log('LayerStitch', 'send threw', e?.message ?? String(e));
      setStatus(`Send failed: ${e?.message ?? e}`);
      setBusy(false);
    }
  }, [survey, selected, transparent, busy]);

  if (error) {
    return (
      <SafeAreaView style={styles.root}>
        <TitleBar title="STITCHLAYERS.EXE" onClose={onClose} />
        <View style={styles.center}>
          <Win95Frame style={styles.dialog}>
            <Text style={styles.heading}>No selection.</Text>
            <Text style={styles.msg}>{error}</Text>
            <Win95Button onPress={onClose}>OK</Win95Button>
          </Win95Frame>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title="STITCHLAYERS.EXE — Lasso → Layers → Image" onClose={onClose} />

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
        <Text style={styles.section}>Pick layers to include</Text>
        {!survey ? (
          <Win95InsetPanel style={styles.loading}>
            <ActivityIndicator size="small" color={theme.text} />
            <Text style={styles.dim}>{status}</Text>
          </Win95InsetPanel>
        ) : (
          <Win95InsetPanel style={styles.layerList}>
            {survey.layers.length === 0 ? (
              <Text style={styles.dim}>No layers found on this page.</Text>
            ) : (
              survey.layers.map((l) => {
                const isSelected = selected.has(l.layerId);
                const hasContent = l.count > 0;
                return (
                  <Pressable
                    key={l.layerId}
                    style={[styles.layerRow, !hasContent && styles.layerRowMuted]}
                    onPress={() => toggle(l.layerId)}
                    disabled={busy}
                  >
                    <View style={styles.checkbox}>
                      <Text style={styles.checkboxMark}>{isSelected ? '☑' : '☐'}</Text>
                    </View>
                    <Text style={styles.layerName}>
                      {l.name}{l.isCurrent ? '  (current)' : ''}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.layerCount, !hasContent && styles.dim]}>
                      {l.count} item{l.count === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </Win95InsetPanel>
        )}

        <View style={styles.bgRow}>
          <Text style={styles.bgLabel}>Background:</Text>
          <Win95Button
            small active={transparent}
            onPress={() => setTransparent(true)} disabled={busy}
          >Transparent</Win95Button>
          <Win95Button
            small active={!transparent}
            onPress={() => setTransparent(false)} disabled={busy}
          >White</Win95Button>
        </View>

        {previewUri ? (
          <Win95InsetPanel style={styles.previewBox}>
            <Image source={{ uri: previewUri }} style={styles.previewImg} resizeMode="contain" />
          </Win95InsetPanel>
        ) : null}
      </ScrollView>

      <View style={styles.actionRow}>
        <Win95Button onPress={onClose} disabled={busy}>Cancel</Win95Button>
        <View style={{ flex: 1 }} />
        <Win95Button onPress={onPreview} disabled={busy || !survey || totalPicked === 0}>Preview</Win95Button>
        <Win95Button onPress={onSendToMac} disabled={busy || !survey || totalPicked === 0}>To Mac</Win95Button>
        <Win95Button onPress={onInsert} disabled={busy || !survey || totalPicked === 0} primary>Insert</Win95Button>
      </View>

      <StatusBar>{status} · {totalPicked} item{totalPicked === 1 ? '' : 's'} picked</StatusBar>

      {busy && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={theme.text} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1 },
  bodyInner: { padding: 8, gap: 8 },
  section: { fontFamily: 'VT323', fontSize: 18, color: theme.text },
  loading: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dim: { fontFamily: 'VT323', fontSize: 14, color: theme.textMuted },
  layerList: { padding: 4 },
  layerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 6,
  },
  layerRowMuted: { opacity: 0.5 },
  checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  checkboxMark: { fontFamily: 'VT323', fontSize: 18, color: theme.text },
  layerName: { fontFamily: 'VT323', fontSize: 16, color: theme.text },
  layerCount: { fontFamily: 'VT323', fontSize: 14, color: theme.text },
  bgRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4,
  },
  bgLabel: { fontFamily: 'VT323', fontSize: 16, color: theme.text },
  previewBox: { padding: 4, minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: 200, backgroundColor: '#fff' },
  actionRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 6, paddingVertical: 6,
    alignItems: 'center', backgroundColor: theme.bg,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  dialog: { padding: 16, minWidth: 320, gap: 12 },
  heading: { fontFamily: 'VT323', fontSize: 22, color: theme.text },
  msg: { fontFamily: 'VT323', fontSize: 14, color: theme.textMuted, textAlign: 'center' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(192,192,192,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
});
