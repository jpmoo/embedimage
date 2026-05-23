import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RangeSlider } from './RangeSlider';
import { lanHttp, lanJson } from './imageProcessor';
import { baseUrl, loadStreamConfig } from './storage';
import { theme } from './ui/theme';
import { Win95Button, Win95InsetPanel } from './ui/Win95';
import type { Adjustments, DitherMode, Preset } from './types';
import { DEFAULT_ADJUSTMENTS, DITHER_LABELS } from './types';

type NumericKey = 'fade' | 'brightness' | 'contrast' | 'gamma';

type Config = {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  presets: number[];
  format: (v: number) => string;
};

const ADJUSTMENT_CONFIG: Record<NumericKey, Config> = {
  fade:       { label: 'Fade',       min: 0,    max: 100, step: 5,    default: 0,   presets: [0, 25, 50, 75, 100],     format: (v) => `${Math.round(v)}%` },
  brightness: { label: 'Brightness', min: -100, max: 100, step: 5,    default: 0,   presets: [-50, -25, 0, 25, 50],    format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}` },
  contrast:   { label: 'Contrast',   min: -100, max: 100, step: 5,    default: 0,   presets: [-50, -25, 0, 25, 50],    format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}` },
  gamma:      { label: 'Gamma',      min: 0.5,  max: 2.0, step: 0.05, default: 1.0, presets: [0.5, 0.75, 1.0, 1.5, 2.0], format: (v) => v.toFixed(2) },
};

