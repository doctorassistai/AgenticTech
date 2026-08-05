FROM node:20-alpine

WORKDIR /app

# Copy dependency files first
COPY package.json package-lock.json ./

# Install all dependencies (including pdf libs)
RUN npm install && \
    npm install jspdf html2canvas lucide-react @react-three/fiber three

# Copy app source
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
