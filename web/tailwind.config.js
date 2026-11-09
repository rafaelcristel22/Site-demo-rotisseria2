/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Barlow Condensed"', 'Arial Narrow', 'sans-serif'],
        sans: ['Barlow', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#fff8ed', 100: '#ffefd4', 200: '#ffdba8', 300: '#ffc070', 400: '#ff9a37',
          500: '#f97b10', 600: '#ea5f06', 700: '#c24508', 800: '#9a370f', 900: '#7c2f10', 950: '#431505',
        },
        ember: { 500: '#c0392b', 600: '#a12a1f' },
        cream: '#f5f0e6',
        paper: '#fbf8f2',
        char: '#1b1a17',
        red: { 600: '#b3261e', 700: '#951d17' },
      },
      boxShadow: { card: '0 1px 0 rgba(27,26,23,.08)' },
    },
  },
  plugins: [],
};
