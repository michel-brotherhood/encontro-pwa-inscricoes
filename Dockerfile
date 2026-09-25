FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
COPY db ./db
COPY public ./public
EXPOSE 3000
CMD ["npm", "start"]
