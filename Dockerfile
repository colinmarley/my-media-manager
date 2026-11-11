FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_OUTPUT=standalone
ARG NEXT_IGNORE_LINT=false
ARG NEXT_IGNORE_TYPE_ERRORS=false
# Browser-side keys are inlined into the client bundle at build time.
# (The disc ripper URL is runtime-only now: DISC_RIPPER_URL, read by the
# server-side /api/disc-ripper proxy.)
ARG NEXT_PUBLIC_OMDB_API_KEY=
ARG NEXT_PUBLIC_TMDB_API_KEY=
ENV NEXT_OUTPUT=$NEXT_OUTPUT
ENV NEXT_IGNORE_LINT=$NEXT_IGNORE_LINT
ENV NEXT_IGNORE_TYPE_ERRORS=$NEXT_IGNORE_TYPE_ERRORS
ENV NEXT_PUBLIC_OMDB_API_KEY=$NEXT_PUBLIC_OMDB_API_KEY
ENV NEXT_PUBLIC_TMDB_API_KEY=$NEXT_PUBLIC_TMDB_API_KEY
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg/ffprobe: the /api/disc-ripper proxy transcodes rip previews and probes durations.
RUN apk add --no-cache ffmpeg && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
