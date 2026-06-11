/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef7f4',
          100: '#d5ece3',
          200: '#acd9c8',
          300: '#76c0a6',
          400: '#3fa07e',
          500: '#0d7a5f',
          600: '#0a6650',
          700: '#085241',
          800: '#063d30',
          900: '#042920',
        }
      }
    }
  },
  plugins: []
};
