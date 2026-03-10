# regression/views.py
# ─────────────────────────────────────────────────────────────────────────────
# KEY FIX: All readings logged on the SAME DAY (same date) are now handled.
# Previously the code only worked when readings spanned multiple dates.
# Now: if unique dates == 1, we use the reading index (0,1,2…) as the X axis.
# This lets blood sugar / weight / heart rate readings all logged "today"
# still produce a valid trend line.
#
# Minimum requirement: 2 readings total (not 2 different dates).
#
# THRESHOLD FIX: Each vital now uses its own meaningful slope threshold for
# classifying a trend as "stable" vs "rising/falling".  The old flat 0.05
# threshold treated a 0.05 mmHg/day BP change as rising (it's noise) while
# also treating a 0.05 °F/day temperature change as noise (it's significant).
# ─────────────────────────────────────────────────────────────────────────────

import statistics
from datetime import datetime

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

try:
    from scipy import stats as scipy_stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


# ─── Vital metadata ───────────────────────────────────────────────────────────

VITAL_META = {
    'blood_pressure': {'label': 'Blood Pressure', 'unit': 'mmHg', 'normal_range': '90/60 – 120/80'},
    'blood_sugar':    {'label': 'Blood Sugar',    'unit': 'mg/dL', 'normal_range': '70 – 140'},
    'heart_rate':     {'label': 'Heart Rate',     'unit': 'bpm',   'normal_range': '60 – 100'},
    'temperature':    {'label': 'Temperature',    'unit': '°F',    'normal_range': '97 – 99'},
    'weight':         {'label': 'Weight',         'unit': 'kg',    'normal_range': 'Track changes'},
}

# ─── Per-vital stable thresholds (slope in units/day) ────────────────────────
#
# These define the minimum slope that counts as a real trend rather than noise.
# They match the domain knowledge in utils.py.
#
#   blood_pressure : 0.15 mmHg/day  — small daily swings are normal
#   blood_sugar    : 0.30 mg/dL/day — post-meal variation is large
#   heart_rate     : 0.10 bpm/day   — resting HR fluctuates ~5 bpm day-to-day
#   temperature    : 0.02 °F/day    — normal body temp range is only ±1 °F
#   weight         : 0.02 kg/day    — even 0.1 kg/day shift is meaningful
#
STABLE_THRESHOLDS = {
    'blood_pressure': 0.15,
    'blood_sugar':    0.30,
    'heart_rate':     0.10,
    'temperature':    0.02,
    'weight':         0.02,
}
DEFAULT_STABLE_THRESHOLD = 0.10   # fallback for unknown vitals


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _r(v, dp=2):
    try:
        return round(float(v), dp)
    except (TypeError, ValueError):
        return 0.0


def _parse_numeric(value_str, log_type):
    """
    Blood pressure '120/80' → systolic (120).
    All others → float. Returns None if unparseable.
    """
    try:
        v = str(value_str).strip()
        if log_type == 'blood_pressure':
            parts = v.split('/')
            return float(parts[0])
        return float(v)
    except (ValueError, IndexError):
        return None


def _safe_stdev(values):
    try:
        return _r(statistics.stdev(values)) if len(values) >= 2 else 0.0
    except statistics.StatisticsError:
        return 0.0


def _safe_median(values):
    try:
        return _r(statistics.median(values))
    except statistics.StatisticsError:
        return _r(values[0]) if values else 0.0


def _trend_color(trend):
    return {
        'rising':  '#e17055',
        'falling': '#0984e3',
        'stable':  '#00b894',
    }.get(trend, '#636e72')


def _significance(p_value, n):
    if n < 3:
        return 'insufficient_data', f'Only {n} readings — need ≥ 3 for significance testing'
    if p_value < 0.05:
        return 'significant', f'Statistically significant trend (p={_r(p_value, 3)})'
    if p_value < 0.10:
        return 'marginal', f'Marginal trend (p={_r(p_value, 3)}) — more data needed'
    return 'not_significant', f'No significant trend detected (p={_r(p_value, 3)})'


