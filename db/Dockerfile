# Postgres 16 + pg_bigm (CJK bigram FTS) + standard contrib (pg_trgm, citext, pgcrypto).
#
# WHY a custom image: the stock postgres:16 / postgres:16-alpine images do NOT
# ship pg_bigm, so `CREATE EXTENSION pg_bigm` in db/schema.sql would fail. This
# builds pg_bigm from source against the same major version. pg_trgm/citext/
# pgcrypto are in postgres-contrib (already present in the official image).
#
# Debian-based (not alpine) because pg_bigm's PGXS build is straightforward here.
#
# NOTE: verify the pg_bigm release tag is current before first build:
#   https://github.com/pgbigm/pg_bigm/releases
FROM postgres:16-bookworm

ARG PG_BIGM_VERSION=1.2-20240606

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        build-essential \
        postgresql-server-dev-16 \
        ca-certificates \
        curl; \
    curl -fsSL -o /tmp/pg_bigm.tar.gz \
        "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz"; \
    mkdir -p /tmp/pg_bigm; \
    tar -xzf /tmp/pg_bigm.tar.gz -C /tmp/pg_bigm --strip-components=1; \
    cd /tmp/pg_bigm; \
    make USE_PGXS=1; \
    make USE_PGXS=1 install; \
    apt-get purge -y --auto-remove build-essential postgresql-server-dev-16 curl; \
    rm -rf /var/lib/apt/lists/* /tmp/pg_bigm /tmp/pg_bigm.tar.gz

# enable_pg_bigm is on by default once the library is installed.
