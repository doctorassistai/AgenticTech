FROM node:20-alpine

WORKDIR /app

# ✅ Only these files first (this enables dependency caching)
COPY package.json package-lock.json ./
RUN npm install

# ✅ Then copy the rest of the app
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
