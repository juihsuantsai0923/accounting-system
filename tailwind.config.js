/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Leviax 品牌深藍（取自 logo 的 #173B69）
        brand: {
          50: "#eef3f9",
          100: "#dbe6f2",
          200: "#b0c7e2",
          300: "#7fa3cd",
          400: "#4c7ab0",
          500: "#2f5a8f",
          600: "#1d4372",
          700: "#173b69",
          800: "#122c50",
          900: "#0b1b32",
        },
        // Leviax 品牌金黃（取自 logo 的 #E8A233），用來點綴強調重點
        gold: {
          50: "#fdf6e9",
          100: "#faebc9",
          200: "#f3d38e",
          300: "#edbb5c",
          400: "#eaac3f",
          500: "#e8a233",
          600: "#c9821f",
          700: "#a2661a",
          800: "#7c4f18",
          900: "#5c3b14",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 40 71 / 0.04), 0 2px 8px -2px rgb(15 40 71 / 0.08)",
        "card-hover": "0 4px 16px -4px rgb(15 40 71 / 0.14), 0 2px 6px -2px rgb(15 40 71 / 0.08)",
        header: "0 2px 16px -4px rgb(11 27 50 / 0.35)",
      },
      borderRadius: {
        xl: "0.875rem",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #173b69 0%, #0b1b32 100%)",
        "gold-gradient": "linear-gradient(135deg, #eaac3f 0%, #c9821f 100%)",
      },
    },
  },
  plugins: [],
};
