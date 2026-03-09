# regression/urls.py

from django.urls import path
from .views import SingleRegressionView, BatchRegressionView, HealthCheckView

urlpatterns = [
    path('regression/single/', SingleRegressionView.as_view(), name='regression-single'),
    path('regression/batch/',  BatchRegressionView.as_view(),  name='regression-batch'),
    path('regression/health/', HealthCheckView.as_view(),      name='regression-health'),
] 