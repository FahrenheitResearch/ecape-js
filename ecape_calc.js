const UNIT_DEFS = {
  Pa: { kind: 'pressure', scale: 1 },
  hPa: { kind: 'pressure', scale: 100 },
  kPa: { kind: 'pressure', scale: 1000 },
  m: { kind: 'length', scale: 1 },
  km: { kind: 'length', scale: 1000 },
  K: { kind: 'temperature', toBase: (v) => v, fromBase: (v) => v },
  degC: { kind: 'temperature', toBase: (v) => v + 273.15, fromBase: (v) => v - 273.15 },
  'm/s': { kind: 'speed', scale: 1 },
  knot: { kind: 'speed', scale: 0.5144444444444445 },
  kt: { kind: 'speed', scale: 0.5144444444444445 },
  'J/kg': { kind: 'energy', scale: 1 },
  'kg/kg': { kind: 'ratio', scale: 1 },
  'g/kg': { kind: 'ratio', scale: 1e-3 },
  dimensionless: { kind: 'ratio', scale: 1 },
  degree: { kind: 'angle', scale: Math.PI / 180 },
  rad: { kind: 'angle', scale: 1 },
};

const P0 = 100000;
const G = 9.81;
const RD = 287.04;
const RV = 461.5;
const CPD = 1005.0;
const CPV = 1870.0;
const CPL = 4190.0;
const CPI = 2106.0;
const EPSILON = RD / RV;
const LV_TRIP = 2501000.0;
const LI_TRIP = 333000.0;
const T_TRIP = 273.15;
const VAPOR_PRESSURE_REF = 611.2;
const MOLAR_GAS_CONSTANT = 8.314;
const AVG_MOLAR_MASS = 0.029;
const DEFAULT_DZ_METERS = 20;

function cloneValue(value) {
  return Array.isArray(value) ? value.slice() : value;
}

export function qty(value, unit = 'dimensionless') {
  if (!(unit in UNIT_DEFS)) {
    throw new Error(`Unsupported unit: ${unit}`);
  }
  return { value: cloneValue(value), unit };
}

export const quantity = qty;

export function isQuantity(value) {
  return Boolean(value) && typeof value === 'object' && 'unit' in value && 'value' in value;
}

export function toQuantity(value, defaultUnit = 'dimensionless') {
  return isQuantity(value) ? value : qty(value, defaultUnit);
}

function convertScalar(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) {
    return value;
  }

  const fromDef = UNIT_DEFS[fromUnit];
  const toDef = UNIT_DEFS[toUnit];
  if (!fromDef || !toDef) {
    throw new Error(`Unsupported conversion: ${fromUnit} -> ${toUnit}`);
  }
  if (fromDef.kind !== toDef.kind) {
    throw new Error(`Incompatible units: ${fromUnit} -> ${toUnit}`);
  }

  if (fromDef.kind === 'temperature') {
    return toDef.fromBase(fromDef.toBase(value));
  }

  return (value * fromDef.scale) / toDef.scale;
}

export function toUnit(input, unit) {
  const q = toQuantity(input, unit);
  const value = Array.isArray(q.value)
    ? q.value.map((entry) => convertScalar(entry, q.unit, unit))
    : convertScalar(q.value, q.unit, unit);
  return qty(value, unit);
}

function valuesInUnit(input, unit) {
  return toUnit(input, unit).value;
}

function toArray(value) {
  return Array.isArray(value) ? value.slice() : [value];
}

function maybeScalar(values, preferScalar) {
  return preferScalar ? values[0] : values.slice();
}

function asNumericArray(input, unit) {
  return toArray(valuesInUnit(input, unit));
}

function makeQuantityFromArray(values, unit, preferScalar = false) {
  return qty(maybeScalar(values, preferScalar), unit);
}

function inferOutputShape(...inputs) {
  return !inputs.some((item) => {
    if (!isQuantity(item)) {
      return Array.isArray(item);
    }
    return Array.isArray(item.value);
  });
}

function broadcastNumericArray(values, length) {
  if (values.length === length) {
    return values.slice();
  }
  if (values.length === 1) {
    return Array.from({ length }, () => values[0]);
  }
  throw new Error(`Cannot broadcast length ${values.length} to ${length}`);
}

function broadcastPair(aValues, bValues) {
  const length = Math.max(aValues.length, bValues.length);
  return [broadcastNumericArray(aValues, length), broadcastNumericArray(bValues, length), length];
}

