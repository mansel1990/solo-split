import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { subscribeUndo, takeUndo } from './refresh';
import { fonts, usePalette } from './theme';

export function PrimaryButton({
  label,
  onPress,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const colors = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={[styles.primary, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
    >
      {busy
        ? <ActivityIndicator color={colors.primary} />
        : <Text style={[styles.primaryLabel, { color: colors.primary, fontFamily: fonts.label }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboard = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboard?: 'default' | 'decimal-pad' | 'phone-pad' | 'numbers-and-punctuation';
}) {
  const colors = usePalette();
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.textMuted, fontFamily: fonts.label }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboard}
        autoCapitalize={keyboard === 'default' ? 'sentences' : 'none'}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            fontFamily: fonts.body,
          },
        ]}
      />
    </View>
  );
}

export function FormScroll({
  children,
  contentContainerStyle,
  style,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = usePalette();
  return (
    <ScrollView
      style={[{ flex: 1, backgroundColor: colors.background }, style]}
      contentContainerStyle={[{ paddingBottom: 24 }, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  );
}

export function UndoHost() {
  const colors = usePalette();
  const [item, setItem] = useState<{ label: string; run: () => Promise<void> } | null>(null);

  useFocusEffect(useCallback(() => {
    const sync = () => {
      const next = takeUndo();
      if (next) setItem(next);
    };
    const unsubscribe = subscribeUndo(sync);
    sync();
    return unsubscribe;
  }, []));

  useEffect(() => {
    if (!item) return undefined;
    const timer = setTimeout(() => setItem(null), 5000);
    return () => clearTimeout(timer);
  }, [item]);

  if (!item) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        const run = item.run;
        setItem(null);
        void run();
      }}
      style={[styles.undo, { backgroundColor: colors.primary }]}
    >
      <Text style={[styles.undoLabel, { color: colors.accent, fontFamily: fonts.label }]}>{item.label} · Undo</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    marginTop: 20,
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { fontSize: 16 },
  fieldLabel: { marginTop: 16, marginBottom: 8, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  undo: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
  },
  undoLabel: { fontSize: 15 },
});
