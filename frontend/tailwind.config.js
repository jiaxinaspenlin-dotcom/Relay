/** @type {import('tailwindcss').Config} */
// Tokens from .kiro/steering/design.md
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1C2B33",
        muted: "#5B6B70",
        line: "#DDE3E0",
        paper: "#F6F8F7",
        surface: "#FFFFFF",
        hemlock: { DEFAULT: "#1F5F5B", tint: "#E3EFEC" },
        amber: { DEFAULT: "#9A5208", tint: "#FBEFD9" },
        rust: { DEFAULT: "#A3302A", tint: "#F8E3E0" },
      },
      fontFamily: {
        sans: ['"Public Sans"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      fontSize: {
        page: ["28px", "36px"],
        section: ["20px", "28px"],
        body: ["15px", "22px"],
        caption: ["13px", "18px"],
      },
      borderRadius: { control: "6px", panel: "10px" },
      boxShadow: { pop: "0 8px 24px rgba(28, 43, 51, 0.12)" },
    },
  },
  plugins: [],
};
