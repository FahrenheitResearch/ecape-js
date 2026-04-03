import { qty, calcParcelProfile, customCapeCinLfcEl, specificHumidityFromDewpoint } from '../ecape_calc.js';
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(0, 'utf8')).sounding;
const pressure = qty(s.pressure_hpa, 'hPa');
const height = qty(s.height_m, 'm');
const temperature = qty(s.temperature_k, 'K');
const dewpoint = qty(s.dewpoint_k, 'K');
const q = specificHumidityFromDewpoint(pressure, dewpoint);
const parcel = calcParcelProfile(pressure, height, temperature, dewpoint, true, { capeType: 'most_unstable', pseudoadiabaticSwitch: true });
const capeParts = customCapeCinLfcEl(parcel[1], parcel[2], parcel[3], parcel[4], height, temperature, q);
process.stdout.write(JSON.stringify({
  js_lfc_m: capeParts[2].value,
  js_el_m: capeParts[3].value
}));