def _classify_trend(slope: float, r_squared: float, log_type: str) -> str:
    """
    Returns 'rising', 'falling', or 'stable'.

    Uses a per-vital slope threshold so that normal daily variation in a high-
    variance vital (e.g. blood sugar) does not produce a spurious rising/falling
    label, while a small but real shift in a low-variance vital (e.g. temperature)
    is still caught.

    A weak fit (r_squared < 0.10) is always classified as stable because the
    line explains less than 10 % of the variance — it's not a reliable trend.
    """
    if r_squared < 0.10:
        return 'stable'

    threshold = STABLE_THRESHOLDS.get(log_type, DEFAULT_STABLE_THRESHOLD)

    if slope > threshold:
        return 'rising'
    if slope < -threshold:
        return 'falling'
    return 'stable'


# ─── Core regression ──────────────────────────────────────────────────────────

def _run_regression(log_type, readings):
    """
    readings = [{'date': 'YYYY-MM-DD', 'value': str}, ...]

    X-axis strategy
    ───────────────
    • Multiple dates  → X = days since first reading date  (original behaviour)
    • All same date   → X = reading index 0, 1, 2 …        (NEW: same-day fix)

    Requires at least 2 readings regardless of date spread.
    """
    if not readings or len(readings) < 2:
        return {
            'error': (
                f'Need at least 2 readings for {log_type}, '
                f'got {len(readings) if readings else 0}'
            )
        }

    meta = VITAL_META.get(
        log_type,
        {'label': log_type.replace('_', ' ').title(), 'unit': '', 'normal_range': ''}
    )

    # ── Parse numeric values ──────────────────────────────────────────────────
    parsed = []
    for i, r in enumerate(readings):
        y = _parse_numeric(r.get('value', ''), log_type)
        if y is not None:
            parsed.append({
                'index': i,
                'date':  str(r.get('date', '')),
                'raw':   str(r.get('value', '')),
                'y':     y,
            })

    if len(parsed) < 2:
        return {'error': f'Could not parse enough numeric values for {log_type}'}

    n            = len(parsed)
    unique_dates = set(p['date'] for p in parsed)
    same_day     = len(unique_dates) <= 1   # all readings on same calendar date

    # ── Build X values ────────────────────────────────────────────────────────
    if same_day:
        xs = [float(p['index']) for p in parsed]
    else:
        try:
            base_date = datetime.strptime(parsed[0]['date'], '%Y-%m-%d').date()
            xs = [
                float(
                    (datetime.strptime(p['date'], '%Y-%m-%d').date() - base_date).days
                )
                for p in parsed
            ]
        except ValueError:
            xs       = [float(p['index']) for p in parsed]
            same_day = True

    ys       = [p['y']   for p in parsed]
    dates    = [p['date'] for p in parsed]
    raw_vals = [p['raw']  for p in parsed]

    # ── Linear regression ─────────────────────────────────────────────────────
    if SCIPY_AVAILABLE and n >= 3:
        slope, intercept, r_value, p_value, std_err = scipy_stats.linregress(xs, ys)
        r_squared = r_value ** 2
        conf_95   = 2.0 * std_err if std_err else 0.0
    else:
        # Manual least-squares — works with exactly 2 points
        mean_x = sum(xs) / n
        mean_y = sum(ys) / n
        ss_xy  = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
        ss_xx  = sum((x - mean_x) ** 2 for x in xs)

        slope     = ss_xy / ss_xx if ss_xx != 0 else 0.0
        intercept = mean_y - slope * mean_x

        y_pred    = [slope * x + intercept for x in xs]
        ss_res    = sum((y - yp) ** 2 for y, yp in zip(ys, y_pred))
        ss_tot    = sum((y - mean_y) ** 2 for y in ys)
        r_squared = 1 - ss_res / ss_tot if ss_tot != 0 else 1.0
        p_value   = 0.5   # unknown without scipy
        std_err   = 0.0
        conf_95   = 0.0

    # ── Classify trend using per-vital threshold ──────────────────────────────
    trend = _classify_trend(slope, r_squared, log_type)

    trend_label = {
        'rising':  '↑ Rising',
        'falling': '↓ Falling',
        'stable':  '→ Stable',
    }[trend]

    # change_per_week: days-based → 7*slope; same-day → slope per reading
    change_per_week = _r(slope) if same_day else _r(slope * 7)

    trend_line      = [_r(slope * x + intercept) for x in xs]
    predicted_today = _r(slope * xs[-1] + intercept)

    sig, sig_note = _significance(p_value, n)

    stats_obj = {
        'min':    _r(min(ys)),
        'max':    _r(max(ys)),
        'avg':    _r(sum(ys) / n),
        'median': _safe_median(ys),
        'std':    _safe_stdev(ys),
        'latest': _r(ys[-1]),
        'count':  n,
    }

    # ── Summary ───────────────────────────────────────────────────────────────
    direction = (
        'increasing' if trend == 'rising'
        else 'decreasing' if trend == 'falling'
        else 'stable'
    )

    if same_day:
        summary = (
            f"{meta['label']} is {direction} across {n} readings today"
            + (
                f" (changes by {abs(change_per_week)} {meta['unit']} per reading)"
                if trend != 'stable' else ''
            )
            + "."
        )
        data_note = f"Same-day data — {n} readings, X axis = reading order"
    else:
        day_count = len(unique_dates)
        summary = (
            f"{meta['label']} is {direction} over {day_count} day{'s' if day_count != 1 else ''}"
            + (
                f" by {abs(change_per_week)} {meta['unit']}/week"
                if trend != 'stable' else ''
            )
            + f" ({n} readings)."
        )
        data_note = f"{day_count} days of data, {n} readings total"

    reading_objects = [
        {'date': dates[i], 'value': raw_vals[i], 'numeric': _r(ys[i])}
        for i in range(n)
    ]

    return {
        'log_type':   log_type,
        'label':      meta['label'],
        'unit':       meta['unit'],
        'readings':   reading_objects,
        'trend_line': trend_line,
        'same_day':   same_day,
        'data_note':  data_note,
        'regression': {
            'slope':             _r(slope, 4),
            'intercept':         _r(intercept, 4),
            'r_squared':         _r(r_squared, 4),
            'p_value':           _r(p_value, 4),
            'std_err':           _r(std_err, 4),
            'conf_95':           _r(conf_95, 4),
            'trend':             trend,
            'trend_label':       trend_label,
            'trend_color':       _trend_color(trend),
            'change_per_week':   change_per_week,
            'predicted_today':   predicted_today,
            'summary':           summary,
            'significance':      sig,
            'significance_note': sig_note,
        },
        'stats': stats_obj,
    }


