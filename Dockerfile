# Boujee Peach renderer: Docker deploy for Render.com
# Uses the official Playwright image so Chromium and system dependencies are preinstalled.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV RENDER_TIMEOUT_MS=120000

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

EXPOSE 3001
CMD ["npm", "start"]
