# medimind_regression/urls.py

from django.urls import path, include

urlpatterns = [
    path('api/', include('regression.urls')),
]