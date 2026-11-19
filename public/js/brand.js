// The ONE place the product's name and identity are defined. After editing, run `npm run rebrand` to sync the two
// static files that cannot import JavaScript (index.html and manifest.webmanifest). A test fails if they drift apart.
// The logo is the file at `logo` (public/icon.svg): it is the header logo, the favicon and the installed-app icon.
export const BRAND = {
  name: 'Raflix',
  tagline: 'Browse what\u2019s trending and play it from your BDIX sources.',
  themeColor: '#0c111b', // browser UI colour; also the manifest background
  logo: '/icon.svg',
};
