from django.urls import path
from . import views

urlpatterns = [
    path('batch/',        views.regression_batch,  name='regression_batch'),
    path('single/',       views.regression_single, name='regression_single'),
    path('health/',       views.health_check,      name='regression_health'),
    path('risk/assess/',  views.assess_risk,        name='risk_assess'),
    path('risk/health/',  views.risk_health,        name='risk_health'),
]