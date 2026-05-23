import React, { useCallback, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function RangeSlider({
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
}): React.JSX.Element {
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
      style={styles.track}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}
    >
      <View style={styles.rail} />
      <View style={[styles.fill, { width: `${pct}%` }]} />
      <View style={[styles.thumb, { left: `${pct}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 36, justifyContent: 'center' },
  rail: {
    position: 'absolute', left: 0, right: 0, top: 16, height: 4,
    backgroundColor: '#ddd',
  },
  fill: {
    position: 'absolute', left: 0, top: 16, height: 4,
    backgroundColor: '#000',
  },
  thumb: {
    position: 'absolute', top: 6, width: 24, height: 24,
    marginLeft: -12, borderRadius: 12,
    backgroundColor: '#000', borderWidth: 2, borderColor: '#fff',
  },
});
