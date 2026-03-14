# regression/views.py
import statistics
import os
import joblib
import numpy as np
import json
from datetime import datetime
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse

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

# Thresholds per day — how much must slope exceed to not be "stable"
STABLE_THRESHOLDS = {
    'blood_pressure': 0.25,   # 0.25 mmHg/day = ~1.75/week
    'blood_sugar':    0.40,   # 0.40 mg/dL/day = ~2.8/week
    'heart_rate':     0.15,   # 0.15 bpm/day = ~1/week
    'temperature':    0.015,  # 0.015°F/day
    'weight':         0.03,   # 0.03 kg/day = ~0.2kg/week
}
DEFAULT_STABLE_THRESHOLD = 0.15

# ─── RF model path & cache ────────────────────────────────────────────────────

_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'risk_rf_model.pkl')
_rf_bundle  = None

FEATURE_NAMES = [
    'bp_sys', 'bp_dia', 'blood_sugar', 'heart_rate', 'temperature', 'weight_change',
    'missed_doses_7d', 'missed_doses_streak', 'medication_adherence_pct',
    'missed_routines_7d', 'routine_adherence_pct',
    'missed_reminders_7d', 'reminder_adherence_pct',
    'missed_appointments_7d', 'total_missed_7d',
    'days_since_last_reading', 'reading_count_7d', 'risk_flag_count_7d',
]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _r(v, dp=2):
    try:
        return round(float(v), dp)
    except (TypeError, ValueError):
        return 0.0


def _parse_numeric(value_str, log_type):
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
    threshold = STABLE_THRESHOLDS.get(log_type, DEFAULT_STABLE_THRESHOLD)

    # When fit is weak (noisy data / few points), require a larger slope
    # to call it a trend — prevents noise being misread as a real trend.
    # But we never fully veto on r_squared alone: a steep slope on noisy
    # data (heart rate 90→55 over a week with day-to-day variance) IS real.
    if r_squared < 0.10:
        effective_threshold = threshold * 3.0   # need 3× slope to override very weak fit
    elif r_squared < 0.25:
        effective_threshold = threshold * 1.5
    else:
        effective_threshold = threshold

    if slope > effective_threshold:
        return 'rising'
    if slope < -effective_threshold:
        return 'falling'
    return 'stable'


def _clinical_status(log_type: str, latest_value: float) -> dict:
    """
    Returns the current clinical zone for the latest reading.
    Sent to the frontend so messages are contextually aware of
    where the value actually sits, independent of trend direction.
    """
    v = latest_value

    if log_type == 'blood_pressure':
        # latest_value is the systolic component
        if v >= 180:
            return {'zone': 'crisis',   'label': 'Hypertensive crisis', 'color': '#d63031'}
        if v >= 140:
            return {'zone': 'high',     'label': 'High',                'color': '#e17055'}
        if v >= 120:
            return {'zone': 'elevated', 'label': 'Elevated',            'color': '#fdcb6e'}
        if v >= 90:
            return {'zone': 'normal',   'label': 'Normal',              'color': '#00b894'}
        return     {'zone': 'low',      'label': 'Low',                 'color': '#0984e3'}

    if log_type == 'blood_sugar':
        if v >= 250:
            return {'zone': 'crisis',   'label': 'Critically high',     'color': '#d63031'}
        if v >= 180:
            return {'zone': 'high',     'label': 'High',                'color': '#e17055'}
        if v >= 100:
            return {'zone': 'elevated', 'label': 'Elevated',            'color': '#fdcb6e'}
        if v >= 70:
            return {'zone': 'normal',   'label': 'Normal',              'color': '#00b894'}
        if v >= 54:
            return {'zone': 'low',      'label': 'Low',                 'color': '#0984e3'}
        return     {'zone': 'crisis',   'label': 'Critically low',      'color': '#d63031'}

    if log_type == 'heart_rate':
        if v >= 150:
            return {'zone': 'crisis',   'label': 'Critically high',     'color': '#d63031'}
        if v >= 100:
            return {'zone': 'high',     'label': 'High',                'color': '#e17055'}
        if v >= 60:
            return {'zone': 'normal',   'label': 'Normal',              'color': '#00b894'}
        if v >= 50:
            return {'zone': 'low',      'label': 'Low',                 'color': '#0984e3'}
        return     {'zone': 'crisis',   'label': 'Critically low',      'color': '#d63031'}

    if log_type == 'temperature':
        if v >= 103:
            return {'zone': 'crisis',   'label': 'High fever',               'color': '#d63031'}
        if v >= 100.4:
            return {'zone': 'high',     'label': 'Fever',                    'color': '#e17055'}
        if v >= 97:
            return {'zone': 'normal',   'label': 'Normal',                   'color': '#00b894'}
        return     {'zone': 'low',      'label': 'Low — hypothermia risk',   'color': '#0984e3'}

    if log_type == 'weight':
        return {'zone': 'neutral', 'label': 'Tracking', 'color': '#636e72'}

    return {'zone': 'unknown', 'label': 'Unknown', 'color': '#636e72'}


