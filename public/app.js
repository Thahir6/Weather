const form = document.querySelector('#search-form');
const searchInput = document.querySelector('#city-search');
const searchMessage = document.querySelector('#search-message');
const weatherContent = document.querySelector('#weather-content');
const loadingPanel = document.querySelector('#loading-panel');
const weatherScene = document.querySelector('#weather-scene');
const currentCard = document.querySelector('#current-card');
const locationButton = document.querySelector('#location-button');
const unitSwitch = document.querySelector('#unit-switch');
const suggestionMenu = document.querySelector('#city-suggestions');
const suggestionList = document.querySelector('#city-suggestion-list');
const suggestionStatus = document.querySelector('#suggestion-status');
const skyArt = document.querySelector('.sky-art');

let currentWeather = null;
let unit = 'C';
let suggestionTimer = null;
let suggestionController = null;
let weatherController = null;
let weatherRequestId = 0;
let suggestions = [];
let activeSuggestionIndex = -1;
let skyPointerFrame = null;
let skyPointerPosition = null;

function temperature(value) {
  const converted = unit === 'C' ? value : (value * 9 / 5) + 32;
  return `${Math.round(converted)}°`;
}

function weatherKey(current) {
  if (current.isNight && current.condition.toLowerCase() === 'clear') return 'clear-night';
  const condition = current.condition.toLowerCase();
  return ['clear', 'clouds', 'rain', 'drizzle', 'thunderstorm', 'snow'].includes(condition) ? condition : 'clouds';
}

function setLoading(loading) {
  const refreshing = loading && Boolean(currentWeather);
  loadingPanel.hidden = !loading;
  loadingPanel.classList.toggle('is-refreshing', refreshing);
  weatherContent.hidden = loading && !currentWeather;
  weatherContent.classList.toggle('is-refreshing', refreshing);
  form.querySelector('button[type="submit"]').disabled = loading;
  form.querySelector('button[type="submit"] span:first-child').textContent = loading ? 'Searching' : 'Search';
}

function showMessage(message, kind = 'error') {
  searchMessage.textContent = message;
  searchMessage.classList.toggle('is-info', kind === 'info');
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
}

