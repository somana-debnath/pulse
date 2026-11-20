import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        card: v("card"),
        line: v("line"),
        ink: v("ink"),
        muted: v("muted"),
        coral: v("coral"),
        "coral-ink": v("coral-ink"),
        "btn-bg": v("btn-bg"),
        "btn-fg": v("btn-fg"),
        dark: v("dark"),
        "on-dark": v("on-dark"),
        up: v("up"),
        warn: v("warn"),
        down: v("down"),
        "up-ink": v("up-ink"),
        "warn-ink": v("warn-ink"),
        "down-ink": v("down-ink"),
        "up-soft": v("up-soft"),
        "warn-soft": v("warn-soft"),
        "down-soft": v("down-soft"),
        none: v("none"),
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: { card: "14px" },
      boxShadow: { soft: "0 1px 2px rgb(23 22 28 / 0.04), 0 8px 24px -12px rgb(23 22 28 / 0.10)" },
    },
  },
  plugins: [],
} satisfies Config;
