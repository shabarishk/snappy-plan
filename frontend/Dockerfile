# Stage 1: Build React/Vite
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Inject our custom proxy rules
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled HTML/JS files
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]