# ─── API views ────────────────────────────────────────────────────────────────

@api_view(['POST'])
def regression_batch(request):
    """
    POST /api/regression/batch/
    Body: { "vitals": [ { "log_type": "heart_rate", "readings": [...] }, ... ] }
    Returns a result for every vital (including errors so frontend can skip them).
    """
    vitals = request.data.get('vitals', [])
    if not vitals:
        return Response(
            {'error': 'No vitals provided. Send {"vitals": [...]}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    results = []
    for item in vitals:
        log_type = item.get('log_type', '')
        readings = item.get('readings', [])
        if not log_type:
            continue

        result = _run_regression(log_type, readings)

        # Pass through any extra fields from Node (e.g. data_window_days)
        for k, v in item.items():
            if k not in ('log_type', 'readings') and k not in result:
                result[k] = v

        results.append(result)

    return Response(results)


@api_view(['POST'])
def regression_single(request):
    """
    POST /api/regression/single/
    Body: { "log_type": "heart_rate", "readings": [...] }
    """
    log_type = request.data.get('log_type', '')
    readings = request.data.get('readings', [])

    if not log_type or not readings:
        return Response(
            {'error': 'Provide log_type and readings'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    result = _run_regression(log_type, readings)

    if 'error' in result:
        return Response(
            {'error': result['error']},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )

    return Response(result)


@api_view(['GET'])
def health_check(request):
    """GET /api/regression/health/ — liveness probe."""
    return Response({
        'status':                'ok',
        'scipy':                 SCIPY_AVAILABLE,
        'min_readings_required': 2,
        'same_day_support':      True,
        'per_vital_thresholds':  STABLE_THRESHOLDS,
    })