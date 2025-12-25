/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Nier:Automata inspired palette
        nier: {
          bg: '#DAD4BB',        // Main beige/cream background
          bgDark: '#C4BEA5',    // Darker beige
          bgDarker: '#A8A28D',  // Even darker beige
          text: '#4A4A42',      // Dark brown/gray text
          textLight: '#6B6B5F', // Lighter text
          textMuted: '#8A8A7D', // Muted text
          accent: '#3D3D35',    // Dark accent
          border: '#9C9681',    // Border color
          highlight: '#FFFFFF', // White highlight
          shadow: 'rgba(0,0,0,0.15)', // Subtle shadow
          // Alternative darker theme for night mode
          black: '#1A1A18',
          blackLight: '#2A2A26',
          blackMuted: '#3A3A34',
          gold: '#C9B037',      // Accent gold
          red: '#8B0000',       // Warning red
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
      },
      keyframes: {
        'nier-pulse': {
          '0%, 100%': { opacity: '0.7' },
          '50%': { opacity: '1' },
        },
        'nier-scan': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        'nier-flicker': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
      },
    },
  },
  plugins: [],
}
