# Minimal static-file host for the Client Work Estimator.
# This container serves the frontend only — Firestore (the actual database)
# is still Google's cloud infrastructure; this doesn't change that.
# /api/ requests are proxied to the productive-bridge backend service (see
# nginx.conf and docker-compose.yml) so the Productive API token never has
# to live in this frontend image or in the browser.

FROM nginx:alpine

COPY index.html /usr/share/nginx/html/index.html
COPY src/ /usr/share/nginx/html/src/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
