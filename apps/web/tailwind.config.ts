import type { Config } from 'tailwindcss'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: {
          obsidian: 'rgb(var(--wt-canvas) / <alpha-value>)',
          light: 'rgb(var(--wt-canvas) / <alpha-value>)',
        },
        surface: {
          dark: 'rgb(var(--wt-surface) / <alpha-value>)',
          light: 'rgb(var(--wt-surface) / <alpha-value>)',
          subtle: 'rgb(var(--wt-surface-subtle) / <alpha-value>)',
          raised: 'rgb(var(--wt-surface-raised) / <alpha-value>)',
          hover: 'rgb(var(--wt-surface-hover) / <alpha-value>)',
        },
        border: {
          dark: 'rgb(var(--wt-border) / <alpha-value>)',
          light: 'rgb(var(--wt-border) / <alpha-value>)',
          DEFAULT: 'rgb(var(--wt-border) / <alpha-value>)',
        },
        divider: 'rgb(var(--wt-divider) / <alpha-value>)',
        text: {
          primary: 'rgb(var(--wt-text-primary) / <alpha-value>)',
          muted: 'rgb(var(--wt-text-muted) / <alpha-value>)',
        },
        focus: 'rgb(var(--wt-focus) / <alpha-value>)',
        brand: {
          primary: 'rgb(var(--wt-brand-primary) / <alpha-value>)',
          cyan: 'rgb(var(--wt-brand-cyan) / <alpha-value>)',
          'cyan-bright': 'rgb(var(--wt-brand-cyan-bright) / <alpha-value>)',
          action: 'rgb(var(--wt-brand-action) / <alpha-value>)',
          'action-hover': 'rgb(var(--wt-brand-action-hover) / <alpha-value>)',
          dark: 'rgb(var(--wt-brand-text) / <alpha-value>)',
          light: 'rgb(var(--wt-brand-text) / <alpha-value>)',
          foreground: 'rgb(var(--wt-brand-foreground) / <alpha-value>)',
        },
        status: {
          warning: 'rgb(var(--wt-status-warning) / <alpha-value>)',
          'warning-foreground': 'rgb(var(--wt-status-warning-foreground) / <alpha-value>)',
        }
      },
      fontFamily: {
        ui: ['var(--wt-font-ui)'],
        display: ['var(--wt-font-display)'],
      },
      borderRadius: {
        card: 'var(--wt-radius-card)',
        control: 'var(--wt-radius-control)',
      }
    },
  },
  plugins: [
    function({ addUtilities }: { addUtilities: any }) {
      addUtilities({
        '.tabular-nums': {
          fontVariantNumeric: 'tabular-nums',
        }
      })
    }
  ],
} satisfies Config
