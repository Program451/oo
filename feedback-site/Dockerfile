FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8095 BIND=0.0.0.0 DATA_DIR=/data TRUST_PROXY=1
COPY dist-node ./dist-node
COPY scripts/server-node.mjs scripts/sqlite-adapter.mjs ./scripts/
USER node
EXPOSE 8095
CMD ["node","--max-old-space-size=96","scripts/server-node.mjs"]
