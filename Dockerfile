# DARFUS Jewellery ERP — Backend API image
FROM node:20-alpine

# tini for proper signal handling, and bash for entrypoint scripts
RUN apk add --no-cache tini

WORKDIR /app

# Install dependencies first (better layer caching). Dev deps (sequelize-cli,
# nodemon) are kept so migrations can run inside the container.
COPY package*.json ./
RUN npm install

# App source
COPY . .

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
