import React from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from './ui/theme';
import { ConnStatus } from './useConnStatus';

// 8x8 pixel-art "LED" indicator for the Mac-server connection. Manta is
// monochrome but the bevels read clearly: filled = connected, hollow =
// disconnected, no border = unknown.
export function StatusDot({ status }: { status: ConnStatus }): React.JSX.Element {
  const fill = status === 'connected' ? theme.text : theme.inset;
  return (
    <View style={styles.bezel}>
      <View style={[styles.dot, { backgroundColor: fill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bezel: {
    width: 14, height: 14,
    backgroundColor: theme.bg,
    borderTopWidth: 1, borderLeftWidth: 1,
    borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.shadow, borderLeftColor: theme.shadow,
    borderRightColor: theme.highlight, borderBottomColor: theme.highlight,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 8,
  },
  dot: { width: 8, height: 8 },
});
