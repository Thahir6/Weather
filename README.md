# Aeris Weather

A responsive weather dashboard backed by OpenWeather. The API key stays on the Node server and is never sent to the browser. City suggestions use the Open-Meteo Geocoding API; weather and forecast data continue to come from OpenWeather.

## Run locally

1. Copy `.env.example` to `.env` and replace `YOUR_API_KEY` with an OpenWeather API key.
2. Run `npm start`.
3. Open `http://localhost:3000`.

The server reads `OPENWEATHER_API_KEY` from its process environment or the local `.env` file. Keep `.env` out of version control. The current weather and five-day forecast are fetched server-side in parallel.