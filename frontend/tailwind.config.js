export default {
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
        ink: "#111827",
        canvas: "#F9FAFB",
        line: "#E5E7EB",
        card: "#FFFFFF",
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          900: "#1e3a8a",
        },
        paper: {
          50: "#F9FAFB",
          100: "#F9FAFB",
          200: "#E5E7EB",
        },
      },
    },
  },
  plugins: [],
};
