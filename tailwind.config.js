/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Desaturated (grayscale) palette -- same lightness values as the
        // original warm beige/gold "Nier:Automata" theme, with saturation
        // removed. `red` is kept as the one semantic accent for
        // errors/delete/danger, which is a deliberate exception, not an
        // oversight.
        nier: {
          // Driven by CSS variables so the landing page can be light or dark
          // without every class in it changing. Everywhere else they resolve
          // to the same values they always had.
          bg: 'rgb(var(--c-fg) / <alpha-value>)',
          strong: 'rgb(var(--c-strong) / <alpha-value>)',
          bgDark: '#B5B5B5',    // Darker
          bgDarker: '#9B9B9B',  // Even darker
          text: '#464646',      // Dark text
          textLight: '#656565', // Lighter text
          textMuted: '#848484', // Muted text
          accent: '#393939',    // Dark accent
          border: 'rgb(var(--c-line) / <alpha-value>)',
          highlight: '#FFFFFF', // White highlight
          shadow: 'rgba(0,0,0,0.15)', // Subtle shadow
          // Alternative darker theme for night mode
          black: 'rgb(var(--c-ground) / <alpha-value>)',
          blackLight: 'rgb(var(--c-surface) / <alpha-value>)',
          blackMuted: '#373737',
          gold: '#808080',      // Formerly gold accent; kept for compatibility, unused
          red: '#8B0000',       // Warning red (kept as the one semantic accent)
        },
        // Keep old colors for compatibility
        lobby: {
          dark: '#2A2A26',
          darker: '#1A1A18',
          accent: '#DAD4BB',
          light: '#DAD4BB',
          muted: '#3A3A34',
        }
      },
      fontFamily: {
        nier: ['Consolas', 'Monaco', 'Lucida Console', 'Liberation Mono', 'monospace'],
        pixel: ['"Press Start 2P"', 'cursive'],
      },
      boxShadow: {
        'nier': '0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)',
        'nier-hover': '0 4px 12px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.6)',
        'nier-inset': 'inset 0 2px 4px rgba(0,0,0,0.1)',
      },
      animation: {
        'nier-pulse': 'nier-pulse 2s ease-in-out infinite',
        'nier-scan': 'nier-scan 3s ease-in-out infinite',
        'nier-flicker': 'nier-flicker 0.15s ease-in-out',
        'nier-slide': 'nier-slide 1.2s ease-in-out infinite',
        'saving-fade': 'saving-fade 1.4s ease-in-out infinite',
        'nier-toast': 'nier-toast 0.22s ease-out',
      },
      keyframes: {
        'nier-pulse': {
          '0%, 100%': { opacity: '0.7' },
          '50%': { opacity: '1' },
        },
        'saving-fade': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.25' },
        },
        'nier-scan': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        'nier-flicker': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
        'nier-toast': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'nier-slide': {
          '0%': { width: '0%', marginLeft: '0%' },
          '50%': { width: '40%', marginLeft: '30%' },
          '100%': { width: '0%', marginLeft: '100%' },
        },
      },
    },
  },
  plugins: [],
}
