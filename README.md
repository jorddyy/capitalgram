# Capitalgram

A small offline web app for learning world capitals and solving capital anagrams, built for pub-quiz practice. It covers 195 countries.

- **Learn**: flashcards in both directions (country → capital, capital → country). Answer by typing, flipping the card, or (easier) picking from four. Every question shows a map of the region with the country highlighted. Spaced repetition brings back the ones you miss.
- **Anagrams**: rounds of scrambled capitals, shown either as a plain letter shuffle (NILREB) or as real words (PAIRS → Paris). Hints (region map, country, word lengths, first letter) cost a point each. Optional timer.
- **Atlas**: browse every country and capital on the map, and see how much of each continent you've learned.

Progress is stored only in the browser, in `localStorage`. Settings → Backup gives a code you can copy to keep it safe or move it to another device.

## Install on a phone

1. Open the site in Firefox (or Chrome) on Android.
2. Menu ⋮ → **Add app to Home screen**.
3. Open it once while online. After that it works offline.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The service worker needs `http://localhost` or HTTPS; opening `index.html` as a file won't work.

## Deploy (GitHub Pages)

Push to GitHub, then go to Settings → Pages → Deploy from a branch → `main` / root. There's no build step.

The service worker serves the cached copy first and refreshes it in the background, so installed apps pick up a new deploy on the next launch. If you add, rename or remove files, list them in `FILES` in `sw.js` and bump `VERSION`.

## Regenerating the data

The files in `data/` are committed; you only need this to change the country list or the anagrams.

```sh
python3 tools/build_data.py        # data/countries.json
python3 -m pip install wordfreq    # in a virtualenv
python3 tools/make_anagrams.py     # data/anagrams.json (about 40 s)
```

`build_data.py` downloads its sources into `tools/.cache/`. Quiz conventions live in `OVERRIDES` in `build_data.py`: English names, other accepted answers, and notes shown with the answer. `make_anagrams.py` also needs `/usr/share/dict/american-english` (Debian/Ubuntu package `wamerican`).

## Data sources

- Countries and capitals: [mledoze/countries](https://github.com/mledoze/countries) (ODbL)
- Capital coordinates and map shapes: [Natural Earth](https://www.naturalearthdata.com/) (public domain), via [world-atlas](https://github.com/topojson/world-atlas)
- Word frequencies for anagrams: [wordfreq](https://github.com/rspeer/wordfreq)
- Map rendering: [d3-geo](https://github.com/d3/d3-geo) and [topojson-client](https://github.com/topojson/topojson-client), in `vendor/`
