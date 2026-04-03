import json
import math
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from metpy.units import units

from ecape_parcel.calc import calc_ecape_parcel


ROOT = Path(__file__).resolve().parents[1]
NODE = "node"


JS_RUNNER = r"""
import fs from 'node:fs';
import { calcEcapeParcel, qty } from './ecape.js';

const payloadPath = process.argv[1];
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

try {
  const [p, z, t, qv, qt] = calcEcapeParcel(
    qty(payload.pressure_hpa, 'hPa'),
    qty(payload.height_m, 'm'),
    qty(payload.temperature_k, 'K'),
    qty(payload.dewpoint_k, 'K'),
    qty(payload.u_wind_ms, 'm/s'),
    qty(payload.v_wind_ms, 'm/s'),
    true,
    payload.options,
  );

  console.log(JSON.stringify({
    ok: true,
    pressure_pa: p.value,
    height_m: z.value,
    temperature_k: t.value,
    qv: qv.value,
    qt: qt.value,
  }));
} catch (err) {
  console.log(JSON.stringify({
    ok: false,
    error: String(err && (err.stack || err)),
  }));
}
"""


CONFIGS = [
    {
        "name": "entraining_pseudoadiabatic_most_unstable",
        "options": {
            "entrainmentSwitch": True,
            "pseudoadiabaticSwitch": True,
            "capeType": "most_unstable",
            "stormMotionType": "right_moving",
            "inflowLayerBottom": {"value": 0, "unit": "km"},
            "inflowLayerTop": {"value": 1, "unit": "km"},
        },
        "python_kwargs": {
            "entrainment_switch": True,
            "pseudoadiabatic_switch": True,
            "cape_type": "most_unstable",
            "storm_motion_type": "right_moving",
            "inflow_layer_bottom": 0 * units.km,
            "inflow_layer_top": 1 * units.km,
        },
    },
    {
        "name": "entraining_irreversible_mixed_layer",
        "options": {
            "entrainmentSwitch": True,
            "pseudoadiabaticSwitch": False,
            "capeType": "mixed_layer",
            "stormMotionType": "right_moving",
            "mixedLayerDepthPressure": {"value": 100, "unit": "hPa"},
            "inflowLayerBottom": {"value": 0, "unit": "km"},
            "inflowLayerTop": {"value": 1, "unit": "km"},
        },
        "python_kwargs": {
            "entrainment_switch": True,
            "pseudoadiabatic_switch": False,
            "cape_type": "mixed_layer",
            "mixed_layer_depth_pressure": 100 * units.hPa,
            "storm_motion_type": "right_moving",
            "inflow_layer_bottom": 0 * units.km,
            "inflow_layer_top": 1 * units.km,
        },
    },
    {
        "name": "undiluted_pseudoadiabatic_surface_based",
        "options": {
            "entrainmentSwitch": False,
            "pseudoadiabaticSwitch": True,
            "capeType": "surface_based",
            "stormMotionType": "right_moving",
            "inflowLayerBottom": {"value": 0, "unit": "km"},
            "inflowLayerTop": {"value": 1, "unit": "km"},
        },
        "python_kwargs": {
            "entrainment_switch": False,
            "pseudoadiabatic_switch": True,
            "cape_type": "surface_based",
            "storm_motion_type": "right_moving",
            "inflow_layer_bottom": 0 * units.km,
            "inflow_layer_top": 1 * units.km,
        },
    },
    {
        "name": "entraining_pseudoadiabatic_left_moving",
        "options": {
            "entrainmentSwitch": True,
            "pseudoadiabaticSwitch": True,
            "capeType": "most_unstable",
            "stormMotionType": "left_moving",
            "inflowLayerBottom": {"value": 0, "unit": "km"},
            "inflowLayerTop": {"value": 1, "unit": "km"},
        },
        "python_kwargs": {
            "entrainment_switch": True,
            "pseudoadiabatic_switch": True,
            "cape_type": "most_unstable",
            "storm_motion_type": "left_moving",
            "inflow_layer_bottom": 0 * units.km,
            "inflow_layer_top": 1 * units.km,
        },
    },
]


