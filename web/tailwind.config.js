/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#fff8ed', 100: '#ffefd4', 200: '#ffdba8', 300: '#ffc070', 400: '#ff9a37',
          500: '#f97b10', 600: '#ea5f06', 700: '#c24508', 800: '#9a370f', 900: '#7c2f10', 950: '#431505',
        },
        ember: { 500: '#d9381e', 600: '#b92a14' },
        cream: '#fbf6ef',
        char: '#1c1410',
      },
      boxShadow: { card: '0 1px 2px rgba(28,20,16,.06), 0 8px 24px -12px rgba(28,20,16,.18)' },
    },
  },
  plugins: [],
};
