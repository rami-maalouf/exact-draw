# Exact Draw's website

The one-page site for Exact Draw at https://draw.orbitlabs.studio: what the app is, the real app in
a window that settles flat as you scroll, and the Mac waitlist.

It is plain HTML, CSS and one module, bundled by [Bun](https://bun.sh) into static files, with one
Vercel function for the waitlist.

| File | What it is |
|---|---|
| `src/index.html` | The page: hero with the app window, the lit statement, three cards, the close, the waitlist dialog. |
| `src/styles.css` | The look: near-black with a violet cast, the brand's pencil violet, Virgil for the one hand-drawn note. |
| `src/main.js` | Entrances, the window tilt, the word-by-word statement, and the waitlist (`/?join` opens it). |
| `api/waitlist.ts` | Saves the email to the shared Notion waitlist (`App: exact-draw`, `Platform: macOS`). Needs `NOTION_API_KEY` and `NOTION_WAITLIST_DATASOURCE_ID` on the Vercel project. |
| `src/img/` | `app.jpg` (a capture of the installed app with the road-board drawing, 1800 px wide), the mark, icons, and `share.jpg` (a 1200x630 capture of the hero). |
| `src/public/fonts/` | Sora, Geist, Geist Mono, and Virgil from `@excalidraw/excalidraw` (all SIL OFL). |

```sh
bun install
bun run preview    # build, then serve dist/ on a local port
./deploy.sh        # build and publish to Vercel (project "exact-draw")
```

Keep each claim true to the app: the repository `README.md` is the source.