VALID_CASES = [
    {
        "name": "shallow_profile",
        "pressure_hpa": [1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750],
        "height_m": [100, 300, 520, 760, 1020, 1300, 1600, 1940, 2320, 2740, 3200],
        "temperature_k": [298.0, 296.7, 295.2, 293.8, 292.3, 290.7, 289.0, 287.0, 284.8, 282.3, 279.5],
        "dewpoint_k": [294.0, 292.2, 290.0, 287.7, 285.1, 282.4, 279.2, 275.6, 271.2, 266.3, 260.0],
        "u_wind_ms": [5, 6, 7, 9, 11, 13, 15, 17, 19, 21, 23],
        "v_wind_ms": [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16],
    },
    {
        "name": "coarse_levels",
        "pressure_hpa": [1000, 925, 850, 700, 500, 300, 200, 150],
        "height_m": [120, 760, 1500, 3150, 5750, 9300, 11850, 13600],
        "temperature_k": [301.0, 296.0, 289.0, 276.0, 254.0, 229.0, 216.0, 210.0],
        "dewpoint_k": [295.0, 289.0, 281.0, 262.0, 240.0, 214.0, 198.0, 190.0],
        "u_wind_ms": [4, 8, 12, 20, 30, 42, 50, 55],
        "v_wind_ms": [0, 1, 3, 8, 14, 20, 24, 26],
    },
    {
        "name": "very_dry_high_based",
        "pressure_hpa": [980, 950, 900, 850, 800, 750, 700, 650, 600, 500, 400, 300, 200],
        "height_m": [250, 520, 980, 1480, 2050, 2700, 3450, 4300, 5250, 7400, 9700, 11650, 13200],
        "temperature_k": [307.0, 304.5, 300.0, 295.0, 289.5, 283.5, 276.5, 268.5, 260.0, 243.0, 226.0, 214.0, 205.0],
        "dewpoint_k": [276.0, 272.0, 266.0, 259.0, 251.0, 244.0, 237.0, 229.0, 221.0, 208.0, 198.0, 190.0, 182.0],
        "u_wind_ms": [6, 9, 12, 15, 18, 22, 27, 31, 34, 40, 45, 50, 54],
        "v_wind_ms": [0, 0, 1, 2, 4, 6, 8, 11, 14, 19, 23, 27, 30],
    },
    {
        "name": "cold_winter_profile",
        "pressure_hpa": [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250],
        "height_m": [80, 260, 460, 690, 950, 1550, 2250, 3400, 4700, 6100, 7750, 9550, 10650],
        "temperature_k": [268.0, 267.0, 266.0, 265.0, 263.5, 259.0, 253.0, 244.0, 233.0, 221.0, 209.0, 197.0, 191.0],
        "dewpoint_k": [266.5, 265.8, 264.8, 263.0, 260.0, 254.5, 247.0, 237.0, 226.0, 214.0, 201.0, 188.0, 183.0],
        "u_wind_ms": [8, 9, 11, 13, 16, 22, 28, 36, 44, 50, 56, 62, 66],
        "v_wind_ms": [2, 3, 4, 5, 7, 11, 16, 22, 28, 33, 36, 38, 39],
    },
    {
        "name": "capped_inversion",
        "pressure_hpa": [1000, 975, 950, 925, 900, 875, 850, 800, 750, 700, 600, 500, 400, 300],
        "height_m": [150, 360, 590, 850, 1140, 1460, 1810, 2620, 3520, 4510, 6650, 9050, 11450, 13750],
        "temperature_k": [300.5, 299.4, 298.2, 299.0, 299.8, 298.4, 295.5, 289.0, 281.0, 272.0, 253.0, 235.0, 220.0, 208.0],
        "dewpoint_k": [294.5, 293.0, 291.0, 289.0, 286.5, 281.0, 274.0, 261.0, 248.0, 237.0, 221.0, 208.0, 194.0, 184.0],
        "u_wind_ms": [3, 5, 7, 9, 12, 15, 18, 22, 27, 32, 40, 48, 54, 58],
        "v_wind_ms": [1, 1, 2, 3, 5, 7, 9, 12, 15, 18, 22, 24, 25, 26],
    },
]


