import {
  qty,
  toUnit,
  specificHumidityFromDewpoint,
  dewpointFromSpecificHumidity,
  densityTemperature,
  pressureAtHeight,
  linearInterp,
  reverseLinearInterp,
  rSat,
  unsaturatedAdiabaticLapseRate,
  saturatedAdiabaticLapseRate,
  customCapeCinLfcEl,
  calcEcapeNcape,
  calcSrWind,
  windComponentsFromDirectionSpeed,
  calcParcelProfile,
  DEFAULT_DZ_METERS,
} from './ecape_calc.js';

const K2 = 0.18;
const L_MIX = 120.0;
const PR = 1 / 3;
const DEFAULT_DZ = qty(DEFAULT_DZ_METERS, 'm');

function valuesInUnit(input, unit) {
  return toUnit(input, unit).value;
}

function asArray(value) {
  return Array.isArray(value) ? value.slice() : [value];
}

function nullProfile(length) {
  return [Array.from({ length }, () => null), Array.from({ length }, () => null), Array.from({ length }, () => null), Array.from({ length }, () => null), Array.from({ length }, () => null)];
}

function isFiniteScalarQuantity(input, unit) {
  return input !== null && Number.isFinite(valuesInUnit(input, unit));
}

export function entrainmentRate(cape, ecape, ncape, vsr, stormColumnHeight) {
  const capeValue = valuesInUnit(cape, 'J/kg');
  const ecapeValue = valuesInUnit(ecape, 'J/kg');
  const ncapeValue = valuesInUnit(ncape, 'J/kg');
  const vsrValue = valuesInUnit(vsr, 'm/s');
  const stormColumnHeightM = valuesInUnit(stormColumnHeight, 'm');
  const eATilde = ecapeValue / capeValue;
  const nTilde = ncapeValue / capeValue;
  const vsrTilde = vsrValue / Math.sqrt(2 * capeValue);
  const eTilde = eATilde - vsrTilde * vsrTilde;
  return qty((2 * (1 - eTilde) / (eTilde + nTilde)) / stormColumnHeightM, 'dimensionless');
}

export function updraftRadius(inputEntrainmentRate) {
  const entrainmentRateValue = valuesInUnit(inputEntrainmentRate, 'dimensionless');
  return qty(Math.sqrt((2 * K2 * L_MIX) / (PR * entrainmentRateValue)), 'm');
}

