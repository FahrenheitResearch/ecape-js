import argparse
import json
import math
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from metpy.calc import wind_components
from metpy.units import units
from siphon.simplewebservice.wyoming import WyomingUpperAir

ROOT = Path(__file__).resolve().parents[1]
VERIFY_DIR = Path(__file__).resolve().parent
if str(VERIFY_DIR) not in sys.path:
    sys.path.insert(0, str(VERIFY_DIR))

subprocess.run([sys.executable, str(VERIFY_DIR / 'build_metrust_variant.py')], check=True)

from ecape_parcel.calc import calc_ecape_parcel as calc_ecape_parcel_metpy, density_temperature as density_temperature_metpy
from ecape_parcel_metrust.calc import calc_ecape_parcel as calc_ecape_parcel_metrust, density_temperature as density_temperature_metrust

CASES = [
    ('OUN', datetime(2024, 5, 6, 0, 0, tzinfo=timezone.utc)),
    ('LBF', datetime(2024, 6, 20, 0, 0, tzinfo=timezone.utc)),
    ('BMX', datetime(2024, 3, 14, 0, 0, tzinfo=timezone.utc)),
    ('MFL', datetime(2024, 9, 26, 0, 0, tzinfo=timezone.utc)),
    ('DDC', datetime(2024, 5, 19, 0, 0, tzinfo=timezone.utc)),
]

CONFIGS = [
    ('entraining_pseudoadiabatic', dict(entrainment_switch=True, pseudoadiabatic_switch=True)),
    ('entraining_irreversible', dict(entrainment_switch=True, pseudoadiabatic_switch=False)),
    ('undiluted_pseudoadiabatic', dict(entrainment_switch=False, pseudoadiabatic_switch=True)),
    ('undiluted_irreversible', dict(entrainment_switch=False, pseudoadiabatic_switch=False)),
]

DEFAULT_REPS = 5


def fetch_case(station, dt):
    df = WyomingUpperAir.request_data(dt, station)
    needed = ['pressure', 'height', 'temperature', 'dewpoint', 'direction', 'speed']
    df = df.dropna(subset=needed).copy()
    df = df.sort_values('pressure', ascending=False)
    speed = df['speed'].to_numpy() * units.knots
    direction = df['direction'].to_numpy() * units.degrees
    u_wind, v_wind = wind_components(speed, direction)
    return {
        'station': station,
        'time_utc': dt.isoformat().replace('+00:00', 'Z'),
        'pressure': df['pressure'].to_numpy() * units.hPa,
        'height': df['height'].to_numpy() * units.meter,
        'temperature': (df['temperature'].to_numpy() + 273.15) * units.kelvin,
        'dewpoint': (df['dewpoint'].to_numpy() + 273.15) * units.kelvin,
        'u_wind': u_wind.to('m/s'),
        'v_wind': v_wind.to('m/s'),
    }


def to_serializable_profile(profile, density_temperature_fn):
    pressure, height, temperature, qv, qt = profile
    if isinstance(pressure, list) and pressure and pressure[0] is None:
        return {
            'pressure_pa': [None for _ in pressure],
            'height_m': [None for _ in height],
            'temperature_k': [None for _ in temperature],
            'qv_kgkg': [None for _ in qv],
            'qt_kgkg': [None for _ in qt],
            'density_temperature_k': [None for _ in temperature],
        }
    trho = density_temperature_fn(temperature, qv, qt)
    return {
        'pressure_pa': pressure.to('Pa').magnitude.tolist(),
        'height_m': height.to('m').magnitude.tolist(),
        'temperature_k': temperature.to('K').magnitude.tolist(),
        'qv_kgkg': qv.to('kg/kg').magnitude.tolist(),
        'qt_kgkg': qt.to('kg/kg').magnitude.tolist(),
        'density_temperature_k': trho.to('K').magnitude.tolist(),
    }


def run_python_backend(calc_fn, density_temperature_fn, sounding, config, reps):
    args = [
        sounding['pressure'],
        sounding['height'],
        sounding['temperature'],
        sounding['dewpoint'],
        sounding['u_wind'],
        sounding['v_wind'],
        True,
    ]
    kwargs = dict(config)
    result = None
    t0 = time.perf_counter()
    for _ in range(reps):
        result = calc_fn(*args, **kwargs)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return {
        'elapsed_ms': elapsed_ms,
        'per_call_ms': elapsed_ms / reps,
        'result': to_serializable_profile(result, density_temperature_fn),
    }


def run_js_backend(sounding, config, reps):
    payload = {
        'sounding': {
            'pressure_hpa': sounding['pressure'].to('hPa').magnitude.tolist(),
            'height_m': sounding['height'].to('m').magnitude.tolist(),
            'temperature_k': sounding['temperature'].to('K').magnitude.tolist(),
            'dewpoint_k': sounding['dewpoint'].to('K').magnitude.tolist(),
            'u_ms': sounding['u_wind'].to('m/s').magnitude.tolist(),
            'v_ms': sounding['v_wind'].to('m/s').magnitude.tolist(),
        },
        'config': {
            'entrainmentSwitch': config['entrainment_switch'],
            'pseudoadiabaticSwitch': config['pseudoadiabatic_switch'],
            'capeType': 'most_unstable',
        },
        'reps': reps,
    }
    proc = subprocess.run(
        ['node', str(VERIFY_DIR / 'run_js_case.mjs')],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
        cwd=str(ROOT),
    )
    return json.loads(proc.stdout)