def safe_float(val, default=0.0):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _load_model():
    global _rf_bundle
    if _rf_bundle is None:
        if not os.path.exists(_MODEL_PATH):
            return None, "Model file not found. Run: python regression/risk_model.py"
        try:
            _rf_bundle = joblib.load(_MODEL_PATH)
        except Exception as e:
            return None, f"Failed to load model: {e}"
    return _rf_bundle, None


# ─── Core regression ──────────────────────────────────────────────────────────

def _run_regression(log_type, readings):
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
    same_day     = len(unique_dates) <= 1

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

    if SCIPY_AVAILABLE and n >= 3:
        slope, intercept, r_value, p_value, std_err = scipy_stats.linregress(xs, ys)
        r_squared = r_value ** 2
        conf_95   = 2.0 * std_err if std_err else 0.0
    else:
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
        p_value   = 0.5
        std_err   = 0.0
        conf_95   = 0.0

    trend = _classify_trend(slope, r_squared, log_type)

    trend_label = {
        'rising':  '↑ Rising',
        'falling': '↓ Falling',
        'stable':  '→ Stable',
    }[trend]

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
        'log_type':        log_type,
        'label':           meta['label'],
        'unit':            meta['unit'],
        'readings':        reading_objects,
        'trend_line':      trend_line,
        'same_day':        same_day,
        'data_note':       data_note,
        'clinical_status': _clinical_status(log_type, _r(ys[-1])),
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


# ─── Regression API views ─────────────────────────────────────────────────────

@api_view(['POST'])
def regression_batch(request):
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

        for k, v in item.items():
            if k not in ('log_type', 'readings') and k not in result:
                result[k] = v

        results.append(result)

    return Response(results)


@api_view(['POST'])
def regression_single(request):
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
    return Response({
        'status':                'ok',
        'scipy':                 SCIPY_AVAILABLE,
        'min_readings_required': 2,
        'same_day_support':      True,
        'per_vital_thresholds':  STABLE_THRESHOLDS,
    })


# ─── Risk model helpers ───────────────────────────────────────────────────────

