# syntax=docker/dockerfile:1
FROM golang:1.26-bookworm AS build
ARG TARGETARCH
# 공식 릴리스: https://github.com/caddyserver/xcaddy/releases/tag/v0.4.7
RUN case "$TARGETARCH" in \
      amd64) checksum=e6d2882fb751b9697cdb73b0da8b8a7393f0d7f2cb47afa79a23982c4c61d2d4 ;; \
      arm64) checksum=2f24cd0e259761acd906d23dc558fa1855033e77e3c4318467ed59962fb3a02f ;; \
      *) exit 1 ;; \
    esac \
    && curl -fsSL --retry 3 "https://github.com/caddyserver/xcaddy/releases/download/v0.4.7/xcaddy_0.4.7_linux_${TARGETARCH}.tar.gz" -o /tmp/xcaddy.tar.gz \
    && echo "$checksum  /tmp/xcaddy.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/xcaddy.tar.gz -C /usr/local/bin xcaddy
# 커밋과 아카이브 SHA-256을 함께 고정한다. Go 의존성은 기본 sum.golang.org 검증을 유지한다.
RUN curl -fsSL --retry 3 https://codeload.github.com/mholt/caddy-ratelimit/tar.gz/5625512f24f6f59d6f64fb3aafe5eecff0b286db -o /tmp/ratelimit.tar.gz \
    && echo 'cdafe7c84ec1b025616681e8bf667f6571525e1c68e8497afd04ae5705607628  /tmp/ratelimit.tar.gz' | sha256sum -c - \
    && mkdir /src && tar -xzf /tmp/ratelimit.tar.gz -C /src --strip-components=1
RUN CGO_ENABLED=0 xcaddy build v2.11.7 --output /usr/bin/caddy \
    --with github.com/mholt/caddy-ratelimit=/src

FROM caddy:2.11.7-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app \
    && mkdir -p /data/caddy /config/caddy && chown -R app:app /data /config
USER app
