import { readFileSync } from 'node:fs';
import { qty, calcEcapeParcel, densityTemperature, customCapeCinLfcEl, calcEcapeNcape, specificHumidityFromDewpoint } from '../ecape.js';

const payload = JSON.parse(readFileSync(0, 'utf8'));
const sounding = payload.sounding;
const config = payload.config ?? {};
const reps = payload.reps ?? 1;

function normalizeProfile(profile) {
  const [pressure, height, temperature, qv, qt] = profile;
  const trho = densityTemperature(temperature, qv, qt);
  return {
    pressure_pa: pressure?.value ?? pressure,
    height_m: height?.value ?? height,
    temperature_k: temperature?.value ?? temperature,
    qv_kgkg: qv?.value ?? qv,
    qt_kgkg: qt?.value ?? qt,
    density_temperature_k: trho?.value ?? trho,
  };
}

const args = [
  qty(sounding.pressure_hpa, 'hPa'),
  qty(sounding.height_m, 'm'),
  qty(sounding.temperature_k, 'K'),
  qty(sounding.dewpoint_k, 'K'),
  qty(sounding.u_ms, 'm/s'),
  qty(sounding.v_ms, 'm/s'),
  true,
  config,
];

let result = null;
const t0 = performance.now();
for (let i = 0; i < reps; i += 1) {
  result = calcEcapeParcel(...args);
}
const elapsedMs = performance.now() - t0;

const pressure = qty(sounding.pressure_hpa, 'hPa');
const height = qty(sounding.height_m, 'm');
const temperature = qty(sounding.temperature_k, 'K');
const dewpoint = qty(sounding.dewpoint_k, 'K');
const uWind = qty(sounding.u_ms, 'm/s');
const vWind = qty(sounding.v_ms, 'm/s');
const envQ = specificHumidityFromDewpoint(pressure, dewpoint);
const capeParts = customCapeCinLfcEl(result[1], result[2], result[3], result[4], height, temperature, envQ);
const cape = capeParts[0];
let ecape = null;
let ncape = null;
if (config.entrainmentSwitch) {
  [ecape, ncape] = calcEcapeNcape(height, pressure, temperature, envQ, uWind, vWind, config.capeType ?? 'most_unstable', cape, {
    lfc: capeParts[2],
    el: capeParts[3],
    inflowBottom: qty(0, 'm'),
    inflowTop: qty(1000, 'm'),
    stormMotion: 'right_moving',
  });
}

process.stdout.write(JSON.stringify({
  reps,
  elapsed_ms: elapsedMs,
  per_call_ms: elapsedMs / reps,
  result: {
    ...normalizeProfile(result),
    cape: cape?.value ?? null,
    ecape: ecape?.value ?? null,
    ncape: ncape?.value ?? null,
    lfc: capeParts[2]?.value ?? null,
    el: capeParts[3]?.value ?? null,
  },
}));