function mean(values) {
  if (!values.length) {
    return NaN;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampIndex(arr, predicate) {
  const indices = [];
  for (let i = 0; i < arr.length; i += 1) {
    if (predicate(arr[i], i)) {
      indices.push(i);
    }
  }
  return indices;
}

export function vaporPressure(inputDewpoint) {
  const dewpointK = asNumericArray(inputDewpoint, 'K');
  const preferScalar = inferOutputShape(inputDewpoint);
  const values = dewpointK.map((td) => 611.2 * Math.exp((17.67 * (td - 273.15)) / (td - 29.65)));
  return makeQuantityFromArray(values, 'Pa', preferScalar);
}

export function vaporPressureFromSpecificHumidity(inputPressure, inputSpecificHumidity) {
  const pressurePa = asNumericArray(inputPressure, 'Pa');
  const qValues = asNumericArray(inputSpecificHumidity, 'kg/kg');
  const [p, q, length] = broadcastPair(pressurePa, qValues);
  const preferScalar = inferOutputShape(inputPressure, inputSpecificHumidity);
  const values = new Array(length);
  for (let i = 0; i < length; i += 1) {
    values[i] = (q[i] * p[i]) / (EPSILON + (1 - EPSILON) * q[i]);
  }
  return makeQuantityFromArray(values, 'Pa', preferScalar);
}

export function dewpointFromVaporPressure(inputVaporPressure) {
  const vaporPressurePa = asNumericArray(inputVaporPressure, 'Pa');
  const preferScalar = inferOutputShape(inputVaporPressure);
  const values = vaporPressurePa.map((e) => {
    const lnRatio = Math.log(e / 611.2);
    const tdC = (243.5 * lnRatio) / (17.67 - lnRatio);
    return tdC + 273.15;
  });
  return makeQuantityFromArray(values, 'K', preferScalar);
}

export function dewpointFromSpecificHumidity(inputPressure, inputSpecificHumidity) {
  return dewpointFromVaporPressure(vaporPressureFromSpecificHumidity(inputPressure, inputSpecificHumidity));
}

export function specificHumidity(inputPressure, inputVaporPressure) {
  const pressurePa = asNumericArray(inputPressure, 'Pa');
  const vaporPressurePa = asNumericArray(inputVaporPressure, 'Pa');
  const [p, e, length] = broadcastPair(pressurePa, vaporPressurePa);
  const preferScalar = inferOutputShape(inputPressure, inputVaporPressure);
  const values = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const w = EPSILON * e[i] / Math.max(p[i] - e[i], 1e-9);
    values[i] = w / (1 + w);
  }
  return makeQuantityFromArray(values, 'kg/kg', preferScalar);
}

export function specificHumidityFromDewpoint(inputPressure, inputDewpoint) {
  return specificHumidity(inputPressure, vaporPressure(inputDewpoint));
}

export function potentialTemperature(inputPressure, inputTemperature) {
  const pressurePa = asNumericArray(inputPressure, 'Pa');
  const temperatureK = asNumericArray(inputTemperature, 'K');
  const [p, t, length] = broadcastPair(pressurePa, temperatureK);
  const preferScalar = inferOutputShape(inputPressure, inputTemperature);
  const values = new Array(length);
  for (let i = 0; i < length; i += 1) {
    values[i] = t[i] * Math.pow(P0 / p[i], RD / CPD);
  }
  return makeQuantityFromArray(values, 'K', preferScalar);
}

export function temperatureFromPotentialTemperature(inputPressure, inputPotentialTemperature) {
  const pressurePa = asNumericArray(inputPressure, 'Pa');
  const thetaK = asNumericArray(inputPotentialTemperature, 'K');
  const [p, theta, length] = broadcastPair(pressurePa, thetaK);
  const preferScalar = inferOutputShape(inputPressure, inputPotentialTemperature);
  const values = new Array(length);
  for (let i = 0; i < length; i += 1) {
    values[i] = theta[i] * Math.pow(p[i] / P0, RD / CPD);
  }
  return makeQuantityFromArray(values, 'K', preferScalar);
}

export function densityTemperature(inputTemperature, inputQv, inputQt) {
  const temperatureK = asNumericArray(inputTemperature, 'K');
  const qvValues = asNumericArray(inputQv, 'kg/kg');
  const qtValues = asNumericArray(inputQt, 'kg/kg');
  const length = Math.max(temperatureK.length, qvValues.length, qtValues.length);
  const t = broadcastNumericArray(temperatureK, length);
  const qv = broadcastNumericArray(qvValues, length);
  const qt = broadcastNumericArray(qtValues, length);
  const preferScalar = inferOutputShape(inputTemperature, inputQv, inputQt);
  const values = new Array(length);
  for (let i = 0; i < length; i += 1) {
    values[i] = t[i] * (1 - qt[i] + qv[i] / EPSILON);
  }
  return makeQuantityFromArray(values, 'K', preferScalar);
}

export function moistStaticEnergy(inputHeight, inputTemperature, inputSpecificHumidity) {
  const heightM = asNumericArray(inputHeight, 'm');
  const temperatureK = asNumericArray(inputTemperature, 'K');
  const specificHumidityKgKg = asNumericArray(inputSpecificHumidity, 'kg/kg');
  const length = Math.max(heightM.length, temperatureK.length, specificHumidityKgKg.length);
  const z = broadcastNumericArray(heightM, length);
  const t = broadcastNumericArray(temperatureK, length);
  const q = broadcastNumericArray(specificHumidityKgKg, length);
  const preferScalar = inferOutputShape(inputHeight, inputTemperature, inputSpecificHumidity);
  const values = new Array(length);
  for (let i = 0; i < length; i += 1) {
    values[i] = CPD * t[i] + G * z[i] + LV_TRIP * q[i];
  }
  return makeQuantityFromArray(values, 'J/kg', preferScalar);
}

export function pressureAtHeight(inputRefPressure, inputHeightAboveRefPressure, inputTemperature) {
  const refPressurePa = asNumericArray(inputRefPressure, 'Pa');
  const dzM = asNumericArray(inputHeightAboveRefPressure, 'm');
  const temperatureK = asNumericArray(inputTemperature, 'K');
  const length = Math.max(refPressurePa.length, dzM.length, temperatureK.length);
  const p = broadcastNumericArray(refPressurePa, length);
  const dz = broadcastNumericArray(dzM, length);
  const t = broadcastNumericArray(temperatureK, length);
  const preferScalar = inferOutputShape(inputRefPressure, inputHeightAboveRefPressure, inputTemperature);
  const values = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const scaleHeight = (MOLAR_GAS_CONSTANT * t[i]) / (AVG_MOLAR_MASS * G);
    values[i] = p[i] * Math.exp(-dz[i] / scaleHeight);
  }
  return makeQuantityFromArray(values, 'Pa', preferScalar);
}

export function linearInterp(inputArr, outputArr, input) {
  const x = asNumericArray(inputArr, 'm');
  const yUnit = isQuantity(outputArr) ? outputArr.unit : 'dimensionless';
  const y = asNumericArray(outputArr, yUnit);
  const xValue = asNumericArray(input, 'm')[0];

  if (xValue <= x[0]) {
    return qty(y[0], yUnit);
  }
  if (xValue >= x[x.length - 1]) {
    return qty(y[y.length - 1], yUnit);
  }

  for (let i = 0; i < x.length - 1; i += 1) {
    if (xValue === x[i]) {
      return qty(y[i], yUnit);
    }
    if (xValue < x[i + 1]) {
      const weight1 = (x[i + 1] - xValue) / (x[i + 1] - x[i]);
      const weight2 = (xValue - x[i]) / (x[i + 1] - x[i]);
      return qty(y[i] * weight1 + y[i + 1] * weight2, yUnit);
    }
  }

  return qty(y[y.length - 1], yUnit);
}

export function reverseLinearInterp(inputArr, outputArr, input) {
  const xUnit = isQuantity(inputArr) ? inputArr.unit : 'dimensionless';
  const x = asNumericArray(inputArr, xUnit);
  const yUnit = isQuantity(outputArr) ? outputArr.unit : 'dimensionless';
  const y = asNumericArray(outputArr, yUnit);
  const xValue = asNumericArray(input, xUnit)[0];

  if (xValue >= x[0]) {
    return qty(y[0], yUnit);
  }
  if (xValue <= x[x.length - 1]) {
    return qty(y[y.length - 1], yUnit);
  }

  for (let i = 0; i < x.length - 1; i += 1) {
    if (xValue === x[i]) {
      return qty(y[i], yUnit);
    }
    if (xValue > x[i + 1]) {
      const weight1 = (x[i + 1] - xValue) / (x[i + 1] - x[i]);
      const weight2 = (xValue - x[i]) / (x[i + 1] - x[i]);
      return qty(y[i] * weight1 + y[i + 1] * weight2, yUnit);
    }
  }

  return qty(y[y.length - 1], yUnit);
}

export function iceFraction(inputTemperature, warmestMixedPhaseTemp = qty(273.15, 'K'), coldestMixedPhaseTemp = qty(253.15, 'K')) {
  const temperatureK = asNumericArray(inputTemperature, 'K');
  const warmestK = asNumericArray(warmestMixedPhaseTemp, 'K')[0];
  const coldestK = asNumericArray(coldestMixedPhaseTemp, 'K')[0];
  const preferScalar = inferOutputShape(inputTemperature);
  const values = temperatureK.map((t) => {
    if (t >= warmestK) {
      return 0;
    }
    if (t <= coldestK) {
      return 1;
    }
    return (t - warmestK) / (coldestK - warmestK);
  });
  return makeQuantityFromArray(values, 'dimensionless', preferScalar);
}

export function iceFractionDeriv(inputTemperature, warmestMixedPhaseTemp = qty(273.15, 'K'), coldestMixedPhaseTemp = qty(253.15, 'K')) {
  const temperatureK = asNumericArray(inputTemperature, 'K');
  const warmestK = asNumericArray(warmestMixedPhaseTemp, 'K')[0];
  const coldestK = asNumericArray(coldestMixedPhaseTemp, 'K')[0];
  const preferScalar = inferOutputShape(inputTemperature);
  const values = temperatureK.map((t) => {
    if (t >= warmestK || t <= coldestK) {
      return 0;
    }
    return 1 / (coldestK - warmestK);
  });
  return makeQuantityFromArray(values, 'dimensionless', preferScalar);
}

