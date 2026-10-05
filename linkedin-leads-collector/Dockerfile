# Based on the official Apify Node.js + Playwright + Chrome actor template
FROM apify/actor-node-playwright-chrome:18

# Copy just package*.json first to benefit from Docker layer caching
COPY package*.json ./

# Install production dependencies (skip dev & optional; browsers are pre-installed in the base image)
RUN npm --quiet set progress=false \
 && npm install --omit=dev --omit=optional \
 && echo "Installed NPM packages:" \
 && (npm list --omit=dev --all || true) \
 && echo "Node.js version:" \
 && node -v \
 && echo "NPM version:" \
 && npm -v

# Copy the rest of the actor source
COPY . ./

CMD npm run start --silent
