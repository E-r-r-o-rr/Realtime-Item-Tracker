/**
 * PostCSS configuration for Tailwind CSS v4.
 *
 * Tailwind v4 removes the need for a separate tailwind.config.js file by
 * defaulting to inline configuration. However, we still configure PostCSS
 * here so Tailwind and Autoprefixer run when CSS is built. See the Tailwind
 * documentation for details【7890073222187†L23-L35】.
 */
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};