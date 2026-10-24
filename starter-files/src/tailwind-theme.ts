// Tailwind v4's browser build reads this style before it initializes. Creating
// it here rather than in index.html keeps the browser parser from requesting
// the virtual "tailwindcss/*.css" imports as network URLs.
//
// Preflight is intentionally omitted so it does not overwrite the starter's
// existing reset, and utilities stay unlayered so they beat that reset.
const style = document.createElement('style');
style.type = 'text/tailwindcss';
style.textContent = `
  @import "tailwindcss/theme.css" layer(theme);
  @import "tailwindcss/utilities.css";

  @theme {
    --color-primary: #0abab5;
  }
`;
document.head.appendChild(style);

export {};
