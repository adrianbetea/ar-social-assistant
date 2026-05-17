import Constants from 'expo-constants';
import { Platform } from 'react-native';

let authToken: string | null = null;

export function setAuthToken(token?: string | null) {
  authToken = token?.trim() || null;
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
    return 'http://192.168.1.7:3000';
  }

  const hostUri = Constants.expoConfig?.hostUri;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:3000`;
  }

  return 'http://192.168.1.5:3000';
}