export function rSat(inputTemperature, inputPressure, iceFlag = 1, warmestMixedPhaseTemp = qty(273.15, 'K'), coldestMixedPhaseTemp = qty(253.15, 'K')) {
  const temperatureK = asNumericArray(inputTemperature, 'K');
  const pressurePa = asNumericArray(inputPressure, 'Pa');
  const [t, p, length] = broadcastPair(temperatureK, pressurePa);
  const preferScalar = inferOutputShape(inputTemperature, inputPressure);
  const warmestK = asNumericArray(warmestMixedPhaseTemp, 'K')[0];
  const coldestK = asNumericArray(coldestMixedPhaseTemp, 'K')[0];
  const values = new Array(length);

  function liquidRatio(temp, pressure) {
    const term1 = (CPV - CPL) / RV;
    const term2 = (LV_TRIP - T_TRIP * (CPV - CPL)) / RV;
    const esi = Math.exp(((temp - T_TRIP) * term2) / (temp * T_TRIP)) * VAPOR_PRESSURE_REF * Math.pow(temp / T_TRIP, term1);
    return EPSILON * esi / Math.max(pressure - esi, 1e-9);
  }

  function iceRatio(temp, pressure) {
    const term1 = (CPV - CPI) / RV;
    const term2 = (LV_TRIP - T_TRIP * (CPV - CPI)) / RV;
    const esi = Math.exp(((temp - T_TRIP) * term2) / (temp * T_TRIP)) * VAPOR_PRESSURE_REF * Math.pow(temp / T_TRIP, term1);
    return EPSILON * esi / Math.max(pressure - esi, 1e-9);
  }

  for (let i = 0; i < length; i += 1) {
    if (iceFlag === 2) {
      values[i] = iceRatio(t[i], p[i]);
      continue;
    }
    if (iceFlag === 1) {
      let omega = 0;
      if (t[i] <= coldestK) {
        omega = 1;
      } else if (t[i] < warmestK) {
        omega = (t[i] - warmestK) / (coldestK - warmestK);
      }
      values[i] = (1 - omega) * liquidRatio(t[i], p[i]) + omega * iceRatio(t[i], p[i]);
      continue;
    }
    values[i] = liquidRatio(t[i], p[i]);
  }

  return makeQuantityFromArray(values, 'kg/kg', preferScalar);
}

export function unsaturatedAdiabaticLapseRate(inputTemperatureParcel, inputQvParcel, inputTemperatureEnv, inputQvEnv, inputEntrainmentRate = qty(0, 'dimensionless')) {
  const temperatureParcelK = asNumericArray(inputTemperatureParcel, 'K');
  const qvParcel = asNumericArray(inputQvParcel, 'kg/kg');
  const temperatureEnvK = asNumericArray(inputTemperatureEnv, 'K');
  const qvEnv = asNumericArray(inputQvEnv, 'kg/kg');
  const entrainmentRate = asNumericArray(inputEntrainmentRate, 'dimensionless');
  const length = Math.max(temperatureParcelK.length, qvParcel.length, temperatureEnvK.length, qvEnv.length, entrainmentRate.length);
  const tp = broadcastNumericArray(temperatureParcelK, length);
  const qvp = broadcastNumericArray(qvParcel, length);
  const te = broadcastNumericArray(temperatureEnvK, length);
  const qve = broadcastNumericArray(qvEnv, length);
  const eps = broadcastNumericArray(entrainmentRate, length);
  const preferScalar = inferOutputShape(inputTemperatureParcel, inputQvParcel, inputTemperatureEnv, inputQvEnv, inputEntrainmentRate);
  const values = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const temperatureEntrainment = -eps[i] * (tp[i] - te[i]);
    const densityParcel = tp[i] * (1 - qvp[i] + qvp[i] / EPSILON);
    const densityEnv = te[i] * (1 - qve[i] + qve[i] / EPSILON);
    const buoyancy = G * (densityParcel - densityEnv) / densityEnv;
    const cpmv = (1 - qvp[i]) * CPD + qvp[i] * CPV;
    values[i] = (-G / CPD) * ((1 + buoyancy / G) / (cpmv / CPD)) + temperatureEntrainment;
  }
  return makeQuantityFromArray(values, 'dimensionless', preferScalar);
}

