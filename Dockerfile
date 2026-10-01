FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
LABEL org.opencontainers.image.source="https://github.com/onigirito/dkg-review-ledger" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="Commit-aware pull-request review and CI evidence for DKG v10 agents"
WORKDIR /app
ENV NODE_ENV=production BIND_HOST=0.0.0.0 PORT=8080 JOURNAL_PATH=/data/reviews.sqlite
RUN mkdir /data && chown node:node /data
COPY --chown=node:node package.json README.md DESIGN.md SECURITY.md MAINTENANCE.md LICENSE ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node docs ./docs
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