def arr(values):
    return np.array([np.nan if v is None else float(v) for v in values], dtype=float)


def diff_stats(reference, candidate):
    ref = arr(reference)
    cand = arr(candidate)
    mask = np.isfinite(ref) & np.isfinite(cand)
    if not np.any(mask):
        return {'count': 0, 'max_abs': None, 'mean_abs': None, 'rmse': None}
    diff = cand[mask] - ref[mask]
    return {
        'count': int(mask.sum()),
        'max_abs': float(np.max(np.abs(diff))),
        'mean_abs': float(np.mean(np.abs(diff))),
        'rmse': float(np.sqrt(np.mean(diff ** 2))),
    }


def compare_profiles(reference, candidate):
    return {
        'temperature_k': diff_stats(reference['temperature_k'], candidate['temperature_k']),
        'qv_kgkg': diff_stats(reference['qv_kgkg'], candidate['qv_kgkg']),
        'qt_kgkg': diff_stats(reference['qt_kgkg'], candidate['qt_kgkg']),
        'density_temperature_k': diff_stats(reference['density_temperature_k'], candidate['density_temperature_k']),
    }


def ecape_gt_cape(profile):
    ecape = profile.get('ecape')
    cape = profile.get('cape')
    if ecape is None or cape is None:
        return None
    return bool(ecape > cape)


def summarize(report):
    lines = []
    for case in report['cases']:
        lines.append(f"{case['station']} {case['time_utc']}")
        for run in case['runs']:
            if 'error' in run:
                lines.append(f"  {run['config']}: ERROR {run['error']}")
                continue
            js_temp = run['comparisons']['js_vs_metpy']['temperature_k']['max_abs']
            py_temp = run['comparisons']['metrust_vs_metpy']['temperature_k']['max_abs']
            speed_py = run['timings']['metpy_per_call_ms']
            speed_mt = run['timings']['metrust_per_call_ms']
            speed_js = run['timings']['js_per_call_ms']
            js_temp_text = "n/a" if js_temp is None else f"{js_temp:.4f}"
            py_temp_text = "n/a" if py_temp is None else f"{py_temp:.4f}"
            lines.append(
                f"  {run['config']}: JS TmaxErr={js_temp_text} K, metrust TmaxErr={py_temp_text} K, "
                f"metpy={speed_py:.2f} ms, metrust={speed_mt:.2f} ms, js={speed_js:.2f} ms"
            )
    return '\n'.join(lines)


def write_report(report):
    out_path = ROOT / 'verification_report.json'
    out_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    return out_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reps', type=int, default=DEFAULT_REPS)
    args = parser.parse_args()
    reps = args.reps

    successful = []
    failures = []
    for station, dt in CASES:
        try:
            successful.append(fetch_case(station, dt))
        except Exception as exc:
            failures.append({'station': station, 'time_utc': dt.isoformat().replace('+00:00', 'Z'), 'error': str(exc)})
        if len(successful) == 3:
            break

    report = {
        'generated_utc': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'repetitions': reps,
        'failures': failures,
        'cases': [],
    }
    out_path = write_report(report)

    for sounding in successful:
        case_report = {'station': sounding['station'], 'time_utc': sounding['time_utc'], 'runs': []}
        for config_name, config in CONFIGS:
            try:
                metpy_run = run_python_backend(calc_ecape_parcel_metpy, density_temperature_metpy, sounding, config, reps)
                metrust_run = run_python_backend(calc_ecape_parcel_metrust, density_temperature_metrust, sounding, config, reps)
                js_run = run_js_backend(sounding, config, reps)
                case_report['runs'].append({
                    'config': config_name,
                    'timings': {
                        'metpy_per_call_ms': metpy_run['per_call_ms'],
                        'metrust_per_call_ms': metrust_run['per_call_ms'],
                        'js_per_call_ms': js_run['per_call_ms'],
                        'metrust_speedup_vs_metpy': metpy_run['per_call_ms'] / metrust_run['per_call_ms'] if metrust_run['per_call_ms'] else None,
                        'js_speedup_vs_metpy': metpy_run['per_call_ms'] / js_run['per_call_ms'] if js_run['per_call_ms'] else None,
                    },
                    'comparisons': {
                        'js_vs_metpy': compare_profiles(metpy_run['result'], js_run['result']),
                        'metrust_vs_metpy': compare_profiles(metpy_run['result'], metrust_run['result']),
                    },
                    'profiles': {
                        'metpy': metpy_run['result'],
                        'metrust': metrust_run['result'],
                        'js': js_run['result'],
                    },
                    'flags': {
                        'metpy_ecape_gt_cape': ecape_gt_cape(metpy_run['result']),
                        'metrust_ecape_gt_cape': ecape_gt_cape(metrust_run['result']),
                        'js_ecape_gt_cape': ecape_gt_cape(js_run['result']),
                    },
                })
            except Exception as exc:
                case_report['runs'].append({
                    'config': config_name,
                    'error': str(exc),
                })
            report['cases'] = [existing for existing in report['cases'] if not (existing['station'] == case_report['station'] and existing['time_utc'] == case_report['time_utc'])]
            report['cases'].append(case_report)
            out_path = write_report(report)
        out_path = write_report(report)
    print(summarize(report))
    print(f'\nFull report: {out_path}')


if __name__ == '__main__':
    main()
