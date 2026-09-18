# Minimal static-file host for the Client Work Estimator.
# This container serves the frontend only — Firestore (the actual database)
# is still Google's cloud infrastructure; this doesn't change that.

FROM nginx:alpine

COPY index.html /usr/share/nginx/html/index.html
COPY src/ /usr/share/nginx/html/src/

EXPOSE 80
