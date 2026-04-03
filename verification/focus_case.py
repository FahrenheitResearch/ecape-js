import argparse
import cProfile
import io
import json
import pstats
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

STATION = 'OUN'
DT = datetime(2024, 5, 6, 0, 0, tzinfo=timezone.utc)
CONFIG = dict(entrainment_switch=True, pseudoadiabatic_switch=True)


def fetch_case(station, dt):
    df = WyomingUpperAir.request_data(dt, station)
    df = df.dropna(subset=['pressure', 'height', 'temperature', 'dewpoint', 'direction', 'speed']).copy()
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


def to_profile(profile, density_temperature_fn):
    pressure, height, temperature, qv, qt = profile
    trho = density_temperature_fn(temperature, qv, qt)
    return {
        'pressure_pa': pressure.to('Pa').magnitude.tolist(),
        'height_m': height.to('m').magnitude.tolist(),
        'temperature_k': temperature.to('K').magnitude.tolist(),
        'qv_kgkg': qv.to('kg/kg').magnitude.tolist(),
        'qt_kgkg': qt.to('kg/kg').magnitude.tolist(),
        'density_temperature_k': trho.to('K').magnitude.tolist(),
    }


def run_backend(calc_fn, density_temperature_fn, sounding, config):
    args = [
        sounding['pressure'],
        sounding['height'],
        sounding['temperature'],
        sounding['dewpoint'],
        sounding['u_wind'],
        sounding['v_wind'],
        True,
    ]
    t0 = time.perf_counter()
    result = calc_fn(*args, **config)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return elapsed_ms, to_profile(result, density_temperature_fn)


def run_js(sounding):
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
            'entrainmentSwitch': True,
            'pseudoadiabaticSwitch': True,
            'capeType': 'most_unstable',
        },
        'reps': 1,
    }
    proc = subprocess.run(
        ['node', str(VERIFY_DIR / 'run_js_case.mjs')],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
        cwd=str(ROOT),
    )
    data = json.loads(proc.stdout)
    return data['per_call_ms'], data['result']


def max_abs_detail(reference, candidate, heights, pressures):
    ref = np.array(reference, dtype=float)
    cand = np.array(candidate, dtype=float)
    diff = np.abs(cand - ref)
    idx = int(np.nanargmax(diff))
    return {
        'max_abs': float(diff[idx]),
        'index': idx,
        'height_m': float(heights[idx]),
        'pressure_pa': float(pressures[idx]),
        'reference': float(ref[idx]),
        'candidate': float(cand[idx]),
    }


def profile_call(calc_fn, sounding, config):
    args = [
        sounding['pressure'],
        sounding['height'],
        sounding['temperature'],
        sounding['dewpoint'],
        sounding['u_wind'],
        sounding['v_wind'],
        True,
    ]
    profiler = cProfile.Profile()
    profiler.enable()
    calc_fn(*args, **config)
    profiler.disable()
    stream = io.StringIO()
    stats = pstats.Stats(profiler, stream=stream).sort_stats('cumulative')
    stats.print_stats(25)
    return stream.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', action='store_true', help='Include cProfile output for metpy and metrust')
    args = parser.parse_args()

    sounding = fetch_case(STATION, DT)
    metpy_ms, metpy_profile = run_backend(calc_ecape_parcel_metpy, density_temperature_metpy, sounding, CONFIG)
    metrust_ms, metrust_profile = run_backend(calc_ecape_parcel_metrust, density_temperature_metrust, sounding, CONFIG)
    js_ms, js_profile = run_js(sounding)

    report = {
        'station': sounding['station'],
        'time_utc': sounding['time_utc'],
        'config': 'entraining_pseudoadiabatic',
        'timings_ms': {
            'metpy': metpy_ms,
            'metrust': metrust_ms,
            'js': js_ms,
            'metrust_speedup_vs_metpy': metpy_ms / metrust_ms if metrust_ms else None,
            'js_speedup_vs_metpy': metpy_ms / js_ms if js_ms else None,
        },
        'accuracy': {
            'js_temperature': max_abs_detail(metpy_profile['temperature_k'], js_profile['temperature_k'], metpy_profile['height_m'], metpy_profile['pressure_pa']),
            'js_density_temperature': max_abs_detail(metpy_profile['density_temperature_k'], js_profile['density_temperature_k'], metpy_profile['height_m'], metpy_profile['pressure_pa']),
            'metrust_temperature': max_abs_detail(metpy_profile['temperature_k'], metrust_profile['temperature_k'], metpy_profile['height_m'], metpy_profile['pressure_pa']),
            'metrust_density_temperature': max_abs_detail(metpy_profile['density_temperature_k'], metrust_profile['density_temperature_k'], metpy_profile['height_m'], metpy_profile['pressure_pa']),
        },
        'profiles': {
            'metpy': metpy_profile,
            'metrust': metrust_profile,
            'js': js_profile,
        },
    }
    if args.profile:
        report['profiles_cprofile'] = {
            'metpy_top25_cumulative': profile_call(calc_ecape_parcel_metpy, sounding, CONFIG),
            'metrust_top25_cumulative': profile_call(calc_ecape_parcel_metrust, sounding, CONFIG),
        }

    out_path = ROOT / 'focus_case_report.json'
    out_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f"{report['station']} {report['time_utc']} {report['config']}")
    print(f"metpy={metpy_ms:.2f} ms metrust={metrust_ms:.2f} ms js={js_ms:.2f} ms")
    print(f"js temp max abs={report['accuracy']['js_temperature']['max_abs']:.6f} K at z={report['accuracy']['js_temperature']['height_m']:.1f} m p={report['accuracy']['js_temperature']['pressure_pa']:.1f} Pa")
    print(f"metrust temp max abs={report['accuracy']['metrust_temperature']['max_abs']:.6f} K")
    print(f"report: {out_path}")


if __name__ == '__main__':
    main()
