import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { NeonText } from '@/components/neon-text';
import { getApiBaseUrl, getAuthToken } from '@/constants/api';

type InteractionLog = {
  id: number;
  analysis: string | null;
  translationSnippet: string | null;
  createdAt: string;
};

export default function LogsScreen() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [logs, setLogs] = useState<InteractionLog[]>([]);
  const [status, setStatus] = useState<'loading' | 'idle' | 'error' | 'auth'>('loading');

  const formatTimestamp = useCallback((value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }, []);

  const loadLogs = useCallback(() => {
    let isActive = true;

    const fetchLogs = async () => {
      setStatus('loading');
      try {
        const token = getAuthToken();
        if (!token) {
          setStatus('auth');
          setLogs([]);
          return;
        }

        const response = await fetch(`${apiBaseUrl}/api/ai/logs?limit=50`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.message || 'Failed to load logs.');
        }

        if (isActive) {
          setLogs(Array.isArray(data.logs) ? data.logs : []);
          setStatus('idle');
        }
      } catch (error) {
        if (isActive) {
          setStatus('error');
        }
      }
    };

    fetchLogs();

    return () => {
      isActive = false;
    };
  }, [apiBaseUrl]);

  useFocusEffect(loadLogs);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <NeonText style={styles.backLabel}>Back</NeonText>
          </Pressable>
          <NeonText style={styles.title}>Recent Logs</NeonText>
        </View>
        <NeonText style={styles.subtitle}>Latest interactions recorded from your assistant sessions.</NeonText>

        <View style={styles.statusRow}>
          {status === 'loading' ? <ActivityIndicator /> : null}
          {status === 'auth' ? (
            <NeonText style={styles.statusText}>Sign in to view recent logs.</NeonText>
          ) : null}
          {status === 'error' ? (
            <NeonText style={styles.statusText}>Unable to load logs right now.</NeonText>
          ) : null}
        </View>

        {status === 'idle' && logs.length === 0 ? (
          <NeonText style={styles.statusText}>No interactions recorded yet.</NeonText>
        ) : null}

        {logs.map((log) => (
          <View key={log.id} style={styles.logCard}>
            <View style={styles.logHeader}>
              <NeonText style={styles.logTitle}>Log #{log.id}</NeonText>
              <NeonText style={styles.logTime}>{formatTimestamp(log.createdAt)}</NeonText>
            </View>
            <NeonText style={styles.logLabel}>Analysis</NeonText>
            <NeonText style={styles.logValue}>{log.analysis || '—'}</NeonText>
            <NeonText style={styles.logLabel}>Translation snippet</NeonText>
            <NeonText style={styles.logValue}>{log.translationSnippet || '—'}</NeonText>
          </View>
        ))}
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
    gap: 16,
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(111, 246, 255, 0.35)',
  },
  backLabel: {
    fontSize: 12,
    color: '#7fefff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  subtitle: {
    fontSize: 13,
    color: '#9dd3df',
    textShadowColor: 'rgba(55, 230, 255, 0.3)',
    textShadowRadius: 6,
    marginBottom: 8,
  },
  statusRow: {
    minHeight: 28,
  },
  statusText: {
    marginBottom: 8,
    color: '#7fb9c7',
  },
  logCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(31, 60, 79, 0.35)',
    backgroundColor: 'rgba(3, 18, 33, 0.78)',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logTitle: {
    fontSize: 13,
    color: '#dcfbff',
  },
  logTime: {
    fontSize: 11,
    color: '#7fb9c7',
  },
  logLabel: {
    marginTop: 8,
    fontSize: 11,
    color: '#7fb9c7',
  },
  logValue: {
    lineHeight: 20,
    color: '#dcfbff',
  },
});
