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
          obsidian: '#070A0F',
          light: '#F8FAFC',
        },
        surface: {
          dark: '#111622',
          light: '#FFFFFF',
        },
        border: {
          dark: '#1E293B',
          light: '#E2E8F0',
        },
        brand: {
          dark: '#00E599', // Virunga Emerald
          light: '#00875A', // Virunga Emerald
        },
        secondary: {
          amber: '#F5A623', // Solar Amber
        }
      },
      fontFamily: {
        display: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
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
