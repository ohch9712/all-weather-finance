# syntax=docker/dockerfile:1
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.9.3 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim AS runtime
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app
# 공식 릴리스: https://github.com/aptible/supercronic/releases/tag/v0.2.50
RUN case "$TARGETARCH" in \
      amd64) checksum=d2d7c97fbfefc763d5bbcbbb3f8d61f9dd3410ce5d05a737c414994b80b8cdd0 ;; \
      arm64) checksum=a1c0af9872e8de89a1ce5c1b596e26c42917d5a2cf914d98faee2e28156899e2 ;; \
      *) exit 1 ;; \
    esac \
    && curl -fsSL --retry 3 "https://github.com/aptible/supercronic/releases/download/v0.2.50/supercronic-linux-${TARGETARCH}" -o /usr/local/bin/supercronic \
    && echo "$checksum  /usr/local/bin/supercronic" | sha256sum -c - \
    && chmod 755 /usr/local/bin/supercronic
COPY --from=build /usr/local/bin/uv /usr/local/bin/uv
COPY --from=build --chown=app:app /app/.venv /app/.venv
WORKDIR /app
COPY --chown=app:app app ./app
COPY --chown=app:app alembic ./alembic
COPY --chown=app:app alembic.ini pyproject.toml uv.lock ./
ENV PATH="/app/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UV_NO_SYNC=true UV_PYTHON_DOWNLOADS=never TZ=Asia/Seoul
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
