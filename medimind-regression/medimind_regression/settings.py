# medimind_regression/settings.py
# ─────────────────────────────────
# Minimal Django settings for the regression microservice.
# This is a standalone Django app — no database needed (stateless API).
#
# Setup:
#   pip install django djangorestframework numpy scipy
#   python manage.py runserver 0.0.0.0:8001

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = 'django-regression-service-secret-change-in-prod'

DEBUG = True  # Set False in production

ALLOWED_HOSTS = ['*']  # Restrict in production

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'rest_framework',
    'regression',         # our app
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
]

ROOT_URLCONF = 'medimind_regression.urls'

# No database — this service is stateless (receives data, returns analysis)
DATABASES = {}

REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
    ],
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'