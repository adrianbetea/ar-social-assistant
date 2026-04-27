import { useMemo } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { AppLogo } from '@/components/auth/app-logo';
import { AuthForm } from '@/components/auth/auth-form';
import { getApiBaseUrl } from '@/constants/api';
import { NeonText } from '@/components/neon-text';

export default function AuthPage() {
  const router = useRouter();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const subtitle = useMemo(
    () => 'Authenticate to access social analysis and live wingman support.',
    []
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.backgroundGlowTop} pointerEvents="none" />
      <View style={styles.backgroundGlowBottom} pointerEvents="none" />

      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 14 : 0}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <AppLogo />
            <NeonText style={styles.subtitle}>{subtitle}</NeonText>

            <AuthForm
              onSubmit={async ({ mode, email, password, username }) => {
                const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
                const payload =
                  mode === 'register'
                    ? { username, email, password }
                    : { email, password };

                const response = await fetch(`${apiBaseUrl}${endpoint}`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(payload),
                });

                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                  throw new Error(data.message || 'Authentication failed.');
                }

                Alert.alert(
                  mode === 'register' ? 'Account created' : 'Login successful',
                  data.message || 'You can now enter the app.'
                );
                router.replace('/(tabs)');
              }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#030b14',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 34,
    paddingBottom: 18,
    justifyContent: 'center',
    gap: 20,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    color: '#add8e2',
    textShadowColor: 'rgba(55, 230, 255, 0.28)',
    textShadowRadius: 8,
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -80,
    left: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(18, 107, 130, 0.22)',
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -110,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(0, 168, 204, 0.16)',
  },
});
