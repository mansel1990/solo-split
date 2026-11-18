import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Linking, Share, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { RefObject } from 'react';

export async function copyText(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
}

export async function openWhatsApp(phone: string | null, text: string): Promise<void> {
  const encoded = encodeURIComponent(text);
  const digits = phone?.replace(/\D/g, '') ?? '';
  const url = digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
  try {
    await Linking.openURL(url);
  } catch {
    throw new Error('WhatsApp is not available on this phone');
  }
}

export async function shareText(text: string): Promise<void> {
  await Share.share({ message: text });
}

export async function shareView(ref: RefObject<View | null>): Promise<void> {
  const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share AllSquare' });
    return;
  }
  await Share.share({ message: uri });
}
