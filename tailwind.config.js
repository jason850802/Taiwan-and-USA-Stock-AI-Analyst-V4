/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: '#0f172a', card: '#1e293b', inset: '#0b1220', line: '#334155' },
        accent: { DEFAULT: '#3b82f6', hover: '#2563eb' },
        ai: { DEFAULT: '#8b5cf6' },
        up: { DEFAULT: '#f0405a', muted: '#f0405a26' },
        down: { DEFAULT: '#22c55e', muted: '#22c55e26' },
        ok: { DEFAULT: '#22c55e', muted: '#22c55e26' },
        danger: { DEFAULT: '#f0405a', muted: '#f0405a26' },
        warn: { DEFAULT: '#f59e0b' },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans TC', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { ctl: '0.5rem', card: '0.75rem', modal: '1rem' },
    },
  },
};
