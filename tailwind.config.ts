import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        muted: "#667085",
        line: "#E7EAF0",
        shell: "#F7F8FB",
        orange: {
          50: "#F0F8F4",
          100: "#DDF0E8",
          200: "#BFE0D3",
          300: "#86C4AD",
          400: "#3F9A78",
          500: "#0C765C",
          600: "#075F4A",
          700: "#06473B",
          800: "#04362E"
        }
      },
      boxShadow: {
        soft: "0 16px 40px rgba(23, 32, 51, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
