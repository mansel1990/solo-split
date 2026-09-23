export const theme = {
  light: {
    primary: '#0B1F3A',
    accent: '#3DDC97',
    secondary: '#FF6B6B',
    background: '#F3F6FA',
    surface: '#FFFFFF',
    text: '#0B1F3A',
    textMuted: '#5B6B82',
    border: '#E2E8F0',
    positive: '#0E9F6E',
    negative: '#E03E3E',
  },
  dark: {
    primary: '#0B1F3A',
    accent: '#3DDC97',
    secondary: '#FF6B6B',
    background: '#07152A',
    surface: '#0F2747',
    text: '#F3F6FA',
    textMuted: '#9FB0C6',
    border: '#1E3A5F',
    positive: '#4ADE80',
    negative: '#F87171',
  },
} as const;

export const brand = {
  name: 'AllSquare',
  tagline: 'I log. You pay. We\'re all square.',
  fonts: {
    heading: 'Poppins_800ExtraBold',
    label: 'Poppins_600SemiBold',
    body: 'Poppins_400Regular',
  },
} as const;
