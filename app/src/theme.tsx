import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { theme } from '../../shared/theme';

export type Palette = (typeof theme)['light'] | (typeof theme)['dark'];

const ThemeContext = createContext<Palette>(theme.light);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? theme.dark : theme.light;
  return <ThemeContext.Provider value={colors}>{children}</ThemeContext.Provider>;
}

export function usePalette(): Palette {
  return useContext(ThemeContext);
}

export const fonts = {
  heading: 'Poppins_800ExtraBold',
  label: 'Poppins_600SemiBold',
  body: 'Poppins_400Regular',
} as const;