export function saturatedAdiabaticLapseRate(
  inputTemperatureParcel,
  inputQtParcel,
  inputPressureParcel,
  inputTemperatureEnv,
  inputQvEnv,
  inputEntrainmentRate = qty(0, 'dimensionless'),
  inputPrecipitationRate = qty(0, 'dimensionless'),
  warmestMixedPhaseTemp = qty(273.15, 'K'),
  coldestMixedPhaseTemp = qty(253.15, 'K'),
  inputQtEntrainment = null,
) {
  const temperatureParcelK = asNumericArray(inputTemperatureParcel, 'K');
  const qtParcel = asNumericArray(inputQtParcel, 'kg/kg');
  const pressureParcelPa = asNumericArray(inputPressureParcel, 'Pa');
  const temperatureEnvK = asNumericArray(inputTemperatureEnv, 'K');
  const qvEnv = asNumericArray(inputQvEnv, 'kg/kg');
  const entrainmentRate = asNumericArray(inputEntrainmentRate, 'dimensionless');
  const precipitationRate = asNumericArray(inputPrecipitationRate, 'dimensionless');
  const qtEntrainment = inputQtEntrainment === null ? [null] : asNumericArray(inputQtEntrainment, 'dimensionless');
  const length = Math.max(
    temperatureParcelK.length,
    qtParcel.length,
    pressureParcelPa.length,
    temperatureEnvK.length,
    qvEnv.length,
    entrainmentRate.length,
    precipitationRate.length,
    qtEntrainment.length,
  );
  const tp = broadcastNumericArray(temperatureParcelK, length);
  const qt = broadcastNumericArray(qtParcel, length);
  const pp = broadcastNumericArray(pressureParcelPa, length);
  const te = broadcastNumericArray(temperatureEnvK, length);
  const qve = broadcastNumericArray(qvEnv, length);
  const eps = broadcastNumericArray(entrainmentRate, length);
  const pr = broadcastNumericArray(precipitationRate, length);
  const qte = qtEntrainment[0] === null ? Array.from({ length }, () => null) : broadcastNumericArray(qtEntrainment, length);
  const preferScalar = inferOutputShape(inputTemperatureParcel, inputQtParcel, inputPressureParcel, inputTemperatureEnv, inputQvEnv);
  const warmestK = asNumericArray(warmestMixedPhaseTemp, 'K')[0];
  const coldestK = asNumericArray(coldestMixedPhaseTemp, 'K')[0];
  const values = new Array(length);

  for (let i = 0; i < length; i += 1) {
    let omega = 0;
    let domega = 0;
    if (tp[i] <= coldestK) {
      omega = 1;
    } else if (tp[i] < warmestK) {
      omega = (tp[i] - warmestK) / (coldestK - warmestK);
      domega = 1 / (coldestK - warmestK);
    }

    const qVsl = (1 - qt[i]) * valuesInUnit(rSat(qty(tp[i], 'K'), qty(pp[i], 'Pa'), 0), 'kg/kg');
    const qVsi = (1 - qt[i]) * valuesInUnit(rSat(qty(tp[i], 'K'), qty(pp[i], 'Pa'), 2), 'kg/kg');
    const qvParcel = (1 - omega) * qVsl + omega * qVsi;
    const temperatureEntrainment = -eps[i] * (tp[i] - te[i]);
    const qvEntrainment = -eps[i] * (qvParcel - qve[i]);
    const qtEntr = qte[i] === null ? -eps[i] * (qt[i] - qve[i]) - pr[i] * (qt[i] - qvParcel) : qte[i];
    const qCondensate = qt[i] - qvParcel;
    const qlParcel = qCondensate * (1 - omega);
    const qiParcel = qCondensate * omega;
    const cpm = (1 - qt[i]) * CPD + qvParcel * CPV + qlParcel * CPL + qiParcel * CPI;
    const densityParcel = tp[i] * (1 - qt[i] + qvParcel / EPSILON);
    const densityEnv = te[i] * (1 - qve[i] + qve[i] / EPSILON);
    const buoyancy = G * (densityParcel - densityEnv) / densityEnv;
    const lv = LV_TRIP + (tp[i] - T_TRIP) * (CPV - CPL);
    const li = LI_TRIP + (tp[i] - T_TRIP) * (CPL - CPI);
    const ls = lv + omega * li;
    const qVslFrac = qVsl / (EPSILON - EPSILON * qt[i] + qvParcel);
    const qVsiFrac = qVsi / (EPSILON - EPSILON * qt[i] + qvParcel);
    const qM = (1 - omega) * qVsl / (1 - qVslFrac) + omega * qVsi / (1 - qVsiFrac);
    const lM = (1 - omega) * lv * qVsl / (1 - qVslFrac) + omega * (lv + li) * qVsi / (1 - qVsiFrac);
    const rm0 = (1 - qve[i]) * RD + qve[i] * RV;
    const term1 = buoyancy;
    const term2 = G;
    const term3 = ((ls * qM) / (rm0 * te[i])) * G;
    const term4 = (cpm - li * (qt[i] - qvParcel) * domega) * temperatureEntrainment;
    const term5 = ls * (qvEntrainment + (qvParcel / (1 - qt[i])) * qtEntr);
    const term6 = cpm;
    const term7 = (li * (qt[i] - qvParcel) - ls * (qVsi - qVsl)) * domega;
    const term8 = (ls * lM) / (RV * tp[i] * tp[i]);
    values[i] = -(term1 + term2 + term3 - term4 - term5) / (term6 - term7 + term8);
  }

  return makeQuantityFromArray(values, 'dimensionless', preferScalar);
}

function findLayerIndices(heightM, lowerM, upperM) {
  return clampIndex(heightM, (value) => value >= lowerM && value <= upperM);
}

function interpolateNumeric(x, y, target) {
  if (target <= x[0]) {
    return y[0];
  }
  if (target >= x[x.length - 1]) {
    return y[y.length - 1];
  }
  for (let i = 0; i < x.length - 1; i += 1) {
    if (target === x[i]) {
      return y[i];
    }
    if (target < x[i + 1]) {
      const w1 = (x[i + 1] - target) / (x[i + 1] - x[i]);
      const w2 = (target - x[i]) / (x[i + 1] - x[i]);
      return y[i] * w1 + y[i + 1] * w2;
    }
  }
  return y[y.length - 1];
}

function trapz(y, x) {
  let sum = 0;
  for (let i = 0; i < y.length - 1; i += 1) {
    sum += 0.5 * (y[i] + y[i + 1]) * (x[i + 1] - x[i]);
  }
  return sum;
}

function getLayerByHeight(pressurePa, variables, heightM, bottomM, depthM) {
  const topM = bottomM + depthM;
  const pressureLayer = [interpolateNumeric(heightM, pressurePa, bottomM)];
  const variableLayers = variables.map((variable) => [interpolateNumeric(heightM, variable, bottomM)]);

  for (let i = 0; i < heightM.length; i += 1) {
    if (heightM[i] > bottomM && heightM[i] < topM) {
      pressureLayer.push(pressurePa[i]);
      for (let j = 0; j < variables.length; j += 1) {
        variableLayers[j].push(variables[j][i]);
      }
    }
  }

  pressureLayer.push(interpolateNumeric(heightM, pressurePa, topM));
  for (let j = 0; j < variables.length; j += 1) {
    variableLayers[j].push(interpolateNumeric(heightM, variables[j], topM));
  }

  return [pressureLayer, ...variableLayers];
}

function weightedContinuousAverage(pressurePa, variables, heightM, bottomM, depthM) {
  const [presProf, ...varProfs] = getLayerByHeight(pressurePa, variables, heightM, bottomM, depthM);
  const denom = presProf[presProf.length - 1] - presProf[0];
  return varProfs.map((varProf) => trapz(varProf, presProf) / denom);
}

function meanWindInLayer(uMS, vMS, heightM, lowerM, upperM) {
  const indices = findLayerIndices(heightM, lowerM, upperM);
  if (!indices.length) {
    return { u: uMS[0], v: vMS[0] };
  }
  return {
    u: mean(indices.map((index) => uMS[index])),
    v: mean(indices.map((index) => vMS[index])),
  };
}

function bunkersStormMotion(pressurePa, uMS, vMS, heightM) {
  const [meanU06, meanV06] = weightedContinuousAverage(pressurePa, [uMS, vMS], heightM, heightM[0], 6000);
  const [meanU05, meanV05] = weightedContinuousAverage(pressurePa, [uMS, vMS], heightM, heightM[0], 500);
  const [meanU55, meanV55] = weightedContinuousAverage(pressurePa, [uMS, vMS], heightM, heightM[0] + 5500, 500);
  const mean06 = { u: meanU06, v: meanV06 };
  const meanLow = { u: meanU05, v: meanV05 };
  const meanHigh = { u: meanU55, v: meanV55 };
  const shearU = meanHigh.u - meanLow.u;
  const shearV = meanHigh.v - meanLow.v;
  const shearMag = Math.hypot(shearU, shearV);
  if (shearMag === 0) {
    return {
      right: { u: mean06.u, v: mean06.v },
      left: { u: mean06.u, v: mean06.v },
      mean: { u: mean06.u, v: mean06.v },
    };
  }
  const deviation = 7.5;
  const devU = deviation * shearV / shearMag;
  const devV = -deviation * shearU / shearMag;
  return {
    right: { u: mean06.u + devU, v: mean06.v + devV },
    left: { u: mean06.u - devU, v: mean06.v - devV },
    mean: { u: mean06.u, v: mean06.v },
  };
}

function equivalentPotentialTemperature(pPa, tK, tdK) {
  const q = valuesInUnit(specificHumidityFromDewpoint(qty(pPa, 'Pa'), qty(tdK, 'K')), 'kg/kg');
  const e = valuesInUnit(vaporPressure(qty(tdK, 'K')), 'Pa');
  const w = EPSILON * e / Math.max(pPa - e, 1e-9);
  const tlcl = 1 / (1 / Math.max(tdK - 56, 1e-6) + Math.log(Math.max(tK / tdK, 1e-9)) / 800) + 56;
  const thetaL = tK * Math.pow(P0 / pPa, 0.2854 * (1 - 0.28 * q));
  return thetaL * Math.exp(((3376 / tlcl) - 2.54) * w * (1 + 0.81 * w));
}

