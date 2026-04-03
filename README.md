# ecape-js

`ecape-js` is a JavaScript rewrite of the Python `ecape-parcel` package.

It keeps the package split that the Python version uses:

- `ecape.js`: high-level parcel calculations
- `ecape_calc.js`: lower-level thermodynamic and ECAPE helper functions

The implementation is unit-aware throughout, supports both scalar and array inputs for helper functions, and is written as a dependency-free ES module package.

## Features

- JavaScript rewrite of the Python `ecape-parcel` workflow
- Unit-aware inputs and outputs with lightweight quantity objects
- Scalar and array support for helper calculations
- High-level entraining parcel solver
- No runtime dependencies
- Verified against the Python reference implementation on real-world soundings

## Installation

Clone the repository and import it directly as an ES module package:

```js
import { qty, calcEcapeParcel } from './ecape.js';
import { calcEcape, calcEcapeNcape } from './ecape_calc.js';
```

Or use the package entrypoint:

```js
import { qty, calcEcapeParcel, calcEcapeNcape } from './index.js';
```

## Package layout

### `ecape.js`

High-level parcel-facing API.

Primary exports:

- `calcEcapeParcel(...)`
- `densityTemperature(...)`
- `entrainmentRate(...)`
- `updraftRadius(...)`

Python-style aliases:

- `calc_ecape_parcel`
- `density_temperature`
- `entrainment_rate`
- `updraft_radius`

### `ecape_calc.js`

Lower-level thermodynamic helpers and ECAPE calculations.

Primary exports:

- `qty(value, unit)`
- `toUnit(quantity, unit)`
- `calcEcape(...)`
- `calcEcapeNcape(...)`
- `calcSrWind(...)`
- `customCapeCinLfcEl(...)`
- `densityTemperature(...)`
- `specificHumidityFromDewpoint(...)`
- `dewpointFromSpecificHumidity(...)`

Python-style aliases are also exported, including:

- `calc_ecape`
- `calc_ecape_ncape`
- `calc_sr_wind`
- `custom_cape_cin_lfc_el`

## Unit system

The package uses lightweight quantity objects:

```js
import { qty } from './index.js';

const temperature = qty(300, 'K');
const pressure = qty([1000, 925, 850], 'hPa');
```

Supported units include:

- Pressure: `Pa`, `hPa`, `kPa`
- Length: `m`, `km`
- Temperature: `K`, `degC`
- Speed: `m/s`, `kt`, `knot`
- Moisture ratios: `kg/kg`, `g/kg`, `dimensionless`
- Energy: `J/kg`
- Angle: `degree`, `rad`

Internally, calculations are normalized to SI units.

If a helper receives plain numbers or plain arrays, the function assumes its default SI-compatible unit. For reliable use, pass explicit quantities with `qty(...)`.

## Scalar and array behavior

Helper functions accept scalars or arrays and will broadcast scalars against arrays where that is mathematically valid.

```js
import { qty, densityTemperature } from './index.js';

const scalarResult = densityTemperature(
  qty(300, 'K'),
  qty(0.012, 'kg/kg'),
  qty(0.014, 'kg/kg'),
);

const arrayResult = densityTemperature(
  qty([300, 295, 290], 'K'),
  qty(0.012, 'kg/kg'),
  qty([0.014, 0.013, 0.012], 'kg/kg'),
);
```

Profile solvers such as `calcEcapeParcel(...)` still require profile arrays because they operate on a vertical sounding.

## Example: ECAPE parcel calculation

```js
import { qty, calcEcapeParcel, densityTemperature } from './index.js';

const pressure = qty([1000, 950, 900, 850, 800, 750, 700], 'hPa');
const height = qty([250, 700, 1150, 1650, 2200, 2850, 3600], 'm');
const temperature = qty([299, 296, 293, 289, 285, 281, 276], 'K');
const dewpoint = qty([295, 291, 287, 282, 276, 269, 260], 'K');
const uWind = qty([8, 10, 13, 18, 23, 27, 31], 'm/s');
const vWind = qty([2, 4, 6, 8, 11, 14, 18], 'm/s');

const [parcelPressure, parcelHeight, parcelTemperature, parcelQv, parcelQt] =
  calcEcapeParcel(
    pressure,
    height,
    temperature,
    dewpoint,
    uWind,
    vWind,
    true,
    {
      entrainmentSwitch: true,
      pseudoadiabaticSwitch: false,
      capeType: 'most_unstable',
      stormMotionType: 'right_moving',
      inflowLayerBottom: qty(0, 'km'),
      inflowLayerTop: qty(1, 'km'),
    },
  );

const parcelDensityTemperature = densityTemperature(
  parcelTemperature,
  parcelQv,
  parcelQt,
);
```

## Example: custom storm motion

You can pass a custom storm motion directly into the ECAPE calculations with
`stormMotionType: 'user_defined'`, `stormMotionU`, and `stormMotionV`.

```js
import { qty, calcEcapeNcape } from './index.js';

const [ecape, ncape] = calcEcapeNcape(
  height,
  pressure,
  temperature,
  specificHumidity,
  uWind,
  vWind,
  'most_unstable',
  null,
  {
    stormMotionType: 'user_defined',
    stormMotionU: qty(12, 'm/s'),
    stormMotionV: qty(4, 'm/s'),
    inflowLayerBottom: qty(0, 'km'),
    inflowLayerTop: qty(1, 'km'),
  },
);
```

## `calcEcapeParcel` options

`calcEcapeParcel(..., alignToInputPressureValues, options)`

Supported options:

- `entrainmentSwitch` default `true`
- `pseudoadiabaticSwitch` default `true`
- `capeType`: `'most_unstable' | 'mixed_layer' | 'surface_based' | 'user_defined'`
- `mixedLayerDepthPressure` default `qty(100, 'hPa')`
- `mixedLayerDepthHeight` default `null`
- `stormMotionType`: `'right_moving' | 'left_moving' | 'mean_wind' | 'user_defined'`
- `inflowLayerBottom` default `qty(0, 'km')`
- `inflowLayerTop` default `qty(1, 'km')`
- `cape`
- `lfc`
- `el`
- `stormMotionU`
- `stormMotionV`
- `originPressure`
- `originHeight`
- `originTemperature`
- `originDewpoint`
- `dz` default `qty(20, 'm')`

## Verification

The port has been checked against the Python reference implementation using real-world soundings and a direct parity harness in the `verification/` directory.

That verification covered:

- entraining pseudoadiabatic parcels
- entraining irreversible parcels
- undiluted pseudoadiabatic parcels
- undiluted irreversible parcels

## Development

Useful entrypoints in this repository:

- `verification/run_verify.py`: full Python vs JS parity run
- `verification/focus_case.py`: lightweight focused regression case

## License

Match the licensing terms you want to use for the repository before publishing or distributing the package.
