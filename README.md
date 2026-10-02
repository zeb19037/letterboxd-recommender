# FilmMatch — Letterboxd Recommender

A privacy-first Letterboxd recommendation prototype designed for GitHub Pages.

## What it does

1. User exports their Letterboxd account as a ZIP.
2. User drops the ZIP into the webpage.
3. JavaScript opens the ZIP in the browser.
4. CSV files are parsed locally.
5. The app builds a structured recommendation profile.
6. The app creates an AI-ready recommendation prompt.
7. No Letterboxd export is uploaded by this prototype.

Letterboxd provides account exports as ZIP files containing CSV documents.

## Files

- `index.html` — page structure
- `styles.css` — visual design
- `app.js` — ZIP parsing, CSV parsing, profile creation, and prompt generation
- `.gitignore` — prevents accidental commits of personal exports
- `.nojekyll` — tells GitHub Pages to serve this as a plain static site
- `README.md` — project documentation

## Important architecture limitation

GitHub Pages is static hosting. It can run browser JavaScript, but it cannot safely run a private API key or server-side Python.

The current version therefore stops at an AI-ready prompt.

For a real shared AI chatbot, the next step should be:

Browser
→ Letterboxd ZIP
→ local parser
→ recommendation profile
→ secure backend/serverless function
→ AI API
→ recommendations

Do NOT put an AI provider secret key directly in `app.js` or another public GitHub file.

## Deploy on GitHub Pages

### 1. Create a repository

Create a new GitHub repository. A project repository can be named something like:

`letterboxd-recommender`

You do not need a special `<username>.github.io` repository for a project site.

### 2. Upload these files

Upload:

- `index.html`
- `styles.css`
- `app.js`
- `.gitignore`
- `.nojekyll`
- `README.md`

Do not upload a real Letterboxd export.

### 3. Enable Pages

On GitHub:

Settings
→ Pages
→ Build and deployment
→ Source: Deploy from a branch
→ Branch: `main`
→ Folder: `/ (root)`
→ Save

GitHub will give you a Pages URL. Changes can take several minutes to publish.

## Testing

Before adding AI, test these cases:

- A normal Letterboxd ZIP
- A ZIP with a large number of films
- A ZIP containing reviews
- A ZIP containing a watchlist
- An invalid/non-ZIP file
- A ZIP with no CSV files

## Privacy note

This app is designed so the Letterboxd ZIP is read in the user's browser. It is not submitted to your GitHub repository or to a server by the code in this version.

GitHub Pages itself is still a public website and GitHub documents that visitor IP addresses are logged for security purposes. The app's privacy claim therefore specifically refers to the uploaded Letterboxd ZIP, not to general website/network metadata.

## Next development step

Add a secure backend endpoint for the AI call. The browser should send only the structured recommendation profile to that endpoint, not the original ZIP. The backend should hold the AI provider secret and return recommendations without storing the user's profile.
