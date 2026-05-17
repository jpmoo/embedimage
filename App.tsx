import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';

export default function App(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <Text style={styles.title}>Embed Image — probe build</Text>
        <Text style={styles.body}>If you can read this, the plugin view is opening.</Text>
        <Pressable
          style={styles.btn}
          onPress={() => PluginManager.closePluginView().catch(() => {})}
        >
          <Text style={styles.btnTxt}>Close</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '600', color: '#000', marginBottom: 16 },
  body: { fontSize: 16, color: '#000', marginBottom: 24, textAlign: 'center' },
  btn: { paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#000' },
  btnTxt: { fontSize: 16, color: '#000' },
});
