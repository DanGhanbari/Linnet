/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./apps/web/**/*.{html,js,mjs,ts,jsx,tsx}",
    "./packages/score-player/**/*.{html,js,mjs,ts}"
  ],
  theme: {
    extend: {
      colors: {
        alabaster: "#FAF6F0",
        cashmere: "#F2EAE1",
        sandstone: "#E4D6C8",
        taupe: "#C8B29E",
        cypress: "#1B3B2B",
        moss: "#2E5A44",
        obsidian: "#1C1917",
        umber: "#655B52",
        sage: "#2D6A4F",
        ochre: "#D97706",
        terracotta: "#B91C1C",
      },
      fontFamily: {
        display: ["Chillax", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        serif: ["Chillax", "Georgia", "serif"],
        sans: ["Figtree", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