function renderForecast(items) {
  const grid = document.querySelector('#forecast-grid');
  grid.replaceChildren();
  items.forEach((day, index) => {
    const card = document.createElement('article');
    card.className = 'forecast-card';
    const dayName = index === 0 ? 'Today' : formatDate(day.date, { weekday: 'short' });
    const min = unit === 'C' ? day.minimum : (day.minimum * 9 / 5) + 32;
    const max = unit === 'C' ? day.maximum : (day.maximum * 9 / 5) + 32;
    const range = Math.max(12, Math.min(100, ((max - min) / 20) * 100));
    card.innerHTML = `<div class="forecast-day">${dayName}</div><img src="https://openweathermap.org/img/wn/${encodeURIComponent(day.icon)}@2x.png" alt="${escapeHtml(day.description)}" width="55" height="55"><div class="forecast-condition">${escapeHtml(day.condition)}</div><div class="forecast-temperatures">${Math.round(max)}°<span>${Math.round(min)}°</span></div><div class="forecast-range" style="width:${range}%"></div>`;
    grid.append(card);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function countryName(code) {
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

function closeSuggestions() {
  window.clearTimeout(suggestionTimer);
  suggestionTimer = null;
  suggestionController?.abort();
  suggestionController = null;
  suggestionMenu.hidden = true;
  suggestionList.replaceChildren();
  suggestionStatus.hidden = true;
  suggestions = [];
  activeSuggestionIndex = -1;
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.removeAttribute('aria-activedescendant');
}

function showSuggestionStatus(message, state) {
  suggestionList.replaceChildren();
  suggestions = [];
  activeSuggestionIndex = -1;
  suggestionStatus.textContent = message;
  suggestionStatus.dataset.state = state;
  suggestionStatus.hidden = !message;
  suggestionMenu.hidden = !message;
  searchInput.setAttribute('aria-expanded', String(Boolean(message)));
  searchInput.removeAttribute('aria-activedescendant');
}

function appendHighlightedName(element, name, query) {
  const start = name.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (start < 0) {
    element.textContent = name;
    return;
  }
  element.append(document.createTextNode(name.slice(0, start)));
  const match = document.createElement('mark');
  match.textContent = name.slice(start, start + query.length);
  element.append(match, document.createTextNode(name.slice(start + query.length)));
}

function renderSuggestions(locations, query) {
  suggestionList.replaceChildren();
  suggestions = locations;
  activeSuggestionIndex = -1;
  locations.forEach((place, index) => {
    const option = document.createElement('button');
    option.id = `city-suggestion-${index}`;
    option.type = 'button';
    option.className = 'suggestion-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.dataset.suggestionIndex = String(index);

    const name = document.createElement('span');
    name.className = 'suggestion-name';
    appendHighlightedName(name, place.name, query);
    const detail = document.createElement('span');
    detail.className = 'suggestion-detail';
    detail.textContent = [place.state, place.country].filter(Boolean).join(', ');
    const marker = document.createElement('span');
    marker.className = 'suggestion-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = '↗';
    option.append(name, detail, marker);
    suggestionList.append(option);
  });

  suggestionStatus.textContent = locations.length ? '' : 'No matching locations';
  suggestionStatus.dataset.state = locations.length ? '' : 'empty';
  suggestionStatus.hidden = locations.length > 0;
  suggestionMenu.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

function setActiveSuggestion(index) {
  const options = suggestionList.querySelectorAll('[role="option"]');
  if (!options.length) return;
  activeSuggestionIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const active = optionIndex === activeSuggestionIndex;
    option.setAttribute('aria-selected', String(active));
    option.classList.toggle('is-active', active);
  });
  searchInput.setAttribute('aria-activedescendant', options[activeSuggestionIndex].id);
  options[activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
}

async function fetchSuggestions(query) {
  const controller = new AbortController();
  suggestionController = controller;
  try {
    const parameters = new URLSearchParams({ name: query, count: '10', language: 'en', format: 'json' });
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${parameters}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Location suggestions are unavailable.');
    if (controller.signal.aborted || searchInput.value.trim() !== query) return;
    const locations = Array.isArray(data.results) ? data.results
      .filter((place) => place.feature_code?.startsWith('PPL') && place.name && place.country && Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
      .slice(0, 5)
      .map((place) => ({
        name: place.name,
        state: place.admin1 ?? place.admin2 ?? '',
        country: place.country,
        lat: place.latitude,
        lon: place.longitude
      })) : [];
    renderSuggestions(locations, query);
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (searchInput.value.trim() === query) showSuggestionStatus('Location suggestions are unavailable right now.', 'error');
  } finally {
    if (suggestionController === controller) suggestionController = null;
  }
}

function selectSuggestion(index) {
  const place = suggestions[index];
  if (!place) return;
  searchInput.value = place.name;
  form.classList.add('has-query');
  closeSuggestions();
  void searchWeather({ lat: place.lat, lon: place.lon, name: place.name });
}

function renderWeather(data) {
  currentWeather = data;
  const { location, current } = data;
  const key = weatherKey(current);
  weatherScene.dataset.weather = key;
  weatherScene.dataset.night = String(current.isNight);
  currentCard.dataset.weather = key;
  document.querySelector('#place-name').textContent = `${location.city}, ${countryName(location.country)}`;
  document.querySelector('#place-local-time').textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
  }).format(new Date(Date.now() + location.timezone * 1000));
  document.querySelector('#condition-pill').textContent = current.condition;
  document.querySelector('#current-icon').src = `https://openweathermap.org/img/wn/${encodeURIComponent(current.icon)}@2x.png`;
  document.querySelector('#current-icon').alt = current.description;
  document.querySelector('#temperature').innerHTML = `${temperature(current.temperature).slice(0, -1)}<span>°</span>`;
  document.querySelector('#condition-name').textContent = current.condition;
  document.querySelector('#condition-description').textContent = current.description;
  document.querySelector('#feels-like').textContent = temperature(current.feelsLike);
  document.querySelector('#humidity').textContent = `${current.humidity}%`;
  document.querySelector('#wind').textContent = `${current.windDirection} · ${current.windSpeed} km/h`;
  document.querySelector('#pressure').textContent = `${current.pressure} hPa`;
  document.querySelector('#visibility').textContent = current.visibility == null ? '—' : `${current.visibility} km`;
  document.querySelector('#sunrise').textContent = current.sunrise;
  document.querySelector('#sunset').textContent = current.sunset;
  document.querySelector('#unit-label').textContent = unit === 'C' ? 'CELSIUS' : 'FAHRENHEIT';
  unitSwitch.setAttribute('aria-label', `Switch to ${unit === 'C' ? 'Fahrenheit' : 'Celsius'}`);
  renderForecast(data.forecast);
  weatherContent.hidden = false;
  weatherContent.classList.remove('is-refreshing');
  loadingPanel.hidden = true;
  loadingPanel.classList.remove('is-refreshing');
}

async function searchWeather(parameters) {
  const requestId = ++weatherRequestId;
  weatherController?.abort();
  const controller = new AbortController();
  weatherController = controller;
  closeSuggestions();
  showMessage('');
  setLoading(true);
  const query = new URLSearchParams(parameters);
  try {
    const response = await fetch(`/api/weather?${query}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Weather is unavailable. Please try again.');
    if (controller.signal.aborted) return;
    renderWeather(data);
    if (parameters.city) searchInput.value = parameters.city;
    else if (parameters.name) searchInput.value = parameters.name;
    form.classList.toggle('has-query', Boolean(searchInput.value.trim()));
  } catch (error) {
    if (error.name === 'AbortError') return;
    showMessage(error instanceof TypeError ? 'Could not connect. Check your internet connection and try again.' : error.message);
    loadingPanel.hidden = true;
    loadingPanel.classList.remove('is-refreshing');
    weatherContent.classList.remove('is-refreshing');
    weatherContent.hidden = !currentWeather;
  } finally {
    if (requestId === weatherRequestId) setLoading(false);
  }
}

searchInput.addEventListener('focus', () => form.classList.add('is-active'));
searchInput.addEventListener('blur', () => {
  window.setTimeout(() => {
    if (!form.contains(document.activeElement)) {
      form.classList.remove('is-active');
      closeSuggestions();
    }
  }, 0);
});

searchInput.addEventListener('input', () => {
  const city = searchInput.value.trim();
  form.classList.toggle('has-query', Boolean(city));
  showMessage('');
  closeSuggestions();
  if (city.length < 3) return;
  showSuggestionStatus('Finding matching places...', 'loading');
  suggestionTimer = window.setTimeout(() => void fetchSuggestions(city), 320);
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeSuggestions();
    return;
  }
  if (event.key === 'ArrowDown' && suggestions.length) {
    event.preventDefault();
    setActiveSuggestion(activeSuggestionIndex + 1);
  } else if (event.key === 'ArrowUp' && suggestions.length) {
    event.preventDefault();
    setActiveSuggestion(activeSuggestionIndex < 0 ? suggestions.length - 1 : activeSuggestionIndex - 1);
  } else if (event.key === 'Enter' && !suggestionMenu.hidden && suggestionStatus.dataset.state === 'loading') {
    event.preventDefault();
  } else if (event.key === 'Enter' && suggestions.length) {
    event.preventDefault();
    selectSuggestion(activeSuggestionIndex < 0 ? 0 : activeSuggestionIndex);
  }
});

suggestionList.addEventListener('pointermove', (event) => {
  const option = event.target.closest('[data-suggestion-index]');
  if (event.pointerType === 'mouse' && option) setActiveSuggestion(Number(option.dataset.suggestionIndex));
});
suggestionList.addEventListener('click', (event) => {
  const option = event.target.closest('[data-suggestion-index]');
  if (option) selectSuggestion(Number(option.dataset.suggestionIndex));
});
document.addEventListener('pointerdown', (event) => {
  if (!form.contains(event.target) && !suggestionMenu.contains(event.target)) closeSuggestions();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const city = searchInput.value.trim();
  if (!city) {
    showMessage('Enter a city or place to see its weather.');
    searchInput.focus();
    return;
  }
  if (!suggestionMenu.hidden && ['empty', 'loading'].includes(suggestionStatus.dataset.state)) {
    showMessage(suggestionStatus.dataset.state === 'empty'
      ? 'No matching locations. Check the spelling or try a nearby city.'
      : 'Location suggestions are still loading. Please wait.');
    return;
  }
  void searchWeather({ city });
});

document.querySelectorAll('[data-city]').forEach((button) => {
  button.addEventListener('click', () => {
    searchInput.value = button.dataset.city;
    void searchWeather({ city: button.dataset.city });
  });
});

locationButton.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showMessage('Location services are not available in this browser. Search for a city instead.');
    return;
  }
  showMessage('Waiting for your location permission...', 'info');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => void searchWeather({ lat: coords.latitude.toFixed(4), lon: coords.longitude.toFixed(4) }),
    (error) => {
      const message = error.code === error.PERMISSION_DENIED
        ? 'Location permission was not granted. You can still search for any city.'
        : 'Could not get your location. Try searching for a city instead.';
      showMessage(message);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
});

unitSwitch.addEventListener('click', () => {
  unit = unit === 'C' ? 'F' : 'C';
  unitSwitch.innerHTML = unit === 'C' ? '°C <span>/</span> °F' : '°F <span>/</span> °C';
  if (currentWeather) renderWeather(currentWeather);
});

skyArt.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') return;
  const bounds = skyArt.getBoundingClientRect();
  skyPointerPosition = {
    x: ((event.clientX - bounds.left) / bounds.width) * 100,
    y: ((event.clientY - bounds.top) / bounds.height) * 100
  };
  if (skyPointerFrame !== null) return;
  skyPointerFrame = window.requestAnimationFrame(() => {
    skyPointerFrame = null;
    if (!skyPointerPosition) return;
    skyArt.style.setProperty('--pointer-x', `${skyPointerPosition.x}%`);
    skyArt.style.setProperty('--pointer-y', `${skyPointerPosition.y}%`);
    skyArt.classList.add('is-interactive');
  });
});

skyArt.addEventListener('pointerleave', () => {
  if (skyPointerFrame !== null) window.cancelAnimationFrame(skyPointerFrame);
  skyPointerFrame = null;
  skyPointerPosition = null;
  skyArt.classList.remove('is-interactive');
});