function selectParcelOriginValues(pressurePa, heightM, temperatureK, dewpointK, options = {}) {
  const {
    capeType = 'most_unstable',
    mixedLayerDepthPressure = qty(100, 'hPa'),
    mixedLayerDepthHeight = null,
    originPressure = null,
    originHeight = null,
    originTemperature = null,
    originDewpoint = null,
  } = options;

  if (capeType === 'user_defined') {
    return {
      pressurePa: originPressure ? valuesInUnit(originPressure, 'Pa') : pressurePa[0],
      heightM: originHeight ? valuesInUnit(originHeight, 'm') : heightM[0],
      temperatureK: originTemperature ? valuesInUnit(originTemperature, 'K') : temperatureK[0],
      dewpointK: originDewpoint ? valuesInUnit(originDewpoint, 'K') : dewpointK[0],
      index: 0,
    };
  }

  if (capeType === 'surface_based') {
    return {
      pressurePa: pressurePa[0],
      heightM: heightM[0],
      temperatureK: temperatureK[0],
      dewpointK: dewpointK[0],
      index: 0,
    };
  }

  if (capeType === 'mixed_layer') {
    let indices;
    if (mixedLayerDepthHeight) {
      const topHeight = heightM[0] + valuesInUnit(mixedLayerDepthHeight, 'm');
      indices = clampIndex(heightM, (value) => value <= topHeight);
    } else {
      const depthPa = valuesInUnit(mixedLayerDepthPressure, 'Pa');
      const topPressure = pressurePa[0] - depthPa;
      indices = clampIndex(pressurePa, (value) => value >= topPressure);
    }
    if (!indices.length) {
      indices = [0];
    }
    const theta = mean(indices.map((index) => valuesInUnit(potentialTemperature(qty(pressurePa[index], 'Pa'), qty(temperatureK[index], 'K')), 'K')));
    const q = mean(indices.map((index) => valuesInUnit(specificHumidityFromDewpoint(qty(pressurePa[index], 'Pa'), qty(dewpointK[index], 'K')), 'kg/kg')));
    const t = valuesInUnit(temperatureFromPotentialTemperature(qty(pressurePa[0], 'Pa'), qty(theta, 'K')), 'K');
    const td = valuesInUnit(dewpointFromSpecificHumidity(qty(pressurePa[0], 'Pa'), qty(q, 'kg/kg')), 'K');
    return {
      pressurePa: pressurePa[0],
      heightM: heightM[0],
      temperatureK: t,
      dewpointK: td,
      index: 0,
    };
  }

  const mostUnstableTop = pressurePa[0] - 30000;
  const candidateIndices = clampIndex(pressurePa, (value) => value >= mostUnstableTop);
  let bestIndex = candidateIndices.length ? candidateIndices[0] : 0;
  let bestThetaE = -Infinity;
  for (const index of candidateIndices.length ? candidateIndices : [0]) {
    const thetaE = equivalentPotentialTemperature(pressurePa[index], temperatureK[index], dewpointK[index]);
    if (thetaE > bestThetaE) {
      bestThetaE = thetaE;
      bestIndex = index;
    }
  }
  return {
    pressurePa: pressurePa[bestIndex],
    heightM: heightM[bestIndex],
    temperatureK: temperatureK[bestIndex],
    dewpointK: dewpointK[bestIndex],
    index: bestIndex,
  };
}

