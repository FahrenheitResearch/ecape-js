import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const claudeModule = await import(pathToFileURL('C:/Users/drew/ecape-parcel-js/index.js').href);
const { calcEcapeParcel, Q } = claudeModule;

const payload = JSON.parse(readFileSync(0, 'utf8'));
const s = payload.sounding;
const reps = payload.reps ?? 1;

let result = null;
const t0 = performance.now();
for (let i = 0; i < reps; i += 1) {
  result = calcEcapeParcel({
    pressure: Q(s.pressure_hpa, 'hPa'),
    height: Q(s.height_m, 'm'),
    temperature: Q(s.temperature_k.map(v => v - 273.15), 'degC'),
    dewpoint: Q(s.dewpoint_k.map(v => v - 273.15), 'degC'),
    uWind: Q(s.u_ms, 'm/s'),
    vWind: Q(s.v_ms, 'm/s'),
    alignToInputPressure: true,
    entrainment: payload.config.entrainmentSwitch,
    pseudoadiabatic: payload.config.pseudoadiabaticSwitch,
    capeType: payload.config.capeType ?? 'most_unstable',
    stormMotionType: 'right_moving',
  });
}
const elapsedMs = performance.now() - t0;
const out = {
  pressure_pa: Array.from(result.pressure.to('Pa').value ?? result.pressure.to('Pa').magnitude ?? result.pressure.to('Pa').si ?? []),
  height_m: Array.from(result.height.to('m').value ?? result.height.to('m').magnitude ?? result.height.to('m').si ?? []),
  temperature_k: Array.from(result.temperature.to('K').value ?? result.temperature.to('K').magnitude ?? result.temperature.to('K').si ?? []),
  qv_kgkg: Array.from(result.qv.to('kg/kg').value ?? result.qv.to('kg/kg').magnitude ?? result.qv.to('kg/kg').si ?? []),
  qt_kgkg: Array.from(result.qt.to('kg/kg').value ?? result.qt.to('kg/kg').magnitude ?? result.qt.to('kg/kg').si ?? []),
  cape: result.cape,
  ecape: result.ecape,
  ncape: result.ncape,
  lfc: result.lfc,
  el: result.el,
  vsr: result.vsr,
};
process.stdout.write(JSON.stringify({ per_call_ms: elapsedMs / reps, result: out }));