const DITHER_MODES: DitherMode[] = ['none', 'fs1', 'fs4', 'atkinson'];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function equalish(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

export function AdjustmentPanel({
  values,
  onChange,
  disabled,
}: {
  values: Adjustments;
  onChange: (next: Adjustments) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [activeKey, setActiveKey] = useState<NumericKey>('fade');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  const cfg = ADJUSTMENT_CONFIG[activeKey];
  const value = values[activeKey];
  const setValue = (v: number) => onChange({ ...values, [activeKey]: v });
  const round = (v: number) => Math.round(v / cfg.step) * cfg.step;

  // Load presets from the Mac when mounted (best-effort).
  useEffect(() => {
    (async () => {
      const sc = await loadStreamConfig();
      const url = baseUrl(sc);
      if (!url) return;
      try {
        const list: any = await lanJson('GET', `${url}/presets`, undefined, 3000);
        if (Array.isArray(list)) setPresets(list);
      } catch {
        // server may not be reachable; presets stay empty.
      }
    })();
  }, []);

  const applyPreset = (p: Preset) => {
    onChange({
      fade: p.fade ?? 0,
      brightness: p.brightness ?? 0,
      contrast: p.contrast ?? 0,
      gamma: p.gamma ?? 1.0,
      dither: (p.dither ?? 'none') as DitherMode,
    });
  };

  const saveCurrentAsPreset = async () => {
    const name = newPresetName.trim();
    if (!name) return;
    const sc = await loadStreamConfig();
    const url = baseUrl(sc);
    if (!url) {
      setShowSave(false);
      return;
    }
    try {
      const res: any = await lanHttp('POST', `${url}/presets`, { name, ...values }, 3000);
      const parsed = JSON.parse(res?.body ?? '{}');
      if (Array.isArray(parsed?.presets)) setPresets(parsed.presets);
    } catch {
      // ignore — UI keeps working without preset persistence.
    }
    setShowSave(false);
    setNewPresetName('');
  };

  const deletePreset = async (name: string) => {
    const sc = await loadStreamConfig();
    const url = baseUrl(sc);
    if (!url) return;
    try {
      await lanHttp('DELETE', `${url}/presets/${encodeURIComponent(name)}`, undefined, 3000);
      const list: any = await lanJson('GET', `${url}/presets`, undefined, 3000);
      if (Array.isArray(list)) setPresets(list);
    } catch {
      // ignore
    }
  };

  const resetAll = () => onChange(DEFAULT_ADJUSTMENTS);

  return (
    <View style={styles.root}>
      {/* Preset chips */}
      <View style={styles.presetBar}>
        <Text style={styles.presetBarLabel}>Presets:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetChips}>
          {presets.length === 0 ? (
            <Text style={styles.presetEmpty}>(none — Save current… to add)</Text>
          ) : (
            presets.map((p) => (
              <Pressable
                key={p.name}
                onPress={() => applyPreset(p)}
                onLongPress={() => deletePreset(p.name)}
                style={styles.presetChip}
                disabled={disabled}
              >
                <Text style={styles.presetChipTxt}>{p.name}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
        <Win95Button small onPress={() => setShowSave((s) => !s)} disabled={disabled}>Save…</Win95Button>
        <Win95Button small onPress={resetAll} disabled={disabled}>Reset</Win95Button>
      </View>

      {showSave ? (
        <View style={styles.saveRow}>
          <Win95InsetPanel style={styles.saveInput}>
            <TextInput
              value={newPresetName}
              onChangeText={setNewPresetName}
              placeholder="preset name…"
              placeholderTextColor={theme.shadow}
              style={styles.saveInputTxt}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Win95InsetPanel>
          <Win95Button small onPress={saveCurrentAsPreset} disabled={!newPresetName.trim()} primary>OK</Win95Button>
          <Win95Button small onPress={() => setShowSave(false)}>X</Win95Button>
        </View>
      ) : null}

      {/* Tab strip */}
      <View style={styles.tabRow}>
        {(Object.keys(ADJUSTMENT_CONFIG) as NumericKey[]).map((key) => {
          const c = ADJUSTMENT_CONFIG[key];
          const active = key === activeKey;
          const dirty = !equalish(values[key], c.default);
          return (
            <Pressable
              key={key}
              onPress={() => setActiveKey(key)}
              style={[styles.tab, active && styles.tabActive]}
              disabled={disabled}
            >
              <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>
                {c.label}{dirty ? ' •' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Active control */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>{cfg.label}</Text>
        <Text style={styles.headerValue}>{cfg.format(value)}</Text>
        <Win95Button small onPress={() => setValue(cfg.default)} disabled={disabled}>Reset</Win95Button>
      </View>

      <View style={styles.sliderRow}>
        <Win95Button
          small
          onPress={() => setValue(clamp(round(value - cfg.step), cfg.min, cfg.max))}
          disabled={disabled}
        >−</Win95Button>
        <View style={styles.sliderWrap}>
          <RangeSlider
            value={value}
            min={cfg.min}
            max={cfg.max}
            step={cfg.step}
            onChange={setValue}
            disabled={disabled}
          />
        </View>
        <Win95Button
          small
          onPress={() => setValue(clamp(round(value + cfg.step), cfg.min, cfg.max))}
          disabled={disabled}
        >+</Win95Button>
      </View>

      <View style={styles.quickPresetRow}>
        {cfg.presets.map((p) => {
          const active = equalish(p, value);
          return (
            <Pressable
              key={p}
              onPress={() => setValue(p)}
              style={[styles.quickPreset, active && styles.quickPresetActive]}
              disabled={disabled}
            >
              <Text style={[styles.quickPresetTxt, active && styles.quickPresetTxtActive]}>
                {cfg.format(p)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Dither selector */}
      <View style={styles.ditherRow}>
        <Text style={styles.ditherLabel}>Dither:</Text>
        {DITHER_MODES.map((m) => {
          const active = values.dither === m;
          return (
            <Pressable
              key={m}
              onPress={() => onChange({ ...values, dither: m })}
              style={[styles.ditherChip, active && styles.ditherChipActive]}
              disabled={disabled}
            >
              <Text style={[styles.ditherChipTxt, active && styles.ditherChipTxtActive]}>
                {DITHER_LABELS[m]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.shadow },
  presetBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 6, paddingVertical: 4,
  },
  presetBarLabel: { fontFamily: 'VT323', fontSize: 14, color: theme.text },
  presetChips: { alignItems: 'center', gap: 6, paddingRight: 6 },
  presetEmpty: { fontFamily: 'VT323', fontSize: 13, color: theme.shadow, paddingHorizontal: 4 },
  presetChip: {
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: theme.bg,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.highlight, borderLeftColor: theme.highlight,
    borderRightColor: theme.dark, borderBottomColor: theme.dark,
  },
  presetChipTxt: { fontFamily: 'VT323', fontSize: 14, color: theme.text },
  saveRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 6, paddingBottom: 4,
  },
  saveInput: { flex: 1, padding: 0 },
  saveInputTxt: { fontFamily: 'VT323', fontSize: 14, color: theme.text, paddingHorizontal: 6, paddingVertical: 4 },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: theme.bg,
    borderTopWidth: 1, borderTopColor: theme.shadow,
  },
  tab: {
    flex: 1, paddingVertical: 6, alignItems: 'center', justifyContent: 'center',
  },
  tabActive: { backgroundColor: theme.titleBg },
  tabTxt: { fontFamily: 'VT323', fontSize: 14, color: theme.text },
  tabTxtActive: { color: theme.titleFg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 6, paddingTop: 6,
  },
  headerLabel: { flex: 1, fontFamily: 'VT323', fontSize: 14, color: theme.text },
  headerValue: { fontFamily: 'VT323', fontSize: 14, color: theme.text },
  sliderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 6, paddingVertical: 4,
  },
  sliderWrap: { flex: 1 },
  quickPresetRow: {
    flexDirection: 'row', gap: 4, flexWrap: 'wrap',
    paddingHorizontal: 6, paddingVertical: 4,
  },
  quickPreset: {
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: theme.bg,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.highlight, borderLeftColor: theme.highlight,
    borderRightColor: theme.dark, borderBottomColor: theme.dark,
  },
  quickPresetActive: {
    backgroundColor: theme.titleBg,
    borderTopColor: theme.dark, borderLeftColor: theme.dark,
    borderRightColor: theme.highlight, borderBottomColor: theme.highlight,
  },
  quickPresetTxt: { fontFamily: 'VT323', fontSize: 13, color: theme.text },
  quickPresetTxtActive: { color: theme.titleFg },
  ditherRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 6, paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: theme.shadow,
  },
  ditherLabel: { fontFamily: 'VT323', fontSize: 14, color: theme.text, marginRight: 4 },
  ditherChip: {
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: theme.bg,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.highlight, borderLeftColor: theme.highlight,
    borderRightColor: theme.dark, borderBottomColor: theme.dark,
  },
  ditherChipActive: {
    backgroundColor: theme.titleBg,
    borderTopColor: theme.dark, borderLeftColor: theme.dark,
    borderRightColor: theme.highlight, borderBottomColor: theme.highlight,
  },
  ditherChipTxt: { fontFamily: 'VT323', fontSize: 14, color: theme.text },
  ditherChipTxtActive: { color: theme.titleFg },
});
