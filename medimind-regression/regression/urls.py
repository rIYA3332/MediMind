# regression/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('batch/',   views.regression_batch,  name='regression-batch'),
    path('single/',  views.regression_single, name='regression-single'),
    path('health/',  views.health_check,       name='regression-health'),
]