# FilmMatch — Letterboxd AI Recommender

This project uses:

- GitHub for source code
- Vercel for hosting and the secure serverless API route
- Google Gemini for recommendations
- Letterboxd CSV exports as the user's long-term taste profile

## Architecture

Browser:
1. User uploads Letterboxd ZIP.
2. ZIP is parsed locally with JSZip.
3. CSV files are parsed locally with Papa Parse.
4. A compact profile is created.
5. User answers current-preference questions.

Serverless API:
6. Browser sends only the compact profile to `/api/recommend`.
7. Vercel reads `GEMINI_API_KEY` from an environment variable.
8. Vercel calls Gemini.
9. Recommendations are returned to the browser.

The original Letterboxd ZIP is never sent to the API.

## Important

Never put `GEMINI_API_KEY` in `app.js`, `index.html`, GitHub Actions logs,
or any other public repository file.

## Deploying

### 1. Push these files to GitHub

Repository structure:

```text
letterboxd-recommender/
├── api/
│   └── recommend.js
├── app.js
├── index.html
├── styles.css
├── .gitignore
├── .nojekyll
└── README.md
```

### 2. Import the GitHub repository into Vercel

Create/sign into a Vercel account and choose:

Add New → Project → Import Git Repository

Select this repository and deploy it.

Vercel automatically detects the `/api/recommend.js` serverless function.

### 3. Add the Gemini key

In Vercel:

Project → Settings → Environment Variables

Add:

```text
Name: GEMINI_API_KEY
Value: YOUR_GEMINI_API_KEY
```

Apply it to the environments you are using, then redeploy.

Optional:

```text
Name: GEMINI_MODEL
Value: gemini-2.5-flash
```

The code defaults to `gemini-2.5-flash`, so this variable is optional.

### 4. Use the Vercel URL

Your Vercel deployment becomes the live version of the site.

You can keep GitHub Pages enabled if you want, but the AI version must be accessed
through the Vercel deployment because GitHub Pages cannot execute `/api/recommend.js`.

## Testing

1. Open the Vercel URL.
2. Upload your Letterboxd ZIP.
3. Confirm the profile statistics appear.
4. Answer the preference questions.
5. Click "Get my recommendations."
6. Confirm five recommendations appear.

If you see:

`GEMINI_API_KEY is not configured`

the environment variable has not been added to the correct Vercel project/environment
or the deployment has not been redeployed after adding it.

If you see:

`The AI provider returned an error`

check the Vercel function logs and confirm the Gemini API key is valid and has available
API access/quota.

## Privacy

The original ZIP is parsed in the browser. The server receives only the compact profile
containing selected Letterboxd information and current preferences.

This version does not create a user database or store recommendation history.

However, once a profile is sent to the serverless function, it is transmitted to the
AI provider for processing. Do not describe the entire system as "data never leaves
your computer"; the accurate statement is that the original ZIP stays local and only
the selected recommendation profile is sent for the AI request.
