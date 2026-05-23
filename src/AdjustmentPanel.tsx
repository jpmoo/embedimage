import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RangeSlider } from './RangeSlider';
import type { Adjustments } from './types';

type AdjustmentKey = keyof Adjustments;

type Config = {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  presets: number[];
  format: (v: number) => string;
};

const ADJUSTMENT_CONFIG: Record<AdjustmentKey, Config> = {
  fade: {
    label: 'Fade',
    min: 0,
    max: 100,
    step: 5,
    default: 0,
    presets: [0, 25, 50, 75, 100],
    format: (v) => `${Math.round(v)}%`,
  },
  brightness: {
    label: 'Brightness',
    min: -100,
    max: 100,
    step: 5,
    default: 0,
    presets: [-50, -25, 0, 25, 50],
    format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
  },
  contrast: {
    label: 'Contrast',
    min: -100,
    max: 100,
    step: 5,
    default: 0,
    presets: [-50, -25, 0, 25, 50],
    format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
  },
  gamma: {
    label: 'Gamma',
    min: 0.5,
    max: 2.0,
    step: 0.05,
    default: 1.0,
    presets: [0.5, 0.75, 1.0, 1.5, 2.0],
    format: (v) => v.toFixed(2),
  },
};

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
  const [activeKey, setActiveKey] = useState<AdjustmentKey>('fade');
  const cfg = ADJUSTMENT_CONFIG[activeKey];
  const value = values[activeKey];
  const setValue = (v: number) => onChange({ ...values, [activeKey]: v });
  const round = (v: number) => Math.round(v / cfg.step) * cfg.step;

  return (
    <View>
      <View style={styles.tabRow}>
        {(Object.keys(ADJUSTMENT_CONFIG) as AdjustmentKey[]).map((key) => {
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
                {c.label}
                {dirty ? ' •' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.header}>
        <Text style={styles.headerLabel}>{cfg.label}</Text>
        <Text style={styles.headerValue}>{cfg.format(value)}</Text>
        <Pressable
          style={styles.resetBtn}
          onPress={() => setValue(cfg.default)}
          disabled={disabled}
        >
          <Text style={styles.resetBtnTxt}>Reset</Text>
        </Pressable>
      </View>

      <View style={styles.sliderRow}>
        <Pressable
          style={styles.stepBtn}
          onPress={() => setValue(clamp(round(value - cfg.step), cfg.min, cfg.max))}
          disabled={disabled}
        >
          <Text style={styles.stepBtnTxt}>−</Text>
        </Pressable>
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
        <Pressable
          style={styles.stepBtn}
          onPress={() => setValue(clamp(round(value + cfg.step), cfg.min, cfg.max))}
          disabled={disabled}
        >
          <Text style={styles.stepBtnTxt}>+</Text>
        </Pressable>
      </View>

      <View style={styles.presetRow}>
        {cfg.presets.map((p) => {
          const active = equalish(p, value);
          return (
            <Pressable
              key={p}
              onPress={() => setValue(p)}
              style={[styles.preset, active && styles.presetActive]}
              disabled={disabled}
            >
              <Text style={[styles.presetTxt, active && styles.presetTxtActive]}>
                {cfg.format(p)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000' },
  tab: {
    flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center',
    borderRightWidth: 1, borderRightColor: '#000',
  },
  tabActive: { backgroundColor: '#000' },
  tabTxt: { fontSize: 14, color: '#000' },
  tabTxtActive: { color: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
  },
  headerLabel: { flex: 1, fontSize: 14, color: '#000' },
  headerValue: { fontSize: 14, color: '#000', fontVariant: ['tabular-nums'] },
  resetBtn: { paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#000' },
  resetBtnTxt: { fontSize: 12, color: '#000' },
  sliderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  sliderWrap: { flex: 1 },
  stepBtn: {
    width: 40, height: 36, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#000',
  },
  stepBtnTxt: { fontSize: 18, color: '#000' },
  presetRow: {
    flexDirection: 'row', gap: 8, flexWrap: 'wrap',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  preset: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#000' },
  presetActive: { backgroundColor: '#000' },
  presetTxt: { fontSize: 13, color: '#000' },
  presetTxtActive: { color: '#fff' },
});
