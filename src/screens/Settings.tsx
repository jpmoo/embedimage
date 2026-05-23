import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { baseUrl, loadStreamConfig, saveStreamConfig } from '../storage';
import { lanJson } from '../imageProcessor';
import { theme } from '../ui/theme';
import { StatusBar, TitleBar, Win95Button, Win95InsetPanel } from '../ui/Win95';
import { DEFAULT_STREAM_CONFIG, StreamConfig } from '../types';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function SettingsScreen({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: (cfg: StreamConfig) => void;
}): React.JSX.Element {
  const [host, setHost] = useState<string>(DEFAULT_STREAM_CONFIG.host);
  const [port, setPort] = useState<string>(String(DEFAULT_STREAM_CONFIG.port));
  const [intervalSec, setIntervalSec] = useState<string>(String(DEFAULT_STREAM_CONFIG.intervalSec));
  const [resolutionMul, setResolutionMul] = useState<string>(String(DEFAULT_STREAM_CONFIG.resolutionMul));
  const [status, setStatus] = useState<string>('loading…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const cfg = await loadStreamConfig();
      setHost(cfg.host);
      setPort(String(cfg.port));
      setIntervalSec(String(cfg.intervalSec));
      setResolutionMul(String(cfg.resolutionMul));
      setStatus(cfg.host ? `loaded: ${baseUrl(cfg)}` : 'no server configured');
    })();
  }, []);

  const onTest = useCallback(async () => {
    setStatus('testing…');
    try {
      const portNum = clamp(parseInt(port, 10) || 0, 1, 65535);
      const url = `http://${host.trim()}:${portNum}/status`;
      const json: any = await lanJson('GET', url, undefined, 4000);
      setStatus(`ok — running=${json.running}, source=${json.source}, ip=${json.ip ?? '?'}`);
    } catch (e: any) {
      setStatus(`failed: ${e?.message ?? e}`);
    }
  }, [host, port]);

  const onSave = useCallback(async () => {
    setBusy(true);
    try {
      const portNum = clamp(parseInt(port, 10) || DEFAULT_STREAM_CONFIG.port, 1, 65535);
      const intervalNum = clamp(parseFloat(intervalSec) || DEFAULT_STREAM_CONFIG.intervalSec, 0.2, 60);
      const mulNum = clamp(
        parseFloat(resolutionMul) || DEFAULT_STREAM_CONFIG.resolutionMul,
        0.1,
        1.0,
      );
      const cfg: StreamConfig = {
        host: host.trim(),
        port: portNum,
        intervalSec: intervalNum,
        resolutionMul: Math.round(mulNum * 10) / 10,
      };
      await saveStreamConfig(cfg);
      setStatus(`saved: ${baseUrl(cfg)}`);
      onSaved(cfg);
    } catch (e: any) {
      setStatus(`save failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [host, port, intervalSec, resolutionMul, onSaved]);

  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title="SETTINGS.EXE" onClose={onBack} />
      <ScrollView>
        <View style={styles.body}>
          <Text style={styles.section}>Mac Capture Server</Text>
          <Text style={styles.hint}>
            IP shown by the Mac app + its port. Plugin fetches frames from
            http://&lt;host&gt;:&lt;port&gt;/frame.
          </Text>

          <Field label="Host (Mac IP)">
            <TextInput
              style={styles.input}
              value={host}
              onChangeText={setHost}
              placeholder="192.168.1.50"
              placeholderTextColor={theme.shadow}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
          </Field>

          <Field label="Port">
            <TextInput
              style={styles.input}
              value={port}
              onChangeText={setPort}
              placeholder="9000"
              placeholderTextColor={theme.shadow}
              keyboardType="number-pad"
            />
          </Field>

          <Field label="Frame interval (seconds)">
            <TextInput
              style={styles.input}
              value={intervalSec}
              onChangeText={setIntervalSec}
              placeholder="1.0"
              placeholderTextColor={theme.shadow}
              keyboardType="decimal-pad"
            />
            <Text style={styles.hint}>0.2 .. 60. 1.0 = 1 fps (good for e-ink).</Text>
          </Field>

          <Field label="Resolution multiplier">
            <TextInput
              style={styles.input}
              value={resolutionMul}
              onChangeText={setResolutionMul}
              placeholder="1.0"
              placeholderTextColor={theme.shadow}
              keyboardType="decimal-pad"
            />
            <Text style={styles.hint}>
              0.1 .. 1.0. Mac downscales each frame by this factor before sending.
            </Text>
          </Field>

          <View style={styles.row}>
            <Win95Button onPress={onTest} disabled={busy || !host}>Test connection</Win95Button>
            <View style={{ flex: 1 }} />
            <Win95Button onPress={onSave} disabled={busy} primary>Save</Win95Button>
          </View>
        </View>
      </ScrollView>

      <StatusBar>{status}</StatusBar>

      {busy ? (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={theme.text} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Win95InsetPanel style={styles.inputWrap}>{children}</Win95InsetPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { padding: 12, gap: 10 },
  section: { fontFamily: 'VT323', fontSize: 20, color: theme.text, marginBottom: 2 },
  hint: { fontFamily: 'VT323', fontSize: 14, color: theme.textMuted },
  field: { gap: 4 },
  label: { fontFamily: 'VT323', fontSize: 16, color: theme.text },
  inputWrap: { padding: 0 },
  input: {
    fontFamily: 'VT323',
    paddingHorizontal: 8, paddingVertical: 6,
    fontSize: 16, color: theme.text,
  },
  row: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(192,192,192,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
});
