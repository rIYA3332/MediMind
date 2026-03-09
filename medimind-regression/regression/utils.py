# regression/utils.py

import numpy as np
from scipy import stats
from typing import Optional

VITAL_META = {
    'blood_pressure': {'label': 'Blood Pressure', 'unit': 'mmHg'},
    'blood_sugar':    {'label': 'Blood Sugar',     'unit': 'mg/dL'},
    'heart_rate':     {'label': 'Heart Rate',      'unit': 'bpm'},
    'temperature':    {'label': 'Temperature',     'unit': '°F'},
    'weight':         {'label': 'Weight',          'unit': 'kg'},
}

STABLE_THRESHOLDS = {
    'blood_pressure': 0.15,
    'blood_sugar':    0.30,
    'heart_rate':     0.10,
    'temperature':    0.02,
    'weight':         0.02,
}

def parse_numeric(log_type: str, raw_value: str) -> Optional[float]:
    try:
        if log_type == 'blood_pressure':
            return float(str(raw_value).split('/')[0])
        return float(raw_value)
    except (ValueError, IndexError, TypeError):
        return None

def classify_trend(slope: float, log_type: str) -> str:
    threshold = STABLE_THRESHOLDS.get(log_type, 0.10)
    if slope > threshold:
        return 'rising'
    if slope < -threshold:
        return 'falling'
    return 'stable'

def trend_display(trend: str) -> dict:
    return {
        'rising':  {'label': '📈 Trending Up',   'color': '#e17055'},
        'falling': {'label': '📉 Trending Down', 'color': '#0984e3'},
        'stable':  {'label': '➡️ Stable',        'color': '#00b894'},
    }.get(trend, {'label': '➡️ Stable', 'color': '#00b894'})

def build_summary(trend: str, slope: float, avg: float, unit: str, count: int) -> str:
    per_week = abs(round(slope * 7, 2))
    if trend == 'stable':
        return f'Stable — average {round(avg, 1)} {unit} over {count} reading(s).'
    direction = 'Rising' if trend == 'rising' else 'Falling'
    return f'{direction} ~{per_week} {unit}/week. Average: {round(avg, 1)} {unit}.'

def significance_note(n: int, p_value: float) -> tuple[str, str]:
    if n < 5:
        return 'insufficient_data', f'Only {n} data point(s) — trend may not be reliable yet.'
    if p_value < 0.05:
        return 'significant', f'Trend is statistically significant (p={p_value:.4f}).'
    if p_value < 0.10:
        return 'marginal', f'Trend is marginally significant (p={p_value:.4f}).'
    return 'not_significant', f'Trend not statistically significant (p={p_value:.4f}). May be random variation.'

def run_regression(log_type: str, raw_readings: list) -> dict:
    meta = VITAL_META.get(log_type, {'label': log_type, 'unit': ''})

    by_date: dict[str, dict] = {}
    for r in raw_readings:
        date    = (r.get('date') or str(r.get('logged_at', ''))[:10]).strip()
        raw_val = str(r.get('value', ''))
        num     = parse_numeric(log_type, raw_val)
        if num is None or not date:
            continue
        if date not in by_date:
            by_date[date] = {'nums': [], 'raw': raw_val}
        by_date[date]['nums'].append(num)

    sorted_dates = sorted(by_date.keys())
    if not sorted_dates:
        return {'error': 'No parseable readings for ' + log_type}

    readings_out = []
    y_values     = []
    for date in sorted_dates:
        nums    = by_date[date]['nums']
        avg_num = sum(nums) / len(nums)
        readings_out.append({
            'date':    date,
            'value':   by_date[date]['raw'],
            'numeric': round(avg_num, 2),
        })
        y_values.append(avg_num)

    n        = len(y_values)
    x_values = list(range(n))

    if n >= 2:
        result     = stats.linregress(x_values, y_values)
        slope      = round(result.slope,     4)
        intercept  = round(result.intercept, 4)
        r_squared  = round(result.rvalue ** 2, 4)
        p_val      = round(result.pvalue,    4)
        std_err    = round(result.stderr,    4)
        conf_95    = round(1.96 * result.stderr, 4)
    else:
        slope = intercept = 0.0
        r_squared = 0.0
        p_val     = 1.0
        std_err   = 0.0
        conf_95   = 0.0

    trend_line = [round(intercept + slope * i, 2) for i in x_values]

    arr    = np.array(y_values)
    avg    = float(round(np.mean(arr),   2))
    median = float(round(np.median(arr), 2))
    std    = float(round(np.std(arr),    2))
    min_v  = float(round(np.min(arr),    2))
    max_v  = float(round(np.max(arr),    2))
    latest = round(y_values[-1], 2)

    trend           = classify_trend(slope, log_type)
    display         = trend_display(trend)
    change_per_week = round(slope * 7, 2)
    predicted_today = round(intercept + slope * (n - 1), 2)
    summary         = build_summary(trend, slope, avg, meta['unit'], n)
    sig_key, sig_note = significance_note(n, p_val)

    return {
        'log_type':   log_type,
        'label':      meta['label'],
        'unit':       meta['unit'],
        'readings':   readings_out,
        'trend_line': trend_line,
        'regression': {
            'slope':             slope,
            'intercept':         intercept,
            'r_squared':         r_squared,
            'p_value':           p_val,
            'std_err':           std_err,
            'conf_95':           conf_95,
            'trend':             trend,
            'trend_label':       display['label'],
            'trend_color':       display['color'],
            'change_per_week':   change_per_week,
            'predicted_today':   predicted_today,
            'summary':           summary,
            'significance':      sig_key,
            'significance_note': sig_note,
        },
        'stats': {
            'min':    min_v,
            'max':    max_v,
            'avg':    avg,
            'median': median,
            'std':    std,
            'latest': latest,
            'count':  n,
        },
    }