def _build_risk_detail(label: str, proba: dict, features: dict) -> dict:
    score = round(proba.get('HIGH', 0) * 100, 1)

    reasons = []
    actions = []

    bp_sys = features.get('bp_sys', 0)
    bp_dia = features.get('bp_dia', 0)
    if bp_sys > 160 or bp_dia > 100:
        reasons.append(f"Blood pressure is very high ({bp_sys}/{bp_dia} mmHg)")
        actions.append("Contact the doctor about blood pressure medication")
    elif bp_sys > 140 or bp_dia > 90:
        reasons.append(f"Blood pressure is elevated ({bp_sys}/{bp_dia} mmHg)")
        actions.append("Monitor blood pressure twice daily")

    sugar = features.get('blood_sugar', 0)
    if sugar > 250:
        reasons.append(f"Blood sugar is critically high ({sugar} mg/dL)")
        actions.append("Check insulin dosage and contact the doctor immediately")
    elif sugar > 180:
        reasons.append(f"Blood sugar is high ({sugar} mg/dL)")
        actions.append("Review diet and medication schedule for blood sugar")
    elif sugar < 70:
        reasons.append(f"Blood sugar is dangerously low ({sugar} mg/dL)")
        actions.append("Give a sugary snack and monitor closely; call doctor if no improvement")

    hr = features.get('heart_rate', 0)
    if hr > 130:
        reasons.append(f"Heart rate is very high ({hr} bpm)")
        actions.append("Seek medical attention for elevated heart rate")
    elif hr < 50:
        reasons.append(f"Heart rate is very low ({hr} bpm)")
        actions.append("Contact the doctor about low heart rate")

    temp = features.get('temperature', 0)
    if temp >= 103:
        reasons.append(f"High fever detected ({temp}°F)")
        actions.append("Seek urgent medical care for high fever")
    elif temp >= 100.4:
        reasons.append(f"Mild fever detected ({temp}°F)")
        actions.append("Monitor temperature and ensure adequate hydration")

    wt = features.get('weight_change', 0)
    if abs(wt) >= 5:
        direction = "gained" if wt > 0 else "lost"
        reasons.append(f"Significant weight change: {direction} {abs(wt):.1f} kg recently")
        actions.append("Discuss weight changes with the doctor at next visit")

    missed_doses = features.get('missed_doses_7d', 0)
    streak       = features.get('missed_doses_streak', 0)
    adherence    = features.get('medication_adherence_pct', 100)
    if streak >= 3:
        reasons.append(f"Medications missed for {streak} days in a row")
        actions.append("Ensure medications are given immediately and set daily reminders")
    elif missed_doses >= 4:
        reasons.append(f"{missed_doses} medication doses missed in the last 7 days")
        actions.append("Review medication schedule and check for side effects")
    elif adherence < 70:
        reasons.append(f"Low medication adherence ({adherence:.0f}%)")
        actions.append("Set up a pill organiser or daily medication alarm")

    missed_routines = features.get('missed_routines_7d', 0)
    routine_adh     = features.get('routine_adherence_pct', 100)
    if missed_routines >= 5:
        reasons.append(f"{missed_routines} daily routines missed in the last week")
        actions.append("Check on elder's daily activity and energy levels")
    elif routine_adh < 70:
        reasons.append(f"Low routine adherence ({routine_adh:.0f}%)")
        actions.append("Simplify the daily routine and check for mobility issues")

    missed_rem = features.get('missed_reminders_7d', 0)
    if missed_rem >= 5:
        reasons.append(f"{missed_rem} reminders missed in the last week")
        actions.append("Review reminder settings and check elder's alertness")

    missed_appts = features.get('missed_appointments_7d', 0)
    if missed_appts >= 2:
        reasons.append(f"{missed_appts} medical appointments missed recently")
        actions.append("Reschedule missed appointments as soon as possible")
    elif missed_appts == 1:
        reasons.append("1 medical appointment missed recently")
        actions.append("Reschedule the missed appointment")

    days_gap = features.get('days_since_last_reading', 0)
    if days_gap >= 5:
        reasons.append(f"No health readings recorded for {days_gap} days")
        actions.append("Log vitals today to keep the health record up to date")

    if label == 'HIGH' and not reasons:
        reasons.append("Multiple risk factors detected across vitals and schedule")
        actions.append("Schedule a comprehensive health review with the doctor")

    return {
        'risk_level':    label,
        'risk_score':    score,
        'probabilities': {k: round(v * 100, 1) for k, v in proba.items()},
        'reasons':       reasons,
        'actions':       actions,
        'summary':       _risk_summary(label, score, reasons),
    }


def _risk_summary(label: str, score: float, reasons: list) -> str:
    if label == 'HIGH':
        return (
            f"⚠️ High risk detected (score {score:.0f}/100). "
            f"{len(reasons)} concern{'s' if len(reasons) != 1 else ''} identified. "
            "Immediate caregiver attention recommended."
        )
    if label == 'MEDIUM':
        return (
            f"⚡ Moderate risk (score {score:.0f}/100). "
            f"{len(reasons)} area{'s' if len(reasons) != 1 else ''} to monitor. "
            "Review and address flagged items."
        )
    return (
        f"✅ Low risk (score {score:.0f}/100). "
        "All tracked parameters are within acceptable ranges."
    )


# ─── Risk API views ───────────────────────────────────────────────────────────

