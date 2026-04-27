import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CyberButton } from '@/components/cyber-button';
import { NeonText } from '@/components/neon-text';

type AuthMode = 'login' | 'register';

type AuthFormProps = {
  onSubmit?: (payload: { mode: AuthMode; username: string; email: string; password: string }) => Promise<void> | void;
};

export function AuthForm({ onSubmit }: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modeLabel = useMemo(
    () =>
      mode === 'login' ? 'Create Operative Account' : 'System Login',
    [mode]
  );

  const buttonLabel = mode === 'login' ? 'Initialize System' : 'Create Operative';

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      Alert.alert(
        'Missing credentials',
        mode === 'register'
          ? 'Please provide username, email, and password.'
          : 'Please provide both email and password.'
      );
      return;
    }

    if (mode === 'register' && !username.trim()) {
      Alert.alert('Missing credentials', 'Please provide username, email, and password.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit?.({ mode, username: username.trim(), email: email.trim(), password });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.panel}>
      <NeonText style={styles.heading}>{mode === 'login' ? 'System Login' : 'Create Operative Account'}</NeonText>

      {mode === 'register' ? (
        <View style={styles.fieldGroup}>
          <NeonText style={styles.label}>Username</NeonText>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="codename"
            placeholderTextColor="#6d98a6"
            style={styles.input}
            value={username}
            onChangeText={setUsername}
          />
        </View>
      ) : null}

      <View style={styles.fieldGroup}>
        <NeonText style={styles.label}>Email</NeonText>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="agent@domain.com"
          placeholderTextColor="#6d98a6"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
        />
      </View>

      <View style={styles.fieldGroup}>
        <NeonText style={styles.label}>Password</NeonText>
        <TextInput
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor="#6d98a6"
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />
      </View>

      <CyberButton
        label={isSubmitting ? 'Connecting...' : buttonLabel}
        onPress={handleSubmit}
      />

      <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
        <NeonText style={styles.toggle}>{modeLabel}</NeonText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(78, 232, 255, 0.45)',
    backgroundColor: 'rgba(3, 18, 33, 0.78)',
    gap: 14,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    color: '#9cd2df',
    textShadowColor: 'transparent',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2ce4ff',
    backgroundColor: 'rgba(6, 31, 52, 0.85)',
    color: '#dcfbff',
    paddingHorizontal: 12,
    fontSize: 15,
  },
  toggle: {
    marginTop: 2,
    fontSize: 13,
    textAlign: 'center',
    color: '#9ad4df',
    textShadowColor: 'rgba(55, 230, 255, 0.2)',
    textShadowRadius: 6,
  },
});
