import { readFileSync } from 'node:fs';
import { qty, calcEcapeNcape, calcSrWind } from '../ecape_calc.js';

const payload = JSON.parse(readFileSync(0, 'utf8'));
const s = payload.sounding;
const [ecape, ncape] = calcEcapeNcape(
  qty(s.height_m, 'm'),
  qty(s.pressure_hpa, 'hPa'),
  qty(s.temperature_k, 'K'),
  qty(s.specific_humidity_kgkg, 'kg/kg'),
  qty(s.u_ms, 'm/s'),
  qty(s.v_ms, 'm/s'),
  'most_unstable',
  null,
  {
    inflowBottom: qty(0, 'm'),
    inflowTop: qty(1000, 'm'),
    stormMotion: 'right_moving',
  },
);
const vsr = calcSrWind(
  qty(s.pressure_hpa, 'hPa'),
  qty(s.u_ms, 'm/s'),
  qty(s.v_ms, 'm/s'),
  qty(s.height_m, 'm'),
  qty(0, 'm'),
  qty(1000, 'm'),
  'right_moving',
);
process.stdout.write(JSON.stringify({
  ecape_jkg: ecape.value,
  ncape_jkg: ncape.value,
  vsr_ms: vsr.value,
}));
