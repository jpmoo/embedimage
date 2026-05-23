import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { baseUrl, loadStreamConfig, saveStreamConfig } from '../storage';
import { lanJson } from '../imageProcessor';
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
      <View style={styles.header}>
        <Pressable style={styles.btn} onPress={onBack} disabled={busy}>
          <Text style={styles.btnTxt}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      <Text style={styles.status} numberOfLines={2}>{status}</Text>

      <View style={styles.body}>
        <Text style={styles.section}>Mac Capture Server</Text>
        <Text style={styles.hint}>
          Set the IP shown by the Mac app, plus its port (default 9000). The plugin will fetch
          frames from http://&lt;host&gt;:&lt;port&gt;/frame.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Host (Mac IP)</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="192.168.1.50"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            placeholder="9000"
            keyboardType="number-pad"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Frame interval (seconds)</Text>
          <TextInput
            style={styles.input}
            value={intervalSec}
            onChangeText={setIntervalSec}
            placeholder="1.0"
            keyboardType="decimal-pad"
          />
          <Text style={styles.hint}>0.2 .. 60 seconds. 1.0 = 1 fps (recommended for e-ink).</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Resolution multiplier</Text>
          <TextInput
            style={styles.input}
            value={resolutionMul}
            onChangeText={setResolutionMul}
            placeholder="1.0"
            keyboardType="decimal-pad"
          />
          <Text style={styles.hint}>
            0.1 .. 1.0. Mac downscales each frame by this factor before sending.
            Lower = less bandwidth + faster Mac → Manta round-trip.
          </Text>
        </View>

        <View style={styles.row}>
          <Pressable style={styles.actionBtn} onPress={onTest} disabled={busy || !host}>
            <Text style={styles.btnTxt}>Test connection</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={onSave}
            disabled={busy}
          >
            <Text style={[styles.btnTxt, styles.btnTxtPrimary]}>Save</Text>
          </Pressable>
        </View>
      </View>

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
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#000' },
  btnTxt: { fontSize: 14, color: '#000' },
  btnTxtPrimary: { color: '#fff' },
  body: { padding: 16, gap: 12 },
  section: { fontSize: 16, fontWeight: '600', color: '#000', marginBottom: 4 },
  hint: { fontSize: 12, color: '#666' },
  field: { gap: 4 },
  label: { fontSize: 13, color: '#000' },
  input: {
    borderWidth: 1, borderColor: '#000',
    paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 14, color: '#000',
  },
  row: { flexDirection: 'row', gap: 12, marginTop: 12 },
  actionBtn: {
    flex: 1, paddingVertical: 12,
    borderWidth: 1, borderColor: '#000',
    alignItems: 'center', justifyContent: 'center',
  },
  actionBtnPrimary: { backgroundColor: '#000' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
});
