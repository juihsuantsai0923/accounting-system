/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 跟 Leviax 官網（預設淺色主題）同一套：主色 brand-navy #1e3a6e＝700
        brand: {
          50: "#eef4ff", // 官網 brand-light
          100: "#e4ecfb", // 官網 brand-hover
          200: "#c6d6f3",
          300: "#8dafee", // 官網 brand-blue
          400: "#5a86d0", // 官網 brand-blue-dark
          500: "#3a63a8",
          600: "#2a4d8a",
          700: "#1e3a6e", // 官網 brand-navy
          800: "#172d56",
          900: "#0f1f3d",
        },
        // 官網金色 #ffd172（400）與金色漸層 #f5dc80 → #e8c96a → #c8a040
        gold: {
          50: "#fffaeb",
          100: "#fff1c7",
          200: "#ffe6a0",
          300: "#f5dc80",
          400: "#ffd172",
          500: "#e8c96a",
          600: "#c8a040",
          700: "#9c7a2c",
          800: "#765b20",
          900: "#4f3d16",
        },
      },
      fontFamily: {
        sans: ['"Noto Sans TC"', "system-ui", "-apple-system", '"Microsoft JhengHei"', "sans-serif"],
        serif: ['"Noto Serif TC"', "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 4px 6px -1px rgb(30 58 110 / 0.05), 0 2px 4px -2px rgb(30 58 110 / 0.05)",
        "card-hover": "0 10px 15px -3px rgb(30 58 110 / 0.10), 0 4px 6px -4px rgb(30 58 110 / 0.08)",
        header: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #1e3a6e 0%, #172d56 100%)",
        "gold-gradient": "linear-gradient(105deg, #f5dc80 0%, #e8c96a 50%, #c8a040 100%)",
      },
    },
  },
  plugins: [],
};
