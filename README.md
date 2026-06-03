# MediMind - Elderly Care Mobile Application

A cross-platform mobile application built with React Native (Expo) 
to support elderly users, caregivers, and doctors through AI-powered 
health monitoring, smart reminders, and real-time emergency alerts.

## Features
- Role-based dashboards for elderly users, caregivers, and doctors
- Medication reminders and health vitals logging
- Mood tracking with sentiment analysis (positive/negative classification)
- Emergency alerts and real-time push notifications
- AI-powered health risk detection from vital signs
- Personalized dietary and lifestyle care plan recommendations

## AI/ML Models
| Model | Purpose |
|-------|---------|
| Random Forest | Health risk detection from submitted vital signs |
| Logistic Regression | Daily mood sentiment classification  |
| T5 Transformer (fine-tuned) | Personalized care plan and dietary recommendations |

## Tech Stack

### Mobile Frontend
- React Native (Expo) - iOS & Android
- TypeScript

### Backend
- Django + Django REST Framework - main REST API
- Node.js + Express.js
- JWT authentication + bcrypt password hashing

### AI/ML Microservices
- Scikit-learn - Random Forest and Logistic Regression models
- FastAPI - serves the fine-tuned T5 NLP model

### Database
- MySQL - user, health, and connection data

## What the project covers
- Cross-platform mobile app with role-based access control (Elder, Caregiver, Doctor)
- Secure REST API with JWT authentication and password hashing
- Three integrated AI/ML models for health risk, mood analysis, and care recommendations
- Core health monitoring features with real-time push notifications
- Sentiment analysis on mood entries with automatic caregiver alerts
- High-fidelity UI/UX wireframes designed in Figma
- Agile project management via Trello
- API testing and documentation with Postman

## Tools
React Native, Expo, TypeScript, Django, Django REST Framework,
Node.js, Express.js, FastAPI, Scikit-learn, Python, MySQL,
JWT, bcrypt, Git, GitHub, Postman, Figma, Trello, Draw.io, VS Code
