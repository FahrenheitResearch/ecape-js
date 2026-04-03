from pathlib import Path
import ecape_parcel

ROOT = Path(__file__).resolve().parent
SRC = Path(ecape_parcel.__file__).resolve().parent
DST = ROOT / 'ecape_parcel_metrust'
DST.mkdir(exist_ok=True)

REPLACEMENTS = {
    'import metpy as mpy': 'import metrust as mpy',
    'import metpy.calc as mpcalc': 'import metrust.calc as mpcalc',
    'from metpy.constants import dry_air_spec_heat_press, earth_gravity': 'from metrust.constants import dry_air_spec_heat_press, earth_gravity',
    'from ecape_parcel.ecape_calc import calc_ecape_ncape, calc_sr_wind': 'from ecape_parcel_metrust.ecape_calc import calc_ecape_ncape, calc_sr_wind',
}

COMPAT = """

def _compat_dewpoint_from_specific_humidity(pressure, temperature, specific_humidity):
    try:
        return mpcalc.dewpoint_from_specific_humidity(pressure, temperature, specific_humidity)
    except TypeError:
        return mpcalc.dewpoint_from_specific_humidity(pressure, specific_humidity)
"""

for name in ('calc.py', 'ecape_calc.py'):
    text = (SRC / name).read_text(encoding='utf-8')
    for old, new in REPLACEMENTS.items():
        text = text.replace(old, new)
    if name == 'calc.py':
        text = text.replace('        parcel_dewpoint = mpcalc.dewpoint_from_specific_humidity(parcel_pressure, parcel_temperature, avg_specific_humidity)', '        parcel_dewpoint = _compat_dewpoint_from_specific_humidity(parcel_pressure, parcel_temperature, avg_specific_humidity)')
    else:
        text = text.replace('    dew_point_temperature = mpcalc.dewpoint_from_specific_humidity(pressure, temperature, specific_humidity)', '    dew_point_temperature = _compat_dewpoint_from_specific_humidity(pressure, temperature, specific_humidity)')
    text = text.replace('PintList = np.typing.NDArray[pint.Quantity]\n', 'PintList = np.typing.NDArray[pint.Quantity]\n' + COMPAT + '\n')
    (DST / name).write_text(text, encoding='utf-8')

(DST / '__init__.py').write_text('from .calc import *\n', encoding='utf-8')
print(DST)
