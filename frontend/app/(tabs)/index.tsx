import { useCallback, useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { CyberButton } from '@/components/cyber-button';
import { NeonText } from '@/components/neon-text';
import { getApiBaseUrl, getAuthToken } from '@/constants/api';

const coreModules = [
  { label: 'Vision + AR Overlay', status: 'Online', detail: 'Camera feed primed' },
  { label: 'Audio + Whisper', status: 'Standby', detail: 'Mic permissions ready' },
  { label: 'Wingman AI', status: 'Syncing', detail: 'Personality core loaded' },
];

const quickActions = [
  { label: 'Profile Settings', meta: 'AI core instructions', route: '/profile' },
  { label: 'Recent Logs', meta: 'Last session 2h ago', route: '/(tabs)/explore' },
];

const defaultConfig = {
  systemPrompt: 'You are a helpful AR social assistant.',
  targetLanguage: 'English',
};

export default function HomeScreen() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [config, setConfig] = useState(defaultConfig);
  const [configStatus, setConfigStatus] = useState<'idle' | 'loading' | 'error'>('loading');

  const promptPreview = useMemo(() => {
    const trimmed = config.systemPrompt.trim();
    return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
  }, [config.systemPrompt]);

  const loadConfig = useCallback(() => {
    let isActive = true;

    const fetchConfig = async () => {
      setConfigStatus('loading');

      try {
        const token = getAuthToken();
        const response = await fetch(`${apiBaseUrl}/api/user/config`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.message || 'Failed to load configuration.');
        }

        if (isActive) {
          setConfig({
            systemPrompt: data.systemPrompt || defaultConfig.systemPrompt,
            targetLanguage: data.targetLanguage || defaultConfig.targetLanguage,
          });
          setConfigStatus('idle');
        }
      } catch (error) {
        if (isActive) {
          setConfig(defaultConfig);
          setConfigStatus('error');
        }
      }
    };

    fetchConfig();

    return () => {
      isActive = false;
    };
  }, [apiBaseUrl]);

  useFocusEffect(loadConfig);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <NeonText style={styles.title}>System Dashboard</NeonText>
          <NeonText style={styles.subtitle}>Welcome back, Operative. Systems are ready.</NeonText>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <NeonText style={styles.sectionTitle}>Core Status</NeonText>
            <NeonText style={styles.pulseIndicator}>● LIVE</NeonText>
          </View>
          {coreModules.map((module) => (
            <View key={module.label} style={styles.statusRow}>
              <View style={styles.statusLabel}>
                <NeonText style={styles.moduleLabel}>{module.label}</NeonText>
                <NeonText style={styles.moduleDetail}>{module.detail}</NeonText>
              </View>
              <View style={styles.badge}>
                <NeonText style={styles.badgeText}>{module.status}</NeonText>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actionCard}>
          <NeonText style={styles.sectionTitle}>Deploy Assistant</NeonText>
          <NeonText style={styles.actionCopy}>
            Activate AR overlay, live transcription, and real-time social insight.
          </NeonText>
          <CyberButton label="Start Assistant" onPress={() => router.push('/assistant-hud')} />
          <View style={styles.quickGrid}>
            {quickActions.map((action) => (
              <Pressable
                key={action.label}
                style={({ pressed }) => [styles.quickTile, pressed && styles.quickTilePressed]}
                onPress={() => router.push(action.route)}>
                <NeonText style={styles.quickLabel}>{action.label}</NeonText>
                <NeonText style={styles.quickMeta}>{action.meta}</NeonText>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.configCard}>
          <NeonText style={styles.sectionTitle}>Configuration</NeonText>
          <NeonText style={styles.configCopy}>
            Tune the AI core instructions, target language, and assistant behavior.
          </NeonText>
          {configStatus === 'loading' ? (
            <NeonText style={styles.configStatus}>Syncing latest settings...</NeonText>
          ) : null}
          {configStatus === 'error' ? (
            <NeonText style={styles.configStatus}>Using default settings.</NeonText>
          ) : null}
          <View style={styles.configRow}>
            <View style={styles.configBlock}>
              <NeonText style={styles.configValue}>Persona</NeonText>
              <NeonText style={styles.configLabel}>{promptPreview || 'Default core prompt'}</NeonText>
            </View>
            <View style={styles.configBlock}>
              <NeonText style={styles.configValue}>{config.targetLanguage}</NeonText>
              <NeonText style={styles.configLabel}>Target language</NeonText>
            </View>
          </View>
          <CyberButton label="Open Profile Settings" onPress={() => router.push('/profile')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#030b14',
  },
  content: {
    padding: 20,
    paddingBottom: 36,
    gap: 22,
  },
  glowTop: {
    position: 'absolute',
    top: -90,
    left: -50,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(18, 107, 130, 0.24)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -120,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(0, 168, 204, 0.2)',
  },
  header: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    color: '#9dd3df',
    textShadowColor: 'rgba(55, 230, 255, 0.3)',
    textShadowRadius: 6,
  },
  statusCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(78, 232, 255, 0.35)',
    backgroundColor: 'rgba(3, 18, 33, 0.78)',
    padding: 16,
    gap: 12,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 1.6,
    color: '#a8e9f7',
    textShadowColor: 'rgba(55, 230, 255, 0.35)',
    textShadowRadius: 8,
  },
  pulseIndicator: {
    fontSize: 11,
    color: '#6ff6ff',
    textShadowColor: 'rgba(55, 230, 255, 0.7)',
    textShadowRadius: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  statusLabel: {
    flex: 1,
    gap: 4,
  },
  moduleLabel: {
    fontSize: 14,
    color: '#dcfbff',
  },
  moduleDetail: {
    fontSize: 12,
    color: '#7fb9c7',
    textShadowColor: 'transparent',
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(111, 246, 255, 0.4)',
    backgroundColor: 'rgba(12, 36, 56, 0.8)',
  },
  badgeText: {
    fontSize: 11,
    letterSpacing: 1,
    color: '#79f2ff',
    textShadowColor: 'transparent',
  },
  actionCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(78, 232, 255, 0.28)',
    backgroundColor: 'rgba(2, 14, 24, 0.85)',
    padding: 18,
    gap: 14,
  },
  actionCopy: {
    fontSize: 13,
    color: '#9ad4df',
    textShadowColor: 'rgba(55, 230, 255, 0.2)',
    textShadowRadius: 6,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickTile: {
    flexBasis: '48%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(44, 228, 255, 0.25)',
    backgroundColor: 'rgba(5, 26, 41, 0.85)',
    padding: 12,
    gap: 6,
  },
  quickTilePressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.85,
  },
  quickLabel: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#d4f7ff',
  },
  quickMeta: {
    fontSize: 11,
    color: '#7fb9c7',
    textShadowColor: 'transparent',
  },
  configCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(78, 232, 255, 0.28)',
    backgroundColor: 'rgba(4, 21, 35, 0.85)',
    padding: 16,
    gap: 12,
  },
  configCopy: {
    fontSize: 13,
    color: '#9ad4df',
    textShadowColor: 'rgba(55, 230, 255, 0.2)',
    textShadowRadius: 6,
  },
  configStatus: {
    fontSize: 12,
    color: '#8dc7d4',
    textShadowColor: 'transparent',
  },
  configRow: {
    flexDirection: 'row',
    gap: 16,
  },
  configBlock: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(44, 228, 255, 0.2)',
    backgroundColor: 'rgba(7, 29, 46, 0.85)',
    padding: 12,
    gap: 6,
  },
  configValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#d7f9ff',
  },
  configLabel: {
    fontSize: 11,
    color: '#7fb9c7',
    textShadowColor: 'transparent',
  },
});
