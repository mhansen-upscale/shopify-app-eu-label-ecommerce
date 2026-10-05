# Produktions-Image für die Admin-App (Extensions laufen bei Shopify, nicht hier)
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma
# Amtliche Grafiken für die Bilder in Checkout und Bestellbestätigung (app/lib/render.server.ts)
COPY --from=build /app/extensions/eu-warranty-label/assets ./extensions/eu-warranty-label/assets
EXPOSE 3000
USER node
CMD ["npm", "run", "start"]