export function calcParcelProfile(pressure, height, temperature, dewpoint, alignToInputPressureValues = true, options = {}) {
  const pressurePa = asNumericArray(pressure, 'Pa');
  const heightM = asNumericArray(height, 'm');
  const temperatureK = asNumericArray(temperature, 'K');
  const dewpointK = asNumericArray(dewpoint, 'K');

  if (!(pressurePa.length === heightM.length && heightM.length === temperatureK.length && temperatureK.length === dewpointK.length)) {
    throw new Error('Pressure, height, temperature, and dewpoint must have the same length.');
  }

  for (let i = 0; i < pressurePa.length; i += 1) {
    if (![pressurePa[i], heightM[i], temperatureK[i], dewpointK[i]].every(Number.isFinite)) {
      throw new Error('Pressure, height, temperature, and dewpoint must be finite.');
    }
    if (i > 0) {
      if (!(pressurePa[i] < pressurePa[i - 1])) {
        throw new Error('Pressure profile must be strictly decreasing.');
      }
      if (!(heightM[i] > heightM[i - 1])) {
        throw new Error('Height profile must be strictly increasing.');
      }
    }
  }

  const specificHumidityKgKg = asNumericArray(specificHumidityFromDewpoint(pressure, dewpoint), 'kg/kg');
  const origin = selectParcelOriginValues(pressurePa, heightM, temperatureK, dewpointK, options);
  const dz = valuesInUnit(options.dz || qty(DEFAULT_DZ_METERS, 'm'), 'm');
  const entrainmentRate = valuesInUnit(options.entrainmentRate || qty(0, 'dimensionless'), 'dimensionless');
  const pseudoadiabaticSwitch = options.pseudoadiabaticSwitch !== undefined ? options.pseudoadiabaticSwitch : true;
  let parcelPressure = origin.pressurePa;
  let parcelHeight = origin.heightM;
  let parcelTemperature = origin.temperatureK;
  let parcelQv = valuesInUnit(specificHumidityFromDewpoint(qty(parcelPressure, 'Pa'), qty(origin.dewpointK, 'K')), 'kg/kg');
  let parcelQt = parcelQv;
  let dqtDz = 0;
  const precipitationRate = pseudoadiabaticSwitch ? 1 / dz : 0;

  const pressureRaw = [parcelPressure];
  const heightRaw = [parcelHeight];
  const temperatureRaw = [parcelTemperature];
  const qvRaw = [parcelQv];
  const qtRaw = [parcelQt];

  while (parcelPressure >= pressurePa[pressurePa.length - 1]) {
    const envTemperature = valuesInUnit(linearInterp(qty(heightM, 'm'), qty(temperatureK, 'K'), qty(parcelHeight, 'm')), 'K');
    const parcelSaturationQv = (1 - parcelQt) * valuesInUnit(rSat(qty(parcelTemperature, 'K'), qty(parcelPressure, 'Pa'), 1), 'kg/kg');

    if (![envTemperature, parcelSaturationQv, parcelPressure, parcelHeight, parcelTemperature, parcelQv, parcelQt].every(Number.isFinite)) {
      throw new Error('Non-finite parcel profile encountered.');
    }

    parcelPressure = valuesInUnit(pressureAtHeight(qty(parcelPressure, 'Pa'), qty(dz, 'm'), qty(envTemperature, 'K')), 'Pa');
    parcelHeight += dz;

    const nextEnvTemperature = valuesInUnit(linearInterp(qty(heightM, 'm'), qty(temperatureK, 'K'), qty(parcelHeight, 'm')), 'K');
    const envQv = valuesInUnit(linearInterp(qty(heightM, 'm'), qty(specificHumidityKgKg, 'kg/kg'), qty(parcelHeight, 'm')), 'kg/kg');

    if (![parcelPressure, parcelHeight, nextEnvTemperature, envQv].every(Number.isFinite)) {
      throw new Error('Non-finite parcel profile encountered.');
    }

    if (parcelSaturationQv > parcelQv) {
      const dTdz = valuesInUnit(
        unsaturatedAdiabaticLapseRate(
          qty(parcelTemperature, 'K'),
          qty(parcelQv, 'kg/kg'),
          qty(nextEnvTemperature, 'K'),
          qty(envQv, 'kg/kg'),
          qty(entrainmentRate, 'dimensionless'),
        ),
        'dimensionless',
      );
      const dqvDz = -entrainmentRate * (parcelQv - envQv);
      parcelTemperature += dTdz * dz;
      parcelQv += dqvDz * dz;
      parcelQt = parcelQv;
    } else {
      const dTdz = valuesInUnit(
        saturatedAdiabaticLapseRate(
          qty(parcelTemperature, 'K'),
          qty(parcelQt, 'kg/kg'),
          qty(parcelPressure, 'Pa'),
          qty(nextEnvTemperature, 'K'),
          qty(envQv, 'kg/kg'),
          qty(entrainmentRate, 'dimensionless'),
          qty(precipitationRate, 'dimensionless'),
          qty(273.15, 'K'),
          qty(253.15, 'K'),
          pseudoadiabaticSwitch ? qty(dqtDz, 'dimensionless') : null,
        ),
        'dimensionless',
      );
      const newParcelQv = (1 - parcelQt) * valuesInUnit(rSat(qty(parcelTemperature, 'K'), qty(parcelPressure, 'Pa'), 1), 'kg/kg');
      if (pseudoadiabaticSwitch) {
        dqtDz = (newParcelQv - parcelQv) / dz;
      } else {
        dqtDz = -entrainmentRate * (parcelQt - envQv) - precipitationRate * (parcelQt - parcelQv);
      }
      parcelTemperature += dTdz * dz;
      parcelQv = newParcelQv;
      if (pseudoadiabaticSwitch) {
        parcelQt = parcelQv;
      } else {
        dqtDz = -entrainmentRate * (parcelQt - envQv) - precipitationRate * (parcelQt - parcelQv);
        parcelQt += dqtDz * dz;
      }
      if (parcelQt < parcelQv) {
        parcelQv = parcelQt;
      }
    }

    if (![parcelPressure, parcelHeight, parcelTemperature, parcelQv, parcelQt].every(Number.isFinite)) {
      throw new Error('Non-finite parcel profile encountered.');
    }

    pressureRaw.push(parcelPressure);
    heightRaw.push(parcelHeight);
    temperatureRaw.push(parcelTemperature);
    qvRaw.push(parcelQv);
    qtRaw.push(parcelQt);
  }

  if (!alignToInputPressureValues) {
    return [
      qty(pressureRaw, 'Pa'),
      qty(heightRaw, 'm'),
      qty(temperatureRaw, 'K'),
      qty(qvRaw, 'kg/kg'),
      qty(qtRaw, 'kg/kg'),
    ];
  }

  const alignedPressure = [];
  const alignedHeight = [];
  const alignedTemperature = [];
  const alignedQv = [];
  const alignedQt = [];

  for (let i = 0; i < pressurePa.length; i += 1) {
    const inputPressure = pressurePa[i];
    const inputHeight = heightM[i];
    if (inputPressure <= pressureRaw[0] && inputPressure >= pressureRaw[pressureRaw.length - 1]) {
      const alignedTemperatureValue = valuesInUnit(reverseLinearInterp(qty(pressureRaw, 'Pa'), qty(temperatureRaw, 'K'), qty(inputPressure, 'Pa')), 'K');
      const alignedQvValue = valuesInUnit(reverseLinearInterp(qty(pressureRaw, 'Pa'), qty(qvRaw, 'kg/kg'), qty(inputPressure, 'Pa')), 'kg/kg');
      const alignedQtValue = valuesInUnit(reverseLinearInterp(qty(pressureRaw, 'Pa'), qty(qtRaw, 'kg/kg'), qty(inputPressure, 'Pa')), 'kg/kg');
      if (![alignedTemperatureValue, alignedQvValue, alignedQtValue].every(Number.isFinite)) {
        throw new Error('Non-finite aligned parcel profile encountered.');
      }
      alignedPressure.push(inputPressure);
      alignedHeight.push(inputHeight);
      alignedTemperature.push(alignedTemperatureValue);
      alignedQv.push(alignedQvValue);
      alignedQt.push(alignedQtValue);
    } else {
      alignedPressure.push(inputPressure);
      alignedHeight.push(inputHeight);
      alignedTemperature.push(temperatureK[i]);
      alignedQv.push(specificHumidityKgKg[i]);
      alignedQt.push(specificHumidityKgKg[i]);
    }
  }

  return [
    qty(alignedPressure, 'Pa'),
    qty(alignedHeight, 'm'),
    qty(alignedTemperature, 'K'),
    qty(alignedQv, 'kg/kg'),
    qty(alignedQt, 'kg/kg'),
  ];
}
export function customCapeCinLfcEl(
  parcelHeight,
  parcelTemperature,
  parcelQv,
  parcelQt,
  envHeight,
  envTemperature,
  envQv,
  integrationBoundLower = null,
  integrationBoundUpper = null,
) {
  const parcelHeightM = asNumericArray(parcelHeight, 'm');
  const parcelTemperatureK = asNumericArray(parcelTemperature, 'K');
  const parcelQvKgKg = asNumericArray(parcelQv, 'kg/kg');
  const parcelQtKgKg = asNumericArray(parcelQt, 'kg/kg');
  const envHeightM = asNumericArray(envHeight, 'm');
  const envTemperatureK = asNumericArray(envTemperature, 'K');
  const envQvKgKg = asNumericArray(envQv, 'kg/kg');
  const lowerBoundM = integrationBoundLower ? valuesInUnit(integrationBoundLower, 'm') : null;
  const upperBoundM = integrationBoundUpper ? valuesInUnit(integrationBoundUpper, 'm') : null;

  const parcelDensityTemperature = asNumericArray(densityTemperature(qty(parcelTemperatureK, 'K'), qty(parcelQvKgKg, 'kg/kg'), qty(parcelQtKgKg, 'kg/kg')), 'K');
  const envDensityTemperature = asNumericArray(densityTemperature(qty(envTemperatureK, 'K'), qty(envQvKgKg, 'kg/kg'), qty(envQvKgKg, 'kg/kg')), 'K');
  const envMse = asNumericArray(moistStaticEnergy(qty(envHeightM, 'm'), qty(envTemperatureK, 'K'), qty(envQvKgKg, 'kg/kg')), 'J/kg');

  let minMseIndex = 0;
  for (let i = 1; i < envMse.length; i += 1) {
    if (envMse[i] < envMse[minMseIndex]) {
      minMseIndex = i;
    }
  }

  const heightMinMse = envHeightM[minMseIndex];
  let positive = 0;
  let negative = 0;
  let lfc = null;
  let el = null;

  for (let i = parcelHeightM.length - 1; i > 0; i -= 1) {
    const z0 = parcelHeightM[i];
    const dz = parcelHeightM[i] - parcelHeightM[i - 1];

    if (lowerBoundM !== null && z0 < lowerBoundM) {
      continue;
    }
    if (upperBoundM !== null && z0 > upperBoundM) {
      continue;
    }

    const envTrho = valuesInUnit(linearInterp(qty(envHeightM, 'm'), qty(envDensityTemperature, 'K'), qty(z0, 'm')), 'K');
    const buoyancy = G * (parcelDensityTemperature[i] - envTrho) / envTrho;

    if (buoyancy > 0 && el === null) {
      el = z0;
    }
    if (buoyancy > 0 && lfc === null) {
      positive += buoyancy * dz;
    }
    if (z0 < heightMinMse && buoyancy < 0) {
      negative += buoyancy * dz;
      if (lfc === null) {
        lfc = z0;
      }
    }
  }

  if (lfc === null) {
    lfc = envHeightM[0];
  }

  return [qty(positive, 'J/kg'), qty(negative, 'J/kg'), qty(lfc, 'm'), el === null ? null : qty(el, 'm')];
}