@api_view(['POST'])
def assess_risk(request):
    """
    POST /api/regression/risk/assess/
    Node.js sends flat feature fields directly (bp_sys, bp_dia, blood_sugar, etc.)
    """
    bundle, err = _load_model()
    if err:
        return Response({'error': err}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    clf      = bundle['model']
    features = bundle['features']

    defaults = {
        'bp_sys': 120, 'bp_dia': 80,
        'blood_sugar': 100, 'heart_rate': 72,
        'temperature': 98.6, 'weight_change': 0.0,
        'missed_doses_7d': 0, 'missed_doses_streak': 0,
        'medication_adherence_pct': 100,
        'missed_routines_7d': 0, 'routine_adherence_pct': 100,
        'missed_reminders_7d': 0, 'reminder_adherence_pct': 100,
        'missed_appointments_7d': 0, 'total_missed_7d': 0,
        'days_since_last_reading': 0, 'reading_count_7d': 7,
        'risk_flag_count_7d': 0,
    }

    data = request.data
    try:
        row = np.array([[
            float(data.get(f, defaults[f])) for f in features
        ]])
    except (TypeError, ValueError) as e:
        return Response({'error': f'Invalid feature value: {e}'}, status=status.HTTP_400_BAD_REQUEST)

    label     = clf.predict(row)[0]
    proba_arr = clf.predict_proba(row)[0]
    proba     = {cls: float(p) for cls, p in zip(clf.classes_, proba_arr)}

    used_features = {f: float(data.get(f, defaults[f])) for f in features}
    detail = _build_risk_detail(label, proba, used_features)

    return Response({
        'elder_id':      data.get('elder_id'),
        'assessment':    detail,
        'features_used': used_features,
    })


# =============================================================================
# SENTIMENT
# =============================================================================

import os as _os

_sentiment_module = None

def _get_sentiment_module():
    global _sentiment_module
    if _sentiment_module is None:
        import importlib.util, sys
        _dir  = _os.path.dirname(_os.path.abspath(__file__))
        _path = _os.path.join(_dir, 'sentiment_model.py')
        spec  = importlib.util.spec_from_file_location('sentiment_model', _path)
        mod   = importlib.util.module_from_spec(spec)
        sys.modules['sentiment_model'] = mod
        spec.loader.exec_module(mod)
        _sentiment_module = mod
    return _sentiment_module


@api_view(['POST'])
def assess_sentiment(request):
    try:
        data        = request.data
        elder_id    = data.get('elder_id', 0)
        mood        = str(data.get('mood', 'neutral')).lower().strip()
        notes       = str(data.get('notes', '') or '')
        mood_streak = int(data.get('mood_streak', 0))
        hour        = int(data.get('hour', 12))

        valid_moods = {'happy', 'neutral', 'sad', 'anxious', 'tired', 'lonely'}
        if mood not in valid_moods:
            return Response(
                {'error': f"Invalid mood '{mood}'. Valid: {sorted(valid_moods)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        mod    = _get_sentiment_module()
        result = mod.predict_sentiment(mood, notes, mood_streak, hour)

        from datetime import datetime, timezone
        return Response({
            'elder_id':     elder_id,
            'assessment':   result,
            'generated_at': datetime.now(timezone.utc).isoformat(),
        })

    except FileNotFoundError as e:
        return Response(
            {'error': str(e), 'hint': 'Run: python regression/sentiment_model.py'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response(
            {'error': 'Sentiment analysis failed', 'detail': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
def sentiment_health(request):
    try:
        mod  = _get_sentiment_module()
        mod.load_model()
        test = mod.predict_sentiment('happy', 'Feeling great today', 0, 10)
        return Response({
            'status':     'ok',
            'model':      'LogisticRegression',
            'test_score': test['concern_score'],
            'test_label': test['sentiment_label'],
            'model_path': mod.MODEL_PATH,
        })
    except Exception as e:
        return Response(
            {'status': 'error', 'detail': str(e)},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )

@api_view(['GET'])
def risk_health(request):
    """GET /api/regression/risk/health/ — model liveness probe."""
    bundle, err = _load_model()
    if err:
        return Response({'status': 'error', 'message': err},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)
    clf = bundle['model']
    return Response({
        'status':     'ok',
        'model':      'RandomForestClassifier',
        'estimators': clf.n_estimators,
        'classes':    list(clf.classes_),
        'features':   bundle['features'],
        'model_path': _MODEL_PATH,
    })