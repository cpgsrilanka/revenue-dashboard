/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12302B",      // deep teal — nav, dark surfaces
        paper: "#FBF9F4",    // warm ivory — page background
        brass: "#B8924A",    // accent — positive figures, CTAs, the signature tideline
        brick: "#C1544A",    // alerts, negative deltas, critical data-quality flags
        slate: "#445A56",    // secondary text
        line: "#DCD5C7",     // hairline dividers
        amberflag: "#C9A227" // warning-severity data quality flags
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        sans: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-plex-mono)", "monospace"]
      }
    }
  },
  plugins: []
};
