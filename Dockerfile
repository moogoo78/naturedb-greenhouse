# dev: Vite dev server with HMR (source bind-mounted by compose.yml)
FROM node:20-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
CMD ["npm", "run", "dev"]

FROM dev AS build
ARG VITE_NATUREDB_BASE=
ENV VITE_NATUREDB_BASE=$VITE_NATUREDB_BASE
RUN npm run build

# prod: static files only
FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
