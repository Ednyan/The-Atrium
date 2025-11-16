/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        lobby: {
          dark: '#18181b',      // Moody dark gray
          darker: '#0a0a0c',    // Almost black
          accent: '#71717a',    // Muted gray accent
          light: '#fafafa',     // Off-white
          muted: '#27272a',     // Dark muted gray
        }
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', 'cursive'],
      }
    },
  },
  plugins: [],
}
