import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ConnStatus } from './useConnStatus';

// Small filled circle for the connection state. Manta is monochrome, so:
//   connected    -> solid black
//   disconnected -> white with a black ring
//   unknown      -> open ring (no fill)
export function StatusDot({ status }: { status: ConnStatus }): React.JSX.Element {
  const fill =
    status === 'connected' ? '#000' :
    status === 'disconnected' ? '#fff' : '#fff';
  return <View style={[styles.dot, { backgroundColor: fill }]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#000',
    marginLeft: 8,
  },
});
