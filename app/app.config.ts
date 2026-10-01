import type { ExpoConfig } from 'expo/config';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

if (!apiBaseUrl) {
  throw new Error('EXPO_PUBLIC_API_BASE_URL is required');
}
if (!googleWebClientId) {
  throw new Error('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is required');
}

const config: ExpoConfig = {
  name: 'AllSquare',
  slug: 'allsquare',
  owner: 'mansel',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'allsquare',
  userInterfaceStyle: 'automatic',
  platforms: ['android'],
  android: {
    package: 'com.sanjay.allsquare',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0B1F3A',
    },
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-secure-store',
    'expo-sqlite',
    'expo-font',
    'expo-status-bar',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0B1F3A',
        image: './assets/splash-icon.png',
        imageWidth: 200,
      },
    ],
    '@react-native-google-signin/google-signin',
  ],
  extra: {
    apiBaseUrl,
    googleWebClientId,
    eas: {
      projectId: 'bf93ed04-7555-475b-880f-bd26e44309eb',
    },
  },
};

export default config;
