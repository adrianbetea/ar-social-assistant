import { SafeAreaView, StyleSheet, View } from 'react-native';

import { NeonText } from '@/components/neon-text';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <NeonText style={styles.title}>System Dashboard</NeonText>
        <NeonText style={styles.subtitle}>Welcome back. Core modules are standing by.</NeonText>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#030b14',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: '#9dd3df',
    textShadowColor: 'rgba(55, 230, 255, 0.3)',
    textShadowRadius: 6,
  },
});
