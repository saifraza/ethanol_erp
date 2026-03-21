/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { 50: '#FDF8F3', 100: '#F5E6D3', 200: '#E8CBA7', 300: '#D4A76A', 400: '#C4913F', 500: '#B87333', 600: '#9A5E2A', 700: '#7C4A21', 800: '#5E3718', 900: '#3D2410' },
        copper: { 50: '#FDF8F3', 100: '#F5E6D3', 200: '#E8CBA7', 300: '#D4A76A', 400: '#C4913F', 500: '#B87333', 600: '#9A5E2A', 700: '#7C4A21', 800: '#5E3718', 900: '#3D2410' },
        warm: { 50: '#FAFAF8', 100: '#F5F5F0', 200: '#E8E8E0', 300: '#D4D4CC', 400: '#9C9C94', 500: '#6B6B63', 600: '#4A4A44', 700: '#333330', 800: '#1F1F1C', 900: '#0F0F0D' },
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
