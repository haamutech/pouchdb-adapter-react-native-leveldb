FROM node:lts-slim

WORKDIR /usr/local/app

# Copy application build files.
COPY package.json .
COPY package-lock.json .

# Install dependencies.
RUN npm install

# Audit all packages.
RUN npm audit --audit-level=critical

# Copy application sources.
COPY jest.config.js .
COPY src src
COPY test test

ENTRYPOINT [ "npm", "run" ]
CMD [ "test" ]