INVALID_CASES = [
    {
        "name": "missing_dewpoint_level",
        "pressure_hpa": [1000, 950, 900, 850, 800, 700, 600],
        "height_m": [120, 560, 1050, 1620, 2280, 3820, 5600],
        "temperature_k": [300.0, 296.0, 291.0, 285.0, 278.0, 263.0, 245.0],
        "dewpoint_k": [294.0, 289.0, math.nan, 276.0, 267.0, 248.0, 230.0],
        "u_wind_ms": [4, 7, 10, 14, 18, 24, 28],
        "v_wind_ms": [1, 2, 4, 6, 8, 10, 12],
    },
    {
        "name": "nonmonotonic_height",
        "pressure_hpa": [1000, 950, 900, 850, 800, 700, 600],
        "height_m": [120, 560, 980, 940, 2280, 3820, 5600],
        "temperature_k": [300.0, 296.0, 291.0, 285.0, 278.0, 263.0, 245.0],
        "dewpoint_k": [294.0, 289.0, 283.0, 276.0, 267.0, 248.0, 230.0],
        "u_wind_ms": [4, 7, 10, 14, 18, 24, 28],
        "v_wind_ms": [1, 2, 4, 6, 8, 10, 12],
    },
]


def run_python_case(case, config):
    try:
        out = calc_ecape_parcel(
            np.asarray(case["pressure_hpa"]) * units.hPa,
            np.asarray(case["height_m"]) * units.m,
            np.asarray(case["temperature_k"]) * units.K,
            np.asarray(case["dewpoint_k"]) * units.K,
            np.asarray(case["u_wind_ms"]) * units("m/s"),
            np.asarray(case["v_wind_ms"]) * units("m/s"),
            True,
            **config["python_kwargs"],
        )
        return {
            "ok": True,
            "pressure_pa": out[0].to("Pa").magnitude.tolist(),
            "height_m": out[1].to("m").magnitude.tolist(),
            "temperature_k": out[2].to("K").magnitude.tolist(),
            "qv": out[3].to("dimensionless").magnitude.tolist(),
            "qt": out[4].to("dimensionless").magnitude.tolist(),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
        }


def run_js_case(case, config):
    payload = {
        "pressure_hpa": case["pressure_hpa"],
        "height_m": case["height_m"],
        "temperature_k": case["temperature_k"],
        "dewpoint_k": case["dewpoint_k"],
        "u_wind_ms": case["u_wind_ms"],
        "v_wind_ms": case["v_wind_ms"],
        "options": config["options"],
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(payload, fh)
        temp_path = fh.name
    try:
        proc = subprocess.run(
            [NODE, "--input-type=module", "-e", JS_RUNNER, temp_path],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        stdout = proc.stdout.strip()
        if not stdout:
            return {
                "ok": False,
                "error": f"NodeEmptyOutput: {proc.stderr.strip()}",
            }
        return json.loads(stdout)
    finally:
        Path(temp_path).unlink(missing_ok=True)


def summarize_pair(python_result, js_result):
    if python_result["ok"] and js_result["ok"]:
        py_t = np.asarray(python_result["temperature_k"], dtype=float)
        js_t = np.asarray(js_result["temperature_k"], dtype=float)
        if py_t.shape != js_t.shape:
            return {
                "status": "shape_mismatch",
                "python_levels": int(py_t.size),
                "js_levels": int(js_t.size),
            }
        diff = np.abs(py_t - js_t)
        return {
            "status": "matched",
            "levels": int(py_t.size),
            "max_temp_error_k": float(np.nanmax(diff)),
            "mean_temp_error_k": float(np.nanmean(diff)),
        }
    if (not python_result["ok"]) and (not js_result["ok"]):
        return {
            "status": "matched_failure",
            "python_error": python_result["error"],
            "js_error": js_result["error"],
        }
    return {
        "status": "behavior_mismatch",
        "python_ok": python_result["ok"],
        "js_ok": js_result["ok"],
        "python_error": python_result.get("error"),
        "js_error": js_result.get("error"),
    }


def main():
    report = {
        "valid_cases": [],
        "invalid_cases": [],
    }

    for case in VALID_CASES:
        case_out = {"name": case["name"], "configs": []}
        for config in CONFIGS:
            py_result = run_python_case(case, config)
            js_result = run_js_case(case, config)
            case_out["configs"].append(
                {
                    "name": config["name"],
                    "python": py_result,
                    "js": js_result,
                    "summary": summarize_pair(py_result, js_result),
                }
            )
        report["valid_cases"].append(case_out)

    default_config = CONFIGS[0]
    for case in INVALID_CASES:
        py_result = run_python_case(case, default_config)
        js_result = run_js_case(case, default_config)
        report["invalid_cases"].append(
            {
                "name": case["name"],
                "config": default_config["name"],
                "python": py_result,
                "js": js_result,
                "summary": summarize_pair(py_result, js_result),
            }
        )

    out_path = ROOT / "edge_case_report.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
