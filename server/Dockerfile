FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY db ./db
ENV NODE_ENV=production PORT=4500
EXPOSE 4500
# migrate idempoten: hanya membuat tabel bila belum ada
CMD ["sh", "-c", "node db/migrate.ts && node src/index.ts"]
