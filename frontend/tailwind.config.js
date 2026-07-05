/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Semantic, theme-aware surface & text tokens (see index.css for values).
        canvas: "rgb(var(--jg-canvas) / <alpha-value>)",
        card: "rgb(var(--jg-card) / <alpha-value>)",
        "card-2": "rgb(var(--jg-card-2) / <alpha-value>)",
        line: "rgb(var(--jg-line) / <alpha-value>)",
        line2: "rgb(var(--jg-line-2) / <alpha-value>)",
        ink: "rgb(var(--jg-ink) / <alpha-value>)",
        muted: "rgb(var(--jg-muted) / <alpha-value>)",
        faint: "rgb(var(--jg-faint) / <alpha-value>)",
        // Primary brand — green (works in both themes).
        brand: {
          50: "#ECF7F1",
          100: "#D6EEE2",
          200: "#ADDCC4",
          300: "#7CC6A2",
          400: "#4FAE81",
          500: "#2E9E72",
          600: "#23875C",
          700: "#1D6E4C",
          800: "#175A3F",
          900: "#123F2D",
        },
        // Secondary data accent — violet.
        accent: {
          300: "#B9A3FF",
          400: "#9F7DFF",
          500: "#7C5CFC",
          600: "#6A4DE0",
        },
      },
      boxShadow: {
        card: "0 4px 20px rgb(var(--jg-shadow) / 0.05)",
        lift: "0 14px 30px rgb(var(--jg-shadow) / 0.10)",
        pop: "0 12px 32px rgb(var(--jg-shadow) / 0.16)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.25s ease-out both",
        "scale-in": "scale-in 0.2s ease-out both",
        shimmer: "shimmer 1.8s linear infinite",
      },
    },
  },
  plugins: [],
};
