FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

EXPOSE 3000

USER node

CMD ["node", "src/index.js"]
