/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        app: "var(--bg-app)",
        sidebar: "var(--bg-sidebar)",
        canvas: "var(--bg-canvas)",
        "bubble-in": "var(--bg-bubble-in)",
        "app-input": "var(--bg-input)",
        "accent-primary": "var(--accent-primary)",
        "accent-hover": "var(--accent-hover)",
        "accent-soft": "var(--accent-soft)",
        "sim1-bg": "var(--sim1-bg)",
        "sim1-text": "var(--sim1-text)",
        "sim2-bg": "var(--sim2-bg)",
        "sim2-text": "var(--sim2-text)",
        "border-subtle": "var(--border-subtle)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
      },
      borderRadius: {
        "xs": "4px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
};
