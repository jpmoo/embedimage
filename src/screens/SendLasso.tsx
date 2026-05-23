import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PluginCommAPI, PluginManager } from 'sn-plugin-lib';
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
    (async () => {
      try {
        const cfg = await loadStreamConfig();
        const url = baseUrl(cfg);
        if (!url) {
          setStatus('No Mac server set. Settings → Mac Capture Server.');
          return;
        }
        // Ask the SDK to write the lasso preview to a file we control.
        const ts = Date.now();
        // The plugin's sandbox cache is the safe place to write.
        const tmpPath = `/data/user/0/com.ratta.supernote.pluginhost/files/plugins/embedimagev0001a/lasso_${ts}.png`;
        const res: any = await PluginCommAPI.generateLassoPreview(tmpPath);
        if (!res || res.success === false) {
          setStatus(`No lasso content. Lasso something first, then tap again.`);
          return;
        }
        const resultPath: string =
          typeof res?.result === 'string' ? res.result :
          (res?.result?.path ?? tmpPath);
        setPreviewUri('file://' + resultPath);
        setStatus('Uploading to Mac…');
        const name = `manta_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        await lanPostFile(`${url}/sketch?name=${encodeURIComponent(name)}`, resultPath, 'image/png', 30000);
        if (cancelled) return;
        setStatus(`Sent to Mac as ${name}`);
        setDone(true);
      } catch (e: any) {
        setStatus(`Failed: ${e?.message ?? e}`);
      }
    })();
    return () => {
      cancelled = true;
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
