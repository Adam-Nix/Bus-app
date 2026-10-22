# Next Bus

A small, installable web app (PWA) that shows live bus departures for your
stop, using the same data as [bustimes.org](https://bustimes.org). The stop
name at the top is a dropdown of saved stops, which come set up for the 302:

- **Limerick IT** (where the app opens): buses into the city
- **City (Harvey's Quay)**: buses from the city
- **Mayorstone Upper**: buses arriving from the city
- **Colbert Station**: the 55 to Waterford

You can save any other stop in Great Britain or Ireland.

- **Stops** (top right) finds stops near you or by code; **Back to
  departures** returns to the board.
- Tap **Save** on any stop to add it to the dropdown and the Stops page.
- Buttons for each route with a bus leaving soon filter the board. Each stop
  always opens on its usual route (the 302, or the 55 at Colbert Station).

- Big "next bus" countdown, with live tracking, how many stops away the bus
  is, and whether it's running late.
- Refreshes every 30 seconds while it's open; pauses in the background.
- Works offline: opens instantly and falls back to timetable times.
- Find stops near you, or open one by code or bustimes.org link.
- Light and dark mode, screen-reader friendly, no accounts or tracking.

## How it gets the times

Everything runs in the browser, so the app is a plain static site. It reads
the parts of bustimes.org that are open to other websites:

1. **Timetable**: `/api/services/?stops=…` and `/api/trips/?service=…&date=…`
   list today's trips; `/api/trips/<id>/` gives the time each trip reaches
   your stop. Trip times are cached on the phone for a week, so after the
   first visit the app barely touches the timetable API.
2. **Live positions**: `/vehicles.json?service=…` (the feed behind the
   bustimes.org map) gives every tracked bus's trip and delay. Expected time =
   timetabled time + delay. Like bustimes.org, an early bus is shown at its
   timetabled time (drivers wait at timing points) and flagged as "running
   early".

The logic lives in `src/departures.ts` and is covered by unit tests.

bustimes.org is run by one person. The app keeps its requests low: at most a
handful per refresh, only while it's open on screen. Please keep it that way
if you change it.

## Develop

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run build    # type-check and production build into dist/
```

## Deploy to GitHub Pages

1. In the repository on GitHub, go to **Settings → Pages** and set **Source**
   to **GitHub Actions**.
2. Merge to `master` (or run the **Deploy to GitHub Pages** workflow by hand).
   The workflow tests, builds and publishes the site.
3. Open `https://<your-username>.github.io/<repo-name>/` on the phone.

## Install on a phone

- **Android (Chrome)**: open the site, then tap **Install app** on the Stops
  screen, or use the browser menu → **Add to Home screen**.
- **iPhone (Safari)**: tap **Share** → **Add to Home Screen**.

## Credits

Data from [bustimes.org](https://bustimes.org), built on public sector
information (Open Government Licence / NTA open data).
