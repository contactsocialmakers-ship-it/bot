FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p data logs

EXPOSE 3000

CMD ["node", "index.js"]
