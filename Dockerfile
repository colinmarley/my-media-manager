FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_OUTPUT=standalone
ARG NEXT_IGNORE_LINT=false
ARG NEXT_IGNORE_TYPE_ERRORS=false
ARG NEXT_PUBLIC_DISC_RIPPER_URL=http://localhost:8083
ENV NEXT_OUTPUT=$NEXT_OUTPUT
ENV NEXT_IGNORE_LINT=$NEXT_IGNORE_LINT
ENV NEXT_IGNORE_TYPE_ERRORS=$NEXT_IGNORE_TYPE_ERRORS
ENV NEXT_PUBLIC_DISC_RIPPER_URL=$NEXT_PUBLIC_DISC_RIPPER_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