export function calcEcapeParcel(
  pressure,
  height,
  temperature,
  dewpoint,
  uWind,
  vWind,
  alignToInputPressureValues = true,
  options = {},
) {
  const pressurePa = asArray(valuesInUnit(pressure, 'Pa'));
  const specificHumidityKgKg = asArray(valuesInUnit(specificHumidityFromDewpoint(pressure, dewpoint), 'kg/kg'));

  const {
    entrainmentSwitch = true,
    pseudoadiabaticSwitch = true,
    capeType = 'most_unstable',
    mixedLayerDepthPressure = qty(100, 'hPa'),
    mixedLayerDepthHeight = null,
    stormMotionType = 'right_moving',
    inflowLayerBottom = qty(0, 'km'),
    inflowLayerTop = qty(1, 'km'),
    cape = null,
    lfc = null,
    el = null,
    stormMotionU = null,
    stormMotionV = null,
    originPressure = null,
    originHeight = null,
    originTemperature = null,
    originDewpoint = null,
    dz = DEFAULT_DZ,
  } = options;

  const effectiveStormMotionType =
    (stormMotionU !== null || stormMotionV !== null) && options.stormMotionType === undefined
      ? 'user_defined'
      : stormMotionType;

  let capeValue = cape;
  let lfcValue = lfc;
  let elValue = el;

  if ((capeValue === null || lfcValue === null || elValue === null) && entrainmentSwitch) {
    const undilutedParcel = calcEcapeParcel(pressure, height, temperature, dewpoint, uWind, vWind, false, {
      entrainmentSwitch: false,
      pseudoadiabaticSwitch,
      capeType,
      mixedLayerDepthPressure,
      mixedLayerDepthHeight,
      stormMotionType: effectiveStormMotionType,
      inflowLayerBottom,
      inflowLayerTop,
      originPressure,
      originHeight,
      originTemperature,
      originDewpoint,
      dz,
    });

    const [undilutedCape, , undilutedLfc, undilutedEl] = customCapeCinLfcEl(
      undilutedParcel[1],
      undilutedParcel[2],
      undilutedParcel[3],
      undilutedParcel[4],
      height,
      temperature,
      qty(specificHumidityKgKg, 'kg/kg'),
    );

    if (capeValue === null) {
      capeValue = undilutedCape;
    }
    if (lfcValue === null) {
      lfcValue = undilutedLfc;
    }
    if (elValue === null) {
      elValue = undilutedEl;
    }
  }

  if (entrainmentSwitch && (
    !isFiniteScalarQuantity(capeValue, 'J/kg')
    || !isFiniteScalarQuantity(lfcValue, 'm')
    || !isFiniteScalarQuantity(elValue, 'm')
  )) {
    throw new Error('Entraining parcel requires finite CAPE, LFC, and EL.');
  }

  if (entrainmentSwitch && valuesInUnit(capeValue, 'J/kg') <= 0) {
    if (alignToInputPressureValues) {
      return nullProfile(pressurePa.length);
    }
    return nullProfile(1);
  }

  let entrainment = qty(0, 'dimensionless');
  if (entrainmentSwitch) {
    const ecapeReferenceParcel = calcParcelProfile(pressure, height, temperature, dewpoint, false, {
      capeType,
      mixedLayerDepthPressure,
      mixedLayerDepthHeight,
      pseudoadiabaticSwitch,
      entrainmentRate: qty(0, 'dimensionless'),
      originPressure,
      originHeight,
      originTemperature,
      originDewpoint,
      dz,
    });
    const [, , ecapeReferenceLfc, ecapeReferenceEl] = customCapeCinLfcEl(
      ecapeReferenceParcel[1],
      ecapeReferenceParcel[2],
      ecapeReferenceParcel[3],
      ecapeReferenceParcel[4],
      height,
      temperature,
      qty(specificHumidityKgKg, 'kg/kg'),
    );
    if (!isFiniteScalarQuantity(ecapeReferenceLfc, 'm') || !isFiniteScalarQuantity(ecapeReferenceEl, 'm')) {
      throw new Error('Entraining parcel reference path requires finite LFC and EL.');
    }

    const [ecape, ncape] = calcEcapeNcape(
      height,
      pressure,
      temperature,
      qty(specificHumidityKgKg, 'kg/kg'),
      uWind,
      vWind,
      capeType,
      capeValue,
      {
        inflowBottom: inflowLayerBottom,
        inflowTop: inflowLayerTop,
        stormMotionType: effectiveStormMotionType,
        lfc: lfcValue,
        el: elValue,
        stormMotionU,
        stormMotionV,
        mixedLayerDepthPressure,
        mixedLayerDepthHeight,
        originPressure,
        originHeight,
        originTemperature,
        originDewpoint,
      },
    );

    const vsr = calcSrWind(
      pressure,
      uWind,
      vWind,
      height,
      inflowLayerBottom,
      inflowLayerTop,
      effectiveStormMotionType,
      { stormMotionU, stormMotionV },
    );

    const parcelOrigin = calcParcelProfile(pressure, height, temperature, dewpoint, false, {
      capeType,
      mixedLayerDepthPressure,
      mixedLayerDepthHeight,
      pseudoadiabaticSwitch,
      entrainmentRate: qty(0, 'dimensionless'),
      originPressure,
      originHeight,
      originTemperature,
      originDewpoint,
      dz,
    });
    const parcelHeight0 = valuesInUnit(parcelOrigin[1], 'm')[0];
    const stormColumnHeight = qty(valuesInUnit(elValue, 'm') - parcelHeight0, 'm');
    entrainment = entrainmentRate(capeValue, ecape, ncape, vsr, stormColumnHeight);
  }

  return calcParcelProfile(pressure, height, temperature, dewpoint, alignToInputPressureValues, {
    entrainmentRate: entrainment,
    pseudoadiabaticSwitch,
    capeType,
    mixedLayerDepthPressure,
    mixedLayerDepthHeight,
    originPressure,
    originHeight,
    originTemperature,
    originDewpoint,
    dz,
  });
}

export {
  qty,
  toUnit,
  densityTemperature,
  specificHumidityFromDewpoint,
  dewpointFromSpecificHumidity,
  customCapeCinLfcEl,
  calcEcapeNcape,
  calcSrWind,
  windComponentsFromDirectionSpeed,
  pressureAtHeight,
  linearInterp,
  reverseLinearInterp,
  rSat,
  unsaturatedAdiabaticLapseRate,
  saturatedAdiabaticLapseRate,
};

export const calc_ecape_parcel = calcEcapeParcel;
export const density_temperature = densityTemperature;
export const entrainment_rate = entrainmentRate;
export const updraft_radius = updraftRadius;
export const custom_cape_cin_lfc_el = customCapeCinLfcEl;
export const specific_humidity_from_dewpoint = specificHumidityFromDewpoint;
export const wind_components_from_direction_speed = windComponentsFromDirectionSpeed;
export const dewpoint_from_specific_humidity = dewpointFromSpecificHumidity;