export function calcPsi(inputElHeight) {
  const elHeightM = valuesInUnit(inputElHeight, 'm');
  const sigma = 1.1;
  const alpha = 0.8;
  const lMix = 120.0;
  const pr = 1.0 / 3.0;
  const ksq = 0.18;
  return qty((ksq * alpha * alpha * Math.PI * Math.PI * lMix) / (4 * pr * sigma * sigma * elHeightM), 'dimensionless');
}

export function calcIntegralArg(moistStaticEnergyBar, moistStaticEnergyStar, temperature) {
  const mseBar = asNumericArray(moistStaticEnergyBar, 'J/kg');
  const mseStar = asNumericArray(moistStaticEnergyStar, 'J/kg');
  const temperatureK = asNumericArray(temperature, 'K');
  const length = Math.max(mseBar.length, mseStar.length, temperatureK.length);
  const bar = broadcastNumericArray(mseBar, length);
  const star = broadcastNumericArray(mseStar, length);
  const t = broadcastNumericArray(temperatureK, length);
  return qty(bar.map((value, index) => -(G / (CPD * t[index])) * (value - star[index])), 'dimensionless');
}

export function calcMse(pressure, height, temperature, specificHumidityInput) {
  const pressurePa = asNumericArray(pressure, 'Pa');
  const heightM = asNumericArray(height, 'm');
  const temperatureK = asNumericArray(temperature, 'K');
  const specificHumidityKgKg = asNumericArray(specificHumidityInput, 'kg/kg');

  const moistStaticEnergyValues = asNumericArray(moistStaticEnergy(qty(heightM, 'm'), qty(temperatureK, 'K'), qty(specificHumidityKgKg, 'kg/kg')), 'J/kg');
  const moistStaticEnergyBar = [];
  let sum = 0;
  for (let i = 0; i < moistStaticEnergyValues.length; i += 1) {
    sum += moistStaticEnergyValues[i];
    moistStaticEnergyBar.push(sum / (i + 1));
  }

  const saturationMixingRatio = pressurePa.map((p, index) => {
    const mixingRatio = valuesInUnit(rSat(qty(temperatureK[index], 'K'), qty(p, 'Pa'), 0), 'kg/kg');
    return mixingRatio / (1 + mixingRatio);
  });
  const moistStaticEnergyStar = asNumericArray(moistStaticEnergy(qty(heightM, 'm'), qty(temperatureK, 'K'), qty(saturationMixingRatio, 'kg/kg')), 'J/kg');
  return [qty(moistStaticEnergyBar, 'J/kg'), qty(moistStaticEnergyStar, 'J/kg')];
}

