# Use the official Playwright image as base to ensure all browser dependencies are installed
FROM mcr.microsoft.com/playwright:v1.50.0-jammy

# Set working directory
WORKDIR /app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Playwright browsers (though the base image usually has them, this ensures consistency)
RUN npx playwright install chromium

# Copy the rest of the application code
COPY . .

# Expose the application port
EXPOSE 3456

# Use tsx to run the application directly from TypeScript
CMD ["npx", "tsx", "src/index.ts"]
