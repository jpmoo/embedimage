import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PluginCommAPI, PluginFileAPI, PluginManager } from 'sn-plugin-lib';
import { lanPostFile } from '../imageProcessor';
import { baseUrl, loadStreamConfig } from '../storage';
import { theme } from '../ui/theme';
import { StatusBar, TitleBar, Win95Button, Win95Frame, Win95InsetPanel } from '../ui/Win95';

// Headless-ish: triggered by the "Send Lasso to Mac" sidebar button.
// Generates a PNG of the currently-lassoed elements via the SDK, POSTs
// it to /sketch on the Mac, then closes. Mac stashes it in ~/EmbedImage/
// Sketches with a timestamped filename.

export function SendLasso({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<string>('Capturing lasso…');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const WATCHDOG_MS = 20000;
    const watchdog = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setStatus('Timed out. Closing…');
      setTimeout(() => PluginManager.closePluginView().catch(() => {}), 1500);
    }, WATCHDOG_MS);

    (async () => {
      try {
        console.log('[embedimage] SendLasso start');
        setStatus('Loading config…');
        const cfg = await loadStreamConfig();
        const url = baseUrl(cfg);
        console.log('[embedimage] SendLasso url=', url);
        if (!url) {
          setStatus('No Mac server set. Settings → Mac Capture Server.');
          setTimeout(() => PluginManager.closePluginView().catch(() => {}), 2500);
          return;
        }
        if (cancelled) return;

        // Inkling / guibor approach: don't use generateLassoPreview (its
        // sandbox path semantics are flaky). Render the WHOLE PAGE to PNG
        // via generateNotePng, fetch the lasso rect separately, and ship
        // both to the Mac. The Mac can crop or display as-is.
        setStatus('Reading note context…');
        const fpRes: any = await PluginCommAPI.getCurrentFilePath();
        const pgRes: any = await PluginCommAPI.getCurrentPageNum();
        const notePath = fpRes?.result ?? fpRes?.filePath ?? fpRes;
        const page = pgRes?.result ?? pgRes?.pageNum ?? pgRes;
        console.log('[embedimage] SendLasso ctx notePath=', notePath, 'page=', page);
        if (typeof notePath !== 'string' || typeof page !== 'number') {
          setStatus('Could not get current note/page.');
          setTimeout(() => PluginManager.closePluginView().catch(() => {}), 2500);
          return;
        }

        let lassoRect: any = null;
        try {
          const lr: any = await PluginCommAPI.getLassoRect();
          if (lr?.success !== false && lr?.result) lassoRect = lr.result;
          console.log('[embedimage] SendLasso getLassoRect ->', JSON.stringify(lassoRect));
        } catch (e: any) {
          console.log('[embedimage] SendLasso getLassoRect threw:', e?.message ?? e);
        }

        setStatus('Rendering page to PNG…');
        const pngPath = `/data/user/0/com.ratta.supernote.pluginhost/cache/page_${Date.now()}.png`;
        console.log('[embedimage] SendLasso generateNotePng ->', pngPath);
        const gen: any = await PluginFileAPI.generateNotePng({
          notePath, page, times: 1, pngPath, type: 1, // 1 = white background
        });
        console.log('[embedimage] SendLasso generateNotePng returned:', JSON.stringify(gen));
        if (!gen || gen.success === false) {
          setStatus(`Render failed: ${gen?.error?.message ?? 'unknown'}`);
          setTimeout(() => PluginManager.closePluginView().catch(() => {}), 3500);
          return;
        }
        if (cancelled) return;
        setPreviewUri('file://' + pngPath);

        setStatus('Uploading to Mac…');
        const name = `manta_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const qs = lassoRect
          ? `?name=${encodeURIComponent(name)}&cropL=${lassoRect.left}&cropT=${lassoRect.top}&cropR=${lassoRect.right}&cropB=${lassoRect.bottom}`
          : `?name=${encodeURIComponent(name)}`;
        console.log('[embedimage] SendLasso POST', `${url}/sketch${qs}`);
        const out = await lanPostFile(`${url}/sketch${qs}`, pngPath, 'image/png', 30000);
        console.log('[embedimage] SendLasso upload ok, response saved at', out);
        if (cancelled) return;
        setStatus(`Sent to Mac as ${name}`);
        setDone(true);
        setTimeout(() => PluginManager.closePluginView().catch(() => {}), 1500);
      } catch (e: any) {
        console.log('[embedimage] SendLasso outer threw:', e?.message ?? e);
        if (cancelled) return;
        setStatus(`Failed: ${e?.message ?? e}`);
        setTimeout(() => PluginManager.closePluginView().catch(() => {}), 3000);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title="LASSO.EXE → Mac" onClose={onClose} />
      <View style={styles.center}>
        <Win95Frame style={styles.dialog}>
          <Text style={styles.heading}>Sending lasso to Mac…</Text>
          <Win95InsetPanel style={styles.previewBox}>
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
            ) : (
              <ActivityIndicator size="large" color={theme.text} />
            )}
          </Win95InsetPanel>
          <Text style={styles.msg}>{status}</Text>
          {done ? (
            <Win95Button onPress={() => PluginManager.closePluginView().catch(() => {})} primary>
              OK
            </Win95Button>
          ) : null}
        </Win95Frame>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  dialog: { padding: 12, minWidth: 320, gap: 12 },
  heading: { fontFamily: 'VT323', fontSize: 22, color: theme.text },
  previewBox: { height: 220, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', height: '100%' },
  msg: { fontFamily: 'VT323', fontSize: 16, color: theme.textMuted, textAlign: 'center' },
});
