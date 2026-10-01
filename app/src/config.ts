import Constants from 'expo-constants';

type Extra = {
  apiBaseUrl: string;
  googleWebClientId: string;
};

function readExtra(): Extra {
  const extra = Constants.expoConfig?.extra as Partial<Extra> | undefined;
  if (!extra?.apiBaseUrl) {
    throw new Error('API base URL is missing from the app config');
  }
  if (!extra.googleWebClientId) {
    throw new Error('Google web client id is missing from the app config');
  }
  return {
    apiBaseUrl: extra.apiBaseUrl.replace(/\/$/, ''),
    googleWebClientId: extra.googleWebClientId,
  };
}

export function apiBaseUrl(): string {
  return readExtra().apiBaseUrl;
}

export function googleWebClientId(): string {
  return readExtra().googleWebClientId;
}
