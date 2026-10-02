import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, 'public');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function loadEnvironment() {
  try {
    const contents = await readFile(path.join(root, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function getWindDirection(degrees) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
}

function formatClock(timestamp, offset) {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(new Date((timestamp + offset) * 1000));
}

function buildForecast(entries) {
  const days = new Map();
  for (const entry of entries) {
    const date = entry.dt_txt.slice(0, 10);
    const day = days.get(date) ?? { date, min: Infinity, max: -Infinity, entries: [] };
    day.min = Math.min(day.min, entry.main.temp_min);
    day.max = Math.max(day.max, entry.main.temp_max);
    day.entries.push(entry);
    days.set(date, day);
  }

  return [...days.values()].slice(0, 5).map((day) => {
    const representative = day.entries.reduce((closest, entry) => {
      const distance = Math.abs(Number(entry.dt_txt.slice(11, 13)) - 12);
      return distance < closest.distance ? { entry, distance } : closest;
    }, { entry: day.entries[0], distance: Infinity }).entry;
    return {
      date: day.date,
      temperature: Math.round(representative.main.temp),
      minimum: Math.round(day.min),
      maximum: Math.round(day.max),
      condition: representative.weather[0]?.main ?? 'Unknown',
      description: representative.weather[0]?.description ?? '',
      icon: representative.weather[0]?.icon ?? '01d'
    };
  });
}

async function fetchWeather(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'Weather service unavailable');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function handleWeather(requestUrl, response) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key || key === 'YOUR_API_KEY') {
    return sendJson(response, 503, { error: 'Weather search is not configured yet. Add your OpenWeather API key to the server environment.' });
  }

  const query = new URL(requestUrl, 'http://localhost');
  const city = query.searchParams.get('city')?.trim();
  const placeName = query.searchParams.get('name')?.trim();
  const latitude = query.searchParams.get('lat');
  const longitude = query.searchParams.get('lon');
  const hasCoordinates = latitude !== null && longitude !== null &&
    Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
  if ((!city && !hasCoordinates) || (city && city.length > 100) || (placeName && placeName.length > 100)) {
    return sendJson(response, 400, { error: 'Enter a city or choose a valid location.' });
  }

  const location = hasCoordinates
    ? `lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`
    : `q=${encodeURIComponent(city)}`;
  const base = 'https://api.openweathermap.org/data/2.5';
  const keyParam = `appid=${encodeURIComponent(key)}&units=metric`;

  try {
    const [current, forecast] = await Promise.all([
      fetchWeather(`${base}/weather?${location}&${keyParam}`),
      fetchWeather(`${base}/forecast?${location}&${keyParam}`)
    ]);
    const condition = current.weather?.[0];
    if (!condition || !current.main || !current.sys) {
      return sendJson(response, 502, { error: 'Weather information is incomplete right now. Please try again.' });
    }
    sendJson(response, 200, {
      location: {
        city: placeName || current.name,
        country: current.sys.country,
        timezone: current.timezone ?? 0
      },
      current: {
        temperature: Math.round(current.main.temp),
        feelsLike: Math.round(current.main.feels_like),
        condition: condition.main,
        description: condition.description,
        icon: condition.icon,
        humidity: current.main.humidity,
        windSpeed: Math.round((current.wind?.speed ?? 0) * 3.6),
        windDirection: getWindDirection(current.wind?.deg ?? 0),
        pressure: current.main.pressure,
        visibility: current.visibility == null ? null : Math.round(current.visibility / 1000),
        sunrise: formatClock(current.sys.sunrise, current.timezone ?? 0),
        sunset: formatClock(current.sys.sunset, current.timezone ?? 0),
        isNight: condition.icon.endsWith('n')
      },
      forecast: buildForecast(forecast.list ?? [])
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return sendJson(response, 504, { error: 'The weather service took too long to respond. Please try again.' });
    }
    if (error.status === 404) {
      return sendJson(response, 404, { error: 'Unable to find that location. Check the spelling and try again.' });
    }
    if (error.status === 401) {
      return sendJson(response, 503, { error: 'OpenWeather rejected the API key. Check OPENWEATHER_API_KEY in your .env file and make sure the key is active.' });
    }
    if (error.status === 429) {
      return sendJson(response, 429, { error: 'Weather searches are busy right now. Please try again in a moment.' });
    }
    if (error.status) {
      return sendJson(response, 502, { error: 'The weather service is temporarily unavailable. Please try again.' });
    }
    return sendJson(response, 502, { error: 'Could not connect to the weather service. Check your connection and try again.' });
  }
}

async function handleGeocoding(requestUrl, response) {
  const query = new URL(requestUrl, 'http://localhost');
  const city = query.searchParams.get('q')?.trim() ?? '';
  if (city.length < 3) return sendJson(response, 200, { locations: [] });
  if (city.length > 100) return sendJson(response, 400, { error: 'Search for a shorter location name.' });

  const parameters = new URLSearchParams({ name: city, count: '10', language: 'en', format: 'json' });
  try {
    const results = await fetchWeather(`https://geocoding-api.open-meteo.com/v1/search?${parameters}`);
    const locations = Array.isArray(results.results) ? results.results
      .filter((place) => place.feature_code?.startsWith('PPL') && place.name && place.country && Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
      .slice(0, 5)
      .map((place) => ({
        name: place.name,
        state: place.admin1 ?? place.admin2 ?? '',
        country: place.country,
        lat: place.latitude,
        lon: place.longitude
      })) : [];
    return sendJson(response, 200, { locations });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return sendJson(response, 504, { error: 'Location suggestions took too long to load.' });
    }
    if (error.status === 401) {
      return sendJson(response, 503, { error: 'OpenWeather rejected the API key for location search.' });
    }
    if (error.status === 429) {
      return sendJson(response, 429, { error: 'Location searches are busy. Try again in a moment.' });
    }
    return sendJson(response, 502, { error: 'Could not load location suggestions. Try searching again.' });
  }
}

async function serveStatic(pathname, response) {
  const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.resolve(publicRoot, `.${requested}`);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

await loadEnvironment();
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (request.method === 'GET' && pathname === '/api/weather') {
    void handleWeather(request.url, response);
  } else if (request.method === 'GET' && pathname === '/api/geocode') {
    void handleGeocoding(request.url, response);
  } else if (request.method === 'GET') {
    void serveStatic(pathname, response);
  } else {
    response.writeHead(405, { Allow: 'GET' }).end('Method not allowed');
  }
});

server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => {
  console.log(`Aeris Weather is ready at http://localhost:${server.address().port}`);
});