function lastIndexAtOrBelow(heightM, targetM) {
  let idx = 0;
  for (let i = 0; i < heightM.length; i += 1) {
    if (heightM[i] <= targetM) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}

function estimateLfcElFromParcelTemperatures(heightM, envTemperatureK, parcelTemperatureK) {
  let lfcM = heightM[0];
  let elM = heightM[heightM.length - 1];
  let foundPositive = false;
  let lastPositiveIndex = -1;

  for (let i = 1; i < heightM.length; i += 1) {
    const diff = parcelTemperatureK[i] - envTemperatureK[i];
    const prevDiff = parcelTemperatureK[i - 1] - envTemperatureK[i - 1];

    if (!foundPositive && diff > 0 && prevDiff <= 0) {
      lfcM = heightM[i - 1];
      foundPositive = true;
    }

    if (diff > 0) {
      lastPositiveIndex = i;
    }
  }

  if (lastPositiveIndex >= 0) {
    elM = heightM[lastPositiveIndex];
  }

  return [qty(lfcM, 'm'), qty(elM, 'm')];
}

export function calcNcape(integralArg, height, lfcIndex, elIndex) {
  const integralArgValues = asNumericArray(integralArg, 'dimensionless');
  const heightM = asNumericArray(height, 'm');
  let ncape = 0;
  for (let i = lfcIndex; i < elIndex; i += 1) {
    ncape += 0.5 * (integralArgValues[i] + integralArgValues[i + 1]) * (heightM[i + 1] - heightM[i]);
  }
  return qty(ncape, 'J/kg');
}

function computeNcapeReference(temperatureK, pressurePa, specificHumidityKgKg, heightM, lfcM, elM) {
  const mse0 = temperatureK.map((t, i) => CPD * t + LV_TRIP * specificHumidityKgKg[i] + G * heightM[i]);
  const mse0Star = temperatureK.map((t, i) => {
    const rsat = valuesInUnit(rSat(qty(t, 'K'), qty(pressurePa[i], 'Pa'), 0), 'kg/kg');
    const qsat = (1 - rsat) * rsat;
    return CPD * t + LV_TRIP * qsat + G * heightM[i];
  });

  const mse0Bar = new Array(mse0.length).fill(0);
  mse0Bar[0] = mse0[0];
  for (let iz = 1; iz < mse0.length; iz += 1) {
    let trap = 0;
    for (let j = 0; j < iz; j += 1) {
      trap += 0.5 * (mse0[j] + mse0[j + 1]) * (heightM[j + 1] - heightM[j]);
    }
    mse0Bar[iz] = trap / (heightM[iz] - heightM[0]);
  }

  const integralArg = temperatureK.map((t, i) => -(G / (CPD * t)) * (mse0Bar[i] - mse0Star[i]));

  let indLfc = 0;
  let indEl = heightM.length - 1;
  let bestLfc = Infinity;
  let bestEl = Infinity;
  for (let i = 0; i < heightM.length; i += 1) {
    const dl = Math.abs(heightM[i] - lfcM);
    const de = Math.abs(heightM[i] - elM);
    if (dl < bestLfc) {
      bestLfc = dl;
      indLfc = i;
    }
    if (de < bestEl) {
      bestEl = de;
      indEl = i;
    }
  }

  let ncape = 0;
  for (let i = indLfc; i < Math.max(indLfc, indEl - 1); i += 1) {
    ncape += 0.5 * (integralArg[i] + integralArg[i + 1]) * (heightM[i + 1] - heightM[i]);
  }

  return Math.max(ncape, 0);
}

function resolveStormMotion(pressurePa, uMS, vMS, heightM, stormMotionType = 'right_moving', inflowBottomM = 0, inflowTopM = 1000, stormMotionU = null, stormMotionV = null) {
  if (stormMotionType === 'user_defined') {
    return {
      u: stormMotionU ? valuesInUnit(stormMotionU, 'm/s') : 0,
      v: stormMotionV ? valuesInUnit(stormMotionV, 'm/s') : 0,
    };
  }
  const bunkers = bunkersStormMotion(pressurePa, uMS, vMS, heightM);
  if (stormMotionType === 'mean_wind') {
    return bunkers.mean;
  }
  return stormMotionType === 'left_moving' ? bunkers.left : bunkers.right;
}

export function calcSrWind(
  pressure,
  uWind,
  vWind,
  height,
  inflowLayerBottom = qty(0, 'm'),
  inflowLayerTop = qty(1000, 'm'),
  stormMotionType = 'right_moving',
  options = {},
) {
  const pressurePa = asNumericArray(pressure, 'Pa');
  const uMS = asNumericArray(uWind, 'm/s');
  const vMS = asNumericArray(vWind, 'm/s');
  const heightM = asNumericArray(height, 'm');
  const inflowBottomM = valuesInUnit(inflowLayerBottom, 'm');
  const inflowTopM = valuesInUnit(inflowLayerTop, 'm');
  const heightAgl = heightM.map((value) => value - heightM[0]);
  const stormMotion = resolveStormMotion(
    pressurePa,
    uMS,
    vMS,
    heightAgl,
    stormMotionType,
    inflowBottomM,
    inflowTopM,
    options.smU || null,
    options.smV || null,
  );
  const indices = clampIndex(heightAgl, (value) => value >= inflowBottomM && value <= inflowTopM);
  const speeds = (indices.length ? indices : [0]).map((index) => Math.hypot(uMS[index] - stormMotion.u, vMS[index] - stormMotion.v));
  return qty(mean(speeds), 'm/s');
}

export function calcEcapeA(srWind, psi, ncape, cape) {
  const srWindMS = valuesInUnit(srWind, 'm/s');
  const psiValue = valuesInUnit(psi, 'dimensionless');
  const ncapeValue = valuesInUnit(ncape, 'J/kg');
  const capeValue = valuesInUnit(cape, 'J/kg');
  const termA = (srWindMS * srWindMS) / 2;
  const termB = (-1 - psiValue - (2 * psiValue * ncapeValue) / (srWindMS * srWindMS)) / ((4 * psiValue) / (srWindMS * srWindMS));
  const termC = Math.sqrt(
    Math.pow(1 + psiValue + (2 * psiValue * ncapeValue) / (srWindMS * srWindMS), 2) +
      8 * (psiValue / (srWindMS * srWindMS)) * (capeValue - psiValue * ncapeValue),
  ) / ((4 * psiValue) / (srWindMS * srWindMS));
  return qty(Math.max(0, termA + termB + termC), 'J/kg');
}

export function calcEcapeNcape(
  height,
  pressure,
  temperature,
  specificHumidityInput,
  uWind,
  vWind,
  capeType = 'most_unstable',
  cape = null,
  options = {},
) {
  const heightM = asNumericArray(height, 'm');
  const specificHumidityKgKg = asNumericArray(specificHumidityInput, 'kg/kg');
  const dewpoint = dewpointFromSpecificHumidity(pressure, specificHumidityInput);
  const parcel = calcParcelProfile(pressure, height, temperature, dewpoint, true, {
    capeType,
    mixedLayerDepthPressure: options.mixedLayerDepthPressure || qty(100, 'hPa'),
    mixedLayerDepthHeight: options.mixedLayerDepthHeight || null,
    pseudoadiabaticSwitch: true,
    originPressure: options.originPressure || null,
    originHeight: options.originHeight || null,
    originTemperature: options.originTemperature || null,
    originDewpoint: options.originDewpoint || null,
  });
  const [undilutedCape, , undilutedLfc, undilutedEl] = customCapeCinLfcEl(
    parcel[1],
    parcel[2],
    parcel[3],
    parcel[4],
    height,
    temperature,
    specificHumidityInput,
  );
  const capeValue = cape || undilutedCape;
  const lfcValue = options.lfc || undilutedLfc;
  const elValue = options.el || undilutedEl;
  if (lfcValue === null || elValue === null) {
    throw new Error('ECAPE requires finite LFC and EL.');
  }
  const ncape = qty(
    computeNcapeReference(
      asNumericArray(temperature, 'K'),
      asNumericArray(pressure, 'Pa'),
      specificHumidityKgKg,
      heightM,
      valuesInUnit(lfcValue, 'm'),
      valuesInUnit(elValue, 'm'),
    ),
    'J/kg',
  );
  const srWind = calcSrWind(
    pressure,
    uWind,
    vWind,
    height,
    options.inflowBottom || qty(0, 'm'),
    options.inflowTop || qty(1000, 'm'),
    options.stormMotion || 'right_moving',
    { smU: options.uSm || null, smV: options.vSm || null },
  );
  const psi = calcPsi(elValue);
  const ecape = calcEcapeA(srWind, psi, ncape, capeValue);
  return [ecape, ncape];
}

export function calcEcape(
  height,
  pressure,
  temperature,
  specificHumidityInput,
  uWind,
  vWind,
  capeType = 'most_unstable',
  undilutedCape = null,
  options = {},
) {
  const [ecape] = calcEcapeNcape(height, pressure, temperature, specificHumidityInput, uWind, vWind, capeType, undilutedCape, options);
  return ecape;
}

export {
  DEFAULT_DZ_METERS,
  G,
  RD,
  RV,
  CPD,
  CPV,
  CPL,
  CPI,
  EPSILON,
  LV_TRIP,
  LI_TRIP,
  T_TRIP,
  selectParcelOriginValues,
};

export const calc_ecape = calcEcape;
export const calc_ecape_a = calcEcapeA;
export const calc_ecape_ncape = calcEcapeNcape;
export const calc_sr_wind = calcSrWind;
export const calc_mse = calcMse;
export const calc_integral_arg = calcIntegralArg;
export const calc_ncape = calcNcape;
export const calc_psi = calcPsi;
export const custom_cape_cin_lfc_el = customCapeCinLfcEl;
export const vapor_pressure = vaporPressure;
export const vapor_pressure_from_specific_humidity = vaporPressureFromSpecificHumidity;
export const dewpoint_from_vapor_pressure = dewpointFromVaporPressure;
export const dewpoint_from_specific_humidity = dewpointFromSpecificHumidity;
export const specific_humidity = specificHumidity;
export const specific_humidity_from_dewpoint = specificHumidityFromDewpoint;
export const potential_temperature = potentialTemperature;
export const temperature_from_potential_temperature = temperatureFromPotentialTemperature;
export const density_temperature = densityTemperature;
export const moist_static_energy = moistStaticEnergy;
export const pressure_at_height = pressureAtHeight;
export const linear_interp = linearInterp;
export const rev_linear_interp = reverseLinearInterp;
export const ice_fraction = iceFraction;
export const ice_fraction_deriv = iceFractionDeriv;
export const r_sat = rSat;
export const unsaturated_adiabatic_lapse_rate = unsaturatedAdiabaticLapseRate;
export const saturated_adiabatic_lapse_rate = saturatedAdiabaticLapseRate;
