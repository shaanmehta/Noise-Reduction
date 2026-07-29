# Single-image build: the frontend is compiled to static files and served by
# the same process that exposes the API. One container means one origin, which
# removes CORS from the deployment entirely and fits a free hosting tier.

FROM node:20-slim AS frontend
WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# Empty base URL keeps API calls same-origin, which is how this image serves.
ENV VITE_API_BASE_URL=""
RUN npm run build


FROM python:3.12-slim AS runtime
WORKDIR /srv

# ffmpeg decodes the container formats libsndfile cannot open, such as MP4.
# libsndfile1 backs soundfile itself.
RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=frontend /build/dist ./static

# Run as an unprivileged user. Nothing is written to disk in normal operation,
# and the decoder's short-lived temporary files go to the system temp dir.
RUN useradd --create-home --uid 10001 service && chown -R service:service /srv
USER service

ENV STATIC_DIR=/srv/static \
    PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request,os,sys; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",8000)}/api/health', timeout=4).status==200 else 1)"

# A single worker is required: decoded clips live in this process's memory, so
# a second worker would not recognise a clip id issued by the first. Scale by
# running more instances behind a sticky-session balancer, or raise the
# per-instance limits in app/config.py.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 65"]
