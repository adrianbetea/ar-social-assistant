import Constants from 'expo-constants';
import { Platform } from 'react-native';

const TOKEN_KEY = 'ar_assistant_token';

let authToken: string | null = null;

// Restore token from localStorage on module load (web only)
if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
  authToken = window.localStorage.getItem(TOKEN_KEY) || null;
}

export function setAuthToken(token?: string | null) {
  authToken = token?.trim() || null;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    if (authToken) {
      window.localStorage.setItem(TOKEN_KEY, authToken);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  }
}

export function getAuthToken() {
  return authToken;
}

function stripTrailingSlash(value: string) {
  return value.replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
}

export function getApiBaseUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

  if (envUrl) {
    return stripTrailingSlash(envUrl);
  }

  // For web, use localhost:8081 (backend runs on 8081)
  if (Platform.OS === 'web') {
    try {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      return `http://${host}:3000`;
    } catch {
      return 'http://localhost:3000';
    }
  }

  // For Android emulators/devices use the development machine IP or expo hostUri
  if (Platform.OS === 'android') {
    return 'http://192.168.1.6:3000';
  }

  const hostUri = Constants.expoConfig?.hostUri;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:3000`;
  }

  return 'http://192.168.1.6:3000';
}