import Constants from 'expo-constants';
import { Platform } from 'react-native';

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, '');
}

export function getApiBaseUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

  if (envUrl) {
    return stripTrailingSlash(envUrl);
  }

  if (Platform.OS === 'android') {
    return 'http://192.168.1.7:3000';
  }

  const hostUri = Constants.expoConfig?.hostUri;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:3000`;
  }

  return 'http://192.168.1.7:3000';
}