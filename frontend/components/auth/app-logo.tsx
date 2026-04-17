import { StyleSheet, View } from 'react-native';

import { NeonText } from '@/components/neon-text';

export function AppLogo() {
  return (
    <View style={styles.container}>
      <View style={styles.coreOuter}>
        <View style={styles.coreInner} />
      </View>
      <NeonText style={styles.title}>AR SOCIAL ASSISTANT</NeonText>
      <NeonText style={styles.subtitle}>TACTICAL SOCIAL HUD</NeonText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 8,
  },
  coreOuter: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: '#52efff',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(8, 27, 45, 0.65)',
    shadowColor: '#1ce5ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 20,
    elevation: 12,
  },
  coreInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#73f4ff',
    shadowColor: '#52efff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1.6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: '#9fdbe2',
    textShadowColor: 'rgba(55, 230, 255, 0.45)',
    textShadowRadius: 8,
    letterSpacing: 2,
  },
});
