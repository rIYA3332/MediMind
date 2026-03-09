# regression/serializers.py
# ─────────────────────────────────────────────────────────────────────────────
# DRF serializers for input validation.

from rest_framework import serializers

VALID_LOG_TYPES = [
    'blood_pressure',
    'blood_sugar',
    'heart_rate',
    'temperature',
    'weight',
]


class ReadingSerializer(serializers.Serializer):
    date     = serializers.CharField(required=False, allow_blank=True, default='')
    logged_at= serializers.CharField(required=False, allow_blank=True, default='')
    value    = serializers.CharField()

    def validate(self, data):
        # At least one of date or logged_at must be present
        if not data.get('date') and not data.get('logged_at'):
            raise serializers.ValidationError('Each reading must have a "date" or "logged_at" field.')
        return data


class SingleRegressionSerializer(serializers.Serializer):
    log_type = serializers.ChoiceField(choices=VALID_LOG_TYPES)
    readings = serializers.ListField(
        child=ReadingSerializer(),
        min_length=1,
        error_messages={'min_length': 'At least 1 reading is required.'},
    )


class VitalBatchItemSerializer(serializers.Serializer):
    log_type = serializers.ChoiceField(choices=VALID_LOG_TYPES)
    readings = serializers.ListField(child=ReadingSerializer(), min_length=1)


class BatchRegressionSerializer(serializers.Serializer):
    vitals = serializers.ListField(
        child=VitalBatchItemSerializer(),
        min_length=1,
        error_messages={'min_length': 'At least 1 vital is required.